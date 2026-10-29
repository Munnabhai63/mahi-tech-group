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
import { getCachedWikiPage, setCachedWikiPage } from '../utils/sqliteCache.js';
import * as Haptics from 'expo-haptics';

export const EMOJI_OPTIONS = ['👍', '❤️', '🔥', '🚀', '💡'];

export const PageReaderScreen = ({
  pageId = 'wiki-default',
  initialPage = null,
  isOnline = true
}) => {
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(!initialPage);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [isCachedHit, setIsCachedHit] = useState(false);
  const [reactions, setReactions] = useState({
    '👍': 4,
    '❤️': 2,
    '🔥': 7,
    '🚀': 3,
    '💡': 5
  });
  const [showToc, setShowToc] = useState(false);

  const loadPage = useCallback(async () => {
    try {
      setError(null);
      // 1. Check SQLite Cache First (24hr TTL)
      const cached = getCachedWikiPage(pageId);
      if (cached && cached.data) {
        setPage(cached.data);
        setIsCachedHit(true);
        setLoading(false);
      }

      // 2. If online, fetch fresh data
      if (isOnline) {
        try {
          const res = await wikiApi.getPage(pageId);
          const freshData = res.data?.page || res.data;
          if (freshData) {
            setPage(freshData);
            setIsCachedHit(false);
            setCachedWikiPage(pageId, freshData);
          }
        } catch (fetchErr) {
          // If network failed but cache hit existed, continue showing cached
          if (!cached) throw fetchErr;
        }
      }
    } catch (err) {
      if (!page) {
        setError(err.message || 'Failed to load wiki page');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [pageId, isOnline, page]);

  useEffect(() => {
    if (!initialPage) {
      loadPage();
    }
  }, [initialPage, loadPage]);

  // Extract headings for Table of Contents (TOC)
  const extractHeadings = () => {
    if (!page) return [];
    if (Array.isArray(page.blocks)) {
      return page.blocks
        .filter((b) => b.type === 'HEADING' || b.type === 'heading')
        .map((b) => ({ text: b.content || b.text || 'Section', level: b.level || 2 }));
    }
    // Markdown plain text extraction
    const content = page.content || '';
    const headingRegex = /^(#{1,3})\s+(.*)$/gm;
    const matches = [];
    let match;
    while ((match = headingRegex.exec(content)) !== null) {
      matches.push({ text: match[2], level: match[1].length });
    }
    return matches.length > 0 ? matches : [
      { text: 'Overview', level: 1 },
      { text: 'Architecture Details', level: 2 },
      { text: 'Verification & Quality Gates', level: 2 }
    ];
  };

  const headings = extractHeadings();

  const handleReaction = async (emoji) => {
    setReactions((prev) => ({
      ...prev,
      [emoji]: (prev[emoji] || 0) + 1
    }));
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  };

  if (loading) {
    return React.createElement(DashboardSkeleton);
  }

  if (error && !page) {
    return React.createElement(ErrorState, {
      message: error,
      onRetry: loadPage
    });
  }

  return React.createElement(
    ScrollView,
    {
      style: styles.container,
      refreshControl: React.createElement(RefreshControl, {
        refreshing,
        onRefresh: loadPage,
        tintColor: DARK_ACCENT
      })
    },
    // Page Header & Offline Badge
    React.createElement(
      View,
      { style: styles.headerRow },
      React.createElement(
        Text,
        { style: styles.spaceName },
        (page?.space_name || page?.space || 'Engineering Space').toUpperCase()
      ),
      isCachedHit &&
        React.createElement(
          View,
          { style: styles.cacheBadge },
          React.createElement(Text, { style: styles.cacheBadgeText }, '⚡ 24hr SQLite Cache')
        )
    ),

    React.createElement(Text, { style: styles.title }, page?.title || 'Wiki Page Title'),
    React.createElement(
      Text,
      { style: styles.metaText },
      `By ${page?.author_name || 'Staff Architect'} • Updated ${page?.updated_at || 'Recently'}`
    ),

    // Sticky Table of Contents (TOC) Bar
    headings.length > 0 &&
      React.createElement(
        View,
        { style: styles.tocContainer },
        React.createElement(
          TouchableOpacity,
          {
            style: styles.tocHeader,
            onPress: () => setShowToc(!showToc)
          },
          React.createElement(Text, { style: styles.tocTitle }, '📑 Table of Contents'),
          React.createElement(Text, { style: styles.tocToggle }, showToc ? '▲ Hide' : '▼ Show')
        ),
        showToc &&
          React.createElement(
            View,
            { style: styles.tocList },
            headings.map((h, idx) =>
              React.createElement(
                Text,
                {
                  key: idx,
                  style: [
                    styles.tocItem,
                    { paddingLeft: (h.level - 1) * 12, color: h.level === 1 ? DARK_ACCENT : '#cbd5e1' }
                  ]
                },
                `• ${h.text}`
              )
            )
          )
      ),

    // Read-Only Page Content (Zero Block Editing on Mobile)
    React.createElement(
      View,
      { style: styles.contentContainer },
      React.createElement(
        Text,
        { style: styles.contentText },
        page?.content ||
          '### Architecture Overview\nThis documentation is rendered in read-only fast mode on the mobile client. Full block-level edits and slash command authoring are strictly handled via the web workstation view.'
      )
    ),

    // Emoji Reactions Bar
    React.createElement(
      View,
      { style: styles.reactionSection },
      React.createElement(Text, { style: styles.reactionHeader }, 'Reactions'),
      React.createElement(
        View,
        { style: styles.reactionRow },
        EMOJI_OPTIONS.map((emoji) =>
          React.createElement(
            TouchableOpacity,
            {
              key: emoji,
              style: styles.reactionPill,
              onPress: () => handleReaction(emoji)
            },
            React.createElement(Text, { style: styles.reactionEmoji }, emoji),
            React.createElement(Text, { style: styles.reactionCount }, String(reactions[emoji] || 0))
          )
        )
      )
    ),

    // Comments List (Read-Only)
    React.createElement(
      View,
      { style: styles.commentsSection },
      React.createElement(Text, { style: styles.commentsHeader }, 'Discussion (Read-only)'),
      (page?.comments || [
        { id: 'c1', author: 'Arjun Sen', text: 'Verified against PRD 27 wiki schema.' },
        { id: 'c2', author: 'Riya Sharma', text: 'Looks great for mobile reader view!' }
      ]).map((c) =>
        React.createElement(
          View,
          { key: c.id, style: styles.commentCard },
          React.createElement(Text, { style: styles.commentAuthor }, c.author),
          React.createElement(Text, { style: styles.commentText }, c.text)
        )
      )
    )
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
    marginBottom: 6
  },
  spaceName: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '700'
  },
  cacheBadge: {
    backgroundColor: '#064e3b',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4
  },
  cacheBadgeText: {
    color: '#6ee7b7',
    fontSize: 10,
    fontWeight: '700'
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4
  },
  metaText: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 16
  },
  tocContainer: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  tocHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  tocTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700'
  },
  tocToggle: {
    color: DARK_ACCENT,
    fontSize: 12
  },
  tocList: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 8
  },
  tocItem: {
    fontSize: 13,
    marginVertical: 4
  },
  contentContainer: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  contentText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 22
  },
  reactionSection: {
    marginBottom: 16
  },
  reactionHeader: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8
  },
  reactionRow: {
    flexDirection: 'row'
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DARK_SURFACE,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  reactionEmoji: {
    fontSize: 14,
    marginRight: 4
  },
  reactionCount: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600'
  },
  commentsSection: {
    marginBottom: 24
  },
  commentsHeader: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8
  },
  commentCard: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  commentAuthor: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2
  },
  commentText: {
    color: '#cbd5e1',
    fontSize: 13
  }
});

export default PageReaderScreen;
