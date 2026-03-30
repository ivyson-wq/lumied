// ═══════════════════════════════════════════════════════════════
//  Shared: In-Memory Response Cache with TTL
// ═══════════════════════════════════════════════════════════════

type CacheEntry = {
  data: unknown;
  expires: number;
};

const store = new Map<string, CacheEntry>();

// Cleanup every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expires) store.delete(key);
  }
}, 120000);

/**
 * Get from cache. Returns null if not found or expired.
 */
export function cacheGet(key: string): unknown | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Set cache entry with TTL in milliseconds.
 */
export function cacheSet(key: string, data: unknown, ttlMs: number = 30000): void {
  store.set(key, { data, expires: Date.now() + ttlMs });
}

/**
 * Invalidate cache entries matching a prefix.
 */
export function cacheInvalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Clear all cache.
 */
export function cacheClear(): void {
  store.clear();
}

/**
 * Cache stats for monitoring.
 */
export function cacheStats(): { size: number; keys: string[] } {
  return { size: store.size, keys: [...store.keys()] };
}

/**
 * Middleware-style cache wrapper for handlers.
 * Caches the result of read-only actions.
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = cacheGet(key);
  if (cached !== null) return cached as T;
  const result = await fn();
  cacheSet(key, result, ttlMs);
  return result;
}
