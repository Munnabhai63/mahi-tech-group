import React from 'react';
const { useState } = React;
import RN, {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity
} from 'react-native';

const Switch = RN?.Switch || ((props) => React.createElement('Switch', props, props?.children));
const Alert = RN?.Alert || { alert: () => {} };
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { secureStorage } from '../utils/cache.js';
import { clearAllCache } from '../utils/sqliteCache.js';
import { clearOfflineQueue } from '../utils/offlineQueue.js';
import { notificationsApi } from '../api/notifications.api.js';
import { authApi } from '../api/auth.api.js';

export const SettingsScreen = ({
  navigation,
  onLogout,
  onThemeToggle
}) => {
  const [darkMode, setDarkMode] = useState(
    secureStorage.getBoolean('dark_mode_enabled') ?? true
  );
  const [notifTasks, setNotifTasks] = useState(
    secureStorage.getBoolean('notif_tasks') ?? true
  );
  const [notifSprints, setNotifSprints] = useState(
    secureStorage.getBoolean('notif_sprints') ?? true
  );
  const [notifOkrs, setNotifOkrs] = useState(
    secureStorage.getBoolean('notif_okrs') ?? true
  );
  const [notifApprovals, setNotifApprovals] = useState(
    secureStorage.getBoolean('notif_approvals') ?? true
  );
  const [cacheClearMessage, setCacheClearMessage] = useState(null);
  const [clearing, setClearing] = useState(false);

  const handleDarkModeToggle = (val) => {
    setDarkMode(val);
    secureStorage.set('dark_mode_enabled', val);
    if (typeof onThemeToggle === 'function') {
      onThemeToggle(val);
    }
  };

  const handleClearCache = () => {
    try {
      setClearing(true);
      clearAllCache();
      clearOfflineQueue();
      setCacheClearMessage('Cache & Offline Queue cleared successfully!');
      setTimeout(() => setCacheClearMessage(null), 3000);
    } catch (err) {
      setCacheClearMessage('Failed to clear cache: ' + err.message);
    } finally {
      setClearing(false);
    }
  };

  const handleLogout = async () => {
    const deviceId = secureStorage.getString('device_id');
    try {
      await notificationsApi.unregisterDeviceToken(deviceId);
    } catch {}

    try {
      await authApi.logout({ device_id: deviceId });
    } catch {}

    secureStorage.delete('auth_token');
    secureStorage.delete('refresh_token');
    secureStorage.delete('user_data');
    secureStorage.delete('fcm_token');

    if (typeof onLogout === 'function') {
      onLogout();
    } else if (navigation?.navigate) {
      navigation.navigate('Login');
    }
  };

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      ScrollView,
      { style: styles.scroll },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'Settings'),
        React.createElement(
          Text,
          { style: styles.subtitle },
          'Preferences, storage, and system controls'
        )
      ),

      cacheClearMessage &&
        React.createElement(
          View,
          { style: styles.feedbackBanner },
          React.createElement(Text, { style: styles.feedbackText }, cacheClearMessage)
        ),

      // Appearance
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Appearance'),
        React.createElement(
          View,
          { style: styles.settingRow },
          React.createElement(
            View,
            { style: styles.settingInfo },
            React.createElement(Text, { style: styles.settingTitle }, 'Dark Mode'),
            React.createElement(
              Text,
              { style: styles.settingSubtitle },
              'Slate-900 / Navy OLED color theme'
            )
          ),
          React.createElement(Switch, {
            value: darkMode,
            onValueChange: handleDarkModeToggle,
            trackColor: { false: '#334155', true: '#0284c7' },
            thumbColor: darkMode ? DARK_ACCENT : '#94a3b8'
          })
        )
      ),

      // Push Notifications
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Push Notifications'),

        React.createElement(
          View,
          { style: styles.settingRow },
          React.createElement(
            View,
            { style: styles.settingInfo },
            React.createElement(Text, { style: styles.settingTitle }, 'Task Assignments & Status'),
            React.createElement(
              Text,
              { style: styles.settingSubtitle },
              'Instant FCM alerts when tasks move'
            )
          ),
          React.createElement(Switch, {
            value: notifTasks,
            onValueChange: (val) => {
              setNotifTasks(val);
              secureStorage.set('notif_tasks', val);
            },
            trackColor: { false: '#334155', true: '#0284c7' },
            thumbColor: notifTasks ? DARK_ACCENT : '#94a3b8'
          })
        ),

        React.createElement(
          View,
          { style: styles.settingRow },
          React.createElement(
            View,
            { style: styles.settingInfo },
            React.createElement(Text, { style: styles.settingTitle }, 'Sprint Milestones'),
            React.createElement(
              Text,
              { style: styles.settingSubtitle },
              'Start, complete, and velocity changes'
            )
          ),
          React.createElement(Switch, {
            value: notifSprints,
            onValueChange: (val) => {
              setNotifSprints(val);
              secureStorage.set('notif_sprints', val);
            },
            trackColor: { false: '#334155', true: '#0284c7' },
            thumbColor: notifSprints ? DARK_ACCENT : '#94a3b8'
          })
        ),

        React.createElement(
          View,
          { style: styles.settingRow },
          React.createElement(
            View,
            { style: styles.settingInfo },
            React.createElement(Text, { style: styles.settingTitle }, 'OKR At-Risk Alerts'),
            React.createElement(
              Text,
              { style: styles.settingSubtitle },
              'Confidence drop warnings'
            )
          ),
          React.createElement(Switch, {
            value: notifOkrs,
            onValueChange: (val) => {
              setNotifOkrs(val);
              secureStorage.set('notif_okrs', val);
            },
            trackColor: { false: '#334155', true: '#0284c7' },
            thumbColor: notifOkrs ? DARK_ACCENT : '#94a3b8'
          })
        ),

        React.createElement(
          View,
          { style: styles.settingRow },
          React.createElement(
            View,
            { style: styles.settingInfo },
            React.createElement(Text, { style: styles.settingTitle }, 'Approvals & Expenses'),
            React.createElement(
              Text,
              { style: styles.settingSubtitle },
              'Expense and timesheet decision alerts'
            )
          ),
          React.createElement(Switch, {
            value: notifApprovals,
            onValueChange: (val) => {
              setNotifApprovals(val);
              secureStorage.set('notif_approvals', val);
            },
            trackColor: { false: '#334155', true: '#0284c7' },
            thumbColor: notifApprovals ? DARK_ACCENT : '#94a3b8'
          })
        )
      ),

      // Storage & Cache Clear
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Local Storage & Cache'),
        React.createElement(
          View,
          { style: styles.card },
          React.createElement(Text, { style: styles.cardHeading }, 'Offline Storage Optimization'),
          React.createElement(
            Text,
            { style: styles.cardDesc },
            'Wiki pages are cached locally in SQLite with a 24-hour TTL. Offline queue items are encrypted in MMKV.'
          ),
          React.createElement(
            TouchableOpacity,
            {
              style: styles.clearCacheBtn,
              onPress: handleClearCache,
              disabled: clearing
            },
            React.createElement(
              Text,
              { style: styles.clearCacheText },
              clearing ? 'Clearing Storage...' : 'Clear Cache & Offline Queue'
            )
          )
        )
      ),

      // App Version
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Application Information'),
        React.createElement(
          View,
          { style: styles.card },
          React.createElement(
            View,
            { style: styles.infoRow },
            React.createElement(Text, { style: styles.infoLabel }, 'Platform'),
            React.createElement(Text, { style: styles.infoValue }, 'Mahi Tech Group Mobile')
          ),
          React.createElement(
            View,
            { style: styles.infoRow },
            React.createElement(Text, { style: styles.infoLabel }, 'Version'),
            React.createElement(Text, { style: styles.infoValue }, 'v1.5.0 (PRD 28 Native)')
          ),
          React.createElement(
            View,
            { style: styles.infoRow },
            React.createElement(Text, { style: styles.infoLabel }, 'Engine'),
            React.createElement(Text, { style: styles.infoValue }, 'React Native + Expo Managed')
          ),
          React.createElement(
            View,
            { style: styles.infoRow },
            React.createElement(Text, { style: styles.infoLabel }, 'Security'),
            React.createElement(Text, { style: styles.infoValue }, 'Encrypted MMKV + Server-Verified JWT')
          )
        )
      ),

      // Logout
      React.createElement(
        TouchableOpacity,
        { style: styles.logoutBtn, onPress: handleLogout },
        React.createElement(Text, { style: styles.logoutBtnText }, 'Sign Out')
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
  feedbackBanner: {
    backgroundColor: '#064e3b',
    borderWidth: 1,
    borderColor: '#059669',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16
  },
  feedbackText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center'
  },
  section: {
    marginBottom: 22
  },
  sectionTitle: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: DARK_SURFACE,
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  settingInfo: {
    flex: 1,
    marginRight: 10
  },
  settingTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600'
  },
  settingSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2
  },
  card: {
    backgroundColor: DARK_SURFACE,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardHeading: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600'
  },
  cardDesc: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18
  },
  clearCacheBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12
  },
  clearCacheText: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '600'
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  infoLabel: {
    color: '#94a3b8',
    fontSize: 13
  },
  infoValue: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '500'
  },
  logoutBtn: {
    backgroundColor: '#7f1d1d',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 36,
    borderWidth: 1,
    borderColor: '#ef4444'
  },
  logoutBtnText: {
    color: '#fef2f2',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default SettingsScreen;
