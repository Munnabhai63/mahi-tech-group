import { getCacheWithStale, setCache, LIVE_DATA_CACHE_TTL_MS } from './sqliteCache.js';

export const swrFetch = async ({
  cacheKey,
  fetcher,
  entityType = 'general',
  ttlMs = LIVE_DATA_CACHE_TTL_MS,
  onFreshData = null
}) => {
  // 1. Immediate cache lookup (stale or fresh)
  const cached = getCacheWithStale(cacheKey);
  const hasCache = Boolean(cached && cached.data !== undefined);

  // Background promise that updates the cache and fires onFreshData
  const freshPromise = (async () => {
    try {
      const freshData = await fetcher();
      if (freshData !== undefined && freshData !== null) {
        setCache(cacheKey, freshData, entityType, ttlMs);
        if (typeof onFreshData === 'function') {
          onFreshData(freshData);
        }
      }
      return { data: freshData, isStale: false, error: null };
    } catch (err) {
      return { data: cached?.data ?? null, isStale: true, error: err };
    }
  })();

  if (hasCache) {
    // Return stale data INSTANTLY without awaiting network
    return {
      data: cached.data,
      isStale: cached.isStale,
      hit: true,
      cachedAt: cached.cachedAt,
      freshPromise
    };
  }

  // Cache miss: must await fresh network fetch
  const freshResult = await freshPromise;
  return {
    data: freshResult.data,
    isStale: false,
    hit: false,
    cachedAt: Date.now(),
    freshPromise
  };
};

export default {
  swrFetch
};
