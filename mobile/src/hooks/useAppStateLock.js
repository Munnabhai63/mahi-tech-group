import React from 'react';
const { useState, useEffect, useRef } = React;
import { AppState } from 'react-native';
import { config } from '../constants/config.js';
import { authenticateBiometric } from './useBiometric.js';
import { authApi } from '../api/auth.api.js';

export const DEFAULT_LOCK_THRESHOLD_MS = config.APP_LOCK_TIMEOUT_MS || 5 * 60 * 1000;

export const useAppStateLock = ({
  lockThresholdMs = DEFAULT_LOCK_THRESHOLD_MS,
  initialLocked = false,
  onRoleVerified = null,
  onSessionInvalid = null
} = {}) => {
  const [isLocked, setIsLocked] = useState(initialLocked);
  const [lastActiveTime, setLastActiveTime] = useState(Date.now());
  const backgroundTimeRef = useRef(null);
  const isLockedRef = useRef(initialLocked);

  const updateLockState = (val) => {
    isLockedRef.current = val;
    setIsLocked(val);
  };

  const verifyServerRoleOnForeground = async () => {
    try {
      const res = await authApi.getMe();
      if (res.data?.user && typeof onRoleVerified === 'function') {
        onRoleVerified(res.data.user);
      }
      return { verified: true, user: res.data?.user };
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        if (typeof onSessionInvalid === 'function') {
          onSessionInvalid(err);
        }
      }
      return { verified: false, error: err.message };
    }
  };

  const handleAppStateChange = async (nextAppState) => {
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      backgroundTimeRef.current = Date.now();
    } else if (nextAppState === 'active') {
      const bgTime = backgroundTimeRef.current;
      if (bgTime) {
        const elapsed = Date.now() - bgTime;
        if (elapsed >= lockThresholdMs) {
          updateLockState(true);
        }
        backgroundTimeRef.current = null;
      }
      setLastActiveTime(Date.now());
      // Re-verify server role from GET /api/users/me on every foreground resume
      await verifyServerRoleOnForeground();
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription?.remove?.();
    };
  }, [lockThresholdMs]);

  const unlock = async () => {
    const res = await authenticateBiometric('Unlock Mahi Tech Group Workspace');
    if (res.success) {
      updateLockState(false);
      backgroundTimeRef.current = null;
      setLastActiveTime(Date.now());
      return true;
    }
    return false;
  };

  const lockNow = () => {
    updateLockState(true);
  };

  return {
    get isLocked() {
      return isLockedRef.current;
    },
    unlock,
    lockNow,
    lastActiveTime,
    handleAppStateChange,
    verifyServerRoleOnForeground
  };
};

export default useAppStateLock;
