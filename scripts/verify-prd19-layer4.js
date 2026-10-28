/**
 * PRD 19 — Layer 4 Verification Suite: Check-in Service, Progress Recalculation & Bottom-Up Hierarchy Propagation
 * 
 * Verifies with real HTTP network calls AND direct SQLite DB queries:
 * 1. 3-Tier OKR Alignment Hierarchy Setup (Root Company A -> Mid Team B -> Leaf Individual C)
 * 2. Initial state verification: progress_pct = 0.00 across all 3 tiers
 * 3. Check-in Submission on Leaf KR 1 (PERCENTAGE):
 *    - HTTP 201 response
 *    - Direct SELECT on okr_key_results: current_value = 50, progress_pct = 50.00, status = ON_TRACK
 *    - Direct SELECT on okr_checkins: append-only record verified with previous_value = 0, new_value = 50
 * 4. Parent Objective Auto-Rollup (Leaf Objective C):
 *    - Objective C has 2 KRs: KR 1 (50%), KR 2 (0%) -> Average = 25.00%
 *    - Direct SELECT on okr_objectives: progress_pct = 25.00
 * 5. Multi-Tier Bottom-Up Propagation:
 *    - Team Objective B has own KR 3 (0%) and Child C (25.00%) -> Average = 12.50%
 *    - Direct SELECT on okr_objectives: progress_pct = 12.50
 *    - Company Objective A has Child B (12.50%) -> progress_pct = 12.50
 *    - Direct SELECT on okr_objectives: progress_pct = 12.50
 * 6. Second Check-in & Cumulative Propagation:
 *    - Alice submits KR 2: 50/50 -> 100%
 *    - Leaf C: (50 + 100)/2 = 75.00%
 *    - Mid B: (0 + 75)/2 = 37.50%
 *    - Root A: 37.50%
 *    - Direct SELECT confirms every tier
 * 7. Mid Team KR Check-in:
 *    - KR 3 on Team Objective B: 4/4 -> 100%
 *    - Mid B: (100 + 75)/2 = 87.50%
 *    - Root A: 87.50%
 *    - Direct SELECT confirms every tier
 * 8. Final Push to 100% & Objective Auto-Completion:
 *    - Alice submits KR 1: 100/100 -> 100%
 *    - Leaf C hits 100.00% -> status auto-transitions to COMPLETED
 *    - Mid B hits 100.00% -> status auto-transitions to COMPLETED
 *    - Root A hits 100.00% -> status auto-transitions to COMPLETED
 *    - Direct SELECT confirms all 3 tiers COMPLETED
 * 9. BOOLEAN KR Check-in (Rule 5):
 *    - new_value = 5 rejected with HTTP 400
 *    - new_value = 1 accepted (100% COMPLETED)
 *    - new_value = 0 accepted (0% ON_TRACK)
 * 10. Auto-Status Calculation Logic (Rule 7):
 *     - progress < 30% with due_date within 7 days -> OFF_TRACK
 *     - LOW confidence -> AT_RISK
 * 11. RBAC & Security Validation:
 *     - Unrelated member Bob blocked from submitting check-in on Alice's KR (HTTP 403)
 *     - Check-in on ARCHIVED objective blocked (HTTP 400)
 *     - Negative values and invalid confidence rejected (HTTP 400)
 * 12. Append-Only Trigger Enforcement:
 *     - Direct UPDATE on okr_checkins blocked by trigger
 *     - Direct DELETE on okr_checkins blocked by trigger
 * 13. Audit Trail Verification (Rule 10):
 *     - checkin_submitted logged in okr_history
 * 14. GET /api/okr/checkins/:krId query + Rule 8 Privacy filtering
 * 15. GET /api/okr/dashboard summary & company health score
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log(' PRD 19 — LAYER 4: CHECK-IN SERVICE & BOTTOM-UP RECALCULATION');
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
    VALUES (?, ?, ?, 'Test Harness PRD19 Layer 4', '127.0.0.1', datetime('now'), ?, 0)
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

  console.log('--- 1. SETTING UP TEST USERS & TEST SERVER ---');
  const ts = Date.now();

  // Admin user
  let adminUser = queryOne("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1;");
  if (!adminUser) {
    const adminId = `admin-l4-${ts}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at)
      VALUES (?, 'Admin L4 Tester', 'admin.l4.${ts}@mahi.com', 'hash', 'admin', 'active', datetime('now'))
    `, [adminId]);
    adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
  }

  // Member 1 (Developer Alice)
  const member1Id = `alice-l4-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Developer Alice', 'alice.l4.${ts}@mahi.com', 'hash', 'developer', 'active', datetime('now'))
  `, [member1Id]);
  const alice = queryOne('SELECT * FROM users WHERE id = ?', [member1Id]);

  // Member 2 (Designer Bob)
  const member2Id = `bob-l4-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Designer Bob', 'bob.l4.${ts}@mahi.com', 'hash', 'designer', 'active', datetime('now'))
  `, [member2Id]);
  const bob = queryOne('SELECT * FROM users WHERE id = ?', [member2Id]);

  const adminToken = createAuthToken(adminUser);
  const aliceToken = createAuthToken(alice);
  const bobToken = createAuthToken(bob);

  // Start HTTP server on dynamic port
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test Server running on ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------
    // 2. 3-TIER HIERARCHY SETUP: Company A -> Team B -> Individual C
    // -------------------------------------------------------------------
    console.log('--- 2. CREATING 3-TIER OKR HIERARCHY (Company → Team → Individual) ---');

    // 2a. Root Company Objective A
    const objARes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Company Objective A: Scale Platform Globally',
      description: 'Expand infrastructure and reach worldwide tier-1 markets',
      level: 'COMPANY',
      cycle: `Q1-${ts}`
    });
    const objAId = objARes.data.id;
    assert(objARes.status === 201 && objAId, 'Root Company Objective A created', `ID: ${objAId}`);

    // 2b. Mid Team Objective B aligned to A
    const objBRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Team Objective B: High Performance Cloud Core',
      description: 'Optimize latency and microservice architecture',
      level: 'TEAM',
      cycle: `Q1-${ts}`,
      parent_objective_id: objAId
    });
    const objBId = objBRes.data.id;
    assert(objBRes.status === 201 && objBId, 'Mid Team Objective B created under A', `ID: ${objBId}, Parent: ${objAId}`);

    // 2c. Leaf Individual Objective C owned by Alice, aligned to B
    const objCRes = await request(baseUrl, 'POST', '/api/okr/objective/create', aliceToken, {
      title: 'Individual Objective C: Alice Service Reliability',
      description: 'Achieve five-nines uptime and automated self-healing',
      level: 'INDIVIDUAL',
      cycle: `Q1-${ts}`,
      parent_objective_id: objBId
    });
    const objCId = objCRes.data.id;
    assert(objCRes.status === 201 && objCId, 'Leaf Individual Objective C created by Alice under B', `ID: ${objCId}, Parent: ${objBId}`);

    // 2d. Add KRs:
    // On Objective C: KR 1 (PERCENTAGE, target: 100), KR 2 (NUMBER, target: 50)
    const kr1Res = await request(baseUrl, 'POST', '/api/okr/kr/create', aliceToken, {
      objective_id: objCId,
      title: 'KR 1: Maintain 99.99% Availability',
      type: 'PERCENTAGE',
      target_value: 100,
      unit: '%',
      assigned_to: alice.id,
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    const kr1Id = kr1Res.data.id;

    const kr2Res = await request(baseUrl, 'POST', '/api/okr/kr/create', aliceToken, {
      objective_id: objCId,
      title: 'KR 2: Deploy 50 Microservices',
      type: 'NUMBER',
      target_value: 50,
      unit: 'services',
      assigned_to: alice.id
    });
    const kr2Id = kr2Res.data.id;

    // On Objective B: KR 3 (MILESTONE, target: 4)
    const kr3Res = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objBId,
      title: 'KR 3: Complete 4 Architecture Milestones',
      type: 'MILESTONE',
      target_value: 4,
      unit: 'milestones',
      assigned_to: alice.id
    });
    const kr3Id = kr3Res.data.id;

    assert(kr1Id && kr2Id && kr3Id, 'Created KRs across hierarchy', `Leaf: KR#${kr1Id}, KR#${kr2Id} | Mid: KR#${kr3Id}`);

    // Verify initial DB state via direct SELECT
    const initialA = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objAId]);
    const initialB = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objBId]);
    const initialC = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objCId]);
    assert(
      initialA.progress_pct === 0 && initialB.progress_pct === 0 && initialC.progress_pct === 0,
      'Direct DB SELECT: Initial progress_pct is exactly 0.00% across all 3 tiers',
      `Root: ${initialA.progress_pct}%, Mid: ${initialB.progress_pct}%, Leaf: ${initialC.progress_pct}%`
    );

    // -------------------------------------------------------------------
    // 3. CHECK-IN SUBMISSION & KR PROGRESS CALCULATION
    // -------------------------------------------------------------------
    console.log('\n--- 3. CHECK-IN SUBMISSION ON LEAF KR 1 (PERCENTAGE) ---');
    const checkin1Res = await request(baseUrl, 'POST', '/api/okr/checkin/submit', aliceToken, {
      key_result_id: kr1Id,
      new_value: 50,
      confidence: 'HIGH',
      note: 'Migrated 50% of core telemetry pipelines'
    });

    assert(checkin1Res.status === 201, 'POST /api/okr/checkin/submit returns HTTP 201', `Status: ${checkin1Res.status}`);

    // Direct DB SELECT: Verify okr_key_results updated
    const dbKr1 = queryOne('SELECT current_value, progress_pct, status FROM okr_key_results WHERE id = ?', [kr1Id]);
    assert(
      dbKr1.current_value === 50 && dbKr1.progress_pct === 50 && dbKr1.status === 'ON_TRACK',
      'Direct DB SELECT (okr_key_results): KR 1 current_value=50, progress_pct=50.00%, status=ON_TRACK',
      `DB State: current_value=${dbKr1.current_value}, progress_pct=${dbKr1.progress_pct}%, status=${dbKr1.status}`
    );

    // Direct DB SELECT: Verify okr_checkins record
    const dbCheckin1 = queryOne('SELECT * FROM okr_checkins WHERE key_result_id = ? ORDER BY id DESC LIMIT 1', [kr1Id]);
    assert(
      dbCheckin1 && dbCheckin1.previous_value === 0 && dbCheckin1.new_value === 50 && dbCheckin1.confidence === 'HIGH' && dbCheckin1.submitted_by === alice.id,
      'Direct DB SELECT (okr_checkins): Append-only record inserted with previous_value=0, new_value=50, confidence=HIGH',
      `Checkin ID: ${dbCheckin1?.id}, note: "${dbCheckin1?.note}"`
    );

    // -------------------------------------------------------------------
    // 4. PARENT OBJECTIVE AUTO-ROLLUP (Average of KRs)
    // -------------------------------------------------------------------
    console.log('\n--- 4. PARENT OBJECTIVE AUTO-ROLLUP (Leaf Objective C) ---');
    // Objective C has KR 1 (50%) and KR 2 (0%). Average = (50 + 0) / 2 = 25.00%
    const dbObjC_pass1 = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objCId]);
    assert(
      dbObjC_pass1.progress_pct === 25,
      'Direct DB SELECT (okr_objectives): Leaf Objective C progress_pct auto-rolled up to 25.00% ((50% + 0%) / 2)',
      `Actual DB progress_pct: ${dbObjC_pass1.progress_pct}%`
    );

    // -------------------------------------------------------------------
    // 5. MULTI-TIER BOTTOM-UP PROPAGATION (Leaf → Mid → Root)
    // -------------------------------------------------------------------
    console.log('\n--- 5. MULTI-TIER BOTTOM-UP PROPAGATION (Leaf → Mid → Root) ---');
    // Mid Objective B has own KR 3 (0%) and Child Objective C (25.00%).
    // Weighted average = (0% + 25%) / 2 = 12.50%
    const dbObjB_pass1 = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objBId]);
    assert(
      dbObjB_pass1.progress_pct === 12.5,
      'Direct DB SELECT (okr_objectives): Mid Objective B progress_pct propagated up to 12.50% ((0% + 25%) / 2)',
      `Actual DB progress_pct: ${dbObjB_pass1.progress_pct}%`
    );

    // Root Company Objective A has no own KRs, 1 child Objective B (12.50%).
    // Progress = 12.50%
    const dbObjA_pass1 = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objAId]);
    assert(
      dbObjA_pass1.progress_pct === 12.5,
      'Direct DB SELECT (okr_objectives): Root Company Objective A progress_pct propagated to root at 12.50%',
      `Actual DB progress_pct: ${dbObjA_pass1.progress_pct}%`
    );

    // -------------------------------------------------------------------
    // 6. SECOND CHECK-IN & CUMULATIVE PROPAGATION
    // -------------------------------------------------------------------
    console.log('\n--- 6. SECOND CHECK-IN (KR 2: 50/50 -> 100%) & CUMULATIVE ROLLUP ---');
    const checkin2Res = await request(baseUrl, 'POST', '/api/okr/checkin/submit', aliceToken, {
      key_result_id: kr2Id,
      new_value: 50,
      confidence: 'HIGH',
      note: 'All 50 microservices deployed to staging'
    });
    assert(checkin2Res.status === 201, 'POST /api/okr/checkin/submit on KR 2 returns HTTP 201');

    // Direct DB SELECT: KR 2 is now 100% and COMPLETED
    const dbKr2 = queryOne('SELECT current_value, progress_pct, status FROM okr_key_results WHERE id = ?', [kr2Id]);
    assert(
      dbKr2.current_value === 50 && dbKr2.progress_pct === 100 && dbKr2.status === 'COMPLETED',
      'Direct DB SELECT (okr_key_results): KR 2 current_value=50, progress_pct=100.00%, status=COMPLETED',
      `DB State: current_value=${dbKr2.current_value}, status=${dbKr2.status}`
    );

    // Leaf Objective C: KR 1 is 50%, KR 2 is 100% -> Average = (50 + 100) / 2 = 75.00%
    const dbObjC_pass2 = queryOne('SELECT progress_pct FROM okr_objectives WHERE id = ?', [objCId]);
    assert(
      dbObjC_pass2.progress_pct === 75,
      'Direct DB SELECT (okr_objectives): Leaf Objective C recalculated to 75.00% ((50% + 100%) / 2)',
      `Actual DB progress_pct: ${dbObjC_pass2.progress_pct}%`
    );

    // Mid Objective B: KR 3 is 0%, Child C is 75% -> Average = (0 + 75) / 2 = 37.50%
    const dbObjB_pass2 = queryOne('SELECT progress_pct FROM okr_objectives WHERE id = ?', [objBId]);
    assert(
      dbObjB_pass2.progress_pct === 37.5,
      'Direct DB SELECT (okr_objectives): Mid Objective B propagated up to 37.50% ((0% + 75%) / 2)',
      `Actual DB progress_pct: ${dbObjB_pass2.progress_pct}%`
    );

    // Root Objective A: Child B is 37.50% -> 37.50%
    const dbObjA_pass2 = queryOne('SELECT progress_pct FROM okr_objectives WHERE id = ?', [objAId]);
    assert(
      dbObjA_pass2.progress_pct === 37.5,
      'Direct DB SELECT (okr_objectives): Root Company Objective A propagated to 37.50%',
      `Actual DB progress_pct: ${dbObjA_pass2.progress_pct}%`
    );

    // -------------------------------------------------------------------
    // 7. MID TEAM KR CHECK-IN (KR 3: 4/4 Milestones -> 100%)
    // -------------------------------------------------------------------
    console.log('\n--- 7. MID TEAM KR CHECK-IN (KR 3: 4/4 Milestones) ---');
    const checkin3Res = await request(baseUrl, 'POST', '/api/okr/checkin/submit', aliceToken, {
      key_result_id: kr3Id,
      new_value: 4,
      confidence: 'HIGH',
      note: 'All 4 architecture milestones delivered'
    });
    assert(checkin3Res.status === 201, 'POST /api/okr/checkin/submit on Mid KR 3 returns HTTP 201');

    // Direct DB SELECT on KR 3
    const dbKr3 = queryOne('SELECT current_value, progress_pct, status FROM okr_key_results WHERE id = ?', [kr3Id]);
    assert(
      dbKr3.current_value === 4 && dbKr3.progress_pct === 100 && dbKr3.status === 'COMPLETED',
      'Direct DB SELECT (okr_key_results): KR 3 current_value=4, progress_pct=100.00%, status=COMPLETED',
      `DB State: current_value=${dbKr3.current_value}, status=${dbKr3.status}`
    );

    // Mid Objective B: own KR 3 is 100%, Child C is 75% -> Average = (100 + 75) / 2 = 87.50%
    const dbObjB_pass3 = queryOne('SELECT progress_pct FROM okr_objectives WHERE id = ?', [objBId]);
    assert(
      dbObjB_pass3.progress_pct === 87.5,
      'Direct DB SELECT (okr_objectives): Mid Objective B rolled up to 87.50% ((100% + 75%) / 2)',
      `Actual DB progress_pct: ${dbObjB_pass3.progress_pct}%`
    );

    // Root Objective A: Child B is 87.50% -> 87.50%
    const dbObjA_pass3 = queryOne('SELECT progress_pct FROM okr_objectives WHERE id = ?', [objAId]);
    assert(
      dbObjA_pass3.progress_pct === 87.5,
      'Direct DB SELECT (okr_objectives): Root Company Objective A propagated to 87.50%',
      `Actual DB progress_pct: ${dbObjA_pass3.progress_pct}%`
    );

    // -------------------------------------------------------------------
    // 8. FINAL PUSH TO 100% & OBJECTIVE AUTO-COMPLETION
    // -------------------------------------------------------------------
    console.log('\n--- 8. FINAL PUSH TO 100% & AUTOMATIC STATUS TRANSITION TO COMPLETED ---');
    // Alice completes KR 1 to 100
    const checkin4Res = await request(baseUrl, 'POST', '/api/okr/checkin/submit', aliceToken, {
      key_result_id: kr1Id,
      new_value: 100,
      confidence: 'HIGH',
      note: '100% complete — verified zero production downtime'
    });
    assert(checkin4Res.status === 201, 'POST /api/okr/checkin/submit on KR 1 hits 100');

    // Direct DB SELECT: All 3 tiers should now be exactly 100.00% and status COMPLETED!
    const finalC = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objCId]);
    const finalB = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objBId]);
    const finalA = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objAId]);

    assert(
      finalC.progress_pct === 100 && finalC.status === 'COMPLETED',
      'Direct DB SELECT (okr_objectives): Leaf Objective C hits 100.00% and status transitions to COMPLETED',
      `Leaf C: progress_pct=${finalC.progress_pct}%, status=${finalC.status}`
    );

    assert(
      finalB.progress_pct === 100 && finalB.status === 'COMPLETED',
      'Direct DB SELECT (okr_objectives): Mid Objective B hits 100.00% and status transitions to COMPLETED',
      `Mid B: progress_pct=${finalB.progress_pct}%, status=${finalB.status}`
    );

    assert(
      finalA.progress_pct === 100 && finalA.status === 'COMPLETED',
      'Direct DB SELECT (okr_objectives): Root Objective A hits 100.00% and status transitions to COMPLETED',
      `Root A: progress_pct=${finalA.progress_pct}%, status=${finalA.status}`
    );

    // -------------------------------------------------------------------
    // 9. BOOLEAN KR CHECK-IN & RULE 5
    // -------------------------------------------------------------------
    console.log('\n--- 9. BOOLEAN KEY RESULT CHECK-IN & RULE 5 ---');
    const boolKrRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objAId,
      title: 'KR 4: ISO-27001 Certification Achieved',
      type: 'BOOLEAN',
      target_value: 1
    });
    const boolKrId = boolKrRes.data.id;

    // 9a. Rule 5: Reject invalid boolean value (e.g. 5)
    const invalidBoolRes = await request(baseUrl, 'POST', '/api/okr/checkin/submit', adminToken, {
      key_result_id: boolKrId,
      new_value: 5
    });
    assert(
      invalidBoolRes.status === 400 && invalidBoolRes.data?.error?.includes('BOOLEAN Key Result accepts only 0 or 1'),
      'Rule 5: Submitting new_value = 5 on BOOLEAN KR rejected with HTTP 400',
      `Error: "${invalidBoolRes.data?.error}"`
    );

    // 9b. Submit boolean value 1 -> 100% COMPLETED
    const validBoolRes1 = await request(baseUrl, 'POST', '/api/okr/checkin/submit', adminToken, {
      key_result_id: boolKrId,
      new_value: 1,
      confidence: 'HIGH'
    });
    assert(validBoolRes1.status === 201, 'Submit new_value = 1 on BOOLEAN KR returns HTTP 201');

    const dbBoolKr1 = queryOne('SELECT current_value, progress_pct, status FROM okr_key_results WHERE id = ?', [boolKrId]);
    assert(
      dbBoolKr1.current_value === 1 && dbBoolKr1.progress_pct === 100 && dbBoolKr1.status === 'COMPLETED',
      'Direct DB SELECT: BOOLEAN KR current_value=1, progress_pct=100.00%, status=COMPLETED',
      `DB State: current_value=${dbBoolKr1.current_value}, progress_pct=${dbBoolKr1.progress_pct}%, status=${dbBoolKr1.status}`
    );

    // 9c. Submit boolean value 0 -> 0% ON_TRACK
    const validBoolRes0 = await request(baseUrl, 'POST', '/api/okr/checkin/submit', adminToken, {
      key_result_id: boolKrId,
      new_value: 0,
      confidence: 'MEDIUM'
    });
    assert(validBoolRes0.status === 201, 'Submit new_value = 0 on BOOLEAN KR returns HTTP 201');

    const dbBoolKr0 = queryOne('SELECT current_value, progress_pct, status FROM okr_key_results WHERE id = ?', [boolKrId]);
    assert(
      dbBoolKr0.current_value === 0 && dbBoolKr0.progress_pct === 0 && dbBoolKr0.status === 'ON_TRACK',
      'Direct DB SELECT: BOOLEAN KR current_value=0, progress_pct=0.00%, status=ON_TRACK',
      `DB State: current_value=${dbBoolKr0.current_value}, progress_pct=${dbBoolKr0.progress_pct}%, status=${dbBoolKr0.status}`
    );

    // -------------------------------------------------------------------
    // 10. AUTO-STATUS CALCULATION LOGIC (Rule 7)
    // -------------------------------------------------------------------
    console.log('\n--- 10. AUTO-STATUS CALCULATION LOGIC (Rule 7) ---');
    // 10a. Create KR with due date in 3 days (within 7 days) and target 100
    const nearDueKrRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objBId,
      title: 'Near Due Critical Deliverable',
      type: 'NUMBER',
      target_value: 100,
      due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    });
    const nearDueKrId = nearDueKrRes.data.id;

    // Checkin progress < 30 (e.g. 15) -> status becomes OFF_TRACK
    await request(baseUrl, 'POST', '/api/okr/checkin/submit', adminToken, {
      key_result_id: nearDueKrId,
      new_value: 15,
      confidence: 'HIGH'
    });
    const dbNearDue = queryOne('SELECT status, progress_pct FROM okr_key_results WHERE id = ?', [nearDueKrId]);
    assert(
      dbNearDue.status === 'OFF_TRACK',
      'Rule 7: KR with progress < 30% and due_date within 7 days auto-sets status to OFF_TRACK',
      `Status: ${dbNearDue.status}, progress: ${dbNearDue.progress_pct}%`
    );

    // 10b. Checkin with LOW confidence -> status becomes AT_RISK
    const lowConfKrRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: objBId,
      title: 'Risk-prone Investigation Task',
      type: 'NUMBER',
      target_value: 100
    });
    const lowConfKrId = lowConfKrRes.data.id;

    await request(baseUrl, 'POST', '/api/okr/checkin/submit', adminToken, {
      key_result_id: lowConfKrId,
      new_value: 40,
      confidence: 'LOW'
    });
    const dbLowConf = queryOne('SELECT status FROM okr_key_results WHERE id = ?', [lowConfKrId]);
    assert(
      dbLowConf.status === 'AT_RISK',
      'Rule 7: KR with LOW confidence auto-sets status to AT_RISK',
      `Status: ${dbLowConf.status}`
    );

    // -------------------------------------------------------------------
    // 11. RBAC & SECURITY VALIDATION
    // -------------------------------------------------------------------
    console.log('\n--- 11. RBAC & SECURITY VALIDATION ---');
    // 11a. Unrelated member Bob blocked from submitting check-in on Alice's KR
    const bobBlockedRes = await request(baseUrl, 'POST', '/api/okr/checkin/submit', bobToken, {
      key_result_id: kr1Id,
      new_value: 80
    });
    assert(
      bobBlockedRes.status === 403 && bobBlockedRes.data?.error?.includes('Forbidden'),
      'RBAC: Unrelated member Bob blocked from submitting check-in on Alice KR (HTTP 403)',
      `Error: "${bobBlockedRes.data?.error}"`
    );

    // 11b. Check-in on ARCHIVED objective rejected (Rule 7)
    const archivedObjRes = await request(baseUrl, 'POST', '/api/okr/objective/create', adminToken, {
      title: 'Archived Deprecated Goal',
      level: 'COMPANY',
      cycle: `Q1-${ts}`
    });
    const archObjId = archivedObjRes.data.id;
    const archKrRes = await request(baseUrl, 'POST', '/api/okr/kr/create', adminToken, {
      objective_id: archObjId,
      title: 'Archived KR',
      target_value: 100
    });
    const archKrId = archKrRes.data.id;

    // Archive the parent objective
    await request(baseUrl, 'PATCH', `/api/okr/objective/${archObjId}/archive`, adminToken);

    // Try checkin on archived objective
    const checkinArchRes = await request(baseUrl, 'POST', '/api/okr/checkin/submit', adminToken, {
      key_result_id: archKrId,
      new_value: 20
    });
    assert(
      checkinArchRes.status === 400 && checkinArchRes.data?.error?.includes('archived'),
      'Rule 7: Check-in on ARCHIVED objective rejected with HTTP 400',
      `Error: "${checkinArchRes.data?.error}"`
    );

    // 11c. Negative value rejected
    const negValRes = await request(baseUrl, 'POST', '/api/okr/checkin/submit', adminToken, {
      key_result_id: kr1Id,
      new_value: -10
    });
    assert(
      negValRes.status === 400 && negValRes.data?.error?.includes('negative'),
      'Validation: Negative check-in value rejected with HTTP 400',
      `Error: "${negValRes.data?.error}"`
    );

    // 11d. Invalid confidence rejected
    const invConfRes = await request(baseUrl, 'POST', '/api/okr/checkin/submit', adminToken, {
      key_result_id: kr1Id,
      new_value: 90,
      confidence: 'SUPER_HIGH'
    });
    assert(
      invConfRes.status === 400 && invConfRes.data?.error?.includes('Invalid confidence'),
      'Validation: Invalid confidence string rejected with HTTP 400',
      `Error: "${invConfRes.data?.error}"`
    );

    // -------------------------------------------------------------------
    // 12. APPEND-ONLY TRIGGER ENFORCEMENT ON okr_checkins
    // -------------------------------------------------------------------
    console.log('\n--- 12. APPEND-ONLY TRIGGER ENFORCEMENT ON okr_checkins ---');
    let checkinUpdateBlocked = false;
    let checkinUpdateErr = '';
    try {
      execute('UPDATE okr_checkins SET new_value = 999 WHERE id = ?', [dbCheckin1.id]);
    } catch (e) {
      checkinUpdateBlocked = true;
      checkinUpdateErr = e.message;
    }
    assert(
      checkinUpdateBlocked && checkinUpdateErr.includes('okr_checkins is append-only'),
      'Trigger prevent_okr_checkin_update: Direct SQLite UPDATE aborted as append-only',
      `Error: "${checkinUpdateErr}"`
    );

    let checkinDeleteBlocked = false;
    let checkinDeleteErr = '';
    try {
      execute('DELETE FROM okr_checkins WHERE id = ?', [dbCheckin1.id]);
    } catch (e) {
      checkinDeleteBlocked = true;
      checkinDeleteErr = e.message;
    }
    assert(
      checkinDeleteBlocked && checkinDeleteErr.includes('okr_checkins is append-only'),
      'Trigger prevent_okr_checkin_delete: Direct SQLite DELETE aborted as append-only',
      `Error: "${checkinDeleteErr}"`
    );

    // -------------------------------------------------------------------
    // 13. AUDIT TRAIL VERIFICATION (Rule 10)
    // -------------------------------------------------------------------
    console.log('\n--- 13. AUDIT TRAIL VERIFICATION (Rule 10) ---');
    const dbHistoryCheckin = queryAll(
      "SELECT * FROM okr_history WHERE entity_type = 'KEY_RESULT' AND entity_id = ? AND field_changed = 'checkin_submitted' ORDER BY id ASC",
      [kr1Id]
    );
    assert(
      dbHistoryCheckin.length >= 2,
      'Rule 10: Auto-logged check-in submissions verified in okr_history',
      `Found ${dbHistoryCheckin.length} audit entries for KR #${kr1Id}`
    );

    // -------------------------------------------------------------------
    // 14. QUERY CHECK-INS API & RULE 8 PRIVACY
    // -------------------------------------------------------------------
    console.log('\n--- 14. GET /api/okr/checkins/:krId & RULE 8 PRIVACY ---');
    // 14a. Alice queries own check-ins
    const aliceCheckinsRes = await request(baseUrl, 'GET', `/api/okr/checkins/${kr1Id}`, aliceToken);
    assert(
      aliceCheckinsRes.status === 200 && Array.isArray(aliceCheckinsRes.data) && aliceCheckinsRes.data.length >= 2,
      'GET /api/okr/checkins/:krId returns chronological array of check-ins',
      `Check-ins Count: ${aliceCheckinsRes.data?.length}`
    );

    // 14b. Bob blocked from viewing Alice's individual KR check-ins (Rule 8)
    const bobCheckinsRes = await request(baseUrl, 'GET', `/api/okr/checkins/${kr1Id}`, bobToken);
    assert(
      bobCheckinsRes.status === 403 && bobCheckinsRes.data?.error?.includes('Forbidden'),
      'Rule 8: Unrelated member Bob forbidden from querying Alice individual KR check-ins (HTTP 403)',
      `Error: "${bobCheckinsRes.data?.error}"`
    );

    // 14c. Admin can view any check-ins
    const adminCheckinsRes = await request(baseUrl, 'GET', `/api/okr/checkins/${kr1Id}`, adminToken);
    assert(
      adminCheckinsRes.status === 200 && adminCheckinsRes.data.length >= 2,
      'Admin can query check-ins for any Key Result (HTTP 200)',
      `Admin retrieved ${adminCheckinsRes.data.length} check-ins`
    );

    // -------------------------------------------------------------------
    // 15. OKR DASHBOARD SUMMARY ENDPOINT
    // -------------------------------------------------------------------
    console.log('\n--- 15. GET /api/okr/dashboard SUMMARY & HEALTH SCORE ---');
    const dashboardRes = await request(baseUrl, 'GET', `/api/okr/dashboard?cycle=Q1-${ts}`, aliceToken);
    assert(
      dashboardRes.status === 200 && dashboardRes.data?.summary && typeof dashboardRes.data?.health_score === 'number',
      'GET /api/okr/dashboard returns comprehensive overview & health score',
      `Cycle: ${dashboardRes.data?.cycle}, Health Score: ${dashboardRes.data?.health_score}%, Company OKRs: ${dashboardRes.data?.summary?.total_company}`
    );

    console.log('\n===================================================================');
    console.log(`  VERIFICATION RESULT: ${passedTests}/${totalTests} TESTS PASSED`);
    if (failedTests === 0) {
      console.log('  🎉 LAYER 4 INTEGRITY VERIFIED: Check-ins, Recalculation & Bottom-Up Rollup 100% operational');
    } else {
      console.error(`  ⚠️ ${failedTests} TESTS FAILED`);
    }
    console.log('===================================================================\n');

  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('Test Suite encountered unhandled fatal error:', err);
  process.exit(1);
});
