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
import { NotificationSkeleton } from '../components/SkeletonLoader.js';
import { ErrorState } from '../components/ErrorState.js';
import { notificationsApi } from '../api/notifications.api.js';
import { resolveDeepLink } from '../navigation/deepLinking.js';

export const NotificationCenterScreen = ({
  navigation,
  onNavigateDeepLink,
  initialNotifications = null,
  isOnline = true
}) => {
  const [notifications, setNotifications] = useState(initialNotifications || []);
  const [loading, setLoading] = useState(!initialNotifications);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadNotifications = useCallback(async () => {
    try {
      setError(null);
      if (isOnline) {
        const res = await notificationsApi.getNotifications();
        const list = Array.isArray(res.data?.notifications)
          ? res.data.notifications
          : Array.isArray(res.data)
            ? res.data
            : [];
        setNotifications(list);
      }
    } catch (err) {
      if (notifications.length === 0) {
        setError(err.message || 'Failed to load notifications');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline, notifications.length]);

  useEffect(() => {
    if (!initialNotifications) {
      loadNotifications();
    }
  }, [initialNotifications, loadNotifications]);

  const handleMarkRead = async (notif) => {
    try {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: 1, read: true } : n))
      );
      if (isOnline) {
        await notificationsApi.markRead(notif.id);
      }
    } catch {}
  };

  const handleMarkAllRead = async () => {
    try {
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: 1, read: true }))
      );
      if (isOnline) {
        await notificationsApi.markAllRead();
      }
    } catch {}
  };

  const handlePressItem = (notif) => {
    handleMarkRead(notif);

    const linkUrl = notif.action_url || notif.link || notif.deep_link;
    if (linkUrl) {
      const resolved = resolveDeepLink(linkUrl);
      if (resolved && typeof onNavigateDeepLink === 'function') {
        onNavigateDeepLink(resolved);
        return;
      }
      if (resolved && navigation?.navigate) {
        navigation.navigate(resolved.screen, resolved.params);
        return;
      }
    }

    if (navigation?.navigate) {
      navigation.navigate('NotificationDetail', { notificationId: notif.id, notification: notif });
    }
  };

  const groupNotifications = (list) => {
    const today = [];
    const yesterday = [];
    const earlier = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

    list.forEach((n) => {
      const t = n.created_at ? new Date(n.created_at).getTime() : startOfToday;
      if (t >= startOfToday) {
        today.push(n);
      } else if (t >= startOfYesterday) {
        yesterday.push(n);
      } else {
        earlier.push(n);
      }
    });

    return { today, yesterday, earlier };
  };

  const { today, yesterday, earlier } = groupNotifications(notifications);
  const unreadCount = notifications.filter((n) => !n.is_read && !n.read).length;

  if (loading && notifications.length === 0) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'Notification Center'),
        React.createElement(Text, { style: styles.subtitle }, 'Loading notifications...')
      ),
      React.createElement(NotificationSkeleton, null)
    );
  }

  if (error && notifications.length === 0) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(ErrorState, { message: error, onRetry: loadNotifications })
    );
  }

  const renderGroup = (title, items) => {
    if (items.length === 0) return null;
    return React.createElement(
      View,
      { key: `grp_${title}`, style: styles.groupContainer },
      React.createElement(Text, { style: styles.groupHeader }, title),
      items.map((notif) => {
        const isRead = notif.is_read === 1 || notif.read === true;
        return React.createElement(
          TouchableOpacity,
          {
            key: `notif_${notif.id}`,
            style: [styles.itemCard, !isRead && styles.unreadCard],
            onPress: () => handlePressItem(notif)
          },
          React.createElement(
            View,
            { style: styles.itemHeader },
            React.createElement(
              View,
              { style: styles.typeRow },
              !isRead && React.createElement(View, { style: styles.unreadDot }),
              React.createElement(Text, { style: styles.itemType }, notif.type || 'NOTIFICATION')
            ),
            React.createElement(
              Text,
              { style: styles.itemTime },
              notif.created_at
                ? new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''
            )
          ),
          React.createElement(Text, { style: styles.itemTitle }, notif.title),
          notif.message &&
            React.createElement(
              Text,
              { style: styles.itemMessage, numberOfLines: 2 },
              notif.message
            )
        );
      })
    );
  };

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      View,
      { style: styles.header },
      React.createElement(
        View,
        null,
        React.createElement(Text, { style: styles.title }, 'Notifications'),
        React.createElement(
          Text,
          { style: styles.subtitle },
          unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'
        )
      ),
      unreadCount > 0 &&
        React.createElement(
          TouchableOpacity,
          { style: styles.markAllBtn, onPress: handleMarkAllRead },
          React.createElement(Text, { style: styles.markAllText }, 'Mark all read')
        )
    ),
    React.createElement(
      ScrollView,
      {
        style: styles.scroll,
        refreshControl: React.createElement(RefreshControl, {
          refreshing,
          onRefresh: () => {
            setRefreshing(true);
            loadNotifications();
          },
          tintColor: DARK_ACCENT
        })
      },
      notifications.length === 0
        ? React.createElement(
            View,
            { style: styles.emptyContainer },
            React.createElement(Text, { style: styles.emptyIcon }, '🔔'),
            React.createElement(Text, { style: styles.emptyTitle }, 'No notifications yet'),
            React.createElement(
              Text,
              { style: styles.emptySubtitle },
              'You will receive push and in-app alerts for tasks, sprints, OKRs, and approvals.'
            )
          )
        : React.createElement(
            React.Fragment,
            null,
            renderGroup('Today', today),
            renderGroup('Yesterday', yesterday),
            renderGroup('Earlier', earlier)
          )
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700'
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2
  },
  markAllBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  markAllText: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '600'
  },
  scroll: {
    flex: 1,
    padding: 16
  },
  groupContainer: {
    marginBottom: 20
  },
  groupHeader: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8
  },
  itemCard: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  unreadCard: {
    borderColor: '#0284c7',
    backgroundColor: '#0f172a'
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38bdf8',
    marginRight: 6
  },
  itemType: {
    color: DARK_ACCENT,
    fontSize: 11,
    fontWeight: '700'
  },
  itemTime: {
    color: '#64748b',
    fontSize: 11
  },
  itemTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600'
  },
  itemMessage: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#334155'
  },
  emptyIcon: {
    fontSize: 40,
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

export default NotificationCenterScreen;
