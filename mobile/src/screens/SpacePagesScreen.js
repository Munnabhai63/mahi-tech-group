import React from 'react';
const { useState, useEffect, useCallback } = React;
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { DashboardSkeleton } from '../components/SkeletonLoader.js';
import { ErrorState } from '../components/ErrorState.js';
import { wikiApi } from '../api/wiki.api.js';
import { getCache, setCache, WIKI_CACHE_TTL_MS } from '../utils/sqliteCache.js';

export const SpacePagesScreen = ({
  route,
  navigation,
  spaceId: propSpaceId,
  spaceName: propSpaceName,
  onSelectPage,
  isOnline = true
}) => {
  const spaceId = propSpaceId || route?.params?.spaceId || 1;
  const spaceName = propSpaceName || route?.params?.spaceName || 'Documentation';

  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState({});

  const cacheKey = `wiki_space_pages_${spaceId}`;

  const loadSpacePages = useCallback(async () => {
    try {
      setError(null);
      // 1. Check SQLite Cache First (24hr TTL)
      const cached = getCache(cacheKey);
      if (cached && cached.data) {
        setPages(cached.data);
        setLoading(false);
      }

      // 2. Fetch fresh data if online
      if (isOnline) {
        try {
          const res = await wikiApi.getSpacePages(spaceId);
          const pageList = Array.isArray(res.data) ? res.data : (res.data?.pages || []);
          setPages(pageList);
          setCache(cacheKey, pageList, 'wiki', WIKI_CACHE_TTL_MS);
        } catch (fetchErr) {
          if (!cached) throw fetchErr;
        }
      }
    } catch (err) {
      if (pages.length === 0) {
        setError(err.message || 'Failed to load space pages');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [spaceId, cacheKey, isOnline, pages.length]);

  useEffect(() => {
    loadSpacePages();
  }, [loadSpacePages]);

  const toggleExpand = (pageId) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [pageId]: !prev[pageId]
    }));
  };

  const handlePagePress = (pageId) => {
    if (typeof onSelectPage === 'function') {
      onSelectPage(pageId);
    } else if (navigation?.navigate) {
      navigation.navigate('PageReader', { pageId });
    }
  };

  const rootPages = pages.filter((p) => !p.parent_page_id);
  const getChildPages = (parentId) => pages.filter((p) => p.parent_page_id === parentId);

  if (loading && pages.length === 0) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, spaceName),
        React.createElement(Text, { style: styles.subtitle }, 'Loading document tree...')
      ),
      React.createElement(DashboardSkeleton, null)
    );
  }

  if (error && pages.length === 0) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(ErrorState, { message: error, onRetry: loadSpacePages })
    );
  }

  const renderPageItem = (page, depth = 0) => {
    const children = getChildPages(page.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedNodes[page.id] ?? true;

    return React.createElement(
      View,
      { key: `page_${page.id}`, style: { marginLeft: depth * 16 } },
      React.createElement(
        View,
        { style: styles.pageRow },
        hasChildren &&
          React.createElement(
            TouchableOpacity,
            {
              onPress: () => toggleExpand(page.id),
              style: styles.expandIconContainer
            },
            React.createElement(Text, { style: styles.expandIcon }, isExpanded ? '▼' : '▶')
          ),
        React.createElement(
          TouchableOpacity,
          {
            style: [styles.pageTouchable, !hasChildren && { paddingLeft: 8 }],
            onPress: () => handlePagePress(page.id)
          },
          React.createElement(Text, { style: styles.pageEmoji }, page.emoji_icon || '📄'),
          React.createElement(
            View,
            { style: styles.pageDetails },
            React.createElement(Text, { style: styles.pageTitle }, page.title),
            React.createElement(
              Text,
              { style: styles.pageMeta },
              `${page.word_count ? `${page.word_count} words • ` : ''}${page.status || 'PUBLISHED'}`
            )
          )
        )
      ),
      hasChildren &&
        isExpanded &&
        React.createElement(
          View,
          { style: styles.childContainer },
          children.map((child) => renderPageItem(child, depth + 1))
        )
    );
  };

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
            loadSpacePages();
          },
          tintColor: DARK_ACCENT
        })
      },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, spaceName),
        React.createElement(
          Text,
          { style: styles.subtitle },
          `${pages.length} ${pages.length === 1 ? 'document' : 'documents'} • Read-Only`
        )
      ),

      pages.length === 0
        ? React.createElement(
            View,
            { style: styles.emptyContainer },
            React.createElement(Text, { style: styles.emptyIcon }, '📖'),
            React.createElement(Text, { style: styles.emptyTitle }, 'No documents in this space'),
            React.createElement(
              Text,
              { style: styles.emptySubtitle },
              'Documents published in this space will be cached locally for 24h reading.'
            )
          )
        : React.createElement(
            View,
            { style: styles.treeContainer },
            rootPages.map((rootPage) => renderPageItem(rootPage, 0))
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
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4
  },
  treeContainer: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  expandIconContainer: {
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  expandIcon: {
    color: '#94a3b8',
    fontSize: 11
  },
  pageTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center'
  },
  pageEmoji: {
    fontSize: 18,
    marginRight: 10
  },
  pageDetails: {
    flex: 1
  },
  pageTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '500'
  },
  pageMeta: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2
  },
  childContainer: {
    borderLeftWidth: 1,
    borderLeftColor: '#334155',
    marginLeft: 6
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 12
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600'
  },
  emptySubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6
  }
});

export default SpacePagesScreen;
