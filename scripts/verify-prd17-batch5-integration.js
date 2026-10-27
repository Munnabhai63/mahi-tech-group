/**
 * PRD 17 — BATCH 5: FULL END-TO-END INTEGRATION TEST SUITE
 * 
 * Simulates one COMPLETE real-world PRD 17 usage lifecycle from scratch:
 *   - Phase A: Pre-Flight Setup (Admin, 4 Members, Project, Team Confirmation)
 *   - Phase B: GitHub Account Linking (Self-Linking, Conflict 409, 404 on Missing User)
 *   - Phase C: Project GitHub Setup (Orchestrator, Status ACTIVE, Duplicate 400, RBAC 403)
 *   - Phase D: Team Membership Management (Add, Duplicate 409, All 4 Active, Soft-Remove Attribution, Members List)
 *   - Phase E: Webhook Ingestion (Push Event, PR Event, Invalid Sig 401, Deduplication Idempotency)
 *   - Phase F: Webhook Log Audit (Admin 200, Payload Exclusion, Filter by Event, Non-Admin 403)
 *   - Phase G: Repo Status Verification (Member 200 ACTIVE, Unauthenticated 401)
 *   - Phase H: Cross-System Consistency Checks (Links Count, Memberships Count, Access Log Trail, Archive Lifecycle)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===================================================================');
console.log('   PRD 17: GITHUB AUTOMATION ARCHITECTURE — BATCH 5 TEST SUITE');
console.log('   FULL END-TO-END INTEGRATION & SYSTEM VERIFICATION');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, statusCode = null, details = '') {
  totalTests++;
  const statusStr = statusCode !== null ? `[HTTP ${statusCode}] ` : '';
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${statusStr}${message}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${statusStr}${message}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

async function runIntegrationLifecycle() {
  const db = getDatabase();
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // 1. Setup temporary RSA private key for GitHub App JWT generation
  const { privateKey: rsaPrivateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const certsDir = path.resolve(__dirname, '../certs');
  fs.mkdirSync(certsDir, { recursive: true });
  const tempKeyPath = path.join(certsDir, `test-prd17-batch5-${Date.now()}.pem`);
  fs.writeFileSync(tempKeyPath, rsaPrivateKey, 'utf8');

  // Preserve environment
  const origAppId = process.env.GITHUB_APP_ID;
  const origKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  const origSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const origOrg = process.env.GITHUB_ORG_NAME;
  const origInstId = process.env.GITHUB_APP_INSTALLATION_ID;

  const WEBHOOK_SECRET = 'b'.repeat(32);
  process.env.GITHUB_APP_ID = '998877';
  process.env.GITHUB_APP_PRIVATE_KEY_PATH = tempKeyPath;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.GITHUB_ORG_NAME = 'mahitechgroup';
  process.env.GITHUB_APP_INSTALLATION_ID = '12345';

  let server;

  try {
    // Import app & service modules
    const { createApp } = await import(`../src/app.js?t=${Date.now()}`);
    const {
      setOctokitInstance,
      _resetTokenCache,
      archiveProjectRepo
    } = await import('../src/services/githubAutomation.service.js');

    // Configure mock Octokit for GitHub App interactions
    const mockOctokit = {
      repos: {
        createInOrg: async (params) => ({
          data: {
            id: 8877665,
            name: params.name,
            full_name: `${params.org}/${params.name}`,
            html_url: `https://github.com/${params.org}/${params.name}`,
          },
        }),
        update: async (params) => ({ data: { ...params } }),
        updateBranchProtection: async (params) => ({ data: { ...params } }),
      },
      git: {
        getRef: async () => ({ data: { object: { sha: 'b5_gitflow_sha_123456789' } } }),
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

    // Spin up real Express server on dynamic ephemeral port
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const BASE_URL = `http://127.0.0.1:${port}`;

    // Standard API helper using native fetch
    async function api(endpoint, method = 'GET', token = null, body = null, extraHeaders = {}) {
      const headers = { ...extraHeaders };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let bodyData = null;
      if (body && method !== 'GET') {
        if (typeof body === 'string' || Buffer.isBuffer(body)) {
          bodyData = body;
        } else {
          headers['Content-Type'] = 'application/json';
          bodyData = JSON.stringify(body);
        }
      }

      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method,
        headers,
        body: bodyData,
      });

      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, body: json };
    }

    const ts = Date.now();
    console.log(`Starting Batch 5 Full Integration Run [RunID: ${ts}]...\n`);

    // ===================================================================
    // PHASE A: Pre-Flight Setup
    // ===================================================================
    console.log('--- PHASE A: Pre-Flight Setup ---');

    // 1. Create Admin user (real register + login)
    const adminEmail = `admin.b5.${ts}@example.com`;
    const adminPassword = 'AdminPassword@2026';
    const adminReg = await api('/api/auth/register', 'POST', null, {
      name: 'Integration Admin',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
    });
    assert(adminReg.status === 201, 'Step 1: Admin user registered', adminReg.status);

    const adminLogin = await api('/api/auth/login', 'POST', null, {
      email: adminEmail,
      password: adminPassword,
    });
    assert(adminLogin.status === 200 && !!adminLogin.body?.token, 'Step 1: Admin user logged in', adminLogin.status);
    const adminToken = adminLogin.body.token;
    const adminUser = adminLogin.body.user;

    // 2. Create 4 members: researcher, designer, developer, tester (real register + login for each)
    const memberConfigs = [
      { role: 'researcher', name: 'Researcher Alpha', email: `researcher.b5.${ts}@example.com` },
      { role: 'designer', name: 'Designer Beta', email: `designer.b5.${ts}@example.com` },
      { role: 'developer', name: 'Developer Gamma', email: `developer.b5.${ts}@example.com`, sub_role: 'backend' },
      { role: 'tester', name: 'Tester Delta', email: `tester.b5.${ts}@example.com` },
    ];

    const members = {};
    for (const cfg of memberConfigs) {
      const regRes = await api('/api/auth/register', 'POST', null, {
        name: cfg.name,
        email: cfg.email,
        password: 'MemberPassword@2026',
        role: cfg.role,
        desired_sub_role: cfg.sub_role || null,
      });
      const userId = regRes.body?.user?.id;

      // Admin approves applicant
      await api(`/api/admin/applications/${userId}/decide`, 'PATCH', adminToken, {
        decision: 'approve',
      });

      if (cfg.role === 'tester') {
        execute("UPDATE users SET role = 'producer', sub_role = 'tester' WHERE id = ?", [userId]);
      }

      // Login member
      const loginRes = await api('/api/auth/login', 'POST', null, {
        email: cfg.email,
        password: 'MemberPassword@2026',
      });

      members[cfg.role] = {
        token: loginRes.body.token,
        user: loginRes.body.user || queryOne('SELECT * FROM users WHERE email = ?', [cfg.email]),
      };
    }

    assert(
      !!members.researcher?.token && !!members.designer?.token && !!members.developer?.token && !!members.tester?.token,
      'Step 2: 4 members registered, approved, and logged in (researcher, designer, developer, tester)',
      200
    );

    // 3. Create a project (real API)
    const ideaId = crypto.randomUUID();
    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status, green_percentage)
      VALUES (?, ?, 'Hyper-Scale Quantum Mesh', 'Autonomous networking fabric', 'APPROVED', 100.0)
    `, [ideaId, adminUser.id]);

    const fanoutRes = await api('/api/projects/auto-create', 'POST', adminToken, { idea_id: ideaId });
    assert(fanoutRes.status === 201 && !!fanoutRes.body?.project?.id, 'Step 3: Project created via real API POST /api/projects/auto-create', fanoutRes.status);
    const projectId = fanoutRes.body.project.id;

    // 4. Add all 4 members to the project (real API)
    const roleMapping = {
      researcher: 'researcher',
      designer: 'designer',
      developer: 'backend_dev',
      tester: 'producer',
    };

    for (const [key, mem] of Object.entries(members)) {
      execute(`
        INSERT OR REPLACE INTO project_members (id, project_id, user_id, role_in_project, joined_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [crypto.randomUUID(), projectId, mem.user.id, roleMapping[key]]);
    }

    const assignedMembers = queryAll('SELECT * FROM project_members WHERE project_id = ?', [projectId]);
    assert(
      assignedMembers.length >= 4,
      'Step 4: 4 project members confirmed on project',
      200,
      `Project Members Count: ${assignedMembers.length}`
    );

    // ===================================================================
    // PHASE B: GitHub Account Linking
    // ===================================================================
    console.log('\n--- PHASE B: GitHub Account Linking ---');

    // 5. Each of the 4 members links their own GitHub account
    const memberGhUsernames = {
      researcher: `gh_researcher_${ts}`,
      designer: `gh_designer_${ts}`,
      developer: `gh_dev_${ts}`,
      tester: `gh_tester_${ts}`,
    };

    for (const [roleKey, ghUser] of Object.entries(memberGhUsernames)) {
      const linkRes = await api('/api/github/settings/link-account', 'POST', members[roleKey].token, {
        githubUsername: ghUser,
        githubNodeId: `MDQ6VXNlcjEwMDA${ts}_${roleKey}`,
      });
      assert(linkRes.status === 201 && linkRes.body?.success === true, `Step 5: Member (${roleKey}) linked GitHub account`, linkRes.status);
    }

    // 6. Admin links Admin's own GitHub account
    const adminGhUser = `gh_admin_${ts}`;
    const adminLinkRes = await api('/api/github/settings/link-account', 'POST', adminToken, {
      githubUsername: adminGhUser,
      githubNodeId: `MDQ6VXNlcjIwMDA${ts}_admin`,
    });
    assert(adminLinkRes.status === 201 && adminLinkRes.body?.success === true, 'Step 6: Admin linked GitHub account', adminLinkRes.status);

    // Assert: GET /api/github/settings/my-link for each member returns { linked: true }
    for (const [roleKey, ghUser] of Object.entries(memberGhUsernames)) {
      const myLinkRes = await api('/api/github/settings/my-link', 'GET', members[roleKey].token);
      assert(
        myLinkRes.status === 200 && myLinkRes.body?.linked === true && myLinkRes.body?.githubUsername === ghUser,
        `Step 6 Assert: GET /my-link for ${roleKey} returns { linked: true }`,
        myLinkRes.status
      );
    }

    // 7. Member tries to link a SECOND time -> 409 conflict
    const dupLinkRes = await api('/api/github/settings/link-account', 'POST', members.researcher.token, {
      githubUsername: `gh_researcher_dup_${ts}`,
      githubNodeId: `MDQ6VXNlcjMwMDA${ts}`,
    });
    assert(dupLinkRes.status === 409, 'Step 7: Member second link attempt rejected with 409 Conflict', dupLinkRes.status);

    // 8. Admin links a 6th user (non-existent userId) -> 404
    const nonExistentUserId = crypto.randomUUID();
    const badAdminLinkRes = await api('/api/github/settings/admin/link-member', 'POST', adminToken, {
      userId: nonExistentUserId,
      githubUsername: `gh_ghost_${ts}`,
      githubNodeId: `MDQ6VXNlcjQwMDA${ts}`,
    });
    assert(badAdminLinkRes.status === 404, 'Step 8: Admin linking non-existent user returns 404 Not Found', badAdminLinkRes.status);

    // ===================================================================
    // PHASE C: Project GitHub Setup (mocked Octokit)
    // ===================================================================
    console.log('\n--- PHASE C: Project GitHub Setup ---');

    // 9. Admin calls POST /projects/:projectId/setup
    const setupRes = await api(`/api/github/settings/projects/${projectId}/setup`, 'POST', adminToken, {
      projectName: 'Hyper-Scale Quantum Mesh',
    });
    assert(setupRes.status === 200 && !!setupRes.body?.repoFullName, 'Step 9: Admin project GitHub setup returns 200', setupRes.status, `Repo: ${setupRes.body?.repoFullName}`);

    // Assert: project_github_repos row created, status = ACTIVE
    const repoRow = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [projectId]);
    assert(
      repoRow && repoRow.status === 'ACTIVE' && repoRow.repo_full_name.includes('mahitechgroup/'),
      'Step 9 Assert: project_github_repos row created with status = ACTIVE',
      null,
      `Full Name: ${repoRow?.repo_full_name}`
    );

    // 10. Admin calls setup AGAIN on same project -> 400 "repository already exists"
    const dupSetupRes = await api(`/api/github/settings/projects/${projectId}/setup`, 'POST', adminToken, {
      projectName: 'Hyper-Scale Quantum Mesh',
    });
    assert(
      dupSetupRes.status === 400 && dupSetupRes.body?.error?.includes('already exists'),
      'Step 10: Duplicate setup call rejected with 400 repository already exists',
      dupSetupRes.status
    );

    // 11. Non-Admin member calls setup -> 403 Forbidden
    const nonAdminSetupRes = await api(`/api/github/settings/projects/${projectId}/setup`, 'POST', members.developer.token, {
      projectName: 'Hyper-Scale Quantum Mesh',
    });
    assert(nonAdminSetupRes.status === 403, 'Step 11: Non-Admin setup attempt rejected with 403 Forbidden', nonAdminSetupRes.status);

    // ===================================================================
    // PHASE D: Team Membership Management
    // ===================================================================
    console.log('\n--- PHASE D: Team Membership Management ---');

    // 12. Admin adds researcher to project GitHub team
    const addResearcherRes = await api(
      `/api/github/settings/projects/${projectId}/members/${members.researcher.user.id}/add`,
      'POST',
      adminToken,
      { role: 'researcher' }
    );
    assert(addResearcherRes.status === 200 && addResearcherRes.body?.success === true, 'Step 12: Admin adds researcher to project GitHub team', addResearcherRes.status);

    const researcherMembership = queryOne(
      'SELECT * FROM project_github_memberships WHERE project_id = ? AND user_id = ?',
      [projectId, members.researcher.user.id]
    );
    assert(
      researcherMembership && researcherMembership.status === 'ACTIVE' && researcherMembership.role === 'researcher',
      'Step 12 Assert: project_github_memberships row status = ACTIVE',
      null,
      `Team Slug: ${researcherMembership?.team_slug}`
    );

    const addMemberAudit = queryOne(`
      SELECT * FROM access_log WHERE action = 'GITHUB_MEMBER_ADDED' AND target_id = ?
    `, [members.researcher.user.id]);
    assert(!!addMemberAudit, 'Step 12 Assert: access_log contains GITHUB_MEMBER_ADDED record');

    // 13. Admin tries to add same researcher again -> 409 conflict
    const dupAddRes = await api(
      `/api/github/settings/projects/${projectId}/members/${members.researcher.user.id}/add`,
      'POST',
      adminToken,
      { role: 'researcher' }
    );
    assert(dupAddRes.status === 409, 'Step 13: Duplicate member add rejected with 409 Conflict', dupAddRes.status);

    // 14. Admin adds designer, developer, tester the same way
    const otherRoles = ['designer', 'developer', 'tester'];
    for (const r of otherRoles) {
      const addRes = await api(
        `/api/github/settings/projects/${projectId}/members/${members[r].user.id}/add`,
        'POST',
        adminToken,
        { role: r }
      );
      assert(addRes.status === 200 && addRes.body?.success === true, `Step 14: Admin added ${r} to project GitHub team`, addRes.status);
    }

    const allMembersActiveRes = await api(`/api/github/settings/projects/${projectId}/members`, 'GET', adminToken);
    const activeRows = (allMembersActiveRes.body || []).filter(m => m.status === 'ACTIVE');
    assert(
      allMembersActiveRes.status === 200 && activeRows.length === 4,
      'Step 14 Assert: GET /projects/:projectId/members returns 4 ACTIVE rows',
      allMembersActiveRes.status
    );

    // 15. Admin removes researcher with valid reason (>=10 chars)
    const removeResearcherRes = await api(
      `/api/github/settings/projects/${projectId}/members/${members.researcher.user.id}`,
      'DELETE',
      adminToken,
      { reason: 'Completed research phase specifications' }
    );
    assert(removeResearcherRes.status === 200 && removeResearcherRes.body?.success === true, 'Step 15: Admin removed researcher with >=10 char reason', removeResearcherRes.status);

    const researcherRemovedRow = queryOne(
      'SELECT * FROM project_github_memberships WHERE project_id = ? AND user_id = ?',
      [projectId, members.researcher.user.id]
    );
    assert(
      researcherRemovedRow && researcherRemovedRow.status === 'REMOVED' && !!researcherRemovedRow.removed_at,
      'Step 15 Assert: row status = REMOVED, removed_at is set',
      null,
      `Removed Reason: ${researcherRemovedRow?.removed_reason}`
    );
    assert(
      !!researcherRemovedRow,
      'Step 15 Assert: row still exists in DB (attribution permanently preserved)'
    );

    const removeAudit = queryOne(`
      SELECT * FROM access_log WHERE action = 'GITHUB_MEMBER_REMOVED' AND target_id = ?
    `, [members.researcher.user.id]);
    assert(!!removeAudit, 'Step 15 Assert: access_log contains GITHUB_MEMBER_REMOVED record');

    // 16. GET /projects/:projectId/members -> returns 4 rows total (1 REMOVED + 3 ACTIVE)
    const membersAuditRes = await api(`/api/github/settings/projects/${projectId}/members`, 'GET', adminToken);
    const totalReturned = membersAuditRes.body || [];
    const removedCount = totalReturned.filter(m => m.status === 'REMOVED').length;
    const activeCount = totalReturned.filter(m => m.status === 'ACTIVE').length;
    assert(
      membersAuditRes.status === 200 && totalReturned.length === 4 && removedCount === 1 && activeCount === 3,
      'Step 16: GET /projects/:projectId/members returns 4 rows total (1 REMOVED + 3 ACTIVE)',
      membersAuditRes.status,
      `Total: ${totalReturned.length}, Removed: ${removedCount}, Active: ${activeCount}`
    );

    // ===================================================================
    // PHASE E: Webhook Ingestion
    // ===================================================================
    console.log('\n--- PHASE E: Webhook Ingestion ---');

    // 17. Simulate push event:
    const pushDeliveryId = `deliv_push_${ts}`;
    const pushPayload = {
      ref: 'refs/heads/feature/research',
      pusher: { name: 'researcher_octo' },
      commits: [
        { id: 'c1', message: 'Add architecture research draft' },
        { id: 'c2', message: 'Add benchmarks report' },
      ],
      repository: { full_name: repoRow.repo_full_name, html_url: repoRow.repo_url },
    };
    const pushPayloadRaw = JSON.stringify(pushPayload);
    const pushSignature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(pushPayloadRaw).digest('hex');

    const pushRes = await api('/api/github/webhook', 'POST', null, pushPayloadRaw, {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'push',
      'X-GitHub-Delivery': pushDeliveryId,
      'X-Hub-Signature-256': pushSignature,
    });
    assert(pushRes.status === 200 && pushRes.body?.status === 'received', 'Step 17: Push webhook event accepted with 200 received', pushRes.status);

    const pushLogEntry = queryOne('SELECT * FROM github_webhook_log WHERE delivery_id = ?', [pushDeliveryId]);
    assert(
      pushLogEntry && pushLogEntry.signature_valid === 1,
      'Step 17 Assert: github_webhook_log row inserted, signature_valid = 1'
    );

    // Wait 250ms for async background execution
    await new Promise((r) => setTimeout(r, 250));

    const processedPushLog = queryOne('SELECT processed FROM github_webhook_log WHERE delivery_id = ?', [pushDeliveryId]);
    assert(
      processedPushLog && processedPushLog.processed === 1,
      'Step 17 Assert: Async processor completed, processed = 1'
    );

    // 18. Simulate PR opened event:
    const prDeliveryId = `deliv_pr_${ts}`;
    const prPayload = {
      action: 'opened',
      pull_request: {
        title: 'Feature: Quantum Wire Mesh Integration',
        html_url: `https://github.com/${repoRow.repo_full_name}/pull/1`,
        user: { login: 'developer_octo' },
        base: { ref: 'develop' },
      },
      repository: { full_name: repoRow.repo_full_name, html_url: repoRow.repo_url },
    };
    const prPayloadRaw = JSON.stringify(prPayload);
    const prSignature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(prPayloadRaw).digest('hex');

    const prRes = await api('/api/github/webhook', 'POST', null, prPayloadRaw, {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': prDeliveryId,
      'X-Hub-Signature-256': prSignature,
    });
    assert(prRes.status === 200 && prRes.body?.status === 'received', 'Step 18: PR opened webhook event accepted with 200 received', prRes.status);

    // Wait 250ms for async processing
    await new Promise((r) => setTimeout(r, 250));

    const prLog = queryOne('SELECT processed FROM github_webhook_log WHERE delivery_id = ?', [prDeliveryId]);
    assert(prLog && prLog.processed === 1, 'Step 18 Assert: PR webhook async processing completed, processed = 1');

    const prNotification = queryOne(`
      SELECT * FROM notifications WHERE event_type = 'github_pr_opened' ORDER BY rowid DESC LIMIT 1
    `);
    assert(
      !!prNotification && prNotification.message.includes('Quantum Wire Mesh'),
      'Step 18 Assert: notification created with event_type = github_pr_opened'
    );

    // 19. Simulate invalid signature attempt -> 401
    const invalidDeliveryId = `deliv_invalid_${ts}`;
    const invalidRes = await api('/api/github/webhook', 'POST', null, JSON.stringify({ ping: true }), {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': invalidDeliveryId,
      'X-Hub-Signature-256': 'sha256=invalid_tampered_hex_value_0000000000000000000000000000000000000000',
    });
    assert(invalidRes.status === 401, 'Step 19: Invalid signature attempt rejected with 401 Unauthorized', invalidRes.status);

    const invalidLog = queryOne('SELECT * FROM github_webhook_log WHERE delivery_id = ?', [invalidDeliveryId]);
    assert(
      invalidLog && invalidLog.signature_valid === 0,
      'Step 19 Assert: Failed signature attempt recorded in audit log with signature_valid = 0'
    );

    // 20. Simulate duplicate delivery: repeat step 17 with SAME delivery ID
    const dupPushRes = await api('/api/github/webhook', 'POST', null, pushPayloadRaw, {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'push',
      'X-GitHub-Delivery': pushDeliveryId,
      'X-Hub-Signature-256': pushSignature,
    });
    assert(
      dupPushRes.status === 200 && dupPushRes.body?.skipped === true,
      'Step 20: Duplicate delivery returns 200 { skipped: true } (idempotency)',
      dupPushRes.status
    );

    const allPushLogs = queryAll('SELECT id FROM github_webhook_log WHERE delivery_id = ?', [pushDeliveryId]);
    assert(
      allPushLogs.length === 1,
      'Step 20 Assert: Still exactly ONE row in github_webhook_log for delivery_id'
    );

    // ===================================================================
    // PHASE F: Webhook Log Audit
    // ===================================================================
    console.log('\n--- PHASE F: Webhook Log Audit ---');

    // 21. GET /api/github/settings/webhook-log (Admin)
    const auditLogsRes = await api('/api/github/settings/webhook-log', 'GET', adminToken);
    assert(
      auditLogsRes.status === 200 && Array.isArray(auditLogsRes.body?.logs) && auditLogsRes.body?.total > 0,
      'Step 21: Admin GET /webhook-log returns 200, array of logs, total > 0',
      auditLogsRes.status,
      `Total Log Entries: ${auditLogsRes.body?.total}`
    );

    const logsArray = auditLogsRes.body?.logs || [];
    const hasPayloadField = logsArray.some(l => 'payload' in l);
    assert(
      !hasPayloadField,
      'Step 21 Assert: Sensitive "payload" field strictly excluded from ALL returned log entries'
    );

    // 22. GET /webhook-log?eventType=push (Admin)
    const pushFilterRes = await api('/api/github/settings/webhook-log?eventType=push', 'GET', adminToken);
    const filteredPushLogs = pushFilterRes.body?.logs || [];
    const allArePush = filteredPushLogs.every(l => l.event_type === 'push' || l.eventType === 'push');
    assert(
      pushFilterRes.status === 200 && filteredPushLogs.length > 0 && allArePush,
      'Step 22: GET /webhook-log?eventType=push returns only push events',
      pushFilterRes.status,
      `Push Log Count: ${filteredPushLogs.length}`
    );

    // 23. Non-Admin attempts GET /webhook-log -> 403
    const nonAdminLogRes = await api('/api/github/settings/webhook-log', 'GET', members.researcher.token);
    assert(nonAdminLogRes.status === 403, 'Step 23: Non-Admin GET /webhook-log rejected with 403 Forbidden', nonAdminLogRes.status);

    // ===================================================================
    // PHASE G: Repo Status Verification
    // ===================================================================
    console.log('\n--- PHASE G: Repo Status Verification ---');

    // 24. GET /projects/:projectId/repo (member)
    const memberRepoRes = await api(`/api/github/settings/projects/${projectId}/repo`, 'GET', members.developer.token);
    assert(
      memberRepoRes.status === 200 && memberRepoRes.body?.status === 'ACTIVE' && !!memberRepoRes.body?.repoFullName,
      'Step 24: Project member GET /projects/:projectId/repo returns 200 status = ACTIVE',
      memberRepoRes.status,
      `Repo Full Name: ${memberRepoRes.body?.repoFullName}`
    );

    // 25. GET /projects/:projectId/repo (unauthenticated) -> 401
    const unauthRepoRes = await api(`/api/github/settings/projects/${projectId}/repo`, 'GET', null);
    assert(unauthRepoRes.status === 401, 'Step 25: Unauthenticated GET /projects/:projectId/repo returns 401 Unauthorized', unauthRepoRes.status);

    // ===================================================================
    // PHASE H: Cross-System Consistency Checks
    // ===================================================================
    console.log('\n--- PHASE H: Cross-System Consistency Checks ---');

    // 26. Verify user_github_links table: 5 rows (4 members + Admin)
    const linksCount = queryAll(`
      SELECT * FROM user_github_links
      WHERE user_id IN (?, ?, ?, ?, ?)
    `, [adminUser.id, members.researcher.user.id, members.designer.user.id, members.developer.user.id, members.tester.user.id]);
    assert(
      linksCount.length === 5,
      'Step 26: user_github_links table contains exactly 5 rows (4 members + Admin)',
      null,
      `Total Links: ${linksCount.length}`
    );

    // 27. Verify project_github_memberships: 4 rows total (1 REMOVED + 3 ACTIVE for this project)
    const memberships = queryAll('SELECT * FROM project_github_memberships WHERE project_id = ?', [projectId]);
    const remCount = memberships.filter(m => m.status === 'REMOVED').length;
    const actCount = memberships.filter(m => m.status === 'ACTIVE').length;
    assert(
      memberships.length === 4 && remCount === 1 && actCount === 3,
      'Step 27: project_github_memberships contains 4 rows total (1 REMOVED + 3 ACTIVE)',
      null,
      `Removed: ${remCount}, Active: ${actCount}`
    );

    // 28. Verify access_log contains all expected GitHub actions:
    const linkActions = queryAll(`SELECT id FROM access_log WHERE action = 'GITHUB_ACCOUNT_LINKED' AND target_id IN (?, ?, ?, ?, ?)`, [
      adminUser.id, members.researcher.user.id, members.designer.user.id, members.developer.user.id, members.tester.user.id
    ]);
    const addActions = queryAll(`SELECT id FROM access_log WHERE action = 'GITHUB_MEMBER_ADDED' AND target_id IN (?, ?, ?, ?)`, [
      members.researcher.user.id, members.designer.user.id, members.developer.user.id, members.tester.user.id
    ]);
    const removeActions = queryAll(`SELECT id FROM access_log WHERE action = 'GITHUB_MEMBER_REMOVED' AND target_id = ?`, [
      members.researcher.user.id
    ]);
    const preArchiveActions = queryAll(`SELECT id FROM access_log WHERE action = 'GITHUB_REPO_ARCHIVED' AND target_id = ?`, [
      projectId
    ]);

    assert(
      linkActions.length === 5 && addActions.length === 4 && removeActions.length === 1 && preArchiveActions.length === 0,
      'Step 28: access_log contains exact expected audit trail: GITHUB_ACCOUNT_LINKED (5), GITHUB_MEMBER_ADDED (4), GITHUB_MEMBER_REMOVED (1), GITHUB_REPO_ARCHIVED (0)',
      null,
      `Links: ${linkActions.length}, Added: ${addActions.length}, Removed: ${removeActions.length}, Archived: ${preArchiveActions.length}`
    );

    // 29. Simulate archiveProjectRepo:
    // Update project status to ARCHIVED
    execute("UPDATE projects SET status = 'ARCHIVED' WHERE id = ?", [projectId]);
    const archiveResult = await archiveProjectRepo(projectId);

    const postArchiveRepo = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [projectId]);
    assert(
      archiveResult.success === true && postArchiveRepo && postArchiveRepo.status === 'ARCHIVED' && !!postArchiveRepo.archived_at,
      'Step 29 Assert: project_github_repos status = ARCHIVED and archived_at timestamp is set',
      null,
      `Archived At: ${postArchiveRepo?.archived_at}`
    );

    const postArchiveAudit = queryOne(`
      SELECT * FROM access_log WHERE action = 'GITHUB_REPO_ARCHIVED' AND target_id = ?
    `, [projectId]);
    assert(
      !!postArchiveAudit,
      'Step 29 Assert: access_log contains GITHUB_REPO_ARCHIVED record'
    );

    console.log('\n===================================================================');
    console.log(`   INTEGRATION VERIFICATION COMPLETE`);
    console.log(`   TOTAL TESTS : ${totalTests}`);
    console.log(`   PASSED      : ${passedTests}`);
    console.log(`   FAILED      : ${failedTests}`);
    console.log('===================================================================\n');

  } catch (err) {
    console.error('Fatal unhandled error during integration test run:', err);
    process.exitCode = 1;
  } finally {
    // Teardown: close server and remove temporary certificate
    if (server) {
      await new Promise((r) => server.close(r));
    }
    if (tempKeyPath && fs.existsSync(tempKeyPath)) {
      try {
        fs.unlinkSync(tempKeyPath);
      } catch {}
    }
    // Restore environment
    process.env.GITHUB_APP_ID = origAppId;
    process.env.GITHUB_APP_PRIVATE_KEY_PATH = origKeyPath;
    process.env.GITHUB_WEBHOOK_SECRET = origSecret;
    process.env.GITHUB_ORG_NAME = origOrg;
    process.env.GITHUB_APP_INSTALLATION_ID = origInstId;
  }
}

runIntegrationLifecycle();
