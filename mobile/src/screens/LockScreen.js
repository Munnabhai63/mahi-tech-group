import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';

export const LockScreen = ({ onUnlock, errorMessage }) => {
  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      View,
      { style: styles.card },
      React.createElement(Text, { style: styles.icon }, '🔒'),
      React.createElement(Text, { style: styles.title }, 'Workspace Locked'),
      React.createElement(
        Text,
        { style: styles.subtitle },
        'Authentication required to resume session'
      ),
      errorMessage && React.createElement(Text, { style: styles.errorText }, errorMessage),
      React.createElement(
        TouchableOpacity,
        {
          style: styles.unlockButton,
          activeOpacity: 0.8,
          onPress: onUnlock
        },
        React.createElement(Text, { style: styles.unlockButtonText }, 'Unlock with Biometrics')
      )
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  card: {
    backgroundColor: DARK_SURFACE,
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    width: '100%',
    maxWidth: 360
  },
  icon: {
    fontSize: 48,
    marginBottom: 16
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center'
  },
  unlockButton: {
    backgroundColor: DARK_ACCENT,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center'
  },
  unlockButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default LockScreen;
