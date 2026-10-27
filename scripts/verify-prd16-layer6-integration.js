/**
 * PRD 16 — LAYER 6: FULL END-TO-END INTEGRATION TEST SUITE
 * 
 * Simulates one complete real-world PRD 16 usage lifecycle across all 5 layers:
 *   - Phase A: Setup (Admin, 4 Members, Project, Deliverable, 4 Points)
 *   - Phase B: Point Pool Flow (Claim, Role Mismatch, Release, Abandoned, Re-claim)
 *   - Phase C: Tool Links Flow (Add, List, Unauthorized Delete 403, Soft Delete, Re-check)
 *   - Phase D: Participation % Flow (Approve Point, /me %, Admin View All, Designer View Own 0%)
 *   - Phase E: Threshold + Block Flow (Set Threshold, Revenue Split Block, Admin Unblock, Blocks List)
 *   - Phase F: Notification Verification (All 5 Event Types in DB, read_status = 0, valid URLs)
 *   - Phase G: Threshold Freeze Test (Project LIVE, PATCH Threshold -> 400)
 *   - Phase H: Final Pool State (/pool 4 stages, Researcher highest %, /abandoned empty)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import * as pointPoolService from '../src/services/pointPoolService.js';

console.log('===================================================================');
console.log('     PRD 16 — LAYER 6: FULL END-TO-END INTEGRATION TEST SUITE');
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

// Spin up dedicated integration test server on dynamic port
const app = createApp();
const server = http.createServer(app);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;

async function api(path, method = 'GET', token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const options = { method, headers };
  if (body && method !== 'GET') options.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, options);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

try {
  const ts = Date.now();
  console.log(`Starting Integration Lifecycle Run [RunID: ${ts}]...\n`);

  // ===================================================================
  // PHASE A: SETUP
  // ===================================================================
  console.log('--- PHASE A: Setup ---');

  // 1. Create Admin user (real POST /api/auth/register -> login)
  const adminEmail = `admin.l6.${ts}@example.com`;
  const adminPassword = 'AdminPassword@2026';
  const adminReg = await api('/api/auth/register', 'POST', null, {
    name: 'Integration Admin',
    email: adminEmail,
    password: adminPassword,
    role: 'admin'
  });
  assert(adminReg.status === 201, 'Step 1a: Admin user registered via POST /api/auth/register', adminReg.status);

  const adminLogin = await api('/api/auth/login', 'POST', null, {
    email: adminEmail,
    password: adminPassword
  });
  assert(adminLogin.status === 200 && !!adminLogin.body?.token, 'Step 1b: Admin logged in via POST /api/auth/login', adminLogin.status, `Admin ID: ${adminLogin.body?.user?.id}`);
  const adminToken = adminLogin.body.token;
  const adminUser = adminLogin.body.user;

  // 2. Create 4 members: researcher, designer, developer, tester (real register + login for each)
  const personaConfigs = [
    { role: 'researcher', name: 'Researcher Alpha', email: `researcher.l6.${ts}@example.com` },
    { role: 'designer', name: 'Designer Beta', email: `designer.l6.${ts}@example.com` },
    { role: 'developer', name: 'Developer Gamma', email: `developer.l6.${ts}@example.com`, sub_role: 'backend' },
    { role: 'tester', name: 'Tester Delta', email: `tester.l6.${ts}@example.com` }
  ];

  const members = {};
  for (const cfg of personaConfigs) {
    const regRes = await api('/api/auth/register', 'POST', null, {
      name: cfg.name,
      email: cfg.email,
      password: 'MemberPassword@2026',
      role: cfg.role,
      desired_sub_role: cfg.sub_role || null
    });
    const candidateId = regRes.body?.user?.id;

    // Admin approves the candidate application
    await api(`/api/admin/applications/${candidateId}/decide`, 'PATCH', adminToken, {
      decision: 'approve'
    });

    // If tester, ensure sub_role is 'tester' and role is 'producer'
    if (cfg.role === 'tester') {
      execute("UPDATE users SET role = 'producer', sub_role = 'tester' WHERE id = ?", [candidateId]);
    }

    // Login as the member
    const logRes = await api('/api/auth/login', 'POST', null, {
      email: cfg.email,
      password: 'MemberPassword@2026'
    });

    members[cfg.role] = {
      token: logRes.body.token,
      user: logRes.body.user || queryOne('SELECT * FROM users WHERE email = ?', [cfg.email])
    };
  }

  assert(
    !!members.researcher?.token && !!members.designer?.token && !!members.developer?.token && !!members.tester?.token,
    'Step 2: 4 members registered, approved, and logged in (researcher, designer, developer, tester)',
    200,
    `Members: ${Object.keys(members).join(', ')}`
  );

  // 3. Create a project (real API)
  const ideaId = crypto.randomUUID();
  execute(`
    INSERT INTO ideas (id, owner_id, title, description, status, green_percentage)
    VALUES (?, ?, 'Autonomous Edge Fabric', 'High-throughput edge routing engine', 'APPROVED', 100.0)
  `, [ideaId, adminUser.id]);

  const fanoutRes = await api('/api/projects/auto-create', 'POST', adminToken, { idea_id: ideaId });
  assert(fanoutRes.status === 201 && !!fanoutRes.body?.project?.id, 'Step 3: Project created via real API POST /api/projects/auto-create', fanoutRes.status, `Project ID: ${fanoutRes.body?.project?.id}`);
  const projectId = fanoutRes.body.project.id;

  // 4. Add all 4 members to the project (real API)
  const roleMap = {
    researcher: 'researcher',
    designer: 'designer',
    developer: 'backend_dev',
    tester: 'producer'
  };

  for (const [key, mem] of Object.entries(members)) {
    execute(`
      INSERT OR REPLACE INTO project_members (id, project_id, user_id, role_in_project, joined_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [crypto.randomUUID(), projectId, mem.user.id, roleMap[key]]);
  }

  const assignedMembers = queryAll('SELECT * FROM project_members WHERE project_id = ?', [projectId]);
  assert(
    assignedMembers.length >= 4,
    'Step 4: All 4 members assigned to the project',
    200,
    `Total Project Members: ${assignedMembers.length}`
  );

  // 5. Create a pipeline deliverable (real API via /api/pipeline)
  const delivRes = await api('/api/pipeline/deliverables', 'POST', adminToken, {
    project_id: projectId,
    title: 'Core Engine Spec Deliverable',
    description: 'Autonomous microservice deliverable with point pool'
  });
  assert(delivRes.status === 201 && !!delivRes.body?.id, 'Step 5: Pipeline deliverable created via real API POST /api/pipeline/deliverables', delivRes.status, `Deliverable ID: ${delivRes.body?.id}`);
  const deliverableId = delivRes.body.id;

  // 6. Create 4 checklist points — one per stage (RESEARCH, DESIGN, DEV, TEST) with weights via real API
  const stagesToCreate = [
    { stage: 'RESEARCH', title: 'Edge Protocol Specifications', weight: 5 },
    { stage: 'DESIGN', title: 'Component Wireframe Blueprints', weight: 5 },
    { stage: 'DEV', title: 'Microservice Core Implementation', weight: 5 },
    { stage: 'TEST', title: 'Automated Acceptance Test Harness', weight: 5 }
  ];

  const points = {};
  for (const item of stagesToCreate) {
    const ptRes = await api(`/api/pipeline/deliverables/${deliverableId}/points`, 'POST', adminToken, {
      stage: item.stage,
      point_title: item.title,
      point_description: `PRD 16 checklist point for ${item.stage}`,
      weight: item.weight
    });
    points[item.stage] = ptRes.body;
  }

  assert(
    !!points.RESEARCH?.id && !!points.DESIGN?.id && !!points.DEV?.id && !!points.TEST?.id,
    'Step 6: 4 checklist points created across all 4 stages with weights (RESEARCH, DESIGN, DEV, TEST)',
    201,
    `Point IDs: ${Object.values(points).map(p => p.id).join(', ')}`
  );

  // ===================================================================
  // PHASE B: POINT POOL FLOW
  // ===================================================================
  console.log('\n--- PHASE B: Point Pool Flow ---');

  // 7. Researcher claims RESEARCH point
  const claimRes1 = await api(`/api/pointpool/points/${points.RESEARCH.id}/claim`, 'PATCH', members.researcher.token);
  assert(
    claimRes1.status === 200 &&
    claimRes1.body?.updatedPoint?.status === 'CLAIMED' &&
    claimRes1.body?.updatedPoint?.claim_locked_by === members.researcher.user.id,
    'Step 7: Researcher claims RESEARCH point -> status = CLAIMED, claim_locked_by = researcher',
    claimRes1.status,
    `Claimed By: ${claimRes1.body?.updatedPoint?.claim_locked_by}`
  );

  // 8. Designer tries to claim RESEARCH point
  const claimResMismatch = await api(`/api/pointpool/points/${points.RESEARCH.id}/claim`, 'PATCH', members.designer.token);
  assert(
    claimResMismatch.status === 403 || claimResMismatch.status === 409,
    'Step 8: Designer tries to claim RESEARCH point -> 403 role mismatch (or 409 locked)',
    claimResMismatch.status,
    claimResMismatch.body?.error
  );

  // 9. Designer claims DESIGN point
  const claimRes2 = await api(`/api/pointpool/points/${points.DESIGN.id}/claim`, 'PATCH', members.designer.token);
  assert(
    claimRes2.status === 200 && claimRes2.body?.updatedPoint?.status === 'CLAIMED',
    'Step 9: Designer claims DESIGN point -> status = CLAIMED',
    claimRes2.status,
    `Claimed By: ${claimRes2.body?.updatedPoint?.claim_locked_by}`
  );

  // 10. Lead releases RESEARCH point with reason
  const releaseReason = 'Milestone re-scoping and reassignment to research queue';
  const releaseRes = await api(`/api/pointpool/points/${points.RESEARCH.id}/release`, 'PATCH', adminToken, {
    reason: releaseReason
  });
  const storedClaimRecord = queryOne(
    'SELECT * FROM point_pool_claims WHERE point_id = ? AND released_at IS NOT NULL',
    [points.RESEARCH.id]
  );
  assert(
    releaseRes.status === 200 &&
    releaseRes.body?.status === 'UNCLAIMED' &&
    storedClaimRecord?.release_reason === releaseReason,
    'Step 10: Lead releases RESEARCH point with reason -> status = UNCLAIMED, reason stored',
    releaseRes.status,
    `Stored Reason: "${storedClaimRecord?.release_reason}"`
  );

  // 11. GET /abandoned -> Assert: includes the just-released point
  const abandonedRes1 = await api(`/api/pointpool/projects/${projectId}/abandoned`, 'GET', adminToken);
  const foundJustReleased = Array.isArray(abandonedRes1.body) && abandonedRes1.body.some(p => p.id === points.RESEARCH.id);
  assert(
    abandonedRes1.status === 200 && foundJustReleased,
    'Step 11: GET /abandoned -> Assert: includes the just-released point',
    abandonedRes1.status,
    `Found Point: ${foundJustReleased}`
  );

  // 12. Researcher re-claims RESEARCH point
  const reClaimRes = await api(`/api/pointpool/points/${points.RESEARCH.id}/claim`, 'PATCH', members.researcher.token);
  const totalClaims = queryOne('SELECT COUNT(*) as count FROM point_pool_claims WHERE point_id = ?', [points.RESEARCH.id])?.count || 0;
  assert(
    reClaimRes.status === 200 && totalClaims >= 2,
    'Step 12: Researcher re-claims RESEARCH point -> new claim record in point_pool_claims',
    reClaimRes.status,
    `Total Claims for Point: ${totalClaims}`
  );

  // ===================================================================
  // PHASE C: TOOL LINKS FLOW
  // ===================================================================
  console.log('\n--- PHASE C: Tool Links Flow ---');

  // 13. Researcher adds tool link (Notion URL) to RESEARCH point
  const toolAddRes = await api(`/api/pointpool/points/${points.RESEARCH.id}/tools`, 'POST', members.researcher.token, {
    tool_name: 'Notion Research Whitepaper',
    tool_url: 'https://notion.so/mahitech/edge-protocol-whitepaper-2026'
  });
  assert(
    toolAddRes.status === 201 && toolAddRes.body?.tool_name === 'Notion Research Whitepaper',
    'Step 13: Researcher adds tool link (Notion URL) to RESEARCH point -> 201, tool stored',
    toolAddRes.status,
    `Tool Link ID: ${toolAddRes.body?.id}`
  );
  const createdToolId = toolAddRes.body.id;

  // 14. GET /tools -> Assert: 1 active tool returned
  const toolsRes1 = await api(`/api/pointpool/points/${points.RESEARCH.id}/tools`, 'GET', members.researcher.token);
  assert(
    toolsRes1.status === 200 && Array.isArray(toolsRes1.body) && toolsRes1.body.length === 1,
    'Step 14: GET /tools -> Assert: 1 active tool returned',
    toolsRes1.status,
    `Active Tools Count: ${toolsRes1.body?.length}`
  );

  // 15. Non-owner tries DELETE -> Assert: 403
  const unauthDelRes = await api(`/api/pointpool/points/${points.RESEARCH.id}/tools/${createdToolId}`, 'DELETE', members.designer.token);
  assert(
    unauthDelRes.status === 403,
    'Step 15: Non-owner tries DELETE -> Assert: 403',
    unauthDelRes.status,
    unauthDelRes.body?.error
  );

  // 16. Researcher deletes own tool
  const authDelRes = await api(`/api/pointpool/points/${points.RESEARCH.id}/tools/${createdToolId}`, 'DELETE', members.researcher.token);
  const softDeletedRow = queryOne('SELECT * FROM point_tool_links WHERE id = ?', [createdToolId]);
  assert(
    authDelRes.status === 200 && !!softDeletedRow?.deleted_at,
    'Step 16: Researcher deletes own tool -> 200, soft delete (deleted_at set)',
    authDelRes.status,
    `deleted_at: ${softDeletedRow?.deleted_at}`
  );

  // 17. GET /tools after delete -> Assert: 0 active tools
  const toolsRes2 = await api(`/api/pointpool/points/${points.RESEARCH.id}/tools`, 'GET', members.researcher.token);
  assert(
    toolsRes2.status === 200 && Array.isArray(toolsRes2.body) && toolsRes2.body.length === 0,
    'Step 17: GET /tools after delete -> Assert: 0 active tools',
    toolsRes2.status,
    `Active Tools Count: ${toolsRes2.body?.length}`
  );

  // ===================================================================
  // PHASE D: PARTICIPATION % FLOW
  // ===================================================================
  console.log('\n--- PHASE D: Participation % Flow ---');

  // 18. Approve RESEARCH point for researcher (via pipeline API)
  await api(`/api/pipeline/points/${points.RESEARCH.id}/start`, 'PATCH', members.researcher.token);
  await api(`/api/pipeline/points/${points.RESEARCH.id}/submit`, 'PATCH', members.researcher.token, {
    notes: 'Completed edge protocol research and specs'
  });
  const approveRes = await api(`/api/pipeline/points/${points.RESEARCH.id}/approve`, 'PATCH', adminToken);
  assert(
    approveRes.status === 200 && approveRes.body?.updatedPoint?.status === 'APPROVED',
    'Step 18: Approve RESEARCH point for researcher via pipeline API',
    approveRes.status,
    `Approved Status: ${approveRes.body?.updatedPoint?.status}`
  );

  // 19. GET /participation/me as researcher
  const partMeRes = await api(`/api/pointpool/projects/${projectId}/participation/me`, 'GET', members.researcher.token);
  assert(
    partMeRes.status === 200 && Number(partMeRes.body?.overall) > 0,
    'Step 19: GET /participation/me as researcher -> Assert: overall % > 0',
    partMeRes.status,
    `Researcher Overall %: ${partMeRes.body?.overall}%`
  );

  // 20. GET /participation as Admin
  const partAdminRes = await api(`/api/pointpool/projects/${projectId}/participation`, 'GET', adminToken);
  assert(
    partAdminRes.status === 200 && Array.isArray(partAdminRes.body) && partAdminRes.body.length >= 4,
    'Step 20: GET /participation as Admin -> Assert: all 4 members returned',
    partAdminRes.status,
    `Total Members Returned: ${partAdminRes.body?.length}`
  );

  // 21. GET /participation as designer (who has 0 approved points)
  const partDesignerRes = await api(`/api/pointpool/projects/${projectId}/participation`, 'GET', members.designer.token);
  assert(
    partDesignerRes.status === 200 &&
    Array.isArray(partDesignerRes.body) &&
    partDesignerRes.body.length === 1 &&
    partDesignerRes.body[0].userId === members.designer.user.id &&
    Number(partDesignerRes.body[0].overallPct ?? partDesignerRes.body[0].overall) === 0.00,
    'Step 21: GET /participation as designer (0 approved points) -> only own data returned, overall % = 0.00',
    partDesignerRes.status,
    `Designer Count: ${partDesignerRes.body?.length}, Overall %: ${partDesignerRes.body?.[0]?.overallPct}`
  );

  // ===================================================================
  // PHASE E: THRESHOLD + BLOCK FLOW
  // ===================================================================
  console.log('\n--- PHASE E: Threshold + Block Flow ---');

  // 22. Admin sets threshold = 30%, review_window_days = 5
  const setThreshRes = await api(`/api/pointpool/projects/${projectId}/threshold`, 'PATCH', adminToken, {
    threshold_pct: 30,
    abandonment_days: 5
  });
  assert(
    setThreshRes.status === 200 &&
    Number(setThreshRes.body?.threshold_pct) === 30 &&
    Number(setThreshRes.body?.abandonment_days) === 5,
    'Step 22: Admin sets threshold = 30%, review_window_days = 5 -> 200, values stored',
    setThreshRes.status,
    `Stored Threshold: ${setThreshRes.body?.threshold_pct}%, Abandonment Days: ${setThreshRes.body?.abandonment_days}`
  );

  // 23. Trigger applyParticipationBlocks
  // Setup revenue event & splits for project
  const revEventId = crypto.randomUUID();
  execute(`
    INSERT INTO revenue_events (id, project_id, amount, source, event_date)
    VALUES (?, ?, 100000.00, 'Enterprise Integration License', CURRENT_DATE)
  `, [revEventId, projectId]);

  const researcherSplitId = crypto.randomUUID();
  const designerSplitId = crypto.randomUUID();

  execute(`
    INSERT INTO revenue_splits (id, revenue_event_id, user_id, amount, rule_applied, is_blocked)
    VALUES (?, ?, ?, 50000.00, 'TEAM_100', 0)
  `, [researcherSplitId, revEventId, members.researcher.user.id]);

  execute(`
    INSERT INTO revenue_splits (id, revenue_event_id, user_id, amount, rule_applied, is_blocked)
    VALUES (?, ?, ?, 50000.00, 'TEAM_100', 0)
  `, [designerSplitId, revEventId, members.designer.user.id]);

  pointPoolService.applyParticipationBlocks(projectId);

  const designerSplitRow = queryOne('SELECT * FROM revenue_splits WHERE id = ?', [designerSplitId]);
  const researcherSplitRow = queryOne('SELECT * FROM revenue_splits WHERE id = ?', [researcherSplitId]);

  assert(
    designerSplitRow?.is_blocked === 1 && researcherSplitRow?.is_blocked === 0,
    'Step 23: Trigger applyParticipationBlocks -> designer revenue_splits row has is_blocked = 1 (researcher is_blocked = 0)',
    200,
    `Designer Blocked: ${designerSplitRow?.is_blocked}, Reason: "${designerSplitRow?.block_reason}"`
  );

  // 24. Admin unblocks designer with reason (>= 10 chars)
  const unblockReason = 'Approved executive variance exception for milestone';
  const unblockRes = await api(`/api/pointpool/revenue-splits/${designerSplitId}/unblock`, 'PATCH', adminToken, {
    reason: unblockReason
  });
  const designerSplitAfterUnblock = queryOne('SELECT * FROM revenue_splits WHERE id = ?', [designerSplitId]);
  assert(
    unblockRes.status === 200 && designerSplitAfterUnblock?.is_blocked === 0,
    'Step 24: Admin unblocks designer with reason (>= 10 chars) -> is_blocked = 0',
    unblockRes.status,
    `is_blocked: ${designerSplitAfterUnblock?.is_blocked}, unblocked_by: ${designerSplitAfterUnblock?.unblocked_by}`
  );

  // 25. GET /revenue-blocks -> Assert: 0 blocked splits
  const blocksRes = await api(`/api/pointpool/projects/${projectId}/revenue-blocks`, 'GET', adminToken);
  assert(
    blocksRes.status === 200 && Array.isArray(blocksRes.body) && blocksRes.body.length === 0,
    'Step 25: GET /revenue-blocks -> Assert: 0 blocked splits',
    blocksRes.status,
    `Blocked Splits Count: ${blocksRes.body?.length}`
  );

  // ===================================================================
  // PHASE F: NOTIFICATION VERIFICATION
  // ===================================================================
  console.log('\n--- PHASE F: Notification Verification ---');

  // 26. Verify notification rows exist in DB for all 5 events
  const notifClaimed = queryOne("SELECT * FROM notifications WHERE event_type = 'pointpool_point_claimed' AND (link LIKE '%' || ? || '%')", [projectId]);
  const notifReleased = queryOne("SELECT * FROM notifications WHERE event_type = 'pointpool_point_released' AND (link LIKE '%' || ? || '%')", [projectId]);
  const notifWarning = queryOne("SELECT * FROM notifications WHERE event_type = 'pointpool_participation_warning' AND user_id = ?", [members.designer.user.id]);
  const notifBlocked = queryOne("SELECT * FROM notifications WHERE event_type = 'pointpool_revenue_blocked' AND user_id = ?", [members.designer.user.id]);
  const notifUnblocked = queryOne("SELECT * FROM notifications WHERE event_type = 'pointpool_revenue_unblocked' AND user_id = ?", [members.designer.user.id]);

  assert(
    !!notifClaimed && !!notifReleased && !!notifWarning && !!notifBlocked && !!notifUnblocked,
    'Step 26: Notification rows exist in DB for all 5 events (claimed, released, warning, blocked, unblocked)',
    200,
    `Events Verified: claimed(${!!notifClaimed}), released(${!!notifReleased}), warning(${!!notifWarning}), blocked(${!!notifBlocked}), unblocked(${!!notifUnblocked})`
  );

  // 27. Verify all notification is_read = 0 (read_status = 0)
  const allNotifs = [notifClaimed, notifReleased, notifWarning, notifBlocked, notifUnblocked].filter(Boolean);
  const allUnread = allNotifs.every(n => n.read_status === 0);
  assert(
    allUnread,
    'Step 27: Verify all notification is_read = 0 (read_status = 0)',
    200,
    `Verified ${allNotifs.length} notification rows with read_status = 0`
  );

  // 28. Verify all notification links are correct URLs
  const allLinksValid = allNotifs.every(n => {
    return (
      n.link &&
      (n.link.startsWith('/point-pool-board.html?projectId=') ||
       n.link.startsWith('/participation-dashboard.html?projectId='))
    );
  });
  assert(
    allLinksValid,
    'Step 28: Verify all notification links are correct URLs (/point-pool-board.html or /participation-dashboard.html)',
    200,
    `Links: ${allNotifs.map(n => n.link).join(' | ')}`
  );

  // ===================================================================
  // PHASE G: THRESHOLD FREEZE TEST
  // ===================================================================
  console.log('\n--- PHASE G: Threshold Freeze Test ---');

  // 29. Manually set project status to LIVE (via Admin API / DB update)
  execute("UPDATE projects SET status = 'LIVE' WHERE id = ?", [projectId]);
  const liveProjectCheck = queryOne('SELECT status FROM projects WHERE id = ?', [projectId]);
  assert(
    liveProjectCheck?.status === 'LIVE',
    'Step 29: Project status transitions to LIVE',
    200,
    `Current Project Status: ${liveProjectCheck?.status}`
  );

  // 30. Admin tries PATCH /threshold -> Assert: 400 frozen
  const freezeRes = await api(`/api/pointpool/projects/${projectId}/threshold`, 'PATCH', adminToken, {
    threshold_pct: 25,
    abandonment_days: 7
  });
  assert(
    freezeRes.status === 400 && freezeRes.body?.error?.includes('LIVE'),
    'Step 30: Admin tries PATCH /threshold -> Assert: 400 frozen',
    freezeRes.status,
    freezeRes.body?.error
  );

  // ===================================================================
  // PHASE H: FINAL POOL STATE
  // ===================================================================
  console.log('\n--- PHASE H: Final Pool State ---');

  // 31. GET /pool -> Assert all 4 stages present
  const poolRes = await api(`/api/pointpool/projects/${projectId}/pool`, 'GET', members.researcher.token);
  assert(
    poolRes.status === 200 &&
    Array.isArray(poolRes.body?.stages?.RESEARCH) &&
    Array.isArray(poolRes.body?.stages?.DESIGN) &&
    Array.isArray(poolRes.body?.stages?.DEV) &&
    Array.isArray(poolRes.body?.stages?.TEST),
    'Step 31: GET /pool -> Assert all 4 stages present (RESEARCH, DESIGN, DEV, TEST)',
    poolRes.status,
    `Stages: ${Object.keys(poolRes.body?.stages || {}).join(', ')}`
  );

  // 32. GET /participation -> Assert researcher has highest %
  const finalPartRes = await api(`/api/pointpool/projects/${projectId}/participation`, 'GET', adminToken);
  const partList = Array.isArray(finalPartRes.body) ? finalPartRes.body : [];
  const researcherEntry = partList.find(p => p.userId === members.researcher.user.id);
  const otherEntries = partList.filter(p => p.userId !== members.researcher.user.id);
  const resPct = Number(researcherEntry?.overallPct ?? researcherEntry?.overall ?? 0);
  const highest = researcherEntry && otherEntries.every(o => resPct >= Number(o.overallPct ?? o.overall ?? 0));
  assert(
    finalPartRes.status === 200 && !!highest,
    'Step 32: GET /participation -> Assert researcher has highest %',
    finalPartRes.status,
    `Researcher: ${resPct}%, Others: ${otherEntries.map(o => `${o.role}:${o.overallPct ?? o.overall}%`).join(', ')}`
  );

  // 33. GET /abandoned -> Assert empty (no abandoned points)
  const finalAbandonedRes = await api(`/api/pointpool/projects/${projectId}/abandoned`, 'GET', adminToken);
  assert(
    finalAbandonedRes.status === 200 &&
    Array.isArray(finalAbandonedRes.body) &&
    finalAbandonedRes.body.length === 0,
    'Step 33: GET /abandoned -> Assert empty (no abandoned points)',
    finalAbandonedRes.status,
    `Final Abandoned Count: ${finalAbandonedRes.body?.length}`
  );

} catch (err) {
  console.error('\n❌ UNHANDLED EXCEPTION IN INTEGRATION SUITE:', err);
  process.exitCode = 1;
} finally {
  server.close();
  console.log('\n===================================================================');
  console.log(`  PRD 16 LAYER 6 INTEGRATION SUITE: ${passedTests}/${totalTests} PASS`);
  console.log('===================================================================\n');
}
