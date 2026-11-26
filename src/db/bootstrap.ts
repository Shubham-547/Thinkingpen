import { count, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { adminSettings, categories, contents, subjects, users } from './schema.ts';
import { invalidateCatalogCache } from '../lib/cache.ts';
import { backfillMissingPublicUids } from '../lib/identity.ts';

const DEFAULT_SETTINGS = [
  { key: 'site_name', value: 'ScholarPress' },
  { key: 'support_email', value: 'editorial@scholarpress.edu' },
  { key: 'default_commission_rate', value: '10' },
  { key: 'min_withdrawal_inr', value: '100' },
  { key: 'require_content_approval', value: 'true' },
  { key: 'announcement_banner', value: '' },
];

interface TaxonomyCategory {
  name: string;
  slug: string;
  description: string;
  displayOrder: number;
  subjects: { name: string; slug: string; description: string }[];
}

export const CURRICULUM_TAXONOMY: TaxonomyCategory[] = [
  {
    name: 'Engineering & Technology',
    slug: 'engineering-technology',
    description: 'Mechanical, Civil, Electrical, Computer Science, Electronics, and Chemical Engineering.',
    displayOrder: 1,
    subjects: [
      { name: 'Mechanical Engineering', slug: 'mechanical-engineering', description: 'Thermodynamics, mechanics, manufacturing, and machine design.' },
      { name: 'Civil Engineering', slug: 'civil-engineering', description: 'Structural analysis, geotechnics, surveying, and transportation.' },
      { name: 'Electrical Engineering', slug: 'electrical-engineering', description: 'Power systems, circuits, machines, and control engineering.' },
      { name: 'Computer Science Engineering', slug: 'computer-science-engineering', description: 'Algorithms, databases, OS, networks, and software engineering.' },
      { name: 'Electronics Engineering', slug: 'electronics-engineering', description: 'Analog/digital electronics, VLSI, signal processing, and embedded systems.' },
      { name: 'Chemical Engineering', slug: 'chemical-engineering', description: 'Process engineering, reaction kinetics, and heat/mass transfer.' },
      { name: 'Other', slug: 'engineering-technology-other', description: 'Other Engineering & Technology subjects.' },
    ],
  },
  {
    name: 'Competitive Exams',
    slug: 'competitive-exams',
    description: 'UPSC, BPSC, SSC, Banking, Railway, JEE, and NEET exam preparation.',
    displayOrder: 2,
    subjects: [
      { name: 'UPSC', slug: 'upsc', description: 'Civil Services Prelims, Mains GS, CSAT, and optional notes.' },
      { name: 'BPSC', slug: 'bpsc', description: 'Bihar Public Service Commission exam notes and state GK.' },
      { name: 'SSC', slug: 'ssc', description: 'SSC CGL, CHSL, MTS aptitude, reasoning, and GK.' },
      { name: 'Banking', slug: 'banking', description: 'IBPS, SBI PO/Clerk, RBI Grade B quantitative and awareness guides.' },
      { name: 'Railway', slug: 'railway', description: 'RRB NTPC, Group D, ALP technical and general studies.' },
      { name: 'JEE', slug: 'jee', description: 'JEE Main & Advanced Physics, Chemistry, and Mathematics.' },
      { name: 'NEET', slug: 'neet', description: 'NEET UG Biology, Chemistry, and Physics preparation.' },
      { name: 'Other', slug: 'competitive-exams-other', description: 'Other Competitive Exam subjects.' },
    ],
  },
  {
    name: 'Science',
    slug: 'science',
    description: 'Physics, Chemistry, Biology, Astronomy, and Environmental Science.',
    displayOrder: 3,
    subjects: [
      { name: 'Physics', slug: 'physics', description: 'Mechanics, optics, electromagnetism, and modern physics.' },
      { name: 'Chemistry', slug: 'chemistry', description: 'Organic, inorganic, and physical chemistry study guides.' },
      { name: 'Biology', slug: 'biology', description: 'Botany, zoology, genetics, and human physiology.' },
      { name: 'Astronomy', slug: 'astronomy', description: 'Astrophysics, cosmology, planetary science, and space observation.' },
      { name: 'Environmental Science', slug: 'environmental-science', description: 'Ecology, climate science, conservation, and sustainability.' },
      { name: 'Other', slug: 'science-other', description: 'Other Science subjects.' },
    ],
  },
  {
    name: 'Commerce',
    slug: 'commerce',
    description: 'Accountancy, Economics, Business Studies, Finance, and Taxation.',
    displayOrder: 4,
    subjects: [
      { name: 'Accountancy', slug: 'accountancy', description: 'Financial accounting, corporate accounts, and auditing.' },
      { name: 'Economics', slug: 'economics', description: 'Microeconomics, macroeconomics, and Indian economic development.' },
      { name: 'Business Studies', slug: 'business-studies', description: 'Management principles, marketing, and business law.' },
      { name: 'Finance', slug: 'finance', description: 'Corporate finance, investments, banking, and capital markets.' },
      { name: 'Taxation', slug: 'taxation', description: 'Direct tax, GST, income tax compliance, and tax planning.' },
      { name: 'Other', slug: 'commerce-other', description: 'Other Commerce subjects.' },
    ],
  },
  {
    name: 'Humanities & Social Sciences',
    slug: 'humanities-social-sciences',
    description: 'History, Geography, Political Science, Sociology, Psychology, Philosophy, and Anthropology.',
    displayOrder: 5,
    subjects: [
      { name: 'History', slug: 'history', description: 'Ancient, medieval, modern Indian, and world history.' },
      { name: 'Geography', slug: 'geography', description: 'Physical, human, and Indian geography.' },
      { name: 'Political Science', slug: 'political-science', description: 'Indian polity, constitution, governance, and international relations.' },
      { name: 'Sociology', slug: 'sociology', description: 'Social theory, Indian society, and cultural institutions.' },
      { name: 'Psychology', slug: 'psychology', description: 'Cognitive, developmental, clinical, and behavioral psychology.' },
      { name: 'Philosophy', slug: 'philosophy', description: 'Indian and Western philosophy, logic, and ethics.' },
      { name: 'Anthropology', slug: 'anthropology', description: 'Biological, social-cultural, and archaeological anthropology.' },
      { name: 'Other', slug: 'humanities-social-sciences-other', description: 'Other Humanities & Social Sciences subjects.' },
    ],
  },
  {
    name: 'Literature & Poetry',
    slug: 'literature-poetry',
    description: 'Hindi, English, Urdu, Sanskrit Literature, Poetry, Fiction & Novels, and Drama.',
    displayOrder: 6,
    subjects: [
      { name: 'Hindi Literature', slug: 'hindi-literature', description: 'Hindi Sahitya, prose, criticism, and classical works.' },
      { name: 'English Literature', slug: 'english-literature', description: 'British, American, Indian English writing, and literary theory.' },
      { name: 'Urdu Literature', slug: 'urdu-literature', description: 'Ghazal, nazm, afsana, and classical Urdu prose.' },
      { name: 'Sanskrit Literature', slug: 'sanskrit-literature', description: 'Kavya, natya, grammar, and classical Sanskrit texts.' },
      { name: 'Poetry', slug: 'poetry', description: 'Original poems, verse collections, and prosody.' },
      { name: 'Fiction & Novels', slug: 'fiction-novels', description: 'Short stories, serialized novels, and creative fiction.' },
      { name: 'Drama', slug: 'drama', description: 'Stage plays, dramatic criticism, and screenwriting.' },
      { name: 'Other', slug: 'literature-poetry-other', description: 'Other Literature & Poetry subjects.' },
    ],
  },
  {
    name: 'Other',
    slug: 'other',
    description: 'Interdisciplinary topics, skill guides, and other educational resources.',
    displayOrder: 99,
    subjects: [
      { name: 'Other', slug: 'other-other', description: 'Other general topics and custom subjects.' },
    ],
  },
];

async function syncCurriculumTaxonomy(): Promise<void> {
  const migrationKey = 'migrated_curriculum_taxonomy_v2';
  const [alreadySynced] = await db
    .select({ key: adminSettings.key })
    .from(adminSettings)
    .where(eq(adminSettings.key, migrationKey))
    .limit(1);

  const [catCount] = await db.select({ value: count() }).from(categories);
  if (alreadySynced && Number(catCount?.value || 0) >= CURRICULUM_TAXONOMY.length) {
    return;
  }

  const catIdBySlug = new Map<string, number>();
  const subjIdBySlug = new Map<string, number>();

  for (const cat of CURRICULUM_TAXONOMY) {
    const [existingCat] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, cat.slug))
      .limit(1);

    let catId: number;
    if (existingCat) {
      await db
        .update(categories)
        .set({
          name: cat.name,
          description: cat.description,
          displayOrder: cat.displayOrder,
          isFeatured: true,
        })
        .where(eq(categories.id, existingCat.id));
      catId = existingCat.id;
    } else {
      const [inserted] = await db
        .insert(categories)
        .values({
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          displayOrder: cat.displayOrder,
          isFeatured: true,
        })
        .returning({ id: categories.id });
      catId = inserted.id;
    }
    catIdBySlug.set(cat.slug, catId);

    for (const subj of cat.subjects) {
      const [existingSubj] = await db
        .select()
        .from(subjects)
        .where(eq(subjects.slug, subj.slug))
        .limit(1);

      let subjId: number;
      if (existingSubj) {
        await db
          .update(subjects)
          .set({
            categoryId: catId,
            name: subj.name,
            description: subj.description,
          })
          .where(eq(subjects.id, existingSubj.id));
        subjId = existingSubj.id;
      } else {
        const [insertedSubj] = await db
          .insert(subjects)
          .values({
            categoryId: catId,
            name: subj.name,
            slug: subj.slug,
            description: subj.description,
          })
          .returning({ id: subjects.id });
        subjId = insertedSubj.id;
      }
      subjIdBySlug.set(subj.slug, subjId);
    }
  }

  // Safely remap any legacy categories/subjects on existing contents so zero publications lose linkage
  const legacyCategoryRemap: Record<string, { cat: string; subj: string }> = {
    'computer-science': { cat: 'engineering-technology', subj: 'computer-science-engineering' },
    technology: { cat: 'engineering-technology', subj: 'electronics-engineering' },
    engineering: { cat: 'engineering-technology', subj: 'engineering-technology-other' },
    mathematics: { cat: 'science', subj: 'science-other' },
    'physics-chemistry': { cat: 'science', subj: 'physics' },
    'medicine-biology': { cat: 'science', subj: 'biology' },
    history: { cat: 'humanities-social-sciences', subj: 'history' },
    geography: { cat: 'humanities-social-sciences', subj: 'geography' },
    'history-humanities': { cat: 'humanities-social-sciences', subj: 'history' },
    english: { cat: 'literature-poetry', subj: 'english-literature' },
    literature: { cat: 'literature-poetry', subj: 'fiction-novels' },
    'economics-commerce': { cat: 'commerce', subj: 'economics' },
    'general-knowledge': { cat: 'competitive-exams', subj: 'competitive-exams-other' },
    'research-writing': { cat: 'other', subj: 'other-other' },
  };

  const legacySubjectRemap: Record<string, { cat: string; subj: string }> = {
    'organic-chemistry': { cat: 'science', subj: 'chemistry' },
    'classical-modern-physics': { cat: 'science', subj: 'physics' },
    'linear-algebra': { cat: 'science', subj: 'science-other' },
    'multivariable-calculus': { cat: 'science', subj: 'science-other' },
    'modern-indian-history': { cat: 'humanities-social-sciences', subj: 'history' },
    'climatology-geomorphology': { cat: 'humanities-social-sciences', subj: 'geography' },
    'academic-writing': { cat: 'literature-poetry', subj: 'english-literature' },
    'distributed-systems': { cat: 'engineering-technology', subj: 'computer-science-engineering' },
    'algorithms-data-structures': { cat: 'engineering-technology', subj: 'computer-science-engineering' },
    'embedded-systems': { cat: 'engineering-technology', subj: 'electronics-engineering' },
    'short-fiction': { cat: 'literature-poetry', subj: 'fiction-novels' },
    'contemporary-poetry': { cat: 'literature-poetry', subj: 'poetry' },
    'upsc-gs': { cat: 'competitive-exams', subj: 'upsc' },
    'gate-cs': { cat: 'engineering-technology', subj: 'computer-science-engineering' },
    'indian-economy': { cat: 'commerce', subj: 'economics' },
  };

  const allSubjs = await db.select().from(subjects);
  for (const s of allSubjs) {
    const remap = legacySubjectRemap[s.slug];
    if (remap) {
      const targetCatId = catIdBySlug.get(remap.cat);
      const targetSubjId = subjIdBySlug.get(remap.subj);
      if (targetCatId && targetSubjId) {
        await db
          .update(contents)
          .set({ categoryId: targetCatId, subjectId: targetSubjId })
          .where(eq(contents.subjectId, s.id));
      }
    }
  }

  const allCats = await db.select().from(categories);
  for (const c of allCats) {
    const remap = legacyCategoryRemap[c.slug];
    if (remap) {
      const targetCatId = catIdBySlug.get(remap.cat);
      const targetSubjId = subjIdBySlug.get(remap.subj);
      if (targetCatId) {
        await db
          .update(contents)
          .set({
            categoryId: targetCatId,
            subjectId: targetSubjId ?? null,
          })
          .where(eq(contents.categoryId, c.id));
      }
    }
  }

  // Clean up obsolete legacy subjects and categories not in the official taxonomy
  const validCatSlugs = CURRICULUM_TAXONOMY.map((c) => c.slug);
  const validSubjSlugs = CURRICULUM_TAXONOMY.flatMap((c) => c.subjects.map((s) => s.slug));

  const obsoleteSubjs = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(notInArray(subjects.slug, validSubjSlugs));
  if (obsoleteSubjs.length > 0) {
    const obsSubjIds = obsoleteSubjs.map((s) => s.id);
    await db
      .update(contents)
      .set({ subjectId: null })
      .where(inArray(contents.subjectId, obsSubjIds));
    await db.delete(subjects).where(inArray(subjects.id, obsSubjIds));
  }

  const obsoleteCats = await db
    .select({ id: categories.id })
    .from(categories)
    .where(notInArray(categories.slug, validCatSlugs));
  if (obsoleteCats.length > 0) {
    const fallbackCatId = catIdBySlug.get('other')!;
    const obsCatIds = obsoleteCats.map((c) => c.id);
    await db
      .update(contents)
      .set({ categoryId: fallbackCatId })
      .where(inArray(contents.categoryId, obsCatIds));
    await db.delete(categories).where(inArray(categories.id, obsCatIds));
  }

  await db
    .insert(adminSettings)
    .values({ key: migrationKey, value: new Date().toISOString() })
    .onConflictDoNothing();

  invalidateCatalogCache();
}

/**
 * Idempotently populates baseline settings, categories/subjects taxonomy,
 * missing 10-digit user UIDs, and one-time governance migrations.
 */
export async function ensureBaselineCatalog(): Promise<void> {
  try {
    try {
      await db.execute(sql`
        ALTER TABLE contents
        ADD COLUMN IF NOT EXISTS downloads_count INTEGER NOT NULL DEFAULT 0
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS content_downloads (
          id SERIAL PRIMARY KEY,
          content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
          file_id INTEGER REFERENCES content_files(id) ON DELETE SET NULL,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_content_downloads_content_created
        ON content_downloads(content_id, created_at)
      `);
    } catch {
      // Managed Cloud SQL environments apply schema changes via Drizzle UpdateSchema (admin role)
    }

    await db.insert(adminSettings).values(DEFAULT_SETTINGS).onConflictDoNothing();

    await syncCurriculumTaxonomy();

    const backfilled = await backfillMissingPublicUids();
    if (backfilled > 0) {
      console.log(`Assigned 10-digit unique UID to ${backfilled} existing user(s).`);
    }

    // One-time governance migration: ensure ishivanibharti@gmail.com is removed from admin role
    const migrationKey = 'migrated_revoke_shivani_admin_v1';
    const [alreadyMigrated] = await db
      .select({ key: adminSettings.key })
      .from(adminSettings)
      .where(eq(adminSettings.key, migrationKey))
      .limit(1);

    if (!alreadyMigrated) {
      const revoked = await db
        .update(users)
        .set({ role: 'user', updatedAt: new Date() })
        .where(sql`LOWER(${users.email}) = 'ishivanibharti@gmail.com' AND ${users.role} = 'admin'`)
        .returning({ id: users.id });
      await db
        .insert(adminSettings)
        .values({ key: migrationKey, value: new Date().toISOString() })
        .onConflictDoNothing();
      if (revoked.length > 0) {
        console.log('Revoked legacy admin privileges for ishivanibharti@gmail.com.');
      }
    }
  } catch (err) {
    console.warn('Baseline catalog bootstrap skipped:', (err as Error).message);
  }
}
