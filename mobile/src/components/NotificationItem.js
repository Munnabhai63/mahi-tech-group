import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { formatDate } from '../utils/dateHelpers.js';

export const NotificationItem = ({ title, body, date, isRead = false, onPress }) => {
  return React.createElement(
    TouchableOpacity,
    {
      style: [
        styles.container,
        !isRead && styles.unreadContainer
      ],
      activeOpacity: 0.8,
      onPress
    },
    React.createElement(
      View,
      { style: styles.headerRow },
      React.createElement(Text, { style: styles.title }, title),
      !isRead && React.createElement(View, { style: styles.unreadDot })
    ),
    React.createElement(Text, { style: styles.body, numberOfLines: 2 }, body),
    date && React.createElement(Text, { style: styles.date }, formatDate(date))
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  unreadContainer: {
    borderColor: DARK_ACCENT
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  title: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    flex: 1
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: DARK_ACCENT,
    marginLeft: 8
  },
  body: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18
  },
  date: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 6
  }
});

export default NotificationItem;
