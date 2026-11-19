import crypto from 'node:crypto';
import path from 'node:path';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.SQL_PASSWORD ||
  'scholarpress-dev-session-secret-key-change-in-prod';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export interface SessionPayload {
  uid: string;
  userId: number;
  email: string;
  role: string;
  exp: number;
}

export function createSessionToken(payload: Omit<SessionPayload, 'exp'>, ttlHours = 168): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + ttlHours * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `sp1.${encoded}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || !token.startsWith('sp1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function generateRandomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 72);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'resource'}-${suffix}`;
}

export function generateReceiptNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SP-${datePart}-${rand}`;
}

/**
 * Sanitizes rich-text HTML authored by creators to prevent XSS while preserving
 * clean academic formatting (headings, lists, tables, blockquotes, images, code).
 */
export function sanitizeHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  let clean = raw;
  // Remove dangerous elements completely
  clean = clean.replace(/<\s*(script|iframe|object|embed|style|form|input|button|textarea|select|meta|link|base|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  clean = clean.replace(/<\s*(script|iframe|object|embed|style|form|input|button|meta|link|base|svg|math)[^>]*\/?>/gi, '');
  // Remove inline event handlers (onclick=, onerror=, etc.) and dangerous attributes
  clean = clean.replace(/\s+(?:on[a-z]+|srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Neutralize javascript:, vbscript:, and non-raster data: URIs (strictly block data: on href and non-raster data: on src)
  clean = clean.replace(/href\s*=\s*(["'])\s*(?:javascript|vbscript|data)\s*:[^"']*\1/gi, 'href="#"');
  clean = clean.replace(/src\s*=\s*(["'])\s*(?:javascript|vbscript)\s*:[^"']*\1/gi, 'src="#"');
  clean = clean.replace(
    /src\s*=\s*(["'])\s*data\s*:([^"']*)\1/gi,
    (match, quote: string, payload: string) => {
      const trimmed = payload.trim();
      if (/^image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
        return `src=${quote}data:${trimmed}${quote}`;
      }
      return `src=${quote}#${quote}`;
    }
  );
  return clean.trim();
}

export function sanitizeSafeUrl(
  raw: string | null | undefined,
  allowRelative = false,
  allowRasterDataUri = false
): string | null {
  const val = String(raw || '').trim();
  if (!val) return null;
  if (
    allowRasterDataUri &&
    /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(val)
  ) {
    return val;
  }
  if (allowRelative && /^\/(?!\/)[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(val)) {
    return val;
  }
  try {
    const parsed = new URL(val);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function parseVideoStartSeconds(raw: string | null): number {
  if (!raw) return 0;
  const trimmed = raw.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Math.min(86400, Number(trimmed));
  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!match) return 0;
  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  return Math.min(86400, h * 3600 + m * 60 + s);
}

/**
 * Converts pasted YouTube share links (youtu.be, watch?v=, shorts, live, mobile, embed,
 * or pasted <iframe> HTML), Vimeo links, and Google Drive video links into clean,
 * iframe-embeddable HTTPS URLs.
 */
export function normalizeExternalVideoUrl(raw: string | null | undefined): string | null {
  let text = String(raw || '').trim();
  if (!text) return null;

  // If the creator pasted a full <iframe ... src="..."> snippet, extract src
  const iframeSrcMatch = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeSrcMatch?.[1]) {
    text = iframeSrcMatch[1].trim();
  } else {
    // If pasted from YouTube mobile Share sheet with title text before/after URL, extract URL
    const embeddedUrlMatch = text.match(/https?:\/\/[^\s<>"']+/i);
    if (embeddedUrlMatch?.[0]) {
      text = embeddedUrlMatch[0].trim();
    } else if (/^(?:www\.)?(?:youtu\.be|youtube\.com|m\.youtube\.com|vimeo\.com|player\.vimeo\.com|drive\.google\.com)\//i.test(text)) {
      text = `https://${text}`;
    }
  }

  // Strip trailing punctuation sometimes copied from sentences
  text = text.replace(/[),.;]+$/, '');

  const safe = sanitizeSafeUrl(text, false, false);
  if (!safe) return null;

  try {
    const parsed = new URL(safe);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    // YouTube formats
    if (
      host === 'youtu.be' ||
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      let videoId: string | null = null;
      if (host === 'youtu.be' && pathParts[0]) {
        videoId = pathParts[0];
      } else if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
        videoId = parsed.searchParams.get('v');
      } else if (
        pathParts.length >= 2 &&
        ['embed', 'shorts', 'live', 'v'].includes(pathParts[0].toLowerCase())
      ) {
        videoId = pathParts[1];
      }

      if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
        const startSec = parseVideoStartSeconds(
          parsed.searchParams.get('start') || parsed.searchParams.get('t')
        );
        const embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
        embedUrl.searchParams.set('rel', '0');
        if (startSec > 0) embedUrl.searchParams.set('start', String(startSec));
        return embedUrl.toString();
      }
    }

    // Vimeo formats
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const idMatch = parsed.pathname.match(/\/(?:video\/)?(\d{5,15})/);
      if (idMatch?.[1]) {
        return `https://player.vimeo.com/video/${idMatch[1]}`;
      }
    }

    // Google Drive video preview link
    if (host === 'drive.google.com') {
      const fileMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      const driveId = fileMatch?.[1] || parsed.searchParams.get('id');
      if (driveId) {
        return `https://drive.google.com/file/d/${driveId}/preview`;
      }
    }

    return safe;
  } catch {
    return null;
  }
}

export function estimateReadingTime(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  return Math.max(1, Math.ceil(words / 200));
}

export function createAutoPreview(html: string): string {
  const clean = sanitizeHtml(html)
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<img[^>]*>/gi, '');
  const plain = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260);
  return plain ? `<p>${plain}${plain.length >= 260 ? '...' : ''}</p>` : '';
}

export const ALLOWED_UPLOAD_MIMES: Record<
  string,
  { fileType: 'pdf' | 'video' | 'document' | 'cover' | 'image'; maxBytes: number }
> = {
  'application/pdf': { fileType: 'pdf', maxBytes: 25 * 1024 * 1024 },
  'video/mp4': { fileType: 'video', maxBytes: 50 * 1024 * 1024 },
  'video/webm': { fileType: 'video', maxBytes: 50 * 1024 * 1024 },
  'video/quicktime': { fileType: 'video', maxBytes: 50 * 1024 * 1024 },
  'image/jpeg': { fileType: 'image', maxBytes: 10 * 1024 * 1024 },
  'image/png': { fileType: 'image', maxBytes: 10 * 1024 * 1024 },
  'image/webp': { fileType: 'image', maxBytes: 10 * 1024 * 1024 },
  'image/gif': { fileType: 'image', maxBytes: 10 * 1024 * 1024 },
  'text/plain': { fileType: 'document', maxBytes: 5 * 1024 * 1024 },
  'text/markdown': { fileType: 'document', maxBytes: 5 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    fileType: 'document',
    maxBytes: 15 * 1024 * 1024,
  },
};

export function getStorageRoot(): string {
  return path.resolve(process.cwd(), process.env.UPLOAD_STORAGE_DIR || 'storage');
}
