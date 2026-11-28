import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminSettings,
  auditLogs,
  categories,
  comments,
  commissionRecords,
  contentDownloads,
  contentFiles,
  contents,
  contentTags,
  creatorContentHistory,
  creatorProfiles,
  creatorWallets,
  followers,
  notifications,
  payments,
  purchases,
  subjects,
  transactions,
  userActivitySessions,
  users,
  withdrawals,
} from '../db/schema.ts';
import { invalidateCatalogCache } from '../lib/cache.ts';
import { normalizeEduQuery, syncContentEmbedding } from '../lib/embeddings.ts';
import {
  runCreatorDraftSmartSearch,
  runCreatorPendingSmartSearch,
  type DraftTypeGroup,
  type PendingStatusFilter,
} from '../lib/search-engine.ts';
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
  createSignedFileToken,
  estimateReadingTime,
  getStorageRoot,
  normalizeExternalVideoUrl,
  sanitizeHtml,
  sanitizeSafeUrl,
  slugify,
} from '../lib/security.ts';
import { resolveCommissionRate } from '../lib/payments.ts';
import {
  AnalyticsValidationError,
  getCreatorAnalyticsOverview,
  getCreatorAnalyticsPublicationsList,
  getCreatorEarningsAnalytics,
  getCreatorLikesAnalytics,
  getCreatorSalesAnalytics,
  getCreatorViewsAnalytics,
  getPublicationAnalyticsDetail,
  resolveAnalyticsDateRange,
} from '../lib/creator-analytics.ts';
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

    let purgedCount = 0;
    for (const item of expired) {
      const [purchaseRef, commissionRef] = await Promise.all([
        db.select({ id: purchases.id }).from(purchases).where(eq(purchases.contentId, item.id)).limit(1),
        db
          .select({ id: commissionRecords.id })
          .from(commissionRecords)
          .where(eq(commissionRecords.contentId, item.id))
          .limit(1),
      ]);
      // Never cascade-delete content that has buyer purchases or commission accounting records
      if (purchaseRef.length > 0 || commissionRef.length > 0) {
        continue;
      }

      const files = await db.select().from(contentFiles).where(eq(contentFiles.contentId, item.id));
      for (const f of files) {
        if (f.storageProvider === 'local' && f.storagePath && f.storagePath !== 'external') {
          const refRows = await db
            .select({ value: count() })
            .from(contentFiles)
            .where(and(eq(contentFiles.storagePath, f.storagePath), sql`${contentFiles.contentId} <> ${item.id}`));
          if (Number(refRows[0]?.value || 0) === 0) {
            const resolved = path.resolve(storageRoot, path.basename(f.storagePath));
            if (resolved.startsWith(storageRoot) && fs.existsSync(resolved)) {
              fs.unlinkSync(resolved);
            }
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
      purgedCount += 1;
    }
    invalidateCatalogCache();
    return purgedCount;
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
          downloadsCount: contents.downloadsCount,
          likesCount: contents.likesCount,
          purchasesCount: contents.purchasesCount,
          avgRating: contents.avgRating,
          reviewsCount: contents.reviewsCount,
          categoryId: contents.categoryId,
          subjectId: contents.subjectId,
          categoryName: categories.name,
          subjectName: subjects.name,
          classLevel: contents.classLevel,
          chapter: contents.chapter,
          topic: contents.topic,
          chapterOrder: contents.chapterOrder,
          durationSeconds: contents.durationSeconds,
          studyLabel: contents.studyLabel,
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
    const totalDownloads = myContents.reduce((sum, c) => sum + Number(c.downloadsCount || 0), 0);
    const totalLikes = myContents.reduce((sum, c) => sum + c.likesCount, 0);
    const totalPurchases = myContents.reduce((sum, c) => sum + c.purchasesCount, 0);

    return res.json({
      profile: profile || null,
      wallet,
      minWithdrawalInr: Number(settingsMap.min_withdrawal_inr || 100),
      effectiveCommissionRate,
      analytics: {
        totalViews,
        totalDownloads,
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

// ===== OVERVIEW DATE RANGE HELPERS (Asia/Kolkata IST calendar alignment) =====
const IST_OFFSET_MS = 330 * 60 * 1000;

function formatIstYmd(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const base = new Date(`${ymd}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function parseStrictYmd(raw: unknown): string | null {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

function istStartUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000+05:30`);
}

function istEndUtc(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

function computeGrowthPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

// GET /api/creator/overview (Dedicated, creator-isolated Creator Studio Overview metrics & feed)
router.get('/overview', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const creatorId = req.user!.id;
    const now = new Date();
    const todayYmd = formatIstYmd(now);
    const monthStartUtc = istStartUtc(`${todayYmd.slice(0, 7)}-01`);

    const rawRange = String(req.query.range || '30d').trim().toLowerCase();
    const validRanges = new Set(['today', '7d', '30d', '90d', 'year', 'custom']);
    const rangeKey = validRanges.has(rawRange) ? rawRange : '30d';

    const rawSortBy = String(req.query.sortBy || 'views').trim().toLowerCase();
    const sortBy = rawSortBy === 'sales' || rawSortBy === 'earnings' ? rawSortBy : 'views';

    let startDateYmd = addDaysYmd(todayYmd, -29);
    let endDateYmd = todayYmd;
    let rangeStartUtc = istStartUtc(startDateYmd);
    let rangeEndUtc = now;
    let prevStartUtc = new Date(rangeStartUtc.getTime() - 30 * 86_400_000);
    let prevEndUtc = new Date(rangeStartUtc.getTime() - 1);
    let rangeLabel = 'Last 30 Days';
    let comparisonLabel = 'vs prior 30d';

    if (rangeKey === 'today') {
      startDateYmd = todayYmd;
      endDateYmd = todayYmd;
      rangeStartUtc = istStartUtc(todayYmd);
      rangeEndUtc = now;
      const yesterdayYmd = addDaysYmd(todayYmd, -1);
      prevStartUtc = istStartUtc(yesterdayYmd);
      prevEndUtc = istEndUtc(yesterdayYmd);
      rangeLabel = 'Today';
      comparisonLabel = 'vs yesterday';
    } else if (rangeKey === '7d' || rangeKey === '30d' || rangeKey === '90d') {
      const days = rangeKey === '7d' ? 7 : rangeKey === '90d' ? 90 : 30;
      startDateYmd = addDaysYmd(todayYmd, -(days - 1));
      endDateYmd = todayYmd;
      rangeStartUtc = istStartUtc(startDateYmd);
      rangeEndUtc = now;
      prevEndUtc = new Date(rangeStartUtc.getTime() - 1);
      prevStartUtc = new Date(rangeStartUtc.getTime() - days * 86_400_000);
      rangeLabel = `Last ${days} Days`;
      comparisonLabel = `vs prior ${days}d`;
    } else if (rangeKey === 'year') {
      startDateYmd = `${todayYmd.slice(0, 4)}-01-01`;
      endDateYmd = todayYmd;
      rangeStartUtc = istStartUtc(startDateYmd);
      rangeEndUtc = now;
      const spanMs = Math.max(86_400_000, rangeEndUtc.getTime() - rangeStartUtc.getTime());
      prevEndUtc = new Date(rangeStartUtc.getTime() - 1);
      prevStartUtc = new Date(rangeStartUtc.getTime() - spanMs);
      rangeLabel = `This Year (${todayYmd.slice(0, 4)})`;
      comparisonLabel = 'vs prior period';
    } else if (rangeKey === 'custom') {
      const parsedStart = parseStrictYmd(req.query.startDate);
      const parsedEnd = parseStrictYmd(req.query.endDate);
      if (!parsedStart || !parsedEnd) {
        return res.status(400).json({
          error: 'Please select valid start and end dates (YYYY-MM-DD) for custom date filtering.',
        });
      }
      if (parsedStart > parsedEnd) {
        return res.status(400).json({ error: 'Start date cannot be later than end date.' });
      }
      const sUtc = istStartUtc(parsedStart);
      const eUtc = istEndUtc(parsedEnd);
      const spanDays = Math.ceil((eUtc.getTime() - sUtc.getTime()) / 86_400_000);
      if (spanDays > 1826) {
        return res.status(400).json({ error: 'Custom date range cannot exceed 5 years.' });
      }
      startDateYmd = parsedStart;
      endDateYmd = parsedEnd;
      rangeStartUtc = sUtc;
      rangeEndUtc = eUtc;
      const spanMs = eUtc.getTime() - sUtc.getTime() + 1;
      prevEndUtc = new Date(sUtc.getTime() - 1);
      prevStartUtc = new Date(sUtc.getTime() - spanMs);
      rangeLabel = parsedStart === parsedEnd ? parsedStart : `${parsedStart} to ${parsedEnd}`;
      comparisonLabel = 'vs previous period';
    }

    const [
      userRows,
      profileRows,
      walletRows,
      settingsRows,
      contentAggResult,
      commissionAggResult,
      downloadWindowResult,
      topContentResult,
      recentHistoryRows,
      recentSaleRows,
      recentWithdrawalRows,
      recentFollowerRows,
      recentModerationNotifs,
    ] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          publicUid: users.publicUid,
          avatarUrl: users.avatarUrl,
          role: users.role,
          status: users.status,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, creatorId))
        .limit(1),
      db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, creatorId)).limit(1),
      db.select().from(creatorWallets).where(eq(creatorWallets.creatorId, creatorId)).limit(1),
      db.select().from(adminSettings),
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS total_count,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'approved')::int AS published_count,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'draft')::int AS draft_count,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND status IN ('pending', 'changes_requested'))::int AS pending_count,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND status IN ('rejected', 'removed'))::int AS rejected_count,
          COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted_count,
          COALESCE(SUM(views_count) FILTER (WHERE deleted_at IS NULL), 0)::bigint AS total_views,
          COALESCE(SUM(downloads_count) FILTER (WHERE deleted_at IS NULL), 0)::bigint AS total_downloads,
          COALESCE(SUM(likes_count) FILTER (WHERE deleted_at IS NULL), 0)::bigint AS total_likes,
          COALESCE(SUM(purchases_count) FILTER (WHERE deleted_at IS NULL), 0)::bigint AS total_content_sales
        FROM contents
        WHERE creator_id = ${creatorId}
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(creator_earnings_inr), 0)::numeric(12,2) AS lifetime_earnings_inr,
          COUNT(*)::int AS lifetime_sales_count,
          COALESCE(SUM(creator_earnings_inr) FILTER (WHERE created_at >= ${monthStartUtc}), 0)::numeric(12,2) AS this_month_earnings_inr,
          COUNT(*) FILTER (WHERE created_at >= ${monthStartUtc})::int AS this_month_sales_count,
          COALESCE(SUM(creator_earnings_inr) FILTER (WHERE created_at >= ${rangeStartUtc} AND created_at <= ${rangeEndUtc}), 0)::numeric(12,2) AS range_earnings_inr,
          COALESCE(SUM(gross_amount_inr) FILTER (WHERE created_at >= ${rangeStartUtc} AND created_at <= ${rangeEndUtc}), 0)::numeric(12,2) AS range_gross_inr,
          COALESCE(SUM(platform_commission_inr) FILTER (WHERE created_at >= ${rangeStartUtc} AND created_at <= ${rangeEndUtc}), 0)::numeric(12,2) AS range_commission_inr,
          COUNT(*) FILTER (WHERE created_at >= ${rangeStartUtc} AND created_at <= ${rangeEndUtc})::int AS range_sales_count,
          COALESCE(SUM(creator_earnings_inr) FILTER (WHERE created_at >= ${prevStartUtc} AND created_at <= ${prevEndUtc}), 0)::numeric(12,2) AS prev_range_earnings_inr,
          COUNT(*) FILTER (WHERE created_at >= ${prevStartUtc} AND created_at <= ${prevEndUtc})::int AS prev_range_sales_count
        FROM commission_records
        WHERE creator_id = ${creatorId} AND status = 'credited'
      `),
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE cd.created_at >= ${rangeStartUtc} AND cd.created_at <= ${rangeEndUtc})::int AS range_downloads_count,
          COUNT(*) FILTER (WHERE cd.created_at >= ${prevStartUtc} AND cd.created_at <= ${prevEndUtc})::int AS prev_range_downloads_count
        FROM content_downloads cd
        INNER JOIN contents c ON cd.content_id = c.id
        WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL
      `),
      db.execute(
        sortBy === 'sales' || sortBy === 'earnings'
          ? sql`
              SELECT
                c.id,
                c.title,
                c.slug,
                c.cover_image_url AS cover_image_url,
                c.content_type AS content_type,
                c.status,
                c.is_free AS is_free,
                c.price_inr AS price_inr,
                c.views_count AS views_count,
                c.downloads_count AS downloads_count,
                c.purchases_count AS purchases_count,
                c.avg_rating AS avg_rating,
                cat.name AS category_name,
                COALESCE(cr.net_earnings_inr, 0)::numeric(12,2) AS net_earnings_inr
              FROM contents c
              LEFT JOIN categories cat ON cat.id = c.category_id
              LEFT JOIN (
                SELECT content_id, COALESCE(SUM(creator_earnings_inr), 0) AS net_earnings_inr
                FROM commission_records
                WHERE creator_id = ${creatorId} AND status = 'credited'
                GROUP BY content_id
              ) cr ON cr.content_id = c.id
              WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL
              ORDER BY net_earnings_inr DESC, c.purchases_count DESC, c.views_count DESC, c.updated_at DESC
              LIMIT 5
            `
          : sql`
              SELECT
                c.id,
                c.title,
                c.slug,
                c.cover_image_url AS cover_image_url,
                c.content_type AS content_type,
                c.status,
                c.is_free AS is_free,
                c.price_inr AS price_inr,
                c.views_count AS views_count,
                c.downloads_count AS downloads_count,
                c.purchases_count AS purchases_count,
                c.avg_rating AS avg_rating,
                cat.name AS category_name,
                COALESCE(cr.net_earnings_inr, 0)::numeric(12,2) AS net_earnings_inr
              FROM contents c
              LEFT JOIN categories cat ON cat.id = c.category_id
              LEFT JOIN (
                SELECT content_id, COALESCE(SUM(creator_earnings_inr), 0) AS net_earnings_inr
                FROM commission_records
                WHERE creator_id = ${creatorId} AND status = 'credited'
                GROUP BY content_id
              ) cr ON cr.content_id = c.id
              WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL
              ORDER BY c.views_count DESC, c.purchases_count DESC, net_earnings_inr DESC, c.updated_at DESC
              LIMIT 5
            `
      ),
      db
        .select({
          id: creatorContentHistory.id,
          contentId: creatorContentHistory.contentId,
          action: creatorContentHistory.action,
          contentTitle: creatorContentHistory.contentTitle,
          contentType: creatorContentHistory.contentType,
          createdAt: creatorContentHistory.createdAt,
          slug: contents.slug,
          deletedAt: contents.deletedAt,
        })
        .from(creatorContentHistory)
        .leftJoin(contents, eq(creatorContentHistory.contentId, contents.id))
        .where(eq(creatorContentHistory.creatorId, creatorId))
        .orderBy(desc(creatorContentHistory.createdAt))
        .limit(8),
      db
        .select({
          id: commissionRecords.id,
          contentId: commissionRecords.contentId,
          contentTitle: contents.title,
          contentSlug: contents.slug,
          grossAmountInr: commissionRecords.grossAmountInr,
          creatorEarningsInr: commissionRecords.creatorEarningsInr,
          status: commissionRecords.status,
          createdAt: commissionRecords.createdAt,
        })
        .from(commissionRecords)
        .innerJoin(contents, eq(commissionRecords.contentId, contents.id))
        .where(eq(commissionRecords.creatorId, creatorId))
        .orderBy(desc(commissionRecords.createdAt))
        .limit(8),
      db
        .select({
          id: withdrawals.id,
          amountInr: withdrawals.amountInr,
          payoutMethod: withdrawals.payoutMethod,
          status: withdrawals.status,
          payoutReference: withdrawals.payoutReference,
          adminNote: withdrawals.adminNote,
          reviewedAt: withdrawals.reviewedAt,
          paidAt: withdrawals.paidAt,
          createdAt: withdrawals.createdAt,
        })
        .from(withdrawals)
        .where(eq(withdrawals.creatorId, creatorId))
        .orderBy(desc(withdrawals.createdAt))
        .limit(6),
      db
        .select({
          id: followers.id,
          followerName: users.name,
          createdAt: followers.createdAt,
        })
        .from(followers)
        .innerJoin(users, eq(followers.followerId, users.id))
        .where(eq(followers.creatorId, creatorId))
        .orderBy(desc(followers.createdAt))
        .limit(6),
      db
        .select({
          id: notifications.id,
          type: notifications.type,
          title: notifications.title,
          message: notifications.message,
          link: notifications.link,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, creatorId),
            inArray(notifications.type, [
              'content_approved',
              'content_rejected',
              'creator_activated',
            ])
          )
        )
        .orderBy(desc(notifications.createdAt))
        .limit(6),
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

    const userRow = userRows[0];
    if (!userRow) {
      return res.status(404).json({ error: 'Creator account not found.' });
    }

    const profile = profileRows[0] || null;
    const settingsMap: Record<string, string> = {};
    for (const s of settingsRows) settingsMap[s.key] = s.value;

    const effectiveCommissionRate = profile?.customCommissionRate
      ? Number(profile.customCommissionRate)
      : Number(settingsMap.default_commission_rate || 10);

    const cAgg = (contentAggResult.rows?.[0] || {}) as Record<string, unknown>;
    const fAgg = (commissionAggResult.rows?.[0] || {}) as Record<string, unknown>;
    const dAgg = (downloadWindowResult.rows?.[0] || {}) as Record<string, unknown>;

    const totalViews = Number(cAgg.total_views || 0);
    const totalDownloads = Number(cAgg.total_downloads || 0);
    const totalContentSales = Number(cAgg.total_content_sales || 0);
    const lifetimeSalesCount = Math.max(Number(fAgg.lifetime_sales_count || 0), totalContentSales);
    const lifetimeEarningsInr = Number(wallet?.totalEarningsInr || 0);
    const availableBalanceInr = Number(wallet?.availableBalanceInr || 0);
    const pendingBalanceInr = Number(wallet?.pendingEarningsInr || 0);
    const withdrawnAmountInr = Number(wallet?.withdrawnAmountInr || 0);

    const thisMonthEarningsInr = Number(fAgg.this_month_earnings_inr || 0);
    const thisMonthSalesCount = Number(fAgg.this_month_sales_count || 0);
    const rangeEarningsInr = Number(fAgg.range_earnings_inr || 0);
    const rangeGrossInr = Number(fAgg.range_gross_inr || 0);
    const rangeCommissionInr = Number(fAgg.range_commission_inr || 0);
    const rangeSalesCount = Number(fAgg.range_sales_count || 0);
    const prevRangeEarningsInr = Number(fAgg.prev_range_earnings_inr || 0);
    const prevRangeSalesCount = Number(fAgg.prev_range_sales_count || 0);
    const rangeDownloadsCount = Number(dAgg.range_downloads_count || 0);
    const prevRangeDownloadsCount = Number(dAgg.prev_range_downloads_count || 0);

    const topContent = (topContentResult.rows || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      title: String(r.title || ''),
      slug: String(r.slug || ''),
      coverImageUrl: (r.cover_image_url as string | null) || null,
      contentType: String(r.content_type || 'Notes'),
      categoryName: (r.category_name as string | null) || null,
      status: String(r.status || 'draft'),
      isFree: Boolean(r.is_free),
      priceInr: Number(r.price_inr || 0),
      viewsCount: Number(r.views_count || 0),
      downloadsCount: Number(r.downloads_count || 0),
      purchasesCount: Number(r.purchases_count || 0),
      avgRating: Number(r.avg_rating || 0),
      earningsInr: Number(r.net_earnings_inr || 0),
    }));

    type OverviewActivity = {
      id: string;
      category: 'content' | 'sale' | 'withdrawal' | 'follower' | 'moderation';
      title: string;
      reference: string;
      status: string;
      createdAt: string;
      link: string;
    };

    const activities: OverviewActivity[] = [];

    for (const h of recentHistoryRows) {
      const actionLabelMap: Record<string, string> = {
        created: 'Created content',
        updated: 'Updated content',
        published: 'Published content',
        submitted_for_review: 'Submitted for review',
        resubmitted: 'Resubmitted for review',
        under_review: 'Moved to under review',
        approved: 'Approved by moderator',
        changes_requested: 'Changes requested by moderator',
        rejected: 'Rejected by moderator',
        removed: 'Removed by moderator',
        duplicated: 'Duplicated to Draft',
        moved_to_draft: 'Moved to Draft',
        deleted: 'Moved to Recovery Bin',
        recovered: 'Recovered content',
        permanently_deleted: 'Permanently deleted content',
        auto_purged: 'Expired from Recovery Bin',
      };
      const label = actionLabelMap[h.action] || 'Content update';
      const canOpenContent = Boolean(h.slug) && !h.deletedAt && h.action !== 'deleted' && h.action !== 'permanently_deleted' && h.action !== 'auto_purged';
      activities.push({
        id: `hist-${h.id}`,
        category: 'content',
        title: `${label}: ${h.contentTitle}`,
        reference: h.contentType || 'Publication',
        status: h.action,
        createdAt: new Date(h.createdAt).toISOString(),
        link: canOpenContent ? `#/content/${h.slug}` : '#/creator/history',
      });
    }

    for (const s of recentSaleRows) {
      const isReversed = s.status === 'reversed';
      activities.push({
        id: `sale-${s.id}`,
        category: 'sale',
        title: `${isReversed ? 'Sale refunded' : 'New sale'}: ${s.contentTitle}`,
        reference: isReversed
          ? `Reversed ₹${Number(s.creatorEarningsInr).toFixed(2)}`
          : `Earned +₹${Number(s.creatorEarningsInr).toFixed(2)} (Gross ₹${Number(s.grossAmountInr).toFixed(0)})`,
        status: s.status,
        createdAt: new Date(s.createdAt).toISOString(),
        link: '#/creator/earnings',
      });
    }

    for (const w of recentWithdrawalRows) {
      const eventDate = w.paidAt || w.reviewedAt || w.createdAt;
      const statusTitles: Record<string, string> = {
        pending: `Withdrawal requested: ₹${Number(w.amountInr).toFixed(2)}`,
        approved: `Withdrawal approved: ₹${Number(w.amountInr).toFixed(2)}`,
        paid: `Payout completed: ₹${Number(w.amountInr).toFixed(2)}`,
        rejected: `Withdrawal declined: ₹${Number(w.amountInr).toFixed(2)}`,
      };
      activities.push({
        id: `wd-${w.id}`,
        category: 'withdrawal',
        title: statusTitles[w.status] || `Withdrawal update: ₹${Number(w.amountInr).toFixed(2)}`,
        reference: w.payoutReference
          ? `Ref: ${w.payoutReference}`
          : `${String(w.payoutMethod || 'upi').toUpperCase()} · ${w.adminNote || 'Pending review'}`,
        status: w.status,
        createdAt: new Date(eventDate).toISOString(),
        link: '#/creator/withdrawals',
      });
    }

    for (const f of recentFollowerRows) {
      activities.push({
        id: `fol-${f.id}`,
        category: 'follower',
        title: `New follower: ${f.followerName}`,
        reference: 'Started following your publications',
        status: 'active',
        createdAt: new Date(f.createdAt).toISOString(),
        link: `#/creator-profile/${creatorId}`,
      });
    }

    for (const n of recentModerationNotifs) {
      activities.push({
        id: `notif-${n.id}`,
        category: 'moderation',
        title: n.title,
        reference: n.message,
        status: n.type === 'content_rejected' ? 'rejected' : 'approved',
        createdAt: new Date(n.createdAt).toISOString(),
        link: n.link || '#/creator/pending',
      });
    }

    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.json({
      creatorHeader: {
        id: userRow.id,
        name: userRow.name,
        displayName: profile?.displayName || userRow.name,
        tagline: profile?.tagline || null,
        expertise: profile?.expertise || null,
        avatarUrl: userRow.avatarUrl || null,
        verified: Boolean(profile?.verified),
        accountStatus: userRow.status,
        role: userRow.role,
        publicUid: userRow.publicUid || null,
        username: userRow.username || null,
        followerCount: Number(profile?.followerCount || 0),
        effectiveCommissionRate,
        motto: 'Create • Share • Earn',
      },
      filter: {
        range: rangeKey,
        rangeLabel,
        comparisonLabel,
        startDate: startDateYmd,
        endDate: endDateYmd,
        sortBy,
        timezone: 'Asia/Kolkata',
      },
      quickStats: {
        totalViews,
        viewsGrowthPct: null,
        totalDownloads,
        downloadsGrowthPct: computeGrowthPct(rangeDownloadsCount, prevRangeDownloadsCount),
        rangeDownloadsCount,
        totalSales: lifetimeSalesCount,
        rangeSalesCount,
        salesGrowthPct: computeGrowthPct(rangeSalesCount, prevRangeSalesCount),
        totalEarningsInr: lifetimeEarningsInr,
        rangeEarningsInr,
        earningsGrowthPct: computeGrowthPct(rangeEarningsInr, prevRangeEarningsInr),
      },
      earningsOverview: {
        lifetimeEarningsInr,
        availableBalanceInr,
        pendingBalanceInr,
        withdrawnAmountInr,
        thisMonthEarningsInr,
        thisMonthSalesCount,
        rangeEarningsInr,
        rangeGrossInr,
        rangeCommissionInr,
        rangeSalesCount,
        previousRangeEarningsInr: prevRangeEarningsInr,
        growthPct: computeGrowthPct(rangeEarningsInr, prevRangeEarningsInr),
        minWithdrawalInr: Number(settingsMap.min_withdrawal_inr || 100),
      },
      contentPerformance: {
        totalCount: Number(cAgg.total_count || 0),
        publishedCount: Number(cAgg.published_count || 0),
        draftCount: Number(cAgg.draft_count || 0),
        pendingCount: Number(cAgg.pending_count || 0),
        rejectedCount: Number(cAgg.rejected_count || 0),
        deletedCount: Number(cAgg.deleted_count || 0),
        totalLikes: Number(cAgg.total_likes || 0),
      },
      topContent,
      recentActivity: activities.slice(0, 10),
    });
  } catch (error) {
    console.error('Creator overview error:', error);
    return res.status(500).json({ error: 'Unable to load creator overview.' });
  }
});

// ===== CREATOR ANALYTICS SYSTEM ROUTES (Strictly Read-Only, Creator-Isolated) =====

function handleAnalyticsError(res: import('express').Response, error: unknown, fallbackMsg: string) {
  if (error instanceof AnalyticsValidationError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(fallbackMsg, error);
  return res.status(500).json({ error: fallbackMsg });
}

// GET /api/creator/analytics (Content Performance Analytics Dashboard)
router.get('/analytics', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const range = resolveAnalyticsDateRange(req.query.range, req.query.startDate, req.query.endDate);
    const payload = await getCreatorAnalyticsOverview(req.user!.id, range);
    return res.json(payload);
  } catch (error) {
    return handleAnalyticsError(res, error, 'Unable to load creator performance analytics.');
  }
});

// GET /api/creator/analytics/views
router.get('/analytics/views', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const range = resolveAnalyticsDateRange(req.query.range, req.query.startDate, req.query.endDate);
    const payload = await getCreatorViewsAnalytics(req.user!.id, range);
    return res.json(payload);
  } catch (error) {
    return handleAnalyticsError(res, error, 'Unable to load views analytics.');
  }
});

// GET /api/creator/analytics/likes
router.get('/analytics/likes', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const range = resolveAnalyticsDateRange(req.query.range, req.query.startDate, req.query.endDate);
    const payload = await getCreatorLikesAnalytics(req.user!.id, range);
    return res.json(payload);
  } catch (error) {
    return handleAnalyticsError(res, error, 'Unable to load likes analytics.');
  }
});

// GET /api/creator/analytics/sales
router.get('/analytics/sales', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const range = resolveAnalyticsDateRange(req.query.range, req.query.startDate, req.query.endDate);
    const payload = await getCreatorSalesAnalytics(req.user!.id, range, {
      orderStatus: String(req.query.orderStatus || 'all'),
      page: parsePositiveInt(req.query.page) || 1,
      limit: parsePositiveInt(req.query.limit) || 10,
    });
    return res.json(payload);
  } catch (error) {
    return handleAnalyticsError(res, error, 'Unable to load sales analytics.');
  }
});

// GET /api/creator/analytics/earnings
router.get('/analytics/earnings', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const range = resolveAnalyticsDateRange(req.query.range, req.query.startDate, req.query.endDate);
    const payload = await getCreatorEarningsAnalytics(req.user!.id, range, {
      page: parsePositiveInt(req.query.page) || 1,
      limit: parsePositiveInt(req.query.limit) || 10,
    });
    return res.json(payload);
  } catch (error) {
    return handleAnalyticsError(res, error, 'Unable to load earnings analytics.');
  }
});

// GET /api/creator/analytics/publications (View All paginated, searchable, filterable publications analytics)
router.get('/analytics/publications', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const range = resolveAnalyticsDateRange(req.query.range, req.query.startDate, req.query.endDate);
    const payload = await getCreatorAnalyticsPublicationsList(req.user!.id, range, {
      metric: String(req.query.metric || 'overview'),
      q: String(req.query.q || ''),
      contentType: String(req.query.contentType || 'all'),
      tier: String(req.query.tier || 'all'),
      sort: req.query.sort ? String(req.query.sort) : undefined,
      page: parsePositiveInt(req.query.page) || 1,
      limit: parsePositiveInt(req.query.limit) || 12,
    });
    return res.json(payload);
  } catch (error) {
    return handleAnalyticsError(res, error, 'Unable to load publications analytics list.');
  }
});

// GET /api/creator/analytics/publications/:id (Individual Publication Performance Details)
router.get('/analytics/publications/:id', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const contentId = parsePositiveInt(req.params.id);
    if (!contentId) {
      return res.status(400).json({ error: 'Invalid publication ID.' });
    }
    const range = resolveAnalyticsDateRange(req.query.range, req.query.startDate, req.query.endDate);
    const payload = await getPublicationAnalyticsDetail(
      contentId,
      { id: req.user!.id, role: req.user!.role },
      range
    );
    return res.json(payload);
  } catch (error) {
    return handleAnalyticsError(res, error, 'Unable to load publication performance details.');
  }
});

// GET /api/creator/history (Submission History, Chronological Activity History, and 15-day Recovery / Trash)
router.get('/history', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    await purgeExpiredDeletedContents();
    const creatorId = req.user!.id;

    const qRaw = String(req.query.q || '').trim().slice(0, 120);
    const qNorm = normalizeEduQuery(qRaw);
    const submissionStatusFilter = String(req.query.submissionStatus || 'all').toLowerCase();
    const dateRange = ['today', '7d', '30d', '90d', 'year', 'custom'].includes(
      String(req.query.dateRange || '').toLowerCase()
    )
      ? String(req.query.dateRange).toLowerCase()
      : 'all';
    const subPage = Math.max(1, parsePositiveInt(req.query.subPage || req.query.page) || 1);
    const actPage = Math.max(1, parsePositiveInt(req.query.actPage || req.query.page) || 1);
    const limit = Math.min(30, Math.max(1, parsePositiveInt(req.query.limit) || 15));

    let dateStartUtc: Date | null = null;
    let dateEndUtc: Date | null = null;
    if (dateRange !== 'all') {
      const todayYmd = formatIstYmd(new Date());
      if (dateRange === 'today') {
        dateStartUtc = istStartUtc(todayYmd);
      } else if (dateRange === '7d') {
        dateStartUtc = istStartUtc(addDaysYmd(todayYmd, -6));
      } else if (dateRange === '30d') {
        dateStartUtc = istStartUtc(addDaysYmd(todayYmd, -29));
      } else if (dateRange === '90d') {
        dateStartUtc = istStartUtc(addDaysYmd(todayYmd, -89));
      } else if (dateRange === 'year') {
        dateStartUtc = istStartUtc(`${todayYmd.slice(0, 4)}-01-01`);
      } else if (dateRange === 'custom') {
        const s = parseStrictYmd(req.query.startDate);
        const e = parseStrictYmd(req.query.endDate);
        if (s) dateStartUtc = istStartUtc(s);
        if (e) dateEndUtc = istEndUtc(e);
      }
    }

    const matchesDateFilter = (dt: Date | string | null | undefined) => {
      if (!dateStartUtc && !dateEndUtc) return true;
      if (!dt) return false;
      const ms = new Date(dt).getTime();
      if (dateStartUtc && ms < dateStartUtc.getTime()) return false;
      if (dateEndUtc && ms > dateEndUtc.getTime()) return false;
      return true;
    };

    const matchesTextFilter = (fields: Array<string | null | undefined>) => {
      if (!qRaw) return true;
      const combined = fields.filter(Boolean).join(' ');
      const lower = combined.toLowerCase();
      if (lower.includes(qRaw.toLowerCase())) return true;
      if (qNorm && normalizeEduQuery(combined).includes(qNorm)) return true;
      return false;
    };

    const [recoverableItems, allCreatorContents, allHistoryLogs] = await Promise.all([
      db
        .select({
          id: contents.id,
          title: contents.title,
          slug: contents.slug,
          coverImageUrl: contents.coverImageUrl,
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
          subjectName: subjects.name,
          deletedAt: contents.deletedAt,
          purgeAfter: contents.purgeAfter,
          createdAt: contents.createdAt,
        })
        .from(contents)
        .leftJoin(categories, eq(contents.categoryId, categories.id))
        .leftJoin(subjects, eq(contents.subjectId, subjects.id))
        .where(and(eq(contents.creatorId, creatorId), isNotNull(contents.deletedAt)))
        .orderBy(desc(contents.deletedAt)),
      db
        .select({
          id: contents.id,
          title: contents.title,
          slug: contents.slug,
          coverImageUrl: contents.coverImageUrl,
          contentType: contents.contentType,
          status: contents.status,
          rejectionReason: contents.rejectionReason,
          isFree: contents.isFree,
          priceInr: contents.priceInr,
          deletedAt: contents.deletedAt,
          publishedAt: contents.publishedAt,
          createdAt: contents.createdAt,
          updatedAt: contents.updatedAt,
          categoryName: categories.name,
          subjectName: subjects.name,
        })
        .from(contents)
        .leftJoin(categories, eq(contents.categoryId, categories.id))
        .leftJoin(subjects, eq(contents.subjectId, subjects.id))
        .where(eq(contents.creatorId, creatorId))
        .orderBy(desc(contents.updatedAt)),
      db
        .select()
        .from(creatorContentHistory)
        .where(eq(creatorContentHistory.creatorId, creatorId))
        .orderBy(desc(creatorContentHistory.createdAt))
        .limit(500),
    ]);

    const contentIds = allCreatorContents.map((c) => c.id);
    const contentIdStrings = contentIds.map((id) => String(id));
    const modAuditRows =
      contentIdStrings.length > 0
        ? await db
            .select()
            .from(auditLogs)
            .where(and(eq(auditLogs.entityType, 'content'), inArray(auditLogs.entityId, contentIdStrings)))
            .orderBy(desc(auditLogs.createdAt))
            .limit(300)
        : [];

    const historyByContentId = new Map<number, Array<(typeof allHistoryLogs)[number]>>();
    for (const h of allHistoryLogs) {
      if (!h.contentId) continue;
      const arr = historyByContentId.get(h.contentId) || [];
      arr.push(h);
      historyByContentId.set(h.contentId, arr);
    }

    const auditsByContentId = new Map<number, Array<(typeof modAuditRows)[number]>>();
    for (const a of modAuditRows) {
      const parsedId = Number(a.entityId);
      if (!Number.isInteger(parsedId) || parsedId <= 0) continue;
      const arr = auditsByContentId.get(parsedId) || [];
      arr.push(a);
      auditsByContentId.set(parsedId, arr);
    }

    const submissionCandidates = allCreatorContents.filter((c) => {
      if (c.deletedAt) return false;
      const logs = historyByContentId.get(c.id) || [];
      const hasSubmissionLog = logs.some((l) =>
        ['submitted_for_review', 'resubmitted', 'approved', 'rejected', 'changes_requested', 'removed', 'under_review'].includes(
          l.action
        )
      );
      return (
        hasSubmissionLog ||
        ['pending', 'changes_requested', 'approved', 'rejected', 'removed'].includes(c.status)
      );
    });

    const submissionRecordsAll = submissionCandidates
      .map((c) => {
        const logs = historyByContentId.get(c.id) || [];
        const audits = auditsByContentId.get(c.id) || [];

        const submissionLogs = logs.filter((l) =>
          ['submitted_for_review', 'resubmitted'].includes(l.action)
        );
        const resubmissionCount = logs.filter((l) => l.action === 'resubmitted').length;

        const firstSubmitLog = submissionLogs[submissionLogs.length - 1] || null;
        const latestSubmitLog = submissionLogs[0] || null;
        const submittedAt =
          firstSubmitLog?.createdAt ||
          (c.status !== 'draft' ? c.createdAt : null);
        const lastActivityAt =
          latestSubmitLog?.createdAt ||
          c.publishedAt ||
          c.updatedAt ||
          c.createdAt;

        const reviewEvents: Array<{ status: string; feedback: string | null; reviewedAt: string }> = [];
        for (const l of logs) {
          if (['approved', 'rejected', 'changes_requested', 'removed'].includes(l.action)) {
            const det = (l.details || {}) as Record<string, unknown>;
            reviewEvents.push({
              status: l.action,
              feedback:
                typeof det.feedback === 'string' && det.feedback.trim()
                  ? det.feedback.trim()
                  : null,
              reviewedAt: new Date(l.createdAt).toISOString(),
            });
          } else if (l.action === 'resubmitted') {
            const det = (l.details || {}) as Record<string, unknown>;
            if (typeof det.previousFeedback === 'string' && det.previousFeedback.trim()) {
              reviewEvents.push({
                status: String(det.previousStatus || 'changes_requested'),
                feedback: det.previousFeedback.trim(),
                reviewedAt: new Date(l.createdAt).toISOString(),
              });
            }
          }
        }
        for (const a of audits) {
          if (a.action !== 'moderate_content') continue;
          const det = (a.details || {}) as Record<string, unknown>;
          const st = String(det.status || '');
          if (!['approved', 'rejected', 'changes_requested', 'removed'].includes(st)) continue;
          const fb =
            typeof det.rejectionReason === 'string' && det.rejectionReason.trim()
              ? det.rejectionReason.trim()
              : null;
          const ts = new Date(a.createdAt).toISOString();
          const alreadyHas = reviewEvents.some(
            (ev) => ev.status === st && Math.abs(new Date(ev.reviewedAt).getTime() - new Date(ts).getTime()) < 5000
          );
          if (!alreadyHas) {
            reviewEvents.push({ status: st, feedback: fb, reviewedAt: ts });
          }
        }
        reviewEvents.sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime());

        const latestReview = reviewEvents[0] || null;
        const latestFeedback =
          c.rejectionReason ||
          latestReview?.feedback ||
          null;
        const lastReviewedAt =
          latestReview?.reviewedAt ||
          (c.status === 'approved' && c.publishedAt ? new Date(c.publishedAt).toISOString() : null);

        const displayReviewStatus =
          c.status === 'pending' && resubmissionCount > 0
            ? 'resubmitted'
            : c.status === 'pending'
            ? 'under_review'
            : c.status;

        return {
          id: c.id,
          title: c.title,
          slug: c.slug,
          coverImageUrl: c.coverImageUrl,
          contentType: c.contentType,
          categoryName: c.categoryName,
          subjectName: c.subjectName,
          isFree: c.isFree,
          priceInr: Number(c.priceInr || 0),
          status: c.status,
          displayStatus: displayReviewStatus,
          resubmissionCount,
          submittedAt,
          lastActivityAt,
          lastReviewedAt,
          latestFeedback,
          reviewEvents,
        };
      })
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

    const summary = {
      totalActivities: allHistoryLogs.length,
      totalSubmissions: submissionRecordsAll.length,
      underReviewCount: submissionRecordsAll.filter((s) => s.status === 'pending').length,
      changesRequestedCount: submissionRecordsAll.filter((s) => s.status === 'changes_requested').length,
      approvedCount: submissionRecordsAll.filter((s) => s.status === 'approved').length,
      rejectedCount: submissionRecordsAll.filter((s) => s.status === 'rejected' || s.status === 'removed').length,
      trashCount: recoverableItems.length,
    };

    const filteredSubmissions = submissionRecordsAll.filter((s) => {
      if (submissionStatusFilter !== 'all') {
        if (submissionStatusFilter === 'submitted') {
          // Matches items that were submitted (all submission records qualify unless strictly draft)
        } else if (submissionStatusFilter === 'under_review' || submissionStatusFilter === 'pending') {
          if (s.status !== 'pending') return false;
        } else if (submissionStatusFilter === 'changes_requested') {
          if (s.status !== 'changes_requested') return false;
        } else if (submissionStatusFilter === 'resubmitted') {
          if (s.resubmissionCount <= 0) return false;
        } else if (submissionStatusFilter === 'approved') {
          if (s.status !== 'approved') return false;
        } else if (submissionStatusFilter === 'rejected') {
          if (s.status !== 'rejected' && s.status !== 'removed') return false;
        }
      }
      if (!matchesDateFilter(s.submittedAt || s.lastActivityAt)) return false;
      if (
        !matchesTextFilter([
          s.title,
          s.contentType,
          s.categoryName,
          s.subjectName,
          s.latestFeedback,
          s.status,
        ])
      ) {
        return false;
      }
      return true;
    });

    const filteredActivities = allHistoryLogs.filter((h) => {
      if (!matchesDateFilter(h.createdAt)) return false;
      const detStr = h.details ? JSON.stringify(h.details) : '';
      if (!matchesTextFilter([h.contentTitle, h.contentType, h.action, h.authorName, detStr])) {
        return false;
      }
      return true;
    });

    const filteredTrash = recoverableItems.filter((r) => {
      if (!matchesDateFilter(r.deletedAt)) return false;
      if (
        !matchesTextFilter([
          r.title,
          r.contentType,
          r.categoryName,
          r.subjectName,
          r.shortDescription,
          r.previousStatus,
        ])
      ) {
        return false;
      }
      return true;
    });

    const subTotal = filteredSubmissions.length;
    const subTotalPages = Math.max(1, Math.ceil(subTotal / limit));
    const clampedSubPage = Math.min(subTotalPages, subPage);
    const pagedSubmissions = filteredSubmissions.slice(
      (clampedSubPage - 1) * limit,
      clampedSubPage * limit
    );

    const actTotal = filteredActivities.length;
    const actTotalPages = Math.max(1, Math.ceil(actTotal / limit));
    const clampedActPage = Math.min(actTotalPages, actPage);
    const pagedActivities = filteredActivities.slice(
      (clampedActPage - 1) * limit,
      clampedActPage * limit
    );

    return res.json({
      retentionDays: RETENTION_DAYS,
      summary,
      deletedContents: filteredTrash,
      history: filteredActivities.slice(0, 150),
      recoverableItems: filteredTrash,
      historyLogs: filteredActivities.slice(0, 150),
      submissionHistory: {
        items: pagedSubmissions,
        pagination: { page: clampedSubPage, limit, total: subTotal, totalPages: subTotalPages },
      },
      activityHistory: {
        items: pagedActivities,
        pagination: { page: clampedActPage, limit, total: actTotal, totalPages: actTotalPages },
      },
    });
  } catch (error) {
    console.error('Creator history error:', error);
    return res.status(500).json({ error: 'Unable to load creator history.' });
  }
});

// GET /api/creator/published (Creator-scoped paginated listing with real search, filters, sorting, and tier counts)
router.get('/published', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const creatorId = req.user!.id;
    const rawQuery = String(req.query.q || '').trim().slice(0, 120);
    const tier = ['free', 'paid'].includes(String(req.query.tier || '').toLowerCase())
      ? String(req.query.tier).toLowerCase()
      : 'all';
    const contentType = String(req.query.contentType || '').trim();
    const categoryId = parsePositiveInt(req.query.categoryId);
    const subjectId = parsePositiveInt(req.query.subjectId);
    const dateRange = ['7d', '30d', '90d', 'year'].includes(String(req.query.dateRange || '').toLowerCase())
      ? String(req.query.dateRange).toLowerCase()
      : 'all';
    const rawSort = String(req.query.sort || 'latest').toLowerCase();
    const sort = ['latest', 'oldest', 'views', 'downloads', 'sales', 'title'].includes(rawSort)
      ? rawSort
      : 'latest';
    const page = Math.max(1, parsePositiveInt(req.query.page) || 1);
    const limit = Math.min(30, Math.max(1, parsePositiveInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const baseConds = [
      eq(contents.creatorId, creatorId),
      eq(contents.status, 'approved'),
      isNull(contents.deletedAt),
    ];

    const filterConds = [...baseConds];
    if (tier === 'free') filterConds.push(eq(contents.isFree, true));
    if (tier === 'paid') filterConds.push(eq(contents.isFree, false));
    if (contentType && contentType !== 'all') {
      filterConds.push(eq(contents.contentType, contentType));
    }
    if (categoryId) filterConds.push(eq(contents.categoryId, categoryId));
    if (subjectId) filterConds.push(eq(contents.subjectId, subjectId));

    if (dateRange !== 'all') {
      const todayYmd = formatIstYmd(new Date());
      let startYmd = `${todayYmd.slice(0, 4)}-01-01`;
      if (dateRange === '7d') startYmd = addDaysYmd(todayYmd, -6);
      else if (dateRange === '30d') startYmd = addDaysYmd(todayYmd, -29);
      else if (dateRange === '90d') startYmd = addDaysYmd(todayYmd, -89);
      const startUtc = istStartUtc(startYmd);
      filterConds.push(sql`COALESCE(${contents.publishedAt}, ${contents.createdAt}) >= ${startUtc}`);
    }

    if (rawQuery) {
      const pattern = `%${rawQuery}%`;
      filterConds.push(
        or(
          ilike(contents.title, pattern),
          ilike(contents.shortDescription, pattern),
          ilike(categories.name, pattern),
          ilike(subjects.name, pattern),
          ilike(contents.classLevel, pattern),
          ilike(contents.topic, pattern),
          sql`EXISTS (SELECT 1 FROM content_tags ct WHERE ct.content_id = ${contents.id} AND ct.tag ILIKE ${pattern})`
        )!
      );
    }

    const orderClauses =
      sort === 'oldest'
        ? [asc(sql`COALESCE(${contents.publishedAt}, ${contents.createdAt})`), asc(contents.id)]
        : sort === 'views'
        ? [desc(contents.viewsCount), desc(contents.id)]
        : sort === 'downloads'
        ? [desc(contents.downloadsCount), desc(contents.id)]
        : sort === 'sales'
        ? [desc(contents.purchasesCount), desc(contents.viewsCount), desc(contents.id)]
        : sort === 'title'
        ? [asc(contents.title), desc(contents.id)]
        : [desc(sql`COALESCE(${contents.publishedAt}, ${contents.createdAt})`), desc(contents.id)];

    const [
      tierAggRows,
      filteredCountRows,
      itemsRows,
      metaTypeRows,
      metaCategoryRows,
      metaSubjectRows,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*)::int AS all_count,
          COUNT(*) FILTER (WHERE is_free = true)::int AS free_count,
          COUNT(*) FILTER (WHERE is_free = false)::int AS paid_count
        FROM contents
        WHERE creator_id = ${creatorId} AND status = 'approved' AND deleted_at IS NULL
      `),
      db
        .select({ total: count() })
        .from(contents)
        .leftJoin(categories, eq(contents.categoryId, categories.id))
        .leftJoin(subjects, eq(contents.subjectId, subjects.id))
        .where(and(...filterConds)),
      db
        .select({
          id: contents.id,
          title: contents.title,
          slug: contents.slug,
          shortDescription: contents.shortDescription,
          coverImageUrl: contents.coverImageUrl,
          contentType: contents.contentType,
          language: contents.language,
          classLevel: contents.classLevel,
          chapter: contents.chapter,
          topic: contents.topic,
          studyLabel: contents.studyLabel,
          isFree: contents.isFree,
          priceInr: contents.priceInr,
          status: contents.status,
          viewsCount: contents.viewsCount,
          downloadsCount: contents.downloadsCount,
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
        .where(and(...filterConds))
        .orderBy(...orderClauses)
        .limit(limit)
        .offset(offset),
      db
        .selectDistinct({ contentType: contents.contentType })
        .from(contents)
        .where(and(...baseConds)),
      db
        .selectDistinct({ id: categories.id, name: categories.name })
        .from(contents)
        .innerJoin(categories, eq(contents.categoryId, categories.id))
        .where(and(...baseConds)),
      db
        .selectDistinct({ id: subjects.id, name: subjects.name })
        .from(contents)
        .innerJoin(subjects, eq(contents.subjectId, subjects.id))
        .where(and(...baseConds)),
    ]);

    const itemIds = itemsRows.map((r) => r.id);
    const tagsByContentId = new Map<number, string[]>();
    const earningsByContentId = new Map<number, number>();

    if (itemIds.length > 0) {
      const [tagRows, earningsRows] = await Promise.all([
        db
          .select({ contentId: contentTags.contentId, tag: contentTags.tag })
          .from(contentTags)
          .where(inArray(contentTags.contentId, itemIds)),
        db
          .select({
            contentId: commissionRecords.contentId,
            netEarningsInr: sql<string>`COALESCE(SUM(${commissionRecords.creatorEarningsInr}), 0)`,
          })
          .from(commissionRecords)
          .where(
            and(
              eq(commissionRecords.creatorId, creatorId),
              eq(commissionRecords.status, 'credited'),
              inArray(commissionRecords.contentId, itemIds)
            )
          )
          .groupBy(commissionRecords.contentId),
      ]);

      for (const tr of tagRows) {
        const list = tagsByContentId.get(tr.contentId) || [];
        list.push(tr.tag);
        tagsByContentId.set(tr.contentId, list);
      }
      for (const er of earningsRows) {
        earningsByContentId.set(er.contentId, Number(er.netEarningsInr || 0));
      }
    }

    const tierAgg = (tierAggRows.rows?.[0] || {}) as Record<string, unknown>;
    const total = Number(filteredCountRows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      items: itemsRows.map((row) => ({
        ...row,
        priceInr: Number(row.priceInr || 0),
        viewsCount: Number(row.viewsCount || 0),
        downloadsCount: Number(row.downloadsCount || 0),
        likesCount: Number(row.likesCount || 0),
        purchasesCount: Number(row.purchasesCount || 0),
        avgRating: Number(row.avgRating || 0),
        reviewsCount: Number(row.reviewsCount || 0),
        netEarningsInr: row.isFree ? 0 : earningsByContentId.get(row.id) || 0,
        tags: tagsByContentId.get(row.id) || [],
      })),
      counts: {
        all: Number(tierAgg.all_count || 0),
        free: Number(tierAgg.free_count || 0),
        paid: Number(tierAgg.paid_count || 0),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      filtersMeta: {
        contentTypes: metaTypeRows.map((r) => r.contentType).filter(Boolean).sort(),
        categories: metaCategoryRows.sort((a, b) => a.name.localeCompare(b.name)),
        subjects: metaSubjectRows.sort((a, b) => a.name.localeCompare(b.name)),
      },
    });
  } catch (error) {
    console.error('Creator published list error:', error);
    return res.status(500).json({ error: 'Unable to load published content.' });
  }
});

// GET /api/creator/drafts (Creator-scoped AI-powered Draft Content listing, filters, counts & pagination)
router.get('/drafts', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const creatorId = req.user!.id;
    const q = String(req.query.q || '').trim().slice(0, 160);
    const rawGroup = String(req.query.typeGroup || 'all').toLowerCase();
    const typeGroup: DraftTypeGroup = ['articles', 'videos', 'pdfs'].includes(rawGroup)
      ? (rawGroup as DraftTypeGroup)
      : 'all';
    const subjectId = parsePositiveInt(req.query.subjectId);
    const categoryId = parsePositiveInt(req.query.categoryId);
    const rawSort = String(req.query.sort || '').toLowerCase();
    const sort: 'newest' | 'oldest' | 'relevant' =
      rawSort === 'oldest'
        ? 'oldest'
        : rawSort === 'relevant'
        ? 'relevant'
        : rawSort === 'newest'
        ? 'newest'
        : q
        ? 'relevant'
        : 'newest';
    const page = Math.max(1, parsePositiveInt(req.query.page) || 1);
    const limit = Math.min(30, Math.max(1, parsePositiveInt(req.query.limit) || 9));

    const result = await runCreatorDraftSmartSearch({
      creatorId,
      q,
      typeGroup,
      subjectId,
      categoryId,
      sort,
      page,
      limit,
    });

    return res.json(result);
  } catch (error) {
    console.error('Creator drafts list error:', error);
    return res.status(500).json({ error: 'Unable to load draft content.' });
  }
});

// GET /api/creator/pending (Creator-scoped AI-powered Pending & Review submissions, counts, filters & pagination)
router.get('/pending', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const creatorId = req.user!.id;
    const q = String(req.query.q || '').trim().slice(0, 160);
    const rawStatus = String(req.query.status || 'all').toLowerCase();
    const statusFilter: PendingStatusFilter = ['under_review', 'changes_requested'].includes(rawStatus)
      ? (rawStatus as PendingStatusFilter)
      : 'all';
    const contentType = String(req.query.contentType || '').trim();
    const subjectId = parsePositiveInt(req.query.subjectId);
    const categoryId = parsePositiveInt(req.query.categoryId);
    const rawPricing = String(req.query.pricing || 'all').toLowerCase();
    const pricing: 'all' | 'free' | 'paid' = rawPricing === 'free' || rawPricing === 'paid' ? rawPricing : 'all';
    const rawSort = String(req.query.sort || '').toLowerCase();
    const sort: 'latest' | 'oldest' | 'relevant' =
      rawSort === 'oldest'
        ? 'oldest'
        : rawSort === 'relevant'
        ? 'relevant'
        : rawSort === 'latest'
        ? 'latest'
        : q
        ? 'relevant'
        : 'latest';
    const page = Math.max(1, parsePositiveInt(req.query.page) || 1);
    const limit = Math.min(30, Math.max(1, parsePositiveInt(req.query.limit) || 10));

    const result = await runCreatorPendingSmartSearch({
      creatorId,
      q,
      statusFilter,
      contentType,
      subjectId,
      categoryId,
      pricing,
      sort,
      page,
      limit,
    });

    // Attach real moderation dates, resubmission count, and feedback snippets from creatorContentHistory
    const ids = result.items.map((it) => it.id);
    const metaByContentId = new Map<
      number,
      { submittedAt: string; lastReviewedAt: string | null; feedbackSnippet: string | null; resubmissionCount: number }
    >();

    if (ids.length > 0) {
      const histRows = await db
        .select()
        .from(creatorContentHistory)
        .where(and(eq(creatorContentHistory.creatorId, creatorId), inArray(creatorContentHistory.contentId, ids)))
        .orderBy(desc(creatorContentHistory.createdAt));

      const grouped = new Map<number, typeof histRows>();
      for (const h of histRows) {
        if (!h.contentId) continue;
        const arr = grouped.get(h.contentId) || [];
        arr.push(h);
        grouped.set(h.contentId, arr);
      }

      for (const item of result.items) {
        const logs = grouped.get(item.id) || [];
        const submitLogs = logs.filter((l) => ['submitted_for_review', 'resubmitted'].includes(l.action));
        const reviewLogs = logs.filter((l) => ['changes_requested', 'rejected', 'removed', 'approved'].includes(l.action));
        const resubmissionCount = logs.filter((l) => l.action === 'resubmitted').length;

        const firstSubmit = submitLogs[submitLogs.length - 1];
        const latestSubmit = submitLogs[0];
        const latestReview = reviewLogs[0];

        const submittedAt = new Date(
          latestSubmit?.createdAt || firstSubmit?.createdAt || item.createdAt
        ).toISOString();
        const lastReviewedAt = latestReview
          ? new Date(latestReview.createdAt).toISOString()
          : item.status === 'changes_requested' && item.updatedAt
          ? new Date(item.updatedAt).toISOString()
          : null;

        const latestReviewDet = (latestReview?.details || {}) as Record<string, unknown>;
        const rawFb =
          item.rejectionReason ||
          (typeof latestReviewDet.feedback === 'string' ? latestReviewDet.feedback : '') ||
          '';
        const feedbackSnippet = rawFb ? rawFb.trim().slice(0, 140) : null;

        metaByContentId.set(item.id, {
          submittedAt,
          lastReviewedAt,
          feedbackSnippet,
          resubmissionCount,
        });
      }
    }

    return res.json({
      ...result,
      items: result.items.map((item) => {
        const extra = metaByContentId.get(item.id);
        return {
          ...item,
          submittedAt: extra?.submittedAt || new Date(item.createdAt).toISOString(),
          lastReviewedAt: extra?.lastReviewedAt || null,
          feedbackSnippet: extra?.feedbackSnippet || (item.rejectionReason ? item.rejectionReason.slice(0, 140) : null),
          resubmissionCount: extra?.resubmissionCount || 0,
        };
      }),
    });
  } catch (error) {
    console.error('Creator pending list error:', error);
    return res.status(500).json({ error: 'Unable to load pending submissions.' });
  }
});

// GET /api/creator/pending/:id (Detailed Submission View with real Moderation Timeline, Feedback History & Format Preview)
router.get('/pending/:id', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid submission ID.' });

    const [row] = await db
      .select({
        content: contents,
        categoryName: categories.name,
        subjectName: subjects.name,
      })
      .from(contents)
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(eq(contents.id, id))
      .limit(1);

    if (!row || row.content.deletedAt) {
      return res.status(404).json({ error: 'Submission not found.' });
    }
    const item = row.content;
    if (item.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only view your own submissions.' });
    }

    const [fileRows, tagRows, creatorUserRows, historyRows, auditRows] = await Promise.all([
      db.select().from(contentFiles).where(eq(contentFiles.contentId, id)),
      db.select().from(contentTags).where(eq(contentTags.contentId, id)),
      db.select({ name: users.name }).from(users).where(eq(users.id, item.creatorId)).limit(1),
      db
        .select()
        .from(creatorContentHistory)
        .where(eq(creatorContentHistory.contentId, id))
        .orderBy(asc(creatorContentHistory.createdAt)),
      db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, 'content'), eq(auditLogs.entityId, String(id))))
        .orderBy(asc(auditLogs.createdAt)),
    ]);

    const safeFiles = fileRows
      .filter((f) => f.fileType !== 'cover')
      .map((f) => {
        const signedToken = req.user ? createSignedFileToken(f.id, req.user.id, 900) : null;
        const isDoc = f.fileType === 'document';
        return {
          id: f.id,
          fileType: f.fileType,
          originalName: f.originalName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          isPreview: f.isPreview,
          previewSupported: !isDoc,
          previewNote: isDoc
            ? 'Inline browser preview is not supported for this document format. Download the file to view it.'
            : null,
          externalVideoUrl: f.externalVideoUrl
            ? normalizeExternalVideoUrl(f.externalVideoUrl) || f.externalVideoUrl
            : null,
          accessUrl: signedToken
            ? `/api/catalog/files/${f.id}?ft=${encodeURIComponent(signedToken)}`
            : `/api/catalog/files/${f.id}`,
        };
      });

    type TimelineEvent = {
      key: string;
      action: string;
      label: string;
      timestamp: string;
      status: string | null;
      note: string | null;
      correctionInstructions: string | null;
    };

    const timeline: TimelineEvent[] = [];
    const labelMap: Record<string, string> = {
      created: 'Content Created',
      submitted_for_review: 'Submitted for Review',
      under_review: 'Under Review',
      changes_requested: 'Changes Requested',
      resubmitted: 'Resubmitted for Review',
      approved: 'Approved & Published',
      rejected: 'Rejected by Moderator',
      removed: 'Removed by Moderator',
      moved_to_draft: 'Moved to Draft',
      updated: 'Updated Content',
      recovered: 'Recovered from Trash',
    };

    for (const h of historyRows) {
      const det = (h.details || {}) as Record<string, unknown>;
      const feedbackNote =
        typeof det.feedback === 'string' && det.feedback.trim()
          ? det.feedback.trim()
          : typeof det.previousFeedback === 'string' && det.previousFeedback.trim()
          ? `Prior feedback addressed: ${det.previousFeedback.trim()}`
          : null;
      const correction =
        typeof det.correctionInstructions === 'string' && det.correctionInstructions.trim()
          ? det.correctionInstructions.trim()
          : null;

      timeline.push({
        key: `hist-${h.id}`,
        action: h.action,
        label: labelMap[h.action] || h.action.replace(/_/g, ' '),
        timestamp: new Date(h.createdAt).toISOString(),
        status: typeof det.newStatus === 'string' ? det.newStatus : typeof det.status === 'string' ? det.status : null,
        note: feedbackNote,
        correctionInstructions: correction,
      });
    }

    // Backfill legacy auditLogs moderation events if they aren't already in historyRows
    for (const a of auditRows) {
      if (a.action !== 'moderate_content') continue;
      const det = (a.details || {}) as Record<string, unknown>;
      const st = String(det.status || '');
      if (!st) continue;
      const ts = new Date(a.createdAt).toISOString();
      const dup = timeline.some(
        (t) =>
          (t.action === st || (st === 'pending' && t.action === 'under_review')) &&
          Math.abs(new Date(t.timestamp).getTime() - new Date(ts).getTime()) < 5000
      );
      if (!dup) {
        timeline.push({
          key: `audit-${a.id}`,
          action: st === 'pending' ? 'under_review' : st,
          label: labelMap[st === 'pending' ? 'under_review' : st] || st,
          timestamp: ts,
          status: st,
          note: typeof det.rejectionReason === 'string' && det.rejectionReason.trim() ? det.rejectionReason.trim() : null,
          correctionInstructions: null,
        });
      }
    }

    if (timeline.length === 0) {
      timeline.push({
        key: 'created-fallback',
        action: 'created',
        label: 'Content Created',
        timestamp: new Date(item.createdAt).toISOString(),
        status: item.status,
        note: null,
        correctionInstructions: null,
      });
      if (item.status === 'pending' || item.status === 'changes_requested') {
        timeline.push({
          key: 'submitted-fallback',
          action: 'submitted_for_review',
          label: 'Submitted for Review',
          timestamp: new Date(item.createdAt).toISOString(),
          status: 'pending',
          note: null,
          correctionInstructions: null,
        });
      }
    }

    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const submitEvents = timeline.filter((t) =>
      ['submitted_for_review', 'resubmitted'].includes(t.action)
    );
    const resubmissionCount = timeline.filter((t) => t.action === 'resubmitted').length;
    const reviewFeedbackEvents = timeline
      .filter((t) => ['changes_requested', 'rejected', 'removed', 'approved'].includes(t.action))
      .map((t) => ({
        action: t.action,
        label: t.label,
        feedback: t.note,
        correctionInstructions: t.correctionInstructions,
        reviewedAt: t.timestamp,
      }))
      .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime());

    // Include prior feedback stored in resubmission event if there wasn't a separate changes_requested history row
    if (reviewFeedbackEvents.length === 0) {
      for (const h of historyRows) {
        const det = (h.details || {}) as Record<string, unknown>;
        if (h.action === 'resubmitted' && typeof det.previousFeedback === 'string' && det.previousFeedback.trim()) {
          reviewFeedbackEvents.push({
            action: String(det.previousStatus || 'changes_requested'),
            label: 'Previous Review Feedback',
            feedback: det.previousFeedback.trim(),
            correctionInstructions: null,
            reviewedAt: new Date(h.createdAt).toISOString(),
          });
        }
      }
    }

    const submittedAt =
      submitEvents[0]?.timestamp ||
      new Date(item.createdAt).toISOString();
    const lastSubmittedAt =
      submitEvents[submitEvents.length - 1]?.timestamp ||
      submittedAt;
    const lastReviewedAt =
      reviewFeedbackEvents[0]?.reviewedAt ||
      (item.status === 'approved' && item.publishedAt ? new Date(item.publishedAt).toISOString() : null);

    return res.json({
      content: {
        id: item.id,
        title: item.title,
        slug: item.slug,
        authorName: (item.authorName || '').trim() || creatorUserRows[0]?.name || null,
        publisherName: item.publisherName,
        shortDescription: item.shortDescription,
        bodyHtml: item.bodyHtml,
        previewHtml: item.previewHtml,
        coverImageUrl: item.coverImageUrl,
        categoryId: item.categoryId,
        categoryName: row.categoryName,
        subjectId: item.subjectId,
        subjectName: row.subjectName,
        language: item.language,
        contentType: item.contentType,
        classLevel: item.classLevel,
        chapter: item.chapter,
        topic: item.topic,
        chapterOrder: item.chapterOrder,
        durationSeconds: item.durationSeconds,
        studyLabel: item.studyLabel,
        isFree: item.isFree,
        priceInr: Number(item.priceInr || 0),
        status: item.status,
        rejectionReason: item.rejectionReason || null,
        ownershipConfirmed: Boolean(item.ownershipConfirmed),
        readingTimeMins: item.readingTimeMins,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        submittedAt,
        lastSubmittedAt,
        lastReviewedAt,
        resubmissionCount,
        tags: tagRows.map((t) => t.tag),
      },
      files: safeFiles,
      timeline,
      feedbackHistory: reviewFeedbackEvents,
      capabilities: {
        canEditResubmit: item.status === 'changes_requested',
        isUnderReview: item.status === 'pending',
        canAppeal: false,
      },
    });
  } catch (error) {
    console.error('Creator pending detail error:', error);
    return res.status(500).json({ error: 'Unable to load submission details.' });
  }
});

// GET /api/creator/contents/:id/details (Single creator-owned content details, preview assets & real analytics)
router.get('/contents/:id/details', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });

    const [row] = await db
      .select({
        content: contents,
        categoryName: categories.name,
        subjectName: subjects.name,
      })
      .from(contents)
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(eq(contents.id, id))
      .limit(1);

    if (!row || row.content.deletedAt) {
      return res.status(404).json({ error: 'Content not found.' });
    }
    const item = row.content;
    if (item.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only manage your own content.' });
    }

    const now = new Date();
    const todayYmd = formatIstYmd(now);
    const start30dUtc = istStartUtc(addDaysYmd(todayYmd, -29));
    const prev30dEndUtc = new Date(start30dUtc.getTime() - 1);
    const prev30dStartUtc = new Date(start30dUtc.getTime() - 30 * 86_400_000);

    const [fileRows, tagRows, uniqueViewRows, commentCountRows, dlWindowRows, earnWindowRows, creatorUserRows] =
      await Promise.all([
        db.select().from(contentFiles).where(eq(contentFiles.contentId, id)),
        db.select().from(contentTags).where(eq(contentTags.contentId, id)),
        db.execute(sql`
          SELECT COUNT(DISTINCT user_id)::int AS unique_views
          FROM user_activity_sessions
          WHERE content_id = ${id}
        `),
        db
          .select({ total: count() })
          .from(comments)
          .where(and(eq(comments.contentId, id), eq(comments.isHidden, false))),
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE created_at >= ${start30dUtc} AND created_at <= ${now})::int AS d30,
            COUNT(*) FILTER (WHERE created_at >= ${prev30dStartUtc} AND created_at <= ${prev30dEndUtc})::int AS dprev
          FROM content_downloads
          WHERE content_id = ${id}
        `),
        db.execute(sql`
          SELECT
            COALESCE(SUM(creator_earnings_inr), 0)::numeric(12,2) AS lifetime_earnings,
            COUNT(*)::int AS lifetime_sales,
            COALESCE(SUM(creator_earnings_inr) FILTER (WHERE created_at >= ${start30dUtc} AND created_at <= ${now}), 0)::numeric(12,2) AS e30,
            COALESCE(SUM(creator_earnings_inr) FILTER (WHERE created_at >= ${prev30dStartUtc} AND created_at <= ${prev30dEndUtc}), 0)::numeric(12,2) AS eprev,
            COUNT(*) FILTER (WHERE created_at >= ${start30dUtc} AND created_at <= ${now})::int AS s30,
            COUNT(*) FILTER (WHERE created_at >= ${prev30dStartUtc} AND created_at <= ${prev30dEndUtc})::int AS sprev
          FROM commission_records
          WHERE content_id = ${id} AND creator_id = ${item.creatorId} AND status = 'credited'
        `),
        db.select({ name: users.name }).from(users).where(eq(users.id, item.creatorId)).limit(1),
      ]);

    const uvAgg = (uniqueViewRows.rows?.[0] || {}) as Record<string, unknown>;
    const dlAgg = (dlWindowRows.rows?.[0] || {}) as Record<string, unknown>;
    const earnAgg = (earnWindowRows.rows?.[0] || {}) as Record<string, unknown>;

    const safeFiles = fileRows
      .filter((f) => f.fileType !== 'cover')
      .map((f) => {
        const signedToken = req.user ? createSignedFileToken(f.id, req.user.id, 900) : null;
        const isDoc = f.fileType === 'document';
        return {
          id: f.id,
          fileType: f.fileType,
          originalName: f.originalName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          isPreview: f.isPreview,
          previewSupported: !isDoc,
          previewNote: isDoc
            ? 'Inline browser preview is not supported for this document format. Download the file to view it.'
            : null,
          externalVideoUrl: f.externalVideoUrl
            ? normalizeExternalVideoUrl(f.externalVideoUrl) || f.externalVideoUrl
            : null,
          accessUrl: signedToken
            ? `/api/catalog/files/${f.id}?ft=${encodeURIComponent(signedToken)}`
            : `/api/catalog/files/${f.id}`,
        };
      });

    const d30 = Number(dlAgg.d30 || 0);
    const dprev = Number(dlAgg.dprev || 0);
    const s30 = Number(earnAgg.s30 || 0);
    const sprev = Number(earnAgg.sprev || 0);
    const e30 = Number(earnAgg.e30 || 0);
    const eprev = Number(earnAgg.eprev || 0);

    return res.json({
      content: {
        id: item.id,
        title: item.title,
        slug: item.slug,
        authorName: (item.authorName || '').trim() || creatorUserRows[0]?.name || null,
        publisherName: item.publisherName,
        shortDescription: item.shortDescription,
        bodyHtml: item.bodyHtml,
        coverImageUrl: item.coverImageUrl,
        categoryId: item.categoryId,
        categoryName: row.categoryName,
        subjectId: item.subjectId,
        subjectName: row.subjectName,
        language: item.language,
        contentType: item.contentType,
        classLevel: item.classLevel,
        chapter: item.chapter,
        topic: item.topic,
        chapterOrder: item.chapterOrder,
        durationSeconds: item.durationSeconds,
        studyLabel: item.studyLabel,
        isFree: item.isFree,
        priceInr: Number(item.priceInr || 0),
        status: item.status,
        rejectionReason: item.rejectionReason || null,
        ownershipConfirmed: Boolean(item.ownershipConfirmed),
        readingTimeMins: item.readingTimeMins,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        tags: tagRows.map((t) => t.tag),
      },
      files: safeFiles,
      stats: {
        viewsCount: Number(item.viewsCount || 0),
        uniqueViewsCount: Number(uvAgg.unique_views || 0),
        downloadsCount: Number(item.downloadsCount || 0),
        likesCount: Number(item.likesCount || 0),
        commentsCount: Number(commentCountRows[0]?.total || 0),
        avgRating: Number(item.avgRating || 0),
        reviewsCount: Number(item.reviewsCount || 0),
        salesCount: item.isFree ? 0 : Math.max(Number(item.purchasesCount || 0), Number(earnAgg.lifetime_sales || 0)),
        netEarningsInr: item.isFree ? 0 : Number(earnAgg.lifetime_earnings || 0),
        periodComparison: {
          downloadsLast30d: d30,
          downloadsPrev30d: dprev,
          downloadsGrowthPct: computeGrowthPct(d30, dprev),
          salesLast30d: item.isFree ? 0 : s30,
          salesPrev30d: item.isFree ? 0 : sprev,
          salesGrowthPct: item.isFree ? null : computeGrowthPct(s30, sprev),
          earningsLast30dInr: item.isFree ? 0 : e30,
          earningsPrev30dInr: item.isFree ? 0 : eprev,
          earningsGrowthPct: item.isFree ? null : computeGrowthPct(e30, eprev),
        },
      },
    });
  } catch (error) {
    console.error('Creator content details error:', error);
    return res.status(500).json({ error: 'Unable to load content details.' });
  }
});

// POST /api/creator/contents/:id/duplicate (Create independent draft copy with reset stats & safe file handling)
router.post('/contents/:id/duplicate', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  const copiedDiskPaths: string[] = [];
  const copiedFileThumbTasks: Array<{ id: number; storagePath: string; mimeType: string }> = [];

  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });

    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only duplicate your own content.' });
    }
    if (existing.deletedAt) {
      return res.status(400).json({ error: 'Recover deleted content from the Recovery Bin before duplicating.' });
    }

    const baseTitle = String(existing.title || 'Untitled').trim();
    const copyTitle = `${baseTitle.slice(0, 173)} (Copy)`;
    const copySlug = slugify(copyTitle);

    const [existingTags, existingFiles] = await Promise.all([
      db.select().from(contentTags).where(eq(contentTags.contentId, id)),
      db.select().from(contentFiles).where(eq(contentFiles.contentId, id)),
    ]);

    const duplicated = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(contents)
        .values({
          creatorId: existing.creatorId,
          title: copyTitle,
          slug: copySlug,
          authorName: existing.authorName,
          publisherName: existing.publisherName,
          shortDescription: existing.shortDescription,
          bodyHtml: existing.bodyHtml,
          previewHtml: existing.previewHtml,
          coverImageUrl: existing.coverImageUrl,
          categoryId: existing.categoryId,
          subjectId: existing.subjectId,
          language: existing.language,
          contentType: existing.contentType,
          classLevel: existing.classLevel,
          chapter: existing.chapter,
          topic: existing.topic,
          chapterOrder: existing.chapterOrder,
          durationSeconds: existing.durationSeconds,
          studyLabel: existing.studyLabel,
          priceInr: existing.priceInr,
          isFree: existing.isFree,
          customCommissionRate: existing.customCommissionRate,
          status: 'draft',
          previousStatus: null,
          deletedAt: null,
          deletedBy: null,
          purgeAfter: null,
          rejectionReason: null,
          isFeatured: false,
          ownershipConfirmed: existing.ownershipConfirmed,
          viewsCount: 0,
          downloadsCount: 0,
          likesCount: 0,
          purchasesCount: 0,
          avgRating: '0.00',
          reviewsCount: 0,
          readingTimeMins: existing.readingTimeMins,
          publishedAt: null,
        })
        .returning();

      if (existingTags.length > 0) {
        await tx
          .insert(contentTags)
          .values(existingTags.map((t) => ({ contentId: inserted.id, tag: t.tag })));
      }

      const oldToNewFileId = new Map<number, number>();

      for (const f of existingFiles) {
        if (f.storageProvider === 'external' || f.storagePath === 'external') {
          const [newF] = await tx
            .insert(contentFiles)
            .values({
              contentId: inserted.id,
              fileType: f.fileType,
              originalName: f.originalName,
              storagePath: 'external',
              storageProvider: 'external',
              mimeType: f.mimeType,
              sizeBytes: 0,
              isPreview: f.isPreview,
              externalVideoUrl: f.externalVideoUrl,
            })
            .returning();
          oldToNewFileId.set(f.id, newF.id);
          continue;
        }

        if (f.storageProvider === 'local' && f.storagePath) {
          const srcPath = path.resolve(storageRoot, path.basename(f.storagePath));
          if (srcPath.startsWith(storageRoot) && fs.existsSync(srcPath)) {
            const ext = path.extname(f.storagePath).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
            const destName = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
            const destPath = path.resolve(storageRoot, destName);
            fs.copyFileSync(srcPath, destPath);
            copiedDiskPaths.push(destPath);

            const [newF] = await tx
              .insert(contentFiles)
              .values({
                contentId: inserted.id,
                fileType: f.fileType,
                originalName: f.originalName,
                storagePath: destName,
                storageProvider: 'local',
                sha256Hash: f.sha256Hash,
                mimeType: f.mimeType,
                sizeBytes: f.sizeBytes,
                isPreview: f.isPreview,
                externalVideoUrl: null,
              })
              .returning();
            oldToNewFileId.set(f.id, newF.id);
            copiedFileThumbTasks.push({ id: newF.id, storagePath: destName, mimeType: f.mimeType });
          }
          continue;
        }

        if (f.storageProvider === 's3' && f.storageKey) {
          const [newF] = await tx
            .insert(contentFiles)
            .values({
              contentId: inserted.id,
              fileType: f.fileType,
              originalName: f.originalName,
              storagePath: f.storagePath,
              storageProvider: 's3',
              storageKey: f.storageKey,
              sha256Hash: f.sha256Hash,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              isPreview: f.isPreview,
              externalVideoUrl: null,
            })
            .returning();
          oldToNewFileId.set(f.id, newF.id);
        }
      }

      const coverMatch = existing.coverImageUrl?.match(/^\/api\/catalog\/files\/(\d+)/);
      if (coverMatch) {
        const oldCoverFileId = Number(coverMatch[1]);
        const newCoverFileId = oldToNewFileId.get(oldCoverFileId);
        const remappedCoverUrl = newCoverFileId ? `/api/catalog/files/${newCoverFileId}` : null;
        const [updatedCover] = await tx
          .update(contents)
          .set({ coverImageUrl: remappedCoverUrl })
          .where(eq(contents.id, inserted.id))
          .returning();
        return updatedCover;
      }

      return inserted;
    });

    for (const task of copiedFileThumbTasks) {
      enqueueThumbnailGeneration(task.id, task.storagePath, task.mimeType);
    }

    await recordCreatorHistory({
      creatorId: existing.creatorId,
      contentId: duplicated.id,
      action: 'duplicated',
      contentTitle: duplicated.title,
      contentType: duplicated.contentType,
      authorName: duplicated.authorName,
      details: {
        sourceContentId: existing.id,
        sourceTitle: existing.title,
        slug: duplicated.slug,
        status: duplicated.status,
      },
    });
    invalidateCatalogCache();
    syncContentEmbedding(duplicated.id).catch(() => {});

    return res.status(201).json({
      content: duplicated,
      message: 'Content duplicated as a draft.',
    });
  } catch (error) {
    for (const p of copiedDiskPaths) {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    }
    console.error('Duplicate content error:', error);
    return res.status(500).json({ error: 'Unable to duplicate content.' });
  }
});

// POST /api/creator/contents/:id/move-to-draft (Unpublish published content to draft while preserving purchases/analytics)
router.post('/contents/:id/move-to-draft', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });

    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only manage your own content.' });
    }
    if (existing.deletedAt) {
      return res.status(400).json({ error: 'Deleted content cannot be moved to Draft directly. Recover it first.' });
    }
    if (existing.status !== 'approved') {
      return res.status(400).json({ error: 'Only published content can be moved to Draft.' });
    }

    const [updated] = await db
      .update(contents)
      .set({
        status: 'draft',
        updatedAt: new Date(),
      })
      .where(eq(contents.id, id))
      .returning();

    await recordCreatorHistory({
      creatorId: existing.creatorId,
      contentId: updated.id,
      action: 'moved_to_draft',
      contentTitle: updated.title,
      contentType: updated.contentType,
      authorName: updated.authorName,
      details: {
        slug: updated.slug,
        previousStatus: existing.status,
        newStatus: 'draft',
        viewsCount: existing.viewsCount,
        downloadsCount: existing.downloadsCount,
        purchasesCount: existing.purchasesCount,
      },
    });
    invalidateCatalogCache();
    syncContentEmbedding(updated.id).catch(() => {});

    return res.json({
      content: updated,
      message: 'Content moved to Draft successfully.',
    });
  } catch (error) {
    console.error('Move to draft error:', error);
    return res.status(500).json({ error: 'Unable to move content to Draft.' });
  }
});

// POST /api/creator/contents/:id/publish (Publish a creator-owned draft or submit for admin approval)
router.post('/contents/:id/publish', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid content ID.' });

    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only publish your own content.' });
    }
    if (existing.deletedAt) {
      return res.status(400).json({ error: 'Deleted content cannot be published. Recover it first.' });
    }
    if (existing.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft content can be published from Drafts.' });
    }

    const title = String(existing.title || '').trim();
    const desc = String(existing.shortDescription || '').trim();
    if (title.length < 4 || title.length > 180) {
      return res.status(400).json({ error: 'Title must be between 4 and 180 characters before publishing.' });
    }
    if (desc.length < 15) {
      return res.status(400).json({ error: 'Short description must be at least 15 characters before publishing.' });
    }
    if (!SUPPORTED_CONTENT_TYPES.includes(existing.contentType)) {
      return res.status(400).json({ error: 'Please select a valid content type before publishing.' });
    }
    if (!String(existing.language || '').trim()) {
      return res.status(400).json({ error: 'Please select a language before publishing.' });
    }
    const priceNum = Number(existing.priceInr || 0);
    if (!existing.isFree && (Number.isNaN(priceNum) || priceNum < 10 || priceNum > 50000)) {
      return res.status(400).json({ error: 'Paid content price must be between ₹10 and ₹50,000 before publishing.' });
    }

    const ownershipConfirmed = Boolean(req.body?.ownershipConfirmed) || Boolean(existing.ownershipConfirmed);
    if (!ownershipConfirmed) {
      return res.status(400).json({
        error: 'Please confirm copyright ownership or publishing permission before publishing.',
      });
    }

    const attachedFiles = await db
      .select({ id: contentFiles.id, fileType: contentFiles.fileType })
      .from(contentFiles)
      .where(eq(contentFiles.contentId, id));
    const nonCoverFiles = attachedFiles.filter((f) => f.fileType !== 'cover');
    const plainBodyText = String(existing.bodyHtml || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (plainBodyText.length < 10 && nonCoverFiles.length === 0) {
      return res.status(400).json({
        error: 'Add rich-text content or attach a PDF, video, image, or document file before publishing.',
      });
    }

    const [approvalSetting] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'require_content_approval'))
      .limit(1);
    const requireApproval = approvalSetting?.value !== 'false';

    const now = new Date();
    const nextStatus = !requireApproval || req.user!.role === 'admin' ? 'approved' : 'pending';
    const publishedAt = nextStatus === 'approved' ? existing.publishedAt || now : existing.publishedAt;

    const [updated] = await db
      .update(contents)
      .set({
        status: nextStatus,
        ownershipConfirmed,
        publishedAt,
        updatedAt: now,
      })
      .where(eq(contents.id, id))
      .returning();

    if (nextStatus === 'pending') {
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
      if (admins.length > 0) {
        await db.insert(notifications).values(
          admins.map((a) => ({
            userId: a.id,
            type: 'content_submission',
            title: 'New content awaiting approval',
            message: `${req.user!.name} submitted "${title}" (${existing.contentType}) for review.`,
            link: '#/admin/approvals',
          }))
        );
      }
    }

    await recordCreatorHistory({
      creatorId: existing.creatorId,
      contentId: updated.id,
      action: nextStatus === 'approved' ? 'published' : 'submitted_for_review',
      contentTitle: updated.title,
      contentType: updated.contentType,
      authorName: updated.authorName,
      details: {
        slug: updated.slug,
        previousStatus: 'draft',
        newStatus: nextStatus,
      },
    });
    invalidateCatalogCache();
    syncContentEmbedding(updated.id).catch(() => {});

    return res.json({
      content: updated,
      status: nextStatus,
      message:
        nextStatus === 'approved'
          ? 'Content published live!'
          : 'Draft submitted for administrator approval.',
    });
  } catch (error) {
    console.error('Publish draft error:', error);
    return res.status(500).json({ error: 'Unable to publish draft content.' });
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
    const classLevel = String(req.body?.classLevel || '').trim().slice(0, 60) || null;
    const chapter = String(req.body?.chapter || '').trim().slice(0, 140) || null;
    const topic = String(req.body?.topic || '').trim().slice(0, 140) || null;
    const studyLabel = String(req.body?.studyLabel || '').trim().slice(0, 60) || null;
    const rawChapterOrder = req.body?.chapterOrder ? Number(req.body.chapterOrder) : null;
    const chapterOrder =
      rawChapterOrder && Number.isInteger(rawChapterOrder) && rawChapterOrder > 0 && rawChapterOrder <= 500
        ? rawChapterOrder
        : null;
    const rawDurationSeconds = req.body?.durationSeconds ? Number(req.body.durationSeconds) : null;
    const durationSeconds =
      rawDurationSeconds && Number.isFinite(rawDurationSeconds) && rawDurationSeconds > 0
        ? Math.min(86400, Math.round(rawDurationSeconds))
        : null;
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
        classLevel,
        chapter,
        topic,
        chapterOrder,
        durationSeconds,
        studyLabel,
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
      action: status === 'approved' ? 'published' : status === 'pending' ? 'submitted_for_review' : 'created',
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
    syncContentEmbedding(created.id).catch(() => {});

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
    if (existing.deletedAt) {
      return res.status(400).json({ error: 'Deleted content cannot be edited until recovered.' });
    }
    if (existing.status === 'pending' && req.user!.role !== 'admin') {
      return res.status(403).json({
        error: 'This submission is currently Under Review and cannot be edited until moderation completes.',
      });
    }

    const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
    const authorName =
      req.body?.authorName !== undefined
        ? String(req.body.authorName || '').trim().slice(0, 120) || null
        : existing.authorName;
    const publisherName =
      req.body?.publisherName !== undefined
        ? String(req.body.publisherName || '').trim().slice(0, 120) || null
        : existing.publisherName;
    const shortDescription =
      req.body?.shortDescription !== undefined
        ? String(req.body.shortDescription).trim()
        : existing.shortDescription;
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
    const language = req.body?.language !== undefined ? String(req.body.language).trim() : existing.language;
    const contentType =
      req.body?.contentType !== undefined ? String(req.body.contentType).trim() : existing.contentType;
    const classLevel =
      req.body?.classLevel !== undefined
        ? String(req.body.classLevel || '').trim().slice(0, 60) || null
        : existing.classLevel;
    const chapter =
      req.body?.chapter !== undefined
        ? String(req.body.chapter || '').trim().slice(0, 140) || null
        : existing.chapter;
    const topic =
      req.body?.topic !== undefined
        ? String(req.body.topic || '').trim().slice(0, 140) || null
        : existing.topic;
    const studyLabel =
      req.body?.studyLabel !== undefined
        ? String(req.body.studyLabel || '').trim().slice(0, 60) || null
        : existing.studyLabel;
    const chapterOrder =
      req.body?.chapterOrder !== undefined
        ? req.body.chapterOrder && Number.isInteger(Number(req.body.chapterOrder)) && Number(req.body.chapterOrder) > 0
          ? Math.min(500, Number(req.body.chapterOrder))
          : null
        : existing.chapterOrder;
    const durationSeconds =
      req.body?.durationSeconds !== undefined
        ? req.body.durationSeconds && Number.isFinite(Number(req.body.durationSeconds)) && Number(req.body.durationSeconds) > 0
          ? Math.min(86400, Math.round(Number(req.body.durationSeconds)))
          : null
        : existing.durationSeconds;
    const isFree = req.body?.isFree !== undefined ? Boolean(req.body.isFree) : existing.isFree;
    const rawPrice =
      req.body?.priceInr !== undefined ? Number(req.body.priceInr) : Number(existing.priceInr);
    const ownershipConfirmed =
      req.body?.ownershipConfirmed !== undefined
        ? Boolean(req.body.ownershipConfirmed)
        : existing.ownershipConfirmed;

    if (title.length < 4 || title.length > 180) {
      return res.status(400).json({ error: 'Title must be between 4 and 180 characters.' });
    }
    if (shortDescription.length < 15) {
      return res.status(400).json({ error: 'Short description must be at least 15 characters.' });
    }
    if (!SUPPORTED_CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'Invalid content type selected.' });
    }
    if (!language) {
      return res.status(400).json({ error: 'Language is required.' });
    }
    if (!isFree && (Number.isNaN(rawPrice) || rawPrice < 10 || rawPrice > 50000)) {
      return res.status(400).json({ error: 'Paid content price must be between ₹10 and ₹50,000.' });
    }

    if (categoryId !== null) {
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).json({ error: 'Invalid category selected.' });
      }
      const [catRow] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
      if (!catRow) return res.status(400).json({ error: 'Selected category does not exist.' });
    }

    if (subjectId !== null) {
      if (!Number.isInteger(subjectId) || subjectId <= 0) {
        return res.status(400).json({ error: 'Invalid subject selected.' });
      }
      const [subRow] = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId)).limit(1);
      if (!subRow) return res.status(400).json({ error: 'Selected subject does not exist.' });
    }

    let normalizedVideoUrl: string | null = null;
    if (req.body?.externalVideoUrl !== undefined) {
      const rawExternalVideoUrl = String(req.body.externalVideoUrl || '').trim();
      normalizedVideoUrl = rawExternalVideoUrl
        ? normalizeExternalVideoUrl(rawExternalVideoUrl) || ''
        : '';
      if (rawExternalVideoUrl && !normalizedVideoUrl) {
        return res.status(400).json({
          error: 'Please enter a valid YouTube share link (youtu.be/... or youtube.com/watch?v=...), Vimeo link, or HTTPS video embed URL.',
        });
      }
    }

    const [approvalSetting] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'require_content_approval'))
      .limit(1);
    const requireApproval = approvalSetting?.value !== 'false';

    const existingExternalVideos =
      req.body?.externalVideoUrl !== undefined
        ? await db
            .select()
            .from(contentFiles)
            .where(
              and(
                eq(contentFiles.contentId, id),
                eq(contentFiles.fileType, 'video'),
                eq(contentFiles.storagePath, 'external')
              )
            )
        : [];
    const existingExtUrl = existingExternalVideos[0]?.externalVideoUrl || '';

    const isResubmitAction = req.body?.action === 'resubmit';
    const isSubmitAction = req.body?.action === 'submit' || isResubmitAction;
    const isResubmission =
      isSubmitAction && (existing.status === 'changes_requested' || existing.status === 'rejected');

    let nextStatus = existing.status;
    let publishedAt = existing.publishedAt;
    let nextRejectionReason = existing.rejectionReason;
    if (isSubmitAction) {
      if (!ownershipConfirmed) {
        return res.status(400).json({
          error: 'Please confirm copyright ownership before submitting for publication.',
        });
      }
      if (!requireApproval || req.user!.role === 'admin') {
        nextStatus = 'approved';
        publishedAt = publishedAt || new Date();
        nextRejectionReason = null;
      } else {
        nextStatus = 'pending';
        if (isResubmission) {
          nextRejectionReason = null;
        }
      }
    } else if (req.body?.action === 'draft') {
      nextStatus = 'draft';
    } else if (existing.status === 'approved' && requireApproval && req.user!.role !== 'admin') {
      // Any update mutation on approved content follows review policy only when substantive fields actually change
      const bodyChanged = req.body?.bodyHtml !== undefined && (bodyHtml || '') !== (existing.bodyHtml || '');
      const pricingChanged = isFree !== existing.isFree || Number(rawPrice) !== Number(existing.priceInr);
      const videoChanged =
        req.body?.externalVideoUrl !== undefined && (normalizedVideoUrl || '') !== existingExtUrl;
      if (bodyChanged || pricingChanged || videoChanged) {
        nextStatus = 'pending';
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [savedRow] = await tx
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
          classLevel,
          chapter,
          topic,
          chapterOrder,
          durationSeconds,
          studyLabel,
          isFree,
          priceInr: isFree ? '0.00' : rawPrice.toFixed(2),
          ownershipConfirmed,
          status: nextStatus,
          rejectionReason: nextRejectionReason,
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
        await tx.delete(contentTags).where(eq(contentTags.contentId, id));
        if (tagsInput.length > 0) {
          const uniqueTags = Array.from(
            new Set(tagsInput.map((t) => t.toLowerCase().slice(0, 40)))
          ).slice(0, 10);
          await tx.insert(contentTags).values(uniqueTags.map((tag) => ({ contentId: id, tag })));
        }
      }

      if (req.body?.externalVideoUrl !== undefined) {
        if (normalizedVideoUrl) {
          if (existingExternalVideos.length > 0) {
            await tx
              .update(contentFiles)
              .set({
                externalVideoUrl: normalizedVideoUrl,
                originalName: `${title} - Video Lecture`,
              })
              .where(eq(contentFiles.id, existingExternalVideos[0].id));
          } else {
            await tx.insert(contentFiles).values({
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
            await tx.delete(contentFiles).where(eq(contentFiles.id, ev.id));
          }
        }
      }

      return savedRow;
    });

    if (nextStatus === 'pending' && existing.status !== 'pending') {
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'));
      if (admins.length > 0) {
        await db.insert(notifications).values(
          admins.map((a) => ({
            userId: a.id,
            type: 'content_submission',
            title: isResubmission ? 'Resubmitted content awaiting approval' : 'Updated content awaiting approval',
            message: `${req.user!.name} ${isResubmission ? 'resubmitted' : 'updated'} "${title}" (${contentType}) for review.`,
            link: '#/admin/approvals',
          }))
        );
      }
    }

    const historyAction = isResubmission
      ? 'resubmitted'
      : isSubmitAction && existing.status === 'draft' && nextStatus === 'pending'
      ? 'submitted_for_review'
      : 'updated';

    await recordCreatorHistory({
      creatorId: existing.creatorId,
      contentId: updated.id,
      action: historyAction,
      contentTitle: updated.title,
      contentType: updated.contentType,
      authorName: updated.authorName,
      details: {
        slug: updated.slug,
        previousStatus: existing.status,
        newStatus: updated.status,
        status: updated.status,
        previousFeedback: isResubmission ? existing.rejectionReason || null : undefined,
        publisherName: updated.publisherName,
        isFree: updated.isFree,
        priceInr: updated.priceInr,
      },
    });
    invalidateCatalogCache();
    syncContentEmbedding(updated.id).catch(() => {});

    return res.json({
      content: updated,
      message:
        isResubmission && nextStatus === 'pending'
          ? 'Changes saved and content resubmitted for moderation review.'
          : nextStatus === 'approved'
          ? 'Publication updated live!'
          : nextStatus === 'pending'
          ? 'Changes saved and submitted for administrator approval.'
          : existing.status === 'draft'
          ? 'Draft changes saved.'
          : 'Content saved as draft.',
    });
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
    syncContentEmbedding(recovered.id).catch(() => {});

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

    // Protect student purchase entitlements and creator commission/payment accounting ledgers
    const [pRow, cRow, payRow] = await Promise.all([
      db.select({ id: purchases.id }).from(purchases).where(eq(purchases.contentId, id)).limit(1),
      db.select({ id: commissionRecords.id }).from(commissionRecords).where(eq(commissionRecords.contentId, id)).limit(1),
      db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.contentId, id), eq(payments.status, 'captured')))
        .limit(1),
    ]);
    if (pRow.length > 0 || cRow.length > 0 || payRow.length > 0) {
      return res.status(409).json({
        error: 'This publication has verified student purchases or financial earnings records and cannot be permanently erased.',
      });
    }

    const files = await db.select().from(contentFiles).where(eq(contentFiles.contentId, id));
    for (const f of files) {
      if (f.storageProvider === 'local' && f.storagePath && f.storagePath !== 'external') {
        const refRows = await db
          .select({ value: count() })
          .from(contentFiles)
          .where(and(eq(contentFiles.storagePath, f.storagePath), sql`${contentFiles.contentId} <> ${id}`));
        if (Number(refRows[0]?.value || 0) === 0) {
          const resolved = path.resolve(storageRoot, path.basename(f.storagePath));
          if (resolved.startsWith(storageRoot) && fs.existsSync(resolved)) {
            fs.unlinkSync(resolved);
          }
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
    if (content.status === 'pending' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot modify files while submission is Under Review.' });
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
    if (content.status === 'pending' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot modify files while submission is Under Review.' });
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
    if (content.status === 'pending' && req.user!.role !== 'admin') {
      cleanupDir();
      return res.status(403).json({ error: 'Cannot modify files while submission is Under Review.' });
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
      if (content.status === 'pending' && req.user!.role !== 'admin') {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Cannot modify files while submission is Under Review.' });
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
      if (content.status === 'pending' && req.user!.role !== 'admin') {
        cleanupUploaded();
        return res.status(403).json({ error: 'Cannot modify files while submission is Under Review.' });
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
    if (content.status === 'pending' && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot modify files while submission is Under Review.' });
    }

    if (file.storageProvider === 'local' && file.storagePath && file.storagePath !== 'external') {
      const refRows = await db
        .select({ value: count() })
        .from(contentFiles)
        .where(and(eq(contentFiles.storagePath, file.storagePath), sql`${contentFiles.id} <> ${fileId}`));
      if (Number(refRows[0]?.value || 0) === 0) {
        const resolved = path.resolve(storageRoot, path.basename(file.storagePath));
        if (resolved.startsWith(storageRoot) && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      }
    }
    await db.delete(contentFiles).where(eq(contentFiles.id, fileId));
    invalidateCatalogCache();
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
