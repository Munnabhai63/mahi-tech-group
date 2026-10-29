import React from 'react';
const { useState } = React;
import { secureStorage } from '../utils/cache.js';

export const useOffline = () => {
  const [isConnected, setIsConnected] = useState(true);
  const [queueCount, setQueueCount] = useState(0);

  const getCachedData = (key) => secureStorage.getObject(`cache_${key}`);
  const setCachedData = (key, data) => secureStorage.setObject(`cache_${key}`, data);

  return {
    isConnected,
    setIsConnected,
    queueCount,
    setQueueCount,
    getCachedData,
    setCachedData
  };
};

export default useOffline;
