import React from 'react';
const { useState, useEffect, useRef, useCallback } = React;
import { getCacheWithStale, setCache, LIVE_DATA_CACHE_TTL_MS } from '../utils/sqliteCache.js';

export const useStaleWhileRevalidate = ({
  cacheKey,
  fetcher,
  entityType = 'general',
  ttlMs = LIVE_DATA_CACHE_TTL_MS,
  initialData = null,
  enabled = true
}) => {
  // Synchronous cache read for instant render
  const cached = cacheKey ? getCacheWithStale(cacheKey) : null;
  const initialValue = cached ? cached.data : initialData;
  const initialStale = cached ? cached.isStale : false;

  const [data, setData] = useState(initialValue);
  const [isStale, setIsStale] = useState(initialStale);
  const [loading, setLoading] = useState(!cached && enabled);
  const [error, setError] = useState(null);

  const dataRef = useRef(initialValue);
  const isStaleRef = useRef(initialStale);

  const updateState = (newData, newStale, newLoading, newError = null) => {
    dataRef.current = newData;
    isStaleRef.current = newStale;
    setData(newData);
    setIsStale(newStale);
    setLoading(newLoading);
    setError(newError);
  };

  const revalidate = useCallback(async () => {
    if (!fetcher) return;
    try {
      const fresh = await fetcher();
      if (fresh !== undefined && fresh !== null) {
        if (cacheKey) {
          setCache(cacheKey, fresh, entityType, ttlMs);
        }
        updateState(fresh, false, false, null);
      }
      return fresh;
    } catch (err) {
      // Keep cached data on network error
      updateState(dataRef.current, true, false, err);
      return dataRef.current;
    }
  }, [cacheKey, fetcher, entityType, ttlMs]);

  useEffect(() => {
    if (!enabled || !cacheKey) return;

    // 1. Immediately check cache
    const currentCached = getCacheWithStale(cacheKey);
    if (currentCached) {
      updateState(currentCached.data, currentCached.isStale, false, null);
    } else {
      setLoading(true);
    }

    // 2. Background revalidation
    revalidate();
  }, [cacheKey, enabled, revalidate]);

  return {
    get data() {
      return dataRef.current;
    },
    get isStale() {
      return isStaleRef.current;
    },
    loading,
    error,
    revalidate,
    mutate: (optimisticData) => updateState(optimisticData, false, false, null)
  };
};

export default useStaleWhileRevalidate;
