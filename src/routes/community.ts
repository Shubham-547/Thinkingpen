import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  bookmarks,
  categories,
  comments,
  contents,
  creatorProfiles,
  followers,
  likes,
  notifications,
  payments,
  purchases,
  reports,
  reviews,
  users,
} from '../db/schema.ts';
import { requireAuth, type AuthRequest } from '../middleware/auth.ts';

const router = Router();

// Toggle bookmark
router.post('/bookmarks/:contentId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const contentId = Number(req.params.contentId);
    const userId = req.user!.id;

    const [existing] = await db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.contentId, contentId)))
      .limit(1);

    if (existing) {
      await db.delete(bookmarks).where(eq(bookmarks.id, existing.id));
      return res.json({ bookmarked: false });
    }

    await db.insert(bookmarks).values({ userId, contentId });
    return res.json({ bookmarked: true });
  } catch (error) {
    console.error('Bookmark toggle error:', error);
    return res.status(500).json({ error: 'Unable to update bookmark.' });
  }
});

// Toggle like
router.post('/likes/:contentId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const contentId = Number(req.params.contentId);
    const userId = req.user!.id;

    const [existing] = await db
      .select()
      .from(likes)
      .where(and(eq(likes.userId, userId), eq(likes.contentId, contentId)))
      .limit(1);

    if (existing) {
      await db.delete(likes).where(eq(likes.id, existing.id));
      await db
        .update(contents)
        .set({ likesCount: sql`GREATEST(0, ${contents.likesCount} - 1)` })
        .where(eq(contents.id, contentId));
      return res.json({ liked: false });
    }

    await db.insert(likes).values({ userId, contentId });
    await db
      .update(contents)
      .set({ likesCount: sql`${contents.likesCount} + 1` })
      .where(eq(contents.id, contentId));
    return res.json({ liked: true });
  } catch (error) {
    console.error('Like toggle error:', error);
    return res.status(500).json({ error: 'Unable to update like.' });
  }
});

// Toggle follow creator
router.post('/follow/:creatorId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const creatorId = Number(req.params.creatorId);
    const followerId = req.user!.id;

    if (creatorId === followerId) {
      return res.status(400).json({ error: 'You cannot follow your own profile.' });
    }

    const [existing] = await db
      .select()
      .from(followers)
      .where(and(eq(followers.followerId, followerId), eq(followers.creatorId, creatorId)))
      .limit(1);

    if (existing) {
      await db.delete(followers).where(eq(followers.id, existing.id));
      await db
        .update(creatorProfiles)
        .set({ followerCount: sql`GREATEST(0, ${creatorProfiles.followerCount} - 1)` })
        .where(eq(creatorProfiles.userId, creatorId));
      return res.json({ following: false });
    }

    await db.insert(followers).values({ followerId, creatorId });
    await db
      .update(creatorProfiles)
      .set({ followerCount: sql`${creatorProfiles.followerCount} + 1` })
      .where(eq(creatorProfiles.userId, creatorId));

    await db.insert(notifications).values({
      userId: creatorId,
      type: 'new_follower',
      title: 'New follower',
      message: `${req.user!.name} started following your publications.`,
      link: '#/creator',
    });

    return res.json({ following: true });
  } catch (error) {
    console.error('Follow toggle error:', error);
    return res.status(500).json({ error: 'Unable to update follow status.' });
  }
});

// Post comment or reply
router.post('/comments/:contentId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const contentId = Number(req.params.contentId);
    const body = String(req.body?.body || '').trim();
    const parentId = req.body?.parentId ? Number(req.body.parentId) : null;

    if (body.length < 2 || body.length > 2000) {
      return res.status(400).json({ error: 'Comment must be between 2 and 2000 characters.' });
    }

    const [content] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, contentId))
      .limit(1);
    if (!content) return res.status(404).json({ error: 'Publication not found.' });

    const [created] = await db
      .insert(comments)
      .values({
        contentId,
        userId: req.user!.id,
        parentId,
        body,
      })
      .returning();

    // Notify creator
    if (content.creatorId !== req.user!.id) {
      await db.insert(notifications).values({
        userId: content.creatorId,
        type: 'new_comment',
        title: 'New comment on your publication',
        message: `${req.user!.name} commented on "${content.title}".`,
        link: `#/content/${content.slug}`,
      });
    }

    // Notify parent comment author on reply
    if (parentId) {
      const [parent] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, parentId))
        .limit(1);
      if (parent && parent.userId !== req.user!.id) {
        await db.insert(notifications).values({
          userId: parent.userId,
          type: 'comment_reply',
          title: 'New reply to your comment',
          message: `${req.user!.name} replied to your comment on "${content.title}".`,
          link: `#/content/${content.slug}`,
        });
      }
    }

    return res.status(201).json({
      comment: {
        ...created,
        userName: req.user!.name,
        userRole: req.user!.role,
      },
    });
  } catch (error) {
    console.error('Create comment error:', error);
    return res.status(500).json({ error: 'Unable to post comment.' });
  }
});

// Submit rating & review (verified purchasers only for paid content)
router.post('/reviews/:contentId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const contentId = Number(req.params.contentId);
    const rating = Number(req.body?.rating);
    const title = String(req.body?.title || '').trim().slice(0, 120);
    const body = String(req.body?.body || '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5 stars.' });
    }
    if (body.length < 6 || body.length > 2000) {
      return res.status(400).json({ error: 'Review text must be between 6 and 2000 characters.' });
    }

    const [content] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, contentId))
      .limit(1);
    if (!content) return res.status(404).json({ error: 'Publication not found.' });

    const [purchase] = await db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, req.user!.id),
          eq(purchases.contentId, contentId),
          eq(purchases.status, 'active')
        )
      )
      .limit(1);

    if (!content.isFree && !purchase) {
      return res.status(403).json({
        error: 'Only verified purchasers can submit a review for paid content.',
      });
    }

    const isVerifiedPurchase = Boolean(purchase);

    const [saved] = await db
      .insert(reviews)
      .values({
        contentId,
        userId: req.user!.id,
        rating,
        title: title || null,
        body,
        isVerifiedPurchase,
      })
      .onConflictDoUpdate({
        target: [reviews.userId, reviews.contentId],
        set: { rating, title: title || null, body, isVerifiedPurchase },
      })
      .returning();

    // Recompute aggregate average rating & count
    const allReviews = await db
      .select({ rating: reviews.rating })
      .from(reviews)
      .where(and(eq(reviews.contentId, contentId), eq(reviews.isHidden, false)));

    const totalCount = allReviews.length;
    const avg =
      totalCount > 0
        ? allReviews.reduce((acc, r) => acc + r.rating, 0) / totalCount
        : 0;

    await db
      .update(contents)
      .set({
        avgRating: avg.toFixed(2),
        reviewsCount: totalCount,
      })
      .where(eq(contents.id, contentId));

    return res.status(201).json({
      review: { ...saved, userName: req.user!.name },
      avgRating: avg.toFixed(2),
      reviewsCount: totalCount,
    });
  } catch (error) {
    console.error('Review submission error:', error);
    return res.status(500).json({ error: 'Unable to submit review.' });
  }
});

// Report inappropriate or copyrighted content
router.post('/reports/:contentId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const contentId = Number(req.params.contentId);
    const reportType = ['inappropriate', 'copyright', 'spam', 'other'].includes(
      req.body?.reportType
    )
      ? String(req.body.reportType)
      : 'inappropriate';
    const reason = String(req.body?.reason || '').trim();
    const details = String(req.body?.details || '').trim();
    const copyrightProof = String(req.body?.copyrightProof || '').trim();

    if (reason.length < 4) {
      return res.status(400).json({ error: 'Please provide a clear reason for this report.' });
    }

    const [content] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, contentId))
      .limit(1);
    if (!content) return res.status(404).json({ error: 'Publication not found.' });

    const [created] = await db
      .insert(reports)
      .values({
        reporterId: req.user!.id,
        contentId,
        reportType,
        reason,
        details: details || null,
        copyrightProof: copyrightProof || null,
      })
      .returning();

    // Notify all admins
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'));

    if (admins.length > 0) {
      await db.insert(notifications).values(
        admins.map((a) => ({
          userId: a.id,
          type: reportType === 'copyright' ? 'copyright_report' : 'content_report',
          title:
            reportType === 'copyright'
              ? 'New copyright takedown complaint'
              : 'New content report submitted',
          message: `"${content.title}" was reported for: ${reason}`,
          link: '#/admin/reports',
        }))
      );
    }

    return res.status(201).json({
      report: created,
      message: 'Your report has been logged for editorial review.',
    });
  } catch (error) {
    console.error('Report content error:', error);
    return res.status(500).json({ error: 'Unable to submit content report.' });
  }
});

// GET /api/community/user-dashboard
router.get('/user-dashboard', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const purchasedItems = await db
      .select({
        purchaseId: purchases.id,
        pricePaidInr: purchases.pricePaidInr,
        status: purchases.status,
        purchasedAt: purchases.purchasedAt,
        paymentId: purchases.paymentId,
        receiptNumber: payments.receiptNumber,
        providerOrderId: payments.providerOrderId,
        paymentStatus: payments.status,
        contentId: contents.id,
        title: contents.title,
        slug: contents.slug,
        coverImageUrl: contents.coverImageUrl,
        contentType: contents.contentType,
        language: contents.language,
        categoryName: categories.name,
        creatorName: users.name,
      })
      .from(purchases)
      .innerJoin(contents, eq(purchases.contentId, contents.id))
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(payments, eq(purchases.paymentId, payments.id))
      .where(eq(purchases.userId, userId))
      .orderBy(desc(purchases.purchasedAt));

    const bookmarkedItems = await db
      .select({
        bookmarkId: bookmarks.id,
        bookmarkedAt: bookmarks.createdAt,
        contentId: contents.id,
        title: contents.title,
        slug: contents.slug,
        shortDescription: contents.shortDescription,
        coverImageUrl: contents.coverImageUrl,
        contentType: contents.contentType,
        priceInr: contents.priceInr,
        isFree: contents.isFree,
        avgRating: contents.avgRating,
        categoryName: categories.name,
        creatorName: users.name,
      })
      .from(bookmarks)
      .innerJoin(contents, eq(bookmarks.contentId, contents.id))
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .where(eq(bookmarks.userId, userId))
      .orderBy(desc(bookmarks.createdAt));

    const followingCreators = await db
      .select({
        creatorId: users.id,
        name: users.name,
        displayName: creatorProfiles.displayName,
        tagline: creatorProfiles.tagline,
        expertise: creatorProfiles.expertise,
        verified: creatorProfiles.verified,
        followerCount: creatorProfiles.followerCount,
        followedAt: followers.createdAt,
      })
      .from(followers)
      .innerJoin(users, eq(followers.creatorId, users.id))
      .leftJoin(creatorProfiles, eq(creatorProfiles.userId, users.id))
      .where(eq(followers.followerId, userId))
      .orderBy(desc(followers.createdAt));

    const userNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    const paymentHistory = await db
      .select({
        id: payments.id,
        receiptNumber: payments.receiptNumber,
        providerOrderId: payments.providerOrderId,
        providerPaymentId: payments.providerPaymentId,
        amountInr: payments.amountInr,
        status: payments.status,
        mode: payments.mode,
        refundReason: payments.refundReason,
        createdAt: payments.createdAt,
        contentTitle: contents.title,
        contentSlug: contents.slug,
      })
      .from(payments)
      .innerJoin(contents, eq(payments.contentId, contents.id))
      .where(eq(payments.userId, userId))
      .orderBy(desc(payments.createdAt));

    return res.json({
      purchases: purchasedItems,
      bookmarks: bookmarkedItems,
      following: followingCreators,
      notifications: userNotifications,
      paymentHistory,
    });
  } catch (error) {
    console.error('User dashboard error:', error);
    return res.status(500).json({ error: 'Unable to load user dashboard.' });
  }
});

// POST /api/community/notifications/read
router.post('/notifications/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const notificationId = req.body?.id ? Number(req.body.id) : null;
    if (notificationId) {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(eq(notifications.id, notificationId), eq(notifications.userId, req.user!.id))
        );
    } else {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, req.user!.id));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Notification read error:', error);
    return res.status(500).json({ error: 'Unable to update notifications.' });
  }
});

export default router;
