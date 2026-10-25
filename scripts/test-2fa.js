/**
 * 2FA (TOTP) + ANOMALY ALERTS TEST SUITE
 */
process.env.NODE_ENV = 'test';

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { createApp } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'app.js')).href);
const { runMigration } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'db', 'migrate.js')).href);
const { runSeed } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'db', 'seed.js')).href);
const { queryOne, queryAll } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'db', 'database.js')).href);
const { totpCode } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'services', 'totpService.js')).href);

const TEST_PORT = 4968;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const results = [];
function assert(condition, label) {
  console.log(`  ${condition ? '✓ PASS' : '✗ FAIL'}: ${label}`);
  results.push({ test: label, status: condition ? 'PASS' : 'FAIL' });
}

async function req(method, endpoint, token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function login(email, password, extra = null) {
  return req('POST', '/api/auth/login', null, { email, password, ...(extra || {}) });
}

runMigration();
await runSeed();

const server = http.createServer(createApp());
await new Promise((r) => server.listen(TEST_PORT, '127.0.0.1', r));
console.log(`[SETUP] Test server on ${BASE_URL}\n`);

try {
  const devLogin = await login('developer@mahitechgroup.com', 'DeveloperPass123!');
  const devToken = devLogin.data.token;

  console.log('--- 2FA lifecycle ---');
  const setup = await req('POST', '/api/auth/2fa/setup', devToken);
  assert(setup.status === 200 && setup.data.secret?.length >= 32, 'Setup returns base32 secret');
  assert(String(setup.data.otpauth_url || '').startsWith('otpauth://totp/'), 'otpauth URL generated');

  const wrong = await req('POST', '/api/auth/2fa/enable', devToken, { code: '000000' });
  assert(wrong.status === 400, 'Enable with wrong code rejected');

  const enable = await req('POST', '/api/auth/2fa/enable', devToken, { code: totpCode(setup.data.secret) });
  assert(enable.status === 200, 'Enable with valid code succeeds');

  const noCode = await login('developer@mahitechgroup.com', 'DeveloperPass123!');
  assert(noCode.status === 401 && noCode.data.requires_2fa === true, 'Login without 2FA code blocked (requires_2fa)');

  const badCode = await login('developer@mahitechgroup.com', 'DeveloperPass123!', { totp_code: '000000' });
  assert(badCode.status === 401 && badCode.data.requires_2fa === true, 'Login with wrong 2FA code blocked');

  const withCode = await login('developer@mahitechgroup.com', 'DeveloperPass123!', { totp_code: totpCode(setup.data.secret) });
  assert(withCode.status === 200 && withCode.data.token, 'Login with valid 2FA code succeeds');

  const disable = await req('POST', '/api/auth/2fa/disable', withCode.data.token, { code: totpCode(setup.data.secret) });
  assert(disable.status === 200, 'Disable with valid code succeeds');

  const after = await login('developer@mahitechgroup.com', 'DeveloperPass123!');
  assert(after.status === 200, 'Login works again after disable');

  console.log('\n--- Anomaly alerts (5 failed logins -> admin notified) ---');
  for (let i = 0; i < 5; i++) {
    await login('designer@mahitechgroup.com', 'WrongPassword999!');
  }
  const admin = await login('admin@mahitechgroup.com', 'AdminPassword@2026');
  const notif = await req('GET', '/api/dashboard/notifications', admin.data.token);
  const alerts = (notif.data.notifications || []).filter((n) => n.event_type === 'security_alert');
  assert(alerts.length >= 1, 'Admin receives security_alert notification');
  assert(/designer@mahitechgroup\.com/.test(alerts[0]?.message || ''), 'Alert names the targeted account');

} finally {
  await new Promise((r) => server.close(r));
  console.log('\n[TEARDOWN] Test server closed.');
}

const failed = results.filter((r) => r.status === 'FAIL').length;
console.log('\n===================================================================');
console.log(`   2FA + ANOMALY SUMMARY: ${results.length - failed} PASSED / ${results.length} TOTAL`);
console.log('===================================================================\n');
console.table(results);
process.exit(failed > 0 ? 1 : 0);
