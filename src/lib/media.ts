import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { contentFiles } from '../db/schema.ts';
import { enqueueBackgroundJob } from './jobs.ts';
import { getStorageRoot } from './security.ts';

// Constrain libvips cache & threads so Render 512MB/1vCPU containers never spike RAM
sharp.cache({ memory: 24, files: 10, items: 40 });
sharp.concurrency(2);

const ALLOWED_WIDTHS = [320, 480, 768, 960, 1280];

export function getThumbsRoot(): string {
  const dir = path.join(getStorageRoot(), '.thumbs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getChunksRoot(): string {
  const dir = path.join(getStorageRoot(), '.chunks');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Computes streaming SHA-256 hash of a file on disk without loading the whole file into RAM.
 */
export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Validates binary magic-byte signatures on disk so spoofed Content-Type headers are rejected.
 */
export async function validateUploadedFileMagicBytes(
  filePath: string,
  mimeType: string
): Promise<{ valid: boolean; reason?: string }> {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(32);
    const bytesRead = fs.readSync(fd, buf, 0, 32, 0);
    const head = buf.subarray(0, bytesRead);

    if (bytesRead === 0) {
      return { valid: false, reason: 'Uploaded file is empty.' };
    }

    if (mimeType === 'image/jpeg') {
      const ok = bytesRead >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      return ok ? { valid: true } : { valid: false, reason: 'Invalid JPEG binary header.' };
    }
    if (mimeType === 'image/png') {
      const ok =
        bytesRead >= 8 &&
        head[0] === 0x89 &&
        head[1] === 0x50 &&
        head[2] === 0x4e &&
        head[3] === 0x47 &&
        head[4] === 0x0d &&
        head[5] === 0x0a &&
        head[6] === 0x1a &&
        head[7] === 0x0a;
      return ok ? { valid: true } : { valid: false, reason: 'Invalid PNG binary header.' };
    }
    if (mimeType === 'image/gif') {
      const sig = head.subarray(0, 6).toString('ascii');
      const ok = sig === 'GIF87a' || sig === 'GIF89a';
      return ok ? { valid: true } : { valid: false, reason: 'Invalid GIF binary header.' };
    }
    if (mimeType === 'image/webp') {
      const ok =
        bytesRead >= 12 &&
        head.subarray(0, 4).toString('ascii') === 'RIFF' &&
        head.subarray(8, 12).toString('ascii') === 'WEBP';
      return ok ? { valid: true } : { valid: false, reason: 'Invalid WebP binary header.' };
    }
    if (mimeType === 'application/pdf') {
      const ok = head.subarray(0, 5).toString('ascii') === '%PDF-';
      return ok ? { valid: true } : { valid: false, reason: 'Invalid PDF file signature.' };
    }
    if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
      const ok = bytesRead >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp';
      return ok ? { valid: true } : { valid: false, reason: 'Invalid MP4/MOV container signature.' };
    }
    if (mimeType === 'video/webm') {
      const ok =
        bytesRead >= 4 &&
        head[0] === 0x1a &&
        head[1] === 0x45 &&
        head[2] === 0xdf &&
        head[3] === 0xa3;
      return ok ? { valid: true } : { valid: false, reason: 'Invalid WebM/EBML signature.' };
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const ok =
        bytesRead >= 4 &&
        head[0] === 0x50 &&
        head[1] === 0x4b &&
        (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
      return ok ? { valid: true } : { valid: false, reason: 'Invalid DOCX archive signature.' };
    }
    if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      // Reject files containing NUL bytes (binary disguising as text)
      const hasNull = head.includes(0x00);
      return !hasNull ? { valid: true } : { valid: false, reason: 'Binary content detected in text file.' };
    }

    return { valid: false, reason: `Unsupported MIME type: ${mimeType}` };
  } catch {
    return { valid: false, reason: 'Unable to inspect uploaded file signature.' };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

export function normalizeRequestedWidth(rawWidth: unknown): number | null {
  const w = Number(rawWidth);
  if (!Number.isFinite(w) || w <= 0) return null;
  for (const bucket of ALLOWED_WIDTHS) {
    if (w <= bucket) return bucket;
  }
  return 1280;
}

export function negotiateImageFormat(
  acceptHeader: string | undefined,
  explicitFmt: string | undefined
): 'avif' | 'webp' | null {
  const fmt = String(explicitFmt || '').toLowerCase();
  if (fmt === 'avif') return 'avif';
  if (fmt === 'webp') return 'webp';
  const accept = String(acceptHeader || '').toLowerCase();
  if (accept.includes('image/avif')) return 'avif';
  if (accept.includes('image/webp')) return 'webp';
  return null;
}

const inflightTransforms = new Map<string, Promise<string>>();

/**
 * Generates (and caches on disk) a resized WebP/AVIF variant of a local raster image.
 * Runs asynchronously on libuv worker threads via sharp without blocking the event loop.
 */
export async function getOrCreateOptimizedImageVariant(params: {
  sourcePath: string;
  cacheStem: string;
  width: number | null;
  format: 'avif' | 'webp';
}): Promise<{ filePath: string; contentType: string }> {
  const thumbsDir = getThumbsRoot();
  const safeStem = path.basename(params.cacheStem).replace(/[^a-zA-Z0-9._-]/g, '_');
  const suffix = params.width ? `${params.width}w` : 'orig';
  const outName = `${safeStem}.${suffix}.${params.format}`;
  const outPath = path.join(thumbsDir, outName);
  const contentType = params.format === 'avif' ? 'image/avif' : 'image/webp';

  if (fs.existsSync(outPath)) {
    return { filePath: outPath, contentType };
  }

  let task = inflightTransforms.get(outPath);
  if (!task) {
    task = (async () => {
      const tmpPath = `${outPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      let pipeline = sharp(params.sourcePath, { failOn: 'none' }).rotate();
      if (params.width) {
        pipeline = pipeline.resize({ width: params.width, withoutEnlargement: true });
      }
      if (params.format === 'avif') {
        pipeline = pipeline.avif({ quality: 52, effort: 3 });
      } else {
        pipeline = pipeline.webp({ quality: 78, effort: 4 });
      }
      await pipeline.toFile(tmpPath);
      fs.renameSync(tmpPath, outPath);
      return outPath;
    })().finally(() => {
      inflightTransforms.delete(outPath);
    });
    inflightTransforms.set(outPath, task);
  }

  await task;
  return { filePath: outPath, contentType };
}

/**
 * Enqueues non-blocking background thumbnail generation (480w WebP + AVIF) right after upload
 * so feed thumbnails are ready immediately without delaying the upload HTTP response.
 */
export function enqueueThumbnailGeneration(fileId: number, storageFilename: string, mimeType: string): void {
  if (!mimeType.startsWith('image/') || mimeType === 'image/gif') return;
  const sourcePath = path.resolve(getStorageRoot(), path.basename(storageFilename));
  if (!fs.existsSync(sourcePath)) return;

  enqueueBackgroundJob(`thumb-${fileId}`, async () => {
    const webp = await getOrCreateOptimizedImageVariant({
      sourcePath,
      cacheStem: storageFilename,
      width: 480,
      format: 'webp',
    });
    // Also pre-warm AVIF thumbnail for modern browsers
    await getOrCreateOptimizedImageVariant({
      sourcePath,
      cacheStem: storageFilename,
      width: 480,
      format: 'avif',
    }).catch(() => {});

    await db
      .update(contentFiles)
      .set({ thumbPath: path.basename(webp.filePath) })
      .where(eq(contentFiles.id, fileId));
  });
}

// ===== PURE-NODE AWS SIGV4 PRESIGNED OBJECT STORAGE (S3 / CLOUDFLARE R2 / GCS S3-API) =====
export interface ObjectStorageConfig {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicCdnUrl: string;
}

export function getObjectStorageConfig(): ObjectStorageConfig | null {
  const bucket = (process.env.S3_BUCKET || '').trim();
  const endpoint = (process.env.S3_ENDPOINT || '').trim().replace(/\/+$/, '');
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || '').trim();
  const region = (process.env.S3_REGION || 'auto').trim();
  const publicCdnUrl = (process.env.S3_PUBLIC_CDN_URL || '').trim().replace(/\/+$/, '');

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return { bucket, endpoint, region, accessKeyId, secretAccessKey, publicCdnUrl };
}

export function isObjectStorageConfigured(): boolean {
  return getObjectStorageConfig() !== null;
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function encodeS3Path(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Generates an AWS Signature Version 4 presigned URL (PUT for direct browser upload, GET for download)
 * compatible with AWS S3, Cloudflare R2, Backblaze B2, and Google Cloud Storage S3-compatible XML API.
 */
export function createPresignedObjectUrl(params: {
  method: 'PUT' | 'GET';
  objectKey: string;
  contentType?: string;
  expiresInSeconds?: number;
}): { url: string; publicUrl: string | null; expiresAt: string } | null {
  const cfg = getObjectStorageConfig();
  if (!cfg) return null;

  const expires = Math.max(60, Math.min(3600, params.expiresInSeconds || 900));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;

  const baseUrl = new URL(cfg.endpoint);
  const canonicalUri = `/${encodeURIComponent(cfg.bucket)}/${encodeS3Path(params.objectKey)}`;

  const signedHeaders = params.method === 'PUT' && params.contentType ? 'content-type;host' : 'host';
  const queryParams: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${cfg.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  queryParams.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalQuery = queryParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalHeaders =
    params.method === 'PUT' && params.contentType
      ? `content-type:${params.contentType}\nhost:${baseUrl.host}\n`
      : `host:${baseUrl.host}\n`;

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, cfg.region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const finalUrl = `${cfg.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  const publicUrl = cfg.publicCdnUrl ? `${cfg.publicCdnUrl}/${encodeS3Path(params.objectKey)}` : null;

  return {
    url: finalUrl,
    publicUrl,
    expiresAt: new Date(now.getTime() + expires * 1000).toISOString(),
  };
}
