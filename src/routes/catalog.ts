import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminSettings,
  bookmarks,
  categories,
  comments,
  contactMessages,
  contentFiles,
  contents,
  contentTags,
  creatorProfiles,
  followers,
  likes,
  purchases,
  reviews,
  subjects,
  users,
} from '../db/schema.ts';
import { getStorageRoot } from '../lib/security.ts';
import { optionalAuth, type AuthRequest } from '../middleware/auth.ts';

const router = Router();

// GET /api/catalog/home
router.get('/home', async (_req, res) => {
  try {
    const settingsRows = await db.select().from(adminSettings);
    const settings: Record<string, string> = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    const categoryRows = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.displayOrder), asc(categories.name));

    const approvedCounts = await db
      .select({
        categoryId: contents.categoryId,
        total: count(),
      })
      .from(contents)
      .where(eq(contents.status, 'approved'))
      .groupBy(contents.categoryId);

    const countByCat = new Map<number, number>();
    for (const r of approvedCounts) {
      if (r.categoryId) countByCat.set(r.categoryId, Number(r.total));
    }

    const featuredCategories = categoryRows.map((c) => ({
      ...c,
      contentCount: countByCat.get(c.id) || 0,
    }));

    const baseSelect = {
      id: contents.id,
      title: contents.title,
      slug: contents.slug,
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
      creatorName: users.name,
      creatorAvatar: users.avatarUrl,
    };

    const trending = await db
      .select(baseSelect)
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(eq(contents.status, 'approved'))
      .orderBy(desc(contents.isFeatured), desc(contents.viewsCount), desc(contents.likesCount))
      .limit(6);

    const recent = await db
      .select(baseSelect)
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(eq(contents.status, 'approved'))
      .orderBy(desc(contents.publishedAt), desc(contents.createdAt))
      .limit(6);

    const creatorsList = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        displayName: creatorProfiles.displayName,
        tagline: creatorProfiles.tagline,
        expertise: creatorProfiles.expertise,
        verified: creatorProfiles.verified,
        totalSales: creatorProfiles.totalSales,
        followerCount: creatorProfiles.followerCount,
      })
      .from(creatorProfiles)
      .innerJoin(users, eq(creatorProfiles.userId, users.id))
      .where(eq(users.status, 'active'))
      .orderBy(desc(creatorProfiles.followerCount), desc(creatorProfiles.totalSales))
      .limit(4);

    const creatorPubCounts = await db
      .select({ creatorId: contents.creatorId, total: count() })
      .from(contents)
      .where(eq(contents.status, 'approved'))
      .groupBy(contents.creatorId);
    const pubMap = new Map(creatorPubCounts.map((r) => [r.creatorId, Number(r.total)]));

    const [totalContentRow] = await db
      .select({ value: count() })
      .from(contents)
      .where(eq(contents.status, 'approved'));
    const [totalCreatorsRow] = await db.select({ value: count() }).from(creatorProfiles);
    const [totalUsersRow] = await db.select({ value: count() }).from(users);

    return res.json({
      settings,
      categories: featuredCategories,
      trending,
      recent,
      featuredCreators: creatorsList.map((cr) => ({
        ...cr,
        publishedCount: pubMap.get(cr.id) || 0,
      })),
      stats: {
        publishedWorks: Number(totalContentRow?.value || 0),
        activeCreators: Number(totalCreatorsRow?.value || 0),
        registeredMembers: Number(totalUsersRow?.value || 0),
        defaultCommissionRate: Number(settings.default_commission_rate || 10),
      },
    });
  } catch (error) {
    console.error('Home catalog error:', error);
    return res.status(500).json({ error: 'Unable to load homepage catalog.' });
  }
});

// GET /api/catalog/categories
router.get('/categories', async (_req, res) => {
  try {
    const cats = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.displayOrder), asc(categories.name));
    const subjs = await db.select().from(subjects).orderBy(asc(subjects.name));
    const counts = await db
      .select({ categoryId: contents.categoryId, total: count() })
      .from(contents)
      .where(eq(contents.status, 'approved'))
      .groupBy(contents.categoryId);

    const countMap = new Map<number, number>();
    for (const row of counts) {
      if (row.categoryId) countMap.set(row.categoryId, Number(row.total));
    }

    const grouped = cats.map((c) => ({
      ...c,
      contentCount: countMap.get(c.id) || 0,
      subjects: subjs.filter((s) => s.categoryId === c.id),
    }));

    return res.json({ categories: grouped, subjects: subjs });
  } catch (error) {
    console.error('Categories error:', error);
    return res.status(500).json({ error: 'Unable to fetch categories.' });
  }
});

// GET /api/catalog/contents (search + multi-filter + pagination)
router.get('/contents', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const categorySlug = String(req.query.category || '').trim();
    const subjectSlug = String(req.query.subject || '').trim();
    const contentType = String(req.query.contentType || '').trim();
    const language = String(req.query.language || '').trim();
    const pricing = String(req.query.pricing || 'all').trim(); // 'all' | 'free' | 'paid'
    const sort = String(req.query.sort || 'latest').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(48, Math.max(1, Number(req.query.limit || 12)));
    const offset = (page - 1) * limit;

    const conditions = [eq(contents.status, 'approved')];

    if (categorySlug) {
      const [cat] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, categorySlug))
        .limit(1);
      if (cat) conditions.push(eq(contents.categoryId, cat.id));
      else return res.json({ items: [], total: 0, page, limit, totalPages: 0 });
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
      const matchedTags = await db
        .select({ contentId: contentTags.contentId })
        .from(contentTags)
        .where(ilike(contentTags.tag, pattern));
      const tagIds = matchedTags.map((t) => t.contentId);

      const searchOr = [
        ilike(contents.title, pattern),
        ilike(contents.shortDescription, pattern),
        ilike(contents.contentType, pattern),
        ilike(users.name, pattern),
        ilike(categories.name, pattern),
        ilike(subjects.name, pattern),
      ];
      if (tagIds.length > 0) {
        searchOr.push(inArray(contents.id, tagIds));
      }
      conditions.push(or(...searchOr)!);
    }

    const whereClause = and(...conditions);

    let orderByClause;
    switch (sort) {
      case 'popular':
        orderByClause = [desc(contents.viewsCount), desc(contents.purchasesCount)];
        break;
      case 'highest_rated':
        orderByClause = [desc(contents.avgRating), desc(contents.reviewsCount)];
        break;
      case 'price_asc':
        orderByClause = [asc(contents.priceInr), desc(contents.publishedAt)];
        break;
      case 'price_desc':
        orderByClause = [desc(contents.priceInr), desc(contents.publishedAt)];
        break;
      default:
        orderByClause = [desc(contents.publishedAt), desc(contents.createdAt)];
        break;
    }

    const rows = await db
      .select({
        id: contents.id,
        title: contents.title,
        slug: contents.slug,
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
        categoryName: categories.name,
        categorySlug: categories.slug,
        subjectName: subjects.name,
        creatorId: users.id,
        creatorName: users.name,
      })
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(whereClause)
      .orderBy(...orderByClause)
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ value: count() })
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(whereClause);

    const total = Number(totalRow?.value || 0);

    return res.json({
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Search contents error:', error);
    return res.status(500).json({ error: 'Unable to search content catalog.' });
  }
});

// GET /api/catalog/contents/:slugOrId
router.get('/contents/:slugOrId', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const param = String(req.params.slugOrId);
    const isNumeric = /^\d+$/.test(param);

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

    if (!row) {
      return res.status(404).json({ error: 'Publication not found.' });
    }

    const item = row.content;
    const isOwner = req.user?.id === item.creatorId;
    const isAdmin = req.user?.role === 'admin';

    if (item.status !== 'approved' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Publication is not currently available.' });
    }

    // Increment views count
    await db
      .update(contents)
      .set({ viewsCount: sql`${contents.viewsCount} + 1` })
      .where(eq(contents.id, item.id));

    // Check purchase entitlement
    let hasPurchased = false;
    if (req.user) {
      const [purchase] = await db
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.userId, req.user.id),
            eq(purchases.contentId, item.id),
            eq(purchases.status, 'active')
          )
        )
        .limit(1);
      hasPurchased = Boolean(purchase);
    }

    const hasAccess = item.isFree || isOwner || isAdmin || hasPurchased;

    // Fetch creator profile
    const [creatorProfile] = await db
      .select()
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, item.creatorId))
      .limit(1);

    // Fetch tags
    const tagsRows = await db
      .select({ tag: contentTags.tag })
      .from(contentTags)
      .where(eq(contentTags.contentId, item.id));

    // Fetch files (protect non-preview files when locked!)
    const fileRows = await db
      .select()
      .from(contentFiles)
      .where(eq(contentFiles.contentId, item.id));

    const safeFiles = fileRows.map((f) => ({
      id: f.id,
      fileType: f.fileType,
      originalName: f.originalName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      isPreview: f.isPreview,
      locked: !hasAccess && !f.isPreview,
      externalVideoUrl: hasAccess || f.isPreview ? f.externalVideoUrl : null,
      accessUrl: hasAccess || f.isPreview ? `/api/catalog/files/${f.id}` : null,
    }));

    // Fetch comments
    const commentRows = await db
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
      .orderBy(asc(comments.createdAt));

    // Fetch reviews
    const reviewRows = await db
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
      .orderBy(desc(reviews.createdAt));

    // Related content
    const related = await db
      .select({
        id: contents.id,
        title: contents.title,
        slug: contents.slug,
        coverImageUrl: contents.coverImageUrl,
        contentType: contents.contentType,
        priceInr: contents.priceInr,
        isFree: contents.isFree,
        avgRating: contents.avgRating,
        creatorName: users.name,
      })
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .where(
        and(
          eq(contents.status, 'approved'),
          item.categoryId ? eq(contents.categoryId, item.categoryId) : sql`true`,
          sql`${contents.id} != ${item.id}`
        )
      )
      .orderBy(desc(contents.viewsCount))
      .limit(4);

    // User state (bookmarked, liked, following)
    let isBookmarked = false;
    let isLiked = false;
    let isFollowingCreator = false;
    if (req.user) {
      const [bm] = await db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, req.user.id), eq(bookmarks.contentId, item.id)))
        .limit(1);
      isBookmarked = Boolean(bm);

      const [lk] = await db
        .select({ id: likes.id })
        .from(likes)
        .where(and(eq(likes.userId, req.user.id), eq(likes.contentId, item.id)))
        .limit(1);
      isLiked = Boolean(lk);

      const [fl] = await db
        .select({ id: followers.id })
        .from(followers)
        .where(and(eq(followers.followerId, req.user.id), eq(followers.creatorId, item.creatorId)))
        .limit(1);
      isFollowingCreator = Boolean(fl);
    }

    return res.json({
      content: {
        id: item.id,
        title: item.title,
        slug: item.slug,
        shortDescription: item.shortDescription,
        bodyHtml: hasAccess ? item.bodyHtml : null,
        previewHtml: item.previewHtml,
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
        canReview: Boolean(req.user) && (item.isFree || hasPurchased),
      },
      creator: {
        id: item.creatorId,
        name: creatorProfile?.displayName || row.creatorName,
        bio: row.creatorBio,
        avatarUrl: row.creatorAvatar,
        tagline: creatorProfile?.tagline || null,
        expertise: creatorProfile?.expertise || null,
        verified: creatorProfile?.verified || false,
        followerCount: creatorProfile?.followerCount || 0,
        totalSales: creatorProfile?.totalSales || 0,
      },
      files: safeFiles,
      comments: commentRows,
      reviews: reviewRows,
      related,
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

// GET /api/catalog/files/:fileId (Protected file delivery — no public links for paid files)
router.get('/files/:fileId', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID.' });
    }

    const [file] = await db
      .select()
      .from(contentFiles)
      .where(eq(contentFiles.id, fileId))
      .limit(1);

    if (!file) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const [content] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, file.contentId))
      .limit(1);

    if (!content) {
      return res.status(404).json({ error: 'Parent publication not found.' });
    }

    const isOwner = req.user?.id === content.creatorId;
    const isAdmin = req.user?.role === 'admin';
    let hasAccess = content.isFree || file.isPreview || isOwner || isAdmin;

    if (!hasAccess && req.user) {
      const [purchase] = await db
        .select()
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

    const storageRoot = getStorageRoot();
    const resolvedPath = path.resolve(storageRoot, path.basename(file.storagePath));
    if (!resolvedPath.startsWith(storageRoot) || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Stored file asset is unavailable.' });
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', content.isFree ? 'public, max-age=3600' : 'private, no-store');
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${file.originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`
    );

    return res.sendFile(resolvedPath);
  } catch (error) {
    console.error('Protected file access error:', error);
    return res.status(500).json({ error: 'Unable to deliver requested file.' });
  }
});

// GET /api/catalog/creators
router.get('/creators', async (_req, res) => {
  try {
    const rows = await db
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
      .orderBy(desc(creatorProfiles.followerCount), desc(creatorProfiles.totalSales));

    const counts = await db
      .select({ creatorId: contents.creatorId, total: count() })
      .from(contents)
      .where(eq(contents.status, 'approved'))
      .groupBy(contents.creatorId);
    const countMap = new Map(counts.map((c) => [c.creatorId, Number(c.total)]));

    return res.json({
      creators: rows.map((r) => ({ ...r, publishedCount: countMap.get(r.id) || 0 })),
    });
  } catch (error) {
    console.error('Creators directory error:', error);
    return res.status(500).json({ error: 'Unable to load creators directory.' });
  }
});

// GET /api/catalog/creators/:id
router.get('/creators/:id', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const creatorId = Number(req.params.id);
    if (!Number.isInteger(creatorId)) {
      return res.status(400).json({ error: 'Invalid creator ID.' });
    }

    const [creator] = await db
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
      .limit(1);

    if (!creator) {
      return res.status(404).json({ error: 'Creator profile not found.' });
    }

    const works = await db
      .select({
        id: contents.id,
        title: contents.title,
        slug: contents.slug,
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
      .where(and(eq(contents.creatorId, creatorId), eq(contents.status, 'approved')))
      .orderBy(desc(contents.publishedAt));

    let isFollowing = false;
    if (req.user) {
      const [fl] = await db
        .select({ id: followers.id })
        .from(followers)
        .where(and(eq(followers.followerId, req.user.id), eq(followers.creatorId, creatorId)))
        .limit(1);
      isFollowing = Boolean(fl);
    }

    return res.json({ creator, contents: works, isFollowing });
  } catch (error) {
    console.error('Creator profile error:', error);
    return res.status(500).json({ error: 'Unable to load creator profile.' });
  }
});

// POST /api/catalog/contact
router.post('/contact', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();

    if (name.length < 2 || !email.includes('@') || subject.length < 3 || message.length < 10) {
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
