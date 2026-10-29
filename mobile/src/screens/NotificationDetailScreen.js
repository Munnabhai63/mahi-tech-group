import React from 'react';
const { useState, useEffect } = React;
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { notificationsApi } from '../api/notifications.api.js';
import { resolveDeepLink } from '../navigation/deepLinking.js';

export const NotificationDetailScreen = ({
  route,
  navigation,
  notificationId: propId,
  notification: propNotif,
  onNavigateDeepLink,
  isOnline = true
}) => {
  const notif = propNotif || route?.params?.notification || {
    id: propId || route?.params?.notificationId || 1,
    title: 'Notification Alert',
    type: 'TASK_ASSIGNED',
    message: 'You have been assigned to task #T-101 (Mobile Authentication Flow).',
    link: 'mahitech://task/T-101',
    created_at: new Date().toISOString(),
    is_read: 0
  };

  const [markedRead, setMarkedRead] = useState(notif.is_read === 1 || notif.read === true);

  useEffect(() => {
    if (!markedRead && isOnline && notif.id) {
      notificationsApi.markRead(notif.id).then(() => {
        setMarkedRead(true);
      }).catch(() => {});
    }
  }, [markedRead, isOnline, notif.id]);

  const handleDeepLink = () => {
    const targetUrl = notif.action_url || notif.link || notif.deep_link;
    if (targetUrl) {
      const resolved = resolveDeepLink(targetUrl);
      if (resolved && typeof onNavigateDeepLink === 'function') {
        onNavigateDeepLink(resolved);
        return;
      }
      if (resolved && navigation?.navigate) {
        navigation.navigate(resolved.screen, resolved.params);
      }
    }
  };

  const resolved = resolveDeepLink(notif.action_url || notif.link || notif.deep_link);

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      ScrollView,
      { style: styles.scroll },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.typeBadge }, notif.type || 'ALERT'),
        React.createElement(
          Text,
          { style: styles.timestamp },
          notif.created_at ? new Date(notif.created_at).toLocaleString() : ''
        )
      ),

      React.createElement(Text, { style: styles.title }, notif.title),

      React.createElement(
        View,
        { style: styles.card },
        React.createElement(Text, { style: styles.message }, notif.message),
        notif.details &&
          React.createElement(
            Text,
            { style: styles.details },
            JSON.stringify(notif.details, null, 2)
          )
      ),

      resolved &&
        React.createElement(
          TouchableOpacity,
          { style: styles.actionButton, onPress: handleDeepLink },
          React.createElement(
            Text,
            { style: styles.actionButtonText },
            `Open ${resolved.screen || 'Related Item'} →`
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
    padding: 20
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  typeBadge: {
    backgroundColor: '#0f172a',
    color: DARK_ACCENT,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: '#334155'
  },
  timestamp: {
    color: '#64748b',
    fontSize: 12
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
    lineHeight: 28
  },
  card: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#334155'
  },
  message: {
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 22
  },
  details: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 12,
    fontFamily: 'monospace'
  },
  actionButton: {
    backgroundColor: DARK_ACCENT,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default NotificationDetailScreen;
