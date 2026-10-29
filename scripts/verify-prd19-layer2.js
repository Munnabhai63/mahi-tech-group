/**
 * PRD 19 — Layer 2 Verification Suite: Objective Service & API Endpoints
 * 
 * Verifies with real HTTP network calls:
 * 1. Admin creates Company Objective (level: COMPANY) -> HTTP 201
 * 2. Admin creates Team Objective linked to parent -> HTTP 201 + auto alignment link
 * 3. Member blocked from creating COMPANY/TEAM objective -> HTTP 403 (RBAC)
 * 4. Member creates own INDIVIDUAL objective -> HTTP 201
 * 5. Input validation (missing title, invalid level, invalid parent) -> HTTP 400/404
 * 6. GET /api/okr/objectives (Rule 8: member sees Company/Team + own Individual only) -> HTTP 200
 * 7. GET /api/okr/objective/:id (Detail view + children + alignment links) -> HTTP 200
 * 8. Member blocked from viewing another member's Individual objective -> HTTP 403
 * 9. PATCH /api/okr/objective/:id (Field updates + auto-log to okr_history) -> HTTP 200
 * 10. Member blocked from editing Company/Team objective -> HTTP 403
 * 11. Member updates own Individual objective -> HTTP 200
 * 12. POST /api/okr/alignment/link (Admin creates explicit link) -> HTTP 201
 * 13. Alignment self-link blocked -> HTTP 400
 * 14. GET /api/okr/objective/:id/tree (Parent chain + recursive children) -> HTTP 200
 * 15. GET /api/okr/alignment (Company-wide alignment tree) -> HTTP 200 (Admin) / 403 (Member)
 * 16. GET /api/okr/cycle/:cycle -> HTTP 200
 * 17. GET /api/okr/member/:userId (Own vs other member RBAC) -> HTTP 200 / 403
 * 18. GET /api/okr/history/:entityType/:entityId -> HTTP 200 (Admin audit trail)
 * 19. PATCH /api/okr/objective/:id/archive (Status to ARCHIVED, frozen) -> HTTP 200
 * 20. Rule 7: Cannot update archived objective -> HTTP 400
 * 21. DELETE /api/okr/objective/:id (Only DRAFT status deletable) -> HTTP 200 / 400
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('       PRD 19 — LAYER 2: OBJECTIVE SERVICE & API TEST SUITE');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${testName}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

function createAuthToken(user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sessionId, userId: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '24h' }
  );
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  execute(`
    INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
    VALUES (?, ?, ?, 'Test Harness PRD19', '127.0.0.1', datetime('now'), ?, 0)
  `, [sessionId, user.id, token, expiresAt]);

  return token;
}

async function request(baseUrl, method, path, token, body = null) {
  const url = `${baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const status = res.status;
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }
  return { status, data };
}

async function run() {
  const db = getDatabase();

  // 1. Setup isolated test users & project
  console.log('--- 1. SETTING UP TEST USERS & PROJECT ---');
  const ts = Date.now();

  // Admin user
  let adminUser = queryOne("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1;");
  if (!adminUser) {
    const adminId = `admin-okr-${ts}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at)
      VALUES (?, 'Admin OKR Tester', 'admin.okr.${ts}@mahi.com', 'hash', 'admin', 'active', datetime('now'))
    `, [adminId]);
    adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
  }

  // Member 1 (Developer)
  const member1Id = `member1-okr-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Developer Alice', 'alice.${ts}@mahi.com', 'hash', 'developer', 'active', datetime('now'))
  `, [member1Id]);
  const member1 = queryOne('SELECT * FROM users WHERE id = ?', [member1Id]);

  // Member 2 (Designer)
  const member2Id = `member2-okr-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Designer Bob', 'bob.${ts}@mahi.com', 'hash', 'designer', 'active', datetime('now'))
  `, [member2Id]);
  const member2 = queryOne('SELECT * FROM users WHERE id = ?', [member2Id]);

  let project = queryOne("SELECT * FROM projects LIMIT 1;");
  if (!project) {
    const projId = `proj-okr-${ts}`;
    execute(`
      INSERT INTO projects (id, title, description, owner_id)
      VALUES (?, 'OKR Core Project', 'Desc', ?)
    `, [projId, adminUser.id]);
    project = queryOne('SELECT * FROM projects WHERE id = ?', [projId]);
  }

  const adminToken = createAuthToken(adminUser);
  const member1Token = createAuthToken(member1);
  const member2Token = createAuthToken(member2);

  console.log(`  Admin User: ${adminUser.name} (${adminUser.id})`);
  console.log(`  Member 1 User: ${member1.name} (${member1.id})`);
  console.log(`  Member 2 User: ${member2.name} (${member2.id})`);
  console.log(`  Project: ${project.title} (${project.id})`);

  // Start HTTP server on dynamic port
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test Server running on ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------
    // 2. Admin creates Company Objective
    // -------------------------------------------------------------------
    console.log('--- 2. OBJECTIVE CREATION & RBAC ---');
    const companyRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Company Objective: Expand to Global Markets',
      description: 'Acquire international enterprises in Q1',
      level: 'COMPANY',
      cycle: 'Q1-2026',
      project_id: project.id
    });

    assert(
      companyRes.status === 201 && companyRes.data.id && companyRes.data.level === 'COMPANY',
      'Admin creates COMPANY Objective',
      `ID: ${companyRes.data?.id}, Status: ${companyRes.data?.status}, Level: ${companyRes.data?.level}`
    );
    const companyObjId = companyRes.data.id;

    // Verify okr_history recorded creation
    const creationHist = queryOne("SELECT * FROM okr_history WHERE entity_type = 'OBJECTIVE' AND entity_id = ? AND field_changed = 'created'", [companyObjId]);
    assert(
      !!creationHist,
      'History auto-logs creation in okr_history',
      creationHist ? `History ID: ${creationHist.id}, field: ${creationHist.field_changed}` : 'No history record'
    );

    // -------------------------------------------------------------------
    // 3. Admin creates Team Objective linked to parent
    // -------------------------------------------------------------------
    const teamRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Team Objective: Ship Global Localization Engine',
      description: 'Support multi-region currency and languages',
      level: 'TEAM',
      cycle: 'Q1-2026',
      parent_objective_id: companyObjId,
      project_id: project.id
    });

    assert(
      teamRes.status === 201 && teamRes.data.parent_objective_id === companyObjId,
      'Admin creates TEAM Objective with parent_objective_id',
      `ID: ${teamRes.data?.id}, Parent ID: ${teamRes.data?.parent_objective_id}`
    );
    const teamObjId = teamRes.data.id;

    // Verify alignment link was created automatically
    const autoLink = queryOne(
      'SELECT * FROM okr_alignment_links WHERE child_objective_id = ? AND parent_objective_id = ?',
      [teamObjId, companyObjId]
    );
    assert(
      !!autoLink,
      'Alignment link auto-inserted in okr_alignment_links',
      autoLink ? `Link ID: ${autoLink.id}, child: ${autoLink.child_objective_id}, parent: ${autoLink.parent_objective_id}` : 'Link missing'
    );

    // -------------------------------------------------------------------
    // 4. RBAC: Member blocked from creating COMPANY/TEAM objective
    // -------------------------------------------------------------------
    const memberBlockedRes = await request(baseUrl, 'POST', '/api/okr/objective/create', member1Token, {
      title: 'Member Attempting Company Goal',
      level: 'COMPANY',
      cycle: 'Q1-2026'
    });

    assert(
      memberBlockedRes.status === 403,
      'Member blocked from creating COMPANY objective (HTTP 403)',
      `Error received: "${memberBlockedRes.data?.error}"`
    );

    // -------------------------------------------------------------------
    // 5. Member creates own INDIVIDUAL objective
    // -------------------------------------------------------------------
    const memberObjRes = await request(baseUrl, 'POST', '/api/okr/objective/create', member1Token, {
      title: 'Individual Objective: Master Core Architecture',
      description: 'Level up systems knowledge',
      level: 'INDIVIDUAL',
      cycle: 'Q1-2026',
      parent_objective_id: teamObjId
    });

    assert(
      memberObjRes.status === 201 && memberObjRes.data.owner_id === member1.id,
      'Member creates own INDIVIDUAL objective (HTTP 201)',
      `ID: ${memberObjRes.data?.id}, Owner: ${memberObjRes.data?.owner_id}`
    );
    const member1ObjId = memberObjRes.data.id;

    // Member 2 creates own individual objective
    const member2ObjRes = await request(baseUrl, 'POST', '/api/okr/objective/create', member2Token, {
      title: 'Individual Objective: Complete UI Design Systems',
      level: 'INDIVIDUAL',
      cycle: 'Q1-2026'
    });
    const member2ObjId = member2ObjRes.data.id;

    // -------------------------------------------------------------------
    // 6. Validation Checks (Missing title, invalid level, invalid parent)
    // -------------------------------------------------------------------
    console.log('\n--- 3. INPUT VALIDATION TESTS ---');
    const noTitleRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: '',
      level: 'COMPANY'
    });
    assert(noTitleRes.status === 400, 'Validation: Empty title rejected (HTTP 400)', noTitleRes.data?.error);

    const badLevelRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Valid Title',
      level: 'INVALID_LEVEL'
    });
    assert(badLevelRes.status === 400, 'Validation: Invalid level rejected (HTTP 400)', badLevelRes.data?.error);

    const badParentRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Valid Title',
      level: 'TEAM',
      parent_objective_id: 999999
    });
    assert(badParentRes.status === 404, 'Validation: Non-existent parent rejected (HTTP 404)', badParentRes.data?.error);

    // -------------------------------------------------------------------
    // 7. GET /api/okr/objectives with Rule 8 visibility enforcement
    // -------------------------------------------------------------------
    console.log('\n--- 4. LIST OBJECTIVES & PRIVACY FILTERING (Rule 8) ---');
    const adminListRes = await request(baseUrl, 'GET', '/api/okr/objectives?cycle=Q1-2026', adminToken);
    assert(
      adminListRes.status === 200 && Array.isArray(adminListRes.data) && adminListRes.data.length >= 4,
      'Admin sees all objectives across all levels',
      `Count: ${adminListRes.data?.length} objectives`
    );

    // Member 1 listing: should see Company, Team, and Member 1's Individual objective, but NOT Member 2's Individual objective
    const member1ListRes = await request(baseUrl, 'GET', '/api/okr/objectives?cycle=Q1-2026', member1Token);
    const member1Items = member1ListRes.data || [];
    const hasCompany = member1Items.some(o => o.id === companyObjId);
    const hasTeam = member1Items.some(o => o.id === teamObjId);
    const hasOwnIndividual = member1Items.some(o => o.id === member1ObjId);
    const hasOtherIndividual = member1Items.some(o => o.id === member2ObjId);

    assert(
      member1ListRes.status === 200 && hasCompany && hasTeam && hasOwnIndividual && !hasOtherIndividual,
      'Rule 8: Member sees Company + Team + Own Individual (Other members hidden)',
      `Found Company: ${hasCompany}, Team: ${hasTeam}, Own: ${hasOwnIndividual}, Other hidden: ${!hasOtherIndividual}`
    );

    // -------------------------------------------------------------------
    // 8. GET /api/okr/objective/:id (Detail & Privacy)
    // -------------------------------------------------------------------
    console.log('\n--- 5. DETAIL VIEW & ACCESS CONTROL ---');
    const detailRes = await request(baseUrl, 'GET', `/api/okr/objective/${companyObjId}`, adminToken);
    assert(
      detailRes.status === 200 && detailRes.data.id === companyObjId && Array.isArray(detailRes.data.key_results),
      'GET /api/okr/objective/:id returns full objective detail with child/KR arrays',
      `Children: ${detailRes.data.child_objectives?.length}, Alignment Links: ${detailRes.data.alignment_links?.length}`
    );

    // Member 1 attempts to view Member 2's Individual objective -> HTTP 403
    const forbiddenViewRes = await request(baseUrl, 'GET', `/api/okr/objective/${member2ObjId}`, member1Token);
    assert(
      forbiddenViewRes.status === 403,
      'Member forbidden from viewing another member individual objective (HTTP 403)',
      `Error: "${forbiddenViewRes.data?.error}"`
    );

    // -------------------------------------------------------------------
    // 9. PATCH /api/okr/objective/:id & Audit Logging
    // -------------------------------------------------------------------
    console.log('\n--- 6. OBJECTIVE UPDATES & AUDIT HISTORY ---');
    const updateRes = await request(baseUrl, 'PATCH', `/api/okr/objective/${companyObjId}`, adminToken, {
      title: 'Company Objective: Scale Global Enterprise Footprint',
      description: 'Updated description for enterprise outreach'
    });

    assert(
      updateRes.status === 200 && updateRes.data.title === 'Company Objective: Scale Global Enterprise Footprint',
      'Admin updates objective title & description (HTTP 200)',
      `Updated Title: "${updateRes.data?.title}"`
    );

    // Verify okr_history has logged the title and description change
    const titleHist = queryOne(
      "SELECT * FROM okr_history WHERE entity_type = 'OBJECTIVE' AND entity_id = ? AND field_changed = 'title' ORDER BY id DESC LIMIT 1;",
      [companyObjId]
    );
    assert(
      !!titleHist && titleHist.new_value === 'Company Objective: Scale Global Enterprise Footprint',
      'Rule 10: Auto-logged field change to okr_history',
      `Field: ${titleHist?.field_changed}, Old: "${titleHist?.old_value}", New: "${titleHist?.new_value}"`
    );

    // Member blocked from updating Team objective
    const memberUpdateBlockedRes = await request(baseUrl, 'PATCH', `/api/okr/objective/${teamObjId}`, member1Token, {
      title: 'Hacked Title'
    });
    assert(
      memberUpdateBlockedRes.status === 403,
      'Member blocked from updating Team/Company objective (HTTP 403)',
      `Error: "${memberUpdateBlockedRes.data?.error}"`
    );

    // Member updates own Individual objective
    const memberUpdateOwnRes = await request(baseUrl, 'PATCH', `/api/okr/objective/${member1ObjId}`, member1Token, {
      title: 'Individual Objective: Master Core Architecture & Microservices'
    });
    assert(
      memberUpdateOwnRes.status === 200 && memberUpdateOwnRes.data.title.includes('Microservices'),
      'Member successfully updates own Individual objective (HTTP 200)',
      `Title: "${memberUpdateOwnRes.data?.title}"`
    );

    // -------------------------------------------------------------------
    // 10. POST /api/okr/alignment/link & Hierarchy Trees
    // -------------------------------------------------------------------
    console.log('\n--- 7. ALIGNMENT LINKS & HIERARCHY TREES ---');
    // Link member2's objective to team objective
    const explicitLinkRes = await request(baseUrl, 'POST', '/api/okr/alignment/link', adminToken, {
      child_objective_id: member2ObjId,
      parent_objective_id: teamObjId
    });

    assert(
      explicitLinkRes.status === 201 && explicitLinkRes.data.child_objective_id === member2ObjId,
      'Admin creates explicit Alignment Link (HTTP 201)',
      `Link ID: ${explicitLinkRes.data?.id}, child: ${explicitLinkRes.data?.child_objective_id}, parent: ${explicitLinkRes.data?.parent_objective_id}`
    );

    // Self-linking blocked
    const selfLinkRes = await request(baseUrl, 'POST', '/api/okr/alignment/link', adminToken, {
      child_objective_id: teamObjId,
      parent_objective_id: teamObjId
    });
    assert(selfLinkRes.status === 400, 'Alignment self-linking rejected (HTTP 400)', selfLinkRes.data?.error);

    // Member blocked from creating alignment links
    const memberLinkBlockedRes = await request(baseUrl, 'POST', '/api/okr/alignment/link', member1Token, {
      child_objective_id: member1ObjId,
      parent_objective_id: companyObjId
    });
    assert(memberLinkBlockedRes.status === 403, 'Member blocked from creating alignment links (HTTP 403)');

    // GET /api/okr/objective/:id/tree
    const treeRes = await request(baseUrl, 'GET', `/api/okr/objective/${member1ObjId}/tree`, adminToken);
    assert(
      treeRes.status === 200 && Array.isArray(treeRes.data.parent_chain) && treeRes.data.parent_chain.length === 2,
      'GET /api/okr/objective/:id/tree returns full ancestor chain (Company -> Team)',
      `Chain: ${treeRes.data.parent_chain?.map(p => `${p.level} (#${p.id})`).join(' -> ')}`
    );

    // GET /api/okr/alignment (Company-wide tree)
    const companyTreeRes = await request(baseUrl, 'GET', '/api/okr/alignment?cycle=Q1-2026', adminToken);
    assert(
      companyTreeRes.status === 200 && Array.isArray(companyTreeRes.data.root_objectives) && companyTreeRes.data.root_objectives.length >= 1,
      'GET /api/okr/alignment returns full company-wide alignment tree',
      `Root Objectives: ${companyTreeRes.data.root_objectives?.length}, Total: ${companyTreeRes.data.total_objectives}`
    );

    const memberTreeForbiddenRes = await request(baseUrl, 'GET', '/api/okr/alignment', member1Token);
    assert(memberTreeForbiddenRes.status === 403, 'Member forbidden from viewing company-wide alignment tree (HTTP 403)');

    // -------------------------------------------------------------------
    // 11. Cycle, Member, and History Endpoints
    // -------------------------------------------------------------------
    console.log('\n--- 8. CYCLE, MEMBER & AUDIT HISTORY ENDPOINTS ---');
    const cycleRes = await request(baseUrl, 'GET', '/api/okr/cycle/Q1-2026', adminToken);
    assert(cycleRes.status === 200 && cycleRes.data.length >= 4, 'GET /api/okr/cycle/:cycle returns cycle objectives');

    const memberOkrRes = await request(baseUrl, 'GET', `/api/okr/member/${member1.id}`, member1Token);
    assert(memberOkrRes.status === 200 && memberOkrRes.data.length >= 1, 'GET /api/okr/member/:userId returns member individual OKRs');

    const memberForbiddenMemberOkrRes = await request(baseUrl, 'GET', `/api/okr/member/${member2.id}`, member1Token);
    assert(memberForbiddenMemberOkrRes.status === 403, 'Member forbidden from querying another member individual OKRs (HTTP 403)');

    const histListRes = await request(baseUrl, 'GET', `/api/okr/history/OBJECTIVE/${companyObjId}`, adminToken);
    assert(
      histListRes.status === 200 && Array.isArray(histListRes.data) && histListRes.data.length >= 2,
      'GET /api/okr/history/:entityType/:entityId returns chronological audit trail',
      `Audit Records: ${histListRes.data?.length}`
    );

    // -------------------------------------------------------------------
    // 12. Archive & Delete Workflow
    // -------------------------------------------------------------------
    console.log('\n--- 9. ARCHIVE & DELETE GOVERNANCE ---');
    // Create a DRAFT objective to test deletion
    const draftRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Temporary Draft Objective',
      level: 'COMPANY',
      status: 'DRAFT'
    });
    const draftId = draftRes.data.id;

    // Delete DRAFT objective
    const deleteDraftRes = await request(baseUrl, 'DELETE', `/api/okr/objective/${draftId}`, adminToken);
    assert(deleteDraftRes.status === 200 && deleteDraftRes.data.success, 'Admin deletes DRAFT objective (HTTP 200)');

    // Attempt to delete ACTIVE objective -> HTTP 400
    const deleteActiveRes = await request(baseUrl, 'DELETE', `/api/okr/objective/${companyObjId}`, adminToken);
    assert(
      deleteActiveRes.status === 400,
      'Active objective cannot be deleted (HTTP 400 - must archive instead)',
      deleteActiveRes.data?.error
    );

    // Archive objective
    const archiveRes = await request(baseUrl, 'PATCH', `/api/okr/objective/${companyObjId}/archive`, adminToken);
    assert(
      archiveRes.status === 200 && archiveRes.data.status === 'ARCHIVED',
      'Admin archives objective (status → ARCHIVED)',
      `Status: ${archiveRes.data?.status}`
    );

    // Rule 7: Attempt to update archived objective -> HTTP 400
    const updateArchivedRes = await request(baseUrl, 'PATCH', `/api/okr/objective/${companyObjId}`, adminToken, {
      title: 'Should Be Rejected'
    });
    assert(
      updateArchivedRes.status === 400,
      'Rule 7: Archived objective is read-only (HTTP 400)',
      updateArchivedRes.data?.error
    );

  } finally {
    server.close();
  }

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  console.log('\n===================================================================');
  console.log(`  VERIFICATION RESULT: ${passedTests}/${totalTests} TESTS PASSED`);
  if (failedTests === 0) {
    console.log('  🎉 LAYER 2 INTEGRITY VERIFIED: Objective Service & API 100% operational');
  } else {
    console.error(`  ⚠️ FAILURES DETECTED: ${failedTests} test(s) failed`);
    process.exit(1);
  }
  console.log('===================================================================\n');
}

run().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
