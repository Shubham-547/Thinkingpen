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
  // Neutralize javascript:, vbscript:, and data: URIs
  clean = clean.replace(/(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data)\s*:[^"']*\2/gi, '$1="#"');
  return clean.trim();
}

export function sanitizeSafeUrl(raw: string | null | undefined, allowRelative = false): string | null {
  const val = String(raw || '').trim();
  if (!val) return null;
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

export function estimateReadingTime(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  return Math.max(1, Math.ceil(words / 200));
}

export function createAutoPreview(html: string): string {
  const clean = sanitizeHtml(html);
  const paragraphs = clean.match(/<(p|h2|h3|blockquote)[^>]*>[\s\S]*?<\/\1>/gi);
  if (paragraphs && paragraphs.length > 0) {
    return paragraphs.slice(0, 3).join('\n');
  }
  const plain = clean.replace(/<[^>]+>/g, ' ').trim().slice(0, 420);
  return `<p>${plain}${plain.length >= 420 ? '...' : ''}</p>`;
}

export const ALLOWED_UPLOAD_MIMES: Record<string, { fileType: 'pdf' | 'video' | 'document' | 'cover'; maxBytes: number }> = {
  'application/pdf': { fileType: 'pdf', maxBytes: 25 * 1024 * 1024 },
  'video/mp4': { fileType: 'video', maxBytes: 50 * 1024 * 1024 },
  'video/webm': { fileType: 'video', maxBytes: 50 * 1024 * 1024 },
  'image/jpeg': { fileType: 'cover', maxBytes: 5 * 1024 * 1024 },
  'image/png': { fileType: 'cover', maxBytes: 5 * 1024 * 1024 },
  'image/webp': { fileType: 'cover', maxBytes: 5 * 1024 * 1024 },
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
