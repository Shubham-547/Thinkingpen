interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_CACHE_ENTRIES = 600;
const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function evictIfNeeded(): void {
  if (store.size < MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  // First prune expired entries
  for (const [k, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(k);
  }
  // If still full, evict oldest 15% (Map preserves insertion order)
  if (store.size >= MAX_CACHE_ENTRIES) {
    const targetDrop = Math.max(20, Math.floor(MAX_CACHE_ENTRIES * 0.15));
    let dropped = 0;
    for (const k of store.keys()) {
      store.delete(k);
      dropped += 1;
      if (dropped >= targetDrop) break;
    }
  }
}

export function getCache<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs: number): void {
  evictIfNeeded();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Single-flight cache helper: coalesces concurrent identical requests into ONE computation,
 * eliminating thundering-herd DB storms when cache entries expire under load.
 */
export async function getOrCompute<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>
): Promise<T> {
  const cached = getCache<T>(key);
  if (cached !== null) return cached;

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = compute()
    .then((result) => {
      if (ttlMs > 0) setCache(key, result, ttlMs);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

export function invalidateCatalogCache(): void {
  invalidateCache('catalog:');
}

export function getCacheStats() {
  return {
    entries: store.size,
    maxEntries: MAX_CACHE_ENTRIES,
    inflightCount: inflight.size,
  };
}
