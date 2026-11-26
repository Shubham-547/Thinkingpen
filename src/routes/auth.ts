import { Router } from 'express';
import { and, count, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  authTokens,
  contents,
  creatorProfiles,
  creatorWallets,
  deletedAccountLogs,
  notifications,
  passwordResetTokens,
  pendingSignups,
  purchases,
  userActivitySessions,
  userDailyVisits,
  userProfiles,
  users,
} from '../db/schema.ts';
import {
  generateUnique10DigitUid,
  getIstCalendarDate,
  isUsernameTaken,
  validateUsername,
} from '../lib/identity.ts';
import {
  createSessionToken,
  generateNumericOtp,
  generatePasswordResetToken,
  generateRandomToken,
  getTrustedAppBaseUrl,
  hashOtpCode,
  hashPasswordAsync,
  hashPasswordResetToken,
  maskEmailAddress,
  sanitizeSafeUrl,
  verifyOtpHash,
  verifyPasswordAsync,
} from '../lib/security.ts';
import { isMailerConfigured, sendPasswordResetEmail, sendSignupOtpEmail } from '../lib/mailer.ts';
import {
  autoUnblockIfExpired,
  buildBlockedPayload,
  invalidateUserAuthCache,
  isOwnerAdminEmail,
  isSuperAdminEmail,
  optionalAuth,
  requireAuth,
  type AuthRequest,
} from '../middleware/auth.ts';

const router = Router();

async function buildUserEnvelope(userId: number) {
  const [userRows, profileRows, creatorProfileRows, walletRows, unreadRows, purchaseRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1),
    db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, userId)).limit(1),
    db.select().from(creatorWallets).where(eq(creatorWallets.creatorId, userId)).limit(1),
    db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false))),
    db
      .select({ contentId: purchases.contentId })
      .from(purchases)
      .where(and(eq(purchases.userId, userId), eq(purchases.status, 'active'))),
  ]);

  const user = userRows[0];
  if (!user) return null;
  const profile = profileRows[0];
  const creatorProfile = creatorProfileRows[0];
  const wallet = walletRows[0];
  const unreadRow = unreadRows[0];

  let publicUid = user.publicUid;
  if (!publicUid) {
    publicUid = await generateUnique10DigitUid();
    await db
      .update(users)
      .set({ publicUid, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    invalidateUserAuthCache(user.id, user.email);
  }

  return {
    id: user.id,
    uid: user.uid,
    publicUid,
    username: user.username || null,
    email: user.email,
    name: user.name,
    role: user.role,
    isSuperAdmin: isSuperAdminEmail(user.email),
    status: user.status,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    createdAt: user.createdAt,
    profile: profile || null,
    creatorProfile: creatorProfile || null,
    wallet: wallet || null,
    purchasedContentIds: purchaseRows.map((p) => Number(p.contentId)),
    unreadNotifications: Number(unreadRow?.value || 0),
    canBootstrapAdmin: user.role !== 'admin' && isSuperAdminEmail(user.email),
  };
}

// GET /api/auth/check-username?username=...
router.get('/check-username', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const raw = String(req.query.username || '');
    const check = validateUsername(raw);
    if (!check.valid) {
      return res.json({
        valid: false,
        available: false,
        normalized: check.normalized,
        message: check.error,
      });
    }
    const taken = await isUsernameTaken(check.normalized, req.user?.id);
    return res.json({
      valid: true,
      available: !taken,
      normalized: check.normalized,
      message: taken
        ? 'This Unique ID is already taken by another user. Please choose another.'
        : `@${check.normalized} is available!`,
    });
  } catch (error) {
    console.error('Check username error:', error);
    return res.status(500).json({ error: 'Unable to check Unique ID right now.' });
  }
});

const OTP_TTL_MS = 2 * 60 * 1000; // 120 seconds
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_RESENDS = 5;

export async function purgeExpiredPendingSignups(): Promise<void> {
  const now = new Date();
  const abandonedCutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
  const verifiedCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours

  // Mark freshly expired pending sessions as expired so resend checks stay clean
  await db
    .update(pendingSignups)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(pendingSignups.status, 'pending'), lt(pendingSignups.otpExpiresAt, now)));

  // Delete stale unverified rows whose OTP expired > 1h ago and old verified audit rows (> 24h old)
  await db
    .delete(pendingSignups)
    .where(
      or(
        and(eq(pendingSignups.status, 'verified'), lt(pendingSignups.verifiedAt, verifiedCutoff)),
        and(
          or(
            eq(pendingSignups.status, 'expired'),
            eq(pendingSignups.status, 'locked'),
            eq(pendingSignups.status, 'pending')
          ),
          lt(pendingSignups.otpExpiresAt, abandonedCutoff)
        )
      )
    );
}

const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function purgeExpiredPasswordResetTokens(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // retain 24h audit window then prune
  await db
    .delete(passwordResetTokens)
    .where(
      or(
        lt(passwordResetTokens.expiresAt, cutoff),
        lt(passwordResetTokens.usedAt, cutoff)
      )
    );
}

// POST /api/auth/signup/initiate
router.post('/signup/initiate', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const confirmPassword =
      req.body?.confirmPassword !== undefined ? String(req.body.confirmPassword) : null;
    const acceptedTerms = req.body?.acceptedTerms;
    const registerAsCreator = Boolean(req.body?.registerAsCreator);
    const rawUsername = String(req.body?.username || '').trim();
    const state = String(req.body?.state || '').trim().slice(0, 80);
    const country = String(req.body?.country || '').trim().slice(0, 80);
    const occupationRole = String(req.body?.occupationRole || '').trim().slice(0, 80);
    const gender = String(req.body?.gender || '').trim().slice(0, 40);
    const dateOfBirth = String(req.body?.dateOfBirth || '').trim().slice(0, 20);
    const bio = String(req.body?.bio || req.body?.description || '').trim().slice(0, 800);

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: 'Please enter a valid full name (2–80 characters).' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }
    if (confirmPassword !== null && confirmPassword !== password) {
      return res.status(400).json({ error: 'Password and Confirm Password do not match.' });
    }
    if (acceptedTerms === false) {
      return res
        .status(400)
        .json({ error: 'Please agree to the Terms & Conditions and Privacy Policy.' });
    }

    let finalUsername: string | null = null;
    if (rawUsername) {
      const uCheck = validateUsername(rawUsername);
      if (!uCheck.valid) {
        return res.status(400).json({ error: uCheck.error });
      }
      if (await isUsernameTaken(uCheck.normalized)) {
        return res.status(409).json({
          error: 'This username / Unique ID is already registered. Please choose another.',
        });
      }
      finalUsername = uCheck.normalized;
    }

    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingUser) {
      return res.status(409).json({
        error: 'An account with this email is already registered. Please sign in instead.',
      });
    }

    // Per-email abuse guard (max 5 initiations in 15 mins; 15s minimum gap between initiate calls)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const [recentCountRow] = await db
      .select({ value: count() })
      .from(pendingSignups)
      .where(and(eq(pendingSignups.email, email), gt(pendingSignups.createdAt, fifteenMinsAgo)));

    if (Number(recentCountRow?.value || 0) >= 5) {
      return res.status(429).json({
        error: 'Too many OTP requests for this email. Please wait 15 minutes and try again.',
      });
    }

    const [latestPending] = await db
      .select()
      .from(pendingSignups)
      .where(and(eq(pendingSignups.email, email), eq(pendingSignups.status, 'pending')))
      .orderBy(desc(pendingSignups.lastSentAt))
      .limit(1);

    if (latestPending && Date.now() - new Date(latestPending.lastSentAt).getTime() < 15 * 1000) {
      return res.status(429).json({
        error: 'An OTP was just sent to this email. Please check your inbox or wait a moment.',
      });
    }

    if (!isMailerConfigured()) {
      return res.status(503).json({
        error:
          'Email delivery is not configured on the server yet. Missing SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).',
        missingEmailConfig: true,
      });
    }

    const pendingToken = generateRandomToken(24);
    const otpCode = generateNumericOtp(4);
    const otpHash = hashOtpCode(pendingToken, otpCode);
    const passwordHash = await hashPasswordAsync(password);
    const role = isOwnerAdminEmail(email) ? 'admin' : registerAsCreator ? 'creator' : 'user';
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Expire any prior pending OTP records for this email before creating a fresh one
    await db
      .update(pendingSignups)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(pendingSignups.email, email), eq(pendingSignups.status, 'pending')));

    const [createdPending] = await db
      .insert(pendingSignups)
      .values({
        pendingToken,
        email,
        username: finalUsername,
        name,
        passwordHash,
        role,
        profilePayload: {
          state: state || null,
          country: country || null,
          occupationRole: occupationRole || null,
          gender: gender || null,
          dateOfBirth: dateOfBirth || null,
          bio: bio || null,
        },
        otpHash,
        otpExpiresAt,
        attemptsCount: 0,
        resendCount: 0,
        lastSentAt: new Date(),
        status: 'pending',
        ipAddress: req.ip || null,
      })
      .returning();

    const emailResult = await sendSignupOtpEmail({
      toEmail: email,
      userName: name,
      otpCode,
      expiresMinutes: 2,
    });

    if (!emailResult.sent) {
      await db.delete(pendingSignups).where(eq(pendingSignups.id, createdPending.id));
      return res.status(503).json({
        error:
          'Unable to send verification OTP email right now. Please check your email server configuration and try again.',
        emailDeliveryError: true,
      });
    }

    return res.status(201).json({
      pendingToken,
      maskedEmail: maskEmailAddress(email),
      email,
      name,
      expiresAt: otpExpiresAt.toISOString(),
      serverTime: new Date().toISOString(),
      ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
      attemptsRemaining: OTP_MAX_ATTEMPTS,
      message: 'We have sent a 4-digit OTP to your email address.',
    });
  } catch (error) {
    console.error('Signup initiate error:', error);
    return res.status(500).json({ error: 'Unable to start verification. Please try again.' });
  }
});

// GET /api/auth/otp/status?pendingToken=...
router.get('/otp/status', async (req, res) => {
  try {
    const pendingToken = String(req.query?.pendingToken || '').trim();
    if (!pendingToken) {
      return res.status(400).json({ error: 'Verification token is required.' });
    }

    const [pending] = await db
      .select()
      .from(pendingSignups)
      .where(eq(pendingSignups.pendingToken, pendingToken))
      .limit(1);

    if (!pending) {
      return res.status(404).json({ error: 'Verification session not found or expired.' });
    }

    const nowMs = Date.now();
    const expiresMs = new Date(pending.otpExpiresAt).getTime();
    const remainingSeconds = Math.max(0, Math.ceil((expiresMs - nowMs) / 1000));
    const isExpired = remainingSeconds <= 0 || pending.status === 'expired';

    return res.json({
      status: isExpired && pending.status === 'pending' ? 'expired' : pending.status,
      maskedEmail: maskEmailAddress(pending.email),
      name: pending.name,
      expiresAt: new Date(pending.otpExpiresAt).toISOString(),
      serverTime: new Date(nowMs).toISOString(),
      remainingSeconds,
      attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - pending.attemptsCount),
      maxAttempts: OTP_MAX_ATTEMPTS,
      canResend:
        pending.status !== 'verified' &&
        remainingSeconds <= 0 &&
        pending.resendCount < OTP_MAX_RESENDS,
      resendCount: pending.resendCount,
      maxResends: OTP_MAX_RESENDS,
    });
  } catch (error) {
    console.error('OTP status error:', error);
    return res.status(500).json({ error: 'Unable to check verification status.' });
  }
});

// POST /api/auth/otp/verify
router.post('/otp/verify', async (req, res) => {
  try {
    const pendingToken = String(req.body?.pendingToken || '').trim();
    const otp = String(req.body?.otp || '').trim();

    if (!pendingToken) {
      return res.status(400).json({ error: 'Verification session is missing. Please sign up again.' });
    }
    if (!/^\d{4}$/.test(otp)) {
      return res.status(400).json({ error: 'Please enter a valid 4-digit numeric OTP.' });
    }

    const [pending] = await db
      .select()
      .from(pendingSignups)
      .where(eq(pendingSignups.pendingToken, pendingToken))
      .limit(1);

    if (!pending) {
      return res.status(404).json({ error: 'Verification session not found or expired. Please sign up again.' });
    }

    if (pending.status === 'verified') {
      return res.status(409).json({
        error: 'This account has already been verified. Please sign in.',
        alreadyVerified: true,
      });
    }

    if (pending.status === 'locked' || pending.attemptsCount >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        error: 'Maximum incorrect OTP attempts reached. Please wait for the timer to expire and request a new OTP.',
        locked: true,
        attemptsRemaining: 0,
      });
    }

    if (Date.now() > new Date(pending.otpExpiresAt).getTime() || pending.status === 'expired') {
      if (pending.status === 'pending') {
        await db
          .update(pendingSignups)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(pendingSignups.id, pending.id));
      }
      return res.status(400).json({
        error: 'OTP has expired after 2 minutes. Please click Resend OTP for a new code.',
        expired: true,
        remainingSeconds: 0,
      });
    }

    const otpMatches = verifyOtpHash(pending.pendingToken, otp, pending.otpHash);
    if (!otpMatches) {
      const [updated] = await db
        .update(pendingSignups)
        .set({
          attemptsCount: sql`${pendingSignups.attemptsCount} + 1`,
          status: sql`CASE WHEN ${pendingSignups.attemptsCount} + 1 >= ${OTP_MAX_ATTEMPTS} THEN 'locked' ELSE 'pending' END`,
          updatedAt: new Date(),
        })
        .where(and(eq(pendingSignups.id, pending.id), eq(pendingSignups.status, 'pending')))
        .returning({ attemptsCount: pendingSignups.attemptsCount, status: pendingSignups.status });

      const nextAttempts = updated?.attemptsCount ?? pending.attemptsCount + 1;
      const attemptsRemaining = Math.max(0, OTP_MAX_ATTEMPTS - nextAttempts);
      const locked = nextAttempts >= OTP_MAX_ATTEMPTS || updated?.status === 'locked';

      return res.status(locked ? 429 : 400).json({
        error: locked
          ? 'Too many incorrect attempts (5/5). Please wait for the timer to expire and request a new OTP.'
          : `Incorrect OTP. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`,
        attemptsRemaining,
        locked,
      });
    }

    // OTP verified — atomically claim pending record & create account inside a transaction
    const createdUserId = await db.transaction(async (tx) => {
      const now = new Date();
      const [claimed] = await tx
        .update(pendingSignups)
        .set({ status: 'verified', verifiedAt: now, updatedAt: now })
        .where(
          and(
            eq(pendingSignups.id, pending.id),
            eq(pendingSignups.status, 'pending'),
            gt(pendingSignups.otpExpiresAt, now)
          )
        )
        .returning();

      if (!claimed) {
        throw Object.assign(new Error('Verification session already processed or expired.'), {
          httpStatus: 409,
        });
      }

      const [existingEmailUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, claimed.email))
        .limit(1);

      if (existingEmailUser) {
        throw Object.assign(new Error('An account with this email already exists. Please sign in.'), {
          httpStatus: 409,
        });
      }

      if (claimed.username && (await isUsernameTaken(claimed.username))) {
        throw Object.assign(
          new Error('This username was claimed by another user. Please sign up with a different username.'),
          { httpStatus: 409 }
        );
      }

      const uid = `local-${generateRandomToken(12)}`;
      const publicUid = await generateUnique10DigitUid();
      const payload = claimed.profilePayload || {};

      const [created] = await tx
        .insert(users)
        .values({
          uid,
          publicUid,
          username: claimed.username || null,
          email: claimed.email,
          name: claimed.name,
          bio: payload.bio || null,
          passwordHash: claimed.passwordHash,
          role: claimed.role,
          status: 'active',
          emailVerified: true,
        })
        .returning();

      const profileCompleted = Boolean(
        claimed.username && (payload.state || payload.country || payload.occupationRole)
      );
      const combinedLocation = [payload.state, payload.country].filter(Boolean).join(', ');

      await tx
        .insert(userProfiles)
        .values({
          userId: created.id,
          state: payload.state || null,
          country: payload.country || null,
          location: combinedLocation || null,
          occupationRole: payload.occupationRole || null,
          headline: payload.occupationRole || null,
          gender: payload.gender || null,
          dateOfBirth: payload.dateOfBirth || null,
          profileCompleted,
        })
        .onConflictDoNothing();

      if (claimed.role === 'creator' || claimed.role === 'admin') {
        await tx
          .insert(creatorProfiles)
          .values({
            userId: created.id,
            displayName: claimed.name,
            acceptedCreatorAgreement: true,
            agreementAcceptedAt: now,
          })
          .onConflictDoNothing();
        await tx
          .insert(creatorWallets)
          .values({ creatorId: created.id })
          .onConflictDoNothing();
      }

      await tx.insert(notifications).values({
        userId: created.id,
        type: 'welcome',
        title: 'Welcome to ScholarPress',
        message: 'Email verified successfully. Your ScholarPress account is now active.',
        link: '#/dashboard',
      });

      return created.id;
    });

    const [createdUser] = await db.select().from(users).where(eq(users.id, createdUserId)).limit(1);
    const token = createSessionToken({
      uid: createdUser.uid,
      userId: createdUser.id,
      email: createdUser.email,
      role: createdUser.role,
      sv: createdUser.sessionVersion ?? 1,
    });
    const envelope = await buildUserEnvelope(createdUser.id);

    return res.status(201).json({
      token,
      user: envelope,
      message: 'Email verified successfully. Your account has been created.',
    });
  } catch (error) {
    const errObj = error as { httpStatus?: number; message?: string; code?: string };
    if (errObj?.httpStatus) {
      return res.status(errObj.httpStatus).json({ error: errObj.message });
    }
    if (errObj?.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('OTP verify error:', error);
    return res.status(500).json({ error: 'Unable to verify OTP right now. Please try again.' });
  }
});

// POST /api/auth/otp/resend
router.post('/otp/resend', async (req, res) => {
  try {
    const pendingToken = String(req.body?.pendingToken || '').trim();
    if (!pendingToken) {
      return res.status(400).json({ error: 'Verification session token is required.' });
    }

    const [pending] = await db
      .select()
      .from(pendingSignups)
      .where(eq(pendingSignups.pendingToken, pendingToken))
      .limit(1);

    if (!pending) {
      return res.status(404).json({ error: 'Verification session not found. Please sign up again.' });
    }

    if (pending.status === 'verified') {
      return res.status(409).json({ error: 'This account is already verified. Please sign in.' });
    }

    const remainingMs = new Date(pending.otpExpiresAt).getTime() - Date.now();
    if (remainingMs > 0) {
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      return res.status(429).json({
        error: `Please wait ${remainingSeconds}s before requesting a new OTP.`,
        remainingSeconds,
      });
    }

    if (pending.resendCount >= OTP_MAX_RESENDS) {
      return res.status(429).json({
        error: 'Maximum OTP resend limit reached for this session. Please start sign up again.',
      });
    }

    const [existingEmailUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, pending.email))
      .limit(1);
    if (existingEmailUser) {
      return res.status(409).json({
        error: 'An account with this email already exists. Please sign in.',
      });
    }

    if (!isMailerConfigured()) {
      return res.status(503).json({
        error:
          'Email delivery is not configured on the server yet. Missing SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).',
        missingEmailConfig: true,
      });
    }

    const newOtpCode = generateNumericOtp(4);
    const newOtpHash = hashOtpCode(pending.pendingToken, newOtpCode);
    const newExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    const emailResult = await sendSignupOtpEmail({
      toEmail: pending.email,
      userName: pending.name,
      otpCode: newOtpCode,
      expiresMinutes: 2,
    });

    if (!emailResult.sent) {
      return res.status(503).json({
        error: 'Unable to deliver new OTP email right now. Please try again shortly.',
        emailDeliveryError: true,
      });
    }

    await db
      .update(pendingSignups)
      .set({
        otpHash: newOtpHash,
        otpExpiresAt: newExpiresAt,
        attemptsCount: 0,
        resendCount: pending.resendCount + 1,
        lastSentAt: new Date(),
        status: 'pending',
        updatedAt: new Date(),
      })
      .where(eq(pendingSignups.id, pending.id));

    return res.json({
      pendingToken: pending.pendingToken,
      maskedEmail: maskEmailAddress(pending.email),
      expiresAt: newExpiresAt.toISOString(),
      serverTime: new Date().toISOString(),
      ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
      attemptsRemaining: OTP_MAX_ATTEMPTS,
      message: 'A new 4-digit OTP has been sent to your email.',
    });
  } catch (error) {
    console.error('OTP resend error:', error);
    return res.status(500).json({ error: 'Unable to resend OTP right now.' });
  }
});

// POST /api/auth/register (Disabled for unverified direct signup — OTP verification is mandatory)
router.post('/register', async (_req, res) => {
  return res.status(403).json({
    error: 'Email OTP verification is required before account creation. Please complete signup OTP verification.',
    requiresOtp: true,
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const [rawUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!rawUser) {
      const [delLog] = await db
        .select()
        .from(deletedAccountLogs)
        .where(sql`LOWER(${deletedAccountLogs.deletedUserEmail}) = ${email}`)
        .orderBy(desc(deletedAccountLogs.deletedAt))
        .limit(1);
      if (delLog) {
        return res.status(403).json({
          accountDeleted: true,
          deletedReason: delLog.reason,
          deletedAt: delLog.deletedAt,
          deletedEmail: delLog.deletedUserEmail,
          error: `Your account was permanently deleted by an administrator. Reason: ${delLog.reason}`,
        });
      }
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!rawUser.passwordHash || !(await verifyPasswordAsync(password, rawUser.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = await autoUnblockIfExpired(rawUser);

    if (user.status !== 'active') {
      return res.status(403).json(buildBlockedPayload(user));
    }

    const token = createSessionToken({
      uid: user.uid,
      userId: user.id,
      email: user.email,
      role: user.role,
      sv: user.sessionVersion ?? 1,
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
    return res.status(500).json({ error: 'Unable to synchronize social account.' });
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

// POST /api/auth/forgot-password (Sends 15-min hashed reset link via SMTP; prevents account enumeration)
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid registered email address.' });
    }

    if (!isMailerConfigured()) {
      return res.status(503).json({
        error:
          'Email delivery is not configured on the server yet. Missing SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM).',
        missingEmailConfig: true,
      });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (user && user.status === 'active') {
      // Per-email abuse protection: max 6 reset requests in a rolling 15-minute window
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
      const [recentCountRow] = await db
        .select({ value: count() })
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            gt(passwordResetTokens.createdAt, fifteenMinsAgo)
          )
        );

      if (Number(recentCountRow?.value || 0) < 6) {
        const rawToken = generatePasswordResetToken();
        const tokenHash = hashPasswordResetToken(rawToken);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

        const createdRow = await db.transaction(async (tx) => {
          // Invalidate any previously issued unused tokens for this account
          await tx
            .update(passwordResetTokens)
            .set({ usedAt: now })
            .where(
              and(
                eq(passwordResetTokens.userId, user.id),
                isNull(passwordResetTokens.usedAt)
              )
            );

          const [inserted] = await tx
            .insert(passwordResetTokens)
            .values({
              userId: user.id,
              tokenHash,
              expiresAt,
              ipAddress: req.ip || null,
            })
            .returning({ id: passwordResetTokens.id });

          return inserted;
        });

        const baseUrl = getTrustedAppBaseUrl();
        const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
        const emailResult = await sendPasswordResetEmail({
          toEmail: user.email,
          userName: user.name,
          resetUrl,
          expiresMinutes: 15,
        });

        if (!emailResult.sent) {
          await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, createdRow.id));
          return res.status(503).json({
            error: 'Unable to send the password reset email right now. Please try again shortly.',
            emailDeliveryError: true,
          });
        }
      }
    }

    // Consistent response regardless of whether the email exists to prevent account enumeration
    return res.json({
      ok: true,
      message:
        'If an account matches this email address, we have sent a password reset link. Please check your inbox and spam folder (valid for 15 minutes).',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request.' });
  }
});

// POST /api/auth/reset-password/validate
router.post('/reset-password/validate', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token || token.length < 20 || token.length > 256) {
      return res.status(400).json({
        valid: false,
        reason: 'invalid',
        error: 'This password reset link is invalid or incomplete.',
      });
    }

    const tokenHash = hashPasswordResetToken(token);
    const [row] = await db
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
        userEmail: users.email,
        userStatus: users.status,
      })
      .from(passwordResetTokens)
      .innerJoin(users, eq(passwordResetTokens.userId, users.id))
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) {
      return res.status(400).json({
        valid: false,
        reason: 'invalid',
        error: 'This password reset link is invalid or does not exist.',
      });
    }

    if (row.usedAt) {
      return res.status(400).json({
        valid: false,
        reason: 'used',
        error: 'This password reset link has already been used. Please request a new reset link.',
      });
    }

    if (Date.now() > new Date(row.expiresAt).getTime()) {
      return res.status(400).json({
        valid: false,
        reason: 'expired',
        error: 'This password reset link has expired (valid for 15 minutes). Please request a new reset link.',
      });
    }

    if (row.userStatus !== 'active') {
      return res.status(400).json({
        valid: false,
        reason: 'invalid',
        error: 'This account is currently restricted and cannot complete a password reset.',
      });
    }

    return res.json({
      valid: true,
      maskedEmail: maskEmailAddress(row.userEmail),
      expiresAt: new Date(row.expiresAt).toISOString(),
    });
  } catch (error) {
    console.error('Validate reset token error:', error);
    return res.status(500).json({
      valid: false,
      reason: 'error',
      error: 'Unable to validate reset link right now. Please try again.',
    });
  }
});

// POST /api/auth/change-password (Authenticated password rotation)
router.post('/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'New password must be between 8 and 128 characters.' });
    }

    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    if (user.passwordHash) {
      if (!currentPassword || !(await verifyPasswordAsync(currentPassword, user.passwordHash))) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPasswordAsync(newPassword), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    invalidateUserAuthCache(user.id, user.email);

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
    const confirmPassword =
      req.body?.confirmPassword !== undefined ? String(req.body.confirmPassword) : null;

    if (!token || token.length < 20 || token.length > 256) {
      return res.status(400).json({
        reason: 'invalid',
        error: 'This password reset link is invalid or incomplete.',
      });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({
        error: 'Password must be between 8 and 128 characters long.',
      });
    }
    if (confirmPassword !== null && confirmPassword !== newPassword) {
      return res.status(400).json({
        error: 'New password and confirm password do not match.',
      });
    }

    const tokenHash = hashPasswordResetToken(token);
    const newPasswordHash = await hashPasswordAsync(newPassword);

    const resetResult = await db.transaction(async (tx) => {
      const now = new Date();
      const [existing] = await tx
        .select({
          id: passwordResetTokens.id,
          userId: passwordResetTokens.userId,
          expiresAt: passwordResetTokens.expiresAt,
          usedAt: passwordResetTokens.usedAt,
        })
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);

      if (!existing) {
        throw Object.assign(new Error('This password reset link is invalid.'), {
          httpStatus: 400,
          reason: 'invalid',
        });
      }
      if (existing.usedAt) {
        throw Object.assign(
          new Error('This password reset link has already been used. Please request a new reset link.'),
          { httpStatus: 400, reason: 'used' }
        );
      }
      if (new Date(existing.expiresAt).getTime() <= now.getTime()) {
        throw Object.assign(
          new Error('This password reset link has expired. Please request a new reset link.'),
          { httpStatus: 400, reason: 'expired' }
        );
      }

      const [claimed] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.id, existing.id),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now)
          )
        )
        .returning({ id: passwordResetTokens.id, userId: passwordResetTokens.userId });

      if (!claimed) {
        throw Object.assign(
          new Error('This password reset link has already been used or expired.'),
          { httpStatus: 400, reason: 'used' }
        );
      }

      // Invalidate all outstanding password reset tokens for this account
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.userId, claimed.userId),
            isNull(passwordResetTokens.usedAt)
          )
        );

      // Invalidate any legacy unused password_reset rows as well
      await tx
        .update(authTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(authTokens.userId, claimed.userId),
            eq(authTokens.type, 'password_reset'),
            isNull(authTokens.usedAt)
          )
        );

      const [updatedUser] = await tx
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          emailVerified: true,
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: now,
        })
        .where(and(eq(users.id, claimed.userId), eq(users.status, 'active')))
        .returning({ id: users.id, email: users.email });

      if (!updatedUser) {
        throw Object.assign(
          new Error('Account not found or restricted. Cannot reset password.'),
          { httpStatus: 400, reason: 'invalid' }
        );
      }

      await tx.insert(notifications).values({
        userId: updatedUser.id,
        type: 'security',
        title: 'Password reset completed',
        message: 'Your ScholarPress account password was successfully reset.',
        link: '#/dashboard/settings',
      });

      return updatedUser;
    });

    invalidateUserAuthCache(resetResult.id, resetResult.email);

    return res.json({
      ok: true,
      message: 'Your password has been successfully reset!',
    });
  } catch (error) {
    const errObj = error as { httpStatus?: number; reason?: string; message?: string };
    if (errObj?.httpStatus) {
      return res.status(errObj.httpStatus).json({
        reason: errObj.reason || 'invalid',
        error: errObj.message || 'Unable to reset password.',
      });
    }
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
    invalidateUserAuthCache(record.userId);

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
    const allowDevPreview = process.env.NODE_ENV !== 'production' && !isMailerConfigured();
    return res.json({
      message: 'A new verification code has been generated.',
      ...(allowDevPreview ? { verificationTokenPreview: verifyToken } : {}),
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
    invalidateUserAuthCache(req.user!.id, req.user!.email);

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

// POST /api/auth/bootstrap-admin (Strictly locked to the single Primary Super Admin email)
router.post('/bootstrap-admin', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!isSuperAdminEmail(req.user!.email)) {
      return res.status(403).json({
        error: 'Only the Primary Super Admin can grant Administrator access.',
      });
    }

    await db
      .update(users)
      .set({ role: 'admin', status: 'active', updatedAt: new Date() })
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
    const bio = String(req.body?.bio ?? req.body?.description ?? '').trim().slice(0, 800);
    const headline = String(req.body?.headline || '').trim().slice(0, 140);
    const institution = String(req.body?.institution || '').trim().slice(0, 140);
    const state = String(req.body?.state || '').trim().slice(0, 80);
    const country = String(req.body?.country || '').trim().slice(0, 80);
    const occupationRole = String(req.body?.occupationRole || '').trim().slice(0, 80);
    const gender = String(req.body?.gender || '').trim().slice(0, 40);
    const dateOfBirth = String(req.body?.dateOfBirth || '').trim().slice(0, 20);
    const rawLocation = String(req.body?.location || '').trim().slice(0, 100);
    const location = rawLocation || [state, country].filter(Boolean).join(', ');
    const languagePreference = String(req.body?.languagePreference || 'English').trim();
    const websiteUrl = sanitizeSafeUrl(req.body?.websiteUrl, false)?.slice(0, 240) || '';
    const hasPersonalizationPref = req.body?.personalizationEnabled !== undefined;
    const personalizationEnabled = Boolean(req.body?.personalizationEnabled);

    if (name.length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    }

    const userUpdates: Record<string, unknown> = {
      name,
      bio,
      updatedAt: new Date(),
    };

    if (req.body?.username !== undefined) {
      const rawUsername = String(req.body.username || '').trim();
      if (rawUsername) {
        const uCheck = validateUsername(rawUsername);
        if (!uCheck.valid) {
          return res.status(400).json({ error: uCheck.error });
        }
        const taken = await isUsernameTaken(uCheck.normalized, req.user!.id);
        if (taken) {
          return res.status(409).json({
            error: 'This Unique ID is already taken by another user. Each Unique ID can belong to only one user.',
          });
        }
        userUpdates.username = uCheck.normalized;
      }
    }

    await db
      .update(users)
      .set(userUpdates)
      .where(eq(users.id, req.user!.id));
    invalidateUserAuthCache(req.user!.id, req.user!.email);

    await db
      .insert(userProfiles)
      .values({
        userId: req.user!.id,
        headline: headline || occupationRole || null,
        institution: institution || null,
        location: location || null,
        state: state || null,
        country: country || null,
        occupationRole: occupationRole || null,
        gender: gender || null,
        dateOfBirth: dateOfBirth || null,
        profileCompleted: true,
        languagePreference,
        websiteUrl,
        ...(hasPersonalizationPref ? { personalizationEnabled } : {}),
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          headline: headline || occupationRole || null,
          institution: institution || null,
          location: location || null,
          state: state || null,
          country: country || null,
          occupationRole: occupationRole || null,
          gender: gender || null,
          dateOfBirth: dateOfBirth || null,
          profileCompleted: true,
          languagePreference,
          websiteUrl,
          ...(hasPersonalizationPref ? { personalizationEnabled } : {}),
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
    return res.json({ user: envelope, message: 'Profile saved successfully.' });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Unable to update profile.' });
  }
});

// POST /api/auth/activity/heartbeat (Digital activity tracking — NEVER tracks Primary Super Admin)
router.post('/activity/heartbeat', requireAuth, async (req: AuthRequest, res) => {
  try {
    // STRICT SUPER ADMIN PRIVACY SHIELD: Primary Super Admin is never tracked or logged
    if (isSuperAdminEmail(req.user!.email)) {
      return res.json({ ok: true, tracked: false, sessionId: null });
    }

    const userId = req.user!.id;
    const rawPagePath = String(req.body?.pagePath || '/').trim().slice(0, 240) || '/';
    const rawPageTitle = String(req.body?.pageTitle || '').trim().slice(0, 200) || null;
    const rawDelta = Number(req.body?.deltaSeconds || 0);
    const deltaSeconds = Number.isFinite(rawDelta)
      ? Math.max(0, Math.min(60, Math.round(rawDelta)))
      : 0;
    const isNewPage = Boolean(req.body?.isNewPage);
    const rawSessionId = req.body?.sessionId ? Number(req.body.sessionId) : null;

    let validContentId: number | null = null;
    if (req.body?.contentId) {
      const cid = Number(req.body.contentId);
      if (Number.isInteger(cid) && cid > 0) {
        const [exists] = await db
          .select({ id: contents.id })
          .from(contents)
          .where(eq(contents.id, cid))
          .limit(1);
        if (exists) validContentId = exists.id;
      }
    }

    const now = new Date();
    const cal = getIstCalendarDate(now);

    // 1. Upsert daily visit calendar record (Day / Month / Year)
    await db
      .insert(userDailyVisits)
      .values({
        userId,
        visitDate: cal.visitDate,
        visitYear: cal.visitYear,
        visitMonth: cal.visitMonth,
        visitDay: cal.visitDay,
        pageViews: 1,
        totalSeconds: deltaSeconds,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [userDailyVisits.userId, userDailyVisits.visitDate],
        set: {
          pageViews: sql`${userDailyVisits.pageViews} + ${isNewPage ? 1 : 0}`,
          totalSeconds: sql`${userDailyVisits.totalSeconds} + ${deltaSeconds}`,
          lastSeenAt: now,
        },
      });

    // 2. Update active session or start a new session entry
    let activeSessionId: number | null = null;
    if (rawSessionId && Number.isInteger(rawSessionId) && !isNewPage) {
      const [existingSession] = await db
        .select()
        .from(userActivitySessions)
        .where(
          and(
            eq(userActivitySessions.id, rawSessionId),
            eq(userActivitySessions.userId, userId),
            eq(userActivitySessions.pagePath, rawPagePath)
          )
        )
        .orderBy(desc(userActivitySessions.lastSeenAt))
        .limit(1);

      const withinFiveMins =
        existingSession && now.getTime() - new Date(existingSession.lastSeenAt).getTime() <= 5 * 60 * 1000;

      if (existingSession && withinFiveMins) {
        await db
          .update(userActivitySessions)
          .set({
            durationSeconds: sql`${userActivitySessions.durationSeconds} + ${deltaSeconds}`,
            pageTitle: rawPageTitle || existingSession.pageTitle,
            contentId: validContentId ?? existingSession.contentId,
            lastSeenAt: now,
          })
          .where(eq(userActivitySessions.id, existingSession.id));
        activeSessionId = existingSession.id;
      }
    }

    if (!activeSessionId) {
      const [created] = await db
        .insert(userActivitySessions)
        .values({
          userId,
          contentId: validContentId,
          pagePath: rawPagePath,
          pageTitle: rawPageTitle,
          durationSeconds: deltaSeconds,
          visitDate: cal.visitDate,
          startedAt: now,
          lastSeenAt: now,
        })
        .returning({ id: userActivitySessions.id });
      activeSessionId = created.id;
    }

    return res.json({ ok: true, tracked: true, sessionId: activeSessionId });
  } catch (error) {
    console.error('Activity heartbeat error:', error);
    return res.status(500).json({ error: 'Unable to record activity.' });
  }
});

export default router;
