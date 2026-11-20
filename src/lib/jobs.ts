import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';

type JobFn = () => Promise<void>;

interface QueuedJob {
  name: string;
  fn: JobFn;
}

const MAX_CONCURRENCY = 2;
const MAX_QUEUE_LENGTH = 200;
const queue: QueuedJob[] = [];
let activeJobs = 0;

function pumpQueue(): void {
  while (activeJobs < MAX_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    activeJobs += 1;
    // Defer to next tick so incoming HTTP requests always take priority
    setImmediate(async () => {
      try {
        await job.fn();
      } catch (err) {
        console.warn(`[bg-job:${job.name}] failed:`, (err as Error).message);
      } finally {
        activeJobs -= 1;
        pumpQueue();
      }
    });
  }
}

/**
 * Enqueues a non-blocking background job (e.g., thumbnail generation, cache refresh)
 * with bounded concurrency so the main HTTP event loop stays fast on 512MB/1vCPU hosts.
 */
export function enqueueBackgroundJob(name: string, fn: JobFn): boolean {
  if (queue.length >= MAX_QUEUE_LENGTH) {
    return false;
  }
  queue.push({ name, fn });
  pumpQueue();
  return true;
}

// ===== BATCHED ASYNC VIEW COUNTER FLUSHER =====
// Accumulates content view increments in memory and flushes to PostgreSQL in a single bulk UPDATE every 5s.
// Eliminates blocking row-level write locks on GET /api/catalog/contents/:slugOrId.
const pendingViews = new Map<number, number>();
let flushingViews = false;

export function queueContentView(contentId: number): void {
  if (!Number.isInteger(contentId) || contentId <= 0) return;
  pendingViews.set(contentId, (pendingViews.get(contentId) || 0) + 1);
}

export async function flushPendingViews(): Promise<number> {
  if (flushingViews || pendingViews.size === 0) return 0;
  flushingViews = true;

  const batch = Array.from(pendingViews.entries());
  pendingViews.clear();

  try {
    const valueTuples = batch.map(([id, inc]) => sql`(${id}::int, ${inc}::int)`);
    await db.execute(sql`
      UPDATE contents AS c
      SET views_count = c.views_count + v.inc
      FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, inc)
      WHERE c.id = v.id
    `);
    return batch.length;
  } catch (err) {
    // Re-queue failed increments so view counts are not silently lost
    for (const [id, inc] of batch) {
      pendingViews.set(id, (pendingViews.get(id) || 0) + inc);
    }
    console.warn('Batched view flush retry scheduled:', (err as Error).message);
    return 0;
  } finally {
    flushingViews = false;
  }
}

const viewFlushTimer = setInterval(() => {
  flushPendingViews().catch(() => {});
}, 5_000);
viewFlushTimer.unref?.();

export function getJobQueueStats() {
  return {
    activeJobs,
    queuedJobs: queue.length,
    pendingViewTargets: pendingViews.size,
  };
}
