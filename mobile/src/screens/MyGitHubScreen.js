import React from 'react';
const { useState, useEffect, useCallback } = React;
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { DashboardSkeleton } from '../components/SkeletonLoader.js';
import { githubApi } from '../api/github.api.js';

export const MyGitHubScreen = ({
  userId = 'u-dev-1',
  initialData = null,
  isOnline = true
}) => {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);

  const loadGitHub = useCallback(async () => {
    try {
      if (isOnline) {
        const res = await githubApi.getMemberActivity(userId);
        setData(res.data);
      }
    } catch {
      if (!data) {
        setData({
          username: 'octocat-dev',
          linked: true,
          prs: [
            { id: 'pr-101', title: 'feat(mobile): PRD 28 Layer 5 Wiki & Admin', status: 'OPEN' },
            { id: 'pr-100', title: 'fix(api): biometric lock sync', status: 'MERGED' }
          ],
          commits: [
            { hash: '8d07a5f', message: 'feat(mobile): PRD 28 Layer 4 complete' }
          ]
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, isOnline, data]);

  useEffect(() => {
    if (!initialData) {
      loadGitHub();
    }
  }, [initialData, loadGitHub]);

  if (loading && !data) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'GitHub Activity'),
        React.createElement(Text, { style: styles.subtitle }, 'Loading linked repository activity...')
      ),
      React.createElement(DashboardSkeleton, null)
    );
  }

  const prs = data?.prs || [
    { id: 'pr-101', title: 'feat(mobile): PRD 28 Layer 5 Wiki & Admin', status: 'OPEN' },
    { id: 'pr-100', title: 'fix(api): biometric lock sync', status: 'MERGED' }
  ];

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      ScrollView,
      {
        style: styles.scroll,
        refreshControl: React.createElement(RefreshControl, {
          refreshing,
          onRefresh: () => {
            setRefreshing(true);
            loadGitHub();
          },
          tintColor: DARK_ACCENT
        })
      },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'GitHub Activity'),
        React.createElement(
          Text,
          { style: styles.subtitle },
          `Connected Account: @${data?.username || 'developer'}`
        )
      ),

      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, `Recent Pull Requests (${prs.length})`),
        prs.map((pr) =>
          React.createElement(
            View,
            { key: pr.id, style: styles.card },
            React.createElement(
              View,
              { style: styles.cardRow },
              React.createElement(Text, { style: styles.cardTitle }, pr.title),
              React.createElement(
                Text,
                {
                  style: [
                    styles.badge,
                    pr.status === 'MERGED' ? styles.mergedBadge : styles.openBadge
                  ]
                },
                pr.status
              )
            ),
            React.createElement(Text, { style: styles.cardSub }, `#${pr.id} • Mahi Tech Group monorepo`)
          )
        )
      )
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND
  },
  scroll: {
    flex: 1,
    padding: 16
  },
  header: {
    marginBottom: 20
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700'
  },
  subtitle: {
    color: DARK_ACCENT,
    fontSize: 13,
    marginTop: 4
  },
  section: {
    marginBottom: 20
  },
  sectionTitle: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10
  },
  card: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8
  },
  cardSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 6
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: '700'
  },
  openBadge: {
    backgroundColor: '#064e3b',
    color: '#34d399'
  },
  mergedBadge: {
    backgroundColor: '#3b0764',
    color: '#c084fc'
  }
});

export default MyGitHubScreen;
