/**
 * Verification Suite for PRD 28 Layer 2: Auth Flow, Biometric Lock & FCM Setup
 *
 * Verifies (Real HTTP, Real SQLite DB, Zero Mocks):
 * 1. Login stores JWT in MMKV (encrypted, not AsyncStorage)
 * 2. Biometric hook triggers correctly (hardware check, enrollment, authentication)
 * 3. AppState listener triggers lock after threshold (background -> threshold elapsed -> lock)
 * 4. FCM token registration hits real API, DB row confirmed in device_tokens
 * 5. GET /api/users/me called on foreground resume (server role re-verification)
 * 6. Logout deactivates device_token row in DB (is_active = 0, session revoked)
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { secureStorage } from '../mobile/src/utils/cache.js';
import { useAuth } from '../mobile/src/hooks/useAuth.js';
import { useBiometric } from '../mobile/src/hooks/useBiometric.js';
import { useAppStateLock } from '../mobile/src/hooks/useAppStateLock.js';
import { usePushNotifications } from '../mobile/src/hooks/usePushNotifications.js';
import { config as mobileConfig } from '../mobile/src/constants/config.js';
import { LockScreen } from '../mobile/src/screens/LockScreen.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${testName} ${details ? `(${details})` : ''}`);
    passedTests++;
  } else {
    console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${testName} ${details ? `(${details})` : ''}`);
    failedTests++;
  }
}

async function runLayer2Verification() {
  console.log('\n===================================================================');
  console.log('       PRD 28 LAYER 2: AUTH, BIOMETRIC & FCM VERIFICATION');
  console.log('===================================================================\n');

  // 1. Start real HTTP test server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[TEST SERVER] Running on ${baseUrl}`);

  // Set API_BASE_URL for mobile apiClient
  mobileConfig.API_BASE_URL = baseUrl;
  process.env.API_BASE_URL = baseUrl;
  process.env.EXPO_PUBLIC_API_URL = baseUrl;

  // Re-import axios config with dynamic base URL
  const { default: apiClient } = await import('../mobile/src/api/axios.config.js');
  apiClient.defaults.baseURL = baseUrl;

  const db = getDatabase();



  // Seed test user
  const testEmail = `mobile.auth.${Date.now()}@mahitechgroup.com`;
  const testPassword = 'Password123!Secure';
  const testUserId = `usr-mobile-${Date.now().toString(36)}`;
  const passwordHash = await bcrypt.hash(testPassword, 10);

  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status)
    VALUES (?, 'Mobile Auth Lead', ?, ?, 'admin', 'active')
  `, [testUserId, testEmail, passwordHash]);

  const testDeviceId = `device-mobile-${Date.now().toString(36)}`;
  const testFcmToken = `fcm_token_real_${Date.now()}_alpha99`;

  try {
    // -----------------------------------------------------------------
    // TEST SECTION 1: Login stores JWT in MMKV (Encrypted, Zero Plaintext)
    // -----------------------------------------------------------------
    console.log('\n--- 1. Login & Encrypted MMKV Storage Verification ---');
    secureStorage.clearAll();
    assert(!secureStorage.contains('auth_token'), 'MMKV storage clean before login test');

    const auth = useAuth();
    const loginData = await auth.login(testEmail, testPassword);

    assert(Boolean(loginData.token), 'Login response contains signed JWT');
    assert(loginData.user?.email === testEmail, 'Login response user matches test user');

    const storedToken = secureStorage.getString('auth_token');
    assert(storedToken === loginData.token, 'JWT stored in MMKV matches server response');
    assert(secureStorage.isEncrypted(), 'Storage confirms AES encryption active');

    const storedUser = secureStorage.getObject('user_data');
    assert(Boolean(storedUser), 'Sanitized user profile stored in MMKV');
    assert(!storedUser.password_hash && !storedUser.password, 'Security check: Password hash NOT leaked in local storage');

    // -----------------------------------------------------------------
    // TEST SECTION 2: Biometric Hook Verification
    // -----------------------------------------------------------------
    console.log('\n--- 2. Biometric Hook & Setup Verification ---');
    const biometric = useBiometric();
    const hwCheck = await biometric.checkHardware();

    assert(hwCheck.hasHardware === true, 'Biometric hardware detection reports available');
    assert(hwCheck.isEnrolled === true, 'Biometric enrollment check reports enrolled');
    assert(Array.isArray(hwCheck.supportedTypes) && hwCheck.supportedTypes.length > 0, 'Supported authentication types returned');

    const authResult = await biometric.authenticate('Test Biometric Verification');
    assert(authResult.success === true, 'Biometric authentication prompt succeeded');

    // Simulate Biometric preference toggling
    secureStorage.set('biometric_enabled', 'true');
    assert(secureStorage.getString('biometric_enabled') === 'true', 'Biometric preference persisted in MMKV');

    // -----------------------------------------------------------------
    // TEST SECTION 3: AppState Listener & Auto-Lock Threshold
    // -----------------------------------------------------------------
    console.log('\n--- 3. AppState Background Auto-Lock Verification ---');
    let roleVerifiedCallbackFired = false;
    let verifiedUserObj = null;

    const lockThresholdTestMs = 50; // Fast threshold for unit test
    const appLock = useAppStateLock({
      lockThresholdMs: lockThresholdTestMs,
      initialLocked: false,
      onRoleVerified: (user) => {
        roleVerifiedCallbackFired = true;
        verifiedUserObj = user;
      }
    });

    assert(appLock.isLocked === false, 'Initial app lock state is unlocked');

    // Sub-threshold background test: background for 10ms (<50ms) -> should NOT lock
    await appLock.handleAppStateChange('background');
    await new Promise((r) => setTimeout(r, 10));
    await appLock.handleAppStateChange('active');
    assert(appLock.isLocked === false, 'App does NOT lock when background duration is below threshold');

    // Over-threshold background test: background for 70ms (>50ms) -> MUST lock
    await appLock.handleAppStateChange('background');
    await new Promise((r) => setTimeout(r, 70));
    await appLock.handleAppStateChange('active');
    assert(appLock.isLocked === true, 'App automatically locks when background duration exceeds threshold');

    // Verify LockScreen renders without crash
    const lockScreenTree = LockScreen({ onUnlock: appLock.unlock });
    assert(Boolean(lockScreenTree), 'LockScreen component renders without crash');

    // Test unlocking with biometrics
    const unlocked = await appLock.unlock();
    assert(unlocked === true, 'appLock.unlock() executes biometric auth and returns true');
    assert(appLock.isLocked === false, 'App state transitions back to unlocked');

    // -----------------------------------------------------------------
    // TEST SECTION 4: FCM Device Token Registration (Real API & DB)
    // -----------------------------------------------------------------
    console.log('\n--- 4. FCM Device Token Registration Verification ---');
    const push = usePushNotifications();
    const regResult = await push.registerToken(testFcmToken, 'ANDROID', testDeviceId);

    assert(regResult?.success === true, 'POST /api/mobile/device-token returned HTTP 200 success');
    assert(secureStorage.getString('fcm_token') === testFcmToken, 'FCM token stored in MMKV');
    assert(secureStorage.getString('device_id') === testDeviceId, 'device_id stored in MMKV');

    // Verify database row in device_tokens
    const dbToken = queryOne(
      'SELECT id, user_id, platform, token, fcm_token, device_id, is_active FROM device_tokens WHERE user_id = ? AND device_id = ?',
      [testUserId, testDeviceId]
    );

    assert(Boolean(dbToken), 'device_tokens row confirmed in SQLite database');
    assert(dbToken?.token === testFcmToken, 'DB token matches registered FCM token');
    assert(dbToken?.platform === 'ANDROID', 'DB platform recorded as ANDROID');
    assert(dbToken?.is_active === 1, 'DB is_active flag is 1 (active)');

    // Test upsert: re-registering with new token updates existing row
    const updatedFcmToken = `${testFcmToken}_updated`;
    await push.registerToken(updatedFcmToken, 'ANDROID', testDeviceId);

    const updatedDbToken = queryOne(
      'SELECT token, is_active FROM device_tokens WHERE user_id = ? AND device_id = ?',
      [testUserId, testDeviceId]
    );
    assert(updatedDbToken?.token === updatedFcmToken, 'Device token upsert successfully updated existing device_id');

    // -----------------------------------------------------------------
    // TEST SECTION 5: GET /api/users/me on Foreground Resume
    // -----------------------------------------------------------------
    console.log('\n--- 5. Server Role Re-Verification on Foreground Resume ---');
    roleVerifiedCallbackFired = false;
    verifiedUserObj = null;

    const resumeResult = await appLock.verifyServerRoleOnForeground();
    assert(resumeResult.verified === true, 'GET /api/users/me called successfully on foreground resume');
    assert(roleVerifiedCallbackFired === true, 'onRoleVerified callback triggered with server data');
    assert(verifiedUserObj?.id === testUserId, 'Verified user ID matches authenticated user');
    assert(verifiedUserObj?.role === 'admin', 'Verified user role matches server DB role');

    // -----------------------------------------------------------------
    // TEST SECTION 6: Logout Deactivates Device Token in DB
    // -----------------------------------------------------------------
    console.log('\n--- 6. Logout & Device Token Deactivation Verification ---');
    await auth.logout(testDeviceId);

    assert(!secureStorage.contains('auth_token'), 'auth_token wiped from MMKV on logout');
    assert(!secureStorage.contains('fcm_token'), 'fcm_token wiped from MMKV on logout');

    const postLogoutToken = queryOne(
      'SELECT is_active, updated_at FROM device_tokens WHERE user_id = ? AND device_id = ?',
      [testUserId, testDeviceId]
    );

    assert(postLogoutToken?.is_active === 0, 'device_tokens row is_active set to 0 on logout');

    // Clean up test data
    execute('DELETE FROM device_tokens WHERE user_id = ?', [testUserId]);
    execute("UPDATE users SET status = 'inactive' WHERE id = ?", [testUserId]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('[TEST SERVER] Closed cleanly');
  }

  // -----------------------------------------------------------------
  // Summary & Exit
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log(`PRD 28 LAYER 2 SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('===================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer2Verification().catch((err) => {
  console.error('Fatal Layer 2 verification error:', err);
  process.exit(1);
});
