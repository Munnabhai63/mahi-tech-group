import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';

export const NotificationDetailScreen = () => {
  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(Text, { style: styles.header }, 'otification etail creen'),
    React.createElement(
      View,
      { style: styles.card },
      React.createElement(Text, { style: styles.cardTitle }, 'NotificationDetailScreen Active'),
      React.createElement(Text, { style: styles.cardSubtitle }, 'Mahi Tech Group Mobile Managed Workflow')
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND,
    padding: 16
  },
  header: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16
  },
  card: {
    backgroundColor: DARK_SURFACE,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardTitle: {
    color: DARK_ACCENT,
    fontSize: 16,
    fontWeight: '600'
  },
  cardSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4
  }
});

export default NotificationDetailScreen;
