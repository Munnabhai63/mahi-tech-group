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
import { TaskCard } from '../components/TaskCard.js';
import { TaskCardSkeleton } from '../components/SkeletonLoader.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { backlogApi } from '../api/backlog.api.js';

export const BacklogScreen = ({
  projectId = 'proj-default',
  initialItems = null,
  onItemPress = null
}) => {
  const [items, setItems] = useState(initialItems || []);
  const [loading, setLoading] = useState(!initialItems);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState('ALL');

  const loadBacklog = useCallback(async () => {
    try {
      setError(null);
      const res = await backlogApi.getProjectBacklog(projectId);
      const dataItems = res.data?.items || res.data || [];
      setItems(dataItems);
    } catch (err) {
      if (!items.length) {
        setError(err.message || 'Failed to load backlog items');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, items.length]);

  useEffect(() => {
    if (!initialItems) {
      loadBacklog();
    }
  }, [initialItems, loadBacklog]);

  const filteredItems = filterType === 'ALL'
    ? items
    : items.filter((item) => (item.type || '').toUpperCase() === filterType);

  if (loading) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(TaskCardSkeleton),
      React.createElement(TaskCardSkeleton),
      React.createElement(TaskCardSkeleton)
    );
  }

  if (error && !items.length) {
    return React.createElement(ErrorState, {
      message: error,
      onRetry: loadBacklog
    });
  }

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(Text, { style: styles.header }, 'Project Backlog'),

    // Filter Chips
    React.createElement(
      View,
      { style: styles.filterRow },
      ['ALL', 'FEATURE', 'BUG', 'CHORE'].map((type) =>
        React.createElement(
          TouchableOpacity,
          {
            key: type,
            style: [styles.chip, filterType === type && styles.activeChip],
            onPress: () => setFilterType(type)
          },
          React.createElement(
            Text,
            { style: [styles.chipText, filterType === type && styles.activeChipText] },
            type
          )
        )
      )
    ),

    // Items List
    filteredItems.length === 0
      ? React.createElement(EmptyState, {
          title: 'Backlog is Empty',
          message: 'No backlog items match the selected filter.'
        })
      : React.createElement(FlatList, {
          data: filteredItems,
          keyExtractor: (item) => String(item.id),
          refreshControl: React.createElement(RefreshControl, {
            refreshing,
            onRefresh: loadBacklog,
            tintColor: DARK_ACCENT
          }),
          renderItem: ({ item }) =>
            React.createElement(TaskCard, {
              title: item.title,
              status: item.status,
              storyPoints: item.story_points,
              assignee: item.assignee_name || item.assignee,
              onPress: () => onItemPress?.(item)
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
  header: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 14
  },
  chip: {
    backgroundColor: DARK_SURFACE,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  activeChip: {
    backgroundColor: DARK_ACCENT,
    borderColor: DARK_ACCENT
  },
  chipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600'
  },
  activeChipText: {
    color: '#0f172a',
    fontWeight: '700'
  }
});

export default BacklogScreen;
