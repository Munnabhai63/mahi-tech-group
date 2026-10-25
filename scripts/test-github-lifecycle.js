/**
 * GITHUB ACCESS LIFECYCLE TEST SUITE
 *
 * Uses a local mock of the GitHub REST API (stub server) so the full
 * joiner/leaver flow is verified end-to-end without touching a real org:
 *   1. Unconfigured state degrades honestly (approve continues, no fake claims)
 *   2. Config saved encrypted; masked status; connectivity test (rate_limit)
 *   3. Approve with username + configured org → org invite + role team added
 *   4. Role→team mapping honored per role (least privilege)
 *   5. Offboarding revokes org membership AND cancels pending invites
 *   6. Member github username endpoint (set/validate/provision)
 *   7. Full audit trail of provisioning/revocation
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';

const APP_PORT = 4994;
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const STUB_PORT = 4993;
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

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

/**
 * Minimal GitHub REST stub: records calls, replies with documented shapes.
 */
function startGithubStub() {
  const calls = [];
  const pendingInvites = new Map();

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const auth = req.headers.authorization || '';
      const url = req.url;
      calls.push({ method: req.method, url, auth: auth.slice(0, 12) });

      const json = (code, payload) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (!auth.startsWith('Bearer ghp_test')) {
        return json(401, { message: 'Bad credentials' });
      }
      if (url === '/rate_limit') {
        return json(200, { resources: { core: { remaining: 4999 } } });
      }
      let m;
      if ((m = url.match(/^\/orgs\/([^/]+)\/memberships\/([^/]+)$/))) {
        if (req.method === 'PUT') return json(200, { state: 'pending', user: { login: m[2] } });
        if (req.method === 'DELETE') { pendingInvites.delete(m[2]); return json(204, null); }
      }
      if ((m = url.match(/^\/orgs\/([^/]+)\/teams\/([^/]+)\/memberships\/([^/]+)$/)) && req.method === 'PUT') {
        return json(200, { state: 'active', user: { login: m[3] } });
      }
      if (url.match(/^\/orgs\/[^/]+\/invitations$/) && req.method === 'GET') {
        return json(200, Array.from(pendingInvites.values()).map((login, i) => ({ id: 100 + i, login })));
      }
      if ((m = url.match(/^\/orgs\/([^/]+)\/invitations\/(\d+)$/)) && req.method === 'DELETE') {
        for (const [login, inv] of pendingInvites) {
          if (inv.id === Number(m[2])) pendingInvites.delete(login);
        }
        return json(204, null);
      }
      return json(404, { message: 'Not Found' });
    });
  });

  // helper the test uses to simulate a pending invite for the cancel path
  server._pendingInvites = pendingInvites;
  server._calls = calls;
  return server;
}

async function runGithubTests() {
  console.log('===================================================================');
  console.log('   GITHUB ACCESS LIFECYCLE VERIFICATION SUITE');
  console.log('===================================================================\n');

  runMigration();
  await runSeed();

  const stub = startGithubStub();
  await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));
  console.log(`[SETUP] app :${APP_PORT} | github stub :${STUB_PORT}\n`);

  try {
    const login = async (email, pass) => (await req('POST', '/api/auth/login', null, { email, password: pass })).data;

  // Email gate helper: verify a freshly signed-up applicant via local DB token
  async function verifyEmailFor(userId) {
    const row = queryOne(
      "SELECT token FROM email_verifications WHERE user_id = ? AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    if (!row) return;
    await fetch(`${BASE_URL}/api/auth/verify-email?token=${row.token}`);
  }
    const admin = await login('admin@mahitechgroup.com', 'AdminPassword@2026');

    // -----------------------------------------------------------------
    console.log('--- TEST 1: Unconfigured state is honest (no fake provisioning) ---');
    const status0 = await req('GET', '/api/superadmin/github/config', admin.token);
    assert(status0.status === 200 && status0.data.configured === false, 'Status reports unconfigured');

    // Approve without config → approval succeeds, github skipped honestly
    const email1 = `gh.nouser.${Date.now()}@example.com`;
    const docs = (await req('GET', '/api/legal/documents/active')).data.documents.map((d) => d.id);
    const su1 = await req('POST', '/api/auth/signup', null, {
      name: 'No GH User', email: email1, password: 'Password@123', desired_role: 'researcher',
      legal_typed_name: 'No GH User', legal_accepted_doc_ids: docs
    });
    await verifyEmailFor(su1.data.user.id);
    const ap1 = await req('PATCH', `/api/admin/applications/${su1.data.user.id}/decide`, admin.token, { decision: 'approve' });
    assert(ap1.status === 200, 'Approval proceeds when GitHub unconfigured');
    assert(ap1.data.github?.provisioned === false && ['not_configured', 'no_github_username'].includes(ap1.data.github?.reason), 'github field honestly reports why provisioning was skipped');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Configuration (encrypted PAT) + connectivity ---');
    const cfg = await req('PUT', '/api/superadmin/github/config', admin.token, {
      org_login: 'mahi-tech-org', token: 'ghp_test_token_1234567890', api_base: STUB_URL
    });
    assert(cfg.status === 200 && cfg.data.configured === true && cfg.data.org_login === 'mahi-tech-org', 'Config saved (org + encrypted token)');
    const row = queryOne('SELECT token_encrypted FROM github_config');
    assert(!String(row.token_encrypted).includes('ghp_test'), 'Token stored encrypted (plaintext never at rest)');
    const ping = await req('POST', '/api/superadmin/github/test', admin.token);
    assert(ping.status === 200 && ping.data.success === true && ping.data.rate_remaining === 4999, 'Connectivity test hits rate_limit via stub');
    const nonAdminCfg = await req('GET', '/api/superadmin/github/config', (await login('developer@mahitechgroup.com', 'DeveloperPass123!')).token);
    assert(nonAdminCfg.status === 403, 'Non-admin blocked from config');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: JOINER — approve provisions org + role team ---');
    const email2 = `gh.dev.${Date.now()}@example.com`;
    const su2 = await req('POST', '/api/auth/signup', null, {
      name: 'GH Dev', email: email2, password: 'Password@123', desired_role: 'developer',
      github_username: 'ghdev-alias',
      legal_typed_name: 'GH Dev', legal_accepted_doc_ids: docs
    });
    assert(su2.status === 201, 'Signup with github_username accepted');
    await verifyEmailFor(su2.data.user.id);
    const ap2 = await req('PATCH', `/api/admin/applications/${su2.data.user.id}/decide`, admin.token, { decision: 'approve' });
    assert(ap2.status === 200, 'Approval succeeds with GitHub configured');
    assert(ap2.data.github?.provisioned === true, 'github.provisioned === true');
    assert(ap2.data.github?.team === 'mtg-developers', 'Role mapped to mtg-developers team');
    assert(ap2.data.github?.team_added === true, 'Team membership added');
    const inviteCall = stub._calls.find((c) => c.method === 'PUT' && c.url === '/orgs/mahi-tech-org/memberships/ghdev-alias');
    assert(Boolean(inviteCall), 'PUT org membership call made with correct org/user');
    const teamCall = stub._calls.find((c) => c.method === 'PUT' && c.url === '/orgs/mahi-tech-org/teams/mtg-developers/memberships/ghdev-alias');
    assert(Boolean(teamCall), 'PUT team membership call made (least-privilege)');

    // Designer maps to designers team
    const email3 = `gh.designer.${Date.now()}@example.com`;
    const su3 = await req('POST', '/api/auth/signup', null, {
      name: 'GH Designer', email: email3, password: 'Password@123', desired_role: 'designer',
      github_username: 'ghdesigner-alias',
      legal_typed_name: 'GH Designer', legal_accepted_doc_ids: docs
    });
    await verifyEmailFor(su3.data.user.id);
    const ap3 = await req('PATCH', `/api/admin/applications/${su3.data.user.id}/decide`, admin.token, { decision: 'approve' });
    assert(ap3.data.github?.team === 'mtg-designers', 'Designer mapped to mtg-designers (privacy separation)');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Member github endpoint (set/validate/provision) ---');
    const dev = await login('developer@mahitechgroup.com', 'DeveloperPass123!');
    const setGh = await req('PATCH', `/api/admin/members/${dev.user.id}/github`, admin.token, { github_username: 'arjun-dev-gh' });
    assert(setGh.status === 200 && setGh.data.member.github_username === 'arjun-dev-gh', 'Username saved');
    assert(setGh.data.github?.provisioned === true && setGh.data.github.team === 'mtg-developers', 'Immediate provisioning on set');
    const badGh = await req('PATCH', `/api/admin/members/${dev.user.id}/github`, admin.token, { github_username: 'invalid user name!' });
    assert(badGh.status === 400, 'Invalid username format rejected');
    const nonAdminSet = await req('PATCH', `/api/admin/members/${dev.user.id}/github`, dev.token, { github_username: 'hax' });
    assert(nonAdminSet.status === 403, 'Non-admin cannot set usernames');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: LEAVER — offboarding revokes everything ---');
    stub._pendingInvites.set('ghdev-alias', { id: 501, login: 'ghdev-alias' }); // simulate pending invite
    const ob = await req('POST', `/api/admin/members/${su2.data.user.id}/offboard`, admin.token, { reason: 'GitHub lifecycle test' });
    assert(ob.status === 200, `Offboarding kill-switch executed (got ${ob.status})`);
    const ghChecklist = (ob.data.stepsExecuted || ob.data.steps || []).find((s) => s.action === 'revoke_external_services');
    assert(String(ghChecklist?.details || '').includes('REVOKED'), 'Step 3 reports automatic GitHub revocation');
    const revokeCall = stub._calls.find((c) => c.method === 'DELETE' && c.url === '/orgs/mahi-tech-org/memberships/ghdev-alias');
    assert(Boolean(revokeCall), 'DELETE org membership fired (revokes teams/repos)');
    assert(!stub._pendingInvites.has('ghdev-alias'), 'Pending invitation cancelled too');
    const audit = queryOne("SELECT id FROM access_log WHERE action = 'github_access_revoked' ORDER BY id DESC LIMIT 1");
    assert(Boolean(audit), 'Revocation recorded in audit log');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Full audit trail ---');
    const provLog = queryOne("SELECT id FROM access_log WHERE action = 'github_access_provisioned' ORDER BY id DESC LIMIT 1");
    assert(Boolean(provLog), 'Provisioning recorded in audit log');

  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => stub.close(r));
    console.log('\n[TEARDOWN] servers closed.');
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n===================================================================');
  console.log(`   GITHUB LIFECYCLE SUMMARY: ${results.length - failed} PASSED / ${results.length} TOTAL`);
  console.log('===================================================================\n');
  console.table(results);
  process.exit(failed > 0 ? 1 : 0);
}

runGithubTests().catch((err) => {
  console.error('\n[GITHUB SUITE FATAL]:', err);
  process.exit(1);
});
