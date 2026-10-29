import { secureStorage } from './cache.js';
import apiClient from '../api/axios.config.js';

export const QUEUE_STORAGE_KEY = 'mtg_offline_queue';

export const ActionTypes = {
  TIMER_START: 'TIMER_START',
  TIMER_STOP: 'TIMER_STOP',
  TASK_STATUS_CHANGE: 'TASK_STATUS_CHANGE',
  OKR_CHECKIN: 'OKR_CHECKIN',
  EXPENSE_SUBMIT: 'EXPENSE_SUBMIT'
};

export const getOfflineQueue = () => {
  return secureStorage.getObject(QUEUE_STORAGE_KEY) || [];
};

export const saveOfflineQueue = (queue) => {
  secureStorage.setObject(QUEUE_STORAGE_KEY, queue);
};

export const enqueueOfflineAction = ({ type, payload = {}, metadata = {} }) => {
  const queue = getOfflineQueue();
  const queueItem = {
    id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    payload,
    metadata,
    enqueuedAt: new Date().toISOString(),
    seq: queue.length + 1
  };

  queue.push(queueItem);
  // Persisted into encrypted MMKV before ACK (crash-proof)
  saveOfflineQueue(queue);
  return queueItem;
};

export const peekOfflineAction = () => {
  const queue = getOfflineQueue();
  return queue.length > 0 ? queue[0] : null;
};

export const getOfflineQueueCount = () => {
  return getOfflineQueue().length;
};

export const clearOfflineQueue = () => {
  secureStorage.delete(QUEUE_STORAGE_KEY);
};

export const executeQueueAction = async (item, client = apiClient) => {
  const { type, payload } = item;
  switch (type) {
    case ActionTypes.TIMER_START:
      return client.post('/api/time/timer/start', payload);

    case ActionTypes.TIMER_STOP:
      return client.post('/api/time/timer/stop', payload);

    case ActionTypes.TASK_STATUS_CHANGE:
      return client.patch(`/api/backlog/item/${payload.itemId}/status`, {
        status: payload.status
      });

    case ActionTypes.OKR_CHECKIN:
      return client.post('/api/okr/checkin/submit', payload);

    case ActionTypes.EXPENSE_SUBMIT:
      return client.post('/api/finance/expense/submit', payload);

    default:
      if (item.endpoint && item.method) {
        const method = item.method.toLowerCase();
        return client[method](item.endpoint, payload);
      }
      throw new Error(`Unsupported action type: ${type}`);
  }
};

export const processOfflineQueue = async (clientOverride = null, options = {}) => {
  const { onConflict = null, onItemSuccess = null, onItemError = null } = options;
  const client = clientOverride || apiClient;
  const currentQueue = getOfflineQueue();

  if (currentQueue.length === 0) {
    return { processed: 0, conflicts: 0, remaining: 0, items: [] };
  }

  const processedList = [];
  const conflictList = [];

  while (currentQueue.length > 0) {
    const item = currentQueue[0]; // Strict FIFO order

    try {
      const response = await executeQueueAction(item, client);
      // Successfully processed: dequeue head and persist
      currentQueue.shift();
      saveOfflineQueue(currentQueue);
      processedList.push({ item, response: response?.data });
      if (typeof onItemSuccess === 'function') {
        onItemSuccess(item, response?.data);
      }
    } catch (err) {
      const statusCode = err.response?.status;
      // Conflict detection: 409 Conflict, 400 Bad Request, 422 Unprocessable, 404 Not Found
      if (statusCode && [400, 404, 409, 422].includes(statusCode)) {
        // SERVER WINS: silent local reconciliation
        currentQueue.shift();
        saveOfflineQueue(currentQueue);
        conflictList.push({
          item,
          status: statusCode,
          error: err.response?.data?.error || err.message
        });
        if (typeof onConflict === 'function') {
          onConflict(item, err);
        }
      } else {
        // Genuine network/connectivity failure (e.g. timeout, 503, connection dropped)
        // Halts sync to preserve remaining items safely in MMKV for next reconnection
        if (typeof onItemError === 'function') {
          onItemError(item, err);
        }
        break;
      }
    }
  }

  return {
    processed: processedList.length,
    conflicts: conflictList.length,
    remaining: currentQueue.length,
    processedList,
    conflictList
  };
};

export default {
  ActionTypes,
  getOfflineQueue,
  saveOfflineQueue,
  enqueueOfflineAction,
  peekOfflineAction,
  getOfflineQueueCount,
  clearOfflineQueue,
  executeQueueAction,
  processOfflineQueue
};
