import http from 'node:http';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';

const TEST_PORT = 4999;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runAllTests() {
  console.log('\n===================================================================');
  console.log('       RUNNING COMPREHENSIVE E2E VERIFICATION SUITE — STEP 01');
  console.log('===================================================================\n');

  // 1. Setup DB
  runMigration();
  await runSeed();

  // 2. Start Test Server
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`[TEST SERVER] Running on ${BASE_URL}\n`);

  const results = [];

  try {
    // -----------------------------------------------------------------
    // TEST 1: Health Check
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Health Check (GET /api/health) ---');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthRes.json();
    console.log('Status:', healthRes.status);
    console.log('Response:', JSON.stringify(healthData, null, 2));
    if (healthRes.status !== 200) throw new Error('Health check failed');
    results.push({ test: 'Health Check', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 2: Admin Login Success (POST /api/auth/login)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Admin Login Success (POST /api/auth/login) ---');
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@mahitechgroup.com',
        password: 'AdminPassword@2026'
      })
    });
    const adminLoginData = await adminLoginRes.json();
    console.log('Status:', adminLoginRes.status);
    console.log('Response:', JSON.stringify(adminLoginData, null, 2));
    if (adminLoginRes.status !== 200 || !adminLoginData.token) throw new Error('Admin login failed');
    const adminToken = adminLoginData.token;
    results.push({ test: 'Admin Login Success', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 3: Login Failure on Bad Password
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Login Failure on Bad Password ---');
    const badLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@mahitechgroup.com',
        password: 'WrongPassword999'
      })
    });
    const badLoginData = await badLoginRes.json();
    console.log('Status:', badLoginRes.status);
    console.log('Response:', JSON.stringify(badLoginData, null, 2));
    if (badLoginRes.status !== 401) throw new Error('Expected 401 on bad password');
    results.push({ test: 'Login Invalid Credentials Blocked', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 4: Admin Adds Member (POST /api/admin/members/add)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Admin Adds New Member - Researcher (POST /api/admin/members/add) ---');
    const timestamp = Date.now();
    const researcherEmail = `researcher.arjun.${timestamp}@mahitechgroup.com`;
    const researcherPassword = 'ResearcherSecret123!';
    const devEmail = `dev.riya.${timestamp}@mahitechgroup.com`;

    const addMemberRes = await fetch(`${BASE_URL}/api/admin/members/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Arjun Sen',
        email: researcherEmail,
        role: 'researcher',
        sub_role: null,
        temporary_password: researcherPassword
      })
    });
    const addMemberData = await addMemberRes.json();
    console.log('Status:', addMemberRes.status);
    console.log('Response:', JSON.stringify(addMemberData, null, 2));
    if (addMemberRes.status !== 201 || !addMemberData.user.id) throw new Error('Add member failed');
    const researcherId = addMemberData.user.id;
    results.push({ test: 'Admin Adds Member (Researcher)', status: 'PASS' });

    // Also add a developer to test developer role & deactivation
    const devPassword = 'DevPassword123!';
    const addDevRes = await fetch(`${BASE_URL}/api/admin/members/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Riya Sharma',
        email: devEmail,
        role: 'developer',
        sub_role: 'frontend',
        temporary_password: devPassword
      })
    });
    const addDevData = await addDevRes.json();
    const devId = addDevData.user.id;
    console.log(`Added Developer (id: ${devId}, sub_role: frontend)`);

    // -----------------------------------------------------------------
    // TEST 5: Researcher Logs In
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Researcher Login Success ---');
    const resLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: researcherEmail,
        password: researcherPassword
      })
    });
    const resLoginData = await resLoginRes.json();
    console.log('Status:', resLoginRes.status);
    console.log('Response:', JSON.stringify(resLoginData, null, 2));
    if (resLoginRes.status !== 200 || !resLoginData.token) throw new Error('Researcher login failed');
    const researcherToken = resLoginData.token;
    results.push({ test: 'Researcher Login', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 6: RBAC Protection - Researcher Attempts Admin Endpoint
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: RBAC Violation Check - Researcher calls /api/admin/members/add ---');
    const rbacDeniedRes = await fetch(`${BASE_URL}/api/admin/members/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${researcherToken}`
      },
      body: JSON.stringify({
        name: 'Illegal User',
        email: 'illegal@mahitechgroup.com',
        role: 'researcher'
      })
    });
    const rbacDeniedData = await rbacDeniedRes.json();
    console.log('Status:', rbacDeniedRes.status);
    console.log('Response:', JSON.stringify(rbacDeniedData, null, 2));
    if (rbacDeniedRes.status !== 403) throw new Error('Expected 403 Forbidden for RBAC violation');
    results.push({ test: 'RBAC 403 Forbidden on Unauthorized Role', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 7: Get Self Profile & Permissions (GET /api/users/me)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Get Self Profile & Permissions (GET /api/users/me) ---');
    const profileRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${researcherToken}` }
    });
    const profileData = await profileRes.json();
    console.log('Status:', profileRes.status);
    console.log('Response:', JSON.stringify(profileData, null, 2));
    if (profileRes.status !== 200 || profileData.user.email !== researcherEmail) throw new Error('Profile fetch failed');
    results.push({ test: 'Fetch Self Profile & Permissions (GET /api/users/me)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 8: Admin Lists All Members (GET /api/admin/members)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 8: Admin Lists All Members (GET /api/admin/members) ---');
    const listRes = await fetch(`${BASE_URL}/api/admin/members`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const listData = await listRes.json();
    console.log('Status:', listRes.status);
    console.log(`Total Members Found: ${listData.members?.length}`);
    console.log('Members sample:', JSON.stringify(listData.members.map(m => ({ id: m.id, name: m.name, role: m.role, status: m.status })), null, 2));
    if (listRes.status !== 200 || !listData.members || listData.members.length < 3) throw new Error('Admin member list failed');
    results.push({ test: 'Admin List Members (GET /api/admin/members)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 9: Refresh Token (POST /api/auth/refresh)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 9: Token Refresh (POST /api/auth/refresh) ---');
    const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${researcherToken}` }
    });
    const refreshData = await refreshRes.json();
    console.log('Status:', refreshRes.status);
    console.log('Response:', JSON.stringify(refreshData, null, 2));
    if (refreshRes.status !== 200 || !refreshData.token) throw new Error('Token refresh failed');
    const refreshedToken = refreshData.token;
    results.push({ test: 'Token Refresh (POST /api/auth/refresh)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 10: Change Password with Before & After Hash Comparison
    // -----------------------------------------------------------------
    console.log('\n--- TEST 10: Change Password (PATCH /api/users/me/password) ---');
    const userBefore = queryOne('SELECT password_hash FROM users WHERE id = ?', [researcherId]);
    console.log('Database password_hash BEFORE change:', userBefore.password_hash);

    const newResearcherPassword = 'NewSecretPassword2026!';
    const changePassRes = await fetch(`${BASE_URL}/api/users/me/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refreshedToken}`
      },
      body: JSON.stringify({
        current_password: researcherPassword,
        new_password: newResearcherPassword
      })
    });
    const changePassData = await changePassRes.json();
    console.log('Status:', changePassRes.status);
    console.log('Response:', JSON.stringify(changePassData, null, 2));
    if (changePassRes.status !== 200) throw new Error('Password change failed');

    const userAfter = queryOne('SELECT password_hash FROM users WHERE id = ?', [researcherId]);
    console.log('Database password_hash AFTER change:', userAfter.password_hash);

    if (userBefore.password_hash === userAfter.password_hash) {
      throw new Error('Hash comparison failure: Password hash did not change!');
    }
    console.log('Verification: Password hashes are strictly different!');
    results.push({ test: 'Password Update & Hash Transition Verification', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 11: Logout with Database is_revoked Verification
    // -----------------------------------------------------------------
    console.log('\n--- TEST 11: Logout and Session Invalidation ---');
    // Find researcher's active session
    const sessionBefore = queryOne('SELECT id, is_revoked, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC', [researcherId]);
    console.log('Database Session BEFORE Logout:');
    console.log(JSON.stringify(sessionBefore, null, 2));

    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${refreshedToken}` }
    });
    const logoutData = await logoutRes.json();
    console.log('Logout Status:', logoutRes.status);
    console.log('Logout Response:', JSON.stringify(logoutData, null, 2));

    const sessionAfter = queryOne('SELECT id, is_revoked, expires_at FROM sessions WHERE id = ?', [sessionBefore.id]);
    console.log('Database Session AFTER Logout:');
    console.log(JSON.stringify(sessionAfter, null, 2));

    if (sessionAfter.is_revoked !== 1 && sessionAfter.is_revoked !== true) {
      throw new Error('Logout verification failed: is_revoked is not 1');
    }

    // Now attempt to use that revoked token to access /api/users/me -> MUST return 401
    const testRevokedRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${refreshedToken}` }
    });
    const testRevokedData = await testRevokedRes.json();
    console.log('Attempt to use Revoked Token Status:', testRevokedRes.status);
    console.log('Attempt to use Revoked Token Response:', JSON.stringify(testRevokedData, null, 2));
    if (testRevokedRes.status !== 401) throw new Error('Expected 401 Unauthorized for revoked session');
    results.push({ test: 'Session Revocation & Post-Logout 401 Block', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 12: Member Deactivation (Soft Inactive) & Login Blocked
    // -----------------------------------------------------------------
    console.log('\n--- TEST 12: Soft Deactivation & Login Blocked Verification ---');
    // Developer logs in first to get an active session
    const devLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: devEmail, password: devPassword })
    });
    const devLoginData = await devLoginRes.json();
    const devToken = devLoginData.token;
    console.log('Developer logged in with active token.');

    // Admin deactivates Developer: PATCH /api/admin/members/:id/status
    const deactivateRes = await fetch(`${BASE_URL}/api/admin/members/${devId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'inactive' })
    });
    const deactivateData = await deactivateRes.json();
    console.log('Deactivation Status:', deactivateRes.status);
    console.log('Deactivation Response:', JSON.stringify(deactivateData, null, 2));

    // Confirm in database: status is 'inactive', deactivated_at is NOT NULL, record still exists (NO DELETE)
    const dbDev = queryOne('SELECT id, name, status, deactivated_at FROM users WHERE id = ?', [devId]);
    console.log('Database User Record (Soft Deactivated):', JSON.stringify(dbDev, null, 2));
    if (!dbDev || dbDev.status !== 'inactive' || !dbDev.deactivated_at) {
      throw new Error('Soft deactivation database state failed');
    }

    // Now Developer attempts to login -> MUST FAIL with 403 Forbidden "Access Revoked"
    console.log('\nAttempting login with Deactivated account:');
    const blockedLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: devEmail, password: devPassword })
    });
    const blockedLoginData = await blockedLoginRes.json();
    console.log('Blocked Login Status:', blockedLoginRes.status);
    console.log('Blocked Login Response:', JSON.stringify(blockedLoginData, null, 2));
    if (blockedLoginRes.status !== 403 || blockedLoginData.error !== 'Access Revoked') {
      throw new Error('Expected 403 Access Revoked for inactive user login');
    }

    // Developer attempts to use prior token -> MUST FAIL with 401
    const blockedTokenRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${devToken}` }
    });
    const blockedTokenData = await blockedTokenRes.json();
    console.log('Prior Token Access Status:', blockedTokenRes.status);
    console.log('Prior Token Access Response:', JSON.stringify(blockedTokenData, null, 2));
    if (blockedTokenRes.status !== 401) throw new Error('Expected 401 for deactivated user session');

    results.push({ test: 'Soft Deactivation & Login Blocked (403 Access Revoked)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 13: Access Log Audit Trail Verification
    // -----------------------------------------------------------------
    console.log('\n--- TEST 13: Access Log Audit Trail Verification ---');
    const logs = queryAll('SELECT action, resource, ip_address, timestamp FROM access_log ORDER BY timestamp DESC LIMIT 8');
    console.log('Latest 8 Audit Log Entries:');
    console.log(JSON.stringify(logs, null, 2));
    if (logs.length === 0) throw new Error('Access log is empty');
    results.push({ test: 'Access Log Audit Trail Recording', status: 'PASS' });

    console.log('\n===================================================================');
    console.log('                ALL 13 TEST SUITES PASSED CLEANLY');
    console.log('===================================================================\n');
    console.table(results);

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('[TEST SERVER] Closed.\n');
  }
}

runAllTests().then(() => {
  console.log('Test suite run finished successfully.');
  process.exit(0);
}).catch((err) => {
  console.error('\nTest suite execution FAILED:', err);
  process.exit(1);
});
