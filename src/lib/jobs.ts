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

// ===== BATCHED ASYNC VIEW COUNTER & EVENT FLUSHER =====
// Accumulates content view increments & timestamped view events in memory and flushes to PostgreSQL every 5s.
// Eliminates blocking row-level write locks on GET /api/catalog/contents/:slugOrId.
export interface QueuedViewEventMeta {
  userId?: number | null;
  visitorHash?: string | null;
  referrerSource?: string | null;
  referrerLabel?: string | null;
}

interface BufferedViewEvent {
  contentId: number;
  userId: number | null;
  visitorHash: string | null;
  referrerSource: string | null;
  referrerLabel: string | null;
  createdAt: Date;
}

const pendingViews = new Map<number, number>();
let pendingViewEvents: BufferedViewEvent[] = [];
const MAX_BUFFERED_VIEW_EVENTS = 2500;
let flushingViews = false;

export function queueContentView(contentId: number, meta?: QueuedViewEventMeta): void {
  if (!Number.isInteger(contentId) || contentId <= 0) return;
  pendingViews.set(contentId, (pendingViews.get(contentId) || 0) + 1);
  if (pendingViewEvents.length < MAX_BUFFERED_VIEW_EVENTS) {
    pendingViewEvents.push({
      contentId,
      userId: meta?.userId ?? null,
      visitorHash: meta?.visitorHash ?? null,
      referrerSource: meta?.referrerSource ?? null,
      referrerLabel: meta?.referrerLabel ?? null,
      createdAt: new Date(),
    });
  }
}

export async function flushPendingViews(): Promise<number> {
  if (flushingViews || (pendingViews.size === 0 && pendingViewEvents.length === 0)) return 0;
  flushingViews = true;

  const batch = Array.from(pendingViews.entries());
  pendingViews.clear();
  const eventBatch = pendingViewEvents;
  pendingViewEvents = [];

  try {
    if (batch.length > 0) {
      const valueTuples = batch.map(([id, inc]) => sql`(${id}::int, ${inc}::int)`);
      await db.execute(sql`
        UPDATE contents AS c
        SET views_count = c.views_count + v.inc
        FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, inc)
        WHERE c.id = v.id
      `);
    }
    if (eventBatch.length > 0) {
      const eventTuples = eventBatch.map(
        (ev) =>
          sql`(${ev.contentId}::int, ${ev.userId}::int, ${ev.visitorHash}::text, ${ev.referrerSource}::text, ${ev.referrerLabel}::text, ${ev.createdAt})`
      );
      await db.execute(sql`
        INSERT INTO content_view_events (content_id, user_id, visitor_hash, referrer_source, referrer_label, created_at)
        VALUES ${sql.join(eventTuples, sql`, `)}
      `);
    }
    return batch.length;
  } catch (err) {
    // Re-queue failed increments so view counts are not silently lost
    for (const [id, inc] of batch) {
      pendingViews.set(id, (pendingViews.get(id) || 0) + inc);
    }
    if (pendingViewEvents.length + eventBatch.length <= MAX_BUFFERED_VIEW_EVENTS) {
      pendingViewEvents.unshift(...eventBatch);
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
    pendingViewEvents: pendingViewEvents.length,
  };
}
