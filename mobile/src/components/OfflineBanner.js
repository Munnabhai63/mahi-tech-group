import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../constants/colors.js';

export const OfflineBanner = ({ isConnected = false, queueCount = 0 }) => {
  if (isConnected && queueCount === 0) return null;

  const message = !isConnected
    ? 'Offline Mode — Changes will sync when connected'
    : `Syncing ${queueCount} offline change${queueCount > 1 ? 's' : ''}...`;

  return React.createElement(
    View,
    {
      style: [
        styles.banner,
        { backgroundColor: !isConnected ? colors.warning : colors.primaryDark }
      ]
    },
    React.createElement(Text, { style: styles.text }, message)
  );
};

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  text: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '600'
  }
});

export default OfflineBanner;
