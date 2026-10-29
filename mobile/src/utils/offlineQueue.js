import { secureStorage } from './cache.js';

const QUEUE_STORAGE_KEY = 'mtg_offline_queue';

export const getOfflineQueue = () => {
  return secureStorage.getObject(QUEUE_STORAGE_KEY) || [];
};

export const enqueueOfflineAction = (action) => {
  const queue = getOfflineQueue();
  const queueItem = {
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    ...action
  };
  queue.push(queueItem);
  secureStorage.setObject(QUEUE_STORAGE_KEY, queue);
  return queueItem;
};

export const clearOfflineQueue = () => {
  secureStorage.delete(QUEUE_STORAGE_KEY);
};

export default {
  getOfflineQueue,
  enqueueOfflineAction,
  clearOfflineQueue
};
