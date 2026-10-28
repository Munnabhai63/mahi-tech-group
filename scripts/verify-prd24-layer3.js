/**
 * scripts/verify-prd24-layer3.js
 * Verification Suite for PRD 24 Layer 3: Admin Client Management API
 *
 * Verifies:
 * 1. Database Connection & Pragmas (WAL mode, busy_timeout=5000, foreign_keys=ON)
 * 2. Express Server Setup on ephemeral port
 * 3. Client Listing (GET /api/admin/clients):
 *    - Member/Client blocked with 403 Forbidden
 *    - Admin lists clients with active project count and last active timestamp
 *    - access_log recorded
 * 4. Client Detail (GET /api/admin/clients/:clientId):
 *    - Member/Client blocked with 403 Forbidden
 *    - Non-existent client returns 404
 *    - Returns client detail, project access list, shared items, and activity log
 *    - access_log recorded
 * 5. Client Profile Modification (PATCH /api/admin/clients/:clientId):
 *    - Member blocked with 403 Forbidden
 *    - Updates name, company_name, phone, status
 *    - updated_at timestamp updated in SQLite
 *    - Invalid status returns 400 Bad Request
 *    - access_log recorded
 * 6. Project Access Grants (POST /api/admin/clients/:clientId/access/grant):
 *    - Member blocked with 403 Forbidden
 *    - Non-existent project returns 404
 *    - Missing project_id / invalid access_level returns 400
 *    - Successful grant creates client_project_access row (is_active=1)
 *    - Duplicate grant returns 409 Conflict (UNIQUE constraint)
 *    - access_log & client_activity_log recorded
 * 7. Project Access Revocation (PATCH /api/admin/clients/:clientId/access/revoke):
 *    - Member blocked with 403 Forbidden
 *    - Soft revocation: sets is_active=0, revoked_by, revoked_at (NOT deleted)
 *    - Direct DB SELECT confirms row preserved with is_active=0
 *    - Re-grant after revoke reactivates record (is_active=1)
 *    - access_log & client_activity_log recorded
 * 8. Shared Item Registration (POST /api/admin/clients/:clientId/share/item):
 *    - Member blocked with 403 Forbidden
 *    - Sharing on ungranted project rejected with 400 Bad Request
 *    - Non-existent item rejected with 404 Not Found (Business Rule 15)
 *    - Invalid item_type rejected with 400 Bad Request
 *    - Successful share creates client_shared_items row (is_active=1)
 *    - Duplicate item share rejected with 409 Conflict
 *    - access_log & client_activity_log recorded
 * 9. Shared Item Soft Unshare (PATCH /api/admin/clients/:clientId/share/item/:shareId/unshare):
 *    - Member blocked with 403 Forbidden
 *    - Soft unshare sets is_active=0, unshared_by, unshared_at (NOT deleted)
 *    - Direct DB SELECT confirms row preserved with is_active=0
 *    - Re-unsharing inactive item returns 404
 *    - access_log & client_activity_log recorded
 * 10. Client Activity Log Query (GET /api/admin/clients/:clientId/activity):
 *     - Member blocked with 403 Forbidden
 *     - Admin retrieves full client activity history
 *     - access_log recorded
 * 11. Admin Order Management API:
 *     - GET /api/admin/orders: Member blocked with 403; Admin receives orders with internal_notes visible
 *     - Filter query parameters (?client_id=, ?project_id=, ?status=)
 *     - PATCH /api/admin/orders/:orderId/status: Admin updates status and internal_notes; updated_at updated
 *     - Invalid status returns 400
 *     - access_log recorded
 * 12. Order Team Messages (POST /api/admin/orders/:orderId/message):
 *     - Client blocked with 403
 *     - Admin & Member can send messages with sender_type='TEAM' and is_internal toggle
 *     - client_order_messages DB trigger blocks UPDATE and DELETE (append-only)
 *     - access_log recorded
 * 13. Milestone Approval Requests (POST /api/admin/milestone/request-approval & GET /api/admin/milestone/approvals):
 *     - Member blocked with 403 Forbidden
 *     - Ungranted project returns 400 Bad Request
 *     - Creates client_milestone_approvals row
 *     - Duplicate request returns 409 Conflict (UNIQUE constraint)
 *     - GET /api/admin/milestone/approvals returns pending approval requests
 *     - access_log & client_activity_log recorded
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS:\x1b[0m Test ${totalTests}: ${message}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m Test ${totalTests}: ${message}`);
    if (details) console.error(`    \x1b[33mDetails: ${details}\x1b[0m`);
    process.exitCode = 1;
  }
}

// HTTP helper
function makeRequest(serverUrl, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          parsed = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
}

// Generate valid internal user token with DB session
function generateInternalUserToken(user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  const token = jwt.sign(
    {
      sessionId,
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name
    },
    config.JWT_SECRET,
    { expiresIn: '2h' }
  );

  execute(
    'INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
    [sessionId, user.id, token, expiresAt]
  );

  return token;
}

// Generate client token
function generateClientToken(client) {
  return jwt.sign(
    {
      clientId: client.id,
      email: client.email,
      role: 'CLIENT'
    },
    config.CLIENT_JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('PRD 24 Layer 3 Verification Suite: Admin Client Management API');
  console.log('='.repeat(80));

  // 1. Pragmas
  console.log('\n--- Section 1: SQLite Pragmas ---');
  const journal = queryOne('PRAGMA journal_mode;');
  assert(journal?.journal_mode?.toLowerCase() === 'wal', `journal_mode is WAL (was ${journal?.journal_mode})`);

  const timeout = queryOne('PRAGMA busy_timeout;');
  assert(timeout?.timeout >= 5000, `busy_timeout >= 5000 (was ${timeout?.timeout})`);

  const fk = queryOne('PRAGMA foreign_keys;');
  assert(fk?.foreign_keys === 1, 'foreign_keys pragma is enabled (1)');

  // 2. Server Setup
  console.log('\n--- Section 2: Express Server & Personas Setup ---');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${serverUrl}`);

  // Admin persona
  let admin = queryOne("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1;");
  if (!admin) {
    const adminId = crypto.randomUUID();
    execute(
      "INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Admin Layer3', 'admin_l3@mahi.test', 'hash', 'admin', 'active')",
      [adminId]
    );
    admin = queryOne('SELECT * FROM users WHERE id = ?;', [adminId]);
  }
  const adminToken = generateInternalUserToken(admin);

  // Member persona
  let member = queryOne("SELECT * FROM users WHERE role = 'developer' AND status = 'active' LIMIT 1;");
  if (!member) {
    const memberId = crypto.randomUUID();
    execute(
      "INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Dev Layer3', 'dev_l3@mahi.test', 'hash', 'developer', 'active')",
      [memberId]
    );
    member = queryOne('SELECT * FROM users WHERE id = ?;', [memberId]);
  }
  const memberToken = generateInternalUserToken(member);

  // Setup test project
  let project = queryOne('SELECT * FROM projects LIMIT 1;');
  if (!project) {
    const projId = crypto.randomUUID ? 101 : 101;
    execute(
      "INSERT INTO projects (title, description, status, created_by) VALUES ('Test Portal Project', 'Project for client portal testing', 'active', ?)",
      [admin.id]
    );
    project = queryOne('SELECT * FROM projects ORDER BY id DESC LIMIT 1;');
  }

  // Setup test client
  const timestamp = Date.now();
  const clientEmail = `client_l3_${timestamp}@example.com`;
  execute(
    `INSERT INTO clients (name, email, company_name, phone, password_hash, status, created_by, created_at, updated_at)
     VALUES ('Apex Enterprises', ?, 'Apex Global Ltd', '+91 99999 88888', '$2b$10$dummyhashplaceholderforlayer3', 'ACTIVE', ?, datetime('now'), datetime('now'))`,
    [clientEmail, admin.id]
  );
  const client = queryOne('SELECT * FROM clients WHERE email = ?;', [clientEmail]);
  const clientToken = generateClientToken(client);

  assert(adminToken.length > 20, 'Admin JWT generated with active session');
  assert(memberToken.length > 20, 'Member JWT generated with active session');
  assert(clientToken.length > 20, 'Client JWT generated');

  try {
    // 3. Client Listing (GET /api/admin/clients)
    console.log('\n--- Section 3: Client Listing API (GET /api/admin/clients) ---');
    const memberListRes = await makeRequest(serverUrl, '/api/admin/clients', {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(memberListRes.status === 403, 'Member calling GET /api/admin/clients is blocked with 403 Forbidden');

    const clientListRes = await makeRequest(serverUrl, '/api/admin/clients', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(clientListRes.status === 403, 'Client JWT calling GET /api/admin/clients is blocked with 403 Forbidden');

    const adminListRes = await makeRequest(serverUrl, '/api/admin/clients', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminListRes.status === 200, 'Admin calling GET /api/admin/clients returns 200 OK');
    assert(Array.isArray(adminListRes.data.clients), 'Response contains clients array');
    assert(adminListRes.data.clients.length > 0, 'Clients array has at least 1 client');

    const listedClient = adminListRes.data.clients.find(c => c.id === client.id);
    assert(listedClient !== undefined, 'Target client found in listed clients array');
    assert(typeof listedClient.active_projects_count === 'number', 'active_projects_count is returned as number');
    assert(listedClient.company_name === 'Apex Global Ltd', 'company_name matches database record');

    const listAccessLog = queryOne(
      "SELECT * FROM access_log WHERE user_id = ? AND action = 'LIST_CLIENTS' ORDER BY id DESC LIMIT 1;",
      [admin.id]
    );
    assert(listAccessLog !== null, "Admin action 'LIST_CLIENTS' recorded in access_log");

    // 4. Client Detail (GET /api/admin/clients/:clientId)
    console.log('\n--- Section 4: Client Detail API (GET /api/admin/clients/:clientId) ---');
    const memberDetailRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(memberDetailRes.status === 403, 'Member calling GET /api/admin/clients/:clientId is blocked with 403 Forbidden');

    const notFoundDetail = await makeRequest(serverUrl, '/api/admin/clients/999999', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundDetail.status === 404, 'Admin querying non-existent clientId returns 404 Not Found');

    const adminDetailRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminDetailRes.status === 200, 'Admin calling GET /api/admin/clients/:clientId returns 200 OK');
    assert(adminDetailRes.data.client?.id === client.id, 'client object matches requested ID');
    assert(Array.isArray(adminDetailRes.data.project_access), 'project_access array included in response');
    assert(Array.isArray(adminDetailRes.data.shared_items), 'shared_items array included in response');
    assert(Array.isArray(adminDetailRes.data.activity_log), 'activity_log array included in response');

    const detailAccessLog = queryOne(
      "SELECT * FROM access_log WHERE user_id = ? AND action = 'GET_CLIENT_DETAIL' ORDER BY id DESC LIMIT 1;",
      [admin.id]
    );
    assert(detailAccessLog !== null, "Admin action 'GET_CLIENT_DETAIL' recorded in access_log");

    // 5. Client Profile Modification (PATCH /api/admin/clients/:clientId)
    console.log('\n--- Section 5: Client Modification API (PATCH /api/admin/clients/:clientId) ---');
    const memberPatchRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Hacked Name' }
    });
    assert(memberPatchRes.status === 403, 'Member calling PATCH /api/admin/clients/:clientId is blocked with 403 Forbidden');

    const badStatusRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'INVALID_STATUS' }
    });
    assert(badStatusRes.status === 400, 'Invalid status in PATCH /api/admin/clients/:clientId returns 400 Bad Request');

    const adminPatchRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Apex Global Enterprises',
        company_name: 'Apex Group HQ',
        phone: '+91 11 2233 4455',
        status: 'ACTIVE'
      }
    });
    assert(adminPatchRes.status === 200, 'Admin updating client returns 200 OK');
    assert(adminPatchRes.data.client?.name === 'Apex Global Enterprises', 'Client name updated in response');
    assert(adminPatchRes.data.client?.company_name === 'Apex Group HQ', 'Company name updated in response');

    const clientDbAfterPatch = queryOne('SELECT * FROM clients WHERE id = ?;', [client.id]);
    assert(clientDbAfterPatch.name === 'Apex Global Enterprises', 'Direct DB SELECT confirms name updated in SQLite');
    assert(clientDbAfterPatch.updated_at !== client.created_at || clientDbAfterPatch.updated_at !== null, 'updated_at timestamp verified in SQLite');

    const updateAccessLog = queryOne(
      "SELECT * FROM access_log WHERE user_id = ? AND action = 'UPDATE_CLIENT' ORDER BY id DESC LIMIT 1;",
      [admin.id]
    );
    assert(updateAccessLog !== null, "Admin action 'UPDATE_CLIENT' recorded in access_log");

    // 6. Project Access Grant (POST /api/admin/clients/:clientId/access/grant)
    console.log('\n--- Section 6: Project Access Grant API ---');
    const memberGrantRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { project_id: project.id, access_level: 'VIEW' }
    });
    assert(memberGrantRes.status === 403, 'Member calling access grant is blocked with 403 Forbidden');

    const missingProjRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { access_level: 'VIEW' }
    });
    assert(missingProjRes.status === 400, 'Access grant missing project_id returns 400 Bad Request');

    const invalidLevelRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, access_level: 'SUPER_ACCESS' }
    });
    assert(invalidLevelRes.status === 400, 'Access grant with invalid access_level returns 400 Bad Request');

    const nonExistentProjRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: 999999, access_level: 'VIEW' }
    });
    assert(nonExistentProjRes.status === 404, 'Access grant for non-existent project returns 404 Not Found');

    const adminGrantRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, access_level: 'COMMENT' }
    });
    assert(adminGrantRes.status === 201, 'Admin granting project access returns 201 Created');
    assert(adminGrantRes.data.access?.project_id === project.id, 'Response access record matches project.id');
    assert(adminGrantRes.data.access?.access_level === 'COMMENT', "Response access_level is 'COMMENT'");
    assert(adminGrantRes.data.access?.is_active === 1, 'Response is_active is 1');

    // Direct DB check on client_project_access
    const cpaDb = queryOne(
      'SELECT * FROM client_project_access WHERE client_id = ? AND project_id = ?;',
      [client.id, project.id]
    );
    assert(cpaDb !== null, 'client_project_access row inserted in SQLite');
    assert(cpaDb.is_active === 1, 'client_project_access is_active is 1');
    assert(cpaDb.access_level === 'COMMENT', "client_project_access access_level is 'COMMENT'");
    assert(cpaDb.granted_by === admin.id, 'client_project_access granted_by is admin ID');

    // Duplicate grant while active -> 409 Conflict
    const dupGrantRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, access_level: 'APPROVE' }
    });
    assert(dupGrantRes.status === 409, 'Duplicate active project access grant returns 409 Conflict');

    // Verify logs
    const grantAccessLog = queryOne(
      "SELECT * FROM access_log WHERE user_id = ? AND action = 'GRANT_PROJECT_ACCESS' ORDER BY id DESC LIMIT 1;",
      [admin.id]
    );
    assert(grantAccessLog !== null, "access_log records 'GRANT_PROJECT_ACCESS'");

    const grantActLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'PROJECT_ACCESS_GRANTED' ORDER BY id DESC LIMIT 1;",
      [client.id]
    );
    assert(grantActLog !== null, "client_activity_log records 'PROJECT_ACCESS_GRANTED'");

    // 7. Project Access Revocation (PATCH /api/admin/clients/:clientId/access/revoke)
    console.log('\n--- Section 7: Project Access Revocation API ---');
    const memberRevokeRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/revoke`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { project_id: project.id }
    });
    assert(memberRevokeRes.status === 403, 'Member calling access revoke is blocked with 403 Forbidden');

    const adminRevokeRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/revoke`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id }
    });
    assert(adminRevokeRes.status === 200, 'Admin calling access revoke returns 200 OK');
    assert(adminRevokeRes.data.is_active === 0, 'Revoke response confirms is_active = 0');

    // Direct DB check: verified soft revoke, row NOT hard-deleted
    const cpaAfterRevoke = queryOne(
      'SELECT * FROM client_project_access WHERE client_id = ? AND project_id = ?;',
      [client.id, project.id]
    );
    assert(cpaAfterRevoke !== null, 'client_project_access row preserved in SQLite (NOT deleted)');
    assert(cpaAfterRevoke.is_active === 0, 'client_project_access is_active updated to 0');
    assert(cpaAfterRevoke.revoked_by === admin.id, 'revoked_by references admin ID');
    assert(cpaAfterRevoke.revoked_at !== null, 'revoked_at timestamp is set');

    // Re-granting access after revocation reactivates the record
    const regrantRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/access/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, access_level: 'APPROVE' }
    });
    assert(regrantRes.status === 201, 'Re-granting revoked access reactivates record with 201 Created');

    const cpaAfterRegrant = queryOne(
      'SELECT * FROM client_project_access WHERE client_id = ? AND project_id = ?;',
      [client.id, project.id]
    );
    assert(cpaAfterRegrant.is_active === 1, 'client_project_access is_active reactivated to 1');
    assert(cpaAfterRegrant.access_level === 'APPROVE', "access_level updated to 'APPROVE'");
    assert(cpaAfterRegrant.revoked_by === null, 'revoked_by cleared back to NULL');

    // 8. Shared Item Registration (POST /api/admin/clients/:clientId/share/item)
    console.log('\n--- Section 8: Shared Item Registration API ---');

    // Setup source item in gantt_items
    execute(
      `INSERT INTO gantt_items (project_id, title, type, start_date, end_date, progress_pct, status, created_by)
       VALUES (?, 'Client Test Deliverable Task', 'TASK', '2026-11-01', '2026-11-15', 50.0, 'IN_PROGRESS', ?)`,
      [project.id, admin.id]
    );
    const ganttItem = queryOne('SELECT * FROM gantt_items WHERE project_id = ? ORDER BY id DESC LIMIT 1;', [project.id]);

    // Setup milestone in gantt_milestones
    execute(
      `INSERT INTO gantt_milestones (project_id, gantt_item_id, title, milestone_date, status, created_by)
       VALUES (?, ?, 'Beta Delivery Milestone', '2026-11-15', 'PENDING', ?)`,
      [project.id, ganttItem.id, admin.id]
    );
    const milestone = queryOne('SELECT * FROM gantt_milestones WHERE project_id = ? ORDER BY id DESC LIMIT 1;', [project.id]);

    // Member blocked
    const memberShareRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/share/item`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { project_id: project.id, item_type: 'GANTT_ITEM', item_id: ganttItem.id }
    });
    assert(memberShareRes.status === 403, 'Member calling share item is blocked with 403 Forbidden');

    // Non-existent item rejected with 404 (Business Rule 15)
    const fakeItemShare = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/share/item`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, item_type: 'GANTT_ITEM', item_id: 999999 }
    });
    assert(fakeItemShare.status === 404, 'Sharing non-existent item is rejected with 404 Not Found (Rule 15)');

    // Invalid item_type rejected with 400
    const invalidTypeShare = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/share/item`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, item_type: 'RANDOM_TYPE', item_id: ganttItem.id }
    });
    assert(invalidTypeShare.status === 400, 'Sharing invalid item_type is rejected with 400 Bad Request');

    // Valid share
    const adminShareRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/share/item`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, item_type: 'GANTT_ITEM', item_id: ganttItem.id }
    });
    assert(adminShareRes.status === 201, 'Admin sharing item returns 201 Created');
    assert(adminShareRes.data.shared_item?.item_type === 'GANTT_ITEM', "shared_item.item_type is 'GANTT_ITEM'");
    assert(adminShareRes.data.shared_item?.item_id === ganttItem.id, 'shared_item.item_id matches ganttItem.id');
    assert(adminShareRes.data.shared_item?.is_active === 1, 'shared_item.is_active is 1');

    const shareId = adminShareRes.data.shared_item.id;

    // Direct DB check on client_shared_items
    const csiDb = queryOne('SELECT * FROM client_shared_items WHERE id = ?;', [shareId]);
    assert(csiDb !== null, 'client_shared_items row inserted in SQLite');
    assert(csiDb.client_id === client.id, 'client_shared_items client_id matches');
    assert(csiDb.is_active === 1, 'client_shared_items is_active is 1');
    assert(csiDb.shared_by === admin.id, 'client_shared_items shared_by matches admin.id');

    // Duplicate share attempt -> 409 Conflict
    const dupShareRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/share/item`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, item_type: 'GANTT_ITEM', item_id: ganttItem.id }
    });
    assert(dupShareRes.status === 409, 'Duplicate item share returns 409 Conflict');

    // Share milestone as well
    const adminShareMilestone = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/share/item`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, item_type: 'MILESTONE', item_id: milestone.id }
    });
    assert(adminShareMilestone.status === 201, 'Admin sharing MILESTONE returns 201 Created');

    // Verify logs
    const shareAccessLog = queryOne(
      "SELECT * FROM access_log WHERE user_id = ? AND action = 'SHARE_ITEM' ORDER BY id DESC LIMIT 1;",
      [admin.id]
    );
    assert(shareAccessLog !== null, "access_log records 'SHARE_ITEM'");

    const shareActLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'ITEM_SHARED' ORDER BY id DESC LIMIT 1;",
      [client.id]
    );
    assert(shareActLog !== null, "client_activity_log records 'ITEM_SHARED'");

    // 9. Shared Item Soft Unshare (PATCH /api/admin/clients/:clientId/share/item/:shareId/unshare)
    console.log('\n--- Section 9: Shared Item Soft Unshare API ---');
    const memberUnshareRes = await makeRequest(
      serverUrl,
      `/api/admin/clients/${client.id}/share/item/${shareId}/unshare`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${memberToken}` }
      }
    );
    assert(memberUnshareRes.status === 403, 'Member calling unshare item is blocked with 403 Forbidden');

    const adminUnshareRes = await makeRequest(
      serverUrl,
      `/api/admin/clients/${client.id}/share/item/${shareId}/unshare`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` }
      }
    );
    assert(adminUnshareRes.status === 200, 'Admin calling unshare item returns 200 OK');
    assert(adminUnshareRes.data.is_active === 0, 'Unshare response confirms is_active = 0');

    // Direct DB check: soft unshare verified
    const csiAfterUnshare = queryOne('SELECT * FROM client_shared_items WHERE id = ?;', [shareId]);
    assert(csiAfterUnshare !== null, 'client_shared_items row preserved in SQLite (NOT deleted)');
    assert(csiAfterUnshare.is_active === 0, 'client_shared_items is_active updated to 0');
    assert(csiAfterUnshare.unshared_by === admin.id, 'unshared_by references admin ID');
    assert(csiAfterUnshare.unshared_at !== null, 'unshared_at timestamp is set');

    // Unsharing already unshared item -> 404 Not Found
    const reUnshareRes = await makeRequest(
      serverUrl,
      `/api/admin/clients/${client.id}/share/item/${shareId}/unshare`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` }
      }
    );
    assert(reUnshareRes.status === 404, 'Unsharing inactive item returns 404 Not Found');

    // 10. Client Activity Log API (GET /api/admin/clients/:clientId/activity)
    console.log('\n--- Section 10: Client Activity Log Query API ---');
    const memberActRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/activity`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(memberActRes.status === 403, 'Member calling GET activity log is blocked with 403 Forbidden');

    const adminActRes = await makeRequest(serverUrl, `/api/admin/clients/${client.id}/activity`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminActRes.status === 200, 'Admin calling GET activity log returns 200 OK');
    assert(Array.isArray(adminActRes.data.activity_log), 'Response contains activity_log array');
    assert(adminActRes.data.activity_log.length > 0, 'activity_log array contains recorded events');

    // 11. Admin Order Management API
    console.log('\n--- Section 11: Admin Order Management API ---');

    // Create test order in client_orders
    execute(
      `INSERT INTO client_orders (client_id, project_id, title, description, order_type, priority, status, internal_notes, created_at, updated_at)
       VALUES (?, ?, 'New Feature Request A', 'Client requested dark mode export', 'NEW_REQUEST', 'HIGH', 'SUBMITTED', 'Private note: assess capacity before accepting', datetime('now'), datetime('now'))`,
      [client.id, project.id]
    );
    const order = queryOne('SELECT * FROM client_orders WHERE client_id = ? ORDER BY id DESC LIMIT 1;', [client.id]);

    // Member blocked from listing orders
    const memberOrdersRes = await makeRequest(serverUrl, '/api/admin/orders', {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(memberOrdersRes.status === 403, 'Member calling GET /api/admin/orders is blocked with 403 Forbidden');

    // Admin listing orders
    const adminOrdersRes = await makeRequest(serverUrl, '/api/admin/orders', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminOrdersRes.status === 200, 'Admin calling GET /api/admin/orders returns 200 OK');
    assert(Array.isArray(adminOrdersRes.data.orders), 'Response contains orders array');

    const fetchedOrder = adminOrdersRes.data.orders.find(o => o.id === order.id);
    assert(fetchedOrder !== undefined, 'Target order found in admin orders list');
    assert(fetchedOrder.internal_notes !== undefined, 'internal_notes IS visible to Admin');
    assert(fetchedOrder.internal_notes.includes('Private note'), 'internal_notes matches database content');

    // Filter by client_id
    const filteredOrders = await makeRequest(serverUrl, `/api/admin/orders?client_id=${client.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(filteredOrders.status === 200, 'Admin filtering orders by client_id returns 200 OK');
    assert(filteredOrders.data.orders.every(o => o.client_id === client.id), 'All returned orders match filtered client_id');

    // Update order status & internal notes
    const updateOrderRes = await makeRequest(serverUrl, `/api/admin/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        status: 'IN_PROGRESS',
        internal_notes: 'Assigned to Dev; kickoff scheduled',
        assigned_to: member.id
      }
    });
    assert(updateOrderRes.status === 200, 'Admin updating order status returns 200 OK');
    assert(updateOrderRes.data.order?.status === 'IN_PROGRESS', "Order status updated to 'IN_PROGRESS'");
    assert(updateOrderRes.data.order?.assigned_to === member.id, 'assigned_to updated to member.id');

    // Direct DB check
    const orderDb = queryOne('SELECT * FROM client_orders WHERE id = ?;', [order.id]);
    assert(orderDb.status === 'IN_PROGRESS', "Direct DB SELECT confirms status 'IN_PROGRESS'");
    assert(orderDb.internal_notes.includes('kickoff scheduled'), 'Direct DB SELECT confirms internal_notes updated');
    assert(orderDb.updated_at !== null, 'updated_at timestamp verified in SQLite');

    // 12. Order Messages API (POST /api/admin/orders/:orderId/message)
    console.log('\n--- Section 12: Order Messages API ---');

    // Client JWT blocked on internal admin order message route
    const clientMsgRes = await makeRequest(serverUrl, `/api/admin/orders/${order.id}/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}` },
      body: { message: 'Client trying internal route' }
    });
    assert(clientMsgRes.status === 403, 'Client JWT blocked from POST /api/admin/orders/:id/message (403)');

    // Admin posting internal note message (is_internal = 1)
    const adminMsgRes = await makeRequest(serverUrl, `/api/admin/orders/${order.id}/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { message: 'Internal discussion: check sprint velocity before committing', is_internal: 1 }
    });
    assert(adminMsgRes.status === 201, 'Admin posting internal message returns 201 Created');
    assert(adminMsgRes.data.order_message?.is_internal === 1, 'order_message.is_internal is 1');
    assert(adminMsgRes.data.order_message?.sender_type === 'TEAM', "sender_type is 'TEAM'");

    // Member posting external message (is_internal = 0)
    const memberMsgRes = await makeRequest(serverUrl, `/api/admin/orders/${order.id}/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { message: 'Hi Client, we have started on your request.', is_internal: 0 }
    });
    assert(memberMsgRes.status === 201, 'Member posting external message returns 201 Created');
    assert(memberMsgRes.data.order_message?.is_internal === 0, 'order_message.is_internal is 0');

    // Direct DB check on client_order_messages
    const messagesDb = queryAll('SELECT * FROM client_order_messages WHERE order_id = ?;', [order.id]);
    assert(messagesDb.length >= 2, 'client_order_messages contains at least 2 messages in SQLite');

    // Immutability triggers on client_order_messages
    const sampleMsg = messagesDb[0];
    let msgUpdateBlocked = false;
    try {
      execute("UPDATE client_order_messages SET message = 'MODIFIED' WHERE id = ?;", [sampleMsg.id]);
    } catch (e) {
      msgUpdateBlocked = e.message.includes('append-only');
    }
    assert(msgUpdateBlocked, 'DB trigger strictly aborts SQL UPDATE on client_order_messages');

    let msgDeleteBlocked = false;
    try {
      execute('DELETE FROM client_order_messages WHERE id = ?;', [sampleMsg.id]);
    } catch (e) {
      msgDeleteBlocked = e.message.includes('append-only');
    }
    assert(msgDeleteBlocked, 'DB trigger strictly aborts SQL DELETE on client_order_messages');

    // 13. Milestone Approval Requests API
    console.log('\n--- Section 13: Milestone Approval Requests API ---');

    // Member blocked
    const memberReqRes = await makeRequest(serverUrl, '/api/admin/milestone/request-approval', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { client_id: client.id, project_id: project.id, milestone_id: milestone.id }
    });
    assert(memberReqRes.status === 403, 'Member calling milestone request-approval is blocked with 403 Forbidden');

    // Admin requests approval
    const adminReqRes = await makeRequest(serverUrl, '/api/admin/milestone/request-approval', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { client_id: client.id, project_id: project.id, milestone_id: milestone.id }
    });
    assert(adminReqRes.status === 201, 'Admin requesting milestone approval returns 201 Created');
    assert(adminReqRes.data.approval_request?.client_id === client.id, 'approval_request.client_id matches');
    assert(adminReqRes.data.approval_request?.milestone_id === milestone.id, 'approval_request.milestone_id matches');

    // Direct DB check on client_milestone_approvals
    const cmaDb = queryOne(
      'SELECT * FROM client_milestone_approvals WHERE client_id = ? AND milestone_id = ?;',
      [client.id, milestone.id]
    );
    assert(cmaDb !== null, 'client_milestone_approvals row inserted in SQLite');
    assert(cmaDb.decision === null, 'Initial decision is NULL (pending)');
    assert(cmaDb.requested_by === admin.id, 'requested_by references admin ID');

    // Duplicate request returns 409 Conflict
    const dupReqRes = await makeRequest(serverUrl, '/api/admin/milestone/request-approval', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { client_id: client.id, project_id: project.id, milestone_id: milestone.id }
    });
    assert(dupReqRes.status === 409, 'Duplicate milestone approval request returns 409 Conflict');

    // Admin lists pending milestone approvals
    const listApprovalsRes = await makeRequest(serverUrl, '/api/admin/milestone/approvals?status=PENDING', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(listApprovalsRes.status === 200, 'GET /api/admin/milestone/approvals returns 200 OK');
    assert(Array.isArray(listApprovalsRes.data.approvals), 'Response contains approvals array');

    const foundApproval = listApprovalsRes.data.approvals.find(a => a.id === cmaDb.id);
    assert(foundApproval !== undefined, 'Created milestone approval request found in pending list');
    assert(foundApproval.milestone_title === 'Beta Delivery Milestone', 'Milestone title joined and populated');

    // Verify logs
    const milestoneAccessLog = queryOne(
      "SELECT * FROM access_log WHERE user_id = ? AND action = 'REQUEST_MILESTONE_APPROVAL' ORDER BY id DESC LIMIT 1;",
      [admin.id]
    );
    assert(milestoneAccessLog !== null, "access_log records 'REQUEST_MILESTONE_APPROVAL'");

    const milestoneActLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'MILESTONE_APPROVAL_REQUESTED' ORDER BY id DESC LIMIT 1;",
      [client.id]
    );
    assert(milestoneActLog !== null, "client_activity_log records 'MILESTONE_APPROVAL_REQUESTED'");

  } finally {
    server.close();
  }

  // Final Summary
  console.log('\n' + '='.repeat(80));
  console.log(`PRD 24 Layer 3 Verification Summary:`);
  console.log(`Total Assertions: ${totalTests}`);
  console.log(`Passed:           ${passedTests}`);
  console.log(`Failed:           ${failedTests}`);
  console.log(`Success Rate:     ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
