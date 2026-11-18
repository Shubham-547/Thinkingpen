import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
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
      const isPrimary = isSuperAdminEmail(cleanEmail);
      const nextRole = isPrimary ? 'admin' : byEmail.role;
      const nextStatus = isPrimary ? 'active' : byEmail.status;
      const [updated] = await db
        .update(users)
        .set({
          uid: params.uid,
          emailVerified: true,
          avatarUrl: byEmail.avatarUrl || params.picture || null,
          role: nextRole,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(users.id, byEmail.id))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(users)
      .values({
        uid: params.uid,
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
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.userId))
        .limit(1);
      if (!user) return null;
      // Primary Super Admin can never lose admin role or be deactivated without editing source code
      if (isSuperAdminEmail(user.email) && (user.role !== 'admin' || user.status !== 'active')) {
        const [restored] = await db
          .update(users)
          .set({ role: 'admin', status: 'active', updatedAt: new Date() })
          .where(eq(users.id, user.id))
          .returning();
        return restored || { ...user, role: 'admin', status: 'active' };
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
    return res
      .status(403)
      .json({ error: `Your account is currently ${user.status}. Please contact support.` });
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
