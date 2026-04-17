/**
 * In-memory cache for expensive analytics queries.
 *
 * Admin analytics dashboard issues 30+ parallel DB queries on every page load.
 * This cache memoizes results for a configurable TTL (default 5 min) to prevent
 * database overload when admins refresh the page frequently.
 *
 * Cache is bypassed when `?nocache=1` query param is set, allowing forced refresh.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class AnalyticsCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ENTRIES = 200;

  /**
   * Get cached value or execute factory and cache the result.
   */
  async memoize<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs: number = this.DEFAULT_TTL_MS,
    bypass: boolean = false,
  ): Promise<T> {
    if (!bypass) {
      const entry = this.store.get(key);
      if (entry && entry.expiresAt > Date.now()) {
        return entry.value as T;
      }
    }

    const value = await factory();

    // Enforce max size — evict oldest entries if cache grows too large
    if (this.store.size >= this.MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });

    return value;
  }

  /** Clear the entire cache (e.g. on admin action). */
  clear(): void {
    this.store.clear();
  }

  /** Clear entries matching a prefix. */
  clearByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Stats for monitoring. */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()).slice(0, 20),
    };
  }
}

export const analyticsCache = new AnalyticsCache();
