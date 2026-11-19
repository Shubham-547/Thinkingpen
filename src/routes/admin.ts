import { Router } from 'express';
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminSettings,
  auditLogs,
  categories,
  commissionRecords,
  contents,
  creatorProfiles,
  creatorWallets,
  deletedAccountLogs,
  followers,
  notifications,
  payments,
  purchases,
  reports,
  subjects,
  transactions,
  userActivitySessions,
  userDailyVisits,
  userProfiles,
  users,
  withdrawals,
} from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import {
  isMailerConfigured,
  sendAccountBlockedEmail,
  sendAccountDeletedEmail,
} from '../lib/mailer.ts';
import { clampCommission, refundCapturedPayment } from '../lib/payments.ts';
import { slugify } from '../lib/security.ts';
import { isSuperAdminEmail, requireAdmin, requireAuth, type AuthRequest } from '../middleware/auth.ts';

const router = Router();
router.use(requireAuth, requireAdmin);

async function logAudit(
  actorId: number,
  action: string,
  entityType: string,
  entityId: string | number | null,
  details: Record<string, unknown>,
  ipAddress?: string
) {
  await db.insert(auditLogs).values({
    actorId,
    action,
    entityType,
    entityId: entityId !== null ? String(entityId) : null,
    details,
    ipAddress: ipAddress || null,
  });
}

// GET /api/admin/overview (Analytics + date-filtered revenue reports)
router.get('/overview', async (req: AuthRequest, res) => {
  try {
    const fromParam = String(req.query.from || '').trim();
    const toParam = String(req.query.to || '').trim();

    const dateFilters = [];
    if (fromParam) {
      const fromDate = new Date(fromParam);
      if (!Number.isNaN(fromDate.getTime())) {
        dateFilters.push(gte(commissionRecords.createdAt, fromDate));
      }
    }
    if (toParam) {
      const toDate = new Date(toParam);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        dateFilters.push(lte(commissionRecords.createdAt, toDate));
      }
    }

    const [totalUsersRow] = await db.select({ value: count() }).from(users);
    const [activeUsersRow] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, 'active'));
    const [totalCreatorsRow] = await db.select({ value: count() }).from(creatorProfiles);
    const [publishedContentRow] = await db
      .select({ value: count() })
      .from(contents)
      .where(eq(contents.status, 'approved'));
    const [freeContentRow] = await db
      .select({ value: count() })
      .from(contents)
      .where(and(eq(contents.status, 'approved'), eq(contents.isFree, true)));
    const [paidContentRow] = await db
      .select({ value: count() })
      .from(contents)
      .where(and(eq(contents.status, 'approved'), eq(contents.isFree, false)));
    const [pendingApprovalsRow] = await db
      .select({ value: count() })
      .from(contents)
      .where(eq(contents.status, 'pending'));
    const [openReportsRow] = await db
      .select({ value: count() })
      .from(reports)
      .where(eq(reports.status, 'open'));

    const [blockedUsersRow] = await db
      .select({ value: count() })
      .from(users)
      .where(inArray(users.status, ['blocked', 'suspended']));

    const [deletedAccountsRow] = await db
      .select({ value: count() })
      .from(deletedAccountLogs);

    const [purchasesRow] = await db
      .select({ value: count() })
      .from(purchases)
      .where(eq(purchases.status, 'active'));

    const creditedCommissions = await db
      .select()
      .from(commissionRecords)
      .where(and(eq(commissionRecords.status, 'credited'), ...dateFilters))
      .orderBy(desc(commissionRecords.createdAt));

    const grossTransactionValue = creditedCommissions.reduce(
      (sum, r) => sum + Number(r.grossAmountInr),
      0
    );
    const totalPlatformCommission = creditedCommissions.reduce(
      (sum, r) => sum + Number(r.platformCommissionInr),
      0
    );
    const totalCreatorEarnings = creditedCommissions.reduce(
      (sum, r) => sum + Number(r.creatorEarningsInr),
      0
    );

    const pendingWithdrawalsList = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.status, 'pending'));
    const pendingWithdrawalsAmount = pendingWithdrawalsList.reduce(
      (sum, w) => sum + Number(w.amountInr),
      0
    );

    // Monthly revenue breakdown (group credited commissions by YYYY-MM)
    const monthlyMap = new Map<
      string,
      { month: string; gross: number; commission: number; creatorEarnings: number; count: number }
    >();
    for (const c of creditedCommissions) {
      const key = new Date(c.createdAt).toISOString().slice(0, 7);
      const curr = monthlyMap.get(key) || {
        month: key,
        gross: 0,
        commission: 0,
        creatorEarnings: 0,
        count: 0,
      };
      curr.gross += Number(c.grossAmountInr);
      curr.commission += Number(c.platformCommissionInr);
      curr.creatorEarnings += Number(c.creatorEarningsInr);
      curr.count += 1;
      monthlyMap.set(key, curr);
    }
    const monthlyRevenue = Array.from(monthlyMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    // Most popular categories
    const popularCategories = await db
      .select({
        id: categories.id,
        name: categories.name,
        contentCount: count(contents.id),
        totalViews: sql<number>`COALESCE(SUM(${contents.viewsCount}), 0)`,
        totalPurchases: sql<number>`COALESCE(SUM(${contents.purchasesCount}), 0)`,
      })
      .from(categories)
      .leftJoin(
        contents,
        and(eq(contents.categoryId, categories.id), eq(contents.status, 'approved'))
      )
      .groupBy(categories.id, categories.name)
      .orderBy(desc(sql`COALESCE(SUM(${contents.viewsCount}), 0)`))
      .limit(8);

    // Most purchased content
    const topContent = await db
      .select({
        id: contents.id,
        title: contents.title,
        slug: contents.slug,
        contentType: contents.contentType,
        priceInr: contents.priceInr,
        purchasesCount: contents.purchasesCount,
        viewsCount: contents.viewsCount,
        creatorName: users.name,
      })
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .where(eq(contents.status, 'approved'))
      .orderBy(desc(contents.purchasesCount), desc(contents.viewsCount))
      .limit(6);

    // Top creators
    const topCreators = await db
      .select({
        id: users.id,
        name: users.name,
        displayName: creatorProfiles.displayName,
        totalSales: creatorProfiles.totalSales,
        followerCount: creatorProfiles.followerCount,
        totalEarningsInr: creatorWallets.totalEarningsInr,
        availableBalanceInr: creatorWallets.availableBalanceInr,
      })
      .from(creatorProfiles)
      .innerJoin(users, eq(creatorProfiles.userId, users.id))
      .leftJoin(creatorWallets, eq(creatorWallets.creatorId, users.id))
      .orderBy(desc(creatorProfiles.totalSales), desc(creatorProfiles.followerCount))
      .limit(6);

    return res.json({
      metrics: {
        totalUsers: Number(totalUsersRow?.value || 0),
        activeUsers: Number(activeUsersRow?.value || 0),
        blockedUsers: Number(blockedUsersRow?.value || 0),
        deletedAccountsCount: Number(deletedAccountsRow?.value || 0),
        totalCreators: Number(totalCreatorsRow?.value || 0),
        publishedContent: Number(publishedContentRow?.value || 0),
        freeContent: Number(freeContentRow?.value || 0),
        paidContent: Number(paidContentRow?.value || 0),
        pendingApprovals: Number(pendingApprovalsRow?.value || 0),
        openReports: Number(openReportsRow?.value || 0),
        totalPurchases: Number(purchasesRow?.value || 0),
        grossTransactionValue: Number(grossTransactionValue.toFixed(2)),
        totalPlatformCommission: Number(totalPlatformCommission.toFixed(2)),
        totalCreatorEarnings: Number(totalCreatorEarnings.toFixed(2)),
        pendingWithdrawalsCount: pendingWithdrawalsList.length,
        pendingWithdrawalsAmount: Number(pendingWithdrawalsAmount.toFixed(2)),
      },
      mailerConfigured: isMailerConfigured(),
      monthlyRevenue,
      popularCategories,
      topContent,
      topCreators,
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    return res.status(500).json({ error: 'Unable to load admin analytics.' });
  }
});

// GET /api/admin/users
router.get('/users', async (req: AuthRequest, res) => {
  try {
    // Automatically unlock any timed blocks that have already expired
    await db
      .update(users)
      .set({
        status: 'active',
        blockedReason: null,
        blockedUntil: null,
        blockedAt: null,
        blockedBy: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(users.status, ['blocked', 'suspended']),
          lte(users.blockedUntil, new Date())
        )
      );

    const rows = await db
      .select({
        id: users.id,
        publicUid: users.publicUid,
        username: users.username,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        blockedReason: users.blockedReason,
        blockedUntil: users.blockedUntil,
        blockedAt: users.blockedAt,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        state: userProfiles.state,
        country: userProfiles.country,
        occupationRole: userProfiles.occupationRole,
        displayName: creatorProfiles.displayName,
        verified: creatorProfiles.verified,
        customCommissionRate: creatorProfiles.customCommissionRate,
        totalSales: creatorProfiles.totalSales,
        totalEarningsInr: creatorWallets.totalEarningsInr,
        availableBalanceInr: creatorWallets.availableBalanceInr,
        withdrawnAmountInr: creatorWallets.withdrawnAmountInr,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(creatorProfiles, eq(creatorProfiles.userId, users.id))
      .leftJoin(creatorWallets, eq(creatorWallets.creatorId, users.id))
      .orderBy(desc(users.createdAt));

    return res.json({
      actorIsSuperAdmin: isSuperAdminEmail(req.user!.email),
      mailerConfigured: isMailerConfigured(),
      users: rows.map((u) => {
        const isPrimary = isSuperAdminEmail(u.email);
        return {
          ...u,
          // Strictly shield Primary Super Admin's private identity details from admin directory
          publicUid: isPrimary ? null : u.publicUid,
          username: isPrimary ? null : u.username,
          state: isPrimary ? null : u.state,
          country: isPrimary ? null : u.country,
          occupationRole: isPrimary ? null : u.occupationRole,
          blockedReason: isPrimary ? null : u.blockedReason,
          blockedUntil: isPrimary ? null : u.blockedUntil,
          blockedAt: isPrimary ? null : u.blockedAt,
          isSuperAdmin: isPrimary,
        };
      }),
    });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ error: 'Unable to fetch users.' });
  }
});

// GET /api/admin/users/track?q=... (Search & list trackable users — Primary Super Admin strictly shielded)
router.get('/users/track', async (req: AuthRequest, res) => {
  try {
    const rawQ = String(req.query.q || '').trim();
    const cleanQ = rawQ.replace(/^@+/, '').toLowerCase();

    const allUsers = await db
      .select({
        id: users.id,
        publicUid: users.publicUid,
        username: users.username,
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        state: userProfiles.state,
        country: userProfiles.country,
        occupationRole: userProfiles.occupationRole,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .orderBy(desc(users.createdAt));

    // Check if the query specifically targets Primary Super Admin
    if (cleanQ) {
      const superAdminRow = allUsers.find((u) => isSuperAdminEmail(u.email));
      if (superAdminRow) {
        const hitsSuperAdmin =
          superAdminRow.email.toLowerCase() === cleanQ ||
          (superAdminRow.publicUid && superAdminRow.publicUid.toLowerCase() === cleanQ) ||
          (superAdminRow.username && superAdminRow.username.toLowerCase() === cleanQ);
        if (hitsSuperAdmin) {
          return res.json({
            protected: true,
            message:
              'Primary Super Admin details and activity are strictly protected and cannot be accessed by anyone.',
            results: [],
          });
        }
      }
    }

    // Filter out Primary Super Admin ALWAYS; delegated admins and regular users ARE trackable
    const trackable = allUsers.filter((u) => {
      if (isSuperAdminEmail(u.email)) return false;
      if (!cleanQ) return true;
      return (
        (u.publicUid && u.publicUid.toLowerCase().includes(cleanQ)) ||
        (u.username && u.username.toLowerCase().includes(cleanQ)) ||
        u.name.toLowerCase().includes(cleanQ) ||
        u.email.toLowerCase().includes(cleanQ) ||
        String(u.id) === cleanQ
      );
    });

    const sliced = trackable.slice(0, 50);
    const userIds = sliced.map((u) => u.id);

    if (userIds.length === 0) {
      return res.json({ protected: false, results: [] });
    }

    const [recentSessions, spendAgg, visitAgg, contentAgg] = await Promise.all([
      db
        .select({
          userId: userActivitySessions.userId,
          pagePath: userActivitySessions.pagePath,
          pageTitle: userActivitySessions.pageTitle,
          contentId: userActivitySessions.contentId,
          lastSeenAt: userActivitySessions.lastSeenAt,
        })
        .from(userActivitySessions)
        .where(inArray(userActivitySessions.userId, userIds))
        .orderBy(desc(userActivitySessions.lastSeenAt)),
      db
        .select({
          userId: payments.userId,
          totalSpentInr: sql<number>`COALESCE(SUM(${payments.amountInr}), 0)`,
        })
        .from(payments)
        .where(and(inArray(payments.userId, userIds), eq(payments.status, 'captured')))
        .groupBy(payments.userId),
      db
        .select({
          userId: userDailyVisits.userId,
          totalVisitDays: count(userDailyVisits.id),
          totalSeconds: sql<number>`COALESCE(SUM(${userDailyVisits.totalSeconds}), 0)`,
        })
        .from(userDailyVisits)
        .where(inArray(userDailyVisits.userId, userIds))
        .groupBy(userDailyVisits.userId),
      db
        .select({
          userId: userActivitySessions.userId,
          totalContentsViewed: sql<number>`COUNT(DISTINCT ${userActivitySessions.contentId})`,
        })
        .from(userActivitySessions)
        .where(
          and(
            inArray(userActivitySessions.userId, userIds),
            sql`${userActivitySessions.contentId} IS NOT NULL`
          )
        )
        .groupBy(userActivitySessions.userId),
    ]);

    const latestByUser = new Map<
      number,
      { pagePath: string; pageTitle: string | null; contentId: number | null; lastSeenAt: Date }
    >();
    for (const s of recentSessions) {
      if (!latestByUser.has(s.userId)) {
        latestByUser.set(s.userId, s);
      }
    }
    const spendByUser = new Map(spendAgg.map((r) => [r.userId, Number(r.totalSpentInr || 0)]));
    const visitByUser = new Map(
      visitAgg.map((r) => [
        r.userId,
        { totalVisitDays: Number(r.totalVisitDays || 0), totalSeconds: Number(r.totalSeconds || 0) },
      ])
    );
    const contentByUser = new Map(
      contentAgg.map((r) => [r.userId, Number(r.totalContentsViewed || 0)])
    );

    const nowMs = Date.now();
    const results = sliced.map((u) => {
      const latest = latestByUser.get(u.id);
      const lastSeenAt = latest?.lastSeenAt || null;
      const isOnline = Boolean(lastSeenAt && nowMs - new Date(lastSeenAt).getTime() <= 45_000);
      const visits = visitByUser.get(u.id) || { totalVisitDays: 0, totalSeconds: 0 };
      return {
        ...u,
        isOnline,
        lastSeenAt,
        currentPagePath: latest?.pagePath || null,
        currentPageTitle: latest?.pageTitle || null,
        totalSpentInr: Number((spendByUser.get(u.id) || 0).toFixed(2)),
        totalVisitDays: visits.totalVisitDays,
        totalWebsiteSeconds: visits.totalSeconds,
        totalContentsViewed: contentByUser.get(u.id) || 0,
      };
    });

    // Sort online users first, then most recently active
    results.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      const tA = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const tB = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return tB - tA;
    });

    return res.json({ protected: false, results });
  } catch (error) {
    console.error('Admin user tracker search error:', error);
    return res.status(500).json({ error: 'Unable to search users.' });
  }
});

// GET /api/admin/users/:identifier/dossier (Full User Digital Dossier — strictly blocks Primary Super Admin)
router.get('/users/:identifier/dossier', async (req: AuthRequest, res) => {
  try {
    const rawId = decodeURIComponent(String(req.params.identifier || '')).trim();
    const cleanId = rawId.replace(/^@+/, '').toLowerCase();
    if (!cleanId) {
      return res.status(400).json({ error: 'User ID, 10-digit UID, or Unique Name is required.' });
    }

    let targetUser: typeof users.$inferSelect | undefined;

    // 1. Check 10-digit publicUid
    if (/^\d{10}$/.test(cleanId)) {
      const [u] = await db.select().from(users).where(eq(users.publicUid, cleanId)).limit(1);
      targetUser = u;
    }
    // 2. Check internal numeric user ID
    if (!targetUser && /^\d+$/.test(cleanId)) {
      const [u] = await db.select().from(users).where(eq(users.id, Number(cleanId))).limit(1);
      targetUser = u;
    }
    // 3. Check Unique User ID (username) or Email
    if (!targetUser) {
      const [u] = await db
        .select()
        .from(users)
        .where(sql`LOWER(${users.username}) = ${cleanId} OR LOWER(${users.email}) = ${cleanId}`)
        .limit(1);
      targetUser = u;
    }

    if (!targetUser) {
      return res.status(404).json({ error: 'No user found matching that Unique ID or 10-digit UID.' });
    }

    // STRICT SUPER ADMIN PRIVACY SHIELD: NOBODY (not even Super Admin or any other Admin) can view Super Admin's dossier
    if (isSuperAdminEmail(targetUser.email)) {
      return res.status(403).json({
        error:
          'Primary Super Admin details and activity are strictly protected and cannot be viewed or tracked by anyone.',
      });
    }

    const userId = targetUser.id;
    const [profileRows, sessionsRows, dailyRows, paymentRows] = await Promise.all([
      db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1),
      db
        .select({
          id: userActivitySessions.id,
          contentId: userActivitySessions.contentId,
          pagePath: userActivitySessions.pagePath,
          pageTitle: userActivitySessions.pageTitle,
          durationSeconds: userActivitySessions.durationSeconds,
          visitDate: userActivitySessions.visitDate,
          startedAt: userActivitySessions.startedAt,
          lastSeenAt: userActivitySessions.lastSeenAt,
          contentTitle: contents.title,
          contentSlug: contents.slug,
          contentType: contents.contentType,
          contentIsFree: contents.isFree,
          contentPriceInr: contents.priceInr,
        })
        .from(userActivitySessions)
        .leftJoin(contents, eq(userActivitySessions.contentId, contents.id))
        .where(eq(userActivitySessions.userId, userId))
        .orderBy(desc(userActivitySessions.lastSeenAt))
        .limit(500),
      db
        .select()
        .from(userDailyVisits)
        .where(eq(userDailyVisits.userId, userId))
        .orderBy(desc(userDailyVisits.visitDate))
        .limit(365),
      db
        .select({
          id: payments.id,
          receiptNumber: payments.receiptNumber,
          amountInr: payments.amountInr,
          status: payments.status,
          mode: payments.mode,
          createdAt: payments.createdAt,
          contentId: contents.id,
          contentTitle: contents.title,
          contentSlug: contents.slug,
        })
        .from(payments)
        .innerJoin(contents, eq(payments.contentId, contents.id))
        .where(eq(payments.userId, userId))
        .orderBy(desc(payments.createdAt)),
    ]);

    const profile = profileRows[0] || null;
    const latestSession = sessionsRows[0] || null;
    const nowMs = Date.now();
    const isOnline = Boolean(
      latestSession && nowMs - new Date(latestSession.lastSeenAt).getTime() <= 45_000
    );

    // Aggregate per-content watch/read history
    const contentMap = new Map<
      number,
      {
        contentId: number;
        title: string;
        slug: string;
        contentType: string;
        isFree: boolean;
        priceInr: string;
        viewsCount: number;
        totalDurationSeconds: number;
        firstViewedAt: Date;
        lastViewedAt: Date;
      }
    >();

    for (const s of sessionsRows) {
      if (!s.contentId) continue;
      const existing = contentMap.get(s.contentId);
      if (!existing) {
        contentMap.set(s.contentId, {
          contentId: s.contentId,
          title: s.contentTitle || s.pageTitle || `Content #${s.contentId}`,
          slug: s.contentSlug || String(s.contentId),
          contentType: s.contentType || 'Publication',
          isFree: Boolean(s.contentIsFree),
          priceInr: String(s.contentPriceInr || '0.00'),
          viewsCount: 1,
          totalDurationSeconds: Number(s.durationSeconds || 0),
          firstViewedAt: s.startedAt,
          lastViewedAt: s.lastSeenAt,
        });
      } else {
        existing.viewsCount += 1;
        existing.totalDurationSeconds += Number(s.durationSeconds || 0);
        if (new Date(s.startedAt) < new Date(existing.firstViewedAt)) {
          existing.firstViewedAt = s.startedAt;
        }
        if (new Date(s.lastSeenAt) > new Date(existing.lastViewedAt)) {
          existing.lastViewedAt = s.lastSeenAt;
        }
      }
    }

    const contentHistory = Array.from(contentMap.values()).sort(
      (a, b) => new Date(b.lastViewedAt).getTime() - new Date(a.lastViewedAt).getTime()
    );
    const totalContentReadSeconds = contentHistory.reduce(
      (sum, c) => sum + c.totalDurationSeconds,
      0
    );

    // Aggregate spending
    const capturedPayments = paymentRows.filter((p) => p.status === 'captured');
    const totalSpentInr = capturedPayments.reduce((sum, p) => sum + Number(p.amountInr || 0), 0);

    // Aggregate Day / Month / Year visit calendar
    const MONTH_NAMES = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const yearMap = new Map<
      number,
      { year: number; days: number; totalSeconds: number; pageViews: number }
    >();
    const monthMap = new Map<
      string,
      {
        year: number;
        month: number;
        label: string;
        days: number;
        totalSeconds: number;
        pageViews: number;
      }
    >();

    const dailyLogs = dailyRows.map((d) => {
      const yEntry = yearMap.get(d.visitYear) || {
        year: d.visitYear,
        days: 0,
        totalSeconds: 0,
        pageViews: 0,
      };
      yEntry.days += 1;
      yEntry.totalSeconds += Number(d.totalSeconds || 0);
      yEntry.pageViews += Number(d.pageViews || 0);
      yearMap.set(d.visitYear, yEntry);

      const mKey = `${d.visitYear}-${String(d.visitMonth).padStart(2, '0')}`;
      const mEntry = monthMap.get(mKey) || {
        year: d.visitYear,
        month: d.visitMonth,
        label: `${MONTH_NAMES[(d.visitMonth - 1) % 12] || d.visitMonth} ${d.visitYear}`,
        days: 0,
        totalSeconds: 0,
        pageViews: 0,
      };
      mEntry.days += 1;
      mEntry.totalSeconds += Number(d.totalSeconds || 0);
      mEntry.pageViews += Number(d.pageViews || 0);
      monthMap.set(mKey, mEntry);

      const dt = new Date(`${d.visitDate}T00:00:00Z`);
      const dayOfWeek = Number.isNaN(dt.getTime()) ? '' : DAY_NAMES[dt.getUTCDay()];

      return {
        visitDate: d.visitDate,
        visitYear: d.visitYear,
        visitMonth: d.visitMonth,
        visitDay: d.visitDay,
        dayOfWeek,
        pageViews: Number(d.pageViews || 0),
        totalSeconds: Number(d.totalSeconds || 0),
        firstSeenAt: d.firstSeenAt,
        lastSeenAt: d.lastSeenAt,
      };
    });

    const totalWebsiteSeconds = dailyLogs.reduce((sum, d) => sum + d.totalSeconds, 0);
    const byYear = Array.from(yearMap.values()).sort((a, b) => b.year - a.year);
    const byMonth = Array.from(monthMap.values()).sort((a, b) =>
      b.year !== a.year ? b.year - a.year : b.month - a.month
    );

    return res.json({
      user: {
        id: targetUser.id,
        publicUid: targetUser.publicUid,
        username: targetUser.username,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
        status: targetUser.status,
        blockedReason: targetUser.blockedReason,
        blockedUntil: targetUser.blockedUntil,
        blockedAt: targetUser.blockedAt,
        emailVerified: targetUser.emailVerified,
        avatarUrl: targetUser.avatarUrl,
        bio: targetUser.bio,
        createdAt: targetUser.createdAt,
      },
      profile,
      liveStatus: {
        isOnline,
        lastSeenAt: latestSession?.lastSeenAt || null,
        currentSession: latestSession
          ? {
              id: latestSession.id,
              pagePath: latestSession.pagePath,
              pageTitle: latestSession.pageTitle || latestSession.contentTitle || latestSession.pagePath,
              contentId: latestSession.contentId,
              contentSlug: latestSession.contentSlug,
              durationSeconds: Number(latestSession.durationSeconds || 0),
              startedAt: latestSession.startedAt,
              lastSeenAt: latestSession.lastSeenAt,
            }
          : null,
      },
      summary: {
        totalSpentInr: Number(totalSpentInr.toFixed(2)),
        successfulPaymentsCount: capturedPayments.length,
        totalContentsViewed: contentHistory.length,
        totalContentReadSeconds,
        totalWebsiteSeconds,
        totalVisitDays: dailyLogs.length,
        firstVisitDate: dailyLogs.length ? dailyLogs[dailyLogs.length - 1].visitDate : null,
        lastVisitDate: dailyLogs.length ? dailyLogs[0].visitDate : null,
      },
      contentHistory,
      spending: {
        totalSpentInr: Number(totalSpentInr.toFixed(2)),
        payments: paymentRows,
      },
      visits: {
        totalVisitDays: dailyLogs.length,
        totalWebsiteSeconds,
        byYear,
        byMonth,
        dailyLogs,
      },
      recentSessions: sessionsRows.slice(0, 30),
    });
  } catch (error) {
    console.error('Admin user dossier error:', error);
    return res.status(500).json({ error: 'Unable to load user tracking dossier.' });
  }
});

// PATCH /api/admin/users/:id (Role change, timed block/suspend with reason, unblock, creator settings)
router.patch('/users/:id', async (req: AuthRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!targetUser) return res.status(404).json({ error: 'User not found.' });

    const actorIsSuperAdmin = isSuperAdminEmail(req.user!.email);
    const targetIsSuperAdmin = isSuperAdminEmail(targetUser.email);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    let blockEmailResult: { sent: boolean; note: string } | null = null;

    if (req.body?.status && ['active', 'suspended', 'blocked'].includes(req.body.status)) {
      const nextStatus = req.body.status as 'active' | 'suspended' | 'blocked';
      if (targetIsSuperAdmin && nextStatus !== 'active') {
        return res.status(403).json({
          error: 'Primary Super Admin cannot be suspended or blocked.',
        });
      }
      if (targetId === req.user!.id && nextStatus !== 'active') {
        return res.status(400).json({ error: 'You cannot suspend or block your own admin account.' });
      }
      if (targetUser.role === 'admin' && !actorIsSuperAdmin) {
        return res.status(403).json({
          error: 'Only the Primary Super Admin can suspend or block another Administrator.',
        });
      }

      updates.status = nextStatus;

      if (nextStatus === 'active') {
        updates.blockedReason = null;
        updates.blockedUntil = null;
        updates.blockedAt = null;
        updates.blockedBy = null;
      } else {
        const reason = String(req.body?.blockedReason || req.body?.reason || '').trim().slice(0, 1000);
        if (reason.length < 3) {
          return res.status(400).json({
            error: 'Please provide a clear reason (at least 3 characters) that will be shown to the user.',
          });
        }

        let blockedUntilDate: Date | null = null;
        const isPermanent = Boolean(req.body?.permanent);

        if (!isPermanent) {
          if (req.body?.blockedUntil) {
            const parsed = new Date(String(req.body.blockedUntil));
            if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
              return res.status(400).json({
                error: 'Custom unblock date & time must be in the future.',
              });
            }
            blockedUntilDate = parsed;
          } else if (req.body?.durationHours !== undefined && req.body?.durationHours !== null && req.body?.durationHours !== '') {
            const hrs = Number(req.body.durationHours);
            if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 87600) {
              return res.status(400).json({
                error: 'Block duration must be between 1 hour and 10 years, or select Permanent.',
              });
            }
            blockedUntilDate = new Date(Date.now() + hrs * 60 * 60 * 1000);
          }
        }

        updates.blockedReason = reason;
        updates.blockedUntil = blockedUntilDate;
        updates.blockedAt = new Date();
        updates.blockedBy = req.user!.id;

        if (req.body?.sendEmail !== false) {
          const mailRes = await sendAccountBlockedEmail({
            toEmail: targetUser.email,
            userName: targetUser.name,
            status: nextStatus,
            reason,
            blockedUntil: blockedUntilDate,
          });
          blockEmailResult = { sent: mailRes.sent, note: mailRes.note };
        }
      }
    }

    if (req.body?.role && ['user', 'creator', 'admin'].includes(req.body.role)) {
      const requestedRole = req.body.role as string;
      if (targetIsSuperAdmin && requestedRole !== 'admin') {
        return res.status(403).json({
          error: 'Primary Super Admin role is locked and cannot be removed or downgraded.',
        });
      }
      const touchesAdminPrivilege = requestedRole === 'admin' || targetUser.role === 'admin';
      if (touchesAdminPrivilege && !actorIsSuperAdmin) {
        return res.status(403).json({
          error: 'Only the Primary Super Admin can grant or revoke Administrator access.',
        });
      }
      updates.role = requestedRole;
    }

    const [updatedUser] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, targetId))
      .returning();

    if (!updatedUser) return res.status(404).json({ error: 'User not found.' });

    if (req.body?.role === 'creator' || req.body?.role === 'admin') {
      await db
        .insert(creatorProfiles)
        .values({
          userId: targetId,
          displayName: updatedUser.name,
          acceptedCreatorAgreement: true,
          agreementAcceptedAt: new Date(),
        })
        .onConflictDoNothing();
      await db
        .insert(creatorWallets)
        .values({ creatorId: targetId })
        .onConflictDoNothing();
    }

    if (
      req.body?.customCommissionRate !== undefined ||
      req.body?.verified !== undefined
    ) {
      const cpUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if (req.body.customCommissionRate !== undefined) {
        if (req.body.customCommissionRate === null || req.body.customCommissionRate === '') {
          cpUpdates.customCommissionRate = null;
        } else {
          const rate = Number(req.body.customCommissionRate);
          if (Number.isNaN(rate) || rate < 5 || rate > 20) {
            return res
              .status(400)
              .json({ error: 'Creator commission rate must be between 5% and 20%.' });
          }
          cpUpdates.customCommissionRate = clampCommission(rate).toFixed(2);
        }
      }
      if (req.body.verified !== undefined) {
        cpUpdates.verified = Boolean(req.body.verified);
      }
      await db
        .update(creatorProfiles)
        .set(cpUpdates)
        .where(eq(creatorProfiles.userId, targetId));
    }

    await logAudit(
      req.user!.id,
      req.body?.status === 'blocked' || req.body?.status === 'suspended'
        ? `user_${req.body.status}`
        : req.body?.status === 'active'
        ? 'user_unblocked'
        : 'update_user',
      'user',
      targetId,
      {
        status: updatedUser.status,
        role: updatedUser.role,
        blockedReason: updatedUser.blockedReason,
        blockedUntil: updatedUser.blockedUntil,
      },
      req.ip
    );

    return res.json({
      user: updatedUser,
      emailSent: blockEmailResult?.sent ?? false,
      emailNote: blockEmailResult?.note ?? null,
      message:
        updatedUser.status === 'active'
          ? 'User account updated and active.'
          : `Account ${updatedUser.status}. The user will see your reason when signing in.`,
    });
  } catch (error) {
    console.error('Admin patch user error:', error);
    return res.status(500).json({ error: 'Unable to update user.' });
  }
});

// DELETE /api/admin/users/:id (Permanent DB + Firebase wipe & Gmail reason notification)
router.delete('/users/:id', async (req: AuthRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    if (reason.length < 5) {
      return res.status(400).json({
        error: 'A clear deletion reason (at least 5 characters) is mandatory and will be emailed to the user.',
      });
    }

    const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!targetUser) return res.status(404).json({ error: 'User not found.' });

    const actorIsSuperAdmin = isSuperAdminEmail(req.user!.email);
    const targetIsSuperAdmin = isSuperAdminEmail(targetUser.email);

    if (targetIsSuperAdmin) {
      return res.status(403).json({
        error: 'Primary Super Admin account is permanently locked and cannot be deleted.',
      });
    }
    if (targetId === req.user!.id) {
      return res.status(400).json({ error: 'You cannot permanently delete your own active admin account.' });
    }
    if (targetUser.role === 'admin' && !actorIsSuperAdmin) {
      return res.status(403).json({
        error: 'Only the Primary Super Admin can delete another Administrator account.',
      });
    }

    const deletedAt = new Date();

    // 1. Dispatch deletion reason to user's Gmail/email via configured SMTP
    const mailResult = await sendAccountDeletedEmail({
      toEmail: targetUser.email,
      userName: targetUser.name,
      publicUid: targetUser.publicUid,
      reason,
      deletedAt,
    });

    // 2. Record permanent deletion log (used for admin audit & shown on future login attempts)
    await db.insert(deletedAccountLogs).values({
      deletedUserEmail: targetUser.email,
      deletedUserName: targetUser.name,
      deletedPublicUid: targetUser.publicUid,
      deletedUsername: targetUser.username,
      deletedRole: targetUser.role,
      reason,
      deletedBy: req.user!.id,
      emailSent: mailResult.sent,
      emailStatusNote: mailResult.note,
      deletedAt,
    });

    // 3. Permanently wipe user and all cascaded child records from PostgreSQL
    await db.delete(users).where(eq(users.id, targetId));

    // 4. Also remove Firebase Auth identity if account used Google Sign-In
    if (targetUser.uid && !targetUser.uid.startsWith('local-')) {
      await adminAuth.deleteUser(targetUser.uid).catch((err) => {
        console.warn('Firebase Auth deleteUser skipped/failed:', (err as Error).message);
      });
    }

    await logAudit(
      req.user!.id,
      'delete_user_permanent',
      'user',
      targetId,
      {
        email: targetUser.email,
        publicUid: targetUser.publicUid,
        reason,
        emailSent: mailResult.sent,
      },
      req.ip
    );

    return res.json({
      deleted: true,
      emailSent: mailResult.sent,
      emailConfigured: mailResult.configured,
      emailNote: mailResult.note,
      message: mailResult.sent
        ? `Account (${targetUser.email}) permanently erased from database and deletion reason sent to their Gmail.`
        : `Account (${targetUser.email}) permanently erased from database. (${mailResult.note})`,
    });
  } catch (error) {
    console.error('Admin delete user error:', error);
    return res.status(500).json({ error: 'Unable to permanently delete user account.' });
  }
});

// GET /api/admin/deleted-accounts (Permanent account deletion audit ledger)
router.get('/deleted-accounts', async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: deletedAccountLogs.id,
        deletedUserEmail: deletedAccountLogs.deletedUserEmail,
        deletedUserName: deletedAccountLogs.deletedUserName,
        deletedPublicUid: deletedAccountLogs.deletedPublicUid,
        deletedUsername: deletedAccountLogs.deletedUsername,
        deletedRole: deletedAccountLogs.deletedRole,
        reason: deletedAccountLogs.reason,
        emailSent: deletedAccountLogs.emailSent,
        emailStatusNote: deletedAccountLogs.emailStatusNote,
        deletedAt: deletedAccountLogs.deletedAt,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(deletedAccountLogs)
      .leftJoin(users, eq(deletedAccountLogs.deletedBy, users.id))
      .orderBy(desc(deletedAccountLogs.deletedAt))
      .limit(200);

    return res.json({
      mailerConfigured: isMailerConfigured(),
      logs: rows,
    });
  } catch (error) {
    console.error('Deleted accounts log error:', error);
    return res.status(500).json({ error: 'Unable to load deleted account records.' });
  }
});

// GET /api/admin/contents
router.get('/contents', async (req, res) => {
  try {
    const statusFilter = String(req.query.status || '').trim();
    const rows = await db
      .select({
        id: contents.id,
        title: contents.title,
        slug: contents.slug,
        shortDescription: contents.shortDescription,
        contentType: contents.contentType,
        language: contents.language,
        priceInr: contents.priceInr,
        isFree: contents.isFree,
        status: contents.status,
        rejectionReason: contents.rejectionReason,
        isFeatured: contents.isFeatured,
        customCommissionRate: contents.customCommissionRate,
        viewsCount: contents.viewsCount,
        purchasesCount: contents.purchasesCount,
        createdAt: contents.createdAt,
        publishedAt: contents.publishedAt,
        categoryName: categories.name,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
      })
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .where(statusFilter ? eq(contents.status, statusFilter) : undefined)
      .orderBy(desc(contents.createdAt));

    return res.json({ contents: rows });
  } catch (error) {
    console.error('Admin contents error:', error);
    return res.status(500).json({ error: 'Unable to fetch content list.' });
  }
});

// PATCH /api/admin/contents/:id (Approve, reject, remove, feature, custom commission)
router.patch('/contents/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content item not found.' });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const statusAction = req.body?.status;

    if (statusAction && ['approved', 'rejected', 'removed', 'pending', 'draft'].includes(statusAction)) {
      updates.status = statusAction;
      if (statusAction === 'approved') {
        updates.publishedAt = existing.publishedAt || new Date();
        updates.rejectionReason = null;
      }
      if (statusAction === 'rejected' || statusAction === 'removed') {
        updates.rejectionReason = String(req.body?.rejectionReason || 'Removed by moderator').trim();
      }
    }

    if (req.body?.isFeatured !== undefined) {
      updates.isFeatured = Boolean(req.body.isFeatured);
    }

    if (req.body?.customCommissionRate !== undefined) {
      if (req.body.customCommissionRate === null || req.body.customCommissionRate === '') {
        updates.customCommissionRate = null;
      } else {
        const rate = Number(req.body.customCommissionRate);
        if (Number.isNaN(rate) || rate < 5 || rate > 20) {
          return res.status(400).json({ error: 'Content commission rate must be between 5% and 20%.' });
        }
        updates.customCommissionRate = clampCommission(rate).toFixed(2);
      }
    }

    const [updated] = await db
      .update(contents)
      .set(updates)
      .where(eq(contents.id, id))
      .returning();

    // Notify creator on approval / rejection / removal
    if (statusAction === 'approved' && existing.status !== 'approved') {
      await db.insert(notifications).values({
        userId: existing.creatorId,
        type: 'content_approved',
        title: 'Publication approved and live',
        message: `Your work "${existing.title}" has been approved and is now live on ScholarPress.`,
        link: `#/content/${existing.slug}`,
      });

      // Notify followers of the creator
      const creatorFollowers = await db
        .select({ followerId: followers.followerId })
        .from(followers)
        .where(eq(followers.creatorId, existing.creatorId));
      if (creatorFollowers.length > 0) {
        await db.insert(notifications).values(
          creatorFollowers.map((f) => ({
            userId: f.followerId,
            type: 'creator_published',
            title: 'New release from a creator you follow',
            message: `New publication available: "${existing.title}".`,
            link: `#/content/${existing.slug}`,
          }))
        );
      }
    } else if (statusAction === 'rejected' || statusAction === 'removed') {
      await db.insert(notifications).values({
        userId: existing.creatorId,
        type: 'content_rejected',
        title: statusAction === 'rejected' ? 'Publication submission declined' : 'Publication removed',
        message: `"${existing.title}" was ${statusAction}. Reason: ${updates.rejectionReason}`,
        link: '#/creator',
      });
    }

    await logAudit(req.user!.id, 'moderate_content', 'content', id, req.body || {}, req.ip);
    return res.json({ content: updated, message: 'Content status updated.' });
  } catch (error) {
    console.error('Admin patch content error:', error);
    return res.status(500).json({ error: 'Unable to update content item.' });
  }
});

// Category & Subject Management
router.post('/categories', async (req: AuthRequest, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const isFeatured = req.body?.isFeatured !== false;
    if (name.length < 2) return res.status(400).json({ error: 'Category name is required.' });

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');

    const [created] = await db
      .insert(categories)
      .values({ name, slug, description, isFeatured })
      .returning();

    await logAudit(req.user!.id, 'create_category', 'category', created.id, { name }, req.ip);
    return res.status(201).json({ category: created });
  } catch (error) {
    console.error('Create category error:', error);
    return res.status(500).json({ error: 'Unable to create category (name may already exist).' });
  }
});

router.delete('/categories/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(categories).where(eq(categories.id, id));
    await logAudit(req.user!.id, 'delete_category', 'category', id, {}, req.ip);
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Delete category error:', error);
    return res.status(500).json({ error: 'Unable to delete category.' });
  }
});

router.post('/subjects', async (req: AuthRequest, res) => {
  try {
    const categoryId = Number(req.body?.categoryId);
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!categoryId || name.length < 2) {
      return res.status(400).json({ error: 'Category and subject name are required.' });
    }
    const [created] = await db
      .insert(subjects)
      .values({ categoryId, name, slug: slugify(name), description })
      .returning();
    await logAudit(req.user!.id, 'create_subject', 'subject', created.id, { name, categoryId }, req.ip);
    return res.status(201).json({ subject: created });
  } catch (error) {
    console.error('Create subject error:', error);
    return res.status(500).json({ error: 'Unable to create subject.' });
  }
});

router.delete('/subjects/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(subjects).where(eq(subjects.id, id));
    await logAudit(req.user!.id, 'delete_subject', 'subject', id, {}, req.ip);
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Delete subject error:', error);
    return res.status(500).json({ error: 'Unable to delete subject.' });
  }
});

// GET /api/admin/transactions
router.get('/transactions', async (_req, res) => {
  try {
    const paymentRows = await db
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
        buyerName: users.name,
        buyerEmail: users.email,
        contentTitle: contents.title,
        commissionRate: commissionRecords.commissionRate,
        commissionSource: commissionRecords.commissionSource,
        platformCommissionInr: commissionRecords.platformCommissionInr,
        creatorEarningsInr: commissionRecords.creatorEarningsInr,
        commissionStatus: commissionRecords.status,
      })
      .from(payments)
      .innerJoin(users, eq(payments.userId, users.id))
      .innerJoin(contents, eq(payments.contentId, contents.id))
      .leftJoin(commissionRecords, eq(commissionRecords.paymentId, payments.id))
      .orderBy(desc(payments.createdAt))
      .limit(200);

    return res.json({ payments: paymentRows });
  } catch (error) {
    console.error('Admin transactions error:', error);
    return res.status(500).json({ error: 'Unable to load payment transactions.' });
  }
});

// POST /api/admin/payments/:id/refund
router.post('/payments/:id/refund', async (req: AuthRequest, res) => {
  try {
    const paymentId = Number(req.params.id);
    const reason = String(req.body?.reason || 'Refund approved by administrator').trim();
    const result = await refundCapturedPayment(paymentId, reason);
    await logAudit(req.user!.id, 'refund_payment', 'payment', paymentId, { reason }, req.ip);
    return res.json({ ...result, message: 'Refund processed and commission/earnings reversed.' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Refund failed.';
    return res.status(400).json({ error: msg });
  }
});

// GET /api/admin/withdrawals
router.get('/withdrawals', async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: withdrawals.id,
        creatorId: withdrawals.creatorId,
        creatorName: users.name,
        creatorEmail: users.email,
        amountInr: withdrawals.amountInr,
        payoutMethod: withdrawals.payoutMethod,
        payoutDetails: withdrawals.payoutDetails,
        status: withdrawals.status,
        adminNote: withdrawals.adminNote,
        payoutReference: withdrawals.payoutReference,
        reviewedAt: withdrawals.reviewedAt,
        paidAt: withdrawals.paidAt,
        createdAt: withdrawals.createdAt,
      })
      .from(withdrawals)
      .innerJoin(users, eq(withdrawals.creatorId, users.id))
      .orderBy(desc(withdrawals.createdAt));

    return res.json({ withdrawals: rows });
  } catch (error) {
    console.error('Admin withdrawals error:', error);
    return res.status(500).json({ error: 'Unable to load withdrawal requests.' });
  }
});

// PATCH /api/admin/withdrawals/:id (approve | reject | paid — never auto-paid!)
router.patch('/withdrawals/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const action = String(req.body?.action || '').trim(); // 'approve' | 'reject' | 'paid'
    const adminNote = String(req.body?.adminNote || '').trim();
    const payoutReference = String(req.body?.payoutReference || '').trim();

    if (!['approve', 'reject', 'paid'].includes(action)) {
      return res.status(400).json({ error: 'Invalid withdrawal action.' });
    }
    if (action === 'paid' && payoutReference.length < 4) {
      return res.status(400).json({
        error: 'A confirmed UTR / Bank Payout Reference ID is required before marking a withdrawal as Paid.',
      });
    }

    const updated = await db.transaction(async (tx) => {
      const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
      if (!w) throw new Error('Withdrawal request not found.');

      const amount = Number(w.amountInr);
      const [wallet] = await tx
        .select()
        .from(creatorWallets)
        .where(eq(creatorWallets.creatorId, w.creatorId))
        .limit(1);

      if (action === 'approve') {
        if (w.status !== 'pending') {
          throw new Error('Only pending withdrawal requests can be approved.');
        }
        const [row] = await tx
          .update(withdrawals)
          .set({
            status: 'approved',
            adminNote: adminNote || 'Approved for payout disbursement',
            reviewedBy: req.user!.id,
            reviewedAt: new Date(),
          })
          .where(eq(withdrawals.id, id))
          .returning();

        await tx.insert(notifications).values({
          userId: w.creatorId,
          type: 'withdrawal_approved',
          title: 'Withdrawal request approved',
          message: `Your withdrawal of ₹${amount.toFixed(2)} has been approved and queued for payout confirmation.`,
          link: '#/creator/withdrawals',
        });
        return row;
      }

      if (action === 'reject') {
        if (w.status !== 'pending' && w.status !== 'approved') {
          throw new Error('Cannot reject a withdrawal that is already finalized.');
        }
        if (wallet) {
          const nextPending = Math.max(0, Number(wallet.pendingEarningsInr) - amount).toFixed(2);
          const nextAvail = (Number(wallet.availableBalanceInr) + amount).toFixed(2);
          await tx
            .update(creatorWallets)
            .set({
              pendingEarningsInr: nextPending,
              availableBalanceInr: nextAvail,
              updatedAt: new Date(),
            })
            .where(eq(creatorWallets.creatorId, w.creatorId));
        }

        const [row] = await tx
          .update(withdrawals)
          .set({
            status: 'rejected',
            adminNote: adminNote || 'Rejected by administrator',
            reviewedBy: req.user!.id,
            reviewedAt: new Date(),
          })
          .where(eq(withdrawals.id, id))
          .returning();

        await tx
          .update(transactions)
          .set({ status: 'rejected' })
          .where(eq(transactions.withdrawalId, id));

        await tx.insert(notifications).values({
          userId: w.creatorId,
          type: 'withdrawal_rejected',
          title: 'Withdrawal request declined',
          message: `Your withdrawal of ₹${amount.toFixed(2)} was declined and returned to your available balance. Note: ${adminNote || 'Contact support'}`,
          link: '#/creator/withdrawals',
        });
        return row;
      }

      // action === 'paid'
      if (w.status !== 'approved') {
        throw new Error('Withdrawal must be approved first before confirming payout as Paid.');
      }
      if (wallet) {
        const nextPending = Math.max(0, Number(wallet.pendingEarningsInr) - amount).toFixed(2);
        const nextWithdrawn = (Number(wallet.withdrawnAmountInr) + amount).toFixed(2);
        await tx
          .update(creatorWallets)
          .set({
            pendingEarningsInr: nextPending,
            withdrawnAmountInr: nextWithdrawn,
            updatedAt: new Date(),
          })
          .where(eq(creatorWallets.creatorId, w.creatorId));
      }

      const [row] = await tx
        .update(withdrawals)
        .set({
          status: 'paid',
          payoutReference,
          adminNote: adminNote || w.adminNote,
          paidAt: new Date(),
        })
        .where(eq(withdrawals.id, id))
        .returning();

      await tx
        .update(transactions)
        .set({
          status: 'completed',
          description: `Withdrawal #${id} paid (Ref: ${payoutReference})`,
        })
        .where(eq(transactions.withdrawalId, id));

      await tx.insert(notifications).values({
        userId: w.creatorId,
        type: 'withdrawal_paid',
        title: 'Withdrawal payout confirmed',
        message: `₹${amount.toFixed(2)} has been disbursed. Reference: ${payoutReference}.`,
        link: '#/creator/withdrawals',
      });
      return row;
    });

    await logAudit(
      req.user!.id,
      `withdrawal_${action}`,
      'withdrawal',
      id,
      { adminNote, payoutReference },
      req.ip
    );
    return res.json({ withdrawal: updated, message: `Withdrawal updated to ${updated.status}.` });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unable to update withdrawal.';
    return res.status(400).json({ error: msg });
  }
});

// GET /api/admin/reports
router.get('/reports', async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: reports.id,
        reportType: reports.reportType,
        reason: reports.reason,
        details: reports.details,
        copyrightProof: reports.copyrightProof,
        status: reports.status,
        resolutionNote: reports.resolutionNote,
        createdAt: reports.createdAt,
        reporterName: users.name,
        reporterEmail: users.email,
        contentId: contents.id,
        contentTitle: contents.title,
        contentSlug: contents.slug,
        contentStatus: contents.status,
      })
      .from(reports)
      .innerJoin(users, eq(reports.reporterId, users.id))
      .innerJoin(contents, eq(reports.contentId, contents.id))
      .orderBy(desc(reports.createdAt));

    return res.json({ reports: rows });
  } catch (error) {
    console.error('Admin reports error:', error);
    return res.status(500).json({ error: 'Unable to load reports.' });
  }
});

// PATCH /api/admin/reports/:id
router.patch('/reports/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const status = ['open', 'reviewing', 'resolved', 'dismissed'].includes(req.body?.status)
      ? String(req.body.status)
      : 'resolved';
    const resolutionNote = String(req.body?.resolutionNote || '').trim();
    const removeContent = Boolean(req.body?.removeContent);

    const [report] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    if (!report) return res.status(404).json({ error: 'Report not found.' });

    const [updated] = await db
      .update(reports)
      .set({
        status,
        resolutionNote: resolutionNote || null,
        reviewedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, id))
      .returning();

    if (removeContent) {
      const [content] = await db
        .update(contents)
        .set({
          status: 'removed',
          rejectionReason:
            resolutionNote || `Removed following ${report.reportType} complaint #${id}`,
          updatedAt: new Date(),
        })
        .where(eq(contents.id, report.contentId))
        .returning();

      if (content) {
        await db.insert(notifications).values({
          userId: content.creatorId,
          type: 'content_takedown',
          title: 'Content removed following policy/copyright review',
          message: `"${content.title}" was taken down. Note: ${resolutionNote || report.reason}`,
          link: '#/creator',
        });
      }
    }

    await logAudit(
      req.user!.id,
      'resolve_report',
      'report',
      id,
      { status, removeContent, resolutionNote },
      req.ip
    );
    return res.json({ report: updated, message: 'Report updated.' });
  } catch (error) {
    console.error('Resolve report error:', error);
    return res.status(500).json({ error: 'Unable to update report.' });
  }
});

// POST /api/admin/notifications/broadcast
router.post('/notifications/broadcast', async (req: AuthRequest, res) => {
  try {
    const audience = String(req.body?.audience || 'all'); // 'all' | 'creators' | 'user'
    const targetUserId = req.body?.userId ? Number(req.body.userId) : null;
    const title = String(req.body?.title || '').trim();
    const message = String(req.body?.message || '').trim();

    if (title.length < 3 || message.length < 5) {
      return res.status(400).json({ error: 'Notification title and message are required.' });
    }

    let recipients: { id: number }[] = [];
    if (audience === 'user' && targetUserId) {
      recipients = [{ id: targetUserId }];
    } else if (audience === 'creators') {
      recipients = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'creator'));
    } else {
      recipients = await db.select({ id: users.id }).from(users);
    }

    if (recipients.length > 0) {
      await db.insert(notifications).values(
        recipients.map((r) => ({
          userId: r.id,
          type: 'admin_announcement',
          title,
          message,
          link: '#/dashboard/notifications',
        }))
      );
    }

    await logAudit(
      req.user!.id,
      'broadcast_notification',
      'notification',
      null,
      { audience, recipientCount: recipients.length, title },
      req.ip
    );

    return res.json({ sentCount: recipients.length, message: `Notification sent to ${recipients.length} account(s).` });
  } catch (error) {
    console.error('Broadcast notification error:', error);
    return res.status(500).json({ error: 'Unable to send notification.' });
  }
});

// GET & PUT /api/admin/settings
router.get('/settings', async (_req, res) => {
  try {
    const rows = await db.select().from(adminSettings).orderBy(asc(adminSettings.key));
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return res.json({
      settings: map,
      rows,
      mailerConfigured: isMailerConfigured(),
      smtpHost: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
      smtpUser: process.env.SMTP_USER?.trim() || null,
    });
  } catch (error) {
    console.error('Get admin settings error:', error);
    return res.status(500).json({ error: 'Unable to load settings.' });
  }
});

router.put('/settings', async (req: AuthRequest, res) => {
  try {
    const updates = req.body?.settings as Record<string, string | number | boolean> | undefined;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Settings object is required.' });
    }

    if (updates.default_commission_rate !== undefined) {
      const rate = Number(updates.default_commission_rate);
      if (Number.isNaN(rate) || rate < 5 || rate > 20) {
        return res
          .status(400)
          .json({ error: 'Platform commission percentage must be strictly between 5% and 20%.' });
      }
      updates.default_commission_rate = clampCommission(rate).toString();
    }

    if (updates.min_withdrawal_inr !== undefined) {
      const minW = Number(updates.min_withdrawal_inr);
      if (Number.isNaN(minW) || minW < 10) {
        return res.status(400).json({ error: 'Minimum withdrawal must be at least ₹10.' });
      }
      updates.min_withdrawal_inr = String(minW);
    }

    for (const [key, value] of Object.entries(updates)) {
      await db
        .insert(adminSettings)
        .values({
          key,
          value: String(value),
          updatedBy: req.user!.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: adminSettings.key,
          set: {
            value: String(value),
            updatedBy: req.user!.id,
            updatedAt: new Date(),
          },
        });
    }

    await logAudit(req.user!.id, 'update_settings', 'admin_settings', null, updates, req.ip);
    return res.json({ message: 'Platform settings saved.' });
  } catch (error) {
    console.error('Update admin settings error:', error);
    return res.status(500).json({ error: 'Unable to save settings.' });
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);

    return res.json({ logs: rows });
  } catch (error) {
    console.error('Audit logs error:', error);
    return res.status(500).json({ error: 'Unable to load audit logs.' });
  }
});

export default router;
