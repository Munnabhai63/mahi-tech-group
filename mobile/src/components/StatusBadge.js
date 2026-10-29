import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../constants/colors.js';

const STATUS_COLORS = {
  ACTIVE: colors.success,
  COMPLETED: colors.primary,
  IN_PROGRESS: colors.warning,
  TODO: '#94a3b8',
  BLOCKED: colors.danger,
  DRAFT: '#64748b'
};

export const StatusBadge = ({ status = 'TODO', label }) => {
  const normalizedStatus = String(status).toUpperCase();
  const badgeColor = STATUS_COLORS[normalizedStatus] || colors.primary;

  return React.createElement(
    View,
    {
      style: [
        styles.badge,
        {
          borderColor: badgeColor,
          backgroundColor: `${badgeColor}22`
        }
      ]
    },
    React.createElement(
      Text,
      {
        style: [
          styles.text,
          { color: badgeColor }
        ]
      },
      label || normalizedStatus
    )
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start'
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5
  }
});

export default StatusBadge;
