import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DARK_ACCENT } from '../theme/theme.js';
import { colors } from '../constants/colors.js';

export const ErrorState = ({ message = 'Something went wrong', onRetry }) => {
  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(Text, { style: styles.icon }, '⚠️'),
    React.createElement(Text, { style: styles.message }, message),
    onRetry &&
      React.createElement(
        TouchableOpacity,
        { style: styles.button, onPress: onRetry, activeOpacity: 0.8 },
        React.createElement(Text, { style: styles.buttonText }, 'Retry')
      )
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center'
  },
  icon: {
    fontSize: 32,
    marginBottom: 8
  },
  message: {
    color: colors.danger,
    fontSize: 15,
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

export default ErrorState;
