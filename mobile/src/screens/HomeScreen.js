import React from 'react';
const { useState, useEffect, useCallback } = React;
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity
} from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { TimerWidget } from '../components/TimerWidget.js';
import { TaskCard } from '../components/TaskCard.js';
import { OKRProgressBar } from '../components/OKRProgressBar.js';
import { DashboardSkeleton } from '../components/SkeletonLoader.js';
import { useTimer } from '../hooks/useTimer.js';
import { authApi } from '../api/auth.api.js';
import { backlogApi } from '../api/backlog.api.js';
import { okrApi } from '../api/okr.api.js';
import { notificationsApi } from '../api/notifications.api.js';

export const HomeScreen = ({
  initialData = null,
  onNavigateToTask = null,
  onNavigateToOKR = null
}) => {
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState(initialData?.user || null);
  const [todayTasks, setTodayTasks] = useState(initialData?.tasks || []);
  const [okrs, setOkrs] = useState(initialData?.okrs || []);
  const [urgentNotifications, setUrgentNotifications] = useState(
    initialData?.notifications || []
  );

  const { isRunning, elapsedSeconds, activeTask, start, stop } = useTimer();

  const loadDashboardData = useCallback(async () => {
    try {
      // 1. Re-verify user role directly from server
      const meRes = await authApi.getMe();
      if (meRes.data?.user) {
        setVerifiedUser(meRes.data.user);
      }

      // 2. Fetch OKRs
      try {
        const okrRes = await okrApi.getDashboard();
        setOkrs(okrRes.data?.objectives || okrRes.data || []);
      } catch {}

      // 3. Fetch Tasks
      try {
        const backlogRes = await backlogApi.getProjectBacklog('proj-default');
        setTodayTasks(backlogRes.data?.items || backlogRes.data || []);
      } catch {}

      // 4. Fetch Notifications
      try {
        const notifRes = await notificationsApi.getNotifications();
        const unread = (notifRes.data?.notifications || notifRes.data || []).filter(
          (n) => !n.is_read
        );
        setUrgentNotifications(unread);
      } catch {}
    } catch (err) {
      // Graceful offline fallback
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData) {
      loadDashboardData();
    }
  }, [initialData, loadDashboardData]);

  if (loading) {
    return React.createElement(DashboardSkeleton);
  }

  return React.createElement(
    ScrollView,
    {
      style: styles.container,
      refreshControl: React.createElement(RefreshControl, {
        refreshing,
        onRefresh: loadDashboardData,
        tintColor: DARK_ACCENT
      })
    },
    // Header & Greeting
    React.createElement(
      View,
      { style: styles.headerRow },
      React.createElement(
        View,
        null,
        React.createElement(
          Text,
          { style: styles.greeting },
          `Welcome back, ${verifiedUser?.name || 'Engineer'}`
        ),
        React.createElement(
          Text,
          { style: styles.roleBadge },
          (verifiedUser?.role || 'MEMBER').toUpperCase()
        )
      )
    ),

    // Active Timer Widget
    React.createElement(
      View,
      { style: styles.section },
      React.createElement(TimerWidget, {
        isRunning,
        elapsedSeconds,
        taskTitle: activeTask,
        onToggle: () => {
          if (isRunning) {
            stop();
          } else {
            start({
              projectId: 'proj-alpha',
              taskId: 'quick-timer',
              taskTitle: 'Focus Session'
            });
          }
        }
      })
    ),

    // Urgent Notifications Section (if any)
    urgentNotifications.length > 0 &&
      React.createElement(
        View,
        { style: styles.urgentBanner },
        React.createElement(
          Text,
          { style: styles.urgentTitle },
          `⚡ ${urgentNotifications.length} Urgent Notification${
            urgentNotifications.length > 1 ? 's' : ''
          }`
        ),
        React.createElement(
          Text,
          { style: styles.urgentSnippet },
          urgentNotifications[0].message || urgentNotifications[0].title
        )
      ),

    // Today's Tasks Section
    React.createElement(
      View,
      { style: styles.section },
      React.createElement(
        View,
        { style: styles.sectionHeaderRow },
        React.createElement(Text, { style: styles.sectionTitle }, "Today's Tasks"),
        React.createElement(
          Text,
          { style: styles.taskCount },
          `${todayTasks.length} tasks`
        )
      ),
      todayTasks.length === 0
        ? React.createElement(
            View,
            { style: styles.emptyBox },
            React.createElement(Text, { style: styles.emptyText }, 'No tasks for today. You are all caught up!')
          )
        : todayTasks.slice(0, 3).map((task) =>
            React.createElement(TaskCard, {
              key: task.id,
              title: task.title,
              status: task.status,
              storyPoints: task.story_points,
              assignee: task.assignee_name || task.assignee,
              onPress: () => onNavigateToTask?.(task)
            })
          )
    ),

    // OKR Progress Section
    React.createElement(
      View,
      { style: styles.section },
      React.createElement(
        View,
        { style: styles.sectionHeaderRow },
        React.createElement(Text, { style: styles.sectionTitle }, 'Company & Team OKRs')
      ),
      okrs.length === 0
        ? React.createElement(
            View,
            { style: styles.emptyBox },
            React.createElement(Text, { style: styles.emptyText }, 'No active OKRs set for this quarter.')
          )
        : okrs.slice(0, 2).map((okr) =>
            React.createElement(
              TouchableOpacity,
              {
                key: okr.id,
                style: styles.okrCard,
                onPress: () => onNavigateToOKR?.(okr)
              },
              React.createElement(Text, { style: styles.okrTitle }, okr.title),
              React.createElement(OKRProgressBar, {
                progress: okr.progress ?? 0.65,
                status: okr.status || 'ON_TRACK'
              })
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
    marginBottom: 16
  },
  greeting: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700'
  },
  roleBadge: {
    color: DARK_ACCENT,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2
  },
  section: {
    marginBottom: 20
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700'
  },
  taskCount: {
    color: '#94a3b8',
    fontSize: 12
  },
  urgentBanner: {
    backgroundColor: '#7f1d1d',
    borderColor: '#ef4444',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16
  },
  urgentTitle: {
    color: '#fecaca',
    fontSize: 13,
    fontWeight: '700'
  },
  urgentSnippet: {
    color: '#f8fafc',
    fontSize: 12,
    marginTop: 4
  },
  emptyBox: {
    backgroundColor: DARK_SURFACE,
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 13
  },
  okrCard: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  okrTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8
  }
});

export default HomeScreen;
