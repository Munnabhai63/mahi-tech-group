import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DARK_ACCENT } from '../theme/theme.js';

export const EmptyState = ({ title = 'No items found', description = 'Try adjusting your filters or create a new item', actionLabel, onAction }) => {
  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(Text, { style: styles.title }, title),
    React.createElement(Text, { style: styles.description }, description),
    actionLabel && onAction &&
      React.createElement(
        TouchableOpacity,
        { style: styles.button, onPress: onAction, activeOpacity: 0.8 },
        React.createElement(Text, { style: styles.buttonText }, actionLabel)
      )
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8
  },
  description: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16
  },
  button: {
    backgroundColor: DARK_ACCENT,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8
  },
  buttonText: {
    color: '#0f172a',
    fontWeight: '600',
    fontSize: 14
  }
});

export default EmptyState;
