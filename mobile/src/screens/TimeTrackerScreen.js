import React from 'react';
const { useState, useEffect, useCallback } = React;
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { TimerWidget } from '../components/TimerWidget.js';
import { TaskCardSkeleton } from '../components/SkeletonLoader.js';
import { EmptyState } from '../components/EmptyState.js';
import { formatDurationSeconds } from '../utils/dateHelpers.js';
import { useTimer } from '../hooks/useTimer.js';
import { timeApi } from '../api/time.api.js';

export const TimeTrackerScreen = ({
  initialEntries = null,
  onManualEntryPress = null
}) => {
  const [entries, setEntries] = useState(initialEntries || []);
  const [loading, setLoading] = useState(!initialEntries);
  const [refreshing, setRefreshing] = useState(false);

  const { isRunning, elapsedSeconds, activeTask, start, stop } = useTimer();

  const loadEntries = useCallback(async () => {
    try {
      const res = await timeApi.getMyEntries();
      setEntries(res.data?.entries || res.data || []);
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initialEntries) {
      loadEntries();
    }
  }, [initialEntries, loadEntries]);

  const totalLoggedSeconds = entries.reduce((acc, curr) => acc + (curr.duration_seconds || 0), 0);

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      View,
      { style: styles.headerRow },
      React.createElement(Text, { style: styles.header }, 'Time Tracker'),
      React.createElement(
        TouchableOpacity,
        {
          style: styles.manualButton,
          onPress: onManualEntryPress
        },
        React.createElement(Text, { style: styles.manualButtonText }, '+ Manual Entry')
      )
    ),

    // Global Active Timer Widget
    React.createElement(
      View,
      { style: styles.timerSection },
      React.createElement(TimerWidget, {
        isRunning,
        elapsedSeconds,
        taskTitle: activeTask,
        onToggle: () => {
          if (isRunning) {
            stop();
          } else {
            start({
              projectId: 'proj-default',
              taskId: 'timer-active',
              taskTitle: 'Project Focus Session'
            });
          }
        }
      })
    ),

    // Daily Summary Stats
    React.createElement(
      View,
      { style: styles.summaryRow },
      React.createElement(
        View,
        { style: styles.summaryBox },
        React.createElement(Text, { style: styles.summaryLabel }, "Today's Logged"),
        React.createElement(Text, { style: styles.summaryValue }, formatDurationSeconds(totalLoggedSeconds))
      ),
      React.createElement(
        View,
        { style: styles.summaryBox },
        React.createElement(Text, { style: styles.summaryLabel }, 'Total Entries'),
        React.createElement(Text, { style: styles.summaryValue }, String(entries.length))
      )
    ),

    // Logged Entries Header
    React.createElement(Text, { style: styles.subHeader }, "Today's Time Entries"),

    loading
      ? React.createElement(
          View,
          null,
          React.createElement(TaskCardSkeleton),
          React.createElement(TaskCardSkeleton)
        )
      : entries.length === 0
      ? React.createElement(EmptyState, {
          title: 'No Time Logged Today',
          message: 'Start the timer above or add a manual entry to track your hours.'
        })
      : React.createElement(FlatList, {
          data: entries,
          keyExtractor: (item) => String(item.id || item.created_at),
          refreshControl: React.createElement(RefreshControl, {
            refreshing,
            onRefresh: loadEntries,
            tintColor: DARK_ACCENT
          }),
          renderItem: ({ item }) =>
            React.createElement(
              View,
              { style: styles.entryCard },
              React.createElement(
                View,
                { style: styles.entryInfo },
                React.createElement(Text, { style: styles.entryDescription }, item.description || 'Sprint Task Work'),
                React.createElement(Text, { style: styles.entryProject }, item.project_name || 'Mahi Tech Project')
              ),
              React.createElement(
                Text,
                { style: styles.entryDuration },
                formatDurationSeconds(item.duration_seconds || 3600)
              )
            )
        })
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND,
    padding: 16
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  header: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700'
  },
  manualButton: {
    backgroundColor: '#334155',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6
  },
  manualButtonText: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '700'
  },
  timerSection: {
    marginBottom: 16
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  summaryBox: {
    flex: 1,
    backgroundColor: DARK_SURFACE,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#334155'
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 11
  },
  summaryValue: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4
  },
  subHeader: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10
  },
  entryCard: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  entryInfo: {
    flex: 1,
    marginRight: 8
  },
  entryDescription: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600'
  },
  entryProject: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2
  },
  entryDuration: {
    color: DARK_ACCENT,
    fontSize: 14,
    fontWeight: '700'
  }
});

export default TimeTrackerScreen;
