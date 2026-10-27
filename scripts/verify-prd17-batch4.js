import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===================================================================');
console.log('   PRD 17: GITHUB AUTOMATION ARCHITECTURE — BATCH 4 TEST SUITE');
console.log('   FRONTEND: GITHUB SETTINGS PANEL & BACKEND CONTROLLERS');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  const db = getDatabase();
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // Set up temporary RSA key
  const { privateKey: rsaPrivateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const certsDir = path.resolve(__dirname, '../certs');
  fs.mkdirSync(certsDir, { recursive: true });
  const tempKeyPath = path.join(certsDir, `test-prd17-batch4-${Date.now()}.pem`);
  fs.writeFileSync(tempKeyPath, rsaPrivateKey, 'utf8');

  const origAppId = process.env.GITHUB_APP_ID;
  const origKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  const origSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const origOrg = process.env.GITHUB_ORG_NAME;
  const origInstId = process.env.GITHUB_APP_INSTALLATION_ID;

  process.env.GITHUB_APP_ID = '987654';
  process.env.GITHUB_APP_PRIVATE_KEY_PATH = tempKeyPath;
  process.env.GITHUB_WEBHOOK_SECRET = 'a'.repeat(32);
  process.env.GITHUB_ORG_NAME = 'mahitechgroup';
  process.env.GITHUB_APP_INSTALLATION_ID = '54321';

  // Import app and service
  const { createApp } = await import(`../src/app.js?t=${Date.now()}`);
  const { setOctokitInstance, _resetTokenCache } = await import('../src/services/githubAutomation.service.js');

  // Configure mock Octokit for GitHub API interactions
  const mockOctokit = {
    repos: {
      createInOrg: async (params) => ({
        data: {
          id: 9998877,
          name: params.name,
          full_name: `${params.org}/${params.name}`,
          html_url: `https://github.com/${params.org}/${params.name}`,
        },
      }),
      update: async (params) => ({ data: { ...params } }),
      updateBranchProtection: async (params) => ({ data: { ...params } }),
    },
    git: {
      getRef: async () => ({ data: { object: { sha: 'sha_test_123456789' } } }),
      createRef: async (params) => ({ data: { ...params } }),
    },
    teams: {
      create: async (params) => ({ data: { slug: params.name.toLowerCase() } }),
      addOrUpdateRepoPermissionsInOrg: async () => ({ data: {} }),
      addOrUpdateMembershipForUserInOrg: async () => ({ data: {} }),
      removeMembershipForUserInOrg: async () => ({ data: {} }),
    },
  };
  setOctokitInstance(mockOctokit);
  _resetTokenCache();

  // Spin up test server on dynamic ephemeral port
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const BASE_URL = `http://127.0.0.1:${port}`;

  // Helper for HTTP requests
  function request(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, BASE_URL);
      const headers = { ...(options.headers || {}) };
      let bodyData = null;

      if (options.body && options.method !== 'GET') {
        bodyData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        if (!headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
        headers['content-length'] = Buffer.byteLength(bodyData);
      }

      const req = http.request(url, {
        method: options.method || 'GET',
        headers,
      }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      });

      req.on('error', reject);
      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  }

  // Create JWT helper
  function createAuthHeader(user) {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    execute(`
      INSERT INTO sessions (id, user_id, token, is_revoked, expires_at)
      VALUES (?, ?, 'simulated-token', 0, ?)
    `, [sessionId, user.id, expiresAt]);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, sessionId },
      config.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );
    return `Bearer ${token}`;
  }

  const ts = Date.now();
  const dummyHash = '$2a$10$abcdefghijklmnopqrstuu';

  // Create test users
  const adminUser = {
    id: `admin-b4-${ts}`,
    name: 'Batch 4 Admin',
    email: `admin.b4.${ts}@mahitechgroup.com`,
    role: 'admin',
  };
  const memberUser1 = {
    id: `mem1-b4-${ts}`,
    name: 'Batch 4 Member One',
    email: `mem1.b4.${ts}@mahitechgroup.com`,
    role: 'developer',
  };
  const memberUser2 = {
    id: `mem2-b4-${ts}`,
    name: 'Batch 4 Member Two',
    email: `mem2.b4.${ts}@mahitechgroup.com`,
    role: 'researcher',
  };
  const unlinkedUser = {
    id: `unlinked-b4-${ts}`,
    name: 'Batch 4 Unlinked Member',
    email: `unlinked.b4.${ts}@mahitechgroup.com`,
    role: 'developer',
  };

  [adminUser, memberUser1, memberUser2, unlinkedUser].forEach(u => {
    execute(
      "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
      [u.id, u.name, u.email, u.role, dummyHash]
    );
  });

  const adminToken = createAuthHeader(adminUser);
  const memberToken1 = createAuthHeader(memberUser1);
  const memberToken2 = createAuthHeader(memberUser2);
  const unlinkedToken = createAuthHeader(unlinkedUser);

  // Create test project
  const testIdeaId = `idea-b4-${ts}`;
  const testProjectId = `proj-b4-${ts}`;
  execute(`
    INSERT INTO ideas (id, title, description, owner_id, status)
    VALUES (?, 'PRD 17 Batch 4 Idea', 'Testing settings panel', ?, 'APPROVED')
  `, [testIdeaId, memberUser1.id]);
  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, status)
    VALUES (?, ?, 'Batch 4 Automation Project', ?, 'ACTIVE')
  `, [testProjectId, testIdeaId, memberUser1.id]);

  try {
    // ===================================================================
    // GROUP 1: Static File Serving (8 assertions)
    // ===================================================================
    console.log('--- GROUP 1: Static File Serving (8 assertions) ---');

    const resLinkHtml = await request('/github-link.html');
    assert(resLinkHtml.status === 200, 'GET /github-link.html → 200');

    const resLinkJs = await request('/js/github-link.js');
    assert(resLinkJs.status === 200, 'GET /js/github-link.js → 200');

    const resRepoHtml = await request('/github-repo-panel.html');
    assert(resRepoHtml.status === 200, 'GET /github-repo-panel.html → 200');

    const resRepoJs = await request('/js/github-repo-panel.js');
    assert(resRepoJs.status === 200, 'GET /js/github-repo-panel.js → 200');

    const resMembersHtml = await request('/github-members.html');
    assert(resMembersHtml.status === 200, 'GET /github-members.html → 200');

    const resMembersJs = await request('/js/github-members.js');
    assert(resMembersJs.status === 200, 'GET /js/github-members.js → 200');

    const resLogHtml = await request('/github-webhook-log.html');
    assert(resLogHtml.status === 200, 'GET /github-webhook-log.html → 200');

    const resLogJs = await request('/js/github-webhook-log.js');
    assert(resLogJs.status === 200, 'GET /js/github-webhook-log.js → 200');

    // ===================================================================
    // GROUP 2: Account Linking Routes (6 assertions)
    // ===================================================================
    console.log('\n--- GROUP 2: Account Linking Routes (6 assertions) ---');

    // 1. GET /api/github/settings/my-link (no link yet) → 200 { linked: false }
    const resMyLinkBefore = await request('/api/github/settings/my-link', {
      headers: { authorization: memberToken1 },
    });
    assert(
      resMyLinkBefore.status === 200 && resMyLinkBefore.data?.linked === false,
      'GET /api/github/settings/my-link (no link yet) → 200 { linked: false }',
      `data: ${JSON.stringify(resMyLinkBefore.data)}`
    );

    // 2. POST /api/github/settings/link-account missing fields → 400
    const resMissingFields = await request('/api/github/settings/link-account', {
      method: 'POST',
      headers: { authorization: memberToken1 },
      body: { githubUsername: 'member1_dev' }, // missing node_id
    });
    assert(
      resMissingFields.status === 400,
      'POST /api/github/settings/link-account missing fields → 400',
      `status: ${resMissingFields.status}`
    );

    // 3. POST /api/github/settings/link-account valid → 201
    const resValidLink = await request('/api/github/settings/link-account', {
      method: 'POST',
      headers: { authorization: memberToken1 },
      body: {
        githubUsername: 'member1_octo',
        githubNodeId: 'MDQ6VXNlcjEwMDAx',
      },
    });
    assert(
      resValidLink.status === 201 && resValidLink.data?.success === true && resValidLink.data?.githubUsername === 'member1_octo',
      'POST /api/github/settings/link-account valid → 201 { success: true, githubUsername }',
      `status: ${resValidLink.status}, data: ${JSON.stringify(resValidLink.data)}`
    );

    // 4. GET /api/github/settings/my-link (after link) → 200 { linked: true, githubUsername: '...' }
    const resMyLinkAfter = await request('/api/github/settings/my-link', {
      headers: { authorization: memberToken1 },
    });
    assert(
      resMyLinkAfter.status === 200 && resMyLinkAfter.data?.linked === true && resMyLinkAfter.data?.githubUsername === 'member1_octo',
      'GET /api/github/settings/my-link (after link) → 200 { linked: true, githubUsername }',
      `data: ${JSON.stringify(resMyLinkAfter.data)}`
    );

    // 5. POST /api/github/settings/link-account again → 409
    const resDuplicateLink = await request('/api/github/settings/link-account', {
      method: 'POST',
      headers: { authorization: memberToken1 },
      body: {
        githubUsername: 'member1_octo_alt',
        githubNodeId: 'MDQ6VXNlcjEwMDAy',
      },
    });
    assert(
      resDuplicateLink.status === 409,
      'POST /api/github/settings/link-account again → 409 (Already linked)',
      `status: ${resDuplicateLink.status}, error: ${resDuplicateLink.data?.error}`
    );

    // 6. POST /api/github/settings/admin/link-member by non-Admin → 403
    const resAdminLinkNonAdmin = await request('/api/github/settings/admin/link-member', {
      method: 'POST',
      headers: { authorization: memberToken1 },
      body: {
        userId: memberUser2.id,
        githubUsername: 'member2_octo',
        githubNodeId: 'MDQ6VXNlcjEwMDAz',
      },
    });
    assert(
      resAdminLinkNonAdmin.status === 403,
      'POST /api/github/settings/admin/link-member by non-Admin → 403',
      `status: ${resAdminLinkNonAdmin.status}`
    );

    // ===================================================================
    // GROUP 3: Project Repo Routes (5 assertions)
    // ===================================================================
    console.log('\n--- GROUP 3: Project Repo Routes (5 assertions) ---');

    // 1. GET /projects/:projectId/repo (no repo) → 404
    const resNoRepo = await request(`/api/github/settings/projects/${testProjectId}/repo`, {
      headers: { authorization: memberToken1 },
    });
    assert(
      resNoRepo.status === 404,
      'GET /projects/:projectId/repo (no repo) → 404',
      `status: ${resNoRepo.status}`
    );

    // 2. POST /projects/:projectId/setup by non-Admin → 403
    const resSetupNonAdmin = await request(`/api/github/settings/projects/${testProjectId}/setup`, {
      method: 'POST',
      headers: { authorization: memberToken1 },
      body: { projectName: 'Batch 4 Automation Project' },
    });
    assert(
      resSetupNonAdmin.status === 403,
      'POST /projects/:projectId/setup by non-Admin → 403',
      `status: ${resSetupNonAdmin.status}`
    );

    // 3. POST /projects/:projectId/setup by Admin (mocked GitHub) → 200, row = ACTIVE
    const resSetupAdmin = await request(`/api/github/settings/projects/${testProjectId}/setup`, {
      method: 'POST',
      headers: { authorization: adminToken },
      body: { projectName: 'Batch 4 Automation Project' },
    });
    const repoInDb = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [testProjectId]);
    assert(
      resSetupAdmin.status === 200 &&
      resSetupAdmin.data?.repoFullName?.includes('mahitechgroup') &&
      repoInDb && repoInDb.status === 'ACTIVE',
      'POST /projects/:projectId/setup by Admin (mocked GitHub) → 200, project_github_repos row = ACTIVE',
      `status: ${resSetupAdmin.status}, repo: ${resSetupAdmin.data?.repoFullName}, dbStatus: ${repoInDb?.status}`
    );

    // 4. GET /projects/:projectId/repo (after setup) → 200 with repoFullName, status
    const resRepoAfterSetup = await request(`/api/github/settings/projects/${testProjectId}/repo`, {
      headers: { authorization: memberToken1 },
    });
    assert(
      resRepoAfterSetup.status === 200 &&
      resRepoAfterSetup.data?.repoFullName?.includes('mahitechgroup') &&
      resRepoAfterSetup.data?.status === 'ACTIVE',
      'GET /projects/:projectId/repo (after setup) → 200 with repoFullName, status',
      `status: ${resRepoAfterSetup.status}, repoFullName: ${resRepoAfterSetup.data?.repoFullName}`
    );

    // 5. POST /projects/:projectId/setup when repo exists → 400
    const resSetupDuplicate = await request(`/api/github/settings/projects/${testProjectId}/setup`, {
      method: 'POST',
      headers: { authorization: adminToken },
      body: { projectName: 'Batch 4 Automation Project' },
    });
    assert(
      resSetupDuplicate.status === 400,
      'POST /projects/:projectId/setup when repo exists → 400',
      `status: ${resSetupDuplicate.status}, error: ${resSetupDuplicate.data?.error}`
    );

    // ===================================================================
    // GROUP 4: GitHub Members Routes (5 assertions)
    // ===================================================================
    console.log('\n--- GROUP 4: GitHub Members Routes (5 assertions) ---');

    // 1. GET /projects/:projectId/members by non-Admin → 403
    const resMembersNonAdmin = await request(`/api/github/settings/projects/${testProjectId}/members`, {
      headers: { authorization: memberToken1 },
    });
    assert(
      resMembersNonAdmin.status === 403,
      'GET /projects/:projectId/members by non-Admin → 403',
      `status: ${resMembersNonAdmin.status}`
    );

    // 2. GET /projects/:projectId/members by Admin → 200 array
    const resMembersAdmin = await request(`/api/github/settings/projects/${testProjectId}/members`, {
      headers: { authorization: adminToken },
    });
    assert(
      resMembersAdmin.status === 200 && Array.isArray(resMembersAdmin.data),
      'GET /projects/:projectId/members by Admin → 200 array',
      `status: ${resMembersAdmin.status}, length: ${resMembersAdmin.data?.length}`
    );

    // 3. POST /projects/:projectId/members/:userId/add by non-Admin → 403
    const resAddMemberNonAdmin = await request(`/api/github/settings/projects/${testProjectId}/members/${memberUser1.id}/add`, {
      method: 'POST',
      headers: { authorization: memberToken1 },
      body: { role: 'developer' },
    });
    assert(
      resAddMemberNonAdmin.status === 403,
      'POST /projects/:projectId/members/:userId/add by non-Admin → 403',
      `status: ${resAddMemberNonAdmin.status}`
    );

    // 4. POST /projects/:projectId/members/:userId/add (no github link) → 400 with descriptive error
    const resAddUnlinked = await request(`/api/github/settings/projects/${testProjectId}/members/${unlinkedUser.id}/add`, {
      method: 'POST',
      headers: { authorization: adminToken },
      body: { role: 'developer' },
    });
    assert(
      resAddUnlinked.status === 400 && resAddUnlinked.data?.error?.toLowerCase().includes('github account'),
      'POST /projects/:projectId/members/:userId/add (no github link) → 400 with descriptive error',
      `status: ${resAddUnlinked.status}, error: ${resAddUnlinked.data?.error}`
    );

    // 5. DELETE /projects/:projectId/members/:userId reason < 10 chars → 400
    const resDeleteShortReason = await request(`/api/github/settings/projects/${testProjectId}/members/${memberUser1.id}`, {
      method: 'DELETE',
      headers: { authorization: adminToken },
      body: { reason: 'short' },
    });
    assert(
      resDeleteShortReason.status === 400 && resDeleteShortReason.data?.error?.includes('10 characters'),
      'DELETE /projects/:projectId/members/:userId reason < 10 chars → 400',
      `status: ${resDeleteShortReason.status}, error: ${resDeleteShortReason.data?.error}`
    );

    // ===================================================================
    // GROUP 5: Webhook Log Route (4 assertions)
    // ===================================================================
    console.log('\n--- GROUP 5: Webhook Log Route (4 assertions) ---');

    // Populate sample webhook rows for log tests
    const delivPush = `deliv-push-${ts}`;
    const delivPr = `deliv-pr-${ts}`;
    const delivInvalid = `deliv-inv-${ts}`;

    execute(`
      INSERT INTO github_webhook_log (delivery_id, event_type, action, repo_full_name, sender_login, signature_valid, processed, error_message, payload, received_at)
      VALUES (?, 'push', NULL, 'mahitechgroup/mahi-test-repo', 'pusher1', 1, 1, NULL, '{"secret":"sensitive_data_123"}', datetime('now'))
    `, [delivPush]);

    execute(`
      INSERT INTO github_webhook_log (delivery_id, event_type, action, repo_full_name, sender_login, signature_valid, processed, error_message, payload, received_at)
      VALUES (?, 'pull_request', 'opened', 'mahitechgroup/mahi-test-repo', 'pr_opener', 1, 1, NULL, '{"secret":"sensitive_data_456"}', datetime('now'))
    `, [delivPr]);

    execute(`
      INSERT INTO github_webhook_log (delivery_id, event_type, action, repo_full_name, sender_login, signature_valid, processed, error_message, payload, received_at)
      VALUES (?, 'push', NULL, 'mahitechgroup/mahi-test-repo', 'bad_actor', 0, 0, 'Invalid signature', '{"secret":"sensitive_data_789"}', datetime('now'))
    `, [delivInvalid]);

    // 1. GET /webhook-log by non-Admin → 403
    const resLogNonAdmin = await request('/api/github/settings/webhook-log', {
      headers: { authorization: memberToken1 },
    });
    assert(
      resLogNonAdmin.status === 403,
      'GET /webhook-log by non-Admin → 403',
      `status: ${resLogNonAdmin.status}`
    );

    // 2. GET /webhook-log by Admin → 200, logs array
    const resLogAdmin = await request('/api/github/settings/webhook-log', {
      headers: { authorization: adminToken },
    });
    assert(
      resLogAdmin.status === 200 && Array.isArray(resLogAdmin.data?.logs) && resLogAdmin.data?.total >= 3,
      'GET /webhook-log by Admin → 200, logs array with total count',
      `status: ${resLogAdmin.status}, total: ${resLogAdmin.data?.total}, returned: ${resLogAdmin.data?.logs?.length}`
    );

    // 3. GET /webhook-log response NEVER contains payload field
    const anyHasPayload = resLogAdmin.data?.logs?.some(l => l.payload !== undefined);
    assert(
      anyHasPayload === false,
      'GET /webhook-log response NEVER contains payload field',
      `anyHasPayload: ${anyHasPayload}`
    );

    // 4. GET /webhook-log?eventType=push → filters correctly
    const resLogFilterPush = await request('/api/github/settings/webhook-log?eventType=push', {
      headers: { authorization: adminToken },
    });
    const allArePush = resLogFilterPush.data?.logs?.every(l => l.eventType === 'push');
    assert(
      resLogFilterPush.status === 200 && allArePush === true && resLogFilterPush.data?.logs?.length >= 2,
      'GET /webhook-log?eventType=push → filters correctly',
      `allArePush: ${allArePush}, count: ${resLogFilterPush.data?.logs?.length}`
    );

    // ===================================================================
    // GROUP 6: Integration Flow (4 assertions)
    // ===================================================================
    console.log('\n--- GROUP 6: Integration Flow (4 assertions) ---');

    // 1. Link user GitHub (via Admin link) → Add to project team → row in project_github_memberships with ACTIVE
    const resAdminLink = await request('/api/github/settings/admin/link-member', {
      method: 'POST',
      headers: { authorization: adminToken },
      body: {
        userId: memberUser2.id,
        githubUsername: 'member2_octo',
        githubNodeId: 'MDQ6VXNlcjEwMDAz',
      },
    });

    const resAddMember = await request(`/api/github/settings/projects/${testProjectId}/members/${memberUser2.id}/add`, {
      method: 'POST',
      headers: { authorization: adminToken },
      body: { role: 'researcher' },
    });

    const activeMembership = queryOne(`
      SELECT * FROM project_github_memberships
      WHERE project_id = ? AND user_id = ?
    `, [testProjectId, memberUser2.id]);

    assert(
      resAdminLink.status === 201 &&
      resAddMember.status === 200 &&
      activeMembership && activeMembership.status === 'ACTIVE' &&
      activeMembership.role === 'researcher',
      'Link user GitHub → add to project team → membership row in project_github_memberships with status ACTIVE',
      `resAdminLink: ${resAdminLink.status}, resAdd: ${resAddMember.status}, dbStatus: ${activeMembership?.status}`
    );

    // 2. Remove from team → row status = REMOVED, row still exists (attribution preserved)
    const resRemoveMember = await request(`/api/github/settings/projects/${testProjectId}/members/${memberUser2.id}`, {
      method: 'DELETE',
      headers: { authorization: adminToken },
      body: { reason: 'Completed all research milestones for PRD 17' },
    });

    const removedMembership = queryOne(`
      SELECT * FROM project_github_memberships
      WHERE project_id = ? AND user_id = ?
    `, [testProjectId, memberUser2.id]);

    assert(
      resRemoveMember.status === 200 &&
      removedMembership &&
      removedMembership.status === 'REMOVED' &&
      !!removedMembership.removed_at &&
      removedMembership.removed_reason === 'Completed all research milestones for PRD 17',
      'Remove from team → row status = REMOVED, row still exists (attribution preserved)',
      `removeStatus: ${resRemoveMember.status}, dbStatus: ${removedMembership?.status}, reason: ${removedMembership?.removed_reason}`
    );

    // 3. Webhook log has entries from setup actions
    const webhookCount = queryOne('SELECT COUNT(*) as count FROM github_webhook_log');
    assert(
      webhookCount && webhookCount.count >= 3,
      'Webhook log has entries from setup actions',
      `total webhook log entries: ${webhookCount?.count}`
    );

    // 4. access_log has GITHUB_MEMBER_ADDED + GITHUB_MEMBER_REMOVED entries
    const addedLog = queryOne("SELECT * FROM access_log WHERE action = 'GITHUB_MEMBER_ADDED' AND user_id = ? ORDER BY id DESC LIMIT 1", [memberUser2.id]);
    const removedLog = queryOne("SELECT * FROM access_log WHERE action = 'GITHUB_MEMBER_REMOVED' AND user_id = ? ORDER BY id DESC LIMIT 1", [memberUser2.id]);
    assert(
      !!addedLog && !!removedLog,
      'access_log has GITHUB_MEMBER_ADDED + GITHUB_MEMBER_REMOVED entries',
      `addedLog: ${addedLog?.action}, removedLog: ${removedLog?.action}`
    );

  } finally {
    // Teardown HTTP server
    server.close();

    // Restore environment variables
    if (origAppId) process.env.GITHUB_APP_ID = origAppId; else delete process.env.GITHUB_APP_ID;
    if (origKeyPath) process.env.GITHUB_APP_PRIVATE_KEY_PATH = origKeyPath; else delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    if (origSecret) process.env.GITHUB_WEBHOOK_SECRET = origSecret; else delete process.env.GITHUB_WEBHOOK_SECRET;
    if (origOrg) process.env.GITHUB_ORG_NAME = origOrg; else delete process.env.GITHUB_ORG_NAME;
    if (origInstId) process.env.GITHUB_APP_INSTALLATION_ID = origInstId; else delete process.env.GITHUB_APP_INSTALLATION_ID;

    // Clean up temporary cert
    try {
      if (fs.existsSync(tempKeyPath)) {
        fs.unlinkSync(tempKeyPath);
      }
    } catch {}
  }

  console.log('\n===================================================================');
  console.log(`TOTAL TESTS:  ${totalTests}`);
  console.log(`PASSED TESTS: ${passedTests}`);
  console.log(`FAILED TESTS: ${failedTests}`);
  console.log('===================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
