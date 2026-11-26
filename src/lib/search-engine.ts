import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  categories,
  contentEmbeddings,
  contents,
  contentTags,
  recommendationEvents,
  subjects,
  userProfiles,
  userSearchHistory,
  users,
  videoWatchProgress,
} from '../db/schema.ts';
import { getOrCompute } from './cache.ts';
import {
  computeLocalSemanticVector,
  cosineSimilarity,
  extractEducationalMeta,
  getQueryEmbedding,
  normalizeEduQuery,
  stemEduToken,
  tokenizeEdu,
} from './embeddings.ts';

export interface IndexedCatalogItem {
  id: number;
  title: string;
  slug: string;
  authorName: string | null;
  publisherName: string | null;
  shortDescription: string;
  coverImageUrl: string | null;
  contentType: string;
  language: string;
  priceInr: string;
  isFree: boolean;
  isFeatured: boolean;
  viewsCount: number;
  likesCount: number;
  purchasesCount: number;
  avgRating: string;
  reviewsCount: number;
  readingTimeMins: number;
  publishedAt: Date | null;
  createdAt: Date;
  categoryId: number | null;
  categoryName: string | null;
  categorySlug: string | null;
  subjectId: number | null;
  subjectName: string | null;
  subjectSlug: string | null;
  creatorId: number;
  creatorName: string;
  creatorAvatar: string | null;
  classLevel: string | null;
  chapter: string | null;
  topic: string | null;
  chapterOrder: number | null;
  durationSeconds: number | null;
  studyLabel: string | null;
  tags: string[];
  // Search & ML precomputed fields
  effectiveClassLevel: string | null;
  effectiveChapter: string | null;
  effectiveTopic: string | null;
  effectiveChapterOrder: number | null;
  effectiveStudyLabel: string | null;
  normTitle: string;
  normCreator: string;
  normSubject: string;
  normCategory: string;
  normChapter: string;
  normTopic: string;
  normTags: string;
  normDesc: string;
  normAll: string;
  titleTokens: string[];
  metaTokens: string[];
  allTokens: string[];
  stemmedTokenSet: Set<string>;
  embeddingModel: string;
  vectorJson: number[];
  fallbackVectorJson: number[];
  ctrScore: number;
}

const CATALOG_INDEX_CACHE_KEY = 'catalog:search_index_v1';

function buildIndexedCatalogItem(
  row: {
    id: number;
    title: string;
    slug: string;
    authorName: string | null;
    publisherName: string | null;
    shortDescription: string;
    coverImageUrl: string | null;
    contentType: string;
    language: string;
    priceInr: string;
    isFree: boolean;
    isFeatured: boolean;
    viewsCount: number;
    likesCount: number;
    purchasesCount: number;
    avgRating: string;
    reviewsCount: number;
    readingTimeMins: number;
    publishedAt: Date | null;
    createdAt: Date;
    categoryId: number | null;
    categoryName: string | null;
    categorySlug: string | null;
    subjectId: number | null;
    subjectName: string | null;
    subjectSlug: string | null;
    creatorId: number;
    creatorName: string;
    creatorAvatar: string | null;
    classLevel: string | null;
    chapter: string | null;
    topic: string | null;
    chapterOrder: number | null;
    durationSeconds: number | null;
    studyLabel: string | null;
  },
  tags: string[],
  embed: { embeddingModel: string; vectorJson: unknown; fallbackVectorJson: unknown } | undefined,
  ctrScore: number
): IndexedCatalogItem {
  const combinedRaw = [
    row.title,
    row.classLevel || '',
    row.categoryName || '',
    row.subjectName || '',
    row.chapter || '',
    row.topic || '',
    row.studyLabel || '',
    tags.join(' '),
    row.shortDescription,
  ]
    .filter(Boolean)
    .join(' ');

  const extracted = extractEducationalMeta(combinedRaw, {
    classLevel: row.classLevel,
    chapter: row.chapter,
    topic: row.topic,
    chapterOrder: row.chapterOrder,
    studyLabel: row.studyLabel,
    language: row.language,
  });

  const normTitle = normalizeEduQuery(row.title);
  const normCreator = normalizeEduQuery(row.creatorName || '');
  const normSubject = normalizeEduQuery(row.subjectName || '');
  const normCategory = normalizeEduQuery(row.categoryName || '');
  const normChapter = normalizeEduQuery(row.chapter || '');
  const normTopic = normalizeEduQuery(row.topic || '');
  const normTags = normalizeEduQuery(tags.join(' '));
  const normDesc = normalizeEduQuery(row.shortDescription);
  const normAll = [
    normTitle,
    normSubject,
    normCategory,
    normChapter,
    normTopic,
    normTags,
    normCreator,
    normalizeEduQuery(row.contentType),
    normalizeEduQuery(row.classLevel || ''),
    normalizeEduQuery(row.studyLabel || ''),
    normDesc,
  ]
    .filter(Boolean)
    .join(' ');

  const titleTokens = tokenizeEdu(normTitle, true);
  const metaTokens = tokenizeEdu(
    [
      row.classLevel || '',
      row.categoryName || '',
      row.subjectName || '',
      row.chapter || '',
      row.topic || '',
      row.studyLabel || '',
      tags.join(' '),
      row.creatorName,
      row.contentType,
      row.language,
    ].join(' '),
    true
  );
  const allTokens = Array.from(new Set([...titleTokens, ...metaTokens, ...tokenizeEdu(normDesc, true)]));
  const stemmedTokenSet = new Set(allTokens.map(stemEduToken));

  const fallbackVectorJson =
    (embed?.fallbackVectorJson as number[] | undefined) ||
    computeLocalSemanticVector(normAll);
  const vectorJson = (embed?.vectorJson as number[] | undefined) || fallbackVectorJson;

  return {
    ...row,
    tags,
    effectiveClassLevel: row.classLevel || extracted.classLevel,
    effectiveChapter: row.chapter || (extracted.chapterOrder ? `Chapter ${extracted.chapterOrder}` : null),
    effectiveTopic: row.topic || row.subjectName || null,
    effectiveChapterOrder: row.chapterOrder ?? extracted.chapterOrder,
    effectiveStudyLabel: row.studyLabel || extracted.studyLabelHint,
    normTitle,
    normCreator,
    normSubject,
    normCategory,
    normChapter,
    normTopic,
    normTags,
    normDesc,
    normAll,
    titleTokens,
    metaTokens,
    allTokens,
    stemmedTokenSet,
    embeddingModel: embed?.embeddingModel || 'local-edu-v1',
    vectorJson,
    fallbackVectorJson,
    ctrScore,
  };
}

export async function getIndexedCatalog(): Promise<IndexedCatalogItem[]> {
  return getOrCompute(CATALOG_INDEX_CACHE_KEY, 45_000, async () => {
    const rows = await db
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
        categoryId: contents.categoryId,
        categoryName: categories.name,
        categorySlug: categories.slug,
        subjectId: contents.subjectId,
        subjectName: subjects.name,
        subjectSlug: subjects.slug,
        creatorId: users.id,
        creatorName: sql<string>`COALESCE(NULLIF(TRIM(${contents.authorName}), ''), ${users.name})`,
        creatorAvatar: users.avatarUrl,
        classLevel: contents.classLevel,
        chapter: contents.chapter,
        topic: contents.topic,
        chapterOrder: contents.chapterOrder,
        durationSeconds: contents.durationSeconds,
        studyLabel: contents.studyLabel,
      })
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(and(eq(contents.status, 'approved'), isNull(contents.deletedAt)));

    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const [tagRows, embedRows, ctrRows] = await Promise.all([
      db.select().from(contentTags).where(inArray(contentTags.contentId, ids)),
      db.select().from(contentEmbeddings).where(inArray(contentEmbeddings.contentId, ids)),
      db
        .select({
          targetContentId: recommendationEvents.targetContentId,
          impressions: sql<number>`SUM(CASE WHEN ${recommendationEvents.eventType} = 'impression' THEN 1 ELSE 0 END)::int`,
          clicks: sql<number>`SUM(CASE WHEN ${recommendationEvents.eventType} = 'click' THEN 1 ELSE 0 END)::int`,
        })
        .from(recommendationEvents)
        .where(inArray(recommendationEvents.targetContentId, ids))
        .groupBy(recommendationEvents.targetContentId),
    ]);

    const tagsMap = new Map<number, string[]>();
    for (const t of tagRows) {
      const list = tagsMap.get(t.contentId) || [];
      list.push(t.tag);
      tagsMap.set(t.contentId, list);
    }

    const embedMap = new Map<number, typeof embedRows[number]>();
    for (const e of embedRows) embedMap.set(e.contentId, e);

    const ctrMap = new Map<number, number>();
    for (const c of ctrRows) {
      const imp = Number(c.impressions || 0);
      const clk = Number(c.clicks || 0);
      if (imp >= 3) {
        ctrMap.set(c.targetContentId, Math.min(1, clk / imp));
      }
    }

    return rows.map((row) =>
      buildIndexedCatalogItem(
        row,
        tagsMap.get(row.id) || [],
        embedMap.get(row.id),
        ctrMap.get(row.id) || 0
      )
    );
  });
}

function scoreCatalogItemWithQuery(
  item: IndexedCatalogItem,
  qNorm: string,
  queryTokens: string[],
  parsedIntent: ReturnType<typeof extractEducationalMeta>,
  queryVec: { model: string; vector: number[]; fallbackVector: number[] },
  personalBoost = 0
): { matched: boolean; score: number; matchedTokens: number; semanticScore: number } {
  const exactPhraseTitle = item.normTitle.includes(qNorm) ? 1 : 0;
  const exactPhraseAll = item.normAll.includes(qNorm) ? 1 : 0;

  let titleMatchSum = 0;
  let metaMatchSum = 0;
  let allMatchSum = 0;
  let matchedTokensCount = 0;

  for (const qt of queryTokens) {
    const sTitle = scoreTokenAgainstPool(qt, item.titleTokens);
    const sMeta = scoreTokenAgainstPool(qt, item.metaTokens);
    const sAll = Math.max(sTitle, sMeta, scoreTokenAgainstPool(qt, item.allTokens));

    titleMatchSum += sTitle;
    metaMatchSum += sMeta;
    allMatchSum += sAll;
    if (sAll >= 0.65) matchedTokensCount += 1;
  }

  const tokenDenom = Math.max(1, queryTokens.length);
  const titleCov = titleMatchSum / tokenDenom;
  const metaCov = metaMatchSum / tokenDenom;
  const allCov = allMatchSum / tokenDenom;

  const useGeminiSpace =
    queryVec.model === 'gemini-embedding-2' &&
    item.embeddingModel === 'gemini-embedding-2' &&
    queryVec.vector.length === item.vectorJson.length;
  const semanticScore = useGeminiSpace
    ? cosineSimilarity(queryVec.vector, item.vectorJson)
    : cosineSimilarity(queryVec.fallbackVector, item.fallbackVectorJson);

  let intentBonus = 0;
  if (
    parsedIntent.classLevel &&
    item.effectiveClassLevel &&
    normalizeEduQuery(item.effectiveClassLevel).includes(normalizeEduQuery(parsedIntent.classLevel))
  ) {
    intentBonus += 0.14;
  }
  if (
    parsedIntent.chapterOrder !== null &&
    item.effectiveChapterOrder !== null &&
    parsedIntent.chapterOrder === item.effectiveChapterOrder
  ) {
    intentBonus += 0.12;
  }
  if (
    parsedIntent.languageHint &&
    item.language.toLowerCase() === parsedIntent.languageHint.toLowerCase()
  ) {
    intentBonus += 0.08;
  }
  if (
    parsedIntent.studyLabelHint &&
    item.effectiveStudyLabel &&
    item.effectiveStudyLabel.toLowerCase() === parsedIntent.studyLabelHint.toLowerCase()
  ) {
    intentBonus += 0.08;
  }

  const quality = computeQualityScore(item);
  const hybridScore =
    exactPhraseTitle * 0.25 +
    exactPhraseAll * 0.08 +
    titleCov * 0.34 +
    metaCov * 0.22 +
    allCov * 0.16 +
    semanticScore * 0.24 +
    intentBonus +
    personalBoost +
    quality * 0.12;

  const minLexicalOrSemantic =
    exactPhraseAll > 0 ||
    matchedTokensCount >= 1 ||
    allCov >= 0.42 ||
    semanticScore >= 0.34;

  return {
    matched: minLexicalOrSemantic && hybridScore >= 0.24,
    score: hybridScore,
    matchedTokens: matchedTokensCount,
    semanticScore,
  };
}

// ===== FUZZY MATCHING (LEVENSHTEIN + CHARACTER TRIGRAM) =====
function damerauLevenshtein(a: string, b: string, maxDist = 2): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (a === b) return 0;

  const dp: number[][] = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i += 1) dp[i][0] = i;
  for (let j = 0; j <= lb; j += 1) dp[0][j] = j;

  for (let i = 1; i <= la; i += 1) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + cost);
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[la][lb];
}

function trigramDice(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
  const getTris = (s: string) => {
    const set = new Set<string>();
    const p = ` ${s} `;
    for (let i = 0; i <= p.length - 3; i += 1) set.add(p.slice(i, i + 3));
    return set;
  };
  const ta = getTris(a);
  const tb = getTris(b);
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  return (2 * overlap) / (ta.size + tb.size);
}

function scoreTokenAgainstPool(queryToken: string, targetTokens: string[]): number {
  if (!queryToken || targetTokens.length === 0) return 0;
  const qStem = stemEduToken(queryToken);
  let best = 0;

  for (const target of targetTokens) {
    if (target === queryToken) return 1;
    const tStem = stemEduToken(target);
    if (tStem === qStem) {
      best = Math.max(best, 0.92);
      continue;
    }
    if (queryToken.length >= 3 && target.startsWith(queryToken)) {
      best = Math.max(best, 0.86);
      continue;
    }
    if (queryToken.length >= 4 && target.length >= 4) {
      const allowed = queryToken.length >= 7 ? 2 : 1;
      const dist = damerauLevenshtein(queryToken, target, allowed);
      if (dist <= allowed) {
        best = Math.max(best, dist === 1 ? 0.8 : 0.68);
        continue;
      }
      const dice = trigramDice(queryToken, target);
      if (dice >= 0.52) {
        best = Math.max(best, dice * 0.78);
      }
    }
  }
  return best;
}

export function serializeCardItem(item: IndexedCatalogItem, extras?: Record<string, unknown>) {
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    authorName: item.authorName,
    publisherName: item.publisherName,
    shortDescription: item.shortDescription,
    coverImageUrl: item.coverImageUrl,
    contentType: item.contentType,
    language: item.language,
    priceInr: item.priceInr,
    isFree: item.isFree,
    isFeatured: item.isFeatured,
    viewsCount: item.viewsCount,
    likesCount: item.likesCount,
    purchasesCount: item.purchasesCount,
    avgRating: item.avgRating,
    reviewsCount: item.reviewsCount,
    readingTimeMins: item.readingTimeMins,
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    categorySlug: item.categorySlug,
    subjectName: item.subjectName,
    subjectSlug: item.subjectSlug,
    creatorId: item.creatorId,
    creatorName: item.creatorName,
    classLevel: item.effectiveClassLevel,
    chapter: item.effectiveChapter,
    topic: item.effectiveTopic,
    chapterOrder: item.effectiveChapterOrder,
    durationSeconds: item.durationSeconds,
    studyLabel: item.effectiveStudyLabel,
    tags: item.tags,
    ...(extras || {}),
  };
}

function passesStructuredFilters(
  item: IndexedCatalogItem,
  filters: {
    category?: string;
    subject?: string;
    contentType?: string;
    language?: string;
    pricing?: string;
    classLevel?: string;
    chapter?: string;
    topic?: string;
    duration?: string;
    teacher?: string;
  }
): boolean {
  if (filters.category && item.categorySlug !== filters.category) return false;
  if (filters.subject && item.subjectSlug !== filters.subject) return false;
  if (filters.contentType) {
    if (filters.contentType === 'PoemsAndStories') {
      if (!['Poems', 'Stories'].includes(item.contentType)) return false;
    } else if (filters.contentType === 'StudyMaterials') {
      if (
        !['Notes', 'PDF / Documents', 'E-books', 'Online Tutorials', 'Research Papers'].includes(
          item.contentType
        )
      ) {
        return false;
      }
    } else if (item.contentType !== filters.contentType) {
      return false;
    }
  }
  if (filters.language && filters.language !== 'all' && item.language !== filters.language) {
    return false;
  }
  if (filters.pricing === 'free' && !item.isFree) return false;
  if (filters.pricing === 'paid' && item.isFree) return false;

  if (filters.classLevel && filters.classLevel !== 'all') {
    const itemCls = normalizeEduQuery(item.effectiveClassLevel || '');
    const reqCls = normalizeEduQuery(filters.classLevel);
    if (!itemCls.includes(reqCls)) return false;
  }
  if (filters.chapter) {
    const chNorm = normalizeEduQuery(filters.chapter);
    if (!item.normChapter.includes(chNorm) && !item.normTitle.includes(chNorm)) return false;
  }
  if (filters.topic) {
    const tpNorm = normalizeEduQuery(filters.topic);
    if (!item.normTopic.includes(tpNorm) && !item.normTitle.includes(tpNorm) && !item.normTags.includes(tpNorm)) {
      return false;
    }
  }
  if (filters.teacher) {
    const trNorm = normalizeEduQuery(filters.teacher);
    if (!item.normCreator.includes(trNorm) && String(item.creatorId) !== filters.teacher) return false;
  }
  if (filters.duration && filters.duration !== 'all') {
    const mins = item.durationSeconds ? Math.round(item.durationSeconds / 60) : item.readingTimeMins;
    if (filters.duration === 'short' && mins > 10) return false;
    if (filters.duration === 'medium' && (mins <= 10 || mins > 30)) return false;
    if (filters.duration === 'long' && mins <= 30) return false;
  }
  return true;
}

function computeQualityScore(item: IndexedCatalogItem): number {
  const rating = Number(item.avgRating || 0);
  const reviews = Number(item.reviewsCount || 0);
  const ratingScore = rating > 0 ? (rating / 5) * Math.min(1, (reviews + 2) / 10) : 0.35;
  const popScore = Math.min(1, Math.log10(item.viewsCount + item.likesCount * 3 + 1) / 4);
  const completeness =
    (item.shortDescription.length > 60 ? 0.35 : 0.15) +
    (item.coverImageUrl ? 0.25 : 0) +
    (item.tags.length > 0 ? 0.2 : 0) +
    (item.effectiveClassLevel || item.effectiveChapter || item.effectiveTopic ? 0.2 : 0);

  const ageDays = Math.max(
    0,
    (Date.now() - new Date(item.publishedAt || item.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const freshness = Math.max(0.2, 1 - Math.min(1, ageDays / 365) * 0.6);

  return 0.32 * ratingScore + 0.24 * popScore + 0.26 * completeness + 0.1 * freshness + 0.08 * item.ctrScore;
}

export async function getUserPersonalizationSignals(userId?: number): Promise<{
  personalizationEnabled: boolean;
  preferredLanguage: string | null;
  recentQueries: string[];
  interestTokens: Set<string>;
  watchedContentIds: Set<number>;
  completedContentIds: Set<number>;
}> {
  if (!userId) {
    return {
      personalizationEnabled: false,
      preferredLanguage: null,
      recentQueries: [],
      interestTokens: new Set(),
      watchedContentIds: new Set(),
      completedContentIds: new Set(),
    };
  }

  const [profileRow, historyRows, progressRows] = await Promise.all([
    db
      .select({
        personalizationEnabled: userProfiles.personalizationEnabled,
        languagePreference: userProfiles.languagePreference,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
    db
      .select({ query: userSearchHistory.query, normalizedQuery: userSearchHistory.normalizedQuery })
      .from(userSearchHistory)
      .where(eq(userSearchHistory.userId, userId))
      .orderBy(desc(userSearchHistory.createdAt))
      .limit(12),
    db
      .select({
        contentId: videoWatchProgress.contentId,
        completed: videoWatchProgress.completed,
      })
      .from(videoWatchProgress)
      .where(eq(videoWatchProgress.userId, userId))
      .orderBy(desc(videoWatchProgress.updatedAt))
      .limit(25),
  ]);

  const enabled = profileRow[0]?.personalizationEnabled !== false;
  const interestTokens = new Set<string>();
  const recentQueries: string[] = [];

  if (enabled) {
    const seenQ = new Set<string>();
    for (const h of historyRows) {
      if (!seenQ.has(h.query.toLowerCase())) {
        seenQ.add(h.query.toLowerCase());
        recentQueries.push(h.query);
      }
      for (const tok of tokenizeEdu(h.normalizedQuery, true)) {
        interestTokens.add(stemEduToken(tok));
      }
    }
  }

  return {
    personalizationEnabled: enabled,
    preferredLanguage: profileRow[0]?.languagePreference || null,
    recentQueries: recentQueries.slice(0, 6),
    interestTokens,
    watchedContentIds: new Set(progressRows.map((p) => p.contentId)),
    completedContentIds: new Set(progressRows.filter((p) => p.completed).map((p) => p.contentId)),
  };
}

export interface SearchParams {
  q?: string;
  category?: string;
  subject?: string;
  contentType?: string;
  language?: string;
  pricing?: string;
  classLevel?: string;
  chapter?: string;
  topic?: string;
  duration?: string;
  teacher?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export async function runSmartSearch(params: SearchParams, userId?: number) {
  const catalog = await getIndexedCatalog();
  const qRaw = String(params.q || '').trim().slice(0, 160);
  const qNorm = normalizeEduQuery(qRaw);
  const parsedIntent = extractEducationalMeta(qRaw);
  const queryTokens = parsedIntent.meaningfulTokens.length
    ? parsedIntent.meaningfulTokens
    : parsedIntent.tokens;

  const userSignals = await getUserPersonalizationSignals(userId);

  // Build available facets across the whole active catalog (never fake options)
  const facetClasses = new Set<string>();
  const facetChapters = new Set<string>();
  const facetTopics = new Set<string>();
  const facetTeachers = new Map<number, string>();
  for (const item of catalog) {
    if (item.effectiveClassLevel) facetClasses.add(item.effectiveClassLevel);
    if (item.effectiveChapter) facetChapters.add(item.effectiveChapter);
    if (item.effectiveTopic) facetTopics.add(item.effectiveTopic);
    facetTeachers.set(item.creatorId, item.creatorName);
  }

  const filteredCatalog = catalog.filter((item) => passesStructuredFilters(item, params));

  let scoredResults: Array<{
    item: IndexedCatalogItem;
    score: number;
    matchedTokens: number;
    semanticScore: number;
  }> = [];

  if (qNorm.length > 0) {
    const queryVec = await getQueryEmbedding(qRaw);

    for (const item of filteredCatalog) {
      let personalBoost = 0;
      if (userSignals.personalizationEnabled && userSignals.interestTokens.size > 0) {
        let overlap = 0;
        for (const st of item.stemmedTokenSet) {
          if (userSignals.interestTokens.has(st)) overlap += 1;
        }
        personalBoost = Math.min(0.06, overlap * 0.015);
      }

      const scored = scoreCatalogItemWithQuery(
        item,
        qNorm,
        queryTokens,
        parsedIntent,
        queryVec,
        personalBoost
      );
      if (scored.matched) {
        scoredResults.push({
          item,
          score: scored.score,
          matchedTokens: scored.matchedTokens,
          semanticScore: scored.semanticScore,
        });
      }
    }
  } else {
    scoredResults = filteredCatalog.map((item) => ({
      item,
      score: computeQualityScore(item),
      matchedTokens: 0,
      semanticScore: 0,
    }));
  }

  const effectiveSort = params.sort || (qNorm ? 'relevant' : 'latest');
  scoredResults.sort((a, b) => {
    switch (effectiveSort) {
      case 'popular':
        return b.item.viewsCount - a.item.viewsCount || b.score - a.score;
      case 'highest_rated':
        return Number(b.item.avgRating) - Number(a.item.avgRating) || b.score - a.score;
      case 'price_asc':
        return Number(a.item.priceInr) - Number(b.item.priceInr) || b.score - a.score;
      case 'price_desc':
        return Number(b.item.priceInr) - Number(a.item.priceInr) || b.score - a.score;
      case 'latest': {
        const ta = new Date(a.item.publishedAt || a.item.createdAt).getTime();
        const tb = new Date(b.item.publishedAt || b.item.createdAt).getTime();
        return tb - ta || b.score - a.score;
      }
      case 'relevant':
      default:
        return b.score - a.score || b.item.viewsCount - a.item.viewsCount;
    }
  });

  const total = scoredResults.length;
  const limit = Math.min(30, Math.max(1, Number(params.limit || 12)));
  const offset = Math.max(0, Number(params.offset || 0));
  const paged = scoredResults.slice(offset, offset + limit).map((r) =>
    serializeCardItem(r.item, {
      relevanceScore: Number(r.score.toFixed(3)),
    })
  );

  // Build smart fallback ONLY when exact/filtered matches are sparse/empty
  let relatedRecommendations: Array<ReturnType<typeof serializeCardItem>> = [];
  let alternativeQueries: string[] = [];

  if (total === 0 && catalog.length > 0) {
    // 1. Typo correction & broader alternative queries built strictly from real catalog vocabulary
    const vocab = new Set<string>();
    for (const item of catalog) {
      for (const tok of [...item.titleTokens, ...item.metaTokens]) {
        if (tok.length >= 3) vocab.add(tok);
      }
    }
    const vocabArr = Array.from(vocab);

    if (queryTokens.length > 0) {
      const correctedTokens = queryTokens.map((qt) => {
        if (vocab.has(qt)) return qt;
        let bestWord = qt;
        let bestDist = 3;
        for (const vw of vocabArr) {
          const d = damerauLevenshtein(qt, vw, 2);
          if (d < bestDist) {
            bestDist = d;
            bestWord = vw;
          }
        }
        return bestWord;
      });
      const correctedStr = correctedTokens.join(' ');
      if (correctedStr && correctedStr !== qNorm) {
        alternativeQueries.push(correctedStr);
      }
    }

    for (const sub of parsedIntent.subjectHints) {
      alternativeQueries.push(sub);
    }
    if (alternativeQueries.length < 3) {
      for (const item of [...catalog].sort((a, b) => b.viewsCount - a.viewsCount).slice(0, 6)) {
        const cand =
          item.subjectName && item.subjectName.toLowerCase() !== 'other'
            ? item.subjectName
            : item.categoryName && item.categoryName.toLowerCase() !== 'other'
            ? item.categoryName
            : item.title;
        if (cand) alternativeQueries.push(cand);
      }
    }
    alternativeQueries = Array.from(new Set(alternativeQueries))
      .filter((q) => q && q.toLowerCase() !== 'other')
      .slice(0, 4);

    // 2. Closest semantic/popular real resources in ScholarPress catalog
    const fallbackVec = computeLocalSemanticVector(qNorm || params.category || '');
    const rankedFallback = catalog
      .map((item) => ({
        item,
        sim: cosineSimilarity(fallbackVec, item.fallbackVectorJson) * 0.7 + computeQualityScore(item) * 0.3,
      }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 4)
      .map((x) => serializeCardItem(x.item));
    relatedRecommendations = rankedFallback;
  }

  return {
    items: paged,
    total,
    exactMatchCount: total,
    limit,
    offset,
    hasMore: offset + paged.length < total,
    sortApplied: effectiveSort,
    parsedIntent: {
      normalizedQuery: qNorm,
      classLevel: parsedIntent.classLevel,
      chapterOrder: parsedIntent.chapterOrder,
      languageHint: parsedIntent.languageHint,
      studyLabelHint: parsedIntent.studyLabelHint,
      subjectHints: parsedIntent.subjectHints,
    },
    relatedRecommendations,
    alternativeQueries,
    facets: {
      classLevels: Array.from(facetClasses).sort(),
      chapters: Array.from(facetChapters).sort(),
      topics: Array.from(facetTopics).sort(),
      teachers: Array.from(facetTeachers.entries()).map(([id, name]) => ({ id, name })),
    },
  };
}

/**
 * Fast, categorized autocomplete suggestions (ZERO Gemini/LLM API calls per keystroke).
 */
export async function getSmartSuggestions(rawQ: string, userId?: number) {
  const catalog = await getIndexedCatalog();
  const qNorm = normalizeEduQuery(rawQ);
  const tokens = tokenizeEdu(qNorm, true);

  const [userSignals, popularHistoryRows, catRows, subjRows] = await Promise.all([
    getUserPersonalizationSignals(userId),
    db
      .select({
        query: userSearchHistory.query,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(userSearchHistory)
      .groupBy(userSearchHistory.query)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(8),
    db.select().from(categories),
    db.select().from(subjects),
  ]);

  const recentSearches = userSignals.personalizationEnabled
    ? userSignals.recentQueries.filter((rq) =>
        !qNorm ? true : normalizeEduQuery(rq).includes(qNorm)
      ).slice(0, 4)
    : [];

  // Matching Videos & Learning Resources
  const matchingVideos = (
    qNorm.length > 0
      ? catalog
          .map((item) => {
            const exact = item.normTitle.includes(qNorm) ? 1.5 : item.normAll.includes(qNorm) ? 1.1 : 0;
            const tokCov =
              tokens.length > 0
                ? tokens.reduce((acc, t) => acc + scoreTokenAgainstPool(t, item.allTokens), 0) / tokens.length
                : 0;
            const videoBoost = /video|lecture|tutorial/i.test(item.contentType) ? 0.15 : 0;
            const score = exact + tokCov + videoBoost + computeQualityScore(item) * 0.2;
            return { item, score, matched: exact > 0 || tokCov >= 0.45 };
          })
          .filter((x) => x.matched)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((x) => ({
            id: x.item.id,
            title: x.item.title,
            slug: x.item.slug,
            contentType: x.item.contentType,
            creatorName: x.item.creatorName,
            categoryName: x.item.categoryName,
            subjectName: x.item.subjectName,
            classLevel: x.item.effectiveClassLevel,
            coverImageUrl: x.item.coverImageUrl,
            isFree: x.item.isFree,
            priceInr: x.item.priceInr,
          }))
      : []
  );

  // Matching Subjects & Categories
  const matchingSubjects: Array<{ name: string; slug: string; categorySlug?: string; kind: 'subject' | 'category' }> = [];
  if (qNorm.length > 0) {
    const catSlugById = new Map(catRows.map((c) => [c.id, c.slug]));
    for (const s of subjRows) {
      const sn = normalizeEduQuery(s.name);
      const hit = sn.includes(qNorm) || tokens.some((t) => scoreTokenAgainstPool(t, sn.split(' ')) >= 0.72);
      if (hit) {
        matchingSubjects.push({
          name: s.name,
          slug: s.slug,
          categorySlug: catSlugById.get(s.categoryId),
          kind: 'subject',
        });
      }
      if (matchingSubjects.length >= 4) break;
    }
    if (matchingSubjects.length < 4) {
      for (const c of catRows) {
        const cn = normalizeEduQuery(c.name);
        const hit = cn.includes(qNorm) || tokens.some((t) => scoreTokenAgainstPool(t, cn.split(' ')) >= 0.72);
        if (hit) {
          matchingSubjects.push({ name: c.name, slug: c.slug, kind: 'category' });
        }
        if (matchingSubjects.length >= 4) break;
      }
    }
  }

  // Matching Chapters and Topics
  const chaptersAndTopics: Array<{ label: string; query: string }> = [];
  const seenChTp = new Set<string>();
  if (qNorm.length > 0) {
    for (const item of catalog) {
      const candidates = [item.effectiveChapter, item.effectiveTopic, ...item.tags].filter(Boolean) as string[];
      for (const cand of candidates) {
        const cn = normalizeEduQuery(cand);
        if (seenChTp.has(cn)) continue;
        const hit = cn.includes(qNorm) || tokens.some((t) => scoreTokenAgainstPool(t, cn.split(' ')) >= 0.72);
        if (hit) {
          seenChTp.add(cn);
          chaptersAndTopics.push({ label: cand, query: cand });
          if (chaptersAndTopics.length >= 4) break;
        }
      }
      if (chaptersAndTopics.length >= 4) break;
    }
  }

  // Suggested Searches (from real catalog titles / normalized query suggestions)
  const suggestedSearches: string[] = [];
  const seenSugg = new Set<string>(recentSearches.map((r) => r.toLowerCase()));
  if (qNorm.length > 0) {
    for (const mv of matchingVideos) {
      if (!seenSugg.has(mv.title.toLowerCase())) {
        seenSugg.add(mv.title.toLowerCase());
        suggestedSearches.push(mv.title);
      }
    }
    for (const ct of chaptersAndTopics) {
      if (!seenSugg.has(ct.query.toLowerCase()) && suggestedSearches.length < 5) {
        seenSugg.add(ct.query.toLowerCase());
        suggestedSearches.push(ct.query);
      }
    }
  }

  // Popular Searches (when query empty or sparse, derived strictly from real history + popular catalog items)
  const popularSearches: string[] = [];
  const seenPop = new Set<string>(seenSugg);
  for (const h of popularHistoryRows) {
    const clean = h.query.trim();
    if (clean && !seenPop.has(clean.toLowerCase())) {
      seenPop.add(clean.toLowerCase());
      popularSearches.push(clean);
    }
    if (popularSearches.length >= 4) break;
  }
  if (popularSearches.length < 4) {
    const topItems = [...catalog].sort((a, b) => b.viewsCount - a.viewsCount);
    for (const item of topItems) {
      const label =
        item.subjectName && item.subjectName.toLowerCase() !== 'other'
          ? item.subjectName
          : item.title;
      if (label && !seenPop.has(label.toLowerCase())) {
        seenPop.add(label.toLowerCase());
        popularSearches.push(label);
      }
      if (popularSearches.length >= 4) break;
    }
  }

  return {
    query: rawQ,
    recentSearches,
    suggestedSearches: suggestedSearches.slice(0, 4),
    matchingVideos,
    subjects: matchingSubjects,
    chaptersAndTopics,
    popularSearches: qNorm.length === 0 ? popularSearches : [],
  };
}

/**
 * Categorized Video & Educational Recommendations Engine.
 * Produces non-empty sections strictly from real PostgreSQL catalog & progress records.
 */
export async function getVideoRecommendations(sourceContentId: number, userId?: number) {
  const catalog = await getIndexedCatalog();
  const source = catalog.find((c) => c.id === sourceContentId);
  if (!source) {
    return {
      sourceId: sourceContentId,
      continueLearning: [],
      moreOnChapter: [],
      nextLearningStep: [],
      otherTeachers: [],
      relatedVideos: [],
      recommendedForYou: [],
    };
  }

  const userSignals = await getUserPersonalizationSignals(userId);
  const candidates = catalog.filter((item) => item.id !== sourceContentId);

  const scoreAgainstSource = (cand: IndexedCatalogItem) => {
    const sem =
      source.embeddingModel === 'gemini-embedding-2' &&
      cand.embeddingModel === 'gemini-embedding-2' &&
      source.vectorJson.length === cand.vectorJson.length
        ? cosineSimilarity(source.vectorJson, cand.vectorJson)
        : cosineSimilarity(source.fallbackVectorJson, cand.fallbackVectorJson);

    const sameSubject = source.subjectId && cand.subjectId === source.subjectId ? 0.25 : 0;
    const sameCategory = source.categoryId && cand.categoryId === source.categoryId ? 0.16 : 0;
    const sameClass =
      source.effectiveClassLevel &&
      cand.effectiveClassLevel &&
      normalizeEduQuery(source.effectiveClassLevel) === normalizeEduQuery(cand.effectiveClassLevel)
        ? 0.2
        : 0;
    const sameChapter =
      source.effectiveChapter &&
      cand.effectiveChapter &&
      normalizeEduQuery(source.effectiveChapter) === normalizeEduQuery(cand.effectiveChapter)
        ? 0.24
        : 0;
    const sameTopic =
      source.effectiveTopic &&
      cand.effectiveTopic &&
      normalizeEduQuery(source.effectiveTopic) === normalizeEduQuery(cand.effectiveTopic)
        ? 0.2
        : 0;
    const tagOverlap =
      source.tags.length > 0 && cand.tags.length > 0
        ? (source.tags.filter((t) => cand.tags.includes(t)).length /
            Math.max(1, source.tags.length)) *
          0.18
        : 0;
    const langBonus = source.language === cand.language ? 0.06 : 0;
    const quality = computeQualityScore(cand) * 0.14;

    return {
      cand,
      sem,
      sameSubject: sameSubject > 0,
      sameCategory: sameCategory > 0,
      sameClass: sameClass > 0,
      sameChapter: sameChapter > 0,
      sameTopic: sameTopic > 0,
      score: sem * 0.35 + sameSubject + sameCategory + sameClass + sameChapter + sameTopic + tagOverlap + langBonus + quality,
    };
  };

  const scored = candidates.map(scoreAgainstSource).sort((a, b) => b.score - a.score);
  const usedIds = new Set<number>();

  // 1. Continue Learning (for logged-in user with unfinished videos)
  const continueLearning = userId ? await getContinueWatching(userId, 4, sourceContentId) : [];
  for (const cw of continueLearning) usedIds.add(cw.id);

  // 2. More on This Chapter
  const moreOnChapter = scored
    .filter((s) => !usedIds.has(s.cand.id) && (s.sameChapter || (s.sameTopic && s.sameSubject)))
    .slice(0, 4)
    .map((s) => {
      usedIds.add(s.cand.id);
      return serializeCardItem(s.cand, { recSection: 'moreOnChapter' });
    });

  // 3. Next Learning Step (next sequential chapterOrder or next difficulty progression)
  const nextLearningStep = scored
    .filter((s) => {
      if (usedIds.has(s.cand.id)) return false;
      if (
        source.effectiveChapterOrder !== null &&
        s.cand.effectiveChapterOrder !== null &&
        s.cand.effectiveChapterOrder === source.effectiveChapterOrder + 1 &&
        (s.sameSubject || s.sameCategory || s.sameClass)
      ) {
        return true;
      }
      if (
        (s.sameSubject || s.sameClass) &&
        s.cand.effectiveStudyLabel &&
        ['Exercise Solution', 'Practice', 'Revision', 'Previous Year Questions'].includes(
          s.cand.effectiveStudyLabel
        ) &&
        s.cand.effectiveStudyLabel !== source.effectiveStudyLabel
      ) {
        return true;
      }
      return false;
    })
    .slice(0, 4)
    .map((s) => {
      usedIds.add(s.cand.id);
      return serializeCardItem(s.cand, { recSection: 'nextLearningStep' });
    });

  // 4. Other Teachers Explaining This Topic
  const otherTeachers = scored
    .filter(
      (s) =>
        !usedIds.has(s.cand.id) &&
        s.cand.creatorId !== source.creatorId &&
        (s.sameSubject || s.sameTopic || s.sameCategory) &&
        s.score >= 0.25
    )
    .slice(0, 4)
    .map((s) => {
      usedIds.add(s.cand.id);
      return serializeCardItem(s.cand, { recSection: 'otherTeachers' });
    });

  // 5. Related Videos / Resources (broad high-similarity catalog items)
  const relatedVideos = scored
    .filter((s) => !usedIds.has(s.cand.id))
    .slice(0, 4)
    .map((s) => {
      usedIds.add(s.cand.id);
      return serializeCardItem(s.cand, { recSection: 'relatedVideos' });
    });

  // 6. Recommended for You (personalized when logged-in & enabled)
  let recommendedForYou: Array<ReturnType<typeof serializeCardItem>> = [];
  if (userId && userSignals.personalizationEnabled) {
    recommendedForYou = candidates
      .filter((c) => !usedIds.has(c.id) && !userSignals.completedContentIds.has(c.id))
      .map((c) => {
        let pScore = computeQualityScore(c);
        if (userSignals.preferredLanguage && c.language === userSignals.preferredLanguage) pScore += 0.15;
        let overlap = 0;
        for (const st of c.stemmedTokenSet) {
          if (userSignals.interestTokens.has(st)) overlap += 1;
        }
        pScore += Math.min(0.45, overlap * 0.1);
        return { c, pScore };
      })
      .sort((a, b) => b.pScore - a.pScore)
      .slice(0, 4)
      .map((x) => serializeCardItem(x.c, { recSection: 'recommendedForYou' }));
  }

  return {
    sourceId: sourceContentId,
    continueLearning,
    moreOnChapter,
    nextLearningStep,
    otherTeachers,
    relatedVideos,
    recommendedForYou,
  };
}

export async function getContinueWatching(userId: number, limit = 6, excludeContentId?: number) {
  const rows = await db
    .select({
      progress: videoWatchProgress,
      content: contents,
      categoryName: categories.name,
      categorySlug: categories.slug,
      subjectName: subjects.name,
      creatorName: sql<string>`COALESCE(NULLIF(TRIM(${contents.authorName}), ''), ${users.name})`,
    })
    .from(videoWatchProgress)
    .innerJoin(contents, eq(videoWatchProgress.contentId, contents.id))
    .innerJoin(users, eq(contents.creatorId, users.id))
    .leftJoin(categories, eq(contents.categoryId, categories.id))
    .leftJoin(subjects, eq(contents.subjectId, subjects.id))
    .where(
      and(
        eq(videoWatchProgress.userId, userId),
        eq(videoWatchProgress.completed, false),
        eq(contents.status, 'approved'),
        isNull(contents.deletedAt),
        sql`${videoWatchProgress.progressPercent} > 0`,
        excludeContentId ? sql`${contents.id} != ${excludeContentId}` : sql`true`
      )
    )
    .orderBy(desc(videoWatchProgress.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.content.id,
    title: r.content.title,
    slug: r.content.slug,
    authorName: r.content.authorName,
    shortDescription: r.content.shortDescription,
    coverImageUrl: r.content.coverImageUrl,
    contentType: r.content.contentType,
    language: r.content.language,
    priceInr: r.content.priceInr,
    isFree: r.content.isFree,
    avgRating: r.content.avgRating,
    reviewsCount: r.content.reviewsCount,
    viewsCount: r.content.viewsCount,
    readingTimeMins: r.content.readingTimeMins,
    categoryName: r.categoryName,
    categorySlug: r.categorySlug,
    subjectName: r.subjectName,
    creatorId: r.content.creatorId,
    creatorName: r.creatorName,
    classLevel: r.content.classLevel,
    chapter: r.content.chapter,
    topic: r.content.topic,
    durationSeconds: r.content.durationSeconds || r.progress.durationSeconds || null,
    studyLabel: r.content.studyLabel,
    watchProgress: {
      watchedSeconds: r.progress.watchedSeconds,
      durationSeconds: r.progress.durationSeconds,
      lastPositionSeconds: r.progress.lastPositionSeconds,
      progressPercent: r.progress.progressPercent,
      completed: r.progress.completed,
      updatedAt: r.progress.updatedAt,
    },
  }));
}

export async function getHomePersonalizedRecommendations(userId?: number, limit = 4) {
  const catalog = await getIndexedCatalog();
  if (catalog.length === 0) return { personalized: false, items: [] };

  const signals = await getUserPersonalizationSignals(userId);
  if (!userId || !signals.personalizationEnabled) {
    // Non-personalized top quality resources fallback for homepage/logged-out API callers
    const items = [...catalog]
      .sort((a, b) => computeQualityScore(b) - computeQualityScore(a))
      .slice(0, limit)
      .map((c) => serializeCardItem(c));
    return { personalized: false, items };
  }

  const scored = catalog
    .filter((c) => !signals.completedContentIds.has(c.id))
    .map((c) => {
      let score = computeQualityScore(c);
      if (signals.preferredLanguage && c.language === signals.preferredLanguage) score += 0.16;
      let overlap = 0;
      for (const st of c.stemmedTokenSet) {
        if (signals.interestTokens.has(st)) overlap += 1;
      }
      score += Math.min(0.45, overlap * 0.1);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => serializeCardItem(x.c));

  return { personalized: true, items: scored };
}

export async function logSearchHistoryEntry(params: {
  userId?: number;
  query: string;
  filters?: Record<string, string>;
  resultsCount: number;
}): Promise<number | null> {
  if (!params.userId) return null;
  const clean = params.query.trim().slice(0, 160);
  if (clean.length < 2) return null;

  try {
    const [profile] = await db
      .select({ personalizationEnabled: userProfiles.personalizationEnabled })
      .from(userProfiles)
      .where(eq(userProfiles.userId, params.userId))
      .limit(1);

    if (profile && profile.personalizationEnabled === false) {
      return null;
    }

    const norm = normalizeEduQuery(clean);
    const [inserted] = await db
      .insert(userSearchHistory)
      .values({
        userId: params.userId,
        query: clean,
        normalizedQuery: norm,
        filtersJson: params.filters || {},
        resultsCount: params.resultsCount,
      })
      .returning({ id: userSearchHistory.id });

    return inserted?.id || null;
  } catch {
    return null;
  }
}

export type DraftTypeGroup = 'all' | 'articles' | 'videos' | 'pdfs';

export function classifyDraftTypeGroup(contentType: string): 'articles' | 'videos' | 'pdfs' {
  if (contentType === 'Video Lectures' || contentType === 'Online Tutorials') {
    return 'videos';
  }
  if (contentType === 'PDF / Documents' || contentType === 'E-books') {
    return 'pdfs';
  }
  return 'articles';
}

export interface CreatorDraftSearchParams {
  creatorId: number;
  q?: string;
  typeGroup?: DraftTypeGroup;
  subjectId?: number | null;
  categoryId?: number | null;
  sort?: 'newest' | 'oldest' | 'relevant';
  page?: number;
  limit?: number;
}

/**
 * Creator-isolated AI Smart Search for Draft Content.
 * Reuses the exact same educational normalizer, typo fuzzy matcher, Hinglish expansion,
 * and semantic embedding scorer as Home Search, strictly scoped to `status = 'draft'` owned by `creatorId`.
 */
export async function runCreatorDraftSmartSearch(params: CreatorDraftSearchParams) {
  const { creatorId } = params;
  const rows = await db
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
      updatedAt: contents.updatedAt,
      categoryId: contents.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
      subjectId: contents.subjectId,
      subjectName: subjects.name,
      subjectSlug: subjects.slug,
      creatorId: users.id,
      creatorName: sql<string>`COALESCE(NULLIF(TRIM(${contents.authorName}), ''), ${users.name})`,
      creatorAvatar: users.avatarUrl,
      classLevel: contents.classLevel,
      chapter: contents.chapter,
      topic: contents.topic,
      chapterOrder: contents.chapterOrder,
      durationSeconds: contents.durationSeconds,
      studyLabel: contents.studyLabel,
    })
    .from(contents)
    .innerJoin(users, eq(contents.creatorId, users.id))
    .leftJoin(categories, eq(contents.categoryId, categories.id))
    .leftJoin(subjects, eq(contents.subjectId, subjects.id))
    .where(
      and(
        eq(contents.creatorId, creatorId),
        eq(contents.status, 'draft'),
        isNull(contents.deletedAt)
      )
    );

  const counts = {
    all: rows.length,
    articles: 0,
    videos: 0,
    pdfs: 0,
  };
  const catMap = new Map<number, string>();
  const subjMap = new Map<number, string>();
  const updatedAtMap = new Map<number, Date>();

  for (const r of rows) {
    const grp = classifyDraftTypeGroup(r.contentType);
    counts[grp] += 1;
    if (r.categoryId && r.categoryName) catMap.set(r.categoryId, r.categoryName);
    if (r.subjectId && r.subjectName) subjMap.set(r.subjectId, r.subjectName);
    updatedAtMap.set(r.id, r.updatedAt);
  }

  let indexedDrafts: IndexedCatalogItem[] = [];
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const [tagRows, embedRows] = await Promise.all([
      db.select().from(contentTags).where(inArray(contentTags.contentId, ids)),
      db.select().from(contentEmbeddings).where(inArray(contentEmbeddings.contentId, ids)),
    ]);

    const tagsMap = new Map<number, string[]>();
    for (const t of tagRows) {
      const list = tagsMap.get(t.contentId) || [];
      list.push(t.tag);
      tagsMap.set(t.contentId, list);
    }
    const embedMap = new Map<number, typeof embedRows[number]>();
    for (const e of embedRows) embedMap.set(e.contentId, e);

    indexedDrafts = rows.map((row) =>
      buildIndexedCatalogItem(row, tagsMap.get(row.id) || [], embedMap.get(row.id), 0)
    );
  }

  const typeGroup = params.typeGroup && ['all', 'articles', 'videos', 'pdfs'].includes(params.typeGroup)
    ? params.typeGroup
    : 'all';

  const filtered = indexedDrafts.filter((item) => {
    if (typeGroup !== 'all' && classifyDraftTypeGroup(item.contentType) !== typeGroup) {
      return false;
    }
    if (params.categoryId && item.categoryId !== params.categoryId) {
      return false;
    }
    if (params.subjectId && item.subjectId !== params.subjectId) {
      return false;
    }
    return true;
  });

  const qRaw = String(params.q || '').trim().slice(0, 160);
  const qNorm = normalizeEduQuery(qRaw);
  const parsedIntent = extractEducationalMeta(qRaw);
  const queryTokens = parsedIntent.meaningfulTokens.length
    ? parsedIntent.meaningfulTokens
    : parsedIntent.tokens;

  let scored: Array<{ item: IndexedCatalogItem; score: number }> = [];
  let aiSearchUsed = false;

  if (qNorm.length > 0) {
    aiSearchUsed = true;
    const queryVec = await getQueryEmbedding(qRaw);
    for (const item of filtered) {
      const res = scoreCatalogItemWithQuery(item, qNorm, queryTokens, parsedIntent, queryVec, 0);
      if (res.matched) {
        scored.push({ item, score: res.score });
      }
    }
  } else {
    scored = filtered.map((item) => ({ item, score: 0 }));
  }

  const sortMode = params.sort || (qNorm.length > 0 ? 'relevant' : 'newest');
  scored.sort((a, b) => {
    const ca = new Date(a.item.createdAt).getTime();
    const cb = new Date(b.item.createdAt).getTime();
    const ua = new Date(updatedAtMap.get(a.item.id) || a.item.createdAt).getTime();
    const ub = new Date(updatedAtMap.get(b.item.id) || b.item.createdAt).getTime();
    if (sortMode === 'oldest') {
      return ca - cb || a.item.id - b.item.id;
    }
    if (sortMode === 'relevant' && qNorm.length > 0) {
      return b.score - a.score || ub - ua || b.item.id - a.item.id;
    }
    // newest first
    return cb - ca || ub - ua || b.item.id - a.item.id;
  });

  const limit = Math.min(30, Math.max(1, Number(params.limit || 9)));
  const total = scored.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(totalPages, Math.max(1, Number(params.page || 1)));
  const offset = (page - 1) * limit;

  const items = scored.slice(offset, offset + limit).map(({ item, score }) => ({
    ...serializeCardItem(item, qNorm.length > 0 ? { relevanceScore: Number(score.toFixed(3)) } : undefined),
    status: 'draft',
    typeGroup: classifyDraftTypeGroup(item.contentType),
    updatedAt: updatedAtMap.get(item.id) || item.createdAt,
  }));

  return {
    items,
    counts,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
    filtersMeta: {
      categories: Array.from(catMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      subjects: Array.from(subjMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    searchMeta: {
      query: qRaw,
      aiSearchUsed,
      sortApplied: sortMode,
    },
  };
}

export type PendingStatusFilter = 'all' | 'under_review' | 'changes_requested';

export interface CreatorPendingSearchParams {
  creatorId: number;
  q?: string;
  statusFilter?: PendingStatusFilter;
  contentType?: string;
  subjectId?: number | null;
  categoryId?: number | null;
  pricing?: 'all' | 'free' | 'paid';
  sort?: 'latest' | 'oldest' | 'relevant';
  page?: number;
  limit?: number;
}

/**
 * Creator-isolated AI Smart Search for Pending & Review submissions.
 * Scoped strictly to status IN ('pending', 'changes_requested') owned by creatorId.
 */
export async function runCreatorPendingSmartSearch(params: CreatorPendingSearchParams) {
  const { creatorId } = params;
  const rows = await db
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
      updatedAt: contents.updatedAt,
      status: contents.status,
      rejectionReason: contents.rejectionReason,
      categoryId: contents.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
      subjectId: contents.subjectId,
      subjectName: subjects.name,
      subjectSlug: subjects.slug,
      creatorId: users.id,
      creatorName: sql<string>`COALESCE(NULLIF(TRIM(${contents.authorName}), ''), ${users.name})`,
      creatorAvatar: users.avatarUrl,
      classLevel: contents.classLevel,
      chapter: contents.chapter,
      topic: contents.topic,
      chapterOrder: contents.chapterOrder,
      durationSeconds: contents.durationSeconds,
      studyLabel: contents.studyLabel,
    })
    .from(contents)
    .innerJoin(users, eq(contents.creatorId, users.id))
    .leftJoin(categories, eq(contents.categoryId, categories.id))
    .leftJoin(subjects, eq(contents.subjectId, subjects.id))
    .where(
      and(
        eq(contents.creatorId, creatorId),
        inArray(contents.status, ['pending', 'changes_requested']),
        isNull(contents.deletedAt)
      )
    );

  const counts = {
    all: rows.length,
    underReview: 0,
    changesRequested: 0,
  };
  const catMap = new Map<number, string>();
  const subjMap = new Map<number, string>();
  const typeSet = new Set<string>();
  const rowMetaMap = new Map<
    number,
    { status: string; rejectionReason: string | null; updatedAt: Date }
  >();

  for (const r of rows) {
    if (r.status === 'changes_requested') counts.changesRequested += 1;
    else counts.underReview += 1;
    if (r.categoryId && r.categoryName) catMap.set(r.categoryId, r.categoryName);
    if (r.subjectId && r.subjectName) subjMap.set(r.subjectId, r.subjectName);
    if (r.contentType) typeSet.add(r.contentType);
    rowMetaMap.set(r.id, {
      status: r.status,
      rejectionReason: r.rejectionReason,
      updatedAt: r.updatedAt,
    });
  }

  let indexedItems: IndexedCatalogItem[] = [];
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const [tagRows, embedRows] = await Promise.all([
      db.select().from(contentTags).where(inArray(contentTags.contentId, ids)),
      db.select().from(contentEmbeddings).where(inArray(contentEmbeddings.contentId, ids)),
    ]);

    const tagsMap = new Map<number, string[]>();
    for (const t of tagRows) {
      const list = tagsMap.get(t.contentId) || [];
      list.push(t.tag);
      tagsMap.set(t.contentId, list);
    }
    const embedMap = new Map<number, typeof embedRows[number]>();
    for (const e of embedRows) embedMap.set(e.contentId, e);

    indexedItems = rows.map((row) =>
      buildIndexedCatalogItem(row, tagsMap.get(row.id) || [], embedMap.get(row.id), 0)
    );
  }

  const statusFilter: PendingStatusFilter =
    params.statusFilter && ['all', 'under_review', 'changes_requested'].includes(params.statusFilter)
      ? params.statusFilter
      : 'all';

  const filtered = indexedItems.filter((item) => {
    const meta = rowMetaMap.get(item.id);
    if (statusFilter === 'under_review' && meta?.status !== 'pending') return false;
    if (statusFilter === 'changes_requested' && meta?.status !== 'changes_requested') return false;
    if (params.contentType && item.contentType !== params.contentType) return false;
    if (params.categoryId && item.categoryId !== params.categoryId) return false;
    if (params.subjectId && item.subjectId !== params.subjectId) return false;
    if (params.pricing === 'free' && !item.isFree) return false;
    if (params.pricing === 'paid' && item.isFree) return false;
    return true;
  });

  const qRaw = String(params.q || '').trim().slice(0, 160);
  const qNorm = normalizeEduQuery(qRaw);
  const parsedIntent = extractEducationalMeta(qRaw);
  const queryTokens = parsedIntent.meaningfulTokens.length
    ? parsedIntent.meaningfulTokens
    : parsedIntent.tokens;

  let scored: Array<{ item: IndexedCatalogItem; score: number }> = [];
  let aiSearchUsed = false;

  if (qNorm.length > 0) {
    aiSearchUsed = true;
    const queryVec = await getQueryEmbedding(qRaw);
    for (const item of filtered) {
      const res = scoreCatalogItemWithQuery(item, qNorm, queryTokens, parsedIntent, queryVec, 0);
      if (res.matched) {
        scored.push({ item, score: res.score });
      }
    }
  } else {
    scored = filtered.map((item) => ({ item, score: 0 }));
  }

  const sortMode = params.sort || (qNorm.length > 0 ? 'relevant' : 'latest');
  scored.sort((a, b) => {
    const ua = new Date(rowMetaMap.get(a.item.id)?.updatedAt || a.item.createdAt).getTime();
    const ub = new Date(rowMetaMap.get(b.item.id)?.updatedAt || b.item.createdAt).getTime();
    const ca = new Date(a.item.createdAt).getTime();
    const cb = new Date(b.item.createdAt).getTime();
    if (sortMode === 'oldest') {
      return ca - cb || a.item.id - b.item.id;
    }
    if (sortMode === 'relevant' && qNorm.length > 0) {
      return b.score - a.score || ub - ua || b.item.id - a.item.id;
    }
    return ub - ua || cb - ca || b.item.id - a.item.id;
  });

  const limit = Math.min(30, Math.max(1, Number(params.limit || 10)));
  const total = scored.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(totalPages, Math.max(1, Number(params.page || 1)));
  const offset = (page - 1) * limit;

  const items = scored.slice(offset, offset + limit).map(({ item, score }) => {
    const meta = rowMetaMap.get(item.id);
    return {
      ...serializeCardItem(item, qNorm.length > 0 ? { relevanceScore: Number(score.toFixed(3)) } : undefined),
      status: meta?.status || 'pending',
      rejectionReason: meta?.rejectionReason || null,
      updatedAt: meta?.updatedAt || item.createdAt,
    };
  });

  return {
    items,
    counts,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
    filtersMeta: {
      contentTypes: Array.from(typeSet).sort(),
      categories: Array.from(catMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      subjects: Array.from(subjMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    searchMeta: {
      query: qRaw,
      aiSearchUsed,
      sortApplied: sortMode,
    },
  };
}
