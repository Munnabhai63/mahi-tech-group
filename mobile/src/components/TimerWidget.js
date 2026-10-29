import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { colors } from '../constants/colors.js';
import { formatDurationSeconds } from '../utils/dateHelpers.js';

export const TimerWidget = ({ isRunning = false, elapsedSeconds = 0, onToggle, taskTitle }) => {
  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      View,
      { style: styles.infoColumn },
      React.createElement(Text, { style: styles.timerText }, formatDurationSeconds(elapsedSeconds)),
      React.createElement(Text, { style: styles.taskText, numberOfLines: 1 }, taskTitle || 'No active task')
    ),
    React.createElement(
      TouchableOpacity,
      {
        style: [
          styles.button,
          { backgroundColor: isRunning ? colors.danger : DARK_ACCENT }
        ],
        activeOpacity: 0.8,
        onPress: onToggle
      },
      React.createElement(
        Text,
        { style: styles.buttonText },
        isRunning ? 'STOP' : 'START'
      )
    )
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#334155'
  },
  infoColumn: {
    flex: 1,
    marginRight: 12
  },
  timerText: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums']
  },
  taskText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2
  },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center'
  },
  buttonText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5
  }
});

export default TimerWidget;
