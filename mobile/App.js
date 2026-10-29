import React from 'react';
const { useState } = React;
import { View, StyleSheet } from 'react-native';
import { AppNavigator } from './src/navigation/AppNavigator.js';
import { LockScreen } from './src/screens/LockScreen.js';
import { OfflineBanner } from './src/components/OfflineBanner.js';
import { useAppStateLock } from './src/hooks/useAppStateLock.js';
import { useOffline } from './src/hooks/useOffline.js';
import { secureStorage } from './src/utils/cache.js';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return Boolean(secureStorage.getString('auth_token'));
  });

  const { isConnected, isSyncing, queueCount } = useOffline();

  const { isLocked, unlock, lockNow } = useAppStateLock({
    initialLocked: false,
    onRoleVerified: (user) => {
      // User role verified by GET /api/users/me
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

  const navigatorElement = React.createElement(AppNavigator, {
    isAuthenticated,
    onAuthSuccess: () => setIsAuthenticated(true),
    onLogout: () => setIsAuthenticated(false)
  });

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(OfflineBanner, {
      isConnected,
      queueCount: isSyncing ? queueCount : (!isConnected ? queueCount : 0)
    }),
    navigatorElement
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
});
