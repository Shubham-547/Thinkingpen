import { count } from 'drizzle-orm';
import { db } from './index.ts';
import { adminSettings, categories } from './schema.ts';
import { backfillMissingPublicUids } from '../lib/identity.ts';

const DEFAULT_SETTINGS = [
  { key: 'site_name', value: 'ScholarPress' },
  { key: 'support_email', value: 'editorial@scholarpress.edu' },
  { key: 'default_commission_rate', value: '10' },
  { key: 'min_withdrawal_inr', value: '100' },
  { key: 'require_content_approval', value: 'true' },
  { key: 'announcement_banner', value: '' },
];

const DEFAULT_CATEGORIES = [
  { name: 'Computer Science', slug: 'computer-science', description: 'Algorithms, systems, AI, and programming study notes.', displayOrder: 1 },
  { name: 'Mathematics', slug: 'mathematics', description: 'Calculus, linear algebra, probability, and proofs.', displayOrder: 2 },
  { name: 'Physics & Chemistry', slug: 'physics-chemistry', description: 'Core sciences, lab guides, and formula monographs.', displayOrder: 3 },
  { name: 'Competitive Exams', slug: 'competitive-exams', description: 'UPSC, GATE, JEE, NEET, and SSC preparation notes.', displayOrder: 4 },
  { name: 'Engineering', slug: 'engineering', description: 'Electrical, mechanical, civil, and electronics materials.', displayOrder: 5 },
  { name: 'Literature & Poetry', slug: 'literature-poetry', description: 'Original poems, short stories, and literary analysis.', displayOrder: 6 },
  { name: 'Economics & Commerce', slug: 'economics-commerce', description: 'Microeconomics, finance, accounting, and business.', displayOrder: 7 },
  { name: 'History & Humanities', slug: 'history-humanities', description: 'World history, polity, sociology, and philosophy.', displayOrder: 8 },
  { name: 'Medicine & Biology', slug: 'medicine-biology', description: 'Anatomy, genetics, clinical notes, and life sciences.', displayOrder: 9 },
  { name: 'Research & Academic Writing', slug: 'research-writing', description: 'Research papers, theses, and scholarly essays.', displayOrder: 10 },
];

/**
 * Idempotently populates baseline settings, categories, and missing 10-digit user UIDs.
 */
export async function ensureBaselineCatalog(): Promise<void> {
  try {
    await db.insert(adminSettings).values(DEFAULT_SETTINGS).onConflictDoNothing();

    const [catCount] = await db.select({ value: count() }).from(categories);
    if (Number(catCount?.value || 0) === 0) {
      await db
        .insert(categories)
        .values(DEFAULT_CATEGORIES.map((c) => ({ ...c, isFeatured: true })))
        .onConflictDoNothing();
    }

    const backfilled = await backfillMissingPublicUids();
    if (backfilled > 0) {
      console.log(`Assigned 10-digit unique UID to ${backfilled} existing user(s).`);
    }
  } catch (err) {
    console.warn('Baseline catalog bootstrap skipped:', (err as Error).message);
  }
}
