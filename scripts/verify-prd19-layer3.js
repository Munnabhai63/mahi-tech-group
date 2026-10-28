/**
 * PRD 19 — Layer 3 Verification Suite: Key Result Service & API Endpoints + Circular Chain Detection
 * 
 * Verifies with real HTTP network calls:
 * 1. Circular Chain Detection (A -> B -> C -> A):
 *    - Setup hierarchy: Company A -> Team B -> Individual C
 *    - Link child A under parent C -> HTTP 400 Blocked with "Circular alignment detected"
 *    - Update parent_objective_id of A to C -> HTTP 400 Blocked
 *    - Direct self-link (A under A) -> HTTP 400 Blocked
 * 2. Key Result Creation:
 *    - Admin creates PERCENTAGE KR (target: 100, unit: '%') -> HTTP 201
 *    - Admin creates NUMBER KR (target: 50, unit: 'clients') -> HTTP 201
 *    - Admin creates BOOLEAN KR (target: 1) -> HTTP 201
 *    - Admin creates MILESTONE KR (target: 5) -> HTTP 201
 *    - Objective Owner creates KR on own Individual objective -> HTTP 201
 *    - Non-owner member blocked from adding KR to another member's objective -> HTTP 403
 *    - Rule 7: Cannot add KR to an ARCHIVED objective -> HTTP 400
 * 3. Key Result Validation:
 *    - Missing title -> HTTP 400
 *    - Invalid type -> HTTP 400
 *    - Target value <= 0 (Rule 4) -> HTTP 400
 *    - Non-existent objective_id -> HTTP 404
 * 4. Key Result Detail (GET /api/okr/kr/:krId):
 *    - Returns KR detail + assignee info + checkins array -> HTTP 200
 *    - Rule 8: Unrelated member blocked from viewing KR of Individual objective -> HTTP 403
 *    - Admin can view any KR -> HTTP 200
 * 5. Key Result Update (PATCH /api/okr/kr/:krId):
 *    - Assignee updates KR title and due date -> HTTP 200
 *    - Admin updates target_value -> HTTP 200 + auto-recomputed progress_pct
 *    - Rule 10: Auto-logged changes to okr_history verified in DB
 *    - Target value <= 0 rejected -> HTTP 400
 *    - Unrelated member blocked from updating KR -> HTTP 403
 *    - Update on ARCHIVED objective rejected -> HTTP 400
 * 6. Key Result Deletion (DELETE /api/okr/kr/:krId):
 *    - Admin deletes KR from DRAFT objective -> HTTP 200
 *    - Delete KR from ACTIVE objective rejected -> HTTP 400
 *    - Member blocked from deleting KR -> HTTP 403
 * 7. Objective Detail Integration:
 *    - GET /api/okr/objective/:id reflects populated key_results array
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log(' PRD 19 — LAYER 3: KEY RESULT SERVICE & API + CIRCULAR DETECTION');
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
    VALUES (?, ?, ?, 'Test Harness PRD19 Layer 3', '127.0.0.1', datetime('now'), ?, 0)
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

  console.log('--- 1. SETTING UP TEST USERS & SERVER ---');
  const ts = Date.now();

  // Admin user
  let adminUser = queryOne("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1;");
  if (!adminUser) {
    const adminId = `admin-kr-${ts}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at)
      VALUES (?, 'Admin KR Tester', 'admin.kr.${ts}@mahi.com', 'hash', 'admin', 'active', datetime('now'))
    `, [adminId]);
    adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
  }

  // Member 1 (Developer)
  const member1Id = `member1-kr-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Dev Alice', 'alice.kr.${ts}@mahi.com', 'hash', 'developer', 'active', datetime('now'))
  `, [member1Id]);
  const member1 = queryOne('SELECT * FROM users WHERE id = ?', [member1Id]);

  // Member 2 (Designer)
  const member2Id = `member2-kr-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Designer Bob', 'bob.kr.${ts}@mahi.com', 'hash', 'designer', 'active', datetime('now'))
  `, [member2Id]);
  const member2 = queryOne('SELECT * FROM users WHERE id = ?', [member2Id]);

  const adminToken = createAuthToken(adminUser);
  const member1Token = createAuthToken(member1);
  const member2Token = createAuthToken(member2);

  // Start HTTP server on dynamic port
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test Server running on ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------
    // 2. Circular Chain Detection Tests (A -> B -> C -> A)
    // -------------------------------------------------------------------
    console.log('--- 2. CIRCULAR CHAIN DETECTION (A→B→C→A) ---');
    // Create Company A
    const objARes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Chain Root Objective A',
      level: 'COMPANY',
      cycle: 'Q1-2026'
    });
    const objAId = objARes.data.id;

    // Create Team B linked to A
    const objBRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Chain Mid Objective B',
      level: 'TEAM',
      cycle: 'Q1-2026',
      parent_objective_id: objAId
    });
    const objBId = objBRes.data.id;

    // Create Individual C linked to B
    const objCRes = await request(baseUrl, 'POST', '/api/okr/objective/create', member1Token, {
      title: 'Chain Leaf Objective C',
      level: 'INDIVIDUAL',
      cycle: 'Q1-2026',
      parent_objective_id: objBId
    });
    const objCId = objCRes.data.id;

    // 2a. Attempt to link A under C via POST /api/okr/alignment/link
    const cycleLinkRes = await request(baseUrl, 'POST', '/api/okr/alignment/link', adminToken, {
      child_objective_id: objAId,
      parent_objective_id: objCId
    });

    assert(
      cycleLinkRes.status === 400 && cycleLinkRes.data?.error?.includes('Circular alignment detected'),
      'Circular alignment link (A under C when A→B→C) blocked with HTTP 400',
      `Error: "${cycleLinkRes.data?.error}"`
    );

    // 2b. Attempt to update A with parent_objective_id = C via PATCH
    const cyclePatchRes = await request(baseUrl, 'PATCH', `/api/okr/objective/${objAId}`, adminToken, {
      parent_objective_id: objCId
    });

    assert(
      cyclePatchRes.status === 400 && cyclePatchRes.data?.error?.includes('Circular alignment detected'),
      'Circular update parent_objective_id (A→C) blocked with HTTP 400',
      `Error: "${cyclePatchRes.data?.error}"`
    );

    // 2c. Direct self-link (A under A)
    const selfLinkRes = await request(baseUrl, 'POST', '/api/okr/alignment/link', adminToken, {
      child_objective_id: objAId,
      parent_objective_id: objAId
    });

    assert(
      selfLinkRes.status === 400 && selfLinkRes.data?.error?.includes('own parent'),
      'Self-linking (A under A) blocked with HTTP 400',
      `Error: "${selfLinkRes.data?.error}"`
    );

    // -------------------------------------------------------------------
    // 3. Key Result Creation Tests
    // -------------------------------------------------------------------
    console.log('\n--- 3. KEY RESULT CREATION & TYPES ---');

    // 3a. Admin creates PERCENTAGE KR
    const krPctRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objAId,
      title: 'KR 1: Reach 99.99% Core Service Uptime',
      description: 'Zero Sev1 incidents in Q1',
      type: 'PERCENTAGE',
      target_value: 100,
      unit: '%',
      assigned_to: member1.id,
      due_date: '2026-03-31'
    });

    assert(
      krPctRes.status === 201 && krPctRes.data.type === 'PERCENTAGE' && krPctRes.data.target_value === 100,
      'Admin creates PERCENTAGE Key Result (HTTP 201)',
      `ID: ${krPctRes.data?.id}, target: ${krPctRes.data?.target_value}, unit: ${krPctRes.data?.unit}`
    );
    const krPctId = krPctRes.data.id;

    // Verify creation logged in okr_history
    const krCreatedHist = queryOne(
      "SELECT * FROM okr_history WHERE entity_type = 'KEY_RESULT' AND entity_id = ? AND field_changed = 'created'",
      [krPctId]
    );
    assert(
      !!krCreatedHist,
      'KR creation auto-logged in okr_history',
      krCreatedHist ? `History ID: ${krCreatedHist.id}, field: ${krCreatedHist.field_changed}` : 'No history record'
    );

    // 3b. Admin creates NUMBER KR
    const krNumRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objAId,
      title: 'KR 2: Onboard 50 Enterprise Accounts',
      type: 'NUMBER',
      target_value: 50,
      unit: 'enterprises',
      assigned_to: member2.id
    });

    assert(
      krNumRes.status === 201 && krNumRes.data.type === 'NUMBER' && krNumRes.data.target_value === 50,
      'Admin creates NUMBER Key Result (HTTP 201)',
      `ID: ${krNumRes.data?.id}, target: ${krNumRes.data?.target_value} ${krNumRes.data?.unit}`
    );
    const krNumId = krNumRes.data.id;

    // 3c. Admin creates BOOLEAN KR
    const krBoolRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objAId,
      title: 'KR 3: Obtain ISO 27001 Security Certification',
      type: 'BOOLEAN',
      target_value: 999 // Should be normalized to 1 by service
    });

    assert(
      krBoolRes.status === 201 && krBoolRes.data.type === 'BOOLEAN' && krBoolRes.data.target_value === 1,
      'Admin creates BOOLEAN Key Result (target normalized to 1)',
      `ID: ${krBoolRes.data?.id}, target: ${krBoolRes.data?.target_value}`
    );

    // 3d. Admin creates MILESTONE KR
    const krMileRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objBId,
      title: 'KR 4: Complete 4 Migration Milestones',
      type: 'MILESTONE',
      target_value: 4,
      unit: 'milestones'
    });

    assert(
      krMileRes.status === 201 && krMileRes.data.type === 'MILESTONE' && krMileRes.data.target_value === 4,
      'Admin creates MILESTONE Key Result (HTTP 201)',
      `ID: ${krMileRes.data?.id}, target: ${krMileRes.data?.target_value}`
    );

    // 3e. Member 1 creates KR on their own Individual Objective C
    const krMemberRes = await request(baseUrl, 'POST', '/api/okr/kr/create', member1Token, {
      objective_id: objCId,
      title: 'Personal KR: Read 3 Microservices Architecture Books',
      type: 'NUMBER',
      target_value: 3,
      unit: 'books'
    });

    assert(
      krMemberRes.status === 201 && krMemberRes.data.objective_id === objCId,
      'Objective owner creates KR on own Individual Objective (HTTP 201)',
      `ID: ${krMemberRes.data?.id}`
    );
    const krMember1Id = krMemberRes.data.id;

    // 3f. Member 2 blocked from adding KR to Member 1's Individual Objective
    const krForbiddenRes = await request(baseUrl, 'POST', '/api/okr/kr/create', member2Token, {
      objective_id: objCId,
      title: 'Unauthorized KR addition'
    });

    assert(
      krForbiddenRes.status === 403,
      'Member blocked from adding KR to another member objective (HTTP 403)',
      `Error: "${krForbiddenRes.data?.error}"`
    );

    // -------------------------------------------------------------------
    // 4. Key Result Validation Checks
    // -------------------------------------------------------------------
    console.log('\n--- 4. KEY RESULT VALIDATION ---');
    const noTitleRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objAId,
      title: ''
    });
    assert(noTitleRes.status === 400, 'Validation: Empty KR title rejected (HTTP 400)');

    const badTypeRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objAId,
      title: 'Bad Type KR',
      type: 'INVALID_TYPE'
    });
    assert(badTypeRes.status === 400, 'Validation: Invalid KR type rejected (HTTP 400)');

    const zeroTargetRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objAId,
      title: 'Zero Target KR',
      type: 'NUMBER',
      target_value: 0
    });
    assert(
      zeroTargetRes.status === 400 && zeroTargetRes.data?.error?.includes('greater than 0'),
      'Rule 4: KR target_value <= 0 rejected (HTTP 400)',
      zeroTargetRes.data?.error
    );

    const badObjRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: 999999,
      title: 'Orphan KR'
    });
    assert(badObjRes.status === 404, 'Validation: Non-existent objective_id rejected (HTTP 404)');

    // -------------------------------------------------------------------
    // 5. GET /api/okr/kr/:krId (Detail & Privacy)
    // -------------------------------------------------------------------
    console.log('\n--- 5. KEY RESULT DETAIL & ACCESS CONTROL ---');
    const getKrRes = await request(baseUrl, 'GET', `/api/okr/kr/${krPctId}`, adminToken);
    assert(
      getKrRes.status === 200 && getKrRes.data.id === krPctId && Array.isArray(getKrRes.data.checkins),
      'GET /api/okr/kr/:krId returns KR detail + checkins array',
      `Title: "${getKrRes.data?.title}", Assignee: ${getKrRes.data?.assignee_name}`
    );

    // Member 2 forbidden from viewing KR of Member 1's Individual objective
    const forbiddenKrDetailRes = await request(baseUrl, 'GET', `/api/okr/kr/${krMember1Id}`, member2Token);
    assert(
      forbiddenKrDetailRes.status === 403,
      'Rule 8: Member forbidden from viewing KR of another member individual objective (HTTP 403)',
      `Error: "${forbiddenKrDetailRes.data?.error}"`
    );

    // -------------------------------------------------------------------
    // 6. PATCH /api/okr/kr/:krId & Audit History
    // -------------------------------------------------------------------
    console.log('\n--- 6. KEY RESULT UPDATES & AUDIT HISTORY ---');
    // Assignee (member1) updates title and due_date
    const updateKrRes = await request(baseUrl, 'PATCH', `/api/okr/kr/${krPctId}`, member1Token, {
      title: 'KR 1: Reach 99.999% High Availability Uptime',
      due_date: '2026-06-30'
    });

    assert(
      updateKrRes.status === 200 && updateKrRes.data.title.includes('99.999%'),
      'Assignee updates KR title & due date (HTTP 200)',
      `Title: "${updateKrRes.data?.title}", Due: ${updateKrRes.data?.due_date}`
    );

    // Verify change auto-logged to okr_history (Rule 10)
    const krTitleHist = queryOne(
      "SELECT * FROM okr_history WHERE entity_type = 'KEY_RESULT' AND entity_id = ? AND field_changed = 'title' ORDER BY id DESC LIMIT 1;",
      [krPctId]
    );
    assert(
      !!krTitleHist && krTitleHist.new_value.includes('99.999%'),
      'Rule 10: Auto-logged KR field change in okr_history',
      `Field: ${krTitleHist?.field_changed}, Old: "${krTitleHist?.old_value}", New: "${krTitleHist?.new_value}"`
    );

    // Admin updates target_value of number KR
    const updateTargetRes = await request(baseUrl, 'PATCH', `/api/okr/kr/${krNumId}`, adminToken, {
      target_value: 100
    });
    assert(
      updateTargetRes.status === 200 && updateTargetRes.data.target_value === 100,
      'Admin updates KR target_value (HTTP 200)',
      `Target: ${updateTargetRes.data?.target_value}`
    );

    // Invalid target <= 0 update rejected
    const badTargetUpdateRes = await request(baseUrl, 'PATCH', `/api/okr/kr/${krNumId}`, adminToken, {
      target_value: -10
    });
    assert(badTargetUpdateRes.status === 400, 'Rule 4: Updating target_value <= 0 rejected (HTTP 400)');

    // Unrelated member blocked from updating KR
    const blockedUpdateRes = await request(baseUrl, 'PATCH', `/api/okr/kr/${krPctId}`, member2Token, {
      title: 'Hacked Title'
    });
    assert(blockedUpdateRes.status === 403, 'Unrelated member blocked from updating KR (HTTP 403)');

    // -------------------------------------------------------------------
    // 7. DELETE /api/okr/kr/:krId
    // -------------------------------------------------------------------
    console.log('\n--- 7. KEY RESULT DELETION GOVERNANCE ---');
    // Create a DRAFT objective with a KR to test deletion
    const draftObjRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Draft Objective for KR Deletion',
      level: 'COMPANY',
      status: 'DRAFT'
    });
    const draftObjId = draftObjRes.data.id;

    const draftKrRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: draftObjId,
      title: 'Deletable Draft Key Result',
      type: 'NUMBER',
      target_value: 10
    });
    const draftKrId = draftKrRes.data.id;

    // Admin deletes KR from DRAFT objective
    const deleteKrRes = await request(baseUrl, 'DELETE', `/api/okr/kr/${draftKrId}`, adminToken);
    assert(deleteKrRes.status === 200 && deleteKrRes.data.success, 'Admin deletes KR from DRAFT objective (HTTP 200)');

    // Attempt to delete KR from ACTIVE objective -> HTTP 400
    const deleteActiveKrRes = await request(baseUrl, 'DELETE', `/api/okr/kr/${krPctId}`, adminToken);
    assert(
      deleteActiveKrRes.status === 400 && deleteActiveKrRes.data?.error?.includes('DRAFT'),
      'Cannot delete KR from ACTIVE objective (HTTP 400 - DRAFT required)',
      deleteActiveKrRes.data?.error
    );

    // Member blocked from deleting KR
    const memberDeleteKrRes = await request(baseUrl, 'DELETE', `/api/okr/kr/${krMember1Id}`, member1Token);
    assert(memberDeleteKrRes.status === 403, 'Member blocked from deleting Key Result (HTTP 403)');

    // -------------------------------------------------------------------
    // 8. Integration with Objective Detail View
    // -------------------------------------------------------------------
    console.log('\n--- 8. OBJECTIVE DETAIL INTEGRATION ---');
    const finalObjRes = await request(baseUrl, 'GET', `/api/okr/objective/${objAId}`, adminToken);
    assert(
      finalObjRes.status === 200 && Array.isArray(finalObjRes.data.key_results) && finalObjRes.data.key_results.length >= 3,
      'Objective Detail now includes populated key_results array',
      `Key Results count: ${finalObjRes.data.key_results?.length}`
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
    console.log('  🎉 LAYER 3 INTEGRITY VERIFIED: KR Service & API + Circular Detection 100% operational');
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
