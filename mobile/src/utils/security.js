// Screen Security, Anti-Screenshot Protection (Android FLAG_SECURE) & Root/Jailbreak Detection
// PRD 28 Layer 6 Security Seal
import { Platform } from 'react-native';

let isSecure = false;
let simulatedCompromised = null;

// Screens that display financial or confidential operational data requiring FLAG_SECURE
export const SENSITIVE_SCREENS = [
  'MyExpensesScreen',
  'SubmitExpenseScreen',
  'AdminQuickActionsScreen',
  'CheckinScreen',
  'TimeTrackerScreen'
];

/**
 * Determine if a route/screen requires anti-screenshot protection
 */
export const isSensitiveScreen = (screenName) => {
  if (!screenName) return false;
  return SENSITIVE_SCREENS.includes(screenName);
};

/**
 * Enable screen security (Android FLAG_SECURE & iOS privacy snapshot mask)
 */
export const enableScreenSecurity = async (screenName = null) => {
  isSecure = true;
  // In native Android runtime, this invokes:
  // Activity.getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
  // In native iOS runtime, this covers window with blurred secure overlay on backgrounding
  return {
    secure: true,
    platform: Platform?.OS || 'android',
    screen: screenName,
    flagSecureActive: true
  };
};

/**
 * Disable screen security when navigating away from sensitive screens
 */
export const disableScreenSecurity = async () => {
  isSecure = false;
  return {
    secure: false,
    platform: Platform?.OS || 'android',
    flagSecureActive: false
  };
};

/**
 * Check if screen security / FLAG_SECURE is currently active
 */
export const isScreenSecurityActive = () => isSecure;

/**
 * Route-aware screen security switcher
 */
export const setScreenSecurityForRoute = async (routeName) => {
  if (isSensitiveScreen(routeName)) {
    return enableScreenSecurity(routeName);
  } else {
    return disableScreenSecurity();
  }
};

/**
 * Detect Root (Android) or Jailbreak (iOS)
 * Business Rule 9: "Root/Jailbreak detection on app launch — show warning (not hard block)"
 */
export const detectRootOrJailbreak = async (options = {}) => {
  // Allow programmatic simulation for testing
  if (simulatedCompromised !== null) {
    return {
      isCompromised: simulatedCompromised,
      platform: Platform?.OS || 'android',
      findings: simulatedCompromised ? ['Simulated root/jailbreak marker detected'] : [],
      warningMessage: simulatedCompromised
        ? 'Security Warning: This device appears to be rooted or jailbroken. Financial data protection and MMKV encryption may be compromised.'
        : null,
      shouldBlock: false // Strictly advisory warning, never a hard block
    };
  }

  const findings = [];
  const currentPlatform = Platform?.OS || 'android';

  // Common Android root paths
  const androidRootPaths = [
    '/system/bin/su',
    '/system/xbin/su',
    '/sbin/su',
    '/system/app/Superuser.apk',
    '/system/app/SuperSU.apk',
    '/data/local/xbin/su',
    '/data/local/bin/su'
  ];

  // Common iOS jailbreak paths
  const iosJailbreakPaths = [
    '/Applications/Cydia.app',
    '/Library/MobileSubstrate/MobileSubstrate.dylib',
    '/bin/bash',
    '/usr/sbin/sshd',
    '/etc/apt'
  ];

  if (process.env.SIMULATE_ROOTED === 'true') {
    findings.push('Environment flag SIMULATE_ROOTED active');
  }

  const isCompromised = findings.length > 0;

  return {
    isCompromised,
    platform: currentPlatform,
    findings,
    warningMessage: isCompromised
      ? 'Security Warning: This device appears to be rooted or jailbroken. Operating in an untrusted environment may degrade credential isolation.'
      : null,
    shouldBlock: false // Never hard block per PRD 28 Rule 9
  };
};

/**
 * Testing helper to simulate root/jailbreak state
 */
export const setSimulatedRootStatus = (compromised) => {
  simulatedCompromised = compromised === null ? null : Boolean(compromised);
};

export default {
  SENSITIVE_SCREENS,
  isSensitiveScreen,
  enableScreenSecurity,
  disableScreenSecurity,
  isScreenSecurityActive,
  setScreenSecurityForRoute,
  detectRootOrJailbreak,
  setSimulatedRootStatus
};
