import React from 'react';
const { useEffect } = React;
import { View, Text, StyleSheet } from 'react-native';
import { DARK_BACKGROUND, DARK_ACCENT } from '../theme/theme.js';
import { secureStorage } from '../utils/cache.js';
import { authApi } from '../api/auth.api.js';

export const SplashScreen = ({ onAuthenticated, onUnauthenticated }) => {
  useEffect(() => {
    let mounted = true;

    const bootstrapAuth = async () => {
      const storedToken = secureStorage.getString('auth_token');
      if (!storedToken) {
        if (mounted && typeof onUnauthenticated === 'function') {
          onUnauthenticated();
        }
        return;
      }

      try {
        // Auto-navigate based on stored token & verify role with server
        const res = await authApi.getMe();
        if (mounted && res.data?.user) {
          if (typeof onAuthenticated === 'function') {
            onAuthenticated(res.data.user);
          }
        } else {
          secureStorage.delete('auth_token');
          if (mounted && typeof onUnauthenticated === 'function') {
            onUnauthenticated();
          }
        }
      } catch (err) {
        secureStorage.delete('auth_token');
        if (mounted && typeof onUnauthenticated === 'function') {
          onUnauthenticated();
        }
      }
    };

    bootstrapAuth();

    return () => {
      mounted = false;
    };
  }, []);

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(Text, { style: styles.title }, 'MAHI TECH GROUP'),
    React.createElement(Text, { style: styles.subtitle }, 'Autonomous Operating Engine'),
    React.createElement(
      View,
      { style: styles.loadingContainer },
      React.createElement(Text, { style: styles.loadingText }, 'Verifying credentials...')
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  title: {
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 2
  },
  subtitle: {
    color: DARK_ACCENT,
    fontSize: 14,
    marginTop: 8,
    fontWeight: '500'
  },
  loadingContainer: {
    marginTop: 32
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13
  }
});

export default SplashScreen;
