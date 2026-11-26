import crypto from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import { db } from '../db/index.ts';
import {
  categories,
  contentEmbeddings,
  contents,
  contentTags,
  subjects,
  users,
} from '../db/schema.ts';

const GEMINI_EMBED_MODEL = 'gemini-embedding-2';
const LOCAL_VECTOR_DIM = 128;

// ===== EDUCATIONAL NORMALIZER, ABBREVIATION & HINGLISH DICTIONARY =====
const EDU_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'and',
  'or', 'into', 'about', 'me', 'my', 'i', 'you', 'your', 'please', 'tell',
  'explain', 'understand', 'how', 'what', 'why', 'simple', 'easy', 'best',
  'video', 'videos', 'lecture', 'lectures', 'classs', 'ka', 'ki', 'ke',
  'ko', 'se', 'aur', 'par', 'hai', 'hain', 'chahiye', 'batao', 'bataiye',
  'mein', 'mai', 'wala', 'wali', 'wale', 'kaun', 'kya', 'kaise', 'in',
]);

const ABBREVIATION_MAP: Record<string, string> = {
  ch: 'chapter',
  chap: 'chapter',
  chp: 'chapter',
  adhyay: 'chapter',
  paath: 'chapter',
  unit: 'chapter',
  ex: 'exercise',
  exer: 'exercise',
  q: 'question',
  ques: 'question',
  qs: 'questions',
  prashn: 'question',
  sawal: 'question',
  sol: 'solution',
  soln: 'solution',
  solns: 'solutions',
  ans: 'answer',
  hal: 'solution',
  pyq: 'previous year questions',
  pyqs: 'previous year questions',
  mcq: 'multiple choice questions',
  mcqs: 'multiple choice questions',
  math: 'mathematics',
  maths: 'mathematics',
  ganit: 'mathematics',
  phy: 'physics',
  bhautiki: 'physics',
  chem: 'chemistry',
  rasayan: 'chemistry',
  bio: 'biology',
  jeev: 'biology',
  cs: 'computer science',
  cse: 'computer science',
  it: 'information technology',
  dsa: 'data structures algorithms',
  os: 'operating systems',
  dbms: 'database management systems',
  cn: 'computer networks',
  ai: 'artificial intelligence',
  ml: 'machine learning',
  eng: 'english',
  hist: 'history',
  geo: 'geography',
  econ: 'economics',
  eco: 'economics',
  pol: 'political science',
  polity: 'political science',
  sst: 'social studies',
  sci: 'science',
  vigyan: 'science',
  gk: 'general knowledge',
  rev: 'revision',
  samjhao: 'explanation',
  samajh: 'explanation',
  vyakhya: 'explanation',
  saransh: 'summary',
  asaan: 'simple',
  asan: 'simple',
  cl: 'class',
  std: 'class',
  kaksha: 'class',
  grd: 'class',
  grade: 'class',
  bcom: 'b com',
  bsc: 'b sc',
  msc: 'm sc',
  btech: 'b tech',
  mtech: 'm tech',
  ba: 'b a',
  ma: 'm a',
  quad: 'quadratic',
  eq: 'equation',
  eqns: 'equations',
  eqn: 'equation',
  num: 'numericals',
  nums: 'numericals',
  deriv: 'derivation',
  intro: 'introduction',
  full: 'complete',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  first: '1',
  second: '2',
  third: '3',
  fourth: '4',
  fifth: '5',
  sixth: '6',
  seventh: '7',
  eighth: '8',
  ninth: '9',
  tenth: '10',
  eleventh: '11',
  twelfth: '12',
  '1st': '1',
  '2nd': '2',
  '3rd': '3',
  '4th': '4',
  '5th': '5',
  '6th': '6',
  '7th': '7',
  '8th': '8',
  '9th': '9',
  '10th': '10',
  '11th': '11',
  '12th': '12',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
};

// Conceptual clusters so local offline embeddings capture academic domain similarity
const SEMANTIC_CONCEPT_CLUSTERS: Array<{ id: number; keywords: string[] }> = [
  { id: 0, keywords: ['mathematics', 'algebra', 'quadratic', 'equation', 'polynomial', 'matrix', 'matrices', 'linear', 'calculus', 'derivative', 'integral', 'trigonometry', 'geometry', 'theorem', 'proof', 'rs', 'aggarwal', 'rd', 'sharma', 'ncert'] },
  { id: 1, keywords: ['physics', 'newton', 'law', 'laws', 'motion', 'force', 'mechanics', 'kinematics', 'energy', 'work', 'power', 'electricity', 'magnetism', 'current', 'circuit', 'optics', 'wave', 'thermodynamics', 'quantum', 'numericals', 'hc', 'verma'] },
  { id: 2, keywords: ['chemistry', 'organic', 'inorganic', 'physical', 'reaction', 'mechanism', 'hydrocarbon', 'alcohol', 'acid', 'base', 'mole', 'atom', 'molecule', 'periodic', 'bond', 'polymer', 'alkane', 'ketone', 'aldehyde'] },
  { id: 3, keywords: ['biology', 'cell', 'genetics', 'dna', 'rna', 'evolution', 'ecology', 'plant', 'human', 'physiology', 'anatomy', 'botany', 'zoology', 'mitosis', 'photosynthesis', 'neet', 'enzyme'] },
  { id: 4, keywords: ['computer', 'science', 'algorithm', 'algorithms', 'data', 'structure', 'structures', 'distributed', 'consensus', 'raft', 'paxos', 'database', 'sql', 'operating', 'system', 'network', 'programming', 'python', 'java', 'javascript', 'gate', 'coding'] },
  { id: 5, keywords: ['literature', 'poem', 'poems', 'poetry', 'story', 'stories', 'novel', 'essay', 'verse', 'prose', 'grammar', 'english', 'hindi', 'writing', 'comprehension', 'shakespeare', 'author'] },
  { id: 6, keywords: ['history', 'geography', 'polity', 'economics', 'civics', 'constitution', 'upsc', 'ias', 'social', 'modern', 'ancient', 'medieval', 'economy', 'gdp', 'parliament'] },
  { id: 7, keywords: ['commerce', 'accounting', 'accountancy', 'finance', 'business', 'management', 'marketing', 'tax', 'audit', 'balance', 'sheet', 'ca', 'mba'] },
  { id: 8, keywords: ['exam', 'previous', 'year', 'questions', 'revision', 'practice', 'mock', 'test', 'solution', 'solutions', 'exercise', 'chapter', 'full', 'notes', 'summary', 'jee', 'neet', 'gate', 'upsc', 'board'] },
  { id: 9, keywords: ['video', 'lecture', 'tutorial', 'explanation', 'walkthrough', 'demonstration', 'course', 'recorded', 'lesson', 'seminar'] },
];

export interface ExtractedEducationalMeta {
  normalizedText: string;
  tokens: string[];
  meaningfulTokens: string[];
  classLevel: string | null;
  chapterOrder: number | null;
  languageHint: string | null;
  studyLabelHint: string | null;
  subjectHints: string[];
}

export function normalizeTextBasic(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\p{L}\p{N}\s.+\-/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEduQuery(input: string): string {
  const basic = normalizeTextBasic(input)
    .replace(/\b(b\.?\s*sc\.?)\b/g, 'bsc')
    .replace(/\b(m\.?\s*sc\.?)\b/g, 'msc')
    .replace(/\b(b\.?\s*tech\.?)\b/g, 'btech')
    .replace(/\b(r\.?\s*s\.?\s*aggarwal)\b/g, 'rs aggarwal')
    .replace(/\b(h\.?\s*c\.?\s*verma)\b/g, 'hc verma')
    .replace(/\bclass\s*[-:]?\s*(\d{1,2})(?:th|st|nd|rd)?\b/g, 'class $1')
    .replace(/\bchapter\s*[-:]?\s*(\d{1,3})\b/g, 'chapter $1')
    .replace(/\bch\s*[-:.]?\s*(\d{1,3})\b/g, 'chapter $1')
    .replace(/\bex\s*[-:.]?\s*(\d+(?:\.\d+)?)\b/g, 'exercise $1');

  const rawWords = basic.split(/\s+/).filter(Boolean);
  const expanded: string[] = [];
  for (const w of rawWords) {
    const clean = w.replace(/^[.+\-/]+|[.+\-/]+$/g, '');
    if (!clean) continue;
    const mapped = ABBREVIATION_MAP[clean];
    if (mapped) {
      expanded.push(...mapped.split(/\s+/));
    } else {
      expanded.push(clean);
    }
  }
  return expanded.join(' ').trim();
}

export function stemEduToken(token: string): string {
  let t = token.toLowerCase().trim();
  if (t.length <= 3) return t;
  if (t.endsWith('ies') && t.length > 5) return `${t.slice(0, -3)}y`;
  if (t.endsWith('tions') && t.length > 6) return t.slice(0, -1);
  if (t.endsWith('tion') && t.length > 6) return t;
  if (t.endsWith('ments') && t.length > 6) return t.slice(0, -1);
  if (t.endsWith('ing') && t.length > 5) return t.slice(0, -3);
  if (t.endsWith('ers') && t.length > 5) return t.slice(0, -1);
  if (t.endsWith('es') && t.length > 4 && !t.endsWith('ses')) return t.slice(0, -2);
  if (t.endsWith('s') && t.length > 4 && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function tokenizeEdu(input: string, dropStopWords = true): string[] {
  const norm = normalizeEduQuery(input);
  const parts = norm.split(/\s+/).filter(Boolean);
  if (!dropStopWords) return parts;
  return parts.filter((p) => !EDU_STOP_WORDS.has(p));
}

export function extractEducationalMeta(
  rawText: string,
  explicit?: {
    classLevel?: string | null;
    chapter?: string | null;
    topic?: string | null;
    chapterOrder?: number | null;
    studyLabel?: string | null;
    language?: string | null;
  }
): ExtractedEducationalMeta {
  const normalizedText = normalizeEduQuery(rawText);
  const allTokens = normalizedText.split(/\s+/).filter(Boolean);
  const meaningfulTokens = allTokens.filter((t) => !EDU_STOP_WORDS.has(t));

  // Detect Class / Academic Level
  let classLevel: string | null = explicit?.classLevel?.trim() || null;
  if (!classLevel) {
    const classMatch = normalizedText.match(/\bclass\s+(1[0-2]|[1-9])\b/);
    if (classMatch) {
      classLevel = `Class ${classMatch[1]}`;
    } else if (/\bb\s?sc\b.*\b1\b|\bfirst\s+year\b.*\bb\s?sc\b/.test(normalizedText)) {
      classLevel = 'BSc 1st Year';
    } else if (/\bb\s?sc\b/.test(normalizedText)) {
      classLevel = 'BSc';
    } else if (/\bm\s?sc\b/.test(normalizedText)) {
      classLevel = 'MSc';
    } else if (/\bb\s?tech\b/.test(normalizedText)) {
      classLevel = 'BTech';
    } else if (/\bjee\s+main\b/.test(normalizedText)) {
      classLevel = 'JEE Main';
    } else if (/\bjee\s+advanced\b/.test(normalizedText)) {
      classLevel = 'JEE Advanced';
    } else if (/\bjee\b/.test(normalizedText)) {
      classLevel = 'JEE';
    } else if (/\bneet\b/.test(normalizedText)) {
      classLevel = 'NEET';
    } else if (/\bgate\b/.test(normalizedText)) {
      classLevel = 'GATE';
    } else if (/\bupsc\b/.test(normalizedText)) {
      classLevel = 'UPSC';
    }
  }

  // Detect Chapter Order
  let chapterOrder: number | null =
    explicit?.chapterOrder && Number.isInteger(explicit.chapterOrder) ? explicit.chapterOrder : null;
  if (chapterOrder === null) {
    const chSource = explicit?.chapter ? normalizeEduQuery(explicit.chapter) : normalizedText;
    const chMatch = chSource.match(/\bchapter\s+(\d{1,3})\b/);
    if (chMatch) chapterOrder = Number(chMatch[1]);
  }

  // Detect Language Hint
  let languageHint: string | null = explicit?.language?.trim() || null;
  if (!languageHint) {
    if (/\bhindi\b/.test(normalizedText)) languageHint = 'Hindi';
    else if (/\bbengali\b/.test(normalizedText)) languageHint = 'Bengali';
    else if (/\bmarathi\b/.test(normalizedText)) languageHint = 'Marathi';
    else if (/\btamil\b/.test(normalizedText)) languageHint = 'Tamil';
    else if (/\btelugu\b/.test(normalizedText)) languageHint = 'Telugu';
    else if (/\bbilingual\b/.test(normalizedText)) languageHint = 'Bilingual';
  }

  // Detect Study Label Hint
  let studyLabelHint: string | null = explicit?.studyLabel?.trim() || null;
  if (!studyLabelHint) {
    if (/previous year questions/.test(normalizedText)) studyLabelHint = 'Previous Year Questions';
    else if (/\bexercise\b|\bsolution\b|\bsolutions\b/.test(normalizedText)) studyLabelHint = 'Exercise Solution';
    else if (/\brevision\b|\bquick summary\b|\bone shot\b/.test(normalizedText)) studyLabelHint = 'Revision';
    else if (/\bpractice\b|\bnumericals\b|\bproblems\b|\bworksheet\b/.test(normalizedText)) studyLabelHint = 'Practice';
    else if (/\bfull\b|\bcomplete\b|\bexplanation\b/.test(normalizedText) && /\bchapter\b/.test(normalizedText)) {
      studyLabelHint = 'Full Chapter';
    }
  }

  const knownSubjects = [
    'mathematics', 'physics', 'chemistry', 'biology', 'computer science',
    'english', 'hindi', 'history', 'geography', 'economics', 'political science',
    'social studies', 'commerce', 'accounting', 'literature', 'distributed systems',
  ];
  const subjectHints = knownSubjects.filter((s) => normalizedText.includes(s));

  return {
    normalizedText,
    tokens: allTokens,
    meaningfulTokens,
    classLevel,
    chapterOrder,
    languageHint,
    studyLabelHint,
    subjectHints,
  };
}

function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

export function cosineSimilarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

/**
 * Deterministic, zero-cost local educational semantic vector (128-dim).
 * Encodes normalized tokens, stems, bigrams, character 3-grams (typo resilience), and domain clusters.
 */
export function computeLocalSemanticVector(rawText: string): number[] {
  const vec = new Array<number>(LOCAL_VECTOR_DIM).fill(0);
  const tokens = tokenizeEdu(rawText, true);
  if (tokens.length === 0) return vec;

  const clusterOffset = LOCAL_VECTOR_DIM - SEMANTIC_CONCEPT_CLUSTERS.length; // dims 118..127
  const hashSpace = clusterOffset;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const stem = stemEduToken(tok);

    // Exact token & stem hashing (two signed projections to cut collision noise)
    const h1 = fnv1a32(`t:${tok}`) % hashSpace;
    const s1 = (fnv1a32(`s:${tok}`) & 1) === 0 ? 1 : -1;
    vec[h1] += 2.2 * s1;

    const h2 = fnv1a32(`st:${stem}`) % hashSpace;
    const s2 = (fnv1a32(`ss:${stem}`) & 1) === 0 ? 1 : -1;
    vec[h2] += 1.6 * s2;

    // Sequential bigram boost
    if (i < tokens.length - 1) {
      const bg = `${stem}_${stemEduToken(tokens[i + 1])}`;
      const hb = fnv1a32(`bg:${bg}`) % hashSpace;
      const sb = (fnv1a32(`bgs:${bg}`) & 1) === 0 ? 1 : -1;
      vec[hb] += 1.8 * sb;
    }

    // Character 3-grams for typo tolerance in semantic space
    const padded = `^${tok}$`;
    if (padded.length >= 3) {
      for (let j = 0; j <= padded.length - 3; j += 1) {
        const tri = padded.slice(j, j + 3);
        const ht = fnv1a32(`c3:${tri}`) % hashSpace;
        const st = (fnv1a32(`c3s:${tri}`) & 1) === 0 ? 1 : -1;
        vec[ht] += 0.45 * st;
      }
    }

    // Concept cluster boost
    for (const cluster of SEMANTIC_CONCEPT_CLUSTERS) {
      if (cluster.keywords.includes(tok) || cluster.keywords.includes(stem)) {
        vec[clusterOffset + cluster.id] += 2.6;
      }
    }
  }

  return l2Normalize(vec);
}

// ===== OPTIONAL GEMINI EMBEDDING ENGINE (SERVER-SIDE ONLY) =====
let cachedGenAiClient: GoogleGenAI | null | undefined = undefined;

export function isGeminiEmbeddingsConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10);
}

function getGenAiClient(): GoogleGenAI | null {
  if (!isGeminiEmbeddingsConfigured()) return null;
  if (cachedGenAiClient !== undefined) return cachedGenAiClient;
  cachedGenAiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!.trim(),
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
  return cachedGenAiClient;
}

// Bounded LRU cache for query embeddings so repeated searches cost $0
const QUERY_EMBED_TTL_MS = 30 * 60 * 1000;
const MAX_QUERY_EMBED_CACHE = 400;
const queryEmbedCache = new Map<
  string,
  { model: string; vector: number[]; fallbackVector: number[]; expiresAt: number }
>();

export async function getQueryEmbedding(query: string): Promise<{
  model: string;
  vector: number[];
  fallbackVector: number[];
}> {
  const norm = normalizeEduQuery(query);
  const fallbackVector = computeLocalSemanticVector(norm);

  if (!norm) {
    return { model: 'local-edu-v1', vector: fallbackVector, fallbackVector };
  }

  const existing = queryEmbedCache.get(norm);
  if (existing && existing.expiresAt > Date.now()) {
    return {
      model: existing.model,
      vector: existing.vector,
      fallbackVector: existing.fallbackVector,
    };
  }

  const ai = getGenAiClient();
  let model = 'local-edu-v1';
  let vector = fallbackVector;

  if (ai) {
    try {
      const resp = await ai.models.embedContent({
        model: GEMINI_EMBED_MODEL,
        contents: [norm],
      });
      const values = resp?.embeddings?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        model = GEMINI_EMBED_MODEL;
        vector = l2Normalize(values.map((n) => Number(n)));
      }
    } catch (err) {
      console.warn('Gemini query embedding fallback to local engine:', (err as Error).message);
    }
  }

  if (queryEmbedCache.size >= MAX_QUERY_EMBED_CACHE) {
    const oldestKey = queryEmbedCache.keys().next().value;
    if (oldestKey) queryEmbedCache.delete(oldestKey);
  }
  queryEmbedCache.set(norm, {
    model,
    vector,
    fallbackVector,
    expiresAt: Date.now() + QUERY_EMBED_TTL_MS,
  });

  return { model, vector, fallbackVector };
}

function buildContentEmbeddingDocument(row: {
  title: string;
  shortDescription: string;
  authorName: string | null;
  publisherName: string | null;
  creatorName: string;
  categoryName: string | null;
  subjectName: string | null;
  contentType: string;
  language: string;
  classLevel: string | null;
  chapter: string | null;
  topic: string | null;
  chapterOrder: number | null;
  studyLabel: string | null;
  tags: string[];
}) {
  const parts = [
    row.title,
    row.classLevel || '',
    row.categoryName || '',
    row.subjectName || '',
    row.chapter || '',
    row.chapterOrder ? `chapter ${row.chapterOrder}` : '',
    row.topic || '',
    row.studyLabel || '',
    row.contentType,
    row.language,
    row.tags.join(' '),
    row.authorName || row.creatorName,
    row.publisherName || '',
    row.shortDescription,
  ]
    .map((p) => p.trim())
    .filter(Boolean);

  const rawDoc = parts.join(' · ');
  const normalizedDoc = normalizeEduQuery(rawDoc);
  const extractedMeta = extractEducationalMeta(rawDoc, {
    classLevel: row.classLevel,
    chapter: row.chapter,
    topic: row.topic,
    chapterOrder: row.chapterOrder,
    studyLabel: row.studyLabel,
    language: row.language,
  });

  const hashPayload = JSON.stringify({
    title: row.title,
    shortDescription: row.shortDescription,
    authorName: row.authorName,
    publisherName: row.publisherName,
    creatorName: row.creatorName,
    categoryName: row.categoryName,
    subjectName: row.subjectName,
    contentType: row.contentType,
    language: row.language,
    classLevel: row.classLevel,
    chapter: row.chapter,
    topic: row.topic,
    chapterOrder: row.chapterOrder,
    studyLabel: row.studyLabel,
    tags: [...row.tags].sort(),
  });
  const metadataHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

  return { rawDoc, normalizedDoc, extractedMeta, metadataHash };
}

/**
 * Computes and persists semantic embeddings for a content item.
 * Never re-calls Gemini API when `metadataHash` & model already match!
 */
export async function syncContentEmbedding(contentId: number): Promise<void> {
  try {
    const [row] = await db
      .select({
        id: contents.id,
        title: contents.title,
        shortDescription: contents.shortDescription,
        authorName: contents.authorName,
        publisherName: contents.publisherName,
        contentType: contents.contentType,
        language: contents.language,
        classLevel: contents.classLevel,
        chapter: contents.chapter,
        topic: contents.topic,
        chapterOrder: contents.chapterOrder,
        studyLabel: contents.studyLabel,
        status: contents.status,
        deletedAt: contents.deletedAt,
        creatorName: users.name,
        categoryName: categories.name,
        subjectName: subjects.name,
      })
      .from(contents)
      .innerJoin(users, eq(contents.creatorId, users.id))
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(eq(contents.id, contentId))
      .limit(1);

    if (!row || row.deletedAt || row.status !== 'approved') {
      return;
    }

    const tagsRows = await db
      .select({ tag: contentTags.tag })
      .from(contentTags)
      .where(eq(contentTags.contentId, contentId));

    const docInfo = buildContentEmbeddingDocument({
      ...row,
      tags: tagsRows.map((t) => t.tag),
    });

    const desiredModel = isGeminiEmbeddingsConfigured() ? GEMINI_EMBED_MODEL : 'local-edu-v1';

    const [existing] = await db
      .select({
        metadataHash: contentEmbeddings.metadataHash,
        embeddingModel: contentEmbeddings.embeddingModel,
      })
      .from(contentEmbeddings)
      .where(eq(contentEmbeddings.contentId, contentId))
      .limit(1);

    if (
      existing &&
      existing.metadataHash === docInfo.metadataHash &&
      existing.embeddingModel === desiredModel
    ) {
      return;
    }

    const fallbackVector = computeLocalSemanticVector(docInfo.normalizedDoc);
    let primaryVector = fallbackVector;
    let usedModel = 'local-edu-v1';

    const ai = getGenAiClient();
    if (ai) {
      try {
        const resp = await ai.models.embedContent({
          model: GEMINI_EMBED_MODEL,
          contents: [docInfo.rawDoc],
        });
        const values = resp?.embeddings?.[0]?.values;
        if (Array.isArray(values) && values.length > 0) {
          primaryVector = l2Normalize(values.map((n) => Number(n)));
          usedModel = GEMINI_EMBED_MODEL;
        }
      } catch (err) {
        console.warn(`Gemini embedding skipped for content ${contentId}:`, (err as Error).message);
      }
    }

    await db
      .insert(contentEmbeddings)
      .values({
        contentId,
        metadataHash: docInfo.metadataHash,
        embeddingModel: usedModel,
        dimensions: primaryVector.length,
        vectorJson: primaryVector,
        fallbackVectorJson: fallbackVector,
        normalizedDoc: docInfo.normalizedDoc,
        extractedMeta: docInfo.extractedMeta as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: contentEmbeddings.contentId,
        set: {
          metadataHash: docInfo.metadataHash,
          embeddingModel: usedModel,
          dimensions: primaryVector.length,
          vectorJson: primaryVector,
          fallbackVectorJson: fallbackVector,
          normalizedDoc: docInfo.normalizedDoc,
          extractedMeta: docInfo.extractedMeta as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn(`syncContentEmbedding(${contentId}) warning:`, (err as Error).message);
  }
}

export async function backfillMissingEmbeddings(): Promise<number> {
  const approvedRows = await db
    .select({ id: contents.id })
    .from(contents)
    .where(and(eq(contents.status, 'approved'), isNull(contents.deletedAt)));

  if (approvedRows.length === 0) return 0;
  const ids = approvedRows.map((r) => r.id);

  const existing = await db
    .select({
      contentId: contentEmbeddings.contentId,
      embeddingModel: contentEmbeddings.embeddingModel,
    })
    .from(contentEmbeddings)
    .where(inArray(contentEmbeddings.contentId, ids));

  const desiredModel = isGeminiEmbeddingsConfigured() ? GEMINI_EMBED_MODEL : 'local-edu-v1';
  const upToDate = new Set(
    existing.filter((e) => e.embeddingModel === desiredModel).map((e) => e.contentId)
  );

  let indexed = 0;
  for (const id of ids) {
    if (!upToDate.has(id)) {
      await syncContentEmbedding(id);
      indexed += 1;
    }
  }
  return indexed;
}
