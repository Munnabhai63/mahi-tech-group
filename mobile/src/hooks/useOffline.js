import React from 'react';
const { useState, useEffect, useRef } = React;
import { addEventListener, fetch as fetchNetInfo } from '@react-native-community/netinfo';
import {
  getOfflineQueue,
  getOfflineQueueCount,
  enqueueOfflineAction,
  processOfflineQueue,
  clearOfflineQueue,
  ActionTypes
} from '../utils/offlineQueue.js';
import { getCacheWithStale, setCache } from '../utils/sqliteCache.js';

export const useOffline = ({
  autoSyncOnReconnect = true,
  onSyncComplete = null,
  onConflict = null
} = {}) => {
  const [isConnected, setIsConnected] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [queueCount, setQueueCount] = useState(getOfflineQueueCount());
  const [lastSyncResult, setLastSyncResult] = useState(null);

  const isConnectedRef = useRef(true);
  const isSyncingRef = useRef(false);
  const queueCountRef = useRef(getOfflineQueueCount());

  const updateQueueCount = () => {
    const count = getOfflineQueueCount();
    queueCountRef.current = count;
    setQueueCount(count);
    return count;
  };

  const sync = async (clientOverride = null) => {
    if (isSyncingRef.current || queueCountRef.current === 0) {
      return { processed: 0, conflicts: 0, remaining: queueCountRef.current };
    }

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      const result = await processOfflineQueue(clientOverride, {
        onConflict: (item, err) => {
          if (typeof onConflict === 'function') {
            onConflict(item, err);
          }
        }
      });

      updateQueueCount();
      setLastSyncResult(result);
      if (typeof onSyncComplete === 'function') {
        onSyncComplete(result);
      }
      return result;
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  };

  const enqueue = (type, payload = {}, metadata = {}) => {
    const item = enqueueOfflineAction({ type, payload, metadata });
    updateQueueCount();
    return item;
  };

  useEffect(() => {
    // Initial connectivity check
    fetchNetInfo().then((state) => {
      const connected = Boolean(state?.isConnected);
      isConnectedRef.current = connected;
      setIsConnected(connected);
    });

    // Subscribe to network transitions
    const unsubscribe = addEventListener(async (state) => {
      const previouslyConnected = isConnectedRef.current;
      const nowConnected = Boolean(state?.isConnected);
      isConnectedRef.current = nowConnected;
      setIsConnected(nowConnected);

      // On Reconnection: false -> true
      if (!previouslyConnected && nowConnected && autoSyncOnReconnect) {
        if (getOfflineQueueCount() > 0) {
          await sync();
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [autoSyncOnReconnect]);

  return {
    get isConnected() {
      return isConnectedRef.current;
    },
    get isSyncing() {
      return isSyncingRef.current;
    },
    get queueCount() {
      return queueCountRef.current;
    },
    lastSyncResult,
    enqueue,
    sync,
    clearQueue: () => {
      clearOfflineQueue();
      updateQueueCount();
    },
    getQueue: getOfflineQueue,
    ActionTypes,
    // SQLite cache accessors
    getCachedData: (key) => getCacheWithStale(key)?.data ?? null,
    setCachedData: (key, data, entityType, ttlMs) => setCache(key, data, entityType, ttlMs)
  };
};

export default useOffline;
