import React from 'react';
const { useState, useEffect, useCallback } = React;
import RN, {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl
} from 'react-native';

const Switch = RN?.Switch || ((props) => React.createElement('Switch', props, props?.children));
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { DashboardSkeleton } from '../components/SkeletonLoader.js';
import { ErrorState } from '../components/ErrorState.js';
import { authApi } from '../api/auth.api.js';
import { notificationsApi } from '../api/notifications.api.js';
import { secureStorage } from '../utils/cache.js';

export const ProfileScreen = ({
  navigation,
  onLogout,
  initialUser = null,
  isOnline = true
}) => {
  const [profile, setProfile] = useState(initialUser);
  const [serverRole, setServerRole] = useState(initialUser?.role || null);
  const [isServerVerified, setIsServerVerified] = useState(!!initialUser?.role);
  const [biometricEnabled, setBiometricEnabled] = useState(
    secureStorage.getBoolean('biometric_enabled') ?? false
  );
  const [loading, setLoading] = useState(!initialUser);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const fetchServerProfile = useCallback(async () => {
    try {
      setError(null);
      if (isOnline) {
        const res = await authApi.getMe();
        const userData = res.data?.user || res.data;
        if (userData) {
          setProfile(userData);
          setServerRole(userData.role);
          setIsServerVerified(true);
        }
      } else {
        if (!initialUser) {
          setIsServerVerified(false);
          setServerRole(null);
        }
      }
    } catch (err) {
      if (!profile) {
        setError(err.message || 'Failed to verify profile with server');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isOnline, profile, initialUser]);

  useEffect(() => {
    if (!initialUser) {
      fetchServerProfile();
    }
  }, [initialUser, fetchServerProfile]);

  const handleBiometricToggle = async (val) => {
    setBiometricEnabled(val);
    secureStorage.set('biometric_enabled', val);
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
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
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading && !profile) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.title }, 'Member Profile'),
        React.createElement(Text, { style: styles.subtitle }, 'Verifying credentials with server...')
      ),
      React.createElement(DashboardSkeleton, null)
    );
  }

  if (error && !profile) {
    return React.createElement(
      View,
      { style: styles.container },
      React.createElement(ErrorState, { message: error, onRetry: fetchServerProfile })
    );
  }

  const initials = profile?.name
    ? profile.name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase()
    : 'MT';

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
            fetchServerProfile();
          },
          tintColor: DARK_ACCENT
        })
      },
      // User Card
      React.createElement(
        View,
        { style: styles.userCard },
        React.createElement(
          View,
          { style: styles.avatar },
          React.createElement(Text, { style: styles.avatarText }, initials)
        ),
        React.createElement(Text, { style: styles.userName }, profile?.name || 'Mahi Team Member'),
        React.createElement(Text, { style: styles.userEmail }, profile?.email || 'member@mahitechgroup.com'),

        // Server-Verified Role Badge
        React.createElement(
          View,
          { style: styles.roleContainer },
          isServerVerified && serverRole
            ? React.createElement(
                View,
                { style: styles.verifiedRoleBadge },
                React.createElement(
                  Text,
                  { style: styles.verifiedRoleText },
                  `✓ ${serverRole.toUpperCase()} (Server-Verified)`
                )
              )
            : React.createElement(
                View,
                { style: styles.unverifiedRoleBadge },
                React.createElement(
                  Text,
                  { style: styles.unverifiedRoleText },
                  '⚠️ Role Verification Pending (Connect Online)'
                )
              )
        )
      ),

      // Participation & Performance Metrics
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Participation & Revenue Share'),
        React.createElement(
          View,
          { style: styles.metricsRow },
          React.createElement(
            View,
            { style: styles.metricCard },
            React.createElement(
              Text,
              { style: styles.metricValue },
              profile?.participation_pct !== undefined ? `${profile.participation_pct}%` : '100%'
            ),
            React.createElement(Text, { style: styles.metricLabel }, 'Participation')
          ),
          React.createElement(
            View,
            { style: styles.metricCard },
            React.createElement(Text, { style: styles.metricValue }, 'ACTIVE'),
            React.createElement(Text, { style: styles.metricLabel }, 'Revenue Share')
          ),
          React.createElement(
            View,
            { style: styles.metricCard },
            React.createElement(
              Text,
              { style: styles.metricValue },
              profile?.created_at ? new Date(profile.created_at).getFullYear() : '2026'
            ),
            React.createElement(Text, { style: styles.metricLabel }, 'Member Since')
          )
        )
      ),

      // Security Settings
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Security Settings'),
        React.createElement(
          View,
          { style: styles.settingRow },
          React.createElement(
            View,
            { style: styles.settingInfo },
            React.createElement(
              Text,
              { style: styles.settingTitle },
              'Biometric Lock (Face ID / Fingerprint)'
            ),
            React.createElement(
              Text,
              { style: styles.settingSubtitle },
              'Require biometric check after 5min background'
            )
          ),
          React.createElement(Switch, {
            value: biometricEnabled,
            onValueChange: handleBiometricToggle,
            trackColor: { false: '#334155', true: '#0284c7' },
            thumbColor: biometricEnabled ? DARK_ACCENT : '#94a3b8'
          })
        )
      ),

      // Logout Button
      React.createElement(
        TouchableOpacity,
        {
          style: styles.logoutBtn,
          onPress: handleLogout,
          disabled: loggingOut
        },
        React.createElement(
          Text,
          { style: styles.logoutBtnText },
          loggingOut ? 'Deactivating device & logging out...' : 'Sign Out of Device'
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
  userCard: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155'
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0369a1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12
  },
  avatarText: {
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: '700'
  },
  userName: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700'
  },
  userEmail: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 2
  },
  roleContainer: {
    marginTop: 14
  },
  verifiedRoleBadge: {
    backgroundColor: '#064e3b',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#059669'
  },
  verifiedRoleText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700'
  },
  unverifiedRoleBadge: {
    backgroundColor: '#451a03',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#b45309'
  },
  unverifiedRoleText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '600'
  },
  section: {
    marginBottom: 24
  },
  sectionTitle: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  metricCard: {
    flex: 1,
    backgroundColor: DARK_SURFACE,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  metricValue: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '700'
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 4
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: DARK_SURFACE,
    padding: 14,
    borderRadius: 10,
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
  logoutBtn: {
    backgroundColor: '#7f1d1d',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#ef4444'
  },
  logoutBtnText: {
    color: '#fef2f2',
    fontSize: 15,
    fontWeight: '700'
  }
});

export default ProfileScreen;
