import { openDatabaseSync } from 'expo-sqlite';

export const WIKI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const LIVE_DATA_CACHE_TTL_MS = 15 * 60 * 1000;  // 15 minutes

let dbInstance = null;

export const getCacheDb = (dbName = 'mtg_local_cache.db') => {
  if (!dbInstance) {
    dbInstance = openDatabaseSync(dbName);
    dbInstance.execSync(`
      CREATE TABLE IF NOT EXISTS local_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_local_cache_type ON local_cache(entity_type);
      CREATE INDEX IF NOT EXISTS idx_local_cache_expiry ON local_cache(cached_at, ttl_ms);
    `);
  }
  return dbInstance;
};

export const setCache = (key, value, entityType = 'general', customTtlMs = LIVE_DATA_CACHE_TTL_MS) => {
  const db = getCacheDb();
  const serialized = JSON.stringify(value);
  const now = Date.now();
  const ttl = customTtlMs ?? LIVE_DATA_CACHE_TTL_MS;

  db.runSync(
    `INSERT INTO local_cache (key, value, entity_type, cached_at, ttl_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       entity_type = excluded.entity_type,
       cached_at = excluded.cached_at,
       ttl_ms = excluded.ttl_ms`,
    [key, serialized, entityType, now, ttl]
  );

  return { key, cachedAt: now, ttlMs: ttl };
};

export const getCache = (key) => {
  const db = getCacheDb();
  const row = db.getFirstSync('SELECT * FROM local_cache WHERE key = ?', [key]);
  if (!row) {
    return null;
  }

  const now = Date.now();
  const isExpired = (now - Number(row.cached_at)) > Number(row.ttl_ms);
  if (isExpired) {
    return null; // TTL expired: strict cache miss
  }

  try {
    return {
      data: JSON.parse(row.value),
      cachedAt: Number(row.cached_at),
      ttlMs: Number(row.ttl_ms),
      isStale: false,
      hit: true
    };
  } catch {
    return null;
  }
};

export const getCacheWithStale = (key) => {
  const db = getCacheDb();
  const row = db.getFirstSync('SELECT * FROM local_cache WHERE key = ?', [key]);
  if (!row) {
    return null;
  }

  const now = Date.now();
  const isStale = (now - Number(row.cached_at)) > Number(row.ttl_ms);

  try {
    return {
      data: JSON.parse(row.value),
      cachedAt: Number(row.cached_at),
      ttlMs: Number(row.ttl_ms),
      isStale,
      hit: true
    };
  } catch {
    return null;
  }
};

// Convenience helpers
export const setCachedWikiPage = (pageId, pageData) => {
  return setCache(`wiki_page_${pageId}`, pageData, 'wiki', WIKI_CACHE_TTL_MS);
};

export const getCachedWikiPage = (pageId) => {
  return getCache(`wiki_page_${pageId}`);
};

export const setCachedProjectData = (projectId, projectData) => {
  return setCache(`project_${projectId}`, projectData, 'project', LIVE_DATA_CACHE_TTL_MS);
};

export const getCachedProjectData = (projectId) => {
  return getCache(`project_${projectId}`);
};

export const removeCache = (key) => {
  const db = getCacheDb();
  db.runSync('DELETE FROM local_cache WHERE key = ?', [key]);
};

export const clearExpiredCache = () => {
  const db = getCacheDb();
  const now = Date.now();
  const info = db.runSync('DELETE FROM local_cache WHERE (? - cached_at) > ttl_ms', [now]);
  return info.changes;
};

export const clearAllCache = () => {
  const db = getCacheDb();
  db.runSync('DELETE FROM local_cache');
};

export const resetCacheDb = () => {
  if (dbInstance) {
    try {
      dbInstance.closeSync();
    } catch {}
    dbInstance = null;
  }
};

export default {
  WIKI_CACHE_TTL_MS,
  LIVE_DATA_CACHE_TTL_MS,
  getCacheDb,
  setCache,
  getCache,
  getCacheWithStale,
  setCachedWikiPage,
  getCachedWikiPage,
  setCachedProjectData,
  getCachedProjectData,
  removeCache,
  clearExpiredCache,
  clearAllCache,
  resetCacheDb
};
