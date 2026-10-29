import React from 'react';
const { useState, useEffect, useCallback } = React;
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { DashboardSkeleton } from '../components/SkeletonLoader.js';
import { ErrorState } from '../components/ErrorState.js';
import { wikiApi } from '../api/wiki.api.js';
import { getCache, setCache, WIKI_CACHE_TTL_MS } from '../utils/sqliteCache.js';

export const WikiHomeScreen = ({
  navigation,
  onSelectSpace,
  onSelectPage,
  isOnline = true
}) => {
  const [spaces, setSpaces] = useState([]);
  const [recentPages, setRecentPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const loadWikiHome = useCallback(async () => {
    try {
      setError(null);
      // 1. Check SQLite Cache First (24hr TTL)
      const cachedSpaces = getCache('wiki_spaces');
      const cachedPages = getCache('wiki_recent_pages');

      if (cachedSpaces && cachedSpaces.data) {
        setSpaces(cachedSpaces.data);
      }
      if (cachedPages && cachedPages.data) {
        setRecentPages(cachedPages.data);
      }
      if (cachedSpaces || cachedPages) {
        setLoading(false);
      }

      // 2. Refresh from API if online
      if (isOnline) {
        try {
          const res = await wikiApi.getSpaces();
          const spaceList = Array.isArray(res.data) ? res.data : (res.data?.spaces || []);
          setSpaces(spaceList);
          setCache('wiki_spaces', spaceList, 'wiki', WIKI_CACHE_TTL_MS);

          if (spaceList.length > 0) {
            const firstSpaceId = spaceList[0].id;
            const pagesRes = await wikiApi.getSpacePages(firstSpaceId);
            const pageList = Array.isArray(pagesRes.data) ? pagesRes.data : (pagesRes.data?.pages || []);
            setRecentPages(pageList.slice(0, 5));
            setCache('wiki_recent_pages', pageList.slice(0, 5), 'wiki', WIKI_CACHE_TTL_MS);
          }
        } catch (fetchErr) {
          if (!cachedSpaces) throw fetchErr;
        }
      }
    } catch (err) {
      if (spaces.length === 0) {
        setError(err.message || 'Failed to load knowledge base');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline, spaces.length]);

  useEffect(() => {
    loadWikiHome();
  }, [loadWikiHome]);

  const handleSearch = async (text) => {
    setSearchQuery(text);
    if (!text || text.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      setSearching(true);
      const res = await wikiApi.searchPages(text.trim());
      const hits = Array.isArray(res.data) ? res.data : (res.data?.results || []);
      setSearchResults(hits);
    } catch {
      const localHits = recentPages.filter((p) =>
        (p.title || '').toLowerCase().includes(text.toLowerCase())
      );
      setSearchResults(localHits);
    } finally {
      setSearching(false);
    }
  };

  const navigateToSpace = (space) => {
    if (typeof onSelectSpace === 'function') {
      onSelectSpace(space);
    } else if (navigation?.navigate) {
      navigation.navigate('SpacePages', { spaceId: space.id, spaceName: space.name });
    }
  };

  const navigateToPage = (pageId) => {
    if (typeof onSelectPage === 'function') {
      onSelectPage(pageId);
    } else if (navigation?.navigate) {
      navigation.navigate('PageReader', { pageId });
    }
  };

  if (loading && spaces.length === 0) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'Knowledge Base & Wiki'),
        React.createElement(Text, { style: styles.subtitle }, 'Fast Read-Only Reader (24h Cache)')
      ),
      React.createElement(DashboardSkeleton, null)
    );
  }

  if (error && spaces.length === 0) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(ErrorState, { message: error, onRetry: loadWikiHome })
    );
  }

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
            loadWikiHome();
          },
          tintColor: DARK_ACCENT
        })
      },
      // Header
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'Knowledge Base & Wiki'),
        React.createElement(Text, { style: styles.subtitle }, 'Documentation, specs, and engineering guides')
      ),

      // Search Bar
      React.createElement(
        View,
        { style: styles.searchContainer },
        React.createElement(TextInput, {
          style: styles.searchInput,
          placeholder: 'Search all wiki spaces...',
          placeholderTextColor: '#64748b',
          value: searchQuery,
          onChangeText: handleSearch
        }),
        searching && React.createElement(Text, { style: styles.searchingText }, 'Searching...')
      ),

      // Search Results
      searchQuery.trim().length >= 2 &&
        React.createElement(
          View,
          { style: styles.section },
          React.createElement(
            Text,
            { style: styles.sectionTitle },
            `Search Results (${searchResults.length})`
          ),
          searchResults.length === 0
            ? React.createElement(Text, { style: styles.emptyText }, 'No matching documents found')
            : searchResults.map((item) =>
                React.createElement(
                  TouchableOpacity,
                  {
                    key: `search_${item.page_id || item.id}`,
                    style: styles.pageCard,
                    onPress: () => navigateToPage(item.page_id || item.id)
                  },
                  React.createElement(Text, { style: styles.pageEmoji }, item.emoji_icon || '📄'),
                  React.createElement(
                    View,
                    { style: styles.pageCardContent },
                    React.createElement(Text, { style: styles.pageTitle }, item.title),
                    item.space_name &&
                      React.createElement(Text, { style: styles.pageSpaceTag }, item.space_name)
                  )
                )
              )
        ),

      // Spaces Directory
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, `Spaces (${spaces.length})`),
        spaces.length === 0
          ? React.createElement(Text, { style: styles.emptyText }, 'No spaces available')
          : spaces.map((space) =>
              React.createElement(
                TouchableOpacity,
                {
                  key: `space_${space.id}`,
                  style: styles.spaceCard,
                  onPress: () => navigateToSpace(space)
                },
                React.createElement(
                  View,
                  { style: styles.spaceCardHeader },
                  React.createElement(Text, { style: styles.spaceIcon }, space.icon || '📚'),
                  React.createElement(
                    View,
                    { style: styles.spaceInfo },
                    React.createElement(Text, { style: styles.spaceName }, space.name),
                    React.createElement(
                      Text,
                      { style: styles.spaceDescription, numberOfLines: 2 },
                      space.description || 'Project documentation and technical notes'
                    )
                  )
                ),
                React.createElement(
                  View,
                  { style: styles.spaceFooter },
                  React.createElement(
                    Text,
                    { style: styles.spaceVisibilityBadge },
                    space.visibility || 'INTERNAL'
                  ),
                  React.createElement(
                    Text,
                    { style: styles.spacePagesCount },
                    space.page_count !== undefined ? `${space.page_count} pages` : 'View space →'
                  )
                )
              )
            )
      ),

      // Recent Pages
      recentPages.length > 0 &&
        React.createElement(
          View,
          { style: styles.section },
          React.createElement(Text, { style: styles.sectionTitle }, 'Recently Viewed'),
          recentPages.map((page) =>
            React.createElement(
              TouchableOpacity,
              {
                key: `recent_${page.id}`,
                style: styles.pageCard,
                onPress: () => navigateToPage(page.id)
              },
              React.createElement(Text, { style: styles.pageEmoji }, page.emoji_icon || '📄'),
              React.createElement(
                View,
                { style: styles.pageCardContent },
                React.createElement(Text, { style: styles.pageTitle }, page.title),
                React.createElement(
                  Text,
                  { style: styles.pageMeta },
                  `${page.reading_time_minutes ? `${page.reading_time_minutes} min read • ` : ''}Updated ${page.updated_at ? new Date(page.updated_at).toLocaleDateString() : 'recently'}`
                )
              )
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
    marginBottom: 16
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
  searchContainer: {
    marginBottom: 20,
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  searchInput: {
    color: '#f8fafc',
    fontSize: 14
  },
  searchingText: {
    color: DARK_ACCENT,
    fontSize: 12,
    marginTop: 4
  },
  section: {
    marginBottom: 24
  },
  sectionTitle: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  spaceCard: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  spaceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  spaceIcon: {
    fontSize: 24,
    marginRight: 12
  },
  spaceInfo: {
    flex: 1
  },
  spaceName: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600'
  },
  spaceDescription: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2
  },
  spaceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155'
  },
  spaceVisibilityBadge: {
    backgroundColor: '#0f172a',
    color: DARK_ACCENT,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: '600'
  },
  spacePagesCount: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '500'
  },
  pageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  pageEmoji: {
    fontSize: 20,
    marginRight: 12
  },
  pageCardContent: {
    flex: 1
  },
  pageTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600'
  },
  pageSpaceTag: {
    color: DARK_ACCENT,
    fontSize: 11,
    marginTop: 2
  },
  pageMeta: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic'
  }
});

export default WikiHomeScreen;
