import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminSettings,
  categories,
  commissionRecords,
  contentDownloads,
  contents,
  contentViewEvents,
  creatorProfiles,
  creatorWallets,
  likes,
  payments,
  reviews,
  subjects,
} from '../db/schema.ts';
import { normalizeEduQuery, tokenizeEdu } from './embeddings.ts';

const IST_OFFSET_MS = 330 * 60 * 1000;

export class AnalyticsValidationError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type AnalyticsRangeKey =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | '90d'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'custom';

export interface ResolvedDateRange {
  rangeKey: AnalyticsRangeKey;
  rangeLabel: string;
  comparisonLabel: string;
  startDateYmd: string;
  endDateYmd: string;
  startUtc: Date;
  endUtc: Date;
  prevStartUtc: Date;
  prevEndUtc: Date;
  bucketMode: 'hourly' | 'daily' | 'monthly';
  spanDays: number;
}

const VALID_ANALYTICS_RANGES = new Set<string>([
  'today',
  'yesterday',
  '7d',
  '30d',
  '90d',
  'this_month',
  'last_month',
  'this_year',
  'custom',
]);

function formatIstYmd(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatIstHourKey(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return String(shifted.getUTCHours()).padStart(2, '0');
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

function roundTwo(val: number): number {
  return Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;
}

function computeRatePct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function resolveAnalyticsDateRange(
  rawRange: unknown,
  rawStartDate?: unknown,
  rawEndDate?: unknown
): ResolvedDateRange {
  const now = new Date();
  const todayYmd = formatIstYmd(now);
  const rawStr = String(rawRange || '30d').trim().toLowerCase();

  if (rawStr && !VALID_ANALYTICS_RANGES.has(rawStr)) {
    throw new AnalyticsValidationError(400, `Unsupported date range filter: ${rawStr}`);
  }
  const rangeKey = (rawStr || '30d') as AnalyticsRangeKey;

  let startDateYmd = addDaysYmd(todayYmd, -29);
  let endDateYmd = todayYmd;
  let startUtc = istStartUtc(startDateYmd);
  let endUtc = now;
  let prevStartUtc = new Date(startUtc.getTime() - 30 * 86_400_000);
  let prevEndUtc = new Date(startUtc.getTime() - 1);
  let rangeLabel = 'Last 30 Days';
  let comparisonLabel = 'vs previous period';

  if (rangeKey === 'today') {
    startDateYmd = todayYmd;
    endDateYmd = todayYmd;
    startUtc = istStartUtc(todayYmd);
    endUtc = now;
    const yesterdayYmd = addDaysYmd(todayYmd, -1);
    prevStartUtc = istStartUtc(yesterdayYmd);
    prevEndUtc = istEndUtc(yesterdayYmd);
    rangeLabel = 'Today';
    comparisonLabel = 'vs yesterday';
  } else if (rangeKey === 'yesterday') {
    const yesterdayYmd = addDaysYmd(todayYmd, -1);
    const dayBeforeYmd = addDaysYmd(todayYmd, -2);
    startDateYmd = yesterdayYmd;
    endDateYmd = yesterdayYmd;
    startUtc = istStartUtc(yesterdayYmd);
    endUtc = istEndUtc(yesterdayYmd);
    prevStartUtc = istStartUtc(dayBeforeYmd);
    prevEndUtc = istEndUtc(dayBeforeYmd);
    rangeLabel = 'Yesterday';
    comparisonLabel = 'vs day before';
  } else if (rangeKey === '7d' || rangeKey === '30d' || rangeKey === '90d') {
    const days = rangeKey === '7d' ? 7 : rangeKey === '90d' ? 90 : 30;
    startDateYmd = addDaysYmd(todayYmd, -(days - 1));
    endDateYmd = todayYmd;
    startUtc = istStartUtc(startDateYmd);
    endUtc = now;
    prevEndUtc = new Date(startUtc.getTime() - 1);
    prevStartUtc = new Date(startUtc.getTime() - days * 86_400_000);
    rangeLabel = `Last ${days} Days`;
    comparisonLabel = 'vs previous period';
  } else if (rangeKey === 'this_month') {
    startDateYmd = `${todayYmd.slice(0, 7)}-01`;
    endDateYmd = todayYmd;
    startUtc = istStartUtc(startDateYmd);
    endUtc = now;
    const prevMonthEndUtc = new Date(startUtc.getTime() - 1);
    const prevMonthEndYmd = formatIstYmd(prevMonthEndUtc);
    const prevMonthStartYmd = `${prevMonthEndYmd.slice(0, 7)}-01`;
    prevStartUtc = istStartUtc(prevMonthStartYmd);
    prevEndUtc = prevMonthEndUtc;
    rangeLabel = 'This Month';
    comparisonLabel = 'vs last month';
  } else if (rangeKey === 'last_month') {
    const thisMonthStartUtc = istStartUtc(`${todayYmd.slice(0, 7)}-01`);
    const lastMonthEndUtc = new Date(thisMonthStartUtc.getTime() - 1);
    const lastMonthEndYmd = formatIstYmd(lastMonthEndUtc);
    const lastMonthStartYmd = `${lastMonthEndYmd.slice(0, 7)}-01`;
    startDateYmd = lastMonthStartYmd;
    endDateYmd = lastMonthEndYmd;
    startUtc = istStartUtc(lastMonthStartYmd);
    endUtc = istEndUtc(lastMonthEndYmd);
    const twoMonthsAgoEndUtc = new Date(startUtc.getTime() - 1);
    const twoMonthsAgoEndYmd = formatIstYmd(twoMonthsAgoEndUtc);
    prevStartUtc = istStartUtc(`${twoMonthsAgoEndYmd.slice(0, 7)}-01`);
    prevEndUtc = twoMonthsAgoEndUtc;
    rangeLabel = 'Last Month';
    comparisonLabel = 'vs month before';
  } else if (rangeKey === 'this_year') {
    const curYear = Number(todayYmd.slice(0, 4));
    startDateYmd = `${curYear}-01-01`;
    endDateYmd = todayYmd;
    startUtc = istStartUtc(startDateYmd);
    endUtc = now;
    const spanMs = Math.max(86_400_000, endUtc.getTime() - startUtc.getTime());
    prevEndUtc = new Date(startUtc.getTime() - 1);
    prevStartUtc = new Date(startUtc.getTime() - spanMs);
    rangeLabel = `This Year (${curYear})`;
    comparisonLabel = 'vs prior period';
  } else if (rangeKey === 'custom') {
    const parsedStart = parseStrictYmd(rawStartDate);
    const parsedEnd = parseStrictYmd(rawEndDate);
    if (!parsedStart || !parsedEnd) {
      throw new AnalyticsValidationError(
        400,
        'Please select valid start and end dates (YYYY-MM-DD) for the custom date range.'
      );
    }
    if (parsedStart > parsedEnd) {
      throw new AnalyticsValidationError(400, 'Start date cannot be later than end date.');
    }
    const sUtc = istStartUtc(parsedStart);
    const eUtc = istEndUtc(parsedEnd);
    const spanDays = Math.ceil((eUtc.getTime() - sUtc.getTime()) / 86_400_000);
    if (spanDays > 1826) {
      throw new AnalyticsValidationError(400, 'Custom date range cannot exceed 5 years.');
    }
    startDateYmd = parsedStart;
    endDateYmd = parsedEnd;
    startUtc = sUtc;
    endUtc = eUtc;
    const spanMs = eUtc.getTime() - sUtc.getTime() + 1;
    prevEndUtc = new Date(sUtc.getTime() - 1);
    prevStartUtc = new Date(sUtc.getTime() - spanMs);
    rangeLabel = parsedStart === parsedEnd ? parsedStart : `${parsedStart} to ${parsedEnd}`;
    comparisonLabel = 'vs previous period';
  }

  const startDayMs = Date.parse(`${startDateYmd}T00:00:00.000Z`);
  const endDayMs = Date.parse(`${endDateYmd}T00:00:00.000Z`);
  const spanDays = Math.max(1, Math.round((endDayMs - startDayMs) / 86_400_000) + 1);
  const bucketMode: 'hourly' | 'daily' | 'monthly' =
    spanDays === 1 ? 'hourly' : spanDays <= 92 ? 'daily' : 'monthly';

  return {
    rangeKey,
    rangeLabel,
    comparisonLabel,
    startDateYmd,
    endDateYmd,
    startUtc,
    endUtc,
    prevStartUtc,
    prevEndUtc,
    bucketMode,
    spanDays,
  };
}

interface TimeBucketSeed {
  key: string;
  label: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildTimeBucketSeeds(range: ResolvedDateRange): TimeBucketSeed[] {
  const seeds: TimeBucketSeed[] = [];
  if (range.bucketMode === 'hourly') {
    for (let h = 0; h < 24; h += 1) {
      const hh = String(h).padStart(2, '0');
      const hr12 = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
      seeds.push({ key: hh, label: hr12 });
    }
    return seeds;
  }

  if (range.bucketMode === 'daily') {
    let cur = range.startDateYmd;
    let guard = 0;
    while (cur <= range.endDateYmd && guard < 120) {
      const mIdx = Math.max(0, Math.min(11, Number(cur.slice(5, 7)) - 1));
      const dayNum = Number(cur.slice(8, 10));
      seeds.push({
        key: cur,
        label: range.spanDays <= 7 ? new Date(`${cur}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) : `${dayNum} ${MONTH_NAMES[mIdx]}`,
      });
      cur = addDaysYmd(cur, 1);
      guard += 1;
    }
    return seeds;
  }

  // monthly buckets
  let y = Number(range.startDateYmd.slice(0, 4));
  let m = Number(range.startDateYmd.slice(5, 7));
  const endYm = range.endDateYmd.slice(0, 7);
  let guard = 0;
  while (`${y}-${String(m).padStart(2, '0')}` <= endYm && guard < 72) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    seeds.push({
      key: ym,
      label: `${MONTH_NAMES[m - 1]} '${String(y).slice(2)}`,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return seeds;
}

function getBucketKeyFromDate(dt: Date, mode: 'hourly' | 'daily' | 'monthly'): string {
  if (mode === 'hourly') return formatIstHourKey(dt);
  const ymd = formatIstYmd(dt);
  return mode === 'monthly' ? ymd.slice(0, 7) : ymd;
}

function buildSparkline(values: number[], targetPoints = 10): number[] {
  if (!values.length) return [0, 0, 0, 0, 0, 0];
  if (values.length <= targetPoints) return values;
  const out: number[] = [];
  const step = values.length / targetPoints;
  for (let i = 0; i < targetPoints; i += 1) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = start; j < end && j < values.length; j += 1) {
      sum += values[j];
    }
    out.push(roundTwo(sum));
  }
  return out;
}

async function resolveCreatorFinanceMeta(creatorId: number) {
  const [profileRows, walletRows, settingsRows] = await Promise.all([
    db
      .select({ customCommissionRate: creatorProfiles.customCommissionRate })
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, creatorId))
      .limit(1),
    db.select().from(creatorWallets).where(eq(creatorWallets.creatorId, creatorId)).limit(1),
    db.select().from(adminSettings),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const s of settingsRows) settingsMap[s.key] = s.value;
  const defaultPlatformRate = Number(settingsMap.default_commission_rate || 10);
  const creatorCustomRate = profileRows[0]?.customCommissionRate;
  const effectiveCommissionRate =
    creatorCustomRate !== null && creatorCustomRate !== undefined
      ? Number(creatorCustomRate)
      : defaultPlatformRate;

  const wallet = walletRows[0] || null;
  return {
    effectiveCommissionRate,
    commissionSource:
      creatorCustomRate !== null && creatorCustomRate !== undefined ? 'creator' : 'platform',
    defaultPlatformRate,
    minWithdrawalInr: Number(settingsMap.min_withdrawal_inr || 100),
    wallet: {
      totalEarningsInr: roundTwo(Number(wallet?.totalEarningsInr || 0)),
      pendingEarningsInr: roundTwo(Number(wallet?.pendingEarningsInr || 0)),
      availableBalanceInr: roundTwo(Number(wallet?.availableBalanceInr || 0)),
      withdrawnAmountInr: roundTwo(Number(wallet?.withdrawnAmountInr || 0)),
    },
  };
}

interface CreatorPublicationRow {
  id: number;
  title: string;
  slug: string;
  coverImageUrl: string | null;
  contentType: string;
  isFree: boolean;
  priceInr: number;
  status: string;
  classLevel: string | null;
  subjectName: string | null;
  categoryName: string | null;
  viewsCount: number;
  likesCount: number;
  downloadsCount: number;
  purchasesCount: number;
  avgRating: number;
  reviewsCount: number;
  publishedAt: Date | null;
  createdAt: Date;
}

async function fetchCreatorActiveContents(creatorId: number): Promise<CreatorPublicationRow[]> {
  const rows = await db
    .select({
      id: contents.id,
      title: contents.title,
      slug: contents.slug,
      coverImageUrl: contents.coverImageUrl,
      contentType: contents.contentType,
      isFree: contents.isFree,
      priceInr: contents.priceInr,
      status: contents.status,
      classLevel: contents.classLevel,
      subjectName: subjects.name,
      categoryName: categories.name,
      viewsCount: contents.viewsCount,
      likesCount: contents.likesCount,
      downloadsCount: contents.downloadsCount,
      purchasesCount: contents.purchasesCount,
      avgRating: contents.avgRating,
      reviewsCount: contents.reviewsCount,
      publishedAt: contents.publishedAt,
      createdAt: contents.createdAt,
    })
    .from(contents)
    .leftJoin(categories, eq(contents.categoryId, categories.id))
    .leftJoin(subjects, eq(contents.subjectId, subjects.id))
    .where(and(eq(contents.creatorId, creatorId), isNull(contents.deletedAt)))
    .orderBy(desc(contents.publishedAt), desc(contents.createdAt));

  return rows.map((r) => ({
    ...r,
    priceInr: Number(r.priceInr || 0),
    avgRating: Number(r.avgRating || 0),
  }));
}

async function fetchPeriodStatsPerContent(
  creatorId: number,
  range: ResolvedDateRange,
  contentIdFilter?: number
) {
  const contentScope = contentIdFilter
    ? sql`c.creator_id = ${creatorId} AND c.deleted_at IS NULL AND c.id = ${contentIdFilter}`
    : sql`c.creator_id = ${creatorId} AND c.deleted_at IS NULL`;

  const [viewsRowsRes, likesRowsRes, salesRowsRes, downloadsRowsRes] = await Promise.all([
    db.execute(sql`
      SELECT
        ve.content_id,
        COUNT(*) FILTER (WHERE ve.created_at >= ${range.startUtc} AND ve.created_at <= ${range.endUtc})::int AS cur_views,
        COUNT(DISTINCT COALESCE(NULLIF(ve.visitor_hash, ''), 'u:' || ve.user_id::text))
          FILTER (WHERE ve.created_at >= ${range.startUtc} AND ve.created_at <= ${range.endUtc})::int AS cur_unique_viewers,
        COUNT(*) FILTER (WHERE ve.created_at >= ${range.prevStartUtc} AND ve.created_at <= ${range.prevEndUtc})::int AS prev_views,
        COUNT(DISTINCT COALESCE(NULLIF(ve.visitor_hash, ''), 'u:' || ve.user_id::text))
          FILTER (WHERE ve.created_at >= ${range.prevStartUtc} AND ve.created_at <= ${range.prevEndUtc})::int AS prev_unique_viewers
      FROM content_view_events ve
      INNER JOIN contents c ON ve.content_id = c.id
      WHERE ${contentScope}
        AND ve.created_at >= ${range.prevStartUtc}
        AND ve.created_at <= ${range.endUtc}
      GROUP BY ve.content_id
    `),
    db.execute(sql`
      SELECT
        l.content_id,
        COUNT(*) FILTER (WHERE l.created_at >= ${range.startUtc} AND l.created_at <= ${range.endUtc})::int AS cur_likes,
        COUNT(*) FILTER (WHERE l.created_at >= ${range.prevStartUtc} AND l.created_at <= ${range.prevEndUtc})::int AS prev_likes
      FROM likes l
      INNER JOIN contents c ON l.content_id = c.id
      WHERE ${contentScope}
        AND l.created_at >= ${range.prevStartUtc}
        AND l.created_at <= ${range.endUtc}
      GROUP BY l.content_id
    `),
    db.execute(sql`
      SELECT
        cr.content_id,
        COUNT(*) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc})::int AS cur_sales,
        COALESCE(SUM(cr.gross_amount_inr) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS cur_gross_inr,
        COALESCE(SUM(cr.platform_commission_inr) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS cur_commission_inr,
        COALESCE(SUM(cr.creator_earnings_inr) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS cur_earnings_inr,
        COUNT(*) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.prevStartUtc} AND cr.created_at <= ${range.prevEndUtc})::int AS prev_sales,
        COALESCE(SUM(cr.creator_earnings_inr) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.prevStartUtc} AND cr.created_at <= ${range.prevEndUtc}), 0)::numeric(12,2) AS prev_earnings_inr
      FROM commission_records cr
      INNER JOIN contents c ON cr.content_id = c.id
      WHERE ${contentScope}
        AND cr.created_at >= ${range.prevStartUtc}
        AND cr.created_at <= ${range.endUtc}
      GROUP BY cr.content_id
    `),
    db.execute(sql`
      SELECT
        cd.content_id,
        COUNT(*) FILTER (WHERE cd.created_at >= ${range.startUtc} AND cd.created_at <= ${range.endUtc})::int AS cur_downloads,
        COUNT(*) FILTER (WHERE cd.created_at >= ${range.prevStartUtc} AND cd.created_at <= ${range.prevEndUtc})::int AS prev_downloads
      FROM content_downloads cd
      INNER JOIN contents c ON cd.content_id = c.id
      WHERE ${contentScope}
        AND cd.created_at >= ${range.prevStartUtc}
        AND cd.created_at <= ${range.endUtc}
      GROUP BY cd.content_id
    `),
  ]);

  const map = new Map<
    number,
    {
      curViews: number;
      curUniqueViewers: number;
      prevViews: number;
      prevUniqueViewers: number;
      curLikes: number;
      prevLikes: number;
      curSales: number;
      curGrossInr: number;
      curCommissionInr: number;
      curEarningsInr: number;
      prevSales: number;
      prevEarningsInr: number;
      curDownloads: number;
      prevDownloads: number;
    }
  >();

  const getOrInit = (cid: number) => {
    let row = map.get(cid);
    if (!row) {
      row = {
        curViews: 0,
        curUniqueViewers: 0,
        prevViews: 0,
        prevUniqueViewers: 0,
        curLikes: 0,
        prevLikes: 0,
        curSales: 0,
        curGrossInr: 0,
        curCommissionInr: 0,
        curEarningsInr: 0,
        prevSales: 0,
        prevEarningsInr: 0,
        curDownloads: 0,
        prevDownloads: 0,
      };
      map.set(cid, row);
    }
    return row;
  };

  for (const r of viewsRowsRes.rows as Array<Record<string, unknown>>) {
    const entry = getOrInit(Number(r.content_id));
    entry.curViews = Number(r.cur_views || 0);
    entry.curUniqueViewers = Number(r.cur_unique_viewers || 0);
    entry.prevViews = Number(r.prev_views || 0);
    entry.prevUniqueViewers = Number(r.prev_unique_viewers || 0);
  }
  for (const r of likesRowsRes.rows as Array<Record<string, unknown>>) {
    const entry = getOrInit(Number(r.content_id));
    entry.curLikes = Number(r.cur_likes || 0);
    entry.prevLikes = Number(r.prev_likes || 0);
  }
  for (const r of salesRowsRes.rows as Array<Record<string, unknown>>) {
    const entry = getOrInit(Number(r.content_id));
    entry.curSales = Number(r.cur_sales || 0);
    entry.curGrossInr = Number(r.cur_gross_inr || 0);
    entry.curCommissionInr = Number(r.cur_commission_inr || 0);
    entry.curEarningsInr = Number(r.cur_earnings_inr || 0);
    entry.prevSales = Number(r.prev_sales || 0);
    entry.prevEarningsInr = Number(r.prev_earnings_inr || 0);
  }
  for (const r of downloadsRowsRes.rows as Array<Record<string, unknown>>) {
    const entry = getOrInit(Number(r.content_id));
    entry.curDownloads = Number(r.cur_downloads || 0);
    entry.prevDownloads = Number(r.prev_downloads || 0);
  }

  return map;
}

async function fetchTimeSeriesData(
  creatorId: number,
  range: ResolvedDateRange,
  contentIdFilter?: number
) {
  const seeds = buildTimeBucketSeeds(range);
  const bucketMap = new Map<
    string,
    {
      key: string;
      label: string;
      views: number;
      uniqueViewersSet: Set<string>;
      likes: number;
      sales: number;
      grossInr: number;
      commissionInr: number;
      earningsInr: number;
      downloads: number;
    }
  >();

  for (const s of seeds) {
    bucketMap.set(s.key, {
      key: s.key,
      label: s.label,
      views: 0,
      uniqueViewersSet: new Set<string>(),
      likes: 0,
      sales: 0,
      grossInr: 0,
      commissionInr: 0,
      earningsInr: 0,
      downloads: 0,
    });
  }

  const contentScope = contentIdFilter
    ? sql`c.creator_id = ${creatorId} AND c.deleted_at IS NULL AND c.id = ${contentIdFilter}`
    : sql`c.creator_id = ${creatorId} AND c.deleted_at IS NULL`;

  const [viewRowsRes, likeRowsRes, commRowsRes, dlRowsRes] = await Promise.all([
    db.execute(sql`
      SELECT ve.created_at, ve.visitor_hash, ve.user_id
      FROM content_view_events ve
      INNER JOIN contents c ON ve.content_id = c.id
      WHERE ${contentScope}
        AND ve.created_at >= ${range.startUtc}
        AND ve.created_at <= ${range.endUtc}
    `),
    db.execute(sql`
      SELECT l.created_at
      FROM likes l
      INNER JOIN contents c ON l.content_id = c.id
      WHERE ${contentScope}
        AND l.created_at >= ${range.startUtc}
        AND l.created_at <= ${range.endUtc}
    `),
    db.execute(sql`
      SELECT cr.created_at, cr.gross_amount_inr, cr.platform_commission_inr, cr.creator_earnings_inr
      FROM commission_records cr
      INNER JOIN contents c ON cr.content_id = c.id
      WHERE ${contentScope}
        AND cr.status = 'credited'
        AND cr.created_at >= ${range.startUtc}
        AND cr.created_at <= ${range.endUtc}
    `),
    db.execute(sql`
      SELECT cd.created_at
      FROM content_downloads cd
      INNER JOIN contents c ON cd.content_id = c.id
      WHERE ${contentScope}
        AND cd.created_at >= ${range.startUtc}
        AND cd.created_at <= ${range.endUtc}
    `),
  ]);

  for (const r of viewRowsRes.rows as Array<Record<string, unknown>>) {
    const dt = new Date(String(r.created_at));
    const bucket = bucketMap.get(getBucketKeyFromDate(dt, range.bucketMode));
    if (!bucket) continue;
    bucket.views += 1;
    const vKey = r.visitor_hash
      ? String(r.visitor_hash)
      : r.user_id
      ? `u:${r.user_id}`
      : '';
    if (vKey) bucket.uniqueViewersSet.add(vKey);
  }

  for (const r of likeRowsRes.rows as Array<Record<string, unknown>>) {
    const dt = new Date(String(r.created_at));
    const bucket = bucketMap.get(getBucketKeyFromDate(dt, range.bucketMode));
    if (bucket) bucket.likes += 1;
  }

  for (const r of commRowsRes.rows as Array<Record<string, unknown>>) {
    const dt = new Date(String(r.created_at));
    const bucket = bucketMap.get(getBucketKeyFromDate(dt, range.bucketMode));
    if (!bucket) continue;
    bucket.sales += 1;
    bucket.grossInr = roundTwo(bucket.grossInr + Number(r.gross_amount_inr || 0));
    bucket.commissionInr = roundTwo(bucket.commissionInr + Number(r.platform_commission_inr || 0));
    bucket.earningsInr = roundTwo(bucket.earningsInr + Number(r.creator_earnings_inr || 0));
  }

  for (const r of dlRowsRes.rows as Array<Record<string, unknown>>) {
    const dt = new Date(String(r.created_at));
    const bucket = bucketMap.get(getBucketKeyFromDate(dt, range.bucketMode));
    if (bucket) bucket.downloads += 1;
  }

  return Array.from(bucketMap.values()).map((b) => ({
    key: b.key,
    label: b.label,
    views: b.views,
    uniqueViewers: b.uniqueViewersSet.size,
    likes: b.likes,
    sales: b.sales,
    grossInr: b.grossInr,
    commissionInr: b.commissionInr,
    earningsInr: b.earningsInr,
    downloads: b.downloads,
  }));
}

async function fetchTotalTrackedViewsMap(creatorId: number) {
  const res = await db.execute(sql`
    SELECT
      ve.content_id,
      COUNT(*)::int AS tracked_views,
      COUNT(DISTINCT COALESCE(NULLIF(ve.visitor_hash, ''), 'u:' || ve.user_id::text))::int AS tracked_unique_viewers
    FROM content_view_events ve
    INNER JOIN contents c ON ve.content_id = c.id
    WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL
    GROUP BY ve.content_id
  `);
  const map = new Map<number, { trackedViews: number; trackedUniqueViewers: number }>();
  for (const r of res.rows as Array<Record<string, unknown>>) {
    map.set(Number(r.content_id), {
      trackedViews: Number(r.tracked_views || 0),
      trackedUniqueViewers: Number(r.tracked_unique_viewers || 0),
    });
  }
  return map;
}

async function fetchLifetimeEarningsMap(creatorId: number) {
  const res = await db.execute(sql`
    SELECT
      cr.content_id,
      COALESCE(SUM(cr.gross_amount_inr) FILTER (WHERE cr.status = 'credited'), 0)::numeric(12,2) AS gross_inr,
      COALESCE(SUM(cr.creator_earnings_inr) FILTER (WHERE cr.status = 'credited'), 0)::numeric(12,2) AS earnings_inr,
      COUNT(*) FILTER (WHERE cr.status = 'credited')::int AS sales_count
    FROM commission_records cr
    WHERE cr.creator_id = ${creatorId}
    GROUP BY cr.content_id
  `);
  const map = new Map<number, { grossInr: number; earningsInr: number; salesCount: number }>();
  for (const r of res.rows as Array<Record<string, unknown>>) {
    map.set(Number(r.content_id), {
      grossInr: Number(r.gross_inr || 0),
      earningsInr: Number(r.earnings_inr || 0),
      salesCount: Number(r.sales_count || 0),
    });
  }
  return map;
}

function buildFilterPayload(range: ResolvedDateRange) {
  return {
    range: range.rangeKey,
    rangeLabel: range.rangeLabel,
    comparisonLabel: range.comparisonLabel,
    startDate: range.startDateYmd,
    endDate: range.endDateYmd,
    bucketMode: range.bucketMode,
    spanDays: range.spanDays,
    timezone: 'Asia/Kolkata',
  };
}

// 1. Main Content Performance Analytics Dashboard
export async function getCreatorAnalyticsOverview(
  creatorId: number,
  range: ResolvedDateRange
) {
  const [financeMeta, pubRows, periodMap, series, trackedMap, lifetimeEarningsMap] =
    await Promise.all([
      resolveCreatorFinanceMeta(creatorId),
      fetchCreatorActiveContents(creatorId),
      fetchPeriodStatsPerContent(creatorId, range),
      fetchTimeSeriesData(creatorId, range),
      fetchTotalTrackedViewsMap(creatorId),
      fetchLifetimeEarningsMap(creatorId),
    ]);

  let periodViews = 0;
  let prevViews = 0;
  let periodLikes = 0;
  let prevLikes = 0;
  let periodSales = 0;
  let prevSales = 0;
  let periodEarningsInr = 0;
  let prevEarningsInr = 0;
  let periodGrossInr = 0;
  let periodCommissionInr = 0;
  let lifetimeViews = 0;
  let lifetimeLikes = 0;
  let lifetimeSales = 0;
  let totalTrackedEventsAllTime = 0;

  const enrichedPublications = pubRows.map((c) => {
    const p = periodMap.get(c.id);
    const lEarn = lifetimeEarningsMap.get(c.id);
    const tView = trackedMap.get(c.id);

    const curV = p?.curViews || 0;
    const preV = p?.prevViews || 0;
    const curL = p?.curLikes || 0;
    const preL = p?.prevLikes || 0;
    const curS = p?.curSales || 0;
    const preS = p?.prevSales || 0;
    const curE = roundTwo(p?.curEarningsInr || 0);
    const preE = roundTwo(p?.prevEarningsInr || 0);

    periodViews += curV;
    prevViews += preV;
    periodLikes += curL;
    prevLikes += preL;
    periodSales += curS;
    prevSales += preS;
    periodEarningsInr = roundTwo(periodEarningsInr + curE);
    prevEarningsInr = roundTwo(prevEarningsInr + preE);
    periodGrossInr = roundTwo(periodGrossInr + (p?.curGrossInr || 0));
    periodCommissionInr = roundTwo(periodCommissionInr + (p?.curCommissionInr || 0));

    lifetimeViews += c.viewsCount;
    lifetimeLikes += c.likesCount;
    lifetimeSales += Math.max(c.purchasesCount, lEarn?.salesCount || 0);
    totalTrackedEventsAllTime += tView?.trackedViews || 0;

    // For individual row conversion rate, compute against period views when tracked, else lifetime views when displaying lifetime baseline
    const effectiveViewsForConversion = curV > 0 ? curV : c.viewsCount > 0 && curS === 0 ? c.viewsCount : curV;
    const conversionRate = computeRatePct(curS, effectiveViewsForConversion);
    const lifetimeConversionRate = computeRatePct(
      Math.max(c.purchasesCount, lEarn?.salesCount || 0),
      c.viewsCount
    );

    return {
      id: c.id,
      title: c.title,
      slug: c.slug,
      coverImageUrl: c.coverImageUrl,
      contentType: c.contentType,
      isFree: c.isFree,
      priceInr: c.priceInr,
      status: c.status,
      classLevel: c.classLevel,
      subjectName: c.subjectName || c.categoryName,
      views: curV,
      uniqueViewers: p?.curUniqueViewers || 0,
      likes: curL,
      sales: curS,
      earningsInr: curE,
      grossInr: roundTwo(p?.curGrossInr || 0),
      conversionRate,
      lifetimeViews: c.viewsCount,
      lifetimeLikes: c.likesCount,
      lifetimeSales: Math.max(c.purchasesCount, lEarn?.salesCount || 0),
      lifetimeEarningsInr: roundTwo(lEarn?.earningsInr || 0),
      lifetimeConversionRate,
      avgRating: c.reviewsCount > 0 ? c.avgRating : null,
      reviewsCount: c.reviewsCount,
      publishedAt: c.publishedAt || c.createdAt,
    };
  });

  // Sort Top Performing Publications cleanly (period activity first, then lifetime performance)
  const topPublications = [...enrichedPublications]
    .sort((a, b) => {
      const scoreA = a.earningsInr * 10 + a.sales * 20 + a.views * 2 + a.likes * 3 + a.lifetimeViews * 0.1;
      const scoreB = b.earningsInr * 10 + b.sales * 20 + b.views * 2 + b.likes * 3 + b.lifetimeViews * 0.1;
      return scoreB - scoreA;
    })
    .slice(0, 5);

  // Unique viewers across all creator content for the period
  const uniqueRes = await db.execute(sql`
    SELECT
      COUNT(DISTINCT COALESCE(NULLIF(ve.visitor_hash, ''), 'u:' || ve.user_id::text))::int AS unique_viewers
    FROM content_view_events ve
    INNER JOIN contents c ON ve.content_id = c.id
    WHERE c.creator_id = ${creatorId}
      AND c.deleted_at IS NULL
      AND ve.created_at >= ${range.startUtc}
      AND ve.created_at <= ${range.endUtc}
  `);
  const periodUniqueViewers = Number((uniqueRes.rows?.[0] as Record<string, unknown>)?.unique_viewers || 0);

  return {
    filter: buildFilterPayload(range),
    commissionConfig: {
      effectiveCommissionRate: financeMeta.effectiveCommissionRate,
      commissionSource: financeMeta.commissionSource,
      defaultPlatformRate: financeMeta.defaultPlatformRate,
    },
    historicalNote:
      lifetimeViews > totalTrackedEventsAllTime
        ? `Timestamped daily view telemetry started after ${lifetimeViews - totalTrackedEventsAllTime} earlier view(s) were recorded. Period graphs strictly reflect timestamped view events; all-time totals remain visible for full accuracy.`
        : null,
    kpis: {
      totalViews: {
        value: periodViews,
        lifetimeValue: lifetimeViews,
        uniqueViewers: periodUniqueViewers,
        growthPct: computeGrowthPct(periodViews, prevViews),
        sparkline: buildSparkline(series.map((s) => s.views)),
      },
      totalLikes: {
        value: periodLikes,
        lifetimeValue: lifetimeLikes,
        growthPct: computeGrowthPct(periodLikes, prevLikes),
        sparkline: buildSparkline(series.map((s) => s.likes)),
      },
      paidSales: {
        value: periodSales,
        lifetimeValue: lifetimeSales,
        growthPct: computeGrowthPct(periodSales, prevSales),
        sparkline: buildSparkline(series.map((s) => s.sales)),
      },
      creatorEarnings: {
        value: periodEarningsInr,
        grossInr: periodGrossInr,
        commissionInr: periodCommissionInr,
        lifetimeValue: financeMeta.wallet.totalEarningsInr,
        growthPct: computeGrowthPct(periodEarningsInr, prevEarningsInr),
        sparkline: buildSparkline(series.map((s) => s.earningsInr)),
      },
    },
    series,
    topPublications,
    totalPublicationsCount: enrichedPublications.length,
  };
}

// 2. Views Analytics Page
export async function getCreatorViewsAnalytics(creatorId: number, range: ResolvedDateRange) {
  const [pubRows, periodMap, series, trackedMap, uniqueTotalsRes] = await Promise.all([
    fetchCreatorActiveContents(creatorId),
    fetchPeriodStatsPerContent(creatorId, range),
    fetchTimeSeriesData(creatorId, range),
    fetchTotalTrackedViewsMap(creatorId),
    db.execute(sql`
      SELECT
        COUNT(DISTINCT COALESCE(NULLIF(ve.visitor_hash, ''), 'u:' || ve.user_id::text))
          FILTER (WHERE ve.created_at >= ${range.startUtc} AND ve.created_at <= ${range.endUtc})::int AS cur_unique,
        COUNT(DISTINCT COALESCE(NULLIF(ve.visitor_hash, ''), 'u:' || ve.user_id::text))
          FILTER (WHERE ve.created_at >= ${range.prevStartUtc} AND ve.created_at <= ${range.prevEndUtc})::int AS prev_unique
      FROM content_view_events ve
      INNER JOIN contents c ON ve.content_id = c.id
      WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL
        AND ve.created_at >= ${range.prevStartUtc}
        AND ve.created_at <= ${range.endUtc}
    `),
  ]);

  let totalViews = 0;
  let prevViews = 0;
  let lifetimeViews = 0;
  let allTimeTracked = 0;

  const list = pubRows.map((c) => {
    const p = periodMap.get(c.id);
    const t = trackedMap.get(c.id);
    const curV = p?.curViews || 0;
    const preV = p?.prevViews || 0;
    totalViews += curV;
    prevViews += preV;
    lifetimeViews += c.viewsCount;
    allTimeTracked += t?.trackedViews || 0;
    return {
      id: c.id,
      title: c.title,
      slug: c.slug,
      coverImageUrl: c.coverImageUrl,
      contentType: c.contentType,
      isFree: c.isFree,
      priceInr: c.priceInr,
      views: curV,
      uniqueViewers: p?.curUniqueViewers || 0,
      lifetimeViews: c.viewsCount,
      growthPct: computeGrowthPct(curV, preV),
    };
  });

  const uRow = (uniqueTotalsRes.rows?.[0] || {}) as Record<string, unknown>;
  const uniqueViewers = Number(uRow.cur_unique || 0);
  const prevUniqueViewers = Number(uRow.prev_unique || 0);

  const topViewed = [...list]
    .sort((a, b) => b.views - a.views || b.lifetimeViews - a.lifetimeViews)
    .slice(0, 6);

  return {
    filter: buildFilterPayload(range),
    summary: {
      totalViews,
      lifetimeViews,
      growthPct: computeGrowthPct(totalViews, prevViews),
      uniqueViewers,
      uniqueGrowthPct: computeGrowthPct(uniqueViewers, prevUniqueViewers),
      avgViewsPerDay: roundTwo(totalViews / Math.max(1, range.spanDays)),
      repeatViews: Math.max(0, totalViews - uniqueViewers),
    },
    historicalNote:
      lifetimeViews > allTimeTracked
        ? `Timestamped view events track new visits going forward (${allTimeTracked.toLocaleString('en-IN')} tracked vs ${lifetimeViews.toLocaleString('en-IN')} lifetime views).`
        : null,
    series: series.map((s) => ({
      key: s.key,
      label: s.label,
      views: s.views,
      uniqueViewers: s.uniqueViewers,
    })),
    topPublications: topViewed,
  };
}

// 3. Likes Analytics Page
export async function getCreatorLikesAnalytics(creatorId: number, range: ResolvedDateRange) {
  const [pubRows, periodMap, series, ratingRes] = await Promise.all([
    fetchCreatorActiveContents(creatorId),
    fetchPeriodStatsPerContent(creatorId, range),
    fetchTimeSeriesData(creatorId, range),
    db.execute(sql`
      SELECT
        COALESCE(AVG(r.rating), 0)::numeric(4,2) AS avg_rating,
        COUNT(*)::int AS reviews_count
      FROM reviews r
      INNER JOIN contents c ON r.content_id = c.id
      WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL AND r.is_hidden = false
    `),
  ]);

  let totalLikes = 0;
  let prevLikes = 0;
  let totalViews = 0;
  let lifetimeLikes = 0;

  const list = pubRows.map((c) => {
    const p = periodMap.get(c.id);
    const curL = p?.curLikes || 0;
    const preL = p?.prevLikes || 0;
    const curV = p?.curViews || 0;
    totalLikes += curL;
    prevLikes += preL;
    totalViews += curV;
    lifetimeLikes += c.likesCount;

    return {
      id: c.id,
      title: c.title,
      slug: c.slug,
      coverImageUrl: c.coverImageUrl,
      contentType: c.contentType,
      isFree: c.isFree,
      priceInr: c.priceInr,
      likes: curL,
      lifetimeLikes: c.likesCount,
      views: curV,
      lifetimeViews: c.viewsCount,
      engagementRate: computeRatePct(curL, curV > 0 ? curV : c.viewsCount > 0 && curL === 0 ? c.viewsCount : curV),
      growthPct: computeGrowthPct(curL, preL),
    };
  });

  const rRow = (ratingRes.rows?.[0] || {}) as Record<string, unknown>;
  const reviewsCount = Number(rRow.reviews_count || 0);
  const avgRating = reviewsCount > 0 ? Number(Number(rRow.avg_rating || 0).toFixed(1)) : null;

  const topLiked = [...list]
    .sort((a, b) => b.likes - a.likes || b.lifetimeLikes - a.lifetimeLikes)
    .slice(0, 6);

  return {
    filter: buildFilterPayload(range),
    summary: {
      totalLikes,
      lifetimeLikes,
      growthPct: computeGrowthPct(totalLikes, prevLikes),
      engagementRate: computeRatePct(totalLikes, totalViews),
      avgRating,
      reviewsCount,
    },
    series: series.map((s) => ({
      key: s.key,
      label: s.label,
      likes: s.likes,
    })),
    topPublications: topLiked,
  };
}

// 4. Sales Analytics Page (Strictly Creator-Scoped, Zero Buyer PII)
export async function getCreatorSalesAnalytics(
  creatorId: number,
  range: ResolvedDateRange,
  opts: { orderStatus?: string; page?: number; limit?: number } = {}
) {
  const orderStatus = String(opts.orderStatus || 'all').trim().toLowerCase();
  if (!['all', 'captured', 'failed', 'refunded'].includes(orderStatus)) {
    throw new AnalyticsValidationError(400, 'Invalid order status filter.');
  }
  const page = Math.max(1, Math.min(1000, Number(opts.page || 1) || 1));
  const limit = Math.max(1, Math.min(50, Number(opts.limit || 10) || 10));
  const offset = (page - 1) * limit;

  const [
    pubRows,
    periodMap,
    orderAggRes,
    orderSeriesRes,
    freeEngagementRes,
    ordersListRes,
    ordersCountRes,
  ] = await Promise.all([
    fetchCreatorActiveContents(creatorId),
    fetchPeriodStatsPerContent(creatorId, range),
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE p.status = 'captured' AND p.created_at >= ${range.startUtc} AND p.created_at <= ${range.endUtc})::int AS successful_orders,
        COALESCE(SUM(p.amount_inr) FILTER (WHERE p.status = 'captured' AND p.created_at >= ${range.startUtc} AND p.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS captured_gross_inr,
        COUNT(*) FILTER (WHERE p.status = 'failed' AND p.created_at >= ${range.startUtc} AND p.created_at <= ${range.endUtc})::int AS cancelled_orders,
        COUNT(*) FILTER (WHERE p.status = 'refunded' AND p.created_at >= ${range.startUtc} AND p.created_at <= ${range.endUtc})::int AS refunded_orders,
        COALESCE(SUM(p.amount_inr) FILTER (WHERE p.status = 'refunded' AND p.created_at >= ${range.startUtc} AND p.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS refunded_inr,
        COUNT(*) FILTER (WHERE p.status = 'captured' AND p.created_at >= ${range.prevStartUtc} AND p.created_at <= ${range.prevEndUtc})::int AS prev_successful_orders,
        COUNT(*) FILTER (WHERE p.status = 'failed' AND p.created_at >= ${range.prevStartUtc} AND p.created_at <= ${range.prevEndUtc})::int AS prev_cancelled_orders,
        COUNT(*) FILTER (WHERE p.status = 'refunded' AND p.created_at >= ${range.prevStartUtc} AND p.created_at <= ${range.prevEndUtc})::int AS prev_refunded_orders
      FROM payments p
      INNER JOIN contents c ON p.content_id = c.id
      WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL
        AND p.created_at >= ${range.prevStartUtc}
        AND p.created_at <= ${range.endUtc}
    `),
    db.execute(sql`
      SELECT p.created_at, p.amount_inr
      FROM payments p
      INNER JOIN contents c ON p.content_id = c.id
      WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL
        AND p.status = 'captured'
        AND p.created_at >= ${range.startUtc}
        AND p.created_at <= ${range.endUtc}
    `),
    db.execute(sql`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM content_downloads cd
          INNER JOIN contents c ON cd.content_id = c.id
          WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL AND c.is_free = true
            AND cd.created_at >= ${range.startUtc} AND cd.created_at <= ${range.endUtc}
        ) AS free_downloads,
        (
          SELECT COUNT(*)::int
          FROM content_view_events ve
          INNER JOIN contents c ON ve.content_id = c.id
          WHERE c.creator_id = ${creatorId} AND c.deleted_at IS NULL AND c.is_free = true
            AND ve.created_at >= ${range.startUtc} AND ve.created_at <= ${range.endUtc}
        ) AS free_views
    `),
    db.execute(sql`
      SELECT
        p.id AS order_id,
        p.receipt_number,
        p.content_id,
        c.title AS content_title,
        c.slug AS content_slug,
        c.content_type,
        p.amount_inr,
        p.status,
        p.created_at
      FROM payments p
      INNER JOIN contents c ON p.content_id = c.id
      WHERE c.creator_id = ${creatorId}
        AND c.deleted_at IS NULL
        AND p.created_at >= ${range.startUtc}
        AND p.created_at <= ${range.endUtc}
        ${orderStatus === 'all' ? sql`AND p.status IN ('captured', 'failed', 'refunded')` : sql`AND p.status = ${orderStatus}`}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM payments p
      INNER JOIN contents c ON p.content_id = c.id
      WHERE c.creator_id = ${creatorId}
        AND c.deleted_at IS NULL
        AND p.created_at >= ${range.startUtc}
        AND p.created_at <= ${range.endUtc}
        ${orderStatus === 'all' ? sql`AND p.status IN ('captured', 'failed', 'refunded')` : sql`AND p.status = ${orderStatus}`}
    `),
  ]);

  const agg = (orderAggRes.rows?.[0] || {}) as Record<string, unknown>;
  const successfulOrders = Number(agg.successful_orders || 0);
  const cancelledOrders = Number(agg.cancelled_orders || 0);
  const refundedOrders = Number(agg.refunded_orders || 0);
  const capturedGrossInr = roundTwo(Number(agg.captured_gross_inr || 0));
  const refundedInr = roundTwo(Number(agg.refunded_inr || 0));
  const prevSuccessful = Number(agg.prev_successful_orders || 0);
  const prevCancelled = Number(agg.prev_cancelled_orders || 0);
  const prevRefunded = Number(agg.prev_refunded_orders || 0);

  // Build dual-series Sales Trend (Orders + Gross Sales Amount INR)
  const seeds = buildTimeBucketSeeds(range);
  const trendMap = new Map(
    seeds.map((s) => [s.key, { key: s.key, label: s.label, orders: 0, salesAmountInr: 0 }])
  );
  for (const r of orderSeriesRes.rows as Array<Record<string, unknown>>) {
    const dt = new Date(String(r.created_at));
    const b = trendMap.get(getBucketKeyFromDate(dt, range.bucketMode));
    if (!b) continue;
    b.orders += 1;
    b.salesAmountInr = roundTwo(b.salesAmountInr + Number(r.amount_inr || 0));
  }

  const freeAgg = (freeEngagementRes.rows?.[0] || {}) as Record<string, unknown>;
  const freeDownloads = Number(freeAgg.free_downloads || 0);
  const freeViews = Number(freeAgg.free_views || 0);

  const topSelling = pubRows
    .map((c) => {
      const p = periodMap.get(c.id);
      return {
        id: c.id,
        title: c.title,
        slug: c.slug,
        coverImageUrl: c.coverImageUrl,
        contentType: c.contentType,
        isFree: c.isFree,
        priceInr: c.priceInr,
        sales: p?.curSales || 0,
        grossInr: roundTwo(p?.curGrossInr || 0),
        earningsInr: roundTwo(p?.curEarningsInr || 0),
        lifetimeSales: c.purchasesCount,
      };
    })
    .filter((item) => !item.isFree || item.sales > 0 || item.lifetimeSales > 0)
    .sort((a, b) => b.sales - a.sales || b.grossInr - a.grossInr || b.lifetimeSales - a.lifetimeSales)
    .slice(0, 6);

  const totalOrdersCount = Number((ordersCountRes.rows?.[0] as Record<string, unknown>)?.total || 0);

  return {
    filter: buildFilterPayload(range),
    orderStatus,
    kpis: {
      totalSales: {
        value: successfulOrders,
        grossRevenueInr: capturedGrossInr,
        growthPct: computeGrowthPct(successfulOrders, prevSuccessful),
      },
      successfulOrders: {
        value: successfulOrders,
        growthPct: computeGrowthPct(successfulOrders, prevSuccessful),
      },
      cancelledOrders: {
        value: cancelledOrders,
        growthPct: computeGrowthPct(cancelledOrders, prevCancelled),
      },
      refundedOrders: {
        value: refundedOrders,
        refundedInr,
        growthPct: computeGrowthPct(refundedOrders, prevRefunded),
      },
    },
    series: Array.from(trendMap.values()),
    breakdown: {
      paidOrdersCount: successfulOrders,
      paidRevenueInr: capturedGrossInr,
      freeDownloadsCount: freeDownloads,
      freeViewsCount: freeViews,
      paidSharePct:
        successfulOrders + freeDownloads > 0
          ? roundTwo((successfulOrders / (successfulOrders + freeDownloads)) * 100)
          : successfulOrders > 0
          ? 100
          : 0,
      freeSharePct:
        successfulOrders + freeDownloads > 0
          ? roundTwo((freeDownloads / (successfulOrders + freeDownloads)) * 100)
          : 0,
      note: 'Free content downloads and views are tracked separately and never counted as paid sales revenue.',
    },
    topSelling,
    orders: (ordersListRes.rows as Array<Record<string, unknown>>).map((o) => ({
      orderId: Number(o.order_id),
      receiptNumber: String(o.receipt_number || ''),
      contentId: Number(o.content_id),
      contentTitle: String(o.content_title || ''),
      contentSlug: String(o.content_slug || ''),
      contentType: String(o.content_type || ''),
      amountInr: roundTwo(Number(o.amount_inr || 0)),
      status: String(o.status || ''),
      createdAt: new Date(String(o.created_at)).toISOString(),
    })),
    ordersPagination: {
      page,
      limit,
      total: totalOrdersCount,
      totalPages: Math.max(1, Math.ceil(totalOrdersCount / limit)),
    },
  };
}

// 5. Earnings Analytics Page (Read-only financial truth from commissionRecords & creatorWallets)
export async function getCreatorEarningsAnalytics(
  creatorId: number,
  range: ResolvedDateRange,
  opts: { page?: number; limit?: number } = {}
) {
  const page = Math.max(1, Math.min(1000, Number(opts.page || 1) || 1));
  const limit = Math.max(1, Math.min(50, Number(opts.limit || 10) || 10));
  const offset = (page - 1) * limit;

  const [
    financeMeta,
    pubRows,
    periodMap,
    series,
    periodFinanceRes,
    historyRowsRes,
    historyCountRes,
  ] = await Promise.all([
    resolveCreatorFinanceMeta(creatorId),
    fetchCreatorActiveContents(creatorId),
    fetchPeriodStatsPerContent(creatorId, range),
    fetchTimeSeriesData(creatorId, range),
    db.execute(sql`
      SELECT
        COALESCE(SUM(cr.gross_amount_inr) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS gross_sales_inr,
        COALESCE(SUM(cr.platform_commission_inr) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS platform_commission_inr,
        COALESCE(SUM(cr.creator_earnings_inr) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS creator_earnings_inr,
        COUNT(*) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc})::int AS sales_count,
        COALESCE(SUM(cr.creator_earnings_inr) FILTER (WHERE cr.status = 'reversed' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc}), 0)::numeric(12,2) AS reversed_earnings_inr,
        COUNT(*) FILTER (WHERE cr.status = 'reversed' AND cr.created_at >= ${range.startUtc} AND cr.created_at <= ${range.endUtc})::int AS reversed_count,
        COALESCE(SUM(cr.creator_earnings_inr) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.prevStartUtc} AND cr.created_at <= ${range.prevEndUtc}), 0)::numeric(12,2) AS prev_creator_earnings_inr,
        COUNT(*) FILTER (WHERE cr.status = 'credited' AND cr.created_at >= ${range.prevStartUtc} AND cr.created_at <= ${range.prevEndUtc})::int AS prev_sales_count
      FROM commission_records cr
      WHERE cr.creator_id = ${creatorId}
        AND cr.created_at >= ${range.prevStartUtc}
        AND cr.created_at <= ${range.endUtc}
    `),
    db
      .select({
        id: commissionRecords.id,
        contentId: commissionRecords.contentId,
        contentTitle: contents.title,
        contentSlug: contents.slug,
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
      .where(
        and(
          eq(commissionRecords.creatorId, creatorId),
          sql`${commissionRecords.createdAt} >= ${range.startUtc} AND ${commissionRecords.createdAt} <= ${range.endUtc}`
        )
      )
      .orderBy(desc(commissionRecords.createdAt))
      .limit(limit)
      .offset(offset),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM commission_records
      WHERE creator_id = ${creatorId}
        AND created_at >= ${range.startUtc}
        AND created_at <= ${range.endUtc}
    `),
  ]);

  const fRow = (periodFinanceRes.rows?.[0] || {}) as Record<string, unknown>;
  const grossSalesInr = roundTwo(Number(fRow.gross_sales_inr || 0));
  const platformCommissionInr = roundTwo(Number(fRow.platform_commission_inr || 0));
  const creatorEarningsInr = roundTwo(Number(fRow.creator_earnings_inr || 0));
  const salesCount = Number(fRow.sales_count || 0);
  const reversedEarningsInr = roundTwo(Number(fRow.reversed_earnings_inr || 0));
  const reversedCount = Number(fRow.reversed_count || 0);
  const prevCreatorEarningsInr = roundTwo(Number(fRow.prev_creator_earnings_inr || 0));
  const prevSalesCount = Number(fRow.prev_sales_count || 0);

  let totalViews = 0;
  let prevViews = 0;
  for (const p of periodMap.values()) {
    totalViews += p.curViews;
    prevViews += p.prevViews;
  }

  const conversionRate = computeRatePct(salesCount, totalViews);
  const prevConversionRate = computeRatePct(prevSalesCount, prevViews);
  const conversionDeltaPctPoints =
    conversionRate !== null && prevConversionRate !== null
      ? roundTwo(conversionRate - prevConversionRate)
      : null;

  const topEarning = pubRows
    .map((c) => {
      const p = periodMap.get(c.id);
      return {
        id: c.id,
        title: c.title,
        slug: c.slug,
        coverImageUrl: c.coverImageUrl,
        contentType: c.contentType,
        isFree: c.isFree,
        priceInr: c.priceInr,
        sales: p?.curSales || 0,
        grossInr: roundTwo(p?.curGrossInr || 0),
        commissionInr: roundTwo(p?.curCommissionInr || 0),
        earningsInr: roundTwo(p?.curEarningsInr || 0),
        lifetimeSales: c.purchasesCount,
      };
    })
    .filter((item) => !item.isFree || item.earningsInr > 0 || item.lifetimeSales > 0)
    .sort((a, b) => b.earningsInr - a.earningsInr || b.sales - a.sales || b.lifetimeSales - a.lifetimeSales)
    .slice(0, 6);

  const historyTotal = Number((historyCountRes.rows?.[0] as Record<string, unknown>)?.total || 0);

  return {
    filter: buildFilterPayload(range),
    commissionConfig: {
      effectiveCommissionRate: financeMeta.effectiveCommissionRate,
      commissionSource: financeMeta.commissionSource,
      defaultPlatformRate: financeMeta.defaultPlatformRate,
    },
    wallet: financeMeta.wallet,
    kpis: {
      creatorEarnings: {
        value: creatorEarningsInr,
        lifetimeValue: financeMeta.wallet.totalEarningsInr,
        growthPct: computeGrowthPct(creatorEarningsInr, prevCreatorEarningsInr),
        sparkline: buildSparkline(series.map((s) => s.earningsInr)),
      },
      paidSales: {
        value: salesCount,
        growthPct: computeGrowthPct(salesCount, prevSalesCount),
        sparkline: buildSparkline(series.map((s) => s.sales)),
      },
      conversionRate: {
        value: conversionRate,
        deltaPoints: conversionDeltaPctPoints,
      },
      pendingEarnings: {
        value: financeMeta.wallet.pendingEarningsInr,
        availableBalanceInr: financeMeta.wallet.availableBalanceInr,
        withdrawnAmountInr: financeMeta.wallet.withdrawnAmountInr,
        minWithdrawalInr: financeMeta.minWithdrawalInr,
      },
    },
    financialBreakdown: {
      grossSalesInr,
      platformCommissionInr,
      creatorEarningsInr,
      reversedEarningsInr,
      reversedCount,
      effectiveCommissionRate:
        grossSalesInr > 0
          ? roundTwo((platformCommissionInr / grossSalesInr) * 100)
          : financeMeta.effectiveCommissionRate,
      creatorSharePct:
        grossSalesInr > 0
          ? roundTwo((creatorEarningsInr / grossSalesInr) * 100)
          : roundTwo(100 - financeMeta.effectiveCommissionRate),
    },
    series: series.map((s) => ({
      key: s.key,
      label: s.label,
      grossInr: s.grossInr,
      commissionInr: s.commissionInr,
      creatorEarningsInr: s.earningsInr,
      sales: s.sales,
    })),
    topEarning,
    history: historyRowsRes.map((h) => ({
      id: h.id,
      contentId: h.contentId,
      contentTitle: h.contentTitle,
      contentSlug: h.contentSlug,
      grossAmountInr: roundTwo(Number(h.grossAmountInr || 0)),
      commissionRate: Number(h.commissionRate || 0),
      commissionSource: h.commissionSource,
      platformCommissionInr: roundTwo(Number(h.platformCommissionInr || 0)),
      creatorEarningsInr: roundTwo(Number(h.creatorEarningsInr || 0)),
      status: h.status,
      createdAt: new Date(h.createdAt).toISOString(),
    })),
    historyPagination: {
      page,
      limit,
      total: historyTotal,
      totalPages: Math.max(1, Math.ceil(historyTotal / limit)),
    },
  };
}

// 6. Individual Publication Performance Details (Strict Creator Ownership Isolation)
export async function getPublicationAnalyticsDetail(
  contentId: number,
  requesterUser: { id: number; role: string },
  range: ResolvedDateRange
) {
  const [contentRow] = await db
    .select({
      id: contents.id,
      creatorId: contents.creatorId,
      title: contents.title,
      shortDescription: contents.shortDescription,
      slug: contents.slug,
      coverImageUrl: contents.coverImageUrl,
      contentType: contents.contentType,
      language: contents.language,
      classLevel: contents.classLevel,
      isFree: contents.isFree,
      priceInr: contents.priceInr,
      status: contents.status,
      deletedAt: contents.deletedAt,
      viewsCount: contents.viewsCount,
      likesCount: contents.likesCount,
      downloadsCount: contents.downloadsCount,
      purchasesCount: contents.purchasesCount,
      avgRating: contents.avgRating,
      reviewsCount: contents.reviewsCount,
      publishedAt: contents.publishedAt,
      createdAt: contents.createdAt,
      categoryName: categories.name,
      subjectName: subjects.name,
    })
    .from(contents)
    .leftJoin(categories, eq(contents.categoryId, categories.id))
    .leftJoin(subjects, eq(contents.subjectId, subjects.id))
    .where(eq(contents.id, contentId))
    .limit(1);

  if (!contentRow || contentRow.deletedAt) {
    throw new AnalyticsValidationError(404, 'Publication not found.');
  }
  if (contentRow.creatorId !== requesterUser.id && requesterUser.role !== 'admin') {
    throw new AnalyticsValidationError(403, 'Unauthorized: you can only view analytics for your own publications.');
  }

  const [periodMap, series, referrersRes, ratingRes, siblingStatsRes, lifetimeEarnRes] =
    await Promise.all([
      fetchPeriodStatsPerContent(contentRow.creatorId, range, contentRow.id),
      fetchTimeSeriesData(contentRow.creatorId, range, contentRow.id),
      db.execute(sql`
        SELECT
          COALESCE(NULLIF(TRIM(referrer_label), ''), 'Direct') AS label,
          COALESCE(NULLIF(TRIM(referrer_source), ''), 'direct') AS source,
          COUNT(*)::int AS views_count
        FROM content_view_events
        WHERE content_id = ${contentRow.id}
          AND created_at >= ${range.startUtc}
          AND created_at <= ${range.endUtc}
        GROUP BY COALESCE(NULLIF(TRIM(referrer_label), ''), 'Direct'), COALESCE(NULLIF(TRIM(referrer_source), ''), 'direct')
        ORDER BY views_count DESC
        LIMIT 8
      `),
      db.execute(sql`
        SELECT
          COALESCE(AVG(rating), 0)::numeric(4,2) AS avg_rating,
          COUNT(*)::int AS reviews_count
        FROM reviews
        WHERE content_id = ${contentRow.id} AND is_hidden = false
      `),
      db.execute(sql`
        SELECT id, views_count, purchases_count
        FROM contents
        WHERE creator_id = ${contentRow.creatorId} AND deleted_at IS NULL AND status = 'approved'
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(gross_amount_inr) FILTER (WHERE status = 'credited'), 0)::numeric(12,2) AS gross_inr,
          COALESCE(SUM(platform_commission_inr) FILTER (WHERE status = 'credited'), 0)::numeric(12,2) AS commission_inr,
          COALESCE(SUM(creator_earnings_inr) FILTER (WHERE status = 'credited'), 0)::numeric(12,2) AS earnings_inr
        FROM commission_records
        WHERE content_id = ${contentRow.id}
      `),
    ]);

  const p = periodMap.get(contentRow.id) || {
    curViews: 0,
    curUniqueViewers: 0,
    prevViews: 0,
    prevUniqueViewers: 0,
    curLikes: 0,
    prevLikes: 0,
    curSales: 0,
    curGrossInr: 0,
    curCommissionInr: 0,
    curEarningsInr: 0,
    prevSales: 0,
    prevEarningsInr: 0,
    curDownloads: 0,
    prevDownloads: 0,
  };

  const rRow = (ratingRes.rows?.[0] || {}) as Record<string, unknown>;
  const reviewsCount = Number(rRow.reviews_count || 0);
  const avgRating = reviewsCount > 0 ? Number(Number(rRow.avg_rating || 0).toFixed(1)) : null;

  const lEarn = (lifetimeEarnRes.rows?.[0] || {}) as Record<string, unknown>;
  const lifetimeEarningsInr = roundTwo(Number(lEarn.earnings_inr || 0));

  // Referrer source distribution (strictly from real content_view_events)
  const rawReferrers = (referrersRes.rows as Array<Record<string, unknown>>).map((r) => ({
    label: String(r.label || 'Direct'),
    source: String(r.source || 'direct'),
    views: Number(r.views_count || 0),
  }));
  const totalRefViews = rawReferrers.reduce((sum, r) => sum + r.views, 0);
  const topReferrers = rawReferrers.map((r) => ({
    ...r,
    sharePct: totalRefViews > 0 ? Number(((r.views / totalRefViews) * 100).toFixed(1)) : 0,
  }));

  // Honest percentile / performance badge ONLY when creator has >= 2 approved publications and real data
  const siblings = (siblingStatsRes.rows as Array<Record<string, unknown>>).map((s) => ({
    id: Number(s.id),
    score: Number(s.views_count || 0) + Number(s.purchases_count || 0) * 15,
  }));
  let performanceTier: { badge: string; rank: number; total: number } | null = null;
  if (siblings.length >= 2 && (contentRow.viewsCount > 0 || contentRow.purchasesCount > 0)) {
    siblings.sort((a, b) => b.score - a.score);
    const rankIdx = siblings.findIndex((s) => s.id === contentRow.id);
    if (rankIdx !== -1) {
      const topPct = ((rankIdx + 1) / siblings.length) * 100;
      const badge =
        topPct <= 15
          ? 'Top 15% of your library'
          : topPct <= 35
          ? 'Top 35% of your library'
          : 'Performing steadily';
      performanceTier = {
        badge,
        rank: rankIdx + 1,
        total: siblings.length,
      };
    }
  }

  const effectiveViews = p.curViews > 0 ? p.curViews : contentRow.viewsCount > 0 && p.curLikes === 0 ? contentRow.viewsCount : p.curViews;

  return {
    filter: buildFilterPayload(range),
    publication: {
      id: contentRow.id,
      title: contentRow.title,
      shortDescription: contentRow.shortDescription || '',
      slug: contentRow.slug,
      coverImageUrl: contentRow.coverImageUrl,
      contentType: contentRow.contentType,
      language: contentRow.language,
      classLevel: contentRow.classLevel,
      subjectName: contentRow.subjectName,
      categoryName: contentRow.categoryName,
      isFree: contentRow.isFree,
      priceInr: Number(contentRow.priceInr || 0),
      status: contentRow.status,
      publishedAt: contentRow.publishedAt || contentRow.createdAt,
      performanceTier,
    },
    kpis: {
      totalViews: {
        value: p.curViews,
        lifetimeValue: contentRow.viewsCount,
        growthPct: computeGrowthPct(p.curViews, p.prevViews),
      },
      uniqueViewers: {
        value: p.curUniqueViewers,
        growthPct: computeGrowthPct(p.curUniqueViewers, p.prevUniqueViewers),
      },
      likes: {
        value: p.curLikes,
        lifetimeValue: contentRow.likesCount,
        growthPct: computeGrowthPct(p.curLikes, p.prevLikes),
      },
      paidSales: {
        value: p.curSales,
        lifetimeValue: contentRow.purchasesCount,
        growthPct: computeGrowthPct(p.curSales, p.prevSales),
      },
      creatorEarnings: {
        value: roundTwo(p.curEarningsInr),
        grossInr: roundTwo(p.curGrossInr),
        commissionInr: roundTwo(p.curCommissionInr),
        lifetimeValue: lifetimeEarningsInr,
        growthPct: computeGrowthPct(p.curEarningsInr, p.prevEarningsInr),
      },
    },
    insights: {
      avgViewsPerDay: roundTwo(p.curViews / Math.max(1, range.spanDays)),
      engagementRate: computeRatePct(p.curLikes, effectiveViews),
      conversionRate: computeRatePct(p.curSales, effectiveViews),
      downloadsInRange: p.curDownloads,
      lifetimeDownloads: contentRow.downloadsCount,
      avgRating,
      reviewsCount,
    },
    series,
    topReferrers: {
      available: topReferrers.length > 0,
      totalTrackedViews: totalRefViews,
      items: topReferrers,
    },
  };
}

// 7. View All Publications Analytics List (Search, Filter, Sort, Paginate)
export async function getCreatorAnalyticsPublicationsList(
  creatorId: number,
  range: ResolvedDateRange,
  opts: {
    metric?: string;
    q?: string;
    contentType?: string;
    tier?: string;
    sort?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  const metric = String(opts.metric || 'overview').trim().toLowerCase();
  const qRaw = String(opts.q || '').trim().slice(0, 120);
  const contentTypeFilter = String(opts.contentType || 'all').trim();
  const tierFilter = String(opts.tier || 'all').trim().toLowerCase();
  const sort = String(
    opts.sort ||
      (metric === 'likes'
        ? 'likes'
        : metric === 'sales'
        ? 'sales'
        : metric === 'earnings'
        ? 'earnings'
        : 'views')
  )
    .trim()
    .toLowerCase();

  if (!['overview', 'views', 'likes', 'sales', 'earnings'].includes(metric)) {
    throw new AnalyticsValidationError(400, 'Invalid analytics metric view.');
  }
  if (!['all', 'paid', 'free'].includes(tierFilter)) {
    throw new AnalyticsValidationError(400, 'Invalid pricing tier filter.');
  }
  if (!['views', 'likes', 'sales', 'earnings', 'conversion', 'latest'].includes(sort)) {
    throw new AnalyticsValidationError(400, 'Invalid sort option.');
  }

  const page = Math.max(1, Math.min(1000, Number(opts.page || 1) || 1));
  const limit = Math.max(1, Math.min(50, Number(opts.limit || 12) || 12));

  const [pubRows, periodMap, lifetimeEarningsMap] = await Promise.all([
    fetchCreatorActiveContents(creatorId),
    fetchPeriodStatsPerContent(creatorId, range),
    fetchLifetimeEarningsMap(creatorId),
  ]);

  const qNorm = normalizeEduQuery(qRaw);
  const qTokens = tokenizeEdu(qRaw);

  let rows = pubRows.map((c) => {
    const p = periodMap.get(c.id);
    const lEarn = lifetimeEarningsMap.get(c.id);
    const views = p?.curViews || 0;
    const likesCount = p?.curLikes || 0;
    const sales = p?.curSales || 0;
    const earningsInr = roundTwo(p?.curEarningsInr || 0);
    const grossInr = roundTwo(p?.curGrossInr || 0);
    const effectiveViews = views > 0 ? views : c.viewsCount > 0 && sales === 0 ? c.viewsCount : views;
    const conversionRate = computeRatePct(sales, effectiveViews);

    let searchScore = 0;
    if (qRaw) {
      const normTitle = normalizeEduQuery(c.title);
      const normMeta = normalizeEduQuery(
        [c.contentType, c.subjectName, c.categoryName, c.classLevel].filter(Boolean).join(' ')
      );
      if (normTitle.includes(qNorm)) searchScore += 60;
      else if (normMeta.includes(qNorm)) searchScore += 30;
      for (const tok of qTokens) {
        if (normTitle.includes(tok)) searchScore += 20;
        else if (normMeta.includes(tok)) searchScore += 10;
      }
      if (c.title.toLowerCase().includes(qRaw.toLowerCase())) searchScore += 25;
    }

    return {
      id: c.id,
      title: c.title,
      slug: c.slug,
      coverImageUrl: c.coverImageUrl,
      contentType: c.contentType,
      subjectName: c.subjectName || c.categoryName,
      classLevel: c.classLevel,
      isFree: c.isFree,
      priceInr: c.priceInr,
      status: c.status,
      views,
      uniqueViewers: p?.curUniqueViewers || 0,
      likes: likesCount,
      sales,
      grossInr,
      earningsInr,
      conversionRate,
      engagementRate: computeRatePct(likesCount, effectiveViews),
      lifetimeViews: c.viewsCount,
      lifetimeLikes: c.likesCount,
      lifetimeSales: Math.max(c.purchasesCount, lEarn?.salesCount || 0),
      lifetimeEarningsInr: roundTwo(lEarn?.earningsInr || 0),
      avgRating: c.reviewsCount > 0 ? c.avgRating : null,
      reviewsCount: c.reviewsCount,
      publishedAt: c.publishedAt || c.createdAt,
      _searchScore: searchScore,
    };
  });

  if (qRaw) {
    rows = rows.filter((r) => r._searchScore > 0);
  }
  if (contentTypeFilter && contentTypeFilter !== 'all') {
    rows = rows.filter((r) => r.contentType === contentTypeFilter);
  }
  if (tierFilter === 'paid') {
    rows = rows.filter((r) => !r.isFree);
  } else if (tierFilter === 'free') {
    rows = rows.filter((r) => r.isFree);
  }

  rows.sort((a, b) => {
    if (qRaw && b._searchScore !== a._searchScore) {
      return b._searchScore - a._searchScore;
    }
    switch (sort) {
      case 'likes':
        return b.likes - a.likes || b.lifetimeLikes - a.lifetimeLikes;
      case 'sales':
        return b.sales - a.sales || b.lifetimeSales - a.lifetimeSales;
      case 'earnings':
        return b.earningsInr - a.earningsInr || b.lifetimeEarningsInr - a.lifetimeEarningsInr;
      case 'conversion':
        return (b.conversionRate ?? -1) - (a.conversionRate ?? -1) || b.sales - a.sales;
      case 'latest':
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      default:
        return b.views - a.views || b.lifetimeViews - a.lifetimeViews;
    }
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;
  const items = rows.slice(offset, offset + limit).map(({ _searchScore, ...rest }) => rest);

  return {
    filter: buildFilterPayload(range),
    metric,
    q: qRaw,
    contentType: contentTypeFilter,
    tier: tierFilter,
    sort,
    items,
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
      hasPrev: safePage > 1,
      hasNext: safePage < totalPages,
    },
  };
}
