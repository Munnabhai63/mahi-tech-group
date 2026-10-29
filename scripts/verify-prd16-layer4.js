import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('         PRD 16 — LAYER 4: FRONTEND INTEGRATION TEST SUITE');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName, statusCode = null, details = '') {
  totalTests++;
  const statusStr = statusCode !== null ? `[HTTP ${statusCode}] ` : '';
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${statusStr}${testName}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    console.error(`  ❌ FAIL: ${statusStr}${testName}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

// Spin up test server on dynamic ephemeral port
const app = createApp();
const server = http.createServer(app);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;

try {
  const ts = Date.now();
  const dummyHash = '$2a$10$abcdefghijklmnopqrstuu';

  // 1. Setup Admin user
  let adminUser = queryOne("SELECT * FROM users WHERE role = 'admin' LIMIT 1;");
  if (!adminUser) {
    adminUser = {
      id: `admin-l4-${ts}`,
      name: 'Layer4 Admin',
      email: `admin.l4.${ts}@mahitechgroup.com`,
      role: 'admin'
    };
    execute(
      "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
      [adminUser.id, adminUser.name, adminUser.email, adminUser.role, dummyHash]
    );
  }

  // 2. Setup Persona Users
  const resUser = {
    id: `res-l4-${ts}`,
    name: 'Layer4 Researcher',
    email: `res.l4.${ts}@mahitechgroup.com`,
    role: 'researcher'
  };
  const desUser = {
    id: `des-l4-${ts}`,
    name: 'Layer4 Designer',
    email: `des.l4.${ts}@mahitechgroup.com`,
    role: 'designer'
  };
  const devUser = {
    id: `dev-l4-${ts}`,
    name: 'Layer4 Dev',
    email: `dev.l4.${ts}@mahitechgroup.com`,
    role: 'developer'
  };
  const leadUser = {
    id: `lead-l4-${ts}`,
    name: 'Layer4 Lead',
    email: `lead.l4.${ts}@mahitechgroup.com`,
    role: 'developer',
    sub_role: 'lead'
  };
  const nonMemberUser = {
    id: `non-l4-${ts}`,
    name: 'Layer4 Non-Member',
    email: `non.l4.${ts}@mahitechgroup.com`,
    role: 'developer'
  };

  [resUser, desUser, devUser, leadUser, nonMemberUser].forEach(u => {
    execute(
      "INSERT INTO users (id, name, email, role, sub_role, status, password_hash) VALUES (?, ?, ?, ?, ?, 'active', ?);",
      [u.id, u.name, u.email, u.role, u.sub_role || null, dummyHash]
    );
  });

  // JWT Helper with session recording
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

  const adminHeader = createAuthHeader(adminUser);
  const resHeader = createAuthHeader(resUser);
  const desHeader = createAuthHeader(desUser);
  const devHeader = createAuthHeader(devUser);
  const leadHeader = createAuthHeader(leadUser);
  const nonMemberHeader = createAuthHeader(nonMemberUser);

  // 3. Setup Project, Deliverable, and Points
  const projectId = `prj-l4-${ts}`;
  const ideaId = `idea-l4-${ts}`;
  execute(
    "INSERT INTO ideas (id, title, description, owner_id, status) VALUES (?, 'Layer 4 Project Idea', 'Test idea', ?, 'APPROVED');",
    [ideaId, resUser.id]
  );
  execute(
    "INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status) VALUES (?, ?, 'Layer 4 Point Pool Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE');",
    [projectId, ideaId, resUser.id]
  );

  // Add members
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'researcher');", [`pm1-${ts}`, projectId, resUser.id]);
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'designer');", [`pm2-${ts}`, projectId, desUser.id]);
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'frontend_dev');", [`pm3-${ts}`, projectId, devUser.id]);
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'admin_reviewer');", [`pm4-${ts}`, projectId, leadUser.id]);

  const delivId = `deliv-l4-${ts}`;
  execute(
    "INSERT INTO pipeline_deliverables (id, project_id, title, current_stage, status, created_by) VALUES (?, ?, 'Primary Deliverable', 'RESEARCH', 'ACTIVE', ?);",
    [delivId, projectId, leadUser.id]
  );

  // Points in RESEARCH
  const ptRes1 = `pt-res1-l4-${ts}`;
  const ptRes2 = `pt-res2-l4-${ts}`;
  execute(
    "INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, point_description, weight, status, created_by) VALUES (?, ?, 'RESEARCH', 'Literature Survey', 'Desc', 5, 'UNCLAIMED', ?);",
    [ptRes1, delivId, adminUser.id]
  );
  execute(
    "INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, point_description, weight, status, created_by) VALUES (?, ?, 'RESEARCH', 'Benchmark Analysis', 'Desc', 5, 'UNCLAIMED', ?);",
    [ptRes2, delivId, adminUser.id]
  );

  // Points in DESIGN
  const ptDes1 = `pt-des1-l4-${ts}`;
  execute(
    "INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, point_description, weight, status, created_by) VALUES (?, ?, 'DESIGN', 'Wireframe Prototyping', 'Desc', 5, 'UNCLAIMED', ?);",
    [ptDes1, delivId, adminUser.id]
  );

  // Points in DEV
  const ptDev1 = `pt-dev1-l4-${ts}`;
  execute(
    "INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, point_description, weight, status, created_by) VALUES (?, ?, 'DEV', 'API Routes & Scaffold', 'Desc', 5, 'UNCLAIMED', ?);",
    [ptDev1, delivId, adminUser.id]
  );

  // Points in TEST
  const ptTest1 = `pt-test1-l4-${ts}`;
  execute(
    "INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, point_description, weight, status, created_by) VALUES (?, ?, 'TEST', 'QA Acceptance Testing', 'Desc', 5, 'UNCLAIMED', ?);",
    [ptTest1, delivId, adminUser.id]
  );

  // Abandoned point for Lead/Admin testing
  const ptAbandon = `pt-abandon-l4-${ts}`;
  execute(
    "INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, point_description, weight, status, claim_locked_by, claim_locked_at, assigned_to, created_by) VALUES (?, ?, 'DEV', 'Abandoned Architecture Spec', 'Desc', 5, 'CLAIMED', ?, datetime('now', '-10 days'), ?, ?);",
    [ptAbandon, delivId, devUser.id, devUser.id, adminUser.id]
  );
  execute(
    "INSERT INTO point_pool_claims (id, point_id, project_id, deliverable_id, stage, claimed_by, claimed_at) VALUES (?, ?, ?, ?, 'DEV', ?, datetime('now', '-10 days'));",
    [`claim-ab-${ts}`, ptAbandon, projectId, delivId, devUser.id]
  );

  // Live Project for Threshold Freeze Testing
  const liveProjectId = `prj-live-l4-${ts}`;
  execute(
    "INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status) VALUES (?, ?, 'Live Production System', ?, 'LIVE', 'LIVE');",
    [liveProjectId, ideaId, adminUser.id]
  );

  // Revenue Event & Blocked Split for Group 4 Testing
  const revEventId = `rev-ev-l4-${ts}`;
  execute(
    "INSERT INTO revenue_events (id, project_id, amount, source, event_date) VALUES (?, ?, 100000.00, 'Enterprise License Contract', CURRENT_DATE);",
    [revEventId, projectId]
  );
  const blockedSplitId = `split-blk-l4-${ts}`;
  execute(
    "INSERT INTO revenue_splits (id, revenue_event_id, user_id, rule_applied, amount, is_blocked, block_reason) VALUES (?, ?, ?, 'OWNER_50_TEAM_50', 15000.00, 1, 'Participation 12.50% below required 20.00% threshold');",
    [blockedSplitId, revEventId, devUser.id]
  );

  // Generic HTTP Fetcher
  async function request(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, options);
    let body = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    } else {
      body = await res.text();
    }
    return { status: res.status, headers: res.headers, body };
  }

  // ===================================================================
  // ASSERTION GROUP 1: Static File Serving (5 assertions)
  // ===================================================================
  console.log('--- ASSERTION GROUP 1: Static File Serving ---');

  const g1_1 = await request('/point-pool-board.html');
  assert(g1_1.status === 200 && typeof g1_1.body === 'string' && g1_1.body.includes('Point Pool Kanban'), 'GET /point-pool-board.html → 200', g1_1.status);

  const g1_2 = await request('/js/point-pool-board.js');
  assert(g1_2.status === 200 && typeof g1_2.body === 'string' && g1_2.body.includes('Point Pool Board Controller'), 'GET /js/point-pool-board.js → 200', g1_2.status);

  const g1_3 = await request('/participation-dashboard.html');
  assert(g1_3.status === 200 && typeof g1_3.body === 'string' && g1_3.body.includes('Participation Dashboard'), 'GET /participation-dashboard.html → 200', g1_3.status);

  const g1_4 = await request('/js/participation-dashboard.js');
  assert(g1_4.status === 200 && typeof g1_4.body === 'string' && g1_4.body.includes('Participation Dashboard Controller'), 'GET /js/participation-dashboard.js → 200', g1_4.status);

  const g1_5 = await request('/admin-threshold.html');
  assert(g1_5.status === 200 && typeof g1_5.body === 'string' && g1_5.body.includes('Participation Threshold'), 'GET /admin-threshold.html → 200', g1_5.status);

  // ===================================================================
  // ASSERTION GROUP 2: API Integration from Frontend Flow (10 assertions)
  // ===================================================================
  console.log('\n--- ASSERTION GROUP 2: API Integration from Frontend Flow ---');

  // 1. Unauthenticated access → 401
  const g2_1 = await request(`/api/pointpool/projects/${projectId}/pool`);
  assert(g2_1.status === 401, 'Unauthenticated access to /api/pointpool/* → 401', g2_1.status, g2_1.body?.error);

  // 2. Non-member GET /pool → 403
  const g2_2 = await request(`/api/pointpool/projects/${projectId}/pool`, {
    headers: { Authorization: nonMemberHeader }
  });
  assert(g2_2.status === 403, 'Non-member GET /pool → 403', g2_2.status, g2_2.body?.error);

  // 3. Member GET /pool → 200 with stages array
  const g2_3 = await request(`/api/pointpool/projects/${projectId}/pool`, {
    headers: { Authorization: resHeader }
  });
  assert(
    g2_3.status === 200 && Array.isArray(g2_3.body?.stages?.RESEARCH),
    'Member GET /pool → 200 with stages array',
    g2_3.status,
    `RESEARCH points: ${g2_3.body?.stages?.RESEARCH?.length}`
  );

  // 4. Member (role=researcher) PATCH /claim on RESEARCH point → 200
  const g2_4 = await request(`/api/pointpool/points/${ptRes1}/claim`, {
    method: 'PATCH',
    headers: { Authorization: resHeader }
  });
  assert(g2_4.status === 200, 'Member (role=researcher) PATCH /claim on RESEARCH point → 200', g2_4.status, `Status: ${g2_4.body?.updatedPoint?.status}`);

  // 5. Member (role=designer) PATCH /claim on RESEARCH point → 403 (role mismatch)
  const g2_5 = await request(`/api/pointpool/points/${ptRes2}/claim`, {
    method: 'PATCH',
    headers: { Authorization: desHeader }
  });
  assert(g2_5.status === 403, 'Member (role=designer) PATCH /claim on RESEARCH point → 403 (role mismatch)', g2_5.status, g2_5.body?.error);

  // 6. Lead GET /abandoned → 200
  const g2_6 = await request(`/api/pointpool/projects/${projectId}/abandoned`, {
    headers: { Authorization: leadHeader }
  });
  assert(g2_6.status === 200 && Array.isArray(g2_6.body), 'Lead GET /abandoned → 200', g2_6.status, `Abandoned count: ${g2_6.body?.length}`);

  // 7. Regular member GET /abandoned → 403
  const g2_7 = await request(`/api/pointpool/projects/${projectId}/abandoned`, {
    headers: { Authorization: devHeader }
  });
  assert(g2_7.status === 403, 'Regular member GET /abandoned → 403', g2_7.status, g2_7.body?.error);

  // 8. Admin GET /threshold → 200
  const g2_8 = await request(`/api/pointpool/projects/${projectId}/threshold`, {
    headers: { Authorization: adminHeader }
  });
  assert(g2_8.status === 200, 'Admin GET /threshold → 200', g2_8.status, `Threshold: ${g2_8.body?.threshold_pct}%`);

  // 9. Regular member GET /threshold → 403
  const g2_9 = await request(`/api/pointpool/projects/${projectId}/threshold`, {
    headers: { Authorization: resHeader }
  });
  assert(g2_9.status === 403, 'Regular member GET /threshold → 403', g2_9.status, g2_9.body?.error);

  // 10. Admin PATCH /threshold on LIVE project → 400
  const g2_10 = await request(`/api/pointpool/projects/${liveProjectId}/threshold`, {
    method: 'PATCH',
    headers: { Authorization: adminHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ threshold_pct: 30.0, abandonment_days: 10 })
  });
  assert(g2_10.status === 400, 'Admin PATCH /threshold on LIVE project → 400', g2_10.status, g2_10.body?.error);

  // ===================================================================
  // ASSERTION GROUP 3: Tool Links Flow (5 assertions)
  // ===================================================================
  console.log('\n--- ASSERTION GROUP 3: Tool Links Flow ---');

  // 1. POST /tools with invalid URL → 400
  const g3_1 = await request(`/api/pointpool/points/${ptRes1}/tools`, {
    method: 'POST',
    headers: { Authorization: resHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_name: 'Figma Prototype', tool_url: 'ftp://invalid-url.com' })
  });
  assert(g3_1.status === 400, 'POST /tools with invalid URL → 400', g3_1.status, g3_1.body?.error);

  // 2. POST /tools with valid URL → 201
  const g3_2 = await request(`/api/pointpool/points/${ptRes1}/tools`, {
    method: 'POST',
    headers: { Authorization: resHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_name: 'Research Notion Spec', tool_url: 'https://notion.so/workspace/doc-1' })
  });
  const createdToolId = g3_2.body?.id;
  assert(g3_2.status === 201 && createdToolId, 'POST /tools with valid URL → 201', g3_2.status, `Tool ID: ${createdToolId}`);

  // 3. GET /tools → 200, returns 1 active link
  const g3_3 = await request(`/api/pointpool/points/${ptRes1}/tools`, {
    headers: { Authorization: resHeader }
  });
  assert(g3_3.status === 200 && g3_3.body?.length === 1, 'GET /tools → 200, returns 1 active link', g3_3.status, `Count: ${g3_3.body?.length}`);

  // 4. DELETE /tools/:toolId by non-owner/non-Lead → 403
  const g3_4 = await request(`/api/pointpool/points/${ptRes1}/tools/${createdToolId}`, {
    method: 'DELETE',
    headers: { Authorization: devHeader }
  });
  assert(g3_4.status === 403, 'DELETE /tools/:toolId by non-owner/non-Lead → 403', g3_4.status, g3_4.body?.error);

  // 5. DELETE /tools/:toolId by owner → 200
  const g3_5 = await request(`/api/pointpool/points/${ptRes1}/tools/${createdToolId}`, {
    method: 'DELETE',
    headers: { Authorization: resHeader }
  });
  assert(g3_5.status === 200, 'DELETE /tools/:toolId by owner → 200', g3_5.status, g3_5.body?.message);

  // ===================================================================
  // ASSERTION GROUP 4: Revenue Block Flow (5 assertions)
  // ===================================================================
  console.log('\n--- ASSERTION GROUP 4: Revenue Block Flow ---');

  // 1. Admin GET /revenue-blocks → 200
  const g4_1 = await request(`/api/pointpool/projects/${projectId}/revenue-blocks`, {
    headers: { Authorization: adminHeader }
  });
  assert(g4_1.status === 200 && Array.isArray(g4_1.body) && g4_1.body.length >= 1, 'Admin GET /revenue-blocks → 200', g4_1.status, `Blocked count: ${g4_1.body?.length}`);

  // 2. Non-admin GET /revenue-blocks → 403
  const g4_2 = await request(`/api/pointpool/projects/${projectId}/revenue-blocks`, {
    headers: { Authorization: devHeader }
  });
  assert(g4_2.status === 403, 'Non-admin GET /revenue-blocks → 403', g4_2.status, g4_2.body?.error);

  // 3. Admin PATCH /unblock with reason < 10 chars → 400
  const g4_3 = await request(`/api/pointpool/revenue-splits/${blockedSplitId}/unblock`, {
    method: 'PATCH',
    headers: { Authorization: adminHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'short' })
  });
  assert(g4_3.status === 400, 'Admin PATCH /unblock with reason < 10 chars → 400', g4_3.status, g4_3.body?.error);

  // 4. Non-admin PATCH /unblock → 403
  const g4_4 = await request(`/api/pointpool/revenue-splits/${blockedSplitId}/unblock`, {
    method: 'PATCH',
    headers: { Authorization: devHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Valid length justification for testing' })
  });
  assert(g4_4.status === 403, 'Non-admin PATCH /unblock → 403', g4_4.status, g4_4.body?.error);

  // 5. Admin PATCH /unblock with valid reason → 200
  const g4_5 = await request(`/api/pointpool/revenue-splits/${blockedSplitId}/unblock`, {
    method: 'PATCH',
    headers: { Authorization: adminHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Administrative override approved for exceptional cross-track delivery' })
  });
  assert(g4_5.status === 200 && g4_5.body?.is_blocked === 0, 'Admin PATCH /unblock with valid reason → 200', g4_5.status, `is_blocked: ${g4_5.body?.is_blocked}`);

  // ===================================================================
  // ASSERTION GROUP 5: Participation % Display Flow (5 assertions)
  // ===================================================================
  console.log('\n--- ASSERTION GROUP 5: Participation % Display Flow ---');

  // 1. Admin GET /participation → 200 with array of all members
  const g5_1 = await request(`/api/pointpool/projects/${projectId}/participation`, {
    headers: { Authorization: adminHeader }
  });
  assert(g5_1.status === 200 && Array.isArray(g5_1.body) && g5_1.body.length >= 4, 'Admin GET /participation → 200 with array of all members', g5_1.status, `Members count: ${g5_1.body?.length}`);

  // 2. Member GET /participation → 200 with only own entry
  const g5_2 = await request(`/api/pointpool/projects/${projectId}/participation`, {
    headers: { Authorization: devHeader }
  });
  assert(
    g5_2.status === 200 && Array.isArray(g5_2.body) && g5_2.body.length === 1 && (g5_2.body[0].user_id === devUser.id || g5_2.body[0].userId === devUser.id),
    'Member GET /participation → 200 with only own entry',
    g5_2.status,
    `Returned member: ${g5_2.body[0]?.user_name || g5_2.body[0]?.name} (${g5_2.body[0]?.user_id || g5_2.body[0]?.userId})`
  );

  // 3. GET /participation/me → 200 with overall %, eligible, atRisk
  const g5_3 = await request(`/api/pointpool/projects/${projectId}/participation/me`, {
    headers: { Authorization: devHeader }
  });
  assert(
    g5_3.status === 200 && g5_3.body && 'overall' in g5_3.body && 'eligible' in g5_3.body && 'atRisk' in g5_3.body,
    'GET /participation/me → 200 with overall %, eligible, atRisk',
    g5_3.status,
    `overall: ${g5_3.body?.overall}%, eligible: ${g5_3.body?.eligible}, atRisk: ${g5_3.body?.atRisk}`
  );

  // 4. At-risk member: atRisk = true when overall % < threshold
  assert(
    g5_3.body?.atRisk === true,
    'At-risk member: atRisk = true when overall % < threshold',
    g5_3.status,
    `atRisk is strictly true (${g5_3.body?.overall}% < ${g5_3.body?.threshold}%)`
  );

  // 5. Blocked member: is_blocked = 1 reflected in participation response
  // Insert a blocked split for a specific member to verify participation reflection
  const testBlockedSplitId = `split-test-blk-${ts}`;
  execute(
    "INSERT INTO revenue_splits (id, revenue_event_id, user_id, rule_applied, amount, is_blocked, block_reason) VALUES (?, ?, ?, 'OWNER_50_TEAM_50', 5000.00, 1, 'Below threshold');",
    [testBlockedSplitId, revEventId, desUser.id]
  );

  const g5_5 = await request(`/api/pointpool/projects/${projectId}/participation`, {
    headers: { Authorization: adminHeader }
  });
  const desEntry = g5_5.body?.find(m => m.user_id === desUser.id || m.userId === desUser.id);
  assert(
    g5_5.status === 200 && desEntry && (desEntry.is_blocked === 1 || desEntry.isBlocked === true),
    'Blocked member: is_blocked = 1 reflected in participation response',
    g5_5.status,
    `Member ${desEntry?.user_name || desEntry?.name}: is_blocked = ${desEntry?.is_blocked}`
  );

  console.log('\n===================================================================');
  console.log(`  PRD 16 LAYER 4 VERIFICATION COMPLETE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('===================================================================\n');

} catch (err) {
  console.error('Fatal test error in Layer 4 verification:', err);
  process.exitCode = 1;
} finally {
  server.close();
}
