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
import { OKRProgressBar } from '../components/OKRProgressBar.js';
import { OKRSkeleton } from '../components/SkeletonLoader.js';
import { ErrorState } from '../components/ErrorState.js';
import { EmptyState } from '../components/EmptyState.js';
import { okrApi } from '../api/okr.api.js';

export const OKRDashboardScreen = ({
  initialObjectives = null,
  onObjectivePress = null,
  onCheckinPress = null
}) => {
  const [objectives, setObjectives] = useState(initialObjectives || []);
  const [loading, setLoading] = useState(!initialObjectives);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadOKRs = useCallback(async () => {
    try {
      setError(null);
      const res = await okrApi.getDashboard();
      const items = res.data?.objectives || res.data || [];
      setObjectives(items);
    } catch (err) {
      if (!objectives.length) {
        setError(err.message || 'Failed to load OKR dashboard');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [objectives.length]);

  useEffect(() => {
    if (!initialObjectives) {
      loadOKRs();
    }
  }, [initialObjectives, loadOKRs]);

  if (loading) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(OKRSkeleton),
      React.createElement(OKRSkeleton),
      React.createElement(OKRSkeleton)
    );
  }

  if (error && !objectives.length) {
    return React.createElement(ErrorState, {
      message: error,
      onRetry: loadOKRs
    });
  }

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(Text, { style: styles.header }, 'OKR Objectives & Key Results'),
    objectives.length === 0
      ? React.createElement(EmptyState, {
          title: 'No OKRs Found',
          message: 'No active objectives have been set for this quarter yet.'
        })
      : React.createElement(FlatList, {
          data: objectives,
          keyExtractor: (item) => String(item.id),
          refreshControl: React.createElement(RefreshControl, {
            refreshing,
            onRefresh: loadOKRs,
            tintColor: DARK_ACCENT
          }),
          renderItem: ({ item }) =>
            React.createElement(
              TouchableOpacity,
              {
                style: styles.card,
                activeOpacity: 0.8,
                onPress: () => onObjectivePress?.(item)
              },
              React.createElement(
                View,
                { style: styles.cardHeader },
                React.createElement(Text, { style: styles.objectiveTitle }, item.title),
                React.createElement(
                  Text,
                  { style: styles.quarterBadge },
                  item.quarter || 'Q4'
                )
              ),
              React.createElement(OKRProgressBar, {
                progress: item.progress ?? 0.5,
                status: item.status || 'ON_TRACK'
              }),
              React.createElement(
                View,
                { style: styles.footerRow },
                React.createElement(
                  Text,
                  { style: styles.krCount },
                  `${item.key_results?.length || 2} Key Results`
                ),
                React.createElement(
                  TouchableOpacity,
                  {
                    style: styles.checkinButton,
                    onPress: () => onCheckinPress?.(item)
                  },
                  React.createElement(Text, { style: styles.checkinText }, 'Check in →')
                )
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
  header: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16
  },
  card: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10
  },
  objectiveTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8
  },
  quarterBadge: {
    color: DARK_ACCENT,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#0f172a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10
  },
  krCount: {
    color: '#94a3b8',
    fontSize: 12
  },
  checkinButton: {
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  checkinText: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '600'
  }
});

export default OKRDashboardScreen;
