import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminSettings,
  categories,
  comments,
  contactMessages,
  contentFiles,
  contents,
  contentTags,
  creatorProfiles,
  followers,
  purchases,
  reviews,
  subjects,
  users,
} from '../db/schema.ts';
import { getOrCompute, setCache } from '../lib/cache.ts';
import { queueContentView } from '../lib/jobs.ts';
import {
  createPresignedObjectUrl,
  getOrCreateOptimizedImageVariant,
  negotiateImageFormat,
  normalizeRequestedWidth,
} from '../lib/media.ts';
import {
  createSignedFileToken,
  getStorageRoot,
  normalizeExternalVideoUrl,
} from '../lib/security.ts';
import { optionalAuth, requireAuth, type AuthRequest } from '../middleware/auth.ts';

const router = Router();

// ===== CURSOR ENCODING / DECODING FOR KEYSET INFINITE SCROLL =====
interface FeedCursor {
  v: string | number | null;
  id: number;
}

function encodeFeedCursor(v: string | number | Date | null | undefined, id: number): string {
  const norm = v instanceof Date ? v.toISOString() : v ?? null;
  return Buffer.from(JSON.stringify({ v: norm, id })).toString('base64url');
}

function decodeFeedCursor(raw: string): FeedCursor | null {
  if (!raw || raw.length > 256) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as FeedCursor;
    if (!parsed || !Number.isInteger(parsed.id) || parsed.id <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function buildHomeCatalogPayload() {
  const baseSelect = {
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
    isFeatured: contents.isFeatured,
    viewsCount: contents.viewsCount,
    likesCount: contents.likesCount,
    purchasesCount: contents.purchasesCount,
    avgRating: contents.avgRating,
    reviewsCount: contents.reviewsCount,
    readingTimeMins: contents.readingTimeMins,
    publishedAt: contents.publishedAt,
    createdAt: contents.createdAt,
    categoryId: contents.categoryId,
    categoryName: categories.name,
    categorySlug: categories.slug,
    subjectName: subjects.name,
    creatorId: users.id,
    creatorName: sql<string>`COALESCE(NULLIF(TRIM(${contents.authorName}), ''), ${users.name})`,
    creatorAvatar: users.avatarUrl,
  };

  const activeApproved = and(eq(contents.status, 'approved'), isNull(contents.deletedAt));

  const [settingsRows, categoryRows, approvedCounts, trending, countsRow] = await Promise.all([
    db.select().from(adminSettings),
    db.select().from(categories).orderBy(asc(categories.displayOrder), asc(categories.name)),
    db
      .select({ categoryId: contents.categoryId, total: count() })
      .from(contents)
      .where(activeApproved)
      .groupBy(contents.categoryId),
    db
      .select(baseSelect)
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(activeApproved)
      .orderBy(desc(contents.isFeatured), desc(contents.viewsCount), desc(contents.likesCount))
      .limit(4),
    db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM contents WHERE status = 'approved' AND deleted_at IS NULL) AS published_works,
        (SELECT COUNT(*)::int FROM creator_profiles) AS active_creators,
        (SELECT COUNT(*)::int FROM users) AS registered_members
    `),
  ]);

  const settings: Record<string, string> = {};
  for (const row of settingsRows) settings[row.key] = row.value;

  const countByCat = new Map<number, number>();
  for (const r of approvedCounts) {
    if (r.categoryId) countByCat.set(r.categoryId, Number(r.total));
  }

  const featuredCategories = categoryRows.map((c) => ({
    ...c,
    contentCount: countByCat.get(c.id) || 0,
  }));

  const statsRaw = (countsRow.rows?.[0] || {}) as Record<string, unknown>;

  return {
    settings,
    categories: featuredCategories,
    trending,
    stats: {
      publishedWorks: Number(statsRaw.published_works || 0),
      activeCreators: Number(statsRaw.active_creators || 0),
      registeredMembers: Number(statsRaw.registered_members || 0),
      defaultCommissionRate: Number(settings.default_commission_rate || 10),
    },
  };
}

export async function warmHomeCache(): Promise<void> {
  try {
    const payload = await buildHomeCatalogPayload();
    setCache('catalog:home', payload, 60_000);
  } catch (err) {
    console.warn('Home cache warmup skipped:', (err as Error).message);
  }
}

// GET /api/catalog/home (Single-flight deduplicated + 60s TTL cache + CDN stale-while-revalidate)
router.get('/home', async (_req, res) => {
  try {
    const payload = await getOrCompute('catalog:home', 60_000, buildHomeCatalogPayload);
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return res.json(payload);
  } catch (error) {
    console.error('Home catalog error:', error);
    return res.status(500).json({ error: 'Unable to load homepage catalog.' });
  }
});

// GET /api/catalog/categories (Authenticated members only — Single-flight deduplicated + 90s TTL cache)
router.get('/categories', requireAuth, async (_req, res) => {
  try {
    const payload = await getOrCompute('catalog:categories', 90_000, async () => {
      const [cats, subjs, counts] = await Promise.all([
        db.select().from(categories).orderBy(asc(categories.displayOrder), asc(categories.name)),
        db
          .select()
          .from(subjects)
          .orderBy(
            sql`CASE WHEN LOWER(${subjects.name}) = 'other' THEN 1 ELSE 0 END`,
            asc(subjects.id)
          ),
        db
          .select({ categoryId: contents.categoryId, total: count() })
          .from(contents)
          .where(and(eq(contents.status, 'approved'), isNull(contents.deletedAt)))
          .groupBy(contents.categoryId),
      ]);

      const countMap = new Map<number, number>();
      for (const row of counts) {
        if (row.categoryId) countMap.set(row.categoryId, Number(row.total));
      }

      const grouped = cats.map((c) => ({
        ...c,
        contentCount: countMap.get(c.id) || 0,
        subjects: subjs.filter((s) => s.categoryId === c.id),
      }));

      return { categories: grouped, subjects: subjs };
    });

    res.setHeader('Cache-Control', 'private, max-age=45');
    return res.json(payload);
  } catch (error) {
    console.error('Categories error:', error);
    return res.status(500).json({ error: 'Unable to fetch categories.' });
  }
});

// GET /api/catalog/contents (Cursor-based Infinite Scroll feed — authenticated members only)
router.get('/contents', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 120);
    const categorySlug = String(req.query.category || '').trim().slice(0, 80);
    const subjectSlug = String(req.query.subject || '').trim().slice(0, 80);
    const contentType = String(req.query.contentType || '').trim().slice(0, 60);
    const language = String(req.query.language || '').trim().slice(0, 40);
    const pricing = String(req.query.pricing || 'all').trim(); // 'all' | 'free' | 'paid'
    const sort = String(req.query.sort || 'latest').trim();
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 10)));
    const cursorRaw = String(req.query.cursor || '').trim();
    const cursor = cursorRaw ? decodeFeedCursor(cursorRaw) : null;
    const includeTotal = !cursor || req.query.includeTotal === '1';

    // Cache non-search feed pages briefly with single-flight deduplication
    const cacheKey =
      !q
        ? `catalog:feed:${categorySlug}:${subjectSlug}:${contentType}:${language}:${pricing}:${sort}:${limit}:${cursorRaw || 'first'}`
        : null;

    const computeFeed = async () => {
      const conditions = [eq(contents.status, 'approved'), isNull(contents.deletedAt)];

      if (categorySlug) {
        const [cat] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.slug, categorySlug))
          .limit(1);
        if (cat) conditions.push(eq(contents.categoryId, cat.id));
        else {
          return {
            items: [],
            total: 0,
            limit,
            nextCursor: null,
            hasMore: false,
          };
        }
      }

      if (subjectSlug) {
        const [subj] = await db
          .select({ id: subjects.id })
          .from(subjects)
          .where(eq(subjects.slug, subjectSlug))
          .limit(1);
        if (subj) conditions.push(eq(contents.subjectId, subj.id));
      }

      if (contentType) {
        if (contentType === 'PoemsAndStories') {
          conditions.push(inArray(contents.contentType, ['Poems', 'Stories']));
        } else if (contentType === 'StudyMaterials') {
          conditions.push(
            inArray(contents.contentType, [
              'Notes',
              'PDF / Documents',
              'E-books',
              'Online Tutorials',
              'Research Papers',
            ])
          );
        } else {
          conditions.push(eq(contents.contentType, contentType));
        }
      }

      if (language && language !== 'all') {
        conditions.push(eq(contents.language, language));
      }

      if (pricing === 'free') {
        conditions.push(eq(contents.isFree, true));
      } else if (pricing === 'paid') {
        conditions.push(eq(contents.isFree, false));
      }

      if (q) {
        const pattern = `%${q}%`;
        const searchOr = [
          ilike(contents.title, pattern),
          ilike(contents.authorName, pattern),
          ilike(contents.publisherName, pattern),
          ilike(contents.shortDescription, pattern),
          ilike(contents.contentType, pattern),
          ilike(users.name, pattern),
          ilike(categories.name, pattern),
          ilike(subjects.name, pattern),
          sql`EXISTS (SELECT 1 FROM content_tags ct WHERE ct.content_id = ${contents.id} AND ct.tag ILIKE ${pattern})`,
        ];
        conditions.push(or(...searchOr)!);
      }

      const baseWhere = and(...conditions);
      const cursorConditions = [...conditions];

      // Keyset cursor predicate aligned with composite indexes (O(log N) seeks instead of O(N) OFFSET scans)
      let orderByClause;
      const sortTimestampExpr = sql`COALESCE(${contents.publishedAt}, ${contents.createdAt})`;

      switch (sort) {
        case 'popular':
          orderByClause = [desc(contents.viewsCount), desc(contents.id)];
          if (cursor && typeof cursor.v === 'number') {
            cursorConditions.push(
              sql`(${contents.viewsCount} < ${cursor.v} OR (${contents.viewsCount} = ${cursor.v} AND ${contents.id} < ${cursor.id}))`
            );
          }
          break;
        case 'highest_rated':
          orderByClause = [desc(contents.avgRating), desc(contents.id)];
          if (cursor && cursor.v !== null) {
            cursorConditions.push(
              sql`(${contents.avgRating} < ${String(cursor.v)}::numeric OR (${contents.avgRating} = ${String(cursor.v)}::numeric AND ${contents.id} < ${cursor.id}))`
            );
          }
          break;
        case 'price_asc':
          orderByClause = [asc(contents.priceInr), desc(contents.id)];
          if (cursor && cursor.v !== null) {
            cursorConditions.push(
              sql`(${contents.priceInr} > ${String(cursor.v)}::numeric OR (${contents.priceInr} = ${String(cursor.v)}::numeric AND ${contents.id} < ${cursor.id}))`
            );
          }
          break;
        case 'price_desc':
          orderByClause = [desc(contents.priceInr), desc(contents.id)];
          if (cursor && cursor.v !== null) {
            cursorConditions.push(
              sql`(${contents.priceInr} < ${String(cursor.v)}::numeric OR (${contents.priceInr} = ${String(cursor.v)}::numeric AND ${contents.id} < ${cursor.id}))`
            );
          }
          break;
        default:
          orderByClause = [desc(sortTimestampExpr), desc(contents.id)];
          if (cursor && typeof cursor.v === 'string') {
            cursorConditions.push(
              sql`(${sortTimestampExpr} < ${cursor.v}::timestamp OR (${sortTimestampExpr} = ${cursor.v}::timestamp AND ${contents.id} < ${cursor.id}))`
            );
          }
          break;
      }

      const fetchQuery = db
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
          isFeatured: contents.isFeatured,
          viewsCount: contents.viewsCount,
          likesCount: contents.likesCount,
          purchasesCount: contents.purchasesCount,
          avgRating: contents.avgRating,
          reviewsCount: contents.reviewsCount,
          readingTimeMins: contents.readingTimeMins,
          publishedAt: contents.publishedAt,
          createdAt: contents.createdAt,
          categoryName: categories.name,
          categorySlug: categories.slug,
          subjectName: subjects.name,
          creatorId: users.id,
          creatorName: sql<string>`COALESCE(NULLIF(TRIM(${contents.authorName}), ''), ${users.name})`,
        })
        .from(contents)
        .innerJoin(users, eq(contents.creatorId, users.id))
        .leftJoin(categories, eq(contents.categoryId, categories.id))
        .leftJoin(subjects, eq(contents.subjectId, subjects.id))
        .where(and(...cursorConditions))
        .orderBy(...orderByClause)
        .limit(limit + 1);

      const totalQuery = includeTotal
        ? db
            .select({ value: count() })
            .from(contents)
            .innerJoin(users, eq(contents.creatorId, users.id))
            .leftJoin(categories, eq(contents.categoryId, categories.id))
            .leftJoin(subjects, eq(contents.subjectId, subjects.id))
            .where(baseWhere)
        : Promise.resolve(null);

      const [rawRows, totalRows] = await Promise.all([fetchQuery, totalQuery]);

      const hasMore = rawRows.length > limit;
      const items = hasMore ? rawRows.slice(0, limit) : rawRows;

      let nextCursor: string | null = null;
      if (hasMore && items.length > 0) {
        const last = items[items.length - 1];
        switch (sort) {
          case 'popular':
            nextCursor = encodeFeedCursor(last.viewsCount, last.id);
            break;
          case 'highest_rated':
            nextCursor = encodeFeedCursor(last.avgRating, last.id);
            break;
          case 'price_asc':
          case 'price_desc':
            nextCursor = encodeFeedCursor(last.priceInr, last.id);
            break;
          default:
            nextCursor = encodeFeedCursor(last.publishedAt || last.createdAt, last.id);
            break;
        }
      }

      const total = totalRows ? Number(totalRows[0]?.value || 0) : null;

      return {
        items,
        total,
        limit,
        nextCursor,
        hasMore,
      };
    };

    const result = cacheKey
      ? await getOrCompute(cacheKey, 20_000, computeFeed)
      : await computeFeed();

    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.json(result);
  } catch (error) {
    console.error('Search contents error:', error);
    return res.status(500).json({ error: 'Unable to search content catalog.' });
  }
});

// GET /api/catalog/contents/:slugOrId (Cached shared content + 1 consolidated user-state query + async batched view count)
router.get('/contents/:slugOrId', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const param = String(req.params.slugOrId).trim().slice(0, 140);
    const isNumeric = /^\d+$/.test(param);

    const loadBaseDetail = async () => {
      const [row] = await db
        .select({
          content: contents,
          categoryName: categories.name,
          categorySlug: categories.slug,
          subjectName: subjects.name,
          creatorName: users.name,
          creatorBio: users.bio,
          creatorAvatar: users.avatarUrl,
        })
        .from(contents)
        .innerJoin(users, eq(contents.creatorId, users.id))
        .leftJoin(categories, eq(contents.categoryId, categories.id))
        .leftJoin(subjects, eq(contents.subjectId, subjects.id))
        .where(isNumeric ? eq(contents.id, Number(param)) : eq(contents.slug, param))
        .limit(1);

      if (!row) return null;
      const item = row.content;

      const [creatorProfileRows, tagsRows, fileRows, commentRows, reviewRows, related] =
        await Promise.all([
          db
            .select()
            .from(creatorProfiles)
            .where(eq(creatorProfiles.userId, item.creatorId))
            .limit(1),
          db
            .select({ tag: contentTags.tag })
            .from(contentTags)
            .where(eq(contentTags.contentId, item.id)),
          db.select().from(contentFiles).where(eq(contentFiles.contentId, item.id)),
          db
            .select({
              id: comments.id,
              parentId: comments.parentId,
              body: comments.body,
              createdAt: comments.createdAt,
              userId: users.id,
              userName: users.name,
              userRole: users.role,
            })
            .from(comments)
            .innerJoin(users, eq(comments.userId, users.id))
            .where(and(eq(comments.contentId, item.id), eq(comments.isHidden, false)))
            .orderBy(asc(comments.createdAt))
            .limit(200),
          db
            .select({
              id: reviews.id,
              rating: reviews.rating,
              title: reviews.title,
              body: reviews.body,
              isVerifiedPurchase: reviews.isVerifiedPurchase,
              createdAt: reviews.createdAt,
              userId: users.id,
              userName: users.name,
            })
            .from(reviews)
            .innerJoin(users, eq(reviews.userId, users.id))
            .where(and(eq(reviews.contentId, item.id), eq(reviews.isHidden, false)))
            .orderBy(desc(reviews.createdAt))
            .limit(100),
          db
            .select({
              id: contents.id,
              title: contents.title,
              slug: contents.slug,
              authorName: contents.authorName,
              publisherName: contents.publisherName,
              coverImageUrl: contents.coverImageUrl,
              contentType: contents.contentType,
              priceInr: contents.priceInr,
              isFree: contents.isFree,
              avgRating: contents.avgRating,
              creatorName: sql<string>`COALESCE(NULLIF(TRIM(${contents.authorName}), ''), ${users.name})`,
            })
            .from(contents)
            .innerJoin(users, eq(contents.creatorId, users.id))
            .where(
              and(
                eq(contents.status, 'approved'),
                isNull(contents.deletedAt),
                item.categoryId ? eq(contents.categoryId, item.categoryId) : sql`true`,
                sql`${contents.id} != ${item.id}`
              )
            )
            .orderBy(desc(contents.viewsCount))
            .limit(4),
        ]);

      return {
        row,
        creatorProfile: creatorProfileRows[0] || null,
        tagsRows,
        fileRows,
        commentRows,
        reviewRows,
        related,
      };
    };

    const detail = await getOrCompute(`catalog:detail:${param}`, 20_000, loadBaseDetail);
    if (!detail) {
      return res.status(404).json({ error: 'Publication not found.' });
    }

    const { row, creatorProfile, tagsRows, fileRows, commentRows, reviewRows, related } = detail;
    const item = row.content;
    const isOwner = req.user?.id === item.creatorId;
    const isAdmin = req.user?.role === 'admin';

    if ((item.status !== 'approved' || item.deletedAt) && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Publication is not currently available.' });
    }

    // Non-blocking batched view increment (flushed in bulk every 5s; zero write lock on GET)
    queueContentView(item.id);

    // Consolidate all 4 per-user state lookups (purchase, bookmark, like, follow) into 1 SQL query
    let hasPurchased = false;
    let isBookmarked = false;
    let isLiked = false;
    let isFollowingCreator = false;

    if (req.user) {
      const stateResult = await db.execute(sql`
        SELECT
          EXISTS (
            SELECT 1 FROM purchases
            WHERE user_id = ${req.user.id} AND content_id = ${item.id} AND status = 'active'
          ) AS has_purchased,
          EXISTS (
            SELECT 1 FROM bookmarks
            WHERE user_id = ${req.user.id} AND content_id = ${item.id}
          ) AS is_bookmarked,
          EXISTS (
            SELECT 1 FROM likes
            WHERE user_id = ${req.user.id} AND content_id = ${item.id}
          ) AS is_liked,
          EXISTS (
            SELECT 1 FROM followers
            WHERE follower_id = ${req.user.id} AND creator_id = ${item.creatorId}
          ) AS is_following
      `);
      const st = (stateResult.rows?.[0] || {}) as Record<string, unknown>;
      hasPurchased = Boolean(st.has_purchased);
      isBookmarked = Boolean(st.is_bookmarked);
      isLiked = Boolean(st.is_liked);
      isFollowingCreator = Boolean(st.is_following);
    }

    const isAuthenticated = Boolean(req.user);
    const hasAccess = isAuthenticated && (item.isFree || isOwner || isAdmin || hasPurchased);

    const safeFiles = fileRows
      .filter((f) => f.fileType !== 'cover')
      .map((f) => {
        const allowFile = isAuthenticated && (hasAccess || f.isPreview);
        const signedToken =
          allowFile && req.user ? createSignedFileToken(f.id, req.user.id, 900) : null;
        return {
          id: f.id,
          fileType: f.fileType,
          originalName: f.originalName,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          isPreview: f.isPreview,
          locked: !allowFile,
          externalVideoUrl: allowFile
            ? normalizeExternalVideoUrl(f.externalVideoUrl) || f.externalVideoUrl
            : null,
          accessUrl: allowFile
            ? signedToken
              ? `/api/catalog/files/${f.id}?ft=${encodeURIComponent(signedToken)}`
              : `/api/catalog/files/${f.id}`
            : null,
        };
      });

    const customAuthor = (item.authorName || '').trim();
    const effectiveAuthorName = customAuthor || creatorProfile?.displayName || row.creatorName;

    if (!isAuthenticated) {
      res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    } else {
      res.setHeader('Cache-Control', 'private, no-cache');
    }

    return res.json({
      content: {
        id: item.id,
        title: item.title,
        slug: item.slug,
        authorName: customAuthor || null,
        publisherName: (item.publisherName || '').trim() || null,
        shortDescription: item.shortDescription,
        bodyHtml: hasAccess ? item.bodyHtml : null,
        previewHtml: null,
        coverImageUrl: item.coverImageUrl,
        categoryId: item.categoryId,
        categoryName: row.categoryName,
        categorySlug: row.categorySlug,
        subjectId: item.subjectId,
        subjectName: row.subjectName,
        language: item.language,
        contentType: item.contentType,
        priceInr: item.priceInr,
        isFree: item.isFree,
        status: item.status,
        viewsCount: item.viewsCount + 1,
        likesCount: item.likesCount,
        purchasesCount: item.purchasesCount,
        avgRating: item.avgRating,
        reviewsCount: item.reviewsCount,
        readingTimeMins: item.readingTimeMins,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
        tags: tagsRows.map((t) => t.tag),
        hasAccess,
        hasPurchased,
        canReview: isAuthenticated && (item.isFree || hasPurchased),
      },
      creator: {
        id: item.creatorId,
        name: effectiveAuthorName,
        profileName: creatorProfile?.displayName || row.creatorName,
        bio: isAuthenticated ? row.creatorBio : null,
        avatarUrl: row.creatorAvatar,
        tagline: creatorProfile?.tagline || null,
        expertise: creatorProfile?.expertise || null,
        verified: creatorProfile?.verified || false,
        followerCount: creatorProfile?.followerCount || 0,
        totalSales: creatorProfile?.totalSales || 0,
      },
      files: safeFiles,
      comments: isAuthenticated ? commentRows : [],
      reviews: isAuthenticated ? reviewRows : [],
      related: isAuthenticated ? related : [],
      userState: {
        isBookmarked,
        isLiked,
        isFollowingCreator,
      },
    });
  } catch (error) {
    console.error('Content detail error:', error);
    return res.status(500).json({ error: 'Unable to load publication details.' });
  }
});

// GET /api/catalog/files/:fileId (Protected file delivery + responsive WebP/AVIF resizing + CDN ETag caching)
router.get('/files/:fileId', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      return res.status(400).json({ error: 'Invalid file ID.' });
    }

    // Single JOIN query instead of 2 sequential queries
    const [row] = await db
      .select({
        file: contentFiles,
        content: contents,
      })
      .from(contentFiles)
      .innerJoin(contents, eq(contentFiles.contentId, contents.id))
      .where(eq(contentFiles.id, fileId))
      .limit(1);

    if (!row) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const { file, content } = row;
    const isOwner = req.user?.id === content.creatorId;
    const isAdmin = req.user?.role === 'admin';
    const isCoverFile = file.fileType === 'cover';

    // SECURITY FIX: Prevent non-owners/non-admins from enumerating files of unpublished/deleted content
    if ((content.status !== 'approved' || Boolean(content.deletedAt)) && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'File not found.' });
    }

    // Strict server-side auth gate: guests may ONLY fetch approved cover thumbnails, never study files/media
    if (!isCoverFile && !req.user) {
      return res.status(401).json({
        error: 'Authentication required. Please sign up or log in to access files and media.',
      });
    }

    let hasAccess =
      isCoverFile ||
      (content.isFree && Boolean(req.user)) ||
      (file.isPreview && Boolean(req.user)) ||
      isOwner ||
      isAdmin;

    if (!hasAccess && req.user) {
      const [purchase] = await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(
          and(
            eq(purchases.userId, req.user.id),
            eq(purchases.contentId, content.id),
            eq(purchases.status, 'active')
          )
        )
        .limit(1);
      hasAccess = Boolean(purchase);
    }

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied. Purchase this publication to view or download protected files.',
      });
    }

    // Direct object storage redirect (S3 / R2 / GCS) with short-lived presigned GET URL
    if (file.storageProvider === 's3' && file.storageKey) {
      const signed = createPresignedObjectUrl({
        method: 'GET',
        objectKey: file.storageKey,
        expiresInSeconds: 600,
      });
      if (signed) {
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.redirect(302, signed.publicUrl && (isCoverFile || content.isFree) ? signed.publicUrl : signed.url);
      }
    }

    const storageRoot = getStorageRoot();
    const resolvedPath = path.resolve(storageRoot, path.basename(file.storagePath));
    if (!resolvedPath.startsWith(storageRoot) || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Stored file asset is unavailable.' });
    }

    const isDownload = req.query.download === '1';
    const isOptimizableImage =
      !isDownload &&
      file.mimeType.startsWith('image/') &&
      file.mimeType !== 'image/gif';

    let deliverPath = resolvedPath;
    let deliverMime = file.mimeType;

    if (isOptimizableImage) {
      const reqWidth = normalizeRequestedWidth(req.query.w);
      const reqFmt = negotiateImageFormat(req.headers.accept, req.query.fmt as string | undefined);
      if (reqWidth || reqFmt) {
        try {
          const variant = await getOrCreateOptimizedImageVariant({
            sourcePath: resolvedPath,
            cacheStem: file.storagePath,
            width: reqWidth,
            format: reqFmt || 'webp',
          });
          deliverPath = variant.filePath;
          deliverMime = variant.contentType;
        } catch (optErr) {
          console.warn('Image optimization fallback to original:', (optErr as Error).message);
        }
      }
    }

    const stat = fs.statSync(deliverPath);
    const etag = `"${crypto
      .createHash('md5')
      .update(`${file.id}:${path.basename(deliverPath)}:${stat.size}:${stat.mtimeMs}`)
      .digest('hex')}"`;

    res.setHeader('ETag', etag);
    res.setHeader('Vary', 'Accept');
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', deliverMime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Cache-Control',
      isCoverFile || content.isFree
        ? 'public, max-age=604800, stale-while-revalidate=86400'
        : 'private, max-age=300'
    );
    const disposition = isDownload ? 'attachment' : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${file.originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`
    );

    return res.sendFile(deliverPath);
  } catch (error) {
    console.error('Protected file access error:', error);
    return res.status(500).json({ error: 'Unable to deliver requested file.' });
  }
});

// GET /api/catalog/creators (Authenticated members only — cached 45s)
router.get('/creators', requireAuth, async (_req, res) => {
  try {
    const payload = await getOrCompute('catalog:creators', 45_000, async () => {
      const [rows, counts] = await Promise.all([
        db
          .select({
            id: users.id,
            name: users.name,
            bio: users.bio,
            avatarUrl: users.avatarUrl,
            displayName: creatorProfiles.displayName,
            tagline: creatorProfiles.tagline,
            expertise: creatorProfiles.expertise,
            verified: creatorProfiles.verified,
            followerCount: creatorProfiles.followerCount,
            totalSales: creatorProfiles.totalSales,
          })
          .from(creatorProfiles)
          .innerJoin(users, eq(creatorProfiles.userId, users.id))
          .where(eq(users.status, 'active'))
          .orderBy(desc(creatorProfiles.followerCount), desc(creatorProfiles.totalSales))
          .limit(100),
        db
          .select({ creatorId: contents.creatorId, total: count() })
          .from(contents)
          .where(and(eq(contents.status, 'approved'), isNull(contents.deletedAt)))
          .groupBy(contents.creatorId),
      ]);
      const countMap = new Map(counts.map((c) => [c.creatorId, Number(c.total)]));
      return {
        creators: rows.map((r) => ({ ...r, publishedCount: countMap.get(r.id) || 0 })),
      };
    });

    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.json(payload);
  } catch (error) {
    console.error('Creators directory error:', error);
    return res.status(500).json({ error: 'Unable to load creators directory.' });
  }
});

// GET /api/catalog/creators/:id (Authenticated members only — parallelized)
router.get('/creators/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const creatorId = Number(req.params.id);
    if (!Number.isInteger(creatorId) || creatorId <= 0) {
      return res.status(400).json({ error: 'Invalid creator ID.' });
    }

    const [creatorRows, works, followRows] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          bio: users.bio,
          avatarUrl: users.avatarUrl,
          createdAt: users.createdAt,
          displayName: creatorProfiles.displayName,
          tagline: creatorProfiles.tagline,
          expertise: creatorProfiles.expertise,
          verified: creatorProfiles.verified,
          followerCount: creatorProfiles.followerCount,
          totalSales: creatorProfiles.totalSales,
        })
        .from(users)
        .leftJoin(creatorProfiles, eq(creatorProfiles.userId, users.id))
        .where(eq(users.id, creatorId))
        .limit(1),
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
          viewsCount: contents.viewsCount,
          likesCount: contents.likesCount,
          avgRating: contents.avgRating,
          reviewsCount: contents.reviewsCount,
          readingTimeMins: contents.readingTimeMins,
          publishedAt: contents.publishedAt,
          categoryName: categories.name,
        })
        .from(contents)
        .leftJoin(categories, eq(contents.categoryId, categories.id))
        .where(
          and(
            eq(contents.creatorId, creatorId),
            eq(contents.status, 'approved'),
            isNull(contents.deletedAt)
          )
        )
        .orderBy(desc(contents.publishedAt))
        .limit(60),
      req.user
        ? db
            .select({ id: followers.id })
            .from(followers)
            .where(and(eq(followers.followerId, req.user.id), eq(followers.creatorId, creatorId)))
            .limit(1)
        : Promise.resolve([]),
    ]);

    const creator = creatorRows[0];
    if (!creator) {
      return res.status(404).json({ error: 'Creator profile not found.' });
    }

    const fallbackName = creator.displayName || creator.name;
    const enrichedWorks = works.map((w) => ({
      ...w,
      creatorName: (w.authorName || '').trim() || fallbackName,
    }));

    return res.json({ creator, contents: enrichedWorks, isFollowing: followRows.length > 0 });
  } catch (error) {
    console.error('Creator profile error:', error);
    return res.status(500).json({ error: 'Unable to load creator profile.' });
  }
});

// POST /api/catalog/contact
router.post('/contact', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const email = String(req.body?.email || '').trim().slice(0, 150);
    const subject = String(req.body?.subject || '').trim().slice(0, 180);
    const message = String(req.body?.message || '').trim().slice(0, 4000);

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || subject.length < 3 || message.length < 10) {
      return res.status(400).json({ error: 'Please complete all fields with a detailed message.' });
    }

    await db.insert(contactMessages).values({ name, email, subject, message });
    return res.status(201).json({ message: 'Thank you. Your inquiry has been received by our editorial team.' });
  } catch (error) {
    console.error('Contact form error:', error);
    return res.status(500).json({ error: 'Unable to submit inquiry right now.' });
  }
});

export default router;
