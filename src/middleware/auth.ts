import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { generateUnique10DigitUid } from '../lib/identity.ts';
import { verifySessionToken, verifySignedFileToken } from '../lib/security.ts';

export type DbUser = typeof users.$inferSelect;

export interface AuthRequest extends Request {
  user?: DbUser;
}

// Single immutable Primary Super Admin — can only be changed directly in source code.
export const SUPER_ADMIN_EMAIL = 'personal.shubham1872@gmail.com';

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return String(email || '').toLowerCase().trim() === SUPER_ADMIN_EMAIL;
}

export function isOwnerAdminEmail(email: string | null | undefined): boolean {
  return isSuperAdminEmail(email);
}

// Short-lived bounded user lookup cache (10s TTL) — cuts DB queries under concurrent load
// and is invalidated immediately whenever an account is modified, blocked, suspended, or deleted.
const USER_CACHE_TTL_MS = 10_000;
const MAX_USER_CACHE = 400;
const userByIdCache = new Map<number, { user: DbUser; expiresAt: number }>();
const userByEmailCache = new Map<string, { user: DbUser; expiresAt: number }>();

function cacheUser(user: DbUser): void {
  if (userByIdCache.size >= MAX_USER_CACHE) {
    const firstKey = userByIdCache.keys().next().value;
    if (firstKey !== undefined) userByIdCache.delete(firstKey);
  }
  if (userByEmailCache.size >= MAX_USER_CACHE) {
    const firstEmail = userByEmailCache.keys().next().value;
    if (firstEmail !== undefined) userByEmailCache.delete(firstEmail);
  }
  const entry = { user, expiresAt: Date.now() + USER_CACHE_TTL_MS };
  userByIdCache.set(user.id, entry);
  userByEmailCache.set(user.email.toLowerCase(), entry);
}

export function invalidateUserAuthCache(userId?: number, email?: string): void {
  if (!userId && !email) {
    userByIdCache.clear();
    userByEmailCache.clear();
    return;
  }
  if (userId) {
    const existing = userByIdCache.get(userId);
    if (existing) {
      userByEmailCache.delete(existing.user.email.toLowerCase());
    }
    userByIdCache.delete(userId);
  }
  if (email) {
    const clean = email.toLowerCase().trim();
    const existing = userByEmailCache.get(clean);
    if (existing) {
      userByIdCache.delete(existing.user.id);
    }
    userByEmailCache.delete(clean);
  }
}

function getCachedUserById(userId: number): DbUser | null {
  const entry = userByIdCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    userByIdCache.delete(userId);
    return null;
  }
  return entry.user;
}

function getCachedUserByEmail(email: string): DbUser | null {
  const clean = email.toLowerCase().trim();
  const entry = userByEmailCache.get(clean);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    userByEmailCache.delete(clean);
    return null;
  }
  return entry.user;
}

/**
 * Automatically restores a blocked/suspended account once its timed block expires.
 */
export async function autoUnblockIfExpired(user: DbUser): Promise<DbUser> {
  if (
    (user.status === 'blocked' || user.status === 'suspended') &&
    user.blockedUntil &&
    new Date(user.blockedUntil).getTime() <= Date.now()
  ) {
    const [restored] = await db
      .update(users)
      .set({
        status: 'active',
        blockedReason: null,
        blockedUntil: null,
        blockedAt: null,
        blockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    const finalUser = restored || {
      ...user,
      status: 'active',
      blockedReason: null,
      blockedUntil: null,
      blockedAt: null,
      blockedBy: null,
    };
    cacheUser(finalUser);
    return finalUser;
  }
  return user;
}

/**
 * Builds a structured 403 JSON response detailing why and how long a user is blocked/suspended.
 */
export function buildBlockedPayload(user: DbUser) {
  const statusLabel = user.status === 'suspended' ? 'suspended' : 'blocked';
  const reason =
    user.blockedReason?.trim() ||
    'Your account has been restricted by an administrator due to a policy violation.';
  const untilIso = user.blockedUntil ? new Date(user.blockedUntil).toISOString() : null;
  const untilLabel = user.blockedUntil
    ? `until ${new Date(user.blockedUntil).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      })} IST`
    : 'permanently';

  return {
    accountBlocked: true,
    status: statusLabel,
    blockedReason: reason,
    blockedUntil: untilIso,
    blockedAt: user.blockedAt ? new Date(user.blockedAt).toISOString() : null,
    error: `Your account is ${statusLabel} ${untilLabel}. Reason: ${reason}`,
  };
}

/**
 * Concurrency-safe user lookup/upsert for Firebase Auth Google Sign-In.
 * Uses read-only fast path when user record is already in sync (eliminates redundant UPDATE writes on every GET).
 */
export async function getOrCreateFirebaseUser(params: {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
}): Promise<DbUser> {
  const cleanEmail = params.email.toLowerCase().trim();
  const displayName = params.name?.trim() || cleanEmail.split('@')[0];
  const desiredRole = isOwnerAdminEmail(cleanEmail) ? 'admin' : 'user';

  const cached = getCachedUserByEmail(cleanEmail);
  if (
    cached &&
    cached.uid === params.uid &&
    cached.emailVerified &&
    Boolean(cached.publicUid) &&
    (!isSuperAdminEmail(cleanEmail) || (cached.role === 'admin' && cached.status === 'active'))
  ) {
    return autoUnblockIfExpired(cached);
  }

  try {
    const [byEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (byEmail) {
      const checked = await autoUnblockIfExpired(byEmail);
      const isPrimary = isSuperAdminEmail(cleanEmail);
      const nextRole = isPrimary ? 'admin' : checked.role;
      const nextStatus = isPrimary ? 'active' : checked.status;
      const nextAvatar = checked.avatarUrl || params.picture || null;

      const needsUpdate =
        checked.uid !== params.uid ||
        !checked.publicUid ||
        !checked.emailVerified ||
        checked.role !== nextRole ||
        checked.status !== nextStatus ||
        checked.avatarUrl !== nextAvatar;

      if (!needsUpdate) {
        cacheUser(checked);
        return checked;
      }

      const nextPublicUid = checked.publicUid || (await generateUnique10DigitUid());
      const [updated] = await db
        .update(users)
        .set({
          uid: params.uid,
          publicUid: nextPublicUid,
          emailVerified: true,
          avatarUrl: nextAvatar,
          role: nextRole,
          status: nextStatus,
          ...(isPrimary
            ? { blockedReason: null, blockedUntil: null, blockedAt: null, blockedBy: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, checked.id))
        .returning();
      cacheUser(updated);
      return updated;
    }

    const publicUid = await generateUnique10DigitUid();
    const [inserted] = await db
      .insert(users)
      .values({
        uid: params.uid,
        publicUid,
        email: cleanEmail,
        name: displayName,
        role: desiredRole,
        status: 'active',
        emailVerified: true,
        avatarUrl: params.picture || null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: cleanEmail,
          emailVerified: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    cacheUser(inserted);
    return inserted;
  } catch (error) {
    console.error('Database error syncing Firebase user:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

async function resolveUserById(userId: number): Promise<DbUser | null> {
  const cached = getCachedUserById(userId);
  if (cached) {
    return autoUnblockIfExpired(cached);
  }
  const [rawUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!rawUser) return null;

  const user = await autoUnblockIfExpired(rawUser);

  const needsHeal =
    (isSuperAdminEmail(user.email) && (user.role !== 'admin' || user.status !== 'active')) ||
    !user.publicUid;

  if (needsHeal) {
    const nextPublicUid = user.publicUid || (await generateUnique10DigitUid());
    const isPrimary = isSuperAdminEmail(user.email);
    const [restored] = await db
      .update(users)
      .set({
        publicUid: nextPublicUid,
        role: isPrimary ? 'admin' : user.role,
        status: isPrimary ? 'active' : user.status,
        ...(isPrimary
          ? { blockedReason: null, blockedUntil: null, blockedAt: null, blockedBy: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    const finalUser = restored || { ...user, publicUid: nextPublicUid };
    cacheUser(finalUser);
    return finalUser;
  }

  cacheUser(user);
  return user;
}

async function resolveUserFromToken(token: string, expectedFileId?: number): Promise<DbUser | null> {
  // 0. Short-lived signed file access token (scoped strictly to fileId + userId)
  if (token.startsWith('sf1.') && expectedFileId !== undefined) {
    const signed = verifySignedFileToken(token, expectedFileId);
    if (!signed) return null;
    try {
      return await resolveUserById(signed.userId);
    } catch {
      return null;
    }
  }

  // 1. Platform HMAC Session Token (email/password login)
  if (token.startsWith('sp1.')) {
    const payload = verifySessionToken(token);
    if (!payload) return null;
    try {
      return await resolveUserById(payload.userId);
    } catch (error) {
      console.error('Session lookup failed:', error);
      return null;
    }
  }

  // 2. Firebase Auth ID Token (Google, Facebook, Twitter Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.uid) return null;
    const providerRaw = String(decoded.firebase?.sign_in_provider || 'social')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    const resolvedEmail =
      decoded.email?.trim() || `${decoded.uid.toLowerCase()}@${providerRaw || 'social'}.scholarpress.local`;
    return await getOrCreateFirebaseUser({
      uid: decoded.uid,
      email: resolvedEmail,
      name: decoded.name || `${providerRaw || 'ScholarPress'} User`,
      picture: decoded.picture,
    });
  } catch {
    return null;
  }
}

function extractBearer(req: Request): { token: string | null; fileId?: number } {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return { token: header.slice(7).trim() };
  }
  // Protected inline PDF/video/image delivery endpoints accept short-lived file tokens (?ft=sf1...)
  // and retain legacy ?token= compatibility for existing bookmarks/iframes.
  if (req.originalUrl.startsWith('/api/catalog/files/')) {
    const fileIdMatch = req.originalUrl.match(/^\/api\/catalog\/files\/(\d+)/);
    const fileId = fileIdMatch ? Number(fileIdMatch[1]) : undefined;
    const ft = typeof req.query.ft === 'string' ? req.query.ft.trim() : null;
    if (ft && fileId !== undefined) return { token: ft, fileId };
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : null;
    if (queryToken) return { token: queryToken, fileId };
  }
  return { token: null };
}

export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const { token, fileId } = extractBearer(req);
  if (!token) return next();
  const user = await resolveUserFromToken(token, fileId);
  if (user && user.status === 'active') {
    req.user = user;
  }
  return next();
};

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { token, fileId } = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  const user = await resolveUserFromToken(token, fileId);
  if (!user) {
    return res.status(401).json({ error: 'Session invalid or expired. Please sign in again.' });
  }
  if (user.status === 'blocked' || user.status === 'suspended') {
    return res.status(403).json(buildBlockedPayload(user));
  }
  req.user = user;
  return next();
};

export const requireCreator = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.user.role !== 'creator' && req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Creator account required. Complete Creator Onboarding to publish content.',
    });
  }
  return next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator privileges required.' });
  }
  return next();
};
