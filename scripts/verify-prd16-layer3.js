import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('         PRD 16 — LAYER 3: API ROUTES INTEGRATION SUITE');
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

// Spin up test server on dynamic port
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
      id: `admin-l3-${ts}`,
      name: 'Layer3 Admin',
      email: `admin.l3.${ts}@mahitechgroup.com`,
      role: 'admin'
    };
    execute(
      "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
      [adminUser.id, adminUser.name, adminUser.email, adminUser.role, dummyHash]
    );
  }

  // 2. Setup Persona Users
  const devUser = {
    id: `dev-l3-${ts}`,
    name: 'Layer3 Dev Alpha',
    email: `dev.l3.${ts}@mahitechgroup.com`,
    role: 'developer'
  };
  const devUser2 = {
    id: `dev2-l3-${ts}`,
    name: 'Layer3 Dev Beta',
    email: `dev2.l3.${ts}@mahitechgroup.com`,
    role: 'developer'
  };
  const desUser = {
    id: `des-l3-${ts}`,
    name: 'Layer3 Designer',
    email: `des.l3.${ts}@mahitechgroup.com`,
    role: 'designer'
  };
  const leadUser = {
    id: `lead-l3-${ts}`,
    name: 'Layer3 Lead Reviewer',
    email: `lead.l3.${ts}@mahitechgroup.com`,
    role: 'developer',
    sub_role: 'lead'
  };
  const nonMemberUser = {
    id: `nonmember-l3-${ts}`,
    name: 'Layer3 Outsider',
    email: `outsider.l3.${ts}@mahitechgroup.com`,
    role: 'developer'
  };

  for (const u of [devUser, devUser2, desUser, nonMemberUser]) {
    execute(
      "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
      [u.id, u.name, u.email, u.role, dummyHash]
    );
  }
  execute(
    "INSERT INTO users (id, name, email, role, sub_role, status, password_hash) VALUES (?, ?, ?, ?, ?, 'active', ?);",
    [leadUser.id, leadUser.name, leadUser.email, leadUser.role, leadUser.sub_role, dummyHash]
  );

  // Helper to generate valid active JWT + DB Session
  function makeAuthToken(user) {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    execute(`
      INSERT INTO sessions (id, user_id, token, is_revoked, expires_at)
      VALUES (?, ?, 'simulated-token', 0, ?)
    `, [sessionId, user.id, expiresAt]);

    return jwt.sign(
      { userId: user.id, sessionId, role: user.role, email: user.email },
      config.JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  const adminToken = makeAuthToken(adminUser);
  const devToken = makeAuthToken(devUser);
  const dev2Token = makeAuthToken(devUser2);
  const desToken = makeAuthToken(desUser);
  const leadToken = makeAuthToken(leadUser);
  const nonMemberToken = makeAuthToken(nonMemberUser);

  // 3. Setup Project, Deliverable & Points
  const ideaId = `idea-l3-${ts}`;
  execute(`
    INSERT INTO ideas (id, owner_id, title, description, status)
    VALUES (?, ?, 'PRD 16 Layer 3 Idea', 'Layer 3 Routes Integration', 'APPROVED')
  `, [ideaId, adminUser.id]);

  const projectId = `proj-l3-${ts}`;
  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status)
    VALUES (?, ?, 'PRD 16 Layer 3 Test Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE')
  `, [projectId, ideaId, adminUser.id]);

  // Add members
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'frontend_dev');", [`pm1-${ts}`, projectId, devUser.id]);
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'backend_dev');", [`pm2-${ts}`, projectId, devUser2.id]);
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'designer');", [`pm3-${ts}`, projectId, desUser.id]);
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'admin_reviewer');", [`pm4-${ts}`, projectId, leadUser.id]);

  const delivId = `deliv-l3-${ts}`;
  execute(`
    INSERT INTO pipeline_deliverables (id, project_id, title, current_stage, status, created_by)
    VALUES (?, ?, 'Layer 3 Test Deliverable', 'DEV', 'IN_PROGRESS', ?)
  `, [delivId, projectId, adminUser.id]);

  function insertPoint(stage, title, weight = 5) {
    const id = `pt-l3-${stage.toLowerCase()}-${crypto.randomUUID()}`;
    execute(`
      INSERT INTO pipeline_checklist_points (
        id, deliverable_id, stage, point_title, point_description, weight, status, created_by
      ) VALUES (?, ?, ?, ?, 'Layer 3 Point Desc', ?, 'UNCLAIMED', ?)
    `, [id, delivId, stage, title, weight, adminUser.id]);
    return id;
  }

  const ptDev1 = insertPoint('DEV', 'Dev Endpoint Implementation', 5);
  const ptDev2 = insertPoint('DEV', 'Dev Unit Testing', 5);
  const ptDesign = insertPoint('DESIGN', 'Figma Component Mockup', 5);
  const ptAbandoned = insertPoint('DEV', 'Abandoned Background Worker', 5);

  // Setup abandoned point: claimed 10 days ago
  execute(`
    UPDATE pipeline_checklist_points
    SET status = 'CLAIMED',
        claim_locked_by = ?,
        claim_locked_at = datetime('now', '-10 days'),
        assigned_to = ?
    WHERE id = ?
  `, [devUser2.id, devUser2.id, ptAbandoned]);

  console.log('--- TEST GROUP 1: Point Pool Management ---');

  // 1. GET /pool — 200 with stages + participation
  const poolRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/pool`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const poolData = await poolRes.json();
  assert(poolRes.status === 200 && poolData.stages && Array.isArray(poolData.participation), 'GET /pool — 200 with stages + participation', poolRes.status, `Stages: ${Object.keys(poolData.stages || {}).join(',')}`);

  // 2. GET /pool — 403 non-project member
  const nonMemberPoolRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/pool`, {
    headers: { Authorization: `Bearer ${nonMemberToken}` }
  });
  const nonMemberPoolData = await nonMemberPoolRes.json();
  assert(nonMemberPoolRes.status === 403, 'GET /pool — 403 non-project member', nonMemberPoolRes.status, nonMemberPoolData.error);

  // 3. PATCH /claim — 200 success
  const claimRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/claim`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const claimData = await claimRes.json();
  assert(claimRes.status === 200 && claimData.updatedPoint?.status === 'CLAIMED', 'PATCH /claim — 200 success', claimRes.status, `Point status: ${claimData.updatedPoint?.status}`);

  // 4. PATCH /claim — 403 role mismatch (Developer attempting DESIGN stage point)
  const roleMismatchRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDesign}/claim`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const roleMismatchData = await roleMismatchRes.json();
  assert(roleMismatchRes.status === 403, 'PATCH /claim — 403 role mismatch', roleMismatchRes.status, roleMismatchData.error);

  // 5. PATCH /claim — 409 already claimed (Another dev claiming already claimed ptDev1)
  const alreadyClaimedRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/claim`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${dev2Token}` }
  });
  const alreadyClaimedData = await alreadyClaimedRes.json();
  assert(alreadyClaimedRes.status === 409, 'PATCH /claim — 409 already claimed', alreadyClaimedRes.status, alreadyClaimedData.error);

  // 6. PATCH /release — 200 success (Lead or Admin)
  const releaseRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/release`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${leadToken}` },
    body: JSON.stringify({ reason: 'Sprint scope realignment' })
  });
  const releaseData = await releaseRes.json();
  assert(releaseRes.status === 200 && releaseData.status === 'UNCLAIMED', 'PATCH /release — 200 success (Lead/Admin)', releaseRes.status, `Status: ${releaseData.status}`);

  // Re-claim ptDev1 so we can test release 403 & 400
  await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/claim`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${devToken}` }
  });

  // 7. PATCH /release — 403 non-Lead/Admin (Regular developer attempting release)
  const releaseNonLeadRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/release`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dev2Token}` },
    body: JSON.stringify({ reason: 'Unauthorized developer release' })
  });
  const releaseNonLeadData = await releaseNonLeadRes.json();
  assert(releaseNonLeadRes.status === 403, 'PATCH /release — 403 non-Lead/Admin', releaseNonLeadRes.status, releaseNonLeadData.error);

  // 8. PATCH /release — 400 empty reason
  const releaseEmptyRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/release`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reason: '   ' })
  });
  const releaseEmptyData = await releaseEmptyRes.json();
  assert(releaseEmptyRes.status === 400, 'PATCH /release — 400 empty reason', releaseEmptyRes.status, releaseEmptyData.error);

  // 9. GET /abandoned — 200 Lead/Admin
  const abandonedLeadRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/abandoned`, {
    headers: { Authorization: `Bearer ${leadToken}` }
  });
  const abandonedLeadData = await abandonedLeadRes.json();
  assert(abandonedLeadRes.status === 200 && Array.isArray(abandonedLeadData) && abandonedLeadData.some(p => p.id === ptAbandoned), 'GET /abandoned — 200 Lead/Admin', abandonedLeadRes.status, `Abandoned count: ${abandonedLeadData.length}`);

  // 10. GET /abandoned — 403 regular member
  const abandonedRegularRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/abandoned`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const abandonedRegularData = await abandonedRegularRes.json();
  assert(abandonedRegularRes.status === 403, 'GET /abandoned — 403 regular member', abandonedRegularRes.status, abandonedRegularData.error);

  console.log('\n--- TEST GROUP 2: Participation Tracking ---');

  // 11. GET /participation — 200 Admin sees all members
  const partAdminRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/participation`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const partAdminData = await partAdminRes.json();
  assert(partAdminRes.status === 200 && Array.isArray(partAdminData) && partAdminData.length > 1, 'GET /participation — 200 Admin sees all members', partAdminRes.status, `Returned ${partAdminData.length} member profiles`);

  // 12. GET /participation — 200 member sees only own data
  const partMemberRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/participation`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const partMemberData = await partMemberRes.json();
  assert(partMemberRes.status === 200 && Array.isArray(partMemberData) && partMemberData.length === 1 && partMemberData[0].userId === devUser.id, 'GET /participation — 200 member sees only own data', partMemberRes.status, `Member userId: ${partMemberData[0]?.userId}`);

  // 13. GET /participation/me — 200 with eligible + atRisk flags
  const partMeRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/participation/me`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const partMeData = await partMeRes.json();
  assert(partMeRes.status === 200 && partMeData.stages && typeof partMeData.eligible === 'boolean' && typeof partMeData.atRisk === 'boolean', 'GET /participation/me — 200 with eligible + atRisk flags', partMeRes.status, `Overall: ${partMeData.overall}%, Eligible: ${partMeData.eligible}, AtRisk: ${partMeData.atRisk}`);

  console.log('\n--- TEST GROUP 3: Participation Threshold ---');

  // 14. GET /threshold — 200 Admin
  const threshAdminRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/threshold`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const threshAdminData = await threshAdminRes.json();
  assert(threshAdminRes.status === 200 && typeof threshAdminData.threshold_pct === 'number', 'GET /threshold — 200 Admin', threshAdminRes.status, `Threshold: ${threshAdminData.threshold_pct}%`);

  // 15. GET /threshold — 403 non-Admin
  const threshDevRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/threshold`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const threshDevData = await threshDevRes.json();
  assert(threshDevRes.status === 403, 'GET /threshold — 403 non-Admin', threshDevRes.status, threshDevData.error);

  // 16. PATCH /threshold — 200 success
  const setThreshRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/threshold`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ threshold_pct: 25.0, abandonment_days: 10 })
  });
  const setThreshData = await setThreshRes.json();
  assert(setThreshRes.status === 200 && setThreshData.threshold_pct === 25.0 && setThreshData.abandonment_days === 10, 'PATCH /threshold — 200 success', setThreshRes.status, `New: ${setThreshData.threshold_pct}%, ${setThreshData.abandonment_days} days`);

  // 17. PATCH /threshold — 400 invalid values (pct > 100)
  const invalidThreshRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/threshold`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ threshold_pct: 120.0, abandonment_days: 10 })
  });
  const invalidThreshData = await invalidThreshRes.json();
  assert(invalidThreshRes.status === 400, 'PATCH /threshold — 400 invalid values', invalidThreshRes.status, invalidThreshData.error);

  // 18. PATCH /threshold — 400 project LIVE (threshold frozen)
  const liveProjId = `proj-live-${ts}`;
  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status)
    VALUES (?, ?, 'Live Test Project', ?, 'LIVE', 'LIVE')
  `, [liveProjId, ideaId, adminUser.id]);
  const liveThreshRes = await fetch(`${BASE_URL}/api/pointpool/projects/${liveProjId}/threshold`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ threshold_pct: 20.0, abandonment_days: 7 })
  });
  const liveThreshData = await liveThreshRes.json();
  assert(liveThreshRes.status === 400, 'PATCH /threshold — 400 project LIVE', liveThreshRes.status, liveThreshData.error);

  console.log('\n--- TEST GROUP 4: Revenue Block / Unblock ---');

  // Setup revenue event & blocked split
  const revEventId = `re-l3-${ts}`;
  execute(`
    INSERT INTO revenue_events (id, project_id, amount, source, event_date, entered_by)
    VALUES (?, ?, 5000.00, 'Enterprise Contract', '2026-10-27', ?)
  `, [revEventId, projectId, adminUser.id]);

  const splitId = `split-l3-${ts}`;
  execute(`
    INSERT INTO revenue_splits (id, revenue_event_id, user_id, amount, rule_applied, split_type, is_blocked, block_reason)
    VALUES (?, ?, ?, 400.00, 'OWNER_50_TEAM_50', 'TEAM_CONTRIBUTOR', 1, 'Participation below threshold: 0% < 25% required')
  `, [splitId, revEventId, desUser.id]);

  // 19. GET /revenue-blocks — 200 Admin
  const revBlocksAdminRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/revenue-blocks`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const revBlocksAdminData = await revBlocksAdminRes.json();
  assert(revBlocksAdminRes.status === 200 && Array.isArray(revBlocksAdminData) && revBlocksAdminData.some(s => s.id === splitId), 'GET /revenue-blocks — 200 Admin', revBlocksAdminRes.status, `Blocked splits found: ${revBlocksAdminData.length}`);

  // 20. GET /revenue-blocks — 403 non-Admin
  const revBlocksDevRes = await fetch(`${BASE_URL}/api/pointpool/projects/${projectId}/revenue-blocks`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const revBlocksDevData = await revBlocksDevRes.json();
  assert(revBlocksDevRes.status === 403, 'GET /revenue-blocks — 403 non-Admin', revBlocksDevRes.status, revBlocksDevData.error);

  // 21. PATCH /unblock — 400 reason < 10 chars
  const unblockShortRes = await fetch(`${BASE_URL}/api/pointpool/revenue-splits/${splitId}/unblock`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reason: 'Short' })
  });
  const unblockShortData = await unblockShortRes.json();
  assert(unblockShortRes.status === 400, 'PATCH /unblock — 400 reason < 10 chars', unblockShortRes.status, unblockShortData.error);

  // 22. PATCH /unblock — 403 non-Admin
  const unblockNonAdminRes = await fetch(`${BASE_URL}/api/pointpool/revenue-splits/${splitId}/unblock`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${devToken}` },
    body: JSON.stringify({ reason: 'Valid length reason but not an administrator' })
  });
  const unblockNonAdminData = await unblockNonAdminRes.json();
  assert(unblockNonAdminRes.status === 403, 'PATCH /unblock — 403 non-Admin', unblockNonAdminRes.status, unblockNonAdminData.error);

  // 23. PATCH /unblock — 200 valid reason
  const unblockValidRes = await fetch(`${BASE_URL}/api/pointpool/revenue-splits/${splitId}/unblock`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reason: 'Executive Committee approved participation exemption' })
  });
  const unblockValidData = await unblockValidRes.json();
  assert(unblockValidRes.status === 200 && unblockValidData.is_blocked === 0, 'PATCH /unblock — 200 valid reason', unblockValidRes.status, `is_blocked: ${unblockValidData.is_blocked}`);

  console.log('\n--- TEST GROUP 5: Tool Links ---');

  // 24. POST /tools — 400 invalid URL
  const addToolInvalidRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${devToken}` },
    body: JSON.stringify({ tool_name: 'Figma Mockup', tool_url: 'ftp://invalid-url.com' })
  });
  const addToolInvalidData = await addToolInvalidRes.json();
  assert(addToolInvalidRes.status === 400, 'POST /tools — 400 invalid URL', addToolInvalidRes.status, addToolInvalidData.error);

  // 25. POST /tools — 201 success
  const addToolRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${devToken}` },
    body: JSON.stringify({ tool_name: 'Postman Collection', tool_url: 'https://postman.com/collections/12345' })
  });
  const addToolData = await addToolRes.json();
  assert(addToolRes.status === 201 && addToolData.id, 'POST /tools — 201 success', addToolRes.status, `Tool ID: ${addToolData.id}`);
  const toolId = addToolData.id;

  // 26. GET /tools — 200 active links only
  const getToolsRes = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/tools`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const getToolsData = await getToolsRes.json();
  assert(getToolsRes.status === 200 && Array.isArray(getToolsData) && getToolsData.some(t => t.id === toolId), 'GET /tools — 200 active links only', getToolsRes.status, `Active tools count: ${getToolsData.length}`);

  // 27. DELETE /tools/:toolId — 403 wrong user (User who didn't add tool and is not Lead/Admin)
  const delTool403Res = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/tools/${toolId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${desToken}` }
  });
  const delTool403Data = await delTool403Res.json();
  assert(delTool403Res.status === 403, 'DELETE /tools/:toolId — 403 wrong user', delTool403Res.status, delTool403Data.error);

  // 28. DELETE /tools/:toolId — 200 soft delete (Owner deletes own tool)
  const delTool200Res = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/tools/${toolId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const delTool200Data = await delTool200Res.json();
  assert(delTool200Res.status === 200, 'DELETE /tools/:toolId — 200 soft delete', delTool200Res.status, delTool200Data.message);

  // Verify it is no longer returned in active list
  const getToolsAfter = await fetch(`${BASE_URL}/api/pointpool/points/${ptDev1}/tools`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const getToolsAfterData = await getToolsAfter.json();
  assert(!getToolsAfterData.some(t => t.id === toolId), 'GET /tools — does not return soft-deleted link');

  console.log('\n===================================================================');
  console.log(`  PRD 16 LAYER 3 VERIFICATION COMPLETE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('===================================================================\n');

  server.close();
  if (passedTests !== totalTests) {
    process.exit(1);
  }
} catch (fatalErr) {
  console.error('\n❌ FATAL EXCEPTION DURING VERIFICATION:', fatalErr);
  server.close();
  process.exit(1);
}
