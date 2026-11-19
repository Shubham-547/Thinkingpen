import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { generateUnique10DigitUid } from '../lib/identity.ts';
import { verifySessionToken } from '../lib/security.ts';

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
    return restored || {
      ...user,
      status: 'active',
      blockedReason: null,
      blockedUntil: null,
      blockedAt: null,
      blockedBy: null,
    };
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
 * Concurrency-safe user upsert for Firebase Auth Google Sign-In.
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

  try {
    // Check if an account already exists with this email (e.g., created earlier via email signup)
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
      const nextPublicUid = checked.publicUid || (await generateUnique10DigitUid());
      const [updated] = await db
        .update(users)
        .set({
          uid: params.uid,
          publicUid: nextPublicUid,
          emailVerified: true,
          avatarUrl: checked.avatarUrl || params.picture || null,
          role: nextRole,
          status: nextStatus,
          ...(isPrimary
            ? { blockedReason: null, blockedUntil: null, blockedAt: null, blockedBy: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, checked.id))
        .returning();
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

    return inserted;
  } catch (error) {
    console.error('Database error syncing Firebase user:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

async function resolveUserFromToken(token: string): Promise<DbUser | null> {
  // 1. Platform HMAC Session Token (email/password login)
  if (token.startsWith('sp1.')) {
    const payload = verifySessionToken(token);
    if (!payload) return null;
    try {
      const [rawUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.userId))
        .limit(1);
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
        return restored || { ...user, publicUid: nextPublicUid };
      }
      return user;
    } catch (error) {
      console.error('Session lookup failed:', error);
      return null;
    }
  }

  // 2. Firebase Auth ID Token (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.uid || !decoded.email) return null;
    return await getOrCreateFirebaseUser({
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
    });
  } catch {
    return null;
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  // Only allow query-string tokens on protected inline PDF/video media delivery endpoints
  if (req.originalUrl.startsWith('/api/catalog/files/')) {
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : null;
    return queryToken || null;
  }
  return null;
}

export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const token = extractBearer(req);
  if (!token) return next();
  const user = await resolveUserFromToken(token);
  if (user && user.status === 'active') {
    req.user = user;
  }
  return next();
};

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  const user = await resolveUserFromToken(token);
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
