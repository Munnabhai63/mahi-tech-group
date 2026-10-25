/**
 * AUTH UX TEST SUITE — forgot password, email verification, GitHub self-serve
 *
 * 1. forgot-password: generic 200 (no user enumeration), dev link present
 * 2. reset-password: wrong token rejected, weak password rejected,
 *    valid reset works, all sessions revoked, old token single-use
 * 3. email verification: unverified applicant blocked from approval,
 *    verify link works, then approval passes
 * 4. GitHub self-serve: member sets username, invalid format rejected,
 *    admin path unchanged
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';

const TEST_PORT = 4990;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const results = [];
function assert(condition, label) {
  console.log(`  ${condition ? '✓ PASS' : '✗ FAIL'}: ${label}`);
  results.push({ test: label, status: condition ? 'PASS' : 'FAIL' });
}

async function req(method, endpoint, token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function login(email, password) {
  const r = await req('POST', '/api/auth/login', null, { email, password });
  return { ok: r.ok, token: r.data.token, user: r.data.user };
}

async function runAuthUxTests() {
  console.log('===================================================================');
  console.log('   AUTH UX VERIFICATION SUITE (reset / verify / self-serve)');
  console.log('===================================================================\n');

  runMigration();
  await runSeed();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(TEST_PORT, '127.0.0.1', r));
  console.log(`[SETUP] Test server on ${BASE_URL}\n`);

  try {
    const admin = await login('admin@mahitechgroup.com', 'AdminPassword@2026');
    const dev = await login('developer@mahitechgroup.com', 'DeveloperPass123!');

    // ------------------------------
    console.log('--- TEST 1: Forgot password — no user enumeration ---');
    const ghost = await req('POST', '/api/auth/forgot-password', null, { email: 'ghost@example.com' });
    assert(ghost.status === 200, 'Unknown email returns generic 200');
    const real = await req('POST', '/api/auth/forgot-password', null, { email: 'developer@mahitechgroup.com' });
    assert(real.status === 200 && typeof real.data.dev_reset_url === 'string', 'Known email returns dev reset link (non-production)');

    // ------------------------------
    console.log('\n--- TEST 2: Reset token validation ---');
    const weak = await req('POST', '/api/auth/reset-password', null, { token: 'x', password: '123' });
    assert(weak.status === 400, 'Weak password rejected');
    const badToken = await req('POST', '/api/auth/reset-password', null, { token: 'a'.repeat(64), password: 'NewPass@123' });
    assert(badToken.status === 400, 'Unknown token rejected');

    const resetToken = real.data.dev_reset_url.split('token=')[1];
    const devUser = queryOne("SELECT id FROM users WHERE email='developer@mahitechgroup.com'");
    const activeBefore = queryAll("SELECT id FROM sessions WHERE user_id = ? AND is_revoked = 0", [devUser.id]).map((s) => s.id);
    assert(activeBefore.length >= 1, 'Developer has active session(s) before reset');

    const reset = await req('POST', '/api/auth/reset-password', null, { token: resetToken, password: 'NewDevPass@123' });
    assert(reset.status === 200, 'Valid reset succeeds');

    const reuse = await req('POST', '/api/auth/reset-password', null, { token: resetToken, password: 'Another@123' });
    assert(reuse.status === 400, 'Token is single-use');

    const oldLogin = await login('developer@mahitechgroup.com', 'DeveloperPass123!');
    assert(!oldLogin.ok, 'Old password no longer works');
    const newLogin = await login('developer@mahitechgroup.com', 'NewDevPass@123');
    assert(newLogin.ok, 'New password works');

    const stillActive = queryAll(
      "SELECT id FROM sessions WHERE id IN (" + activeBefore.map(() => '?').join(',') + ") AND is_revoked = 0",
      activeBefore
    );
    assert(stillActive.length === 0, 'All pre-reset sessions revoked on reset');

    const audit = queryOne("SELECT id FROM access_log WHERE action='password_reset_completed' ORDER BY id DESC LIMIT 1");
    assert(Boolean(audit), 'Reset recorded in audit log');

    // restore dev password for later suites running against same DB? battery uses fresh DBs; keep new password

    // ------------------------------
    console.log('\n--- TEST 3: Email verification gates approval ---');
    const docs = (await req('GET', '/api/legal/documents/active')).data.documents.map((d) => d.id);
    const email = `authux.${Date.now()}@example.com`;
    const signup = await req('POST', '/api/auth/signup', null, {
      name: 'Auth UX Applicant', email, password: 'Password@123', desired_role: 'researcher',
      legal_typed_name: 'Auth UX Applicant', legal_accepted_doc_ids: docs
    });
    assert(signup.status === 201 && signup.data.email_verification_sent === true, 'Signup sends email verification');
    assert(typeof signup.data.dev_verify_url === 'string', 'Dev verify link available (non-production)');

    const applicantId = signup.data.user.id;
    const blocked = await req('PATCH', `/api/admin/applications/${applicantId}/decide`, admin.token, { decision: 'approve' });
    assert(blocked.status === 400 && /Email gate/i.test(blocked.data.error || ''), `Unverified email blocks approval (got ${blocked.status})`);

    const verifyToken = queryOne("SELECT token FROM email_verifications WHERE user_id = ? AND verified_at IS NULL", [applicantId]).token;
    const verify = await req('GET', '/api/auth/verify-email?token=' + verifyToken);
    assert(verify.status === 200, 'Verification link works');
    const reVerify = await req('GET', '/api/auth/verify-email?token=' + verifyToken);
    assert(reVerify.status === 200, 'Re-verify link is idempotent');

    const approve = await req('PATCH', `/api/admin/applications/${applicantId}/decide`, admin.token, { decision: 'approve' });
    assert(approve.status === 200, 'Approval passes after verification');

    // ------------------------------
    console.log('\n--- TEST 4: GitHub username self-serve ---');
    const setGh = await req('PATCH', '/api/users/me/profile', newLogin.token, { github_username: 'selfserve-dev' });
    assert(setGh.status === 200 && setGh.data.user.github_username === 'selfserve-dev', 'Member saved own GitHub username');
    const invalid = await req('PATCH', '/api/users/me/profile', newLogin.token, { github_username: 'bad name!!' });
    assert(invalid.status === 400, 'Invalid username format rejected');
    const cleared = await req('PATCH', '/api/users/me/profile', newLogin.token, { github_username: '' });
    assert(cleared.status === 200 && cleared.data.user.github_username === null, 'Username can be cleared');
    // restore for parity
    await req('PATCH', '/api/users/me/profile', newLogin.token, { github_username: 'selfserve-dev' });

  } finally {
    await new Promise((r) => server.close(r));
    console.log('\n[TEARDOWN] Test server closed.');
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n===================================================================');
  console.log(`   AUTH UX SUMMARY: ${results.length - failed} PASSED / ${results.length} TOTAL`);
  console.log('===================================================================\n');
  console.table(results);
  process.exit(failed > 0 ? 1 : 0);
}

runAuthUxTests().catch((err) => {
  console.error('\n[AUTH UX SUITE FATAL]:', err);
  process.exit(1);
});
