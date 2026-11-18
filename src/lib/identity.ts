import crypto from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

export const OCCUPATION_ROLES = [
  'School Student',
  'College Student',
  'Competitive Exam Aspirant',
  'Teacher / Educator',
  'Engineer',
  'Doctor',
  'Artist',
  'Businessman / Entrepreneur',
  'Researcher',
  'Working Professional',
  'Other',
] as const;

export const GENDER_OPTIONS = [
  'Male',
  'Female',
  'Non-binary',
  'Prefer not to say',
] as const;

/**
 * Generates a unique 10-digit numeric UID string (1000000000–9999999999).
 */
export async function generateUnique10DigitUid(): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = String(crypto.randomInt(1_000_000_000, 10_000_000_000));
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.publicUid, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  // Cryptographic fallback using timestamp tail + random digits
  const fallback = `${Date.now()}`.slice(-6) + String(crypto.randomInt(1000, 10000));
  return fallback.slice(0, 10).padStart(10, '1');
}

/**
 * Normalizes a unique User ID / handle (lowercase, trimmed, strips leading @).
 */
export function normalizeUsername(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

/**
 * Validates format of a Unique User ID (one name/ID per user).
 */
export function validateUsername(raw: unknown): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = normalizeUsername(raw);
  if (!normalized) {
    return { valid: false, normalized: '', error: 'Unique User ID is required.' };
  }
  if (normalized.length < 3 || normalized.length > 30) {
    return {
      valid: false,
      normalized,
      error: 'Unique User ID must be between 3 and 30 characters.',
    };
  }
  if (!/^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error:
        'Use only lowercase letters, numbers, dots (.), underscores (_), or hyphens (-), starting and ending with a letter or number.',
    };
  }
  if (/\.\.|__|-\-/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Unique User ID cannot contain consecutive punctuation.',
    };
  }
  return { valid: true, normalized };
}

/**
 * Checks case-insensitively whether a Unique User ID is already held by another account.
 */
export async function isUsernameTaken(
  normalizedUsername: string,
  excludeUserId?: number
): Promise<boolean> {
  const clean = normalizeUsername(normalizedUsername);
  if (!clean) return false;
  const condition = excludeUserId
    ? and(sql`LOWER(${users.username}) = ${clean}`, ne(users.id, excludeUserId))
    : sql`LOWER(${users.username}) = ${clean}`;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(condition)
    .limit(1);

  return Boolean(existing);
}

/**
 * Backfills 10-digit publicUid for any existing users who do not have one yet.
 */
export async function backfillMissingPublicUids(): Promise<number> {
  const missing = await db
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.publicUid));

  let updatedCount = 0;
  for (const row of missing) {
    const publicUid = await generateUnique10DigitUid();
    await db
      .update(users)
      .set({ publicUid, updatedAt: new Date() })
      .where(eq(users.id, row.id));
    updatedCount += 1;
  }
  return updatedCount;
}

/**
 * Returns IST (UTC+5:30) calendar breakdown for visit tracking (day/month/year).
 */
export function getIstCalendarDate(now = new Date()): {
  visitDate: string;
  visitYear: number;
  visitMonth: number;
  visitDay: number;
} {
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const visitYear = ist.getUTCFullYear();
  const visitMonth = ist.getUTCMonth() + 1;
  const visitDay = ist.getUTCDate();
  const visitDate = `${visitYear}-${String(visitMonth).padStart(2, '0')}-${String(visitDay).padStart(2, '0')}`;
  return { visitDate, visitYear, visitMonth, visitDay };
}
