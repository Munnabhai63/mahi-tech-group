import React from 'react';
const { useState, useEffect } = React;
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DARK_BACKGROUND, DARK_SURFACE, DARK_ACCENT } from '../theme/theme.js';
import { useBiometric } from '../hooks/useBiometric.js';
import { secureStorage } from '../utils/cache.js';

export const BiometricSetupScreen = ({ onSetupComplete }) => {
  const [hardwareInfo, setHardwareInfo] = useState({ hasHardware: false, isEnrolled: false });
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const { checkHardware, authenticate } = useBiometric();

  useEffect(() => {
    checkHardware().then(setHardwareInfo);
  }, []);

  const handleEnableBiometric = async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const authRes = await authenticate('Confirm biometric enrollment for Mahi Tech Group');
      if (authRes.success) {
        secureStorage.set('biometric_enabled', 'true');
        if (typeof onSetupComplete === 'function') {
          onSetupComplete(true);
        }
      } else {
        setStatusMessage('Biometric confirmation failed. Please try again or skip.');
      }
    } catch (err) {
      setStatusMessage('Biometric enrollment error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    secureStorage.set('biometric_enabled', 'false');
    if (typeof onSetupComplete === 'function') {
      onSetupComplete(false);
    }
  };

  return React.createElement(
    View,
    { style: styles.container },
    React.createElement(
      View,
      { style: styles.card },
      React.createElement(Text, { style: styles.icon }, '🛡️'),
      React.createElement(Text, { style: styles.title }, 'Enable Biometric Unlock'),
      React.createElement(
        Text,
        { style: styles.description },
        'Secure your workspace and sign in quickly with Face ID or Fingerprint'
      ),

      statusMessage && React.createElement(Text, { style: styles.statusText }, statusMessage),

      React.createElement(
        TouchableOpacity,
        {
          style: [styles.primaryButton, loading && styles.buttonDisabled],
          onPress: handleEnableBiometric,
          disabled: loading,
          activeOpacity: 0.8
        },
        React.createElement(
          Text,
          { style: styles.primaryButtonText },
          loading ? 'Enrolling...' : 'Enable Biometrics'
        )
      ),

      React.createElement(
        TouchableOpacity,
        {
          style: styles.skipButton,
          onPress: handleSkip,
          activeOpacity: 0.8
        },
        React.createElement(Text, { style: styles.skipButtonText }, 'Skip for Now')
      )
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BACKGROUND,
    justifyContent: 'center',
    padding: 24
  },
  card: {
    backgroundColor: DARK_SURFACE,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center'
  },
  icon: {
    fontSize: 44,
    marginBottom: 16
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10
  },
  description: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24
  },
  statusText: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center'
  },
  primaryButton: {
    backgroundColor: DARK_ACCENT,
    borderRadius: 8,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12
  },
  buttonDisabled: {
    opacity: 0.6
  },
  primaryButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700'
  },
  skipButton: {
    paddingVertical: 8
  },
  skipButtonText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '500'
  }
});

export default BiometricSetupScreen;
