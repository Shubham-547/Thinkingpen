import { Router } from 'express';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  authTokens,
  creatorProfiles,
  creatorWallets,
  notifications,
  userProfiles,
  users,
} from '../db/schema.ts';
import {
  createSessionToken,
  generateRandomToken,
  hashPassword,
  sanitizeSafeUrl,
  verifyPassword,
} from '../lib/security.ts';
import {
  isOwnerAdminEmail,
  requireAuth,
  type AuthRequest,
} from '../middleware/auth.ts';

const router = Router();

async function buildUserEnvelope(userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const [creatorProfile] = await db
    .select()
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, userId))
    .limit(1);

  const [wallet] = await db
    .select()
    .from(creatorWallets)
    .where(eq(creatorWallets.creatorId, userId))
    .limit(1);

  const [unreadRow] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  const [adminCountRow] = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.role, 'admin'));

  return {
    id: user.id,
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    createdAt: user.createdAt,
    profile: profile || null,
    creatorProfile: creatorProfile || null,
    wallet: wallet || null,
    unreadNotifications: Number(unreadRow?.value || 0),
    canBootstrapAdmin:
      user.role !== 'admin' &&
      (Number(adminCountRow?.value || 0) === 0 || isOwnerAdminEmail(user.email)),
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const registerAsCreator = Boolean(req.body?.registerAsCreator);

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: 'Please enter a valid full name (2–80 characters).' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const uid = `local-${generateRandomToken(12)}`;
    const passwordHash = hashPassword(password);
    const role = isOwnerAdminEmail(email) ? 'admin' : registerAsCreator ? 'creator' : 'user';

    const [created] = await db
      .insert(users)
      .values({
        uid,
        email,
        name,
        passwordHash,
        role,
        status: 'active',
        emailVerified: false,
      })
      .returning();

    await db.insert(userProfiles).values({ userId: created.id }).onConflictDoNothing();

    if (role === 'creator' || role === 'admin') {
      await db
        .insert(creatorProfiles)
        .values({
          userId: created.id,
          displayName: name,
          acceptedCreatorAgreement: true,
          agreementAcceptedAt: new Date(),
        })
        .onConflictDoNothing();
      await db
        .insert(creatorWallets)
        .values({ creatorId: created.id })
        .onConflictDoNothing();
    }

    const verifyToken = generateRandomToken(20);
    await db.insert(authTokens).values({
      userId: created.id,
      token: verifyToken,
      type: 'email_verify',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await db.insert(notifications).values({
      userId: created.id,
      type: 'welcome',
      title: 'Welcome to ScholarPress',
      message: 'Your account is active. Verify your email address and explore the catalog.',
      link: '#/dashboard',
    });

    const token = createSessionToken({
      uid: created.uid,
      userId: created.id,
      email: created.email,
      role: created.role,
    });

    const envelope = await buildUserEnvelope(created.id);
    return res.status(201).json({
      token,
      user: envelope,
      verificationTokenPreview: verifyToken,
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Unable to complete registration. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status !== 'active') {
      return res
        .status(403)
        .json({ error: `Account is currently ${user.status}. Please contact support.` });
    }

    const token = createSessionToken({
      uid: user.uid,
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const envelope = await buildUserEnvelope(user.id);
    return res.json({ token, user: envelope });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

// POST /api/auth/firebase-sync (verified via requireAuth Firebase ID token)
router.post('/firebase-sync', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    await db.insert(userProfiles).values({ userId }).onConflictDoNothing();
    const envelope = await buildUserEnvelope(userId);
    return res.json({ user: envelope });
  } catch (error) {
    console.error('Firebase sync error:', error);
    return res.status(500).json({ error: 'Unable to synchronize Google account.' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const envelope = await buildUserEnvelope(req.user!.id);
    return res.json({ user: envelope });
  } catch (error) {
    console.error('Auth me error:', error);
    return res.status(500).json({ error: 'Unable to load account details.' });
  }
});

// POST /api/auth/forgot-password (Never expose reset tokens in public HTTP responses)
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Please provide your registered email address.' });
    }
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user && user.status === 'active') {
      const resetToken = generateRandomToken(24);
      await db.insert(authTokens).values({
        userId: user.id,
        token: resetToken,
        type: 'password_reset',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    }

    // Always return an identical message to prevent account enumeration & token leakage
    return res.json({
      message:
        'If an account matches this email, a secure password reset request has been registered. For immediate recovery without SMTP configured, sign in with Google or contact the site administrator.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request.' });
  }
});

// POST /api/auth/change-password (Authenticated password rotation)
router.post('/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    if (user.passwordHash) {
      if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Unable to update password.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.password || '');

    if (!token || newPassword.length < 8) {
      return res
        .status(400)
        .json({ error: 'Valid reset token and a new password (min 8 characters) are required.' });
    }

    const [record] = await db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.token, token),
          eq(authTokens.type, 'password_reset'),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!record) {
      return res.status(400).json({ error: 'Reset token is invalid or has expired.' });
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, record.userId));

    await db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(eq(authTokens.id, record.id));

    return res.json({ message: 'Password updated successfully. You may now sign in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required.' });
    }

    const [record] = await db
      .select()
      .from(authTokens)
      .where(
        and(
          eq(authTokens.token, token),
          eq(authTokens.type, 'email_verify'),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!record) {
      return res.status(400).json({ error: 'Verification token is invalid or expired.' });
    }

    await db
      .update(users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(users.id, record.userId));

    await db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(eq(authTokens.id, record.id));

    return res.json({ message: 'Email address verified successfully.' });
  } catch (error) {
    console.error('Verify email error:', error);
    return res.status(500).json({ error: 'Email verification failed.' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', requireAuth, async (req: AuthRequest, res) => {
  try {
    const verifyToken = generateRandomToken(20);
    await db.insert(authTokens).values({
      userId: req.user!.id,
      token: verifyToken,
      type: 'email_verify',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return res.json({
      message: 'A new verification code has been generated.',
      verificationTokenPreview: verifyToken,
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    return res.status(500).json({ error: 'Unable to generate verification code.' });
  }
});

// POST /api/auth/become-creator
router.post('/become-creator', requireAuth, async (req: AuthRequest, res) => {
  try {
    const displayName = String(req.body?.displayName || req.user!.name).trim();
    const tagline = String(req.body?.tagline || '').trim();
    const expertise = String(req.body?.expertise || '').trim();
    const payoutMethod = req.body?.payoutMethod === 'bank_transfer' ? 'bank_transfer' : 'upi';
    const payoutDetails = req.body?.payoutDetails || {};
    const acceptedAgreement = Boolean(req.body?.acceptedAgreement);

    if (!acceptedAgreement) {
      return res
        .status(400)
        .json({ error: 'You must accept the Creator Agreement and Content Guidelines.' });
    }
    if (displayName.length < 2) {
      return res.status(400).json({ error: 'Please provide a valid creator display name.' });
    }

    const nextRole = req.user!.role === 'admin' ? 'admin' : 'creator';
    await db
      .update(users)
      .set({ role: nextRole, updatedAt: new Date() })
      .where(eq(users.id, req.user!.id));

    await db
      .insert(creatorProfiles)
      .values({
        userId: req.user!.id,
        displayName,
        tagline,
        expertise,
        payoutMethod,
        payoutDetails,
        acceptedCreatorAgreement: true,
        agreementAcceptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: creatorProfiles.userId,
        set: {
          displayName,
          tagline,
          expertise,
          payoutMethod,
          payoutDetails,
          acceptedCreatorAgreement: true,
          agreementAcceptedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    await db
      .insert(creatorWallets)
      .values({ creatorId: req.user!.id })
      .onConflictDoNothing();

    await db.insert(notifications).values({
      userId: req.user!.id,
      type: 'creator_activated',
      title: 'Creator publishing enabled',
      message: 'You can now upload notes, PDFs, articles, poems, stories, and video lectures.',
      link: '#/creator',
    });

    const envelope = await buildUserEnvelope(req.user!.id);
    return res.json({ user: envelope, message: 'Creator account activated.' });
  } catch (error) {
    console.error('Become creator error:', error);
    return res.status(500).json({ error: 'Unable to activate creator profile.' });
  }
});

// POST /api/auth/bootstrap-admin (Secure dev setup: only when zero admins exist or email matches owner)
router.post('/bootstrap-admin', requireAuth, async (req: AuthRequest, res) => {
  try {
    const [adminCountRow] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, 'admin'));

    const hasAdmins = Number(adminCountRow?.value || 0) > 0;
    if (hasAdmins && !isOwnerAdminEmail(req.user!.email)) {
      return res.status(403).json({
        error: 'An administrator account already exists. Ask an existing admin to grant access.',
      });
    }

    await db
      .update(users)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(eq(users.id, req.user!.id));

    await db
      .insert(creatorProfiles)
      .values({
        userId: req.user!.id,
        displayName: req.user!.name,
        acceptedCreatorAgreement: true,
        agreementAcceptedAt: new Date(),
        verified: true,
      })
      .onConflictDoNothing();

    await db
      .insert(creatorWallets)
      .values({ creatorId: req.user!.id })
      .onConflictDoNothing();

    await db.insert(auditLogs).values({
      actorId: req.user!.id,
      action: 'admin_bootstrap',
      entityType: 'user',
      entityId: String(req.user!.id),
      details: { email: req.user!.email },
      ipAddress: req.ip || null,
    });

    const envelope = await buildUserEnvelope(req.user!.id);
    return res.json({ user: envelope, message: 'Administrator access configured.' });
  } catch (error) {
    console.error('Admin bootstrap error:', error);
    return res.status(500).json({ error: 'Unable to initialize administrator access.' });
  }
});

// PUT /api/auth/profile
router.put('/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const name = String(req.body?.name || req.user!.name).trim();
    const bio = String(req.body?.bio || '').trim().slice(0, 800);
    const headline = String(req.body?.headline || '').trim().slice(0, 140);
    const institution = String(req.body?.institution || '').trim().slice(0, 140);
    const location = String(req.body?.location || '').trim().slice(0, 100);
    const languagePreference = String(req.body?.languagePreference || 'English').trim();
    const websiteUrl = sanitizeSafeUrl(req.body?.websiteUrl, false)?.slice(0, 240) || '';

    if (name.length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    }

    await db
      .update(users)
      .set({ name, bio, updatedAt: new Date() })
      .where(eq(users.id, req.user!.id));

    await db
      .insert(userProfiles)
      .values({
        userId: req.user!.id,
        headline,
        institution,
        location,
        languagePreference,
        websiteUrl,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          headline,
          institution,
          location,
          languagePreference,
          websiteUrl,
          updatedAt: new Date(),
        },
      });

    if (req.body?.creatorProfile && (req.user!.role === 'creator' || req.user!.role === 'admin')) {
      const cp = req.body.creatorProfile;
      await db
        .update(creatorProfiles)
        .set({
          displayName: String(cp.displayName || name).trim(),
          tagline: String(cp.tagline || '').trim().slice(0, 180),
          expertise: String(cp.expertise || '').trim().slice(0, 220),
          updatedAt: new Date(),
        })
        .where(eq(creatorProfiles.userId, req.user!.id));
    }

    const envelope = await buildUserEnvelope(req.user!.id);
    return res.json({ user: envelope, message: 'Profile saved.' });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Unable to update profile.' });
  }
});

export default router;
