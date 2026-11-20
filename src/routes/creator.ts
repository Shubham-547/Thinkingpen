import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { and, count, desc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminSettings,
  categories,
  commissionRecords,
  contentFiles,
  contents,
  contentTags,
  creatorContentHistory,
  creatorProfiles,
  creatorWallets,
  notifications,
  subjects,
  transactions,
  users,
  withdrawals,
} from '../db/schema.ts';
import { invalidateCatalogCache } from '../lib/cache.ts';
import {
  computeFileSha256,
  createPresignedObjectUrl,
  enqueueThumbnailGeneration,
  getChunksRoot,
  isObjectStorageConfigured,
  validateUploadedFileMagicBytes,
} from '../lib/media.ts';
import {
  ALLOWED_UPLOAD_MIMES,
  createAutoPreview,
  estimateReadingTime,
  getStorageRoot,
  normalizeExternalVideoUrl,
  sanitizeHtml,
  sanitizeSafeUrl,
  slugify,
} from '../lib/security.ts';
import { resolveCommissionRate } from '../lib/payments.ts';
import { requireAuth, requireCreator, type AuthRequest } from '../middleware/auth.ts';

const router = Router();

function parsePositiveInt(val: unknown): number | null {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB max per resumable chunk
});

const storageRoot = getStorageRoot();
if (!fs.existsSync(storageRoot)) {
  fs.mkdirSync(storageRoot, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(storageRoot)) {
        fs.mkdirSync(storageRoot, { recursive: true });
      }
      cb(null, storageRoot);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      const uniqueName = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
      cb(null, uniqueName);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB upper cap; per-MIME caps verified below
    files: 20, // Support up to 20 images/videos/files selected together from gallery
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIMES[file.mimetype]) {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

const INLINE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const inlineImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max per inline editor photo
  },
  fileFilter: (_req, file, cb) => {
    if (!INLINE_IMAGE_MIMES.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WebP, and GIF images are allowed in the editor.'));
      return;
    }
    cb(null, true);
  },
});

function hasValidImageSignature(buf: Buffer, mime: string): boolean {
  if (buf.length < 12) return false;
  if (mime === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mime === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mime === 'image/gif') {
    const header = buf.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (mime === 'image/webp') {
    return (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

const SUPPORTED_CONTENT_TYPES = [
  'Notes',
  'PDF / Documents',
  'Articles',
  'E-books',
  'Video Lectures',
  'Online Tutorials',
  'Poems',
  'Stories',
  'Research Papers',
  'Other Educational Content',
];

const RETENTION_DAYS = 15;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

async function recordCreatorHistory(params: {
  creatorId: number;
  contentId?: number | null;
  action: string;
  contentTitle: string;
  contentType: string;
  authorName?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    await db.insert(creatorContentHistory).values({
      creatorId: params.creatorId,
      contentId: params.contentId ?? null,
      action: params.action,
      contentTitle: params.contentTitle,
      contentType: params.contentType,
      authorName: params.authorName || null,
      details: params.details || {},
    });
  } catch (err) {
    console.warn('Creator history insert skipped:', (err as Error).message);
  }
}

export async function purgeExpiredDeletedContents(): Promise<number> {
  try {
    const now = new Date();
    const expired = await db
      .select()
      .from(contents)
      .where(and(isNotNull(contents.deletedAt), lte(contents.purgeAfter, now)));

    if (expired.length === 0) return 0;

    for (const item of expired) {
      const files = await db.select().from(contentFiles).where(eq(contentFiles.contentId, item.id));
      for (const f of files) {
        if (f.storagePath && f.storagePath !== 'external') {
          const resolved = path.resolve(storageRoot, path.basename(f.storagePath));
          if (resolved.startsWith(storageRoot) && fs.existsSync(resolved)) {
            fs.unlinkSync(resolved);
          }
        }
      }
      await recordCreatorHistory({
        creatorId: item.creatorId,
        contentId: null,
        action: 'auto_purged',
        contentTitle: item.title,
        contentType: item.contentType,
        authorName: item.authorName,
        details: {
          slug: item.slug,
          deletedAt: item.deletedAt,
          purgedAt: now.toISOString(),
          reason: `Automatically permanently removed after ${RETENTION_DAYS}-day recovery window expired.`,
        },
      });
      await db.delete(contents).where(eq(contents.id, item.id));
    }
    invalidateCatalogCache();
    return expired.length;
  } catch (err) {
    console.error('Auto-purge expired deleted contents error:', err);
    return 0;
  }
}

// GET /api/creator/dashboard (Parallelized for fast load)
router.get('/dashboard', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const creatorId = req.user!.id;

    const [
      walletRows,
      profileRows,
      myContents,
      deletedCountRows,
      myCommissions,
      myWithdrawals,
      myTransactions,
      settingsRows,
    ] = await Promise.all([
      db.select().from(creatorWallets).where(eq(creatorWallets.creatorId, creatorId)).limit(1),
      db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, creatorId)).limit(1),
      db
        .select({
          id: contents.id,
          title: contents.title,
          slug: contents.slug,
          authorName: contents.authorName,
          publisherName: contents.publisherName,
          shortDescription: contents.shortDescription,
          coverImageUrl: contents.coverImageUrl,
          contentType: contents.contentType,
          language: contents.language,
          priceInr: contents.priceInr,
          isFree: contents.isFree,
          status: contents.status,
          rejectionReason: contents.rejectionReason,
          customCommissionRate: contents.customCommissionRate,
          viewsCount: contents.viewsCount,
          likesCount: contents.likesCount,
          purchasesCount: contents.purchasesCount,
          avgRating: contents.avgRating,
          reviewsCount: contents.reviewsCount,
          categoryId: contents.categoryId,
          subjectId: contents.subjectId,
          categoryName: categories.name,
          subjectName: subjects.name,
          publishedAt: contents.publishedAt,
          createdAt: contents.createdAt,
          updatedAt: contents.updatedAt,
        })
        .from(contents)
        .leftJoin(categories, eq(contents.categoryId, categories.id))
        .leftJoin(subjects, eq(contents.subjectId, subjects.id))
        .where(and(eq(contents.creatorId, creatorId), isNull(contents.deletedAt)))
        .orderBy(desc(contents.updatedAt)),
      db
        .select({ value: count() })
        .from(contents)
        .where(and(eq(contents.creatorId, creatorId), isNotNull(contents.deletedAt))),
      db
        .select({
          id: commissionRecords.id,
          contentId: commissionRecords.contentId,
          contentTitle: contents.title,
          grossAmountInr: commissionRecords.grossAmountInr,
          commissionRate: commissionRecords.commissionRate,
          commissionSource: commissionRecords.commissionSource,
          platformCommissionInr: commissionRecords.platformCommissionInr,
          creatorEarningsInr: commissionRecords.creatorEarningsInr,
          status: commissionRecords.status,
          createdAt: commissionRecords.createdAt,
        })
        .from(commissionRecords)
        .innerJoin(contents, eq(commissionRecords.contentId, contents.id))
        .where(eq(commissionRecords.creatorId, creatorId))
        .orderBy(desc(commissionRecords.createdAt))
        .limit(100),
      db
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.creatorId, creatorId))
        .orderBy(desc(withdrawals.createdAt)),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.creatorId, creatorId))
        .orderBy(desc(transactions.createdAt))
        .limit(100),
      db.select().from(adminSettings),
    ]);

    let wallet = walletRows[0];
    if (!wallet) {
      [wallet] = await db
        .insert(creatorWallets)
        .values({ creatorId })
        .onConflictDoNothing()
        .returning();
      if (!wallet) {
        [wallet] = await db
          .select()
          .from(creatorWallets)
          .where(eq(creatorWallets.creatorId, creatorId))
          .limit(1);
      }
    }

    const profile = profileRows[0];
    const settingsMap: Record<string, string> = {};
    for (const s of settingsRows) settingsMap[s.key] = s.value;

    const effectiveCommissionRate = profile?.customCommissionRate
      ? Number(profile.customCommissionRate)
      : Number(settingsMap.default_commission_rate || 10);

    const totalViews = myContents.reduce((sum, c) => sum + c.viewsCount, 0);
    const totalLikes = myContents.reduce((sum, c) => sum + c.likesCount, 0);
    const totalPurchases = myContents.reduce((sum, c) => sum + c.purchasesCount, 0);

    return res.json({
      profile: profile || null,
      wallet,
      minWithdrawalInr: Number(settingsMap.min_withdrawal_inr || 100),
      effectiveCommissionRate,
      analytics: {
        totalViews,
        totalLikes,
        totalPurchases,
        publishedCount: myContents.filter((c) => c.status === 'approved').length,
        draftCount: myContents.filter((c) => c.status === 'draft').length,
        pendingCount: myContents.filter((c) => c.status === 'pending').length,
        rejectedCount: myContents.filter((c) => c.status === 'rejected').length,
        deletedCount: Number(deletedCountRows[0]?.value || 0),
      },
      contents: myContents,
      commissions: myCommissions,
      withdrawals: myWithdrawals,
      transactions: myTransactions,
    });
  } catch (error) {
    console.error('Creator dashboard error:', error);
    return res.status(500).json({ error: 'Unable to load creator dashboard.' });
  }
});

// GET /api/creator/history (15-day Recycle Bin + Activity History)
router.get('/history', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    await purgeExpiredDeletedContents();
    const creatorId = req.user!.id;

    const [recoverableItems, historyLogs] = await Promise.all([
      db
        .select({
          id: contents.id,
          title: contents.title,
          slug: contents.slug,
          authorName: contents.authorName,
          publisherName: contents.publisherName,
          shortDescription: contents.shortDescription,
          contentType: contents.contentType,
          language: contents.language,
          priceInr: contents.priceInr,
          isFree: contents.isFree,
          previousStatus: contents.previousStatus,
          viewsCount: contents.viewsCount,
          likesCount: contents.likesCount,
          purchasesCount: contents.purchasesCount,
          categoryName: categories.name,
          deletedAt: contents.deletedAt,
          purgeAfter: contents.purgeAfter,
          createdAt: contents.createdAt,
        })
        .from(contents)
        .leftJoin(categories, eq(contents.categoryId, categories.id))
        .where(and(eq(contents.creatorId, creatorId), isNotNull(contents.deletedAt)))
        .orderBy(desc(contents.deletedAt)),
      db
        .select()
        .from(creatorContentHistory)
        .where(eq(creatorContentHistory.creatorId, creatorId))
        .orderBy(desc(creatorContentHistory.createdAt))
        .limit(150),
    ]);

    return res.json({
      retentionDays: RETENTION_DAYS,
      deletedContents: recoverableItems,
      history: historyLogs,
      recoverableItems,
      historyLogs,
    });
  } catch (error) {
    console.error('Creator history error:', error);
    return res.status(500).json({ error: 'Unable to load creator history.' });
  }
});

// GET /api/creator/contents/:id (for editing own content)
router.get('/contents/:id', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });
    const [item] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!item) return res.status(404).json({ error: 'Content not found.' });
    if (item.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only manage your own content.' });
    }
    const files = await db.select().from(contentFiles).where(eq(contentFiles.contentId, id));
    const tags = await db.select().from(contentTags).where(eq(contentTags.contentId, id));
    const comm = await resolveCommissionRate(id, item.creatorId);
    return res.json({
      content: { ...item, tags: tags.map((t) => t.tag) },
      files,
      commission: comm,
    });
  } catch (error) {
    console.error('Fetch creator content error:', error);
    return res.status(500).json({ error: 'Unable to load content for editing.' });
  }
});

// POST /api/creator/contents
router.post('/contents', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const authorName = String(req.body?.authorName || '').trim().slice(0, 120) || null;
    const publisherName = String(req.body?.publisherName || '').trim().slice(0, 120) || null;
    const shortDescription = String(req.body?.shortDescription || '').trim();
    const bodyHtml = sanitizeHtml(req.body?.bodyHtml || '');
    const customPreview = sanitizeHtml(req.body?.previewHtml || '');
    const coverImageUrl = sanitizeSafeUrl(req.body?.coverImageUrl, true, true);
    const categoryId = req.body?.categoryId ? Number(req.body.categoryId) : null;
    const subjectId = req.body?.subjectId ? Number(req.body.subjectId) : null;
    const language = String(req.body?.language || 'English').trim();
    const contentType = String(req.body?.contentType || 'Notes').trim();
    const isFree = Boolean(req.body?.isFree);
    const rawPrice = Number(req.body?.priceInr || 0);
    const ownershipConfirmed = Boolean(req.body?.ownershipConfirmed);
    const submitAction = req.body?.action === 'submit' ? 'submit' : 'draft';
    const rawExternalVideoUrl = String(req.body?.externalVideoUrl || '').trim();
    const externalVideoUrl = rawExternalVideoUrl
      ? normalizeExternalVideoUrl(rawExternalVideoUrl) || ''
      : '';
    if (rawExternalVideoUrl && !externalVideoUrl) {
      return res.status(400).json({
        error: 'Please enter a valid YouTube share link (youtu.be/... or youtube.com/watch?v=...), Vimeo link, or HTTPS video embed URL.',
      });
    }
    const tagsInput: string[] = Array.isArray(req.body?.tags)
      ? req.body.tags
      : String(req.body?.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

    if (title.length < 4 || title.length > 180) {
      return res.status(400).json({ error: 'Title must be between 4 and 180 characters.' });
    }
    if (shortDescription.length < 15) {
      return res.status(400).json({ error: 'Short description must be at least 15 characters.' });
    }
    if (!SUPPORTED_CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'Invalid content type selected.' });
    }
    if (!isFree && (Number.isNaN(rawPrice) || rawPrice < 10 || rawPrice > 50000)) {
      return res.status(400).json({ error: 'Paid content price must be between ₹10 and ₹50,000.' });
    }
    if (submitAction === 'submit' && !ownershipConfirmed) {
      return res.status(400).json({
        error: 'You must confirm copyright ownership or publishing permission before submitting.',
      });
    }

    const [approvalSetting] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'require_content_approval'))
      .limit(1);

    const requireApproval = approvalSetting?.value !== 'false';
    let status: string = 'draft';
    let publishedAt: Date | null = null;
    if (submitAction === 'submit') {
      if (!requireApproval || req.user!.role === 'admin') {
        status = 'approved';
        publishedAt = new Date();
      } else {
        status = 'pending';
      }
    }

    const finalPrice = isFree ? '0.00' : rawPrice.toFixed(2);
    const previewHtml = customPreview || createAutoPreview(bodyHtml || shortDescription);
    const readingTimeMins = estimateReadingTime(bodyHtml || shortDescription);

    const [created] = await db
      .insert(contents)
      .values({
        creatorId: req.user!.id,
        title,
        slug: slugify(title),
        authorName,
        publisherName,
        shortDescription,
        bodyHtml,
        previewHtml,
        coverImageUrl,
        categoryId,
        subjectId,
        language,
        contentType,
        priceInr: finalPrice,
        isFree,
        status,
        ownershipConfirmed,
        readingTimeMins,
        publishedAt,
      })
      .returning();

    if (tagsInput.length > 0) {
      const uniqueTags = Array.from(
        new Set(tagsInput.map((t) => t.toLowerCase().slice(0, 40)))
      ).slice(0, 10);
      await db
        .insert(contentTags)
        .values(uniqueTags.map((tag) => ({ contentId: created.id, tag })));
    }

    if (externalVideoUrl && /^https?:\/\//i.test(externalVideoUrl)) {
      await db.insert(contentFiles).values({
        contentId: created.id,
        fileType: 'video',
        originalName: `${title} - Authorized Video Stream`,
        storagePath: 'external',
        mimeType: 'video/external',
        sizeBytes: 0,
        isPreview: false,
        externalVideoUrl,
      });
    }

    if (status === 'pending') {
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'));
      if (admins.length > 0) {
        await db.insert(notifications).values(
          admins.map((a) => ({
            userId: a.id,
            type: 'content_submission',
            title: 'New content awaiting approval',
            message: `${req.user!.name} submitted "${title}" (${contentType}) for review.`,
            link: '#/admin/approvals',
          }))
        );
      }
    }

    await recordCreatorHistory({
      creatorId: req.user!.id,
      contentId: created.id,
      action: 'created',
      contentTitle: created.title,
      contentType: created.contentType,
      authorName: created.authorName,
      details: {
        slug: created.slug,
        status: created.status,
        publisherName: created.publisherName,
        isFree: created.isFree,
        priceInr: created.priceInr,
        language: created.language,
      },
    });
    invalidateCatalogCache();

    return res.status(201).json({
      content: created,
      message:
        status === 'approved'
          ? 'Content published live!'
          : status === 'pending'
          ? 'Content submitted for administrator approval.'
          : 'Draft saved.',
    });
  } catch (error) {
    console.error('Create content error:', error);
    return res.status(500).json({ error: 'Unable to save content.' });
  }
});

// PUT /api/creator/contents/:id
router.put('/contents/:id', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });
    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own content.' });
    }

    const title = String(req.body?.title || existing.title).trim();
    const authorName =
      req.body?.authorName !== undefined
        ? String(req.body.authorName || '').trim().slice(0, 120) || null
        : existing.authorName;
    const publisherName =
      req.body?.publisherName !== undefined
        ? String(req.body.publisherName || '').trim().slice(0, 120) || null
        : existing.publisherName;
    const shortDescription = String(req.body?.shortDescription || existing.shortDescription).trim();
    const bodyHtml =
      req.body?.bodyHtml !== undefined ? sanitizeHtml(req.body.bodyHtml) : existing.bodyHtml;
    const previewHtml =
      req.body?.previewHtml !== undefined
        ? sanitizeHtml(req.body.previewHtml) || createAutoPreview(bodyHtml || shortDescription)
        : existing.previewHtml;
    const coverImageUrl =
      req.body?.coverImageUrl !== undefined
        ? sanitizeSafeUrl(req.body.coverImageUrl, true, true)
        : existing.coverImageUrl;
    const categoryId =
      req.body?.categoryId !== undefined
        ? req.body.categoryId
          ? Number(req.body.categoryId)
          : null
        : existing.categoryId;
    const subjectId =
      req.body?.subjectId !== undefined
        ? req.body.subjectId
          ? Number(req.body.subjectId)
          : null
        : existing.subjectId;
    const language = String(req.body?.language || existing.language).trim();
    const contentType = String(req.body?.contentType || existing.contentType).trim();
    const isFree = req.body?.isFree !== undefined ? Boolean(req.body.isFree) : existing.isFree;
    const rawPrice =
      req.body?.priceInr !== undefined ? Number(req.body.priceInr) : Number(existing.priceInr);
    const ownershipConfirmed =
      req.body?.ownershipConfirmed !== undefined
        ? Boolean(req.body.ownershipConfirmed)
        : existing.ownershipConfirmed;

    if (!isFree && (Number.isNaN(rawPrice) || rawPrice < 10 || rawPrice > 50000)) {
      return res.status(400).json({ error: 'Paid content price must be between ₹10 and ₹50,000.' });
    }

    let nextStatus = existing.status;
    let publishedAt = existing.publishedAt;
    if (req.body?.action === 'submit') {
      if (!ownershipConfirmed) {
        return res.status(400).json({
          error: 'Please confirm copyright ownership before submitting for publication.',
        });
      }
      const [approvalSetting] = await db
        .select()
        .from(adminSettings)
        .where(eq(adminSettings.key, 'require_content_approval'))
        .limit(1);
      const requireApproval = approvalSetting?.value !== 'false';
      if (!requireApproval || req.user!.role === 'admin') {
        nextStatus = 'approved';
        publishedAt = publishedAt || new Date();
      } else {
        nextStatus = 'pending';
      }
    } else if (req.body?.action === 'draft') {
      nextStatus = 'draft';
    }

    const [updated] = await db
      .update(contents)
      .set({
        title,
        authorName,
        publisherName,
        shortDescription,
        bodyHtml,
        previewHtml,
        coverImageUrl,
        categoryId,
        subjectId,
        language,
        contentType,
        isFree,
        priceInr: isFree ? '0.00' : rawPrice.toFixed(2),
        ownershipConfirmed,
        status: nextStatus,
        publishedAt,
        readingTimeMins: estimateReadingTime(bodyHtml || shortDescription),
        updatedAt: new Date(),
      })
      .where(eq(contents.id, id))
      .returning();

    if (req.body?.tags !== undefined) {
      const tagsInput: string[] = Array.isArray(req.body.tags)
        ? req.body.tags
        : String(req.body.tags || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
      await db.delete(contentTags).where(eq(contentTags.contentId, id));
      if (tagsInput.length > 0) {
        const uniqueTags = Array.from(
          new Set(tagsInput.map((t) => t.toLowerCase().slice(0, 40)))
        ).slice(0, 10);
        await db.insert(contentTags).values(uniqueTags.map((tag) => ({ contentId: id, tag })));
      }
    }

    if (req.body?.externalVideoUrl !== undefined) {
      const rawExternalVideoUrl = String(req.body.externalVideoUrl || '').trim();
      const normalizedVideoUrl = rawExternalVideoUrl
        ? normalizeExternalVideoUrl(rawExternalVideoUrl) || ''
        : '';
      if (rawExternalVideoUrl && !normalizedVideoUrl) {
        return res.status(400).json({
          error: 'Please enter a valid YouTube share link (youtu.be/... or youtube.com/watch?v=...), Vimeo link, or HTTPS video embed URL.',
        });
      }

      const existingExternalVideos = await db
        .select()
        .from(contentFiles)
        .where(
          and(
            eq(contentFiles.contentId, id),
            eq(contentFiles.fileType, 'video'),
            eq(contentFiles.storagePath, 'external')
          )
        );

      if (normalizedVideoUrl) {
        if (existingExternalVideos.length > 0) {
          await db
            .update(contentFiles)
            .set({
              externalVideoUrl: normalizedVideoUrl,
              originalName: `${title} - Video Lecture`,
            })
            .where(eq(contentFiles.id, existingExternalVideos[0].id));
        } else {
          await db.insert(contentFiles).values({
            contentId: id,
            fileType: 'video',
            originalName: `${title} - Video Lecture`,
            storagePath: 'external',
            mimeType: 'video/external',
            sizeBytes: 0,
            isPreview: false,
            externalVideoUrl: normalizedVideoUrl,
          });
        }
      } else if (existingExternalVideos.length > 0) {
        for (const ev of existingExternalVideos) {
          await db.delete(contentFiles).where(eq(contentFiles.id, ev.id));
        }
      }
    }

    await recordCreatorHistory({
      creatorId: existing.creatorId,
      contentId: updated.id,
      action: 'updated',
      contentTitle: updated.title,
      contentType: updated.contentType,
      authorName: updated.authorName,
      details: {
        slug: updated.slug,
        status: updated.status,
        publisherName: updated.publisherName,
        isFree: updated.isFree,
        priceInr: updated.priceInr,
      },
    });
    invalidateCatalogCache();

    return res.json({ content: updated, message: 'Publication updated.' });
  } catch (error) {
    console.error('Update content error:', error);
    return res.status(500).json({ error: 'Unable to update content.' });
  }
});

// DELETE /api/creator/contents/:id (Soft-delete into 15-day Recycle Bin & Creator History)
router.delete('/contents/:id', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });
    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own content.' });
    }
    if (existing.deletedAt) {
      return res.json({
        deleted: true,
        softDeleted: true,
        message: 'Content is already in your 15-day recovery bin.',
      });
    }

    const now = new Date();
    const purgeAfter = new Date(now.getTime() + RETENTION_MS);

    await db
      .update(contents)
      .set({
        previousStatus: existing.status,
        status: 'deleted',
        deletedAt: now,
        deletedBy: req.user!.id,
        purgeAfter,
        updatedAt: now,
      })
      .where(eq(contents.id, id));

    await recordCreatorHistory({
      creatorId: existing.creatorId,
      contentId: existing.id,
      action: 'deleted',
      contentTitle: existing.title,
      contentType: existing.contentType,
      authorName: existing.authorName,
      details: {
        slug: existing.slug,
        publisherName: existing.publisherName,
        previousStatus: existing.status,
        priceInr: existing.priceInr,
        isFree: existing.isFree,
        viewsCount: existing.viewsCount,
        purchasesCount: existing.purchasesCount,
        deletedAt: now.toISOString(),
        purgeAfter: purgeAfter.toISOString(),
        retentionDays: RETENTION_DAYS,
      },
    });
    invalidateCatalogCache();

    return res.json({
      deleted: true,
      softDeleted: true,
      deletedAt: now.toISOString(),
      purgeAfter: purgeAfter.toISOString(),
      message: `Moved to History & Recovery Bin. You can recover this content anytime within ${RETENTION_DAYS} days.`,
    });
  } catch (error) {
    console.error('Delete content error:', error);
    return res.status(500).json({ error: 'Unable to delete content.' });
  }
});

// POST /api/creator/contents/:id/recover (Restore soft-deleted content within 15 days)
router.post('/contents/:id/recover', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });
    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found or already permanently purged.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only recover your own content.' });
    }
    if (!existing.deletedAt) {
      return res.status(400).json({ error: 'This content is already active.' });
    }
    if (existing.purgeAfter && new Date(existing.purgeAfter).getTime() <= Date.now()) {
      await purgeExpiredDeletedContents();
      return res.status(410).json({ error: 'The 15-day recovery period for this content has expired.' });
    }

    const restoredStatus =
      existing.previousStatus && existing.previousStatus !== 'deleted'
        ? existing.previousStatus
        : 'draft';

    const [recovered] = await db
      .update(contents)
      .set({
        status: restoredStatus,
        previousStatus: null,
        deletedAt: null,
        deletedBy: null,
        purgeAfter: null,
        updatedAt: new Date(),
      })
      .where(eq(contents.id, id))
      .returning();

    await recordCreatorHistory({
      creatorId: existing.creatorId,
      contentId: existing.id,
      action: 'recovered',
      contentTitle: existing.title,
      contentType: existing.contentType,
      authorName: existing.authorName,
      details: {
        slug: existing.slug,
        restoredStatus,
        originallyDeletedAt: existing.deletedAt,
        recoveredAt: new Date().toISOString(),
      },
    });
    invalidateCatalogCache();

    return res.json({
      recovered: true,
      content: recovered,
      message: `"${existing.title}" has been recovered and restored as ${restoredStatus}.`,
    });
  } catch (error) {
    console.error('Recover content error:', error);
    return res.status(500).json({ error: 'Unable to recover content.' });
  }
});

// DELETE /api/creator/contents/:id/permanent (Optional immediate permanent wipe from Recycle Bin)
router.delete('/contents/:id/permanent', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });
    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only permanently delete your own content.' });
    }

    const files = await db.select().from(contentFiles).where(eq(contentFiles.contentId, id));
    for (const f of files) {
      if (f.storagePath && f.storagePath !== 'external') {
        const resolved = path.resolve(storageRoot, path.basename(f.storagePath));
        if (resolved.startsWith(storageRoot) && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      }
    }

    await recordCreatorHistory({
      creatorId: existing.creatorId,
      contentId: null,
      action: 'permanently_deleted',
      contentTitle: existing.title,
      contentType: existing.contentType,
      authorName: existing.authorName,
      details: {
        slug: existing.slug,
        originallyDeletedAt: existing.deletedAt,
        permanentlyDeletedAt: new Date().toISOString(),
      },
    });

    await db.delete(contents).where(eq(contents.id, id));
    invalidateCatalogCache();
    return res.json({
      deleted: true,
      permanent: true,
      permanentlyDeleted: true,
      message: 'Content permanently erased.',
    });
  } catch (error) {
    console.error('Permanent delete content error:', error);
    return res.status(500).json({ error: 'Unable to permanently delete content.' });
  }
});

// POST /api/creator/uploads/presign (Direct-to-S3/R2/GCS presigned upload or resumable chunked fallback + duplicate check)
router.post('/uploads/presign', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const contentId = parsePositiveInt(req.body?.contentId);
    const fileName = String(req.body?.fileName || '').trim().slice(0, 180);
    const mimeType = String(req.body?.mimeType || '').trim().toLowerCase();
    const sizeBytes = Number(req.body?.sizeBytes || 0);
    const sha256Hash = String(req.body?.sha256Hash || '').trim().toLowerCase();

    if (!contentId || !fileName || !mimeType || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return res.status(400).json({ error: 'Invalid upload initialization parameters.' });
    }

    const rule = ALLOWED_UPLOAD_MIMES[mimeType];
    if (!rule) {
      return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
    }
    if (sizeBytes > rule.maxBytes) {
      return res.status(400).json({
        error: `File exceeds maximum size limit (${Math.round(rule.maxBytes / (1024 * 1024))} MB) for ${mimeType}.`,
      });
    }

    const [content] = await db.select().from(contents).where(eq(contents.id, contentId)).limit(1);
    if (!content) return res.status(404).json({ error: 'Content item not found.' });
    if (content.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to upload files to this content.' });
    }

    // Duplicate upload prevention using SHA-256 hash
    if (/^[a-f0-9]{64}$/.test(sha256Hash)) {
      const [existing] = await db
        .select()
        .from(contentFiles)
        .where(and(eq(contentFiles.contentId, contentId), eq(contentFiles.sha256Hash, sha256Hash)))
        .limit(1);
      if (existing) {
        if (req.body?.setAsCover) {
          await db
            .update(contents)
            .set({ coverImageUrl: `/api/catalog/files/${existing.id}`, updatedAt: new Date() })
            .where(eq(contents.id, contentId));
          invalidateCatalogCache();
        }
        return res.json({
          mode: 'duplicate',
          duplicate: true,
          file: { ...existing, accessUrl: `/api/catalog/files/${existing.id}` },
        });
      }
    }

    const ext = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
    const uploadId = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}`;

    if (isObjectStorageConfigured()) {
      const objectKey = `contents/${contentId}/${uploadId}${ext}`;
      const signed = createPresignedObjectUrl({
        method: 'PUT',
        objectKey,
        contentType: mimeType,
        expiresInSeconds: 900,
      });
      if (signed) {
        return res.json({
          mode: 'presigned',
          uploadId,
          objectKey,
          uploadUrl: signed.url,
          publicUrl: signed.publicUrl,
          expiresAt: signed.expiresAt,
          contentType: mimeType,
        });
      }
    }

    return res.json({
      mode: 'chunked',
      uploadId,
      chunkSizeBytes: 2 * 1024 * 1024, // 2 MB chunks for resilient mobile uploads
    });
  } catch (error) {
    console.error('Presign upload error:', error);
    return res.status(500).json({ error: 'Unable to initialize upload.' });
  }
});

// POST /api/creator/uploads/complete (Register completed direct-to-S3/R2/GCS object upload)
router.post('/uploads/complete', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const contentId = parsePositiveInt(req.body?.contentId);
    const objectKey = String(req.body?.objectKey || '').trim();
    const originalName = String(req.body?.originalName || 'file').trim().slice(0, 180);
    const mimeType = String(req.body?.mimeType || '').trim().toLowerCase();
    const sizeBytes = Number(req.body?.sizeBytes || 0);
    const sha256Hash = /^[a-f0-9]{64}$/.test(String(req.body?.sha256Hash || ''))
      ? String(req.body.sha256Hash)
      : null;

    if (!contentId || !objectKey || !objectKey.startsWith(`contents/${contentId}/`) || objectKey.includes('..')) {
      return res.status(400).json({ error: 'Invalid completed object reference.' });
    }
    const rule = ALLOWED_UPLOAD_MIMES[mimeType];
    if (!rule || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > rule.maxBytes) {
      return res.status(400).json({ error: 'Invalid file type or size.' });
    }

    const [content] = await db.select().from(contents).where(eq(contents.id, contentId)).limit(1);
    if (!content) return res.status(404).json({ error: 'Content item not found.' });
    if (content.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const setAsCover = Boolean(req.body?.setAsCover);
    const isPreview = Boolean(req.body?.isPreview) || setAsCover || rule.fileType === 'cover';

    const [savedFile] = await db
      .insert(contentFiles)
      .values({
        contentId,
        fileType: setAsCover ? 'cover' : rule.fileType,
        originalName,
        storagePath: objectKey,
        storageProvider: 's3',
        storageKey: objectKey,
        sha256Hash,
        mimeType,
        sizeBytes,
        isPreview,
      })
      .returning();

    if (setAsCover) {
      await db
        .update(contents)
        .set({ coverImageUrl: `/api/catalog/files/${savedFile.id}`, updatedAt: new Date() })
        .where(eq(contents.id, contentId));
      invalidateCatalogCache();
    }

    return res.status(201).json({
      file: { ...savedFile, accessUrl: `/api/catalog/files/${savedFile.id}` },
    });
  } catch (error) {
    console.error('Complete presigned upload error:', error);
    return res.status(500).json({ error: 'Unable to finalize direct upload.' });
  }
});

// POST /api/creator/uploads/chunk (Resumable chunk receiver for large files on local/persistent storage)
router.post(
  '/uploads/chunk',
  requireAuth,
  requireCreator,
  chunkUpload.single('chunk'),
  async (req: AuthRequest, res) => {
    try {
      const uploadId = String(req.body?.uploadId || '').trim();
      const chunkIndex = Number(req.body?.chunkIndex);
      if (!/^[a-zA-Z0-9-]{8,64}$/.test(uploadId) || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 100) {
        return res.status(400).json({ error: 'Invalid chunk parameters.' });
      }
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'Empty upload chunk.' });
      }

      const dir = path.join(getChunksRoot(), `${req.user!.id}_${uploadId}`);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, `${String(chunkIndex).padStart(5, '0')}.part`), req.file.buffer);
      return res.json({ received: true, chunkIndex });
    } catch (error) {
      console.error('Chunk upload error:', error);
      return res.status(500).json({ error: 'Unable to store upload chunk.' });
    }
  }
);

// POST /api/creator/uploads/chunk/complete (Assemble chunks, validate magic bytes + SHA-256, enqueue thumbnail)
router.post('/uploads/chunk/complete', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  const uploadId = String(req.body?.uploadId || '').trim();
  const dir = path.join(getChunksRoot(), `${req.user!.id}_${uploadId}`);
  const cleanupDir = () => {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  };

  try {
    const contentId = parsePositiveInt(req.body?.contentId);
    const totalChunks = Number(req.body?.totalChunks);
    const originalName = String(req.body?.originalName || 'upload').trim().slice(0, 180);
    const mimeType = String(req.body?.mimeType || '').trim().toLowerCase();

    if (
      !contentId ||
      !/^[a-zA-Z0-9-]{8,64}$/.test(uploadId) ||
      !Number.isInteger(totalChunks) ||
      totalChunks <= 0 ||
      totalChunks > 100
    ) {
      cleanupDir();
      return res.status(400).json({ error: 'Invalid chunk assembly parameters.' });
    }

    const rule = ALLOWED_UPLOAD_MIMES[mimeType];
    if (!rule) {
      cleanupDir();
      return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
    }

    const [content] = await db.select().from(contents).where(eq(contents.id, contentId)).limit(1);
    if (!content) {
      cleanupDir();
      return res.status(404).json({ error: 'Content item not found.' });
    }
    if (content.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      cleanupDir();
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
    const finalName = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
    const finalPath = path.join(storageRoot, finalName);

    let totalSize = 0;
    const ws = fs.createWriteStream(finalPath);
    try {
      for (let i = 0; i < totalChunks; i += 1) {
        const partPath = path.join(dir, `${String(i).padStart(5, '0')}.part`);
        if (!fs.existsSync(partPath)) {
          throw new Error(`Missing chunk ${i}`);
        }
        const chunkBuf = fs.readFileSync(partPath);
        totalSize += chunkBuf.length;
        if (totalSize > rule.maxBytes) {
          throw new Error('File exceeds maximum allowed size.');
        }
        ws.write(chunkBuf);
      }
      await new Promise<void>((resolve, reject) => {
        ws.on('finish', resolve);
        ws.on('error', reject);
        ws.end();
      });
    } catch (assembleErr) {
      ws.destroy();
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      cleanupDir();
      return res.status(400).json({
        error: assembleErr instanceof Error ? assembleErr.message : 'Chunk assembly failed.',
      });
    }
    cleanupDir();

    const sigCheck = await validateUploadedFileMagicBytes(finalPath, mimeType);
    if (!sigCheck.valid) {
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      return res.status(400).json({
        error: sigCheck.reason || 'Uploaded file failed binary content verification.',
      });
    }

    const sha256Hash = await computeFileSha256(finalPath);
    const [existingDup] = await db
      .select()
      .from(contentFiles)
      .where(and(eq(contentFiles.contentId, contentId), eq(contentFiles.sha256Hash, sha256Hash)))
      .limit(1);

    const setAsCover = Boolean(req.body?.setAsCover);
    if (existingDup) {
      if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      if (setAsCover) {
        await db
          .update(contents)
          .set({ coverImageUrl: `/api/catalog/files/${existingDup.id}`, updatedAt: new Date() })
          .where(eq(contents.id, contentId));
        invalidateCatalogCache();
      }
      return res.status(200).json({
        duplicate: true,
        file: { ...existingDup, accessUrl: `/api/catalog/files/${existingDup.id}` },
      });
    }

    const isPreview = Boolean(req.body?.isPreview) || setAsCover || rule.fileType === 'cover';
    const [savedFile] = await db
      .insert(contentFiles)
      .values({
        contentId,
        fileType: setAsCover ? 'cover' : rule.fileType,
        originalName,
        storagePath: finalName,
        storageProvider: 'local',
        sha256Hash,
        mimeType,
        sizeBytes: totalSize,
        isPreview,
      })
      .returning();

    enqueueThumbnailGeneration(savedFile.id, finalName, mimeType);

    if (setAsCover) {
      await db
        .update(contents)
        .set({ coverImageUrl: `/api/catalog/files/${savedFile.id}`, updatedAt: new Date() })
        .where(eq(contents.id, contentId));
      invalidateCatalogCache();
    }

    return res.status(201).json({
      file: { ...savedFile, accessUrl: `/api/catalog/files/${savedFile.id}` },
    });
  } catch (error) {
    cleanupDir();
    console.error('Complete chunk upload error:', error);
    return res.status(500).json({ error: 'Unable to finalize chunked upload.' });
  }
});

// POST /api/creator/contents/:id/files (Secure file upload with magic-byte validation, SHA-256 deduplication, async thumbnail job)
router.post(
  '/contents/:id/files',
  requireAuth,
  requireCreator,
  upload.single('file'),
  async (req: AuthRequest, res) => {
    try {
      const contentId = parsePositiveInt(req.params.id);
      if (!contentId) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid content ID.' });
      }
      const [content] = await db
        .select()
        .from(contents)
        .where(eq(contents.id, contentId))
        .limit(1);

      if (!content) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Content item not found.' });
      }
      if (content.creatorId !== req.user!.id && req.user!.role !== 'admin') {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Unauthorized to upload files to this content.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file attached.' });
      }

      const rule = ALLOWED_UPLOAD_MIMES[req.file.mimetype];
      if (!rule || req.file.size > rule.maxBytes) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error: `File exceeds maximum size limit for ${req.file.mimetype}.`,
        });
      }

      // Verify actual binary magic bytes (blocks spoofed MIME headers)
      const sigCheck = await validateUploadedFileMagicBytes(req.file.path, req.file.mimetype);
      if (!sigCheck.valid) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error: sigCheck.reason || 'Uploaded file failed binary content verification.',
        });
      }

      // Compute streaming SHA-256 hash to prevent duplicate uploads for the same publication
      const sha256Hash = await computeFileSha256(req.file.path);
      const [existingDup] = await db
        .select()
        .from(contentFiles)
        .where(and(eq(contentFiles.contentId, contentId), eq(contentFiles.sha256Hash, sha256Hash)))
        .limit(1);

      if (existingDup) {
        fs.unlinkSync(req.file.path);
        if (req.body?.setAsCover === 'true') {
          await db
            .update(contents)
            .set({ coverImageUrl: `/api/catalog/files/${existingDup.id}`, updatedAt: new Date() })
            .where(eq(contents.id, contentId));
          invalidateCatalogCache();
        }
        return res.status(200).json({
          duplicate: true,
          file: {
            ...existingDup,
            accessUrl: `/api/catalog/files/${existingDup.id}`,
          },
        });
      }

      const isPreview = req.body?.isPreview === 'true' || rule.fileType === 'cover';

      const [savedFile] = await db
        .insert(contentFiles)
        .values({
          contentId,
          fileType: req.body?.setAsCover === 'true' ? 'cover' : rule.fileType,
          originalName: req.file.originalname,
          storagePath: req.file.filename,
          storageProvider: 'local',
          sha256Hash,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          isPreview,
        })
        .returning();

      // Non-blocking background thumbnail generation (480w WebP + AVIF)
      enqueueThumbnailGeneration(savedFile.id, req.file.filename, req.file.mimetype);

      if (req.body?.setAsCover === 'true') {
        await db
          .update(contents)
          .set({ coverImageUrl: `/api/catalog/files/${savedFile.id}`, updatedAt: new Date() })
          .where(eq(contents.id, contentId));
        invalidateCatalogCache();
      }

      return res.status(201).json({
        file: {
          ...savedFile,
          accessUrl: `/api/catalog/files/${savedFile.id}`,
        },
      });
    } catch (error) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {}
      }
      console.error('File upload error:', error);
      return res.status(500).json({ error: 'File upload failed.' });
    }
  }
);

// POST /api/creator/contents/:id/files/batch (Upload up to 20 images/videos/PDFs with magic-byte checks, deduplication, async thumbnails)
router.post(
  '/contents/:id/files/batch',
  requireAuth,
  requireCreator,
  upload.array('files', 20),
  async (req: AuthRequest, res) => {
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const cleanupUploaded = () => {
      for (const f of uploadedFiles) {
        if (f?.path && fs.existsSync(f.path)) {
          try {
            fs.unlinkSync(f.path);
          } catch {}
        }
      }
    };

    try {
      const contentId = parsePositiveInt(req.params.id);
      if (!contentId) {
        cleanupUploaded();
        return res.status(400).json({ error: 'Invalid content ID.' });
      }
      const [content] = await db
        .select()
        .from(contents)
        .where(eq(contents.id, contentId))
        .limit(1);

      if (!content) {
        cleanupUploaded();
        return res.status(404).json({ error: 'Content item not found.' });
      }
      if (content.creatorId !== req.user!.id && req.user!.role !== 'admin') {
        cleanupUploaded();
        return res.status(403).json({ error: 'Unauthorized to upload files to this content.' });
      }
      if (!uploadedFiles.length) {
        return res.status(400).json({ error: 'Please select at least 1 file (up to 20 images/videos/files).' });
      }

      const isPreview = req.body?.isPreview === 'true';
      const savedList = [];

      // Validate size and binary magic-byte signatures for every file before inserting any row
      for (const f of uploadedFiles) {
        const rule = ALLOWED_UPLOAD_MIMES[f.mimetype];
        if (!rule || f.size > rule.maxBytes) {
          cleanupUploaded();
          return res.status(400).json({
            error: `"${f.originalname}" exceeds size limit or unsupported format (${f.mimetype}).`,
          });
        }
        const sigCheck = await validateUploadedFileMagicBytes(f.path, f.mimetype);
        if (!sigCheck.valid) {
          cleanupUploaded();
          return res.status(400).json({
            error: `"${f.originalname}" failed security verification: ${sigCheck.reason || 'invalid file signature'}.`,
          });
        }
      }

      for (const f of uploadedFiles) {
        const rule = ALLOWED_UPLOAD_MIMES[f.mimetype];
        const sha256Hash = await computeFileSha256(f.path);
        const [existingDup] = await db
          .select()
          .from(contentFiles)
          .where(and(eq(contentFiles.contentId, contentId), eq(contentFiles.sha256Hash, sha256Hash)))
          .limit(1);

        if (existingDup) {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
          savedList.push({
            ...existingDup,
            duplicate: true,
            accessUrl: `/api/catalog/files/${existingDup.id}`,
          });
          continue;
        }

        const [savedFile] = await db
          .insert(contentFiles)
          .values({
            contentId,
            fileType: rule.fileType,
            originalName: f.originalname,
            storagePath: f.filename,
            storageProvider: 'local',
            sha256Hash,
            mimeType: f.mimetype,
            sizeBytes: f.size,
            isPreview,
          })
          .returning();

        enqueueThumbnailGeneration(savedFile.id, f.filename, f.mimetype);
        savedList.push({
          ...savedFile,
          accessUrl: `/api/catalog/files/${savedFile.id}`,
        });
      }

      return res.status(201).json({
        count: savedList.length,
        files: savedList,
        message: `${savedList.length} file${savedList.length === 1 ? '' : 's'} uploaded successfully.`,
      });
    } catch (error) {
      cleanupUploaded();
      console.error('Batch file upload error:', error);
      return res.status(500).json({ error: 'Batch gallery upload failed.' });
    }
  }
);

// POST /api/creator/editor-image (Inline photo upload for Rich-Text Editor, persistent across restarts)
router.post(
  '/editor-image',
  requireAuth,
  requireCreator,
  inlineImageUpload.single('image'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Please select an image file to upload.' });
      }
      const { mimetype, buffer, originalname, size } = req.file;
      if (!INLINE_IMAGE_MIMES.has(mimetype) || !hasValidImageSignature(buffer, mimetype)) {
        return res.status(400).json({
          error: 'Invalid image file. Please upload a valid JPG, PNG, WebP, or GIF photo.',
        });
      }
      const base64 = buffer.toString('base64');
      const alt = path
        .basename(originalname, path.extname(originalname))
        .replace(/[^a-zA-Z0-9 _-]/g, ' ')
        .trim()
        .slice(0, 80) || 'Illustration';

      return res.status(201).json({
        url: `data:${mimetype};base64,${base64}`,
        alt,
        sizeBytes: size,
      });
    } catch (error) {
      console.error('Editor inline image upload error:', error);
      return res.status(500).json({ error: 'Failed to process uploaded photo.' });
    }
  }
);

// DELETE /api/creator/files/:fileId
router.delete('/files/:fileId', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const fileId = parsePositiveInt(req.params.fileId);
    if (!fileId) return res.status(400).json({ error: 'Invalid file ID.' });
    const [file] = await db
      .select()
      .from(contentFiles)
      .where(eq(contentFiles.id, fileId))
      .limit(1);
    if (!file) return res.status(404).json({ error: 'File not found.' });

    const [content] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, file.contentId))
      .limit(1);
    if (!content || (content.creatorId !== req.user!.id && req.user!.role !== 'admin')) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    if (file.storagePath && file.storagePath !== 'external') {
      const resolved = path.resolve(storageRoot, path.basename(file.storagePath));
      if (resolved.startsWith(storageRoot) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    }
    await db.delete(contentFiles).where(eq(contentFiles.id, fileId));
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Delete file error:', error);
    return res.status(500).json({ error: 'Unable to delete file.' });
  }
});

// PUT /api/creator/payout-details
router.put('/payout-details', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const payoutMethod = req.body?.payoutMethod === 'bank_transfer' ? 'bank_transfer' : 'upi';
    const upiId = String(req.body?.upiId || '').trim();
    const accountHolder = String(req.body?.accountHolder || '').trim();
    const accountNumber = String(req.body?.accountNumber || '').trim();
    const ifscCode = String(req.body?.ifscCode || '').trim().toUpperCase();
    const bankName = String(req.body?.bankName || '').trim();

    if (payoutMethod === 'upi' && !upiId.includes('@')) {
      return res.status(400).json({ error: 'Please provide a valid UPI ID (e.g., name@upi).' });
    }
    if (payoutMethod === 'bank_transfer' && (!accountHolder || accountNumber.length < 8 || ifscCode.length < 8)) {
      return res.status(400).json({ error: 'Please provide valid bank account holder, number, and IFSC code.' });
    }

    const payoutDetails =
      payoutMethod === 'upi'
        ? { upiId }
        : { accountHolder, accountNumber, ifscCode, bankName };

    await db
      .update(creatorProfiles)
      .set({ payoutMethod, payoutDetails, updatedAt: new Date() })
      .where(eq(creatorProfiles.userId, req.user!.id));

    return res.json({ message: 'Payout details updated.', payoutMethod, payoutDetails });
  } catch (error) {
    console.error('Payout details error:', error);
    return res.status(500).json({ error: 'Unable to update payout details.' });
  }
});

// POST /api/creator/withdrawals
router.post('/withdrawals', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const creatorId = req.user!.id;
    const requestedAmount = Number(req.body?.amountInr);

    const [minRow] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'min_withdrawal_inr'))
      .limit(1);
    const minWithdrawal = Number(minRow?.value || 100);

    if (Number.isNaN(requestedAmount) || requestedAmount < minWithdrawal) {
      return res.status(400).json({
        error: `Minimum withdrawal amount is ₹${minWithdrawal.toFixed(2)}.`,
      });
    }

    const [profile] = await db
      .select()
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, creatorId))
      .limit(1);

    const payoutMethod = req.body?.payoutMethod || profile?.payoutMethod || 'upi';
    const payoutDetails = req.body?.payoutDetails || profile?.payoutDetails || {};

    if (
      (payoutMethod === 'upi' && !payoutDetails?.upiId) ||
      (payoutMethod === 'bank_transfer' && !payoutDetails?.accountNumber)
    ) {
      return res.status(400).json({
        error: 'Please configure your UPI ID or bank account details before requesting a withdrawal.',
      });
    }

    const result = await db.transaction(async (tx) => {
      // Lock creator wallet row with FOR UPDATE to prevent concurrent double-withdrawal races
      const [wallet] = await tx
        .select()
        .from(creatorWallets)
        .where(eq(creatorWallets.creatorId, creatorId))
        .for('update')
        .limit(1);

      const available = Number(wallet?.availableBalanceInr || 0);
      if (!wallet || available < requestedAmount) {
        throw new Error(`Insufficient available balance (₹${available.toFixed(2)}).`);
      }

      const nextAvailable = (available - requestedAmount).toFixed(2);
      const nextPending = (Number(wallet.pendingEarningsInr) + requestedAmount).toFixed(2);

      await tx
        .update(creatorWallets)
        .set({
          availableBalanceInr: nextAvailable,
          pendingEarningsInr: nextPending,
          updatedAt: new Date(),
        })
        .where(eq(creatorWallets.creatorId, creatorId));

      const [withdrawal] = await tx
        .insert(withdrawals)
        .values({
          creatorId,
          amountInr: requestedAmount.toFixed(2),
          payoutMethod,
          payoutDetails,
          status: 'pending',
        })
        .returning();

      await tx.insert(transactions).values({
        creatorId,
        withdrawalId: withdrawal.id,
        type: 'withdrawal',
        amountInr: requestedAmount.toFixed(2),
        direction: 'debit',
        description: `Withdrawal request #${withdrawal.id} via ${payoutMethod.toUpperCase()} (pending review)`,
        status: 'pending',
      });

      const admins = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'));
      if (admins.length > 0) {
        await tx.insert(notifications).values(
          admins.map((a) => ({
            userId: a.id,
            type: 'withdrawal_request',
            title: 'New creator withdrawal request',
            message: `${req.user!.name} requested ₹${requestedAmount.toFixed(2)} via ${payoutMethod.toUpperCase()}.`,
            link: '#/admin/withdrawals',
          }))
        );
      }

      return withdrawal;
    });

    return res.status(201).json({
      withdrawal: result,
      message: 'Withdrawal request submitted for administrator verification.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unable to submit withdrawal request.';
    if (msg.startsWith('Insufficient')) {
      return res.status(400).json({ error: msg });
    }
    console.error('Withdrawal request error:', error);
    return res.status(500).json({ error: 'Unable to process withdrawal request.' });
  }
});

export default router;
