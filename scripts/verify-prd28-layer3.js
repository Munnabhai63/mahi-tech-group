/**
 * scripts/verify-prd28-layer3.js
 * 
 * Comprehensive Layer 3 Verification Suite:
 * - Offline queue persists item when network is down
 * - Queue processes sequentially on reconnect (real order confirmed)
 * - Cache returns stale data instantly, then updates (SWR)
 * - SQLite wiki cache hit confirmed within 24hr TTL
 * - Cache miss after TTL expiry confirmed
 * - Crash recovery: queue intact after simulated restart
 * - Conflict resolution: server wins, local state reconciled
 */

import http from 'node:http';
import { createApp } from '../src/app.js';
import { config as mobileConfig } from '../mobile/src/constants/config.js';
import { secureStorage } from '../mobile/src/utils/cache.js';
import {
  ActionTypes,
  getOfflineQueue,
  enqueueOfflineAction,
  processOfflineQueue,
  clearOfflineQueue,
  getOfflineQueueCount,
  saveOfflineQueue
} from '../mobile/src/utils/offlineQueue.js';
import {
  getCacheDb,
  setCache,
  getCache,
  getCacheWithStale,
  setCachedWikiPage,
  getCachedWikiPage,
  clearAllCache,
  WIKI_CACHE_TTL_MS,
  LIVE_DATA_CACHE_TTL_MS
} from '../mobile/src/utils/sqliteCache.js';
import { swrFetch } from '../mobile/src/utils/swr.js';
import { __mockNetworkState } from '../mobile/node_modules/@react-native-community/netinfo/index.js';

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✖ FAIL: ${message}`);
    failedTests++;
  }
}

async function runLayer3Verification() {
  console.log('\n===================================================================');
  console.log('       PRD 28 LAYER 3: OFFLINE CACHE & SYNC QUEUE VERIFICATION');
  console.log('===================================================================\n');

  // Clear queues & cache prior to testing
  clearOfflineQueue();
  clearAllCache();

  // -----------------------------------------------------------------
  // TEST SECTION 1: Offline Queue Persistence When Network is Down
  // -----------------------------------------------------------------
  console.log('--- 1. Offline Queue Persistence When Network is Down ---');
  __mockNetworkState.setConnected(false);

  assert(getOfflineQueueCount() === 0, 'Offline queue is clean at start');

  const action1 = enqueueOfflineAction({
    type: ActionTypes.TIMER_START,
    payload: { projectId: 'proj-alpha', taskId: 'task-101', description: 'Building offline engine' }
  });

  const action2 = enqueueOfflineAction({
    type: ActionTypes.TASK_STATUS_CHANGE,
    payload: { itemId: 'task-102', status: 'IN_PROGRESS' }
  });

  const action3 = enqueueOfflineAction({
    type: ActionTypes.OKR_CHECKIN,
    payload: { krId: 'kr-201', currentValue: 80, confidence: 0.95, note: 'Offline progress recorded' }
  });

  const action4 = enqueueOfflineAction({
    type: ActionTypes.EXPENSE_SUBMIT,
    payload: { projectId: 'proj-alpha', category: 'OFFICE', title: 'Ergonomic mouse', amount: 1500, billable: false }
  });

  assert(getOfflineQueueCount() === 4, '4 offline actions successfully enqueued while disconnected');

  const storedQueue = secureStorage.getObject('mtg_offline_queue');
  assert(Array.isArray(storedQueue) && storedQueue.length === 4, 'Queue persisted in encrypted MMKV storage');
  assert(storedQueue[0].type === ActionTypes.TIMER_START, '1st item in MMKV is TIMER_START');
  assert(storedQueue[1].type === ActionTypes.TASK_STATUS_CHANGE, '2nd item in MMKV is TASK_STATUS_CHANGE');
  assert(storedQueue[2].type === ActionTypes.OKR_CHECKIN, '3rd item in MMKV is OKR_CHECKIN');
  assert(storedQueue[3].type === ActionTypes.EXPENSE_SUBMIT, '4th item in MMKV is EXPENSE_SUBMIT');
  assert(Boolean(storedQueue[0].enqueuedAt && storedQueue[0].id), 'Queue items contain unique id and ISO timestamp');
  assert(secureStorage.isEncrypted(), 'Encrypted MMKV partition active for queued actions (zero plaintext)');

  // -----------------------------------------------------------------
  // TEST SECTION 2: Sequential FIFO Processing on Reconnect (Real Order)
  // -----------------------------------------------------------------
  console.log('\n--- 2. Sequential FIFO Processing on Reconnect (Real Order) ---');

  const executionLog = [];
  const mockSyncClient = {
    post: async (url, data) => {
      executionLog.push({ method: 'POST', url, data, time: Date.now() });
      await new Promise((r) => setTimeout(r, 10)); // simulate slight network latency
      return { status: 200, data: { success: true, url } };
    },
    patch: async (url, data) => {
      executionLog.push({ method: 'PATCH', url, data, time: Date.now() });
      await new Promise((r) => setTimeout(r, 10));
      return { status: 200, data: { success: true, url } };
    }
  };

  // Reconnect
  __mockNetworkState.setConnected(true);

  const syncResult = await processOfflineQueue(mockSyncClient);

  assert(syncResult.processed === 4, 'All 4 offline actions processed successfully');
  assert(syncResult.remaining === 0, 'Offline queue emptied after full sync');
  assert(getOfflineQueueCount() === 0, 'getOfflineQueueCount() reports 0 after sync');

  // Verify exact FIFO order
  assert(executionLog.length === 4, 'Exactly 4 API calls dispatched during sync');
  assert(executionLog[0].url === '/api/time/timer/start', 'Order 1: POST /api/time/timer/start executed first');
  assert(executionLog[1].url === '/api/backlog/item/task-102/status', 'Order 2: PATCH /api/backlog/item/task-102/status executed second');
  assert(executionLog[2].url === '/api/okr/checkin/submit', 'Order 3: POST /api/okr/checkin/submit executed third');
  assert(executionLog[3].url === '/api/finance/expense/submit', 'Order 4: POST /api/finance/expense/submit executed fourth');

  // -----------------------------------------------------------------
  // TEST SECTION 2B: Conflict Resolution (Server Wins)
  // -----------------------------------------------------------------
  console.log('\n--- 2B. Conflict Resolution (Server Wins) ---');
  enqueueOfflineAction({
    type: ActionTypes.TASK_STATUS_CHANGE,
    payload: { itemId: 'conflicted-task', status: 'DONE' }
  });
  enqueueOfflineAction({
    type: ActionTypes.TIMER_START,
    payload: { projectId: 'p1', taskId: 't1' }
  });

  let conflictCaught = false;
  const mockConflictClient = {
    patch: async () => {
      const err = new Error('Task was deleted or locked on server');
      err.response = { status: 409, data: { error: 'Conflict: Task locked on server' } };
      throw err;
    },
    post: async () => {
      return { status: 200, data: { success: true } };
    }
  };

  const conflictSyncResult = await processOfflineQueue(mockConflictClient, {
    onConflict: (item, err) => {
      conflictCaught = true;
    }
  });

  assert(conflictCaught === true, 'onConflict callback invoked when server rejects conflicted action');
  assert(conflictSyncResult.conflicts === 1, 'Conflict recorded in sync result');
  assert(conflictSyncResult.processed === 1, 'Subsequent non-conflicting action processed successfully without being blocked');
  assert(getOfflineQueueCount() === 0, 'Conflicted action removed from queue (server wins, local state reconciled)');

  // -----------------------------------------------------------------
  // TEST SECTION 3: Stale-While-Revalidate (Instant Return + Fresh Update)
  // -----------------------------------------------------------------
  console.log('\n--- 3. Stale-While-Revalidate (SWR) Verification ---');

  // Pre-seed SQLite cache with initial stale data
  const testCacheKey = 'project_summary_demo';
  setCache(testCacheKey, { name: 'Alpha Project', version: 1 }, 'project', 100); // 100ms TTL

  // Wait 120ms to make it definitely stale
  await new Promise((r) => setTimeout(r, 120));

  let freshCallbackReceived = null;
  const swrResult = await swrFetch({
    cacheKey: testCacheKey,
    fetcher: async () => {
      await new Promise((r) => setTimeout(r, 30)); // background network delay
      return { name: 'Alpha Project', version: 2 };
    },
    onFreshData: (fresh) => {
      freshCallbackReceived = fresh;
    }
  });

  assert(swrResult.hit === true, 'SWR cache hit confirmed');
  assert(swrResult.isStale === true, 'SWR detects data is stale');
  assert(swrResult.data.version === 1, 'Stale data (version 1) served INSTANTLY without blocking');

  // Wait for background fresh promise to complete
  await swrResult.freshPromise;

  assert(freshCallbackReceived?.version === 2, 'onFreshData callback invoked with fresh data (version 2)');
  const updatedCache = getCache(testCacheKey);
  assert(updatedCache?.data?.version === 2, 'SQLite cache updated with fresh data (version 2)');
  assert(updatedCache?.isStale === false, 'Updated cache is fresh');

  // -----------------------------------------------------------------
  // TEST SECTION 4: SQLite Wiki Cache Hit Confirmed Within 24hr TTL
  // -----------------------------------------------------------------
  console.log('\n--- 4. SQLite Wiki Cache Hit Confirmed Within 24hr TTL ---');

  const wikiPageId = 'wiki-architecture-specs';
  const wikiPageData = {
    id: wikiPageId,
    title: 'Offline Architecture Guide',
    space: 'Engineering',
    content: '# Offline Cache & Sync Queue\nFull specifications for PRD 28.'
  };

  const storedWiki = setCachedWikiPage(wikiPageId, wikiPageData);
  assert(storedWiki.ttlMs === WIKI_CACHE_TTL_MS, `Wiki page cached with 24hr TTL (${WIKI_CACHE_TTL_MS} ms)`);

  const retrievedWiki = getCachedWikiPage(wikiPageId);
  assert(retrievedWiki !== null, 'Wiki cache hit confirmed within TTL');
  assert(retrievedWiki?.data?.title === 'Offline Architecture Guide', 'Cached wiki title matches accurately');
  assert(retrievedWiki?.data?.space === 'Engineering', 'Cached wiki space matches accurately');
  assert(retrievedWiki?.isStale === false, 'Cached wiki page is fresh within 24hr window');

  // -----------------------------------------------------------------
  // TEST SECTION 5: Cache Miss After TTL Expiry Confirmed
  // -----------------------------------------------------------------
  console.log('\n--- 5. Cache Miss After TTL Expiry Confirmed ---');

  const fastExpiryKey = 'fast_expiring_live_entry';
  const shortTtlMs = 60; // 60ms TTL

  setCache(fastExpiryKey, { status: 'LIVE_DATA_SNIPPET' }, 'live', shortTtlMs);

  // Immediate fetch within TTL
  const immediateHit = getCache(fastExpiryKey);
  assert(immediateHit !== null && immediateHit.hit === true, 'Immediate fetch within TTL returns cache hit');

  // Sleep past TTL
  await new Promise((r) => setTimeout(r, 80));

  // Query after expiry
  const expiredMiss = getCache(fastExpiryKey);
  assert(expiredMiss === null, 'Query after TTL expiry returns strict null (cache miss confirmed)');

  const staleProbe = getCacheWithStale(fastExpiryKey);
  assert(staleProbe !== null && staleProbe.isStale === true, 'getCacheWithStale reports isStale: true after TTL elapsed');

  // -----------------------------------------------------------------
  // TEST SECTION 6: Crash Recovery (Queue Intact After Simulated Restart)
  // -----------------------------------------------------------------
  console.log('\n--- 6. Crash Recovery (Queue Intact After Simulated Restart) ---');

  clearOfflineQueue();

  enqueueOfflineAction({
    type: ActionTypes.TIMER_START,
    payload: { taskId: 'task-crash-test', notes: 'Pre-crash timer' }
  });
  enqueueOfflineAction({
    type: ActionTypes.EXPENSE_SUBMIT,
    payload: { title: 'Emergency server rack purchase', amount: 84000 }
  });

  const countBeforeCrash = getOfflineQueueCount();
  assert(countBeforeCrash === 2, '2 items in queue before simulated crash');

  // Simulate app termination / process restart
  // In a simulated restart, memory variables are lost but encrypted MMKV and SQLite persist
  const { MMKV } = await import('../mobile/node_modules/react-native-mmkv/index.js');
  const restoredInstance = new MMKV({ id: 'mtg-encrypted-storage', encryptionKey: 'mtg-sec-key-32-bytes-auth-token-salt' });

  const restoredRawJson = restoredInstance.getString('mtg_offline_queue');
  assert(Boolean(restoredRawJson), 'Encrypted MMKV data survives simulated crash / restart');

  const restoredQueue = JSON.parse(restoredRawJson);
  assert(Array.isArray(restoredQueue) && restoredQueue.length === 2, 'Restored queue has exactly 2 items');
  assert(restoredQueue[0].type === ActionTypes.TIMER_START, 'Item 1 survived crash in exact FIFO position');
  assert(restoredQueue[0].payload.taskId === 'task-crash-test', 'Item 1 payload data intact');
  assert(restoredQueue[1].type === ActionTypes.EXPENSE_SUBMIT, 'Item 2 survived crash in exact FIFO position');
  assert(restoredQueue[1].payload.amount === 84000, 'Item 2 payload data intact');

  // -----------------------------------------------------------------
  // Summary & Exit
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log(`PRD 28 LAYER 3 SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('===================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer3Verification().catch((err) => {
  console.error('Fatal Layer 3 verification error:', err);
  process.exit(1);
});
