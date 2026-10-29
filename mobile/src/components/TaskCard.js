import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { StatusBadge } from './StatusBadge.js';

const TaskCardComponent = ({ title, status, storyPoints, assignee, onPress }) => {
  return React.createElement(
    TouchableOpacity,
    {
      style: styles.card,
      activeOpacity: 0.8,
      onPress
    },
    React.createElement(
      View,
      { style: styles.headerRow },
      React.createElement(Text, { style: styles.title, numberOfLines: 2 }, title),
      React.createElement(StatusBadge, { status })
    ),
    React.createElement(
      View,
      { style: styles.footerRow },
      React.createElement(Text, { style: styles.assignee }, assignee || 'Unassigned'),
      storyPoints !== undefined &&
        React.createElement(Text, { style: styles.points }, `${storyPoints} pts`)
    )
  );
};

export const TaskCard = React.memo ? React.memo(TaskCardComponent) : TaskCardComponent;

const styles = StyleSheet.create({
  card: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  title: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6
  },
  assignee: {
    color: '#94a3b8',
    fontSize: 12
  },
  points: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '600'
  }
});

export default TaskCard;
