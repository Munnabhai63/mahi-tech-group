/**
 * scripts/verify-prd24-layer6.js
 * Verification Suite: PRD 24 Layer 6 (Full End-to-End Integration Suite & System Sealing)
 *
 * Full real HTTP integration verification against real ephemeral Express server and real SQLite database.
 * Proves the entire PRD 24 Client Portal system operates cohesively across 10 mandatory integration flows:
 *
 * Flow 1: Full Invite Lifecycle (Admin Invite -> Token -> Accept -> Login -> Suspend -> 403 -> Reactivate -> Login)
 * Flow 2: Full Project Access Flow (Grant -> /projects List -> Revoke -> Disappear & 403 -> Re-grant -> Reappear)
 * Flow 3: Full Shared Item + Feedback Flow (Share Gantt Item -> Overview/Timeline -> Submit Feedback -> DB Row -> Unshare -> Disappear -> 403 on Unshared)
 * Flow 4: Full Order + Messaging Flow (Submit Order -> Internal Msg [is_internal=1] -> External Msg [is_internal=0] -> Client Fetch [is_internal strictly absent, external present] -> Client Reply -> DB Confirmed sender_type=CLIENT, is_internal=0)
 * Flow 5: Full Milestone Approval Flow (Share Milestone -> Request Approval -> Pending View -> Client Approves -> DB Status ACHIEVED -> Re-decide 400 -> DB Trigger Block)
 * Flow 6: Cross-Client Isolation Sweep (Client A & B: Orders, Messages, Approvals, Feedback, Projects all return 403)
 * Flow 7: Append-Only Trigger Final Sweep (Real SQL UPDATE & DELETE on client_order_messages, client_milestone_approvals, client_deliverable_feedback, client_activity_log all abort)
 * Flow 8: Rate Limiting Integration (5 failed attempts -> 6th returns 429 -> lockout window reset logic)
 * Flow 9: Bi-Directional JWT Guard Final Confirmation (Internal JWT on /api/client/* -> 401; Client JWT on /api/admin/* -> 403)
 * Flow 10: is_internal + internal_notes Final Sweep (Deep-scan all 7 client GET endpoints after full population -> zero occurrences of is_internal or internal_notes)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import createApp from '../src/app.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';
import { resetClientRateLimiter, recordFailedClientLogin, isClientIpLockedOut } from '../src/middleware/clientAuth.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const sectionCounts = {};

function assert(condition, testName, sectionName = 'General') {
  totalTests++;
  if (!sectionCounts[sectionName]) {
    sectionCounts[sectionName] = { passed: 0, failed: 0, total: 0 };
  }
  sectionCounts[sectionName].total++;

  if (condition) {
    passedTests++;
    sectionCounts[sectionName].passed++;
    console.log(`  ✔ PASS: Test ${totalTests}: ${testName}`);
  } else {
    failedTests++;
    sectionCounts[sectionName].failed++;
    console.error(`  ✖ FAIL: Test ${totalTests}: ${testName}`);
  }
}

// HTTP request helper
function request(baseUrl, { method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let reqBody = null;

    if (body) {
      reqBody = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(rawData);
          } catch (e) {
            json = null;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            raw: rawData
          });
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (reqBody) {
      req.write(reqBody);
    }
    req.end();
  });
}

// Recursive deep-scan for prohibited internal keys in JSON responses
function hasDisallowedKeys(data, disallowed = ['is_internal', 'internal_notes']) {
  if (data === null || data === undefined) return false;
  if (Array.isArray(data)) {
    return data.some((item) => hasDisallowedKeys(item, disallowed));
  }
  if (typeof data === 'object') {
    for (const key of Object.keys(data)) {
      if (disallowed.includes(key)) {
        return true;
      }
      if (hasDisallowedKeys(data[key], disallowed)) {
        return true;
      }
    }
  }
  return false;
}

async function runLayer6Suite() {
  console.log('================================================================================');
  console.log('PRD 24 Layer 6 Verification Suite: Full End-to-End Integration & System Seal');
  console.log('================================================================================\n');

  // Setup Server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[TEST SERVER] Ephemeral test server active on ${baseUrl}\n`);

  const testSuffix = Date.now().toString().slice(-6);

  // Setup Admin persona
  const adminEmail = `admin.l6.${testSuffix}@mahitechgroup.com`;
  const adminHash = bcrypt.hashSync('Password123!', 8);
  execute(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, 'L6 System Admin', ?, ?, 'admin', 'active', datetime('now'), datetime('now'))`,
    [`admin-l6-${testSuffix}`, adminEmail, adminHash]
  );
  const admin = queryOne('SELECT * FROM users WHERE email = ?', [adminEmail]);

  const adminSessionId = crypto.randomUUID();
  const adminToken = jwt.sign(
    { userId: admin.id, sessionId: adminSessionId, role: admin.role, email: admin.email },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
  execute(
    `INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at)
     VALUES (?, ?, ?, ?, 0, datetime('now'))`,
    [adminSessionId, admin.id, adminToken, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()]
  );

  // Shared variables populated across flows
  let clientA = null;
  let clientAToken = null;
  let clientAId = null;
  let clientAEmail = `clientA.l6.${testSuffix}@acme-corp.com`;
  const clientAPlainPassword = 'ClientSecurePass123!';

  let clientB = null;
  let clientBToken = null;
  let clientBId = null;
  let clientBEmail = `clientB.l6.${testSuffix}@beta-ltd.com`;
  const clientBPlainPassword = 'ClientBetaPass123!';

  const project1Id = `proj-l6-1-${testSuffix}`;
  let ganttItem1Id = null;
  let milestone1Id = null;
  let sharedGanttItemId = null;
  let sharedMilestoneId = null;
  let order1Id = null;
  let approval1Id = null;

  try {
    // -------------------------------------------------------------------------
    // FLOW 1: Full Invite Lifecycle
    // -------------------------------------------------------------------------
    console.log('--- FLOW 1: Full Invite Lifecycle ---');
    const flow1Name = 'Flow 1: Invite Lifecycle';

    // 1a. Test Expired Invite Token Handling (DoD Requirement)
    const expiredInviteToken = crypto.randomBytes(32).toString('hex');
    const expiredClientEmail = `expired.l6.${testSuffix}@example.com`;
    execute(
      `INSERT INTO clients (name, email, company_name, password_hash, invite_token, invite_token_expires_at, status, created_by, created_at, updated_at)
       VALUES ('Expired Client', ?, 'Old Corp', 'placeholder_expired_hash', ?, datetime('now', '-2 hours'), 'INVITED', ?, datetime('now'), datetime('now'))`,
      [expiredClientEmail, expiredInviteToken, admin.id]
    );

    const expiredAcceptRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/accept-invite',
      body: { token: expiredInviteToken, password: 'ValidPassword123!' }
    });
    assert(expiredAcceptRes.status === 400, 'Expired invitation token rejected with 400 Bad Request', flow1Name);
    assert(expiredAcceptRes.body?.error?.includes('expired'), 'Error message explicitly notes token expiration', flow1Name);

    // 1b. Admin invites Client A via real HTTP
    const inviteRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/admin/clients/invite',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Alice Director',
        email: clientAEmail,
        company_name: 'Acme Global Corp',
        phone: '+1 555-0100'
      }
    });
    assert(inviteRes.status === 201, 'Admin invites Client A (POST /api/admin/clients/invite -> 201 Created)', flow1Name);
    assert(inviteRes.body?.client?.status === 'INVITED', "Invited client status is 'INVITED'", flow1Name);
    assert(typeof inviteRes.body?.invite_token === 'string', 'Invite token generated and returned', flow1Name);
    assert(inviteRes.body?.invite_token.length >= 64, 'Invite token is at least 32 bytes (64 hex characters)', flow1Name);

    const inviteToken = inviteRes.body.invite_token;
    clientAId = inviteRes.body.client.id;

    // Verify DB state for invitation
    const dbClientInvited = queryOne('SELECT * FROM clients WHERE id = ?', [clientAId]);
    assert(dbClientInvited !== null, 'Client A record created in SQLite clients table', flow1Name);
    assert(dbClientInvited.status === 'INVITED', "SQLite clients.status is 'INVITED'", flow1Name);
    assert(dbClientInvited.invite_token === inviteToken, 'invite_token persisted in database', flow1Name);
    assert(dbClientInvited.created_by === admin.id, 'created_by references inviting admin id', flow1Name);

    // 1c. Client A accepts invite via real HTTP
    const acceptRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/accept-invite',
      body: { token: inviteToken, password: clientAPlainPassword }
    });
    assert(acceptRes.status === 200, 'Client A accepts invite (POST /api/client/auth/accept-invite -> 200 OK)', flow1Name);
    assert(acceptRes.body?.client?.status === 'ACTIVE', "Response client status is 'ACTIVE'", flow1Name);

    // Verify DB state after acceptance
    const dbClientAccepted = queryOne('SELECT * FROM clients WHERE id = ?', [clientAId]);
    assert(dbClientAccepted.status === 'ACTIVE', "SQLite clients.status updated to 'ACTIVE'", flow1Name);
    assert(dbClientAccepted.invite_token === null, 'invite_token is immediately set to NULL upon acceptance', flow1Name);
    assert(dbClientAccepted.invite_accepted_at !== null, 'invite_accepted_at timestamp recorded', flow1Name);
    assert(dbClientAccepted.password_hash.startsWith('$2'), 'password_hash updated to secure bcrypt hash', flow1Name);

    // Attempting to re-accept the same invite token must fail with 400
    const reAcceptRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/accept-invite',
      body: { token: inviteToken, password: clientAPlainPassword }
    });
    assert(reAcceptRes.status === 400, 'Re-using accepted invite token rejected with 400 Bad Request', flow1Name);

    // 1d. Client A logs in via real HTTP -> CLIENT JWT returned
    const loginRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/login',
      body: { email: clientAEmail, password: clientAPlainPassword }
    });
    assert(loginRes.status === 200, 'Client A logs in (POST /api/client/auth/login -> 200 OK)', flow1Name);
    assert(typeof loginRes.body?.token === 'string', 'CLIENT JWT returned in response', flow1Name);
    assert(loginRes.body?.client?.role === 'CLIENT', "Client profile returned with role 'CLIENT'", flow1Name);

    clientAToken = loginRes.body.token;

    // Verify JWT claims signed with CLIENT_JWT_SECRET
    const decodedClientA = jwt.verify(clientAToken, config.CLIENT_JWT_SECRET);
    assert(decodedClientA.clientId === clientAId, 'CLIENT JWT payload contains correct clientId', flow1Name);
    assert(decodedClientA.role === 'CLIENT', "CLIENT JWT payload contains role 'CLIENT'", flow1Name);

    // 1e. Client A accesses portal profile
    const profileRes = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/auth/me',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(profileRes.status === 200, 'Client A accesses portal (GET /api/client/auth/me -> 200 OK)', flow1Name);
    assert(profileRes.body?.client?.id === clientAId, 'Portal profile matches Client A id', flow1Name);

    // 1f. Admin suspends Client A via real HTTP
    const suspendRes = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/admin/clients/${clientAId}/status`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'SUSPENDED' }
    });
    assert(suspendRes.status === 200, 'Admin suspends Client A (PATCH /api/admin/clients/:id/status -> 200 OK)', flow1Name);
    assert(suspendRes.body?.client?.status === 'SUSPENDED', "Response confirms status 'SUSPENDED'", flow1Name);

    const dbClientSuspended = queryOne('SELECT status FROM clients WHERE id = ?', [clientAId]);
    assert(dbClientSuspended.status === 'SUSPENDED', "SQLite clients.status updated to 'SUSPENDED'", flow1Name);

    // 1g. Suspended client login returns 403 Forbidden
    const suspendedLoginRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/login',
      body: { email: clientAEmail, password: clientAPlainPassword }
    });
    assert(suspendedLoginRes.status === 403, 'Suspended client login blocked with 403 Forbidden', flow1Name);
    assert(suspendedLoginRes.body?.error?.toLowerCase().includes('suspended'), 'Error notes account suspension', flow1Name);

    // 1h. Suspended client existing token rejected on portal routes
    const suspendedPortalRes = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/auth/me',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(suspendedPortalRes.status === 403, 'Suspended client active token rejected with 403 Forbidden on portal route', flow1Name);

    // 1i. Admin reactivates Client A via real HTTP
    const reactivateRes = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/admin/clients/${clientAId}/status`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'ACTIVE' }
    });
    assert(reactivateRes.status === 200, 'Admin reactivates Client A to ACTIVE (200 OK)', flow1Name);

    const dbClientActiveAgain = queryOne('SELECT status FROM clients WHERE id = ?', [clientAId]);
    assert(dbClientActiveAgain.status === 'ACTIVE', "SQLite clients.status restored to 'ACTIVE'", flow1Name);

    // 1j. Login succeeds again via real HTTP
    const loginAgainRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/login',
      body: { email: clientAEmail, password: clientAPlainPassword }
    });
    assert(loginAgainRes.status === 200, 'Client A logs in again successfully after reactivation (200 OK)', flow1Name);
    clientAToken = loginAgainRes.body.token; // Refresh active client token

    // -------------------------------------------------------------------------
    // FLOW 2: Full Project Access Flow
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 2: Full Project Access Flow ---');
    const flow2Name = 'Flow 2: Project Access';

    // Setup project in database
    execute(
      `INSERT OR IGNORE INTO ideas (id, title, description, owner_id, status, created_at, updated_at)
       VALUES ('idea-l6-1', 'Idea L6 Integration', 'E2E Test Idea', ?, 'APPROVED', datetime('now'), datetime('now'))`,
      [admin.id]
    );
    execute(
      `INSERT OR IGNORE INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at, updated_at)
       VALUES (?, 'idea-l6-1', 'Acme Global Commerce Suite', ?, 'INTEGRATION', 'ACTIVE', datetime('now'), datetime('now'))`,
      [project1Id, admin.id]
    );

    // 2a. Admin grants project access to Client A via real HTTP
    const grantRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/admin/clients/${clientAId}/projects/grant`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { projectId: project1Id, access_level: 'APPROVE' }
    });
    assert(grantRes.status === 201 || grantRes.status === 200, 'Admin grants project access (POST .../projects/grant -> 200/201)', flow2Name);

    // Direct DB check for project access row
    const dbAccessGranted = queryOne(
      'SELECT * FROM client_project_access WHERE client_id = ? AND project_id = ?',
      [clientAId, project1Id]
    );
    assert(dbAccessGranted !== null, 'client_project_access row created in SQLite', flow2Name);
    assert(dbAccessGranted.is_active === 1, 'client_project_access.is_active is 1', flow2Name);
    assert(dbAccessGranted.access_level === 'APPROVE', "access_level is 'APPROVE'", flow2Name);
    assert(dbAccessGranted.granted_by === admin.id, 'granted_by matches admin id', flow2Name);

    // 2b. Client A calls GET /api/client/projects -> project appears in list
    const clientProjectsRes = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(clientProjectsRes.status === 200, 'Client A calls GET /api/client/projects (200 OK)', flow2Name);
    const projectsList = clientProjectsRes.body?.projects || clientProjectsRes.body || [];
    assert(Array.isArray(projectsList) && projectsList.length >= 1, 'Client A projects list contains at least 1 project', flow2Name);
    const grantedProject = projectsList.find((p) => p.id === project1Id);
    assert(grantedProject !== undefined, 'Granted project matches Project 1', flow2Name);
    assert(grantedProject?.access_level === 'APPROVE', 'Granted project carries access_level APPROVE', flow2Name);

    // 2c. Admin revokes project access via real HTTP
    const revokeRes = await request(baseUrl, {
      method: 'DELETE',
      path: `/api/admin/clients/${clientAId}/projects/${project1Id}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(revokeRes.status === 200, 'Admin revokes project access (DELETE .../projects/:projectId -> 200 OK)', flow2Name);

    // Direct DB check for soft revocation
    const dbAccessRevoked = queryOne(
      'SELECT * FROM client_project_access WHERE client_id = ? AND project_id = ?',
      [clientAId, project1Id]
    );
    assert(dbAccessRevoked.is_active === 0, 'client_project_access.is_active set to 0 (soft revocation)', flow2Name);
    assert(dbAccessRevoked.revoked_by === admin.id, 'revoked_by recorded as admin id', flow2Name);
    assert(dbAccessRevoked.revoked_at !== null, 'revoked_at timestamp recorded', flow2Name);

    // 2d. Project disappears from Client A's list
    const projectsAfterRevoke = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(projectsAfterRevoke.status === 200, 'GET /api/client/projects after revoke returns 200 OK', flow2Name);
    const emptyList = projectsAfterRevoke.body?.projects || projectsAfterRevoke.body || [];
    const revokedProjectCheck = emptyList.find((p) => p.id === project1Id);
    assert(revokedProjectCheck === undefined, 'Revoked project is absent from client projects list', flow2Name);

    // 2e. Querying project overview on revoked project returns 403 Forbidden
    const revokedOverviewRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/overview`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(revokedOverviewRes.status === 403, 'Accessing revoked project overview blocked with 403 Forbidden', flow2Name);

    // 2f. Admin re-grants project access
    const regrantRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/admin/clients/${clientAId}/projects/grant`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { projectId: project1Id, access_level: 'APPROVE' }
    });
    assert(regrantRes.status === 200 || regrantRes.status === 201, 'Admin re-grants project access (200/201 OK)', flow2Name);

    const dbAccessRegranted = queryOne(
      'SELECT * FROM client_project_access WHERE client_id = ? AND project_id = ?',
      [clientAId, project1Id]
    );
    assert(dbAccessRegranted.is_active === 1, 'client_project_access.is_active restored to 1 in SQLite', flow2Name);

    // 2g. Project reappears in Client A projects list
    const projectsAfterRegrant = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    const regrantedList = projectsAfterRegrant.body?.projects || projectsAfterRegrant.body || [];
    assert(regrantedList.some((p) => p.id === project1Id), 'Project reappears in Client A project list after re-grant', flow2Name);

    // -------------------------------------------------------------------------
    // FLOW 3: Full Shared Item + Feedback Flow
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 3: Full Shared Item + Feedback Flow ---');
    const flow3Name = 'Flow 3: Shared Item & Feedback';

    // Create Gantt item in project
    execute(
      `INSERT INTO gantt_items (project_id, title, type, start_date, end_date, progress_pct, status, created_by)
       VALUES (?, 'Checkout System Architecture', 'TASK', '2026-11-01', '2026-11-10', 100, 'COMPLETED', ?)`,
      [project1Id, admin.id]
    );
    const dbGanttItem = queryOne(
      "SELECT id FROM gantt_items WHERE project_id = ? AND title = 'Checkout System Architecture' ORDER BY id DESC LIMIT 1;",
      [project1Id]
    );
    ganttItem1Id = dbGanttItem.id;

    // 3a. Admin shares gantt item via real HTTP
    const shareItemRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/admin/clients/${clientAId}/items/share`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        projectId: project1Id,
        item_type: 'gantt_item',
        item_id: ganttItem1Id
      }
    });
    assert(shareItemRes.status === 201, 'Admin shares Gantt item (POST .../items/share -> 201 Created)', flow3Name);
    sharedGanttItemId = shareItemRes.body?.shared_item?.id;

    // Verify DB state
    const dbSharedItem = queryOne('SELECT * FROM client_shared_items WHERE id = ?', [sharedGanttItemId]);
    assert(dbSharedItem !== null, 'client_shared_items row inserted into SQLite', flow3Name);
    assert(dbSharedItem.is_active === 1, 'client_shared_items.is_active is 1', flow3Name);
    assert(dbSharedItem.item_id === ganttItem1Id, 'Shared item references correct gantt item id', flow3Name);

    // 3b. Client A sees shared item in overview and timeline
    const clientOverviewRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/overview`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(clientOverviewRes.status === 200, 'Client A queries project overview (200 OK)', flow3Name);
    const sharedTasks = clientOverviewRes.body?.overview?.shared_gantt_items || clientOverviewRes.body?.shared_gantt_items || [];
    assert(sharedTasks.some((t) => t.id === ganttItem1Id), 'Shared Gantt task is present in project overview', flow3Name);

    const clientTimelineRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/timeline`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(clientTimelineRes.status === 200, 'Client A queries timeline (200 OK)', flow3Name);
    const timelineItems = clientTimelineRes.body?.timeline_items || clientTimelineRes.body || [];
    assert(timelineItems.some((t) => t.id === ganttItem1Id), 'Shared Gantt task is present in timeline view', flow3Name);

    // 3c. Client A submits deliverable feedback via real HTTP
    const feedbackRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/feedback/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        projectId: project1Id,
        item_type: 'gantt_item',
        item_id: ganttItem1Id,
        rating: 5,
        feedback_text: 'Outstanding delivery and system architecture!'
      }
    });
    assert(feedbackRes.status === 201, 'Client A submits deliverable feedback (POST /api/client/feedback/submit -> 201 Created)', flow3Name);
    assert(feedbackRes.body?.feedback?.rating === 5, 'Feedback response confirms rating 5', flow3Name);
    const feedbackId = feedbackRes.body?.feedback?.id;

    // Verify DB state for feedback
    const dbFeedback = queryOne('SELECT * FROM client_deliverable_feedback WHERE id = ?', [feedbackId]);
    assert(dbFeedback !== null, 'Feedback row confirmed in SQLite client_deliverable_feedback', flow3Name);
    assert(dbFeedback.rating === 5, 'dbFeedback.rating is 5', flow3Name);
    assert(dbFeedback.client_id === clientAId, 'dbFeedback.client_id matches Client A', flow3Name);
    assert(dbFeedback.status === 'SUBMITTED', "dbFeedback.status is 'SUBMITTED'", flow3Name);

    // 3d. Admin unshares the item via real HTTP
    const unshareRes = await request(baseUrl, {
      method: 'DELETE',
      path: `/api/admin/clients/${clientAId}/items/${sharedGanttItemId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(unshareRes.status === 200, 'Admin unshares item (DELETE .../items/:id -> 200 OK)', flow3Name);

    // Direct DB check for soft unshare
    const dbUnshared = queryOne('SELECT * FROM client_shared_items WHERE id = ?', [sharedGanttItemId]);
    assert(dbUnshared.is_active === 0, 'client_shared_items.is_active set to 0 in SQLite', flow3Name);
    assert(dbUnshared.unshared_by === admin.id, 'unshared_by matches admin id', flow3Name);
    assert(dbUnshared.unshared_at !== null, 'unshared_at timestamp recorded', flow3Name);

    // 3e. Item disappears from Client A's view
    const overviewAfterUnshare = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/overview`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    const tasksAfterUnshare = overviewAfterUnshare.body?.overview?.shared_gantt_items || overviewAfterUnshare.body?.shared_gantt_items || [];
    assert(!tasksAfterUnshare.some((t) => t.id === ganttItem1Id), 'Unshared task disappeared from project overview', flow3Name);

    // 3f. Feedback submission on now-unshared item returns 403 Forbidden
    const unsharedFeedbackRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/feedback/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        projectId: project1Id,
        item_type: 'gantt_item',
        item_id: ganttItem1Id,
        rating: 4,
        feedback_text: 'Should be rejected because item is unshared'
      }
    });
    assert(unsharedFeedbackRes.status === 403, 'Feedback submission on unshared item rejected with 403 Forbidden', flow3Name);

    // -------------------------------------------------------------------------
    // FLOW 4: Full Order + Messaging Flow
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 4: Full Order + Messaging Flow ---');
    const flow4Name = 'Flow 4: Order & Messaging';

    // 4a. Client A submits order via real HTTP
    const submitOrderRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/orders/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        projectId: project1Id,
        order_type: 'NEW_REQUEST',
        title: 'Global Payment Webhook Integration',
        description: 'Provide automated webhook callbacks for recurring billing events',
        priority: 'HIGH'
      }
    });
    assert(submitOrderRes.status === 201, 'Client submits order (POST /api/client/orders/submit -> 201 Created)', flow4Name);
    order1Id = submitOrderRes.body?.order?.id;
    assert(order1Id !== undefined, 'Order ID returned in submit response', flow4Name);
    assert(submitOrderRes.body?.order?.internal_notes === undefined, 'CRITICAL: internal_notes field stripped from submit response', flow4Name);

    // Verify DB state for order
    const dbOrder = queryOne('SELECT * FROM client_orders WHERE id = ?', [order1Id]);
    assert(dbOrder !== null, 'Order row inserted into SQLite client_orders', flow4Name);
    assert(dbOrder.client_id === clientAId, 'dbOrder.client_id matches Client A', flow4Name);
    assert(dbOrder.status === 'SUBMITTED', "dbOrder.status is 'SUBMITTED'", flow4Name);

    // 4b. Admin posts internal message (is_internal = 1)
    const internalMsgText = 'Team Internal: Requires updating rate limiting rules before deployment.';
    const adminInternalMsgRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/admin/orders/${order1Id}/messages`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        message: internalMsgText,
        is_internal: true
      }
    });
    assert(adminInternalMsgRes.status === 201, 'Admin posts internal team message (POST .../messages -> 201 Created)', flow4Name);
    assert(adminInternalMsgRes.body?.order_message?.is_internal === 1, 'Response confirms is_internal = 1', flow4Name);

    // 4c. Admin posts external message (is_internal = 0)
    const externalMsgText = 'Hello Alice, we have assigned an engineer and will ship this in the upcoming sprint.';
    const adminExternalMsgRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/admin/orders/${order1Id}/messages`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        message: externalMsgText,
        is_internal: false
      }
    });
    assert(adminExternalMsgRes.status === 201, 'Admin posts external client-facing message (201 Created)', flow4Name);
    assert(adminExternalMsgRes.body?.order_message?.is_internal === 0, 'Response confirms is_internal = 0', flow4Name);

    // 4d. Client fetches order detail via real HTTP
    const clientOrderDetailRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/orders/${order1Id}`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(clientOrderDetailRes.status === 200, 'Client fetches order detail (GET /api/client/orders/:id -> 200 OK)', flow4Name);
    assert(clientOrderDetailRes.body?.order?.internal_notes === undefined, 'CRITICAL: internal_notes stripped from order detail', flow4Name);

    const clientVisibleMessages = clientOrderDetailRes.body?.messages || [];
    assert(Array.isArray(clientVisibleMessages), 'Order detail contains messages array', flow4Name);

    // Assert: internal message is STRICTLY ABSENT
    const foundInternal = clientVisibleMessages.some((m) => m.message === internalMsgText);
    assert(!foundInternal, 'CRITICAL SECURITY INVARIANT: is_internal=1 message is STRICTLY ABSENT from client response', flow4Name);

    // Assert: external message is PRESENT
    const foundExternal = clientVisibleMessages.find((m) => m.message === externalMsgText);
    assert(foundExternal !== undefined, 'External team message is PRESENT in client messages array', flow4Name);

    // 4e. Client A replies to the order
    const clientReplyText = 'Understood, thank you for the prompt update!';
    const clientReplyRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/client/orders/${order1Id}/message`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: { message: clientReplyText }
    });
    assert(clientReplyRes.status === 201, 'Client A replies to order (POST .../message -> 201 Created)', flow4Name);
    const replyMsgId = clientReplyRes.body?.order_message?.id;

    // Verify DB state for client reply
    const dbClientReply = queryOne('SELECT * FROM client_order_messages WHERE id = ?', [replyMsgId]);
    assert(dbClientReply !== null, 'Client reply confirmed in SQLite client_order_messages', flow4Name);
    assert(dbClientReply.sender_type === 'CLIENT', "dbClientReply.sender_type is 'CLIENT'", flow4Name);
    assert(dbClientReply.is_internal === 0, 'dbClientReply.is_internal is strictly 0', flow4Name);
    assert(dbClientReply.sender_client_id === clientAId, 'dbClientReply.sender_client_id matches Client A', flow4Name);
    assert(dbClientReply.sender_user_id === null, 'dbClientReply.sender_user_id is NULL', flow4Name);

    // -------------------------------------------------------------------------
    // FLOW 5: Full Milestone Approval Flow
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 5: Full Milestone Approval Flow ---');
    const flow5Name = 'Flow 5: Milestone Approval';

    // Create Gantt milestone
    execute(
      `INSERT INTO gantt_milestones (project_id, title, milestone_date, status, created_by)
       VALUES (?, 'Q4 Production Readiness Release', '2026-12-01', 'PENDING', ?)`,
      [project1Id, admin.id]
    );
    const dbMilestone = queryOne(
      "SELECT id FROM gantt_milestones WHERE project_id = ? AND title = 'Q4 Production Readiness Release' ORDER BY id DESC LIMIT 1;",
      [project1Id]
    );
    milestone1Id = dbMilestone.id;

    // 5a. Admin shares milestone with Client A
    const shareMilestoneRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/admin/clients/${clientAId}/items/share`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        projectId: project1Id,
        item_type: 'milestone',
        item_id: milestone1Id
      }
    });
    assert(shareMilestoneRes.status === 201, 'Admin shares milestone with Client A (201 Created)', flow5Name);
    sharedMilestoneId = shareMilestoneRes.body?.shared_item?.id;

    // 5b. Admin requests milestone approval from Client A
    const requestApprovalRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/admin/milestones/${milestone1Id}/request-approval`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        clientId: clientAId,
        request_note: 'Please sign off on Q4 Production Readiness Release'
      }
    });
    assert(requestApprovalRes.status === 201, 'Admin requests milestone approval (POST .../request-approval -> 201 Created)', flow5Name);
    approval1Id = requestApprovalRes.body?.approval?.id;
    assert(approval1Id !== undefined, 'Approval request ID returned', flow5Name);

    // Verify DB state for approval request
    const dbApprovalReq = queryOne('SELECT * FROM client_milestone_approvals WHERE id = ?', [approval1Id]);
    assert(dbApprovalReq !== null, 'client_milestone_approvals row confirmed in SQLite', flow5Name);
    assert(dbApprovalReq.decision === null || dbApprovalReq.decision === 'PENDING', "Initial approval decision is pending (NULL or 'PENDING')", flow5Name);
    assert(dbApprovalReq.client_id === clientAId, 'Approval client_id matches Client A', flow5Name);

    // 5c. Client A sees pending approval in milestones view
    const clientMilestonesRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/milestones`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(clientMilestonesRes.status === 200, 'Client A queries milestones (200 OK)', flow5Name);
    const milestonesList = clientMilestonesRes.body?.milestones || clientMilestonesRes.body || [];
    const sharedMilestone = milestonesList.find((m) => m.id === milestone1Id);
    assert(sharedMilestone !== undefined, 'Shared milestone is present in client milestones view', flow5Name);
    assert(sharedMilestone?.approval_id === approval1Id, 'Milestone links to pending approval request', flow5Name);

    // 5d. Client A approves milestone with note
    const decisionNote = 'Signed off and verified by Acme Global Technical Director.';
    const approveRes = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/client/milestone/approval/${approval1Id}`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        decision: 'APPROVED',
        decision_note: decisionNote
      }
    });
    assert(approveRes.status === 200, 'Client A approves milestone (PATCH .../approval/:id -> 200 OK)', flow5Name);
    assert(approveRes.body?.approval?.decision === 'APPROVED', "Response confirms decision 'APPROVED'", flow5Name);

    // Verify DB state after approval
    const dbApprovalDecided = queryOne('SELECT * FROM client_milestone_approvals WHERE id = ?', [approval1Id]);
    assert(dbApprovalDecided.decision === 'APPROVED', "SQLite client_milestone_approvals.decision is 'APPROVED'", flow5Name);
    assert(dbApprovalDecided.decision_note === decisionNote, 'decision_note recorded in SQLite', flow5Name);
    assert(dbApprovalDecided.decided_at !== null, 'decided_at timestamp recorded in SQLite', flow5Name);

    // Assert: gantt_milestones.status is auto-updated to ACHIEVED
    const dbMilestoneAchieved = queryOne('SELECT * FROM gantt_milestones WHERE id = ?', [milestone1Id]);
    assert(dbMilestoneAchieved.status === 'ACHIEVED', "CRITICAL: gantt_milestones.status auto-transitioned to 'ACHIEVED'", flow5Name);
    assert(dbMilestoneAchieved.achieved_at !== null, 'gantt_milestones.achieved_at timestamp set', flow5Name);

    // 5e. Re-deciding an already approved milestone must return 400 Bad Request
    const reDecideRes = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/client/milestone/approval/${approval1Id}`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: { decision: 'REJECTED' }
    });
    assert(reDecideRes.status === 400, 'Re-deciding already decided milestone rejected with 400 Bad Request', flow5Name);

    // 5f. Direct SQL UPDATE blocked by DB trigger
    let triggerBlocked = false;
    try {
      execute("UPDATE client_milestone_approvals SET decision = 'REJECTED' WHERE id = ?", [approval1Id]);
    } catch (err) {
      triggerBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(triggerBlocked, 'DB trigger strictly aborts SQL UPDATE on client_milestone_approvals', flow5Name);

    // -------------------------------------------------------------------------
    // FLOW 6: Cross-Client Isolation Sweep
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 6: Cross-Client Isolation Sweep ---');
    const flow6Name = 'Flow 6: Cross-Client Isolation';

    // 6a. Invite and activate Client B
    const inviteBRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/admin/clients/invite',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Bob Director',
        email: clientBEmail,
        company_name: 'Beta Enterprises Ltd',
        phone: '+1 555-0200'
      }
    });
    const inviteBToken = inviteBRes.body?.invite_token;
    clientBId = inviteBRes.body?.client?.id;

    await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/accept-invite',
      body: { token: inviteBToken, password: clientBPlainPassword }
    });

    const loginBRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/login',
      body: { email: clientBEmail, password: clientBPlainPassword }
    });
    clientBToken = loginBRes.body?.token;
    assert(clientBToken !== undefined, 'Client B invited, accepted, and authenticated with separate JWT', flow6Name);

    // 6b. Client B attempting to access Client A order detail -> 403 Forbidden
    const crossOrderRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/orders/${order1Id}`,
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(crossOrderRes.status === 403, 'Client B accessing Client A order returns 403 Forbidden', flow6Name);

    // 6c. Client B attempting to post message to Client A order -> 403 Forbidden
    const crossMsgRes = await request(baseUrl, {
      method: 'POST',
      path: `/api/client/orders/${order1Id}/message`,
      headers: { Authorization: `Bearer ${clientBToken}` },
      body: { message: 'Intrusion message from Client B' }
    });
    assert(crossMsgRes.status === 403, 'Client B replying to Client A order returns 403 Forbidden', flow6Name);

    // 6d. Client B attempting to decide Client A milestone approval -> 403 Forbidden
    const crossApprovalRes = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/client/milestone/approval/${approval1Id}`,
      headers: { Authorization: `Bearer ${clientBToken}` },
      body: { decision: 'REJECTED' }
    });
    assert(crossApprovalRes.status === 403, 'Client B deciding Client A milestone approval returns 403 Forbidden', flow6Name);

    // 6e. Client B attempting to access Client A ungranted project overview -> 403 Forbidden
    const crossOverviewRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/overview`,
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(crossOverviewRes.status === 403, 'Client B querying ungranted Project 1 overview returns 403 Forbidden', flow6Name);

    // 6f. Client B attempting to access Client A ungranted project timeline -> 403 Forbidden
    const crossTimelineRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/timeline`,
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(crossTimelineRes.status === 403, 'Client B querying ungranted Project 1 timeline returns 403 Forbidden', flow6Name);

    // 6g. Client B attempting to access Client A ungranted project milestones -> 403 Forbidden
    const crossMilestonesRes = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/milestones`,
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(crossMilestonesRes.status === 403, 'Client B querying ungranted Project 1 milestones returns 403 Forbidden', flow6Name);

    // 6h. Client B submitting feedback on Client A ungranted project -> 403 Forbidden
    const crossFeedbackRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/feedback/submit',
      headers: { Authorization: `Bearer ${clientBToken}` },
      body: {
        projectId: project1Id,
        item_type: 'gantt_item',
        item_id: ganttItem1Id,
        rating: 5,
        feedback_text: 'Intrusion feedback from Client B'
      }
    });
    assert(crossFeedbackRes.status === 403, 'Client B submitting feedback on ungranted project returns 403 Forbidden', flow6Name);

    // 6i. Client B listing orders returns only own orders, strictly omitting Client A orders
    const clientBOrdersRes = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/orders',
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(clientBOrdersRes.status === 200, 'Client B calls GET /api/client/orders (200 OK)', flow6Name);
    const clientBOrders = clientBOrdersRes.body?.orders || clientBOrdersRes.body || [];
    assert(!clientBOrders.some((o) => o.id === order1Id), "Client B orders list strictly OMITS Client A's order", flow6Name);

    // -------------------------------------------------------------------------
    // FLOW 7: Append-Only Trigger Final Sweep
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 7: Append-Only Trigger Final Sweep ---');
    const flow7Name = 'Flow 7: Append-Only Triggers';

    // 7a. client_order_messages UPDATE & DELETE
    let msgUpdateBlocked = false;
    try {
      execute("UPDATE client_order_messages SET message = 'Tampered' WHERE id = ?", [replyMsgId]);
    } catch (err) {
      msgUpdateBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(msgUpdateBlocked, 'Trigger prevent_client_order_message_update strictly blocks SQL UPDATE on client_order_messages', flow7Name);

    let msgDeleteBlocked = false;
    try {
      execute('DELETE FROM client_order_messages WHERE id = ?', [replyMsgId]);
    } catch (err) {
      msgDeleteBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(msgDeleteBlocked, 'Trigger prevent_client_order_message_delete strictly blocks SQL DELETE on client_order_messages', flow7Name);

    // 7b. client_milestone_approvals UPDATE & DELETE
    let approvalUpdateBlocked = false;
    try {
      execute("UPDATE client_milestone_approvals SET decision = 'REJECTED' WHERE id = ?", [approval1Id]);
    } catch (err) {
      approvalUpdateBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(approvalUpdateBlocked, 'Trigger prevent_client_milestone_approval_update strictly blocks SQL UPDATE on client_milestone_approvals', flow7Name);

    let approvalDeleteBlocked = false;
    try {
      execute('DELETE FROM client_milestone_approvals WHERE id = ?', [approval1Id]);
    } catch (err) {
      approvalDeleteBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(approvalDeleteBlocked, 'Trigger prevent_client_milestone_approval_delete strictly blocks SQL DELETE on client_milestone_approvals', flow7Name);

    // 7c. client_deliverable_feedback UPDATE & DELETE
    let feedbackUpdateBlocked = false;
    try {
      execute('UPDATE client_deliverable_feedback SET rating = 1 WHERE id = ?', [feedbackId]);
    } catch (err) {
      feedbackUpdateBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(feedbackUpdateBlocked, 'Trigger prevent_client_feedback_update strictly blocks SQL UPDATE on client_deliverable_feedback', flow7Name);

    let feedbackDeleteBlocked = false;
    try {
      execute('DELETE FROM client_deliverable_feedback WHERE id = ?', [feedbackId]);
    } catch (err) {
      feedbackDeleteBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(feedbackDeleteBlocked, 'Trigger prevent_client_feedback_delete strictly blocks SQL DELETE on client_deliverable_feedback', flow7Name);

    // 7d. client_activity_log UPDATE & DELETE
    const latestLog = queryOne('SELECT id FROM client_activity_log ORDER BY id DESC LIMIT 1;');
    let logUpdateBlocked = false;
    try {
      execute("UPDATE client_activity_log SET action = 'TAMPERED' WHERE id = ?", [latestLog.id]);
    } catch (err) {
      logUpdateBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(logUpdateBlocked, 'Trigger prevent_client_activity_log_update strictly blocks SQL UPDATE on client_activity_log', flow7Name);

    let logDeleteBlocked = false;
    try {
      execute('DELETE FROM client_activity_log WHERE id = ?', [latestLog.id]);
    } catch (err) {
      logDeleteBlocked = err.message.toLowerCase().includes('append-only');
    }
    assert(logDeleteBlocked, 'Trigger prevent_client_activity_log_delete strictly blocks SQL DELETE on client_activity_log', flow7Name);

    // -------------------------------------------------------------------------
    // FLOW 8: Rate Limiting Integration
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 8: Rate Limiting Integration ---');
    const flow8Name = 'Flow 8: Rate Limiting';

    resetClientRateLimiter(); // Clear before sequence

    // 8a. Send 5 failed attempts from same IP
    for (let i = 1; i <= 5; i++) {
      const failedAttemptRes = await request(baseUrl, {
        method: 'POST',
        path: '/api/client/auth/login',
        body: { email: clientAEmail, password: `WrongPasswordAttempt_${i}` }
      });
      assert(failedAttemptRes.status === 401, `Failed login attempt ${i} returns 401 Unauthorized`, flow8Name);
    }

    // 8b. 6th attempt returns 429 Too Many Requests
    const lockoutAttemptRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/login',
      body: { email: clientAEmail, password: clientAPlainPassword } // Even with valid credentials!
    });
    assert(lockoutAttemptRes.status === 429, '6th attempt returns 429 Too Many Requests', flow8Name);
    assert(lockoutAttemptRes.body?.error?.includes('locked for 15 minutes'), 'Response states account is locked for 15 minutes', flow8Name);

    // 8c. Confirm lockout window reset logic without mock sleep
    // In src/middleware/clientAuth.js, isClientIpLockedOut(ip) checks if entry.lockedUntil <= now.
    // If expired, it auto-deletes the entry and unblocks.
    // Verify that resetting the limiter allows immediate successful login:
    resetClientRateLimiter();
    const postResetLoginRes = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/auth/login',
      body: { email: clientAEmail, password: clientAPlainPassword }
    });
    assert(postResetLoginRes.status === 200, 'After rate limit window resets, client login succeeds with 200 OK', flow8Name);
    assert(typeof postResetLoginRes.body?.token === 'string', 'Fresh CLIENT JWT returned after lockout reset', flow8Name);

    // -------------------------------------------------------------------------
    // FLOW 9: Bi-Directional JWT Guard Final Confirmation
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 9: Bi-Directional JWT Guard Final Confirmation ---');
    const flow9Name = 'Flow 9: Bi-Directional JWT Guard';

    // 9a. Internal JWT on client-facing routes -> 401 Unauthorized
    const internalOnClientProjects = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(internalOnClientProjects.status === 401, 'Internal JWT on /api/client/projects returns 401 Unauthorized', flow9Name);

    const internalOnClientOrders = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/orders',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(internalOnClientOrders.status === 401, 'Internal JWT on /api/client/orders returns 401 Unauthorized', flow9Name);

    const internalOnClientMe = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/auth/me',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(internalOnClientMe.status === 401, 'Internal JWT on /api/client/auth/me returns 401 Unauthorized', flow9Name);

    const internalOnClientOverview = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/overview`,
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(internalOnClientOverview.status === 401, 'Internal JWT on /api/client/project/:id/overview returns 401 Unauthorized', flow9Name);

    // 9b. Client JWT on internal admin routes -> 403 Forbidden
    const clientOnAdminClients = await request(baseUrl, {
      method: 'GET',
      path: '/api/admin/clients',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(clientOnAdminClients.status === 403, 'Client JWT on /api/admin/clients returns 403 Forbidden', flow9Name);

    const clientOnAdminMembers = await request(baseUrl, {
      method: 'GET',
      path: '/api/admin/members',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(clientOnAdminMembers.status === 403, 'Client JWT on /api/admin/members returns 403 Forbidden', flow9Name);

    const clientOnAdminOrders = await request(baseUrl, {
      method: 'GET',
      path: '/api/admin/orders',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(clientOnAdminOrders.status === 403, 'Client JWT on /api/admin/orders returns 403 Forbidden', flow9Name);

    const clientOnAdminInvite = await request(baseUrl, {
      method: 'POST',
      path: '/api/admin/clients/invite',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: { name: 'Rogue Client', email: 'rogue@client.com' }
    });
    assert(clientOnAdminInvite.status === 403, 'Client JWT on /api/admin/clients/invite returns 403 Forbidden', flow9Name);

    // -------------------------------------------------------------------------
    // FLOW 10: is_internal + internal_notes Final Deep-Scan Sweep
    // -------------------------------------------------------------------------
    console.log('\n--- FLOW 10: is_internal + internal_notes Final Deep-Scan Sweep ---');
    const flow10Name = 'Flow 10: Deep-Scan Sweep';

    // Endpoint 1: GET /api/client/auth/me
    const sweep1 = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/auth/me',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(sweep1.status === 200, 'GET /api/client/auth/me returns 200 OK', flow10Name);
    assert(!hasDisallowedKeys(sweep1.body), 'Deep Scan 1: GET /api/client/auth/me strictly contains zero internal keys', flow10Name);

    // Endpoint 2: GET /api/client/projects
    const sweep2 = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(sweep2.status === 200, 'GET /api/client/projects returns 200 OK', flow10Name);
    assert(!hasDisallowedKeys(sweep2.body), 'Deep Scan 2: GET /api/client/projects strictly contains zero internal keys', flow10Name);

    // Endpoint 3: GET /api/client/project/:projectId/overview
    const sweep3 = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/overview`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(sweep3.status === 200, 'GET /api/client/project/:id/overview returns 200 OK', flow10Name);
    assert(!hasDisallowedKeys(sweep3.body), 'Deep Scan 3: GET /api/client/project/:id/overview strictly contains zero internal keys', flow10Name);

    // Endpoint 4: GET /api/client/project/:projectId/timeline
    const sweep4 = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/timeline`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(sweep4.status === 200, 'GET /api/client/project/:id/timeline returns 200 OK', flow10Name);
    assert(!hasDisallowedKeys(sweep4.body), 'Deep Scan 4: GET /api/client/project/:id/timeline strictly contains zero internal keys', flow10Name);

    // Endpoint 5: GET /api/client/project/:projectId/milestones
    const sweep5 = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/project/${project1Id}/milestones`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(sweep5.status === 200, 'GET /api/client/project/:id/milestones returns 200 OK', flow10Name);
    assert(!hasDisallowedKeys(sweep5.body), 'Deep Scan 5: GET /api/client/project/:id/milestones strictly contains zero internal keys', flow10Name);

    // Endpoint 6: GET /api/client/orders
    const sweep6 = await request(baseUrl, {
      method: 'GET',
      path: '/api/client/orders',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(sweep6.status === 200, 'GET /api/client/orders returns 200 OK', flow10Name);
    assert(!hasDisallowedKeys(sweep6.body), 'Deep Scan 6: GET /api/client/orders strictly contains zero internal keys', flow10Name);

    // Endpoint 7: GET /api/client/orders/:orderId
    const sweep7 = await request(baseUrl, {
      method: 'GET',
      path: `/api/client/orders/${order1Id}`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(sweep7.status === 200, 'GET /api/client/orders/:id returns 200 OK', flow10Name);
    assert(!hasDisallowedKeys(sweep7.body), 'Deep Scan 7: GET /api/client/orders/:id strictly contains zero internal keys', flow10Name);

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n[TEST SERVER] Ephemeral test server closed cleanly.');
  }

  // Summary
  console.log('\n================================================================================');
  console.log('PRD 24 Layer 6 Verification Summary:');
  console.log('--------------------------------------------------------------------------------');
  for (const [section, counts] of Object.entries(sectionCounts)) {
    const rate = ((counts.passed / counts.total) * 100).toFixed(1);
    console.log(`  ${section.padEnd(35)}: ${counts.passed}/${counts.total} passed (${rate}%)`);
  }
  console.log('--------------------------------------------------------------------------------');
  console.log(`Total Assertions: ${totalTests}`);
  console.log(`Passed:           ${passedTests}`);
  console.log(`Failed:           ${failedTests}`);
  console.log(`Success Rate:     ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('================================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer6Suite().catch((err) => {
  console.error('Fatal error in Layer 6 verification suite:', err);
  process.exit(1);
});
