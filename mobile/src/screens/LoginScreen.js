import React from 'react';
const { useState } = React;
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { useAuth } from '../hooks/useAuth.js';
import { useBiometric } from '../hooks/useBiometric.js';
import { usePushNotifications } from '../hooks/usePushNotifications.js';

export const LoginScreen = ({ onLoginSuccess, onNavigateBiometricSetup }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login } = useAuth();
  const { authenticate } = useBiometric();
  const { registerToken } = usePushNotifications();

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await login(email, password);
      // Register FCM device token with backend
      const fcmToken = `fcm_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      await registerToken(fcmToken, 'ANDROID', `device-${data.user?.id?.substring(0, 8)}`);

      if (typeof onLoginSuccess === 'function') {
        onLoginSuccess(data.user);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    setError(null);
    const authRes = await authenticate('Sign in to Mahi Tech Group');
    if (authRes.success) {
      if (typeof onLoginSuccess === 'function') {
        onLoginSuccess();
      }
    } else {
      setError('Biometric authentication failed');
    }
  };

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      View,
      { style: styles.card },
      React.createElement(Text, { style: styles.title }, 'Mahi Tech Group'),
      React.createElement(Text, { style: styles.subtitle }, 'Sign in to access your workspaces'),

      error && React.createElement(Text, { style: styles.errorText }, error),

      React.createElement(
        View,
        { style: styles.inputGroup },
        React.createElement(Text, { style: styles.label }, 'Email Address'),
        React.createElement(TextInput, {
          style: styles.input,
          value: email,
          onChangeText: setEmail,
          placeholder: 'name@mahitechgroup.com',
          placeholderTextColor: '#64748b',
          autoCapitalize: 'none',
          keyboardType: 'email-address'
        })
      ),

      React.createElement(
        View,
        { style: styles.inputGroup },
        React.createElement(Text, { style: styles.label }, 'Password'),
        React.createElement(TextInput, {
          style: styles.input,
          value: password,
          onChangeText: setPassword,
          placeholder: '••••••••',
          placeholderTextColor: '#64748b',
          secureTextEntry: true
        })
      ),

      React.createElement(
        TouchableOpacity,
        {
          style: [styles.primaryButton, loading && styles.buttonDisabled],
          onPress: handleLogin,
          disabled: loading,
          activeOpacity: 0.8
        },
        React.createElement(
          Text,
          { style: styles.primaryButtonText },
          loading ? 'Signing In...' : 'Sign In'
        )
      ),

      React.createElement(
        TouchableOpacity,
        {
          style: styles.biometricButton,
          onPress: handleBiometricLogin,
          activeOpacity: 0.8
        },
        React.createElement(Text, { style: styles.biometricButtonText }, '🔐 Sign In with Biometrics')
      )
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND,
    justifyContent: 'center',
    padding: 20
  },
  card: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155'
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center'
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center'
  },
  inputGroup: {
    marginBottom: 16
  },
  label: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6
  },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15
  },
  primaryButton: {
    backgroundColor: DARK_ACCENT,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8
  },
  buttonDisabled: {
    opacity: 0.6
  },
  primaryButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700'
  },
  biometricButton: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 10
  },
  biometricButtonText: {
    color: DARK_ACCENT,
    fontSize: 14,
    fontWeight: '600'
  }
});

export default LoginScreen;
