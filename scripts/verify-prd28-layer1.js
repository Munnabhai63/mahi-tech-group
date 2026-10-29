/**
 * Verification Suite for PRD 28 Layer 1: Mobile App (React Native) Foundation
 *
 * Verifies:
 * 1. device_tokens table exists with required columns (user_id, platform, token, is_active, created_at, updated_at)
 * 2. MMKV encrypted storage initializes without error (AES encryption, get/set/delete, no plaintext)
 * 3. Theme tokens file exports correct values (#0f172a, #1e293b, #38bdf8)
 * 4. Navigation shell renders without crash (Auth stack + Main 5 bottom tabs + deep linking)
 * 5. No AsyncStorage imports anywhere in codebase (Zero plaintext AsyncStorage)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, queryAll, execute } from '../src/db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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

async function runLayer1Verification() {
  console.log('\n===================================================================');
  console.log('       PRD 28 LAYER 1: MOBILE APP FOUNDATION VERIFICATION');
  console.log('===================================================================\n');

  // -----------------------------------------------------------------
  // 1. Database Schema: device_tokens table
  // -----------------------------------------------------------------
  console.log('\n--- 1. SQLite Schema: device_tokens Table Verification ---');
  try {
    const db = getDatabase();
    const tableExists = queryAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='device_tokens';"
    );
    assert(tableExists.length > 0, 'device_tokens table exists in database');

    const columns = queryAll('PRAGMA table_info(device_tokens);');
    const colNames = columns.map(c => c.name);
    console.log(`  Found columns: [${colNames.join(', ')}]`);

    const requiredCols = ['user_id', 'platform', 'token', 'is_active', 'created_at', 'updated_at'];
    for (const reqCol of requiredCols) {
      assert(colNames.includes(reqCol), `Column "${reqCol}" present in device_tokens`);
    }

    // Check optional compatibility columns
    assert(colNames.includes('fcm_token'), 'Column "fcm_token" present');
    assert(colNames.includes('device_id'), 'Column "device_id" present');

    // Test inserting and querying a sample device token
    const testUserId = 'test-mobile-user-001';
    // Ensure parent user exists for FK constraint
    const existingUser = queryAll("SELECT id FROM users WHERE id IS NOT NULL AND id != '' LIMIT 1");
    const targetUserId = existingUser.length > 0 ? existingUser[0].id : testUserId;

    if (existingUser.length === 0) {
      execute(
        "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, 'Mobile Tester', 'mobile@test.com', 'hash', 'developer')",
        [targetUserId]
      );
    }

    execute(
      "INSERT OR REPLACE INTO device_tokens (user_id, platform, token, fcm_token, device_id, is_active) VALUES (?, 'ANDROID', 'test-token-123', 'fcm-token-123', 'dev-uuid-1', 1)",
      [targetUserId]
    );

    const inserted = queryAll(
      "SELECT user_id, platform, token, is_active FROM device_tokens WHERE device_id = 'dev-uuid-1'"
    );
    assert(inserted.length > 0, 'Device token upsert succeeded');
    assert(inserted[0].token === 'test-token-123', 'Retrieved token matches inserted value');

    // Clean up test token
    execute("DELETE FROM device_tokens WHERE device_id = 'dev-uuid-1'");
  } catch (err) {
    assert(false, 'Database table verification failed with exception', err.message);
  }

  // -----------------------------------------------------------------
  // 2. Encrypted MMKV Storage Verification
  // -----------------------------------------------------------------
  console.log('\n--- 2. Encrypted MMKV Local Storage Verification ---');
  try {
    const { secureStorage, mmkvInstance, ENCRYPTION_KEY } = await import('../mobile/src/utils/cache.js');

    assert(Boolean(secureStorage), 'secureStorage wrapper module imported successfully');
    assert(Boolean(mmkvInstance), 'MMKV storage instance initialized');
    assert(secureStorage.isEncrypted(), 'MMKV encryption is active (isEncrypted === true)');
    assert(Boolean(ENCRYPTION_KEY), 'Encryption key configured from environment or default salt');

    // Test writing and reading string
    secureStorage.set('auth_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.encrypted.token');
    const retrievedToken = secureStorage.getString('auth_token');
    assert(retrievedToken === 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.encrypted.token', 'Encrypted string stored and retrieved accurately');

    // Test writing and reading object
    const testUser = { id: 'usr_abc', name: 'Mobile Lead', role: 'admin' };
    secureStorage.setObject('user_profile', testUser);
    const retrievedUser = secureStorage.getObject('user_profile');
    assert(retrievedUser?.name === 'Mobile Lead', 'JSON object serialized, encrypted, and deserialized accurately');

    // Test contains and delete
    assert(secureStorage.contains('auth_token'), 'Storage contains key "auth_token"');
    secureStorage.delete('auth_token');
    assert(!secureStorage.contains('auth_token'), 'Key "auth_token" deleted successfully');
    secureStorage.delete('user_profile');
  } catch (err) {
    assert(false, 'MMKV storage verification failed with exception', err.message);
  }

  // -----------------------------------------------------------------
  // 3. Theme Tokens Verification
  // -----------------------------------------------------------------
  console.log('\n--- 3. Dark Theme Tokens (#0f172a, #1e293b, #38bdf8) Verification ---');
  try {
    const themeModule = await import('../mobile/src/theme/theme.js');

    assert(themeModule.DARK_BACKGROUND === '#0f172a', 'DARK_BACKGROUND token is #0f172a');
    assert(themeModule.DARK_SURFACE === '#1e293b', 'DARK_SURFACE token is #1e293b');
    assert(themeModule.DARK_ACCENT === '#38bdf8', 'DARK_ACCENT token is #38bdf8');

    const darkTokens = themeModule.darkTokens;
    assert(darkTokens?.background === '#0f172a', 'darkTokens.background is #0f172a');
    assert(darkTokens?.surface === '#1e293b' || darkTokens?.card === '#1e293b', 'darkTokens.surface/card is #1e293b');
    assert(darkTokens?.accent === '#38bdf8' || darkTokens?.primary === '#38bdf8', 'darkTokens.accent/primary is #38bdf8');

    const darkTheme = themeModule.darkTheme;
    assert(darkTheme?.colors?.background === '#0f172a', 'darkTheme.colors.background is #0f172a');
    assert(darkTheme?.colors?.surface === '#1e293b' || darkTheme?.colors?.card === '#1e293b', 'darkTheme.colors.surface is #1e293b');
    assert(darkTheme?.colors?.primary === '#38bdf8' || darkTheme?.colors?.accent === '#38bdf8', 'darkTheme.colors.primary/accent is #38bdf8');

    const lightTheme = themeModule.lightTheme;
    assert(Boolean(lightTheme), 'lightTheme exported for theme switching');
    assert(lightTheme?.colors?.background !== darkTheme?.colors?.background, 'Light and dark themes have distinct background palettes');
  } catch (err) {
    assert(false, 'Theme tokens verification failed with exception', err.message);
  }

  // -----------------------------------------------------------------
  // 4. Base Navigation Shell Verification
  // -----------------------------------------------------------------
  console.log('\n--- 4. Base Navigation Shell (Bottom Tabs + Stack) Verification ---');
  try {
    const { AppNavigator } = await import('../mobile/src/navigation/AppNavigator.js');
    const { AuthNavigator } = await import('../mobile/src/navigation/AuthNavigator.js');
    const { MainNavigator } = await import('../mobile/src/navigation/MainNavigator.js');
    const { linkingConfig } = await import('../mobile/src/navigation/deepLinking.js');

    assert(typeof AppNavigator === 'function', 'AppNavigator is a callable React component');
    assert(typeof AuthNavigator === 'function', 'AuthNavigator is a callable React component');
    assert(typeof MainNavigator === 'function', 'MainNavigator is a callable React component');

    // Render AuthNavigator stack
    const authTree = AuthNavigator();
    assert(Boolean(authTree), 'AuthNavigator renders without crash');

    // Render MainNavigator bottom tabs
    const mainTree = MainNavigator();
    assert(Boolean(mainTree), 'MainNavigator renders without crash');

    // Check bottom tabs children (5 tabs: Home, Projects, Notifications, My Work, Profile)
    const tabChildren = mainTree.props?.children || [];
    const tabScreens = Array.isArray(tabChildren) ? tabChildren : [tabChildren];
    const tabNames = tabScreens.map(s => s.props?.name).filter(Boolean);
    console.log(`  Bottom tabs configured: [${tabNames.join(', ')}]`);

    const expectedTabs = ['Home', 'Projects', 'Notifications', 'MyWork', 'Profile'];
    for (const tab of expectedTabs) {
      assert(tabNames.includes(tab), `Bottom Tab "${tab}" configured in MainNavigator`);
    }

    // Render Root AppNavigator for unauthenticated state
    const appUnauthTree = AppNavigator({ isAuthenticated: false });
    assert(Boolean(appUnauthTree), 'AppNavigator renders unauthenticated state without crash');

    // Render Root AppNavigator for authenticated state
    const appAuthTree = AppNavigator({ isAuthenticated: true });
    assert(Boolean(appAuthTree), 'AppNavigator renders authenticated state without crash');

    // Verify deep linking prefix and routes
    assert(Array.isArray(linkingConfig.prefixes) && linkingConfig.prefixes.includes('mahitech://'), 'Deep linking scheme "mahitech://" configured');
  } catch (err) {
    assert(false, 'Navigation shell verification failed with exception', err.message);
  }

  // -----------------------------------------------------------------
  // 5. Zero Plaintext AsyncStorage Codebase Audit
  // -----------------------------------------------------------------
  console.log('\n--- 5. Zero AsyncStorage Codebase Audit ---');
  try {
    const sourceExts = ['.js', '.jsx', '.ts', '.tsx'];
    const ignoredDirs = ['node_modules', '.git', 'dist', '.expo', 'artifacts', 'docs'];
    const asyncStorageViolations = [];

    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!ignoredDirs.includes(entry.name)) {
            scanDir(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (sourceExts.includes(ext) && entry.name !== 'verify-prd28-layer1.js') {
            const filePath = path.join(dir, entry.name);
            const content = fs.readFileSync(filePath, 'utf8');
            // Check for actual AsyncStorage import statements (not comments)
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              const trimmed = line.trim();
              if (
                !trimmed.startsWith('//') &&
                !trimmed.startsWith('*') &&
                !trimmed.startsWith('/*') &&
                (trimmed.includes('@react-native-async-storage/async-storage') ||
                 (trimmed.includes('AsyncStorage') && (trimmed.includes('import ') || trimmed.includes('require('))))
              ) {
                asyncStorageViolations.push({
                  file: path.relative(rootDir, filePath),
                  line: idx + 1,
                  content: trimmed
                });
              }
            });
          }
        }
      }
    }

    scanDir(rootDir);

    if (asyncStorageViolations.length > 0) {
      console.error('  AsyncStorage Violations detected:');
      asyncStorageViolations.forEach(v => {
        console.error(`    ${v.file}:${v.line} -> ${v.content}`);
      });
    }

    assert(
      asyncStorageViolations.length === 0,
      'Zero plaintext AsyncStorage imports anywhere in codebase',
      `Found ${asyncStorageViolations.length} violations`
    );
  } catch (err) {
    assert(false, 'AsyncStorage audit failed with exception', err.message);
  }

  // -----------------------------------------------------------------
  // Summary & Exit Code
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log(`VERIFICATION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('===================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer1Verification().catch((err) => {
  console.error('Fatal verification runner error:', err);
  process.exit(1);
});
