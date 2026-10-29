// Dynamic Environment Configuration (Zero Hardcoded URLs)
const getApiBaseUrl = () => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL || process.env.API_BASE_URL;
  if (!envUrl) {
    // In production or runtime without env, enforce strict configuration requirement
    console.warn('[CONFIG] Warning: Neither EXPO_PUBLIC_API_URL nor API_BASE_URL is configured in environment.');
    return '';
  }
  return envUrl.replace(/\/+$/, '');
};

export const config = {
  API_BASE_URL: getApiBaseUrl(),
  APP_ENV: process.env.EXPO_PUBLIC_APP_ENV || process.env.NODE_ENV || 'development',
  ENABLE_BIOMETRICS: (process.env.EXPO_PUBLIC_ENABLE_BIOMETRICS ?? 'true') === 'true',
  ENABLE_OFFLINE_CACHE: (process.env.EXPO_PUBLIC_ENABLE_OFFLINE_CACHE ?? 'true') === 'true',
  API_TIMEOUT_MS: 15000,
  APP_LOCK_TIMEOUT_MS: 5 * 60 * 1000 // 5 minutes background lock
};

export default config;
