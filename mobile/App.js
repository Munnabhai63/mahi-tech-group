import React, { useState } from 'react';
import { AppNavigator } from './src/navigation/AppNavigator.js';
import { LockScreen } from './src/screens/LockScreen.js';
import { useAppStateLock } from './src/hooks/useAppStateLock.js';
import { secureStorage } from './src/utils/cache.js';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return Boolean(secureStorage.getString('auth_token'));
  });

  const { isLocked, unlock, lockNow } = useAppStateLock({
    initialLocked: false,
    onRoleVerified: (user) => {
      // User verified by GET /api/users/me
    },
    onSessionInvalid: () => {
      secureStorage.delete('auth_token');
      secureStorage.delete('user_data');
      setIsAuthenticated(false);
    }
  });

  if (isAuthenticated && isLocked) {
    return React.createElement(LockScreen, {
      onUnlock: unlock
    });
  }

  return React.createElement(AppNavigator, {
    isAuthenticated,
    onAuthSuccess: () => setIsAuthenticated(true),
    onLogout: () => setIsAuthenticated(false)
  });
}
