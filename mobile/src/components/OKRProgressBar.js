import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DARK_ACCENT } from '../theme/theme.js';
import { colors } from '../constants/colors.js';

export const OKRProgressBar = ({ progress = 0, target = 100, unit = '%' }) => {
  const percentage = Math.min(100, Math.max(0, (progress / (target || 100)) * 100));
  const progressColor = percentage >= 80 ? colors.success : percentage >= 50 ? DARK_ACCENT : colors.warning;

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      View,
      { style: styles.labelRow },
      React.createElement(Text, { style: styles.label }, 'Progress'),
      React.createElement(Text, { style: [styles.value, { color: progressColor }] }, `${Math.round(percentage)}${unit}`)
    ),
    React.createElement(
      View,
      { style: styles.track },
      React.createElement(View, {
        style: [
          styles.fill,
          {
            width: `${percentage}%`,
            backgroundColor: progressColor
          }
        ]
      })
    )
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 8
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4
  },
  label: {
    color: '#94a3b8',
    fontSize: 12
  },
  value: {
    fontSize: 12,
    fontWeight: '600'
  },
  track: {
    height: 8,
    backgroundColor: '#334155',
    borderRadius: 4,
    overflow: 'hidden'
  },
  fill: {
    height: '100%',
    borderRadius: 4
  }
});

export default OKRProgressBar;
