import React from 'react';
const { useState, useEffect, useCallback } = React;
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { TaskCard } from '../components/TaskCard.js';
import { TaskCardSkeleton } from '../components/SkeletonLoader.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { backlogApi } from '../api/backlog.api.js';
import { enqueueOfflineAction, ActionTypes } from '../utils/offlineQueue.js';
import * as Haptics from 'expo-haptics';

export const COLUMNS = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

export const SprintBoardScreen = ({
  projectId = 'proj-default',
  initialTasks = null,
  isOnline = true,
  onTaskPress = null
}) => {
  const [tasks, setTasks] = useState(initialTasks || []);
  const [loading, setLoading] = useState(!initialTasks);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [activeColumn, setActiveColumn] = useState('TODO');
  const [selectedTaskId, setSelectedTaskId] = useState(null); // 1st tap

  const loadBoardTasks = useCallback(async () => {
    try {
      setError(null);
      const res = await backlogApi.getProjectBacklog(projectId);
      const items = res.data?.items || res.data || [];
      setTasks(items);
    } catch (err) {
      if (!tasks.length) {
        setError(err.message || 'Failed to load sprint board');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, tasks.length]);

  useEffect(() => {
    if (!initialTasks) {
      loadBoardTasks();
    }
  }, [initialTasks, loadBoardTasks]);

  // Two-Tap Optimistic Update & Rollback Flow
  const handleStatusChange = async (taskId, targetStatus) => {
    const taskIndex = tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) return;

    const previousStatus = tasks[taskIndex].status;
    if (previousStatus === targetStatus) {
      setSelectedTaskId(null);
      return;
    }

    // 1. Optimistic Update in Local State
    const updatedTasks = [...tasks];
    updatedTasks[taskIndex] = { ...updatedTasks[taskIndex], status: targetStatus };
    setTasks(updatedTasks);
    setSelectedTaskId(null);

    // 2. Haptic feedback on status change
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // 3. Dispatch to API or Queue
    if (!isOnline) {
      enqueueOfflineAction({
        type: ActionTypes.TASK_STATUS_CHANGE,
        payload: { itemId: taskId, status: targetStatus, previousStatus }
      });
      return { success: true, queued: true };
    }

    try {
      await backlogApi.updateItemStatus(taskId, targetStatus);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      return { success: true };
    } catch (err) {
      // 4. Server Rejection -> Rollback local optimistic state!
      const rolledBackTasks = [...tasks];
      rolledBackTasks[taskIndex] = { ...rolledBackTasks[taskIndex], status: previousStatus };
      setTasks(rolledBackTasks);

      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      setError(`Could not move task to ${targetStatus}: ${err.message || 'Server rejected'}`);
      return { success: false, rolledBack: true, previousStatus };
    }
  };

  const filteredTasks = tasks.filter((t) => (t.status || 'TODO') === activeColumn);

  if (loading) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(TaskCardSkeleton),
      React.createElement(TaskCardSkeleton),
      React.createElement(TaskCardSkeleton)
    );
  }

  if (error && !tasks.length) {
    return React.createElement(ErrorState, {
      message: error,
      onRetry: loadBoardTasks
    });
  }

  return React.createElement(
    View,
    { style: styles.container },
    // Column Switcher Tabs (Two-Tap UI)
    React.createElement(
      View,
      { style: styles.columnTabs },
      COLUMNS.map((col) =>
        React.createElement(
          TouchableOpacity,
          {
            key: col,
            style: [styles.tabButton, activeColumn === col && styles.activeTabButton],
            onPress: () => {
              setActiveColumn(col);
              setSelectedTaskId(null);
            }
          },
          React.createElement(
            Text,
            { style: [styles.tabText, activeColumn === col && styles.activeTabText] },
            col.replace('_', ' ')
          )
        )
      )
    ),

    // Quick Status Transition Bar when Card is Selected (1st tap -> 2nd tap)
    selectedTaskId &&
      React.createElement(
        View,
        { style: styles.transitionBar },
        React.createElement(Text, { style: styles.transitionLabel }, 'Move to:'),
        COLUMNS.filter((c) => c !== activeColumn).map((targetCol) =>
          React.createElement(
            TouchableOpacity,
            {
              key: targetCol,
              style: styles.targetColButton,
              onPress: () => handleStatusChange(selectedTaskId, targetCol)
            },
            React.createElement(Text, { style: styles.targetColText }, targetCol.replace('_', ' '))
          )
        ),
        React.createElement(
          TouchableOpacity,
          {
            style: styles.cancelButton,
            onPress: () => setSelectedTaskId(null)
          },
          React.createElement(Text, { style: styles.cancelText }, '✕')
        )
      ),

    // Task List
    filteredTasks.length === 0
      ? React.createElement(EmptyState, {
          title: `No ${activeColumn.replace('_', ' ')} tasks`,
          message: 'All tasks in this sprint state are completed or moved.'
        })
      : React.createElement(FlatList, {
          data: filteredTasks,
          keyExtractor: (item) => String(item.id),
          initialNumToRender: 10,
          maxToRenderPerBatch: 10,
          windowSize: 5,
          removeClippedSubviews: true,
          refreshControl: React.createElement(RefreshControl, {
            refreshing,
            onRefresh: loadBoardTasks,
            tintColor: DARK_ACCENT
          }),
          renderItem: ({ item }) =>
            React.createElement(TaskCard, {
              title: item.title,
              status: item.status,
              storyPoints: item.story_points,
              assignee: item.assignee_name || item.assignee,
              onPress: () => {
                if (typeof onTaskPress === 'function') {
                  onTaskPress(item);
                } else {
                  // 1st Tap: select card to reveal target status pills
                  setSelectedTaskId(selectedTaskId === item.id ? null : item.id);
                }
              }
            })
        })
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND,
    padding: 16
  },
  columnTabs: {
    flexDirection: 'row',
    backgroundColor: DARK_SURFACE,
    borderRadius: 8,
    padding: 4,
    marginBottom: 12
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6
  },
  activeTabButton: {
    backgroundColor: DARK_ACCENT
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700'
  },
  activeTabText: {
    color: '#0f172a'
  },
  transitionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: DARK_ACCENT,
    borderRadius: 8,
    padding: 8,
    marginBottom: 12
  },
  transitionLabel: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '600',
    marginRight: 6
  },
  targetColButton: {
    backgroundColor: '#334155',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginRight: 6
  },
  targetColText: {
    color: DARK_ACCENT,
    fontSize: 11,
    fontWeight: '600'
  },
  cancelButton: {
    marginLeft: 'auto',
    paddingHorizontal: 6
  },
  cancelText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700'
  }
});

export default SprintBoardScreen;
