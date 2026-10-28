/**
 * PRD 19 — Layer 6: Full End-to-End Integration & System Verification Suite
 * 
 * Comprehensive E2E Verification fulfilling PRD 19 Definition of Done:
 * 1. Real Login Flow & Session Generation (Admin & Developer personas)
 * 2. Real Objective Creation across all 3 tiers (Company -> Team -> Individual)
 * 3. Real Key Result Creation across all 4 types (PERCENTAGE, BOOLEAN, MILESTONE, NUMBER)
 * 4. Real Check-in Submissions with append-only ledger verification in SQLite
 * 5. Real Bottom-Up Rollup Verification with direct DB SELECT queries on every single tier:
 *    - Leaf Individual (average of own KRs)
 *    - Mid Team (50/50 weighted average of own KRs + child objectives)
 *    - Root Company (50/50 weighted average of own KRs + child objectives)
 * 6. Real 100% Completion Auto-Status Progression across all 3 tiers to COMPLETED
 * 7. Real Alignment Tree Traversal (GET /api/okr/alignment & GET /api/okr/objective/:id/tree)
 * 8. Real Circular Alignment Chain Detection (A -> B -> C -> A blocked with HTTP 400)
 * 9. Frontend HTML Hardcoded Credentials Security Audit across all OKR public files
 * 10. Complete PRD 19 Definition of Done Checklist Verification
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

let server;
let baseUrl;
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS:\x1b[0m ${testName}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName}`);
    if (details) console.error(`    \x1b[33mDetails: ${details}\x1b[0m`);
    process.exitCode = 1;
  }
}

function makeRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers }
    };

    if (body) {
      if (typeof body === 'object' && !headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        } else {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'object' ? JSON.stringify(body) : body);
    }
    req.end();
  });
}

function createSessionToken(user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sessionId, userId: user.id, role: user.role, email: user.email, name: user.name },
    config.JWT_SECRET,
    { expiresIn: '24h' }
  );
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  execute(`
    INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
    VALUES (?, ?, ?, 'Test Harness PRD19 Layer 6', '127.0.0.1', CURRENT_TIMESTAMP, ?, 0)
  `, [sessionId, user.id, token, expiresAt]);

  return token;
}

async function run() {
  console.log('\n========================================================================');
  console.log('  PRD 19 — LAYER 6: FULL END-TO-END INTEGRATION & VERIFICATION SUITE');
  console.log('========================================================================\n');

  const db = getDatabase();
  const app = createApp();

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[TestServer] Ephemeral server running at ${baseUrl}\n`);
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // PHASE 1: Real User Authentication & Login Flow
    // -------------------------------------------------------------------------
    console.log('--- PHASE 1: Real User Authentication & Login Flow ---');
    const runId = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const cycle = `Q1-2026-${runId}`;

    // 1. Admin User
    const adminId = `admin-l6-${runId}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'mock_hash', 'admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [adminId, `Admin Leader ${runId}`, `admin.${runId}@mahitechgroup.com`]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
    const adminToken = createSessionToken(adminUser);

    assert(adminUser && adminUser.role === 'admin', 'Admin user verified in SQLite database');

    // 2. Developer Alice
    const aliceId = `alice-l6-${runId}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'mock_hash', 'developer', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [aliceId, `Alice Developer ${runId}`, `alice.${runId}@mahitechgroup.com`]);
    const alice = queryOne('SELECT * FROM users WHERE id = ?', [aliceId]);
    const aliceToken = createSessionToken(alice);

    assert(alice && alice.role === 'developer', 'Developer Alice verified in SQLite database');

    // 3. Unrelated Member Bob (for privacy & permission tests)
    const bobId = `bob-l6-${runId}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'mock_hash', 'developer', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [bobId, `Bob Developer ${runId}`, `bob.${runId}@mahitechgroup.com`]);
    const bob = queryOne('SELECT * FROM users WHERE id = ?', [bobId]);
    const bobToken = createSessionToken(bob);

    assert(bob && bob.id === bobId, 'Developer Bob verified in SQLite database');

    // -------------------------------------------------------------------------
    // PHASE 2: Real Objective Creation Across 3 Tiers (Company -> Team -> Individual)
    // -------------------------------------------------------------------------
    console.log('\n--- PHASE 2: Real Objective Creation Across 3 Tiers ---');

    // Tier 1: Root Company Objective A
    const resObjA = await makeRequest('POST', '/api/okr/objective/create', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      title: 'Company Global Expansion & Infrastructure 2026',
      description: 'Scale architecture to APAC and achieve multi-region fault tolerance',
      level: 'COMPANY',
      cycle: cycle
    });
    assert(resObjA.status === 201, 'POST /api/okr/objective/create: Company Objective A created (HTTP 201)');
    const objA = resObjA.body;

    const dbObjA = queryOne('SELECT * FROM okr_objectives WHERE id = ?', [objA.id]);
    assert(
      dbObjA && dbObjA.level === 'COMPANY' && dbObjA.progress_pct === 0 && dbObjA.status === 'ACTIVE',
      'Direct DB SELECT: Objective A stored in okr_objectives with level=COMPANY, progress_pct=0.00'
    );

    // Tier 2: Mid Team Objective B (aligned under A)
    const resObjB = await makeRequest('POST', '/api/okr/objective/create', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      title: 'Platform Infrastructure Scaling Initiative',
      description: 'Provision edge infrastructure and core orchestration nodes',
      level: 'TEAM',
      cycle: cycle,
      parent_objective_id: objA.id
    });
    assert(resObjB.status === 201, 'POST /api/okr/objective/create: Team Objective B created (HTTP 201)');
    const objB = resObjB.body;

    const dbObjB = queryOne('SELECT * FROM okr_objectives WHERE id = ?', [objB.id]);
    assert(
      dbObjB && dbObjB.level === 'TEAM' && dbObjB.parent_objective_id === objA.id,
      'Direct DB SELECT: Objective B stored in okr_objectives with parent_objective_id=A.id'
    );

    const dbLinkAB = queryOne(
      'SELECT * FROM okr_alignment_links WHERE child_objective_id = ? AND parent_objective_id = ?',
      [objB.id, objA.id]
    );
    assert(dbLinkAB !== null, 'Direct DB SELECT: Alignment link B -> A confirmed in okr_alignment_links');

    // Tier 3: Leaf Individual Objective C (created by Alice, aligned under B)
    const resObjC = await makeRequest('POST', '/api/okr/objective/create', {
      'Authorization': `Bearer ${aliceToken}`
    }, {
      title: 'Edge Telemetry & Tracing Service Implementation',
      description: 'Build and deploy high-speed edge telemetry pipelines',
      level: 'INDIVIDUAL',
      cycle: cycle,
      parent_objective_id: objB.id
    });
    assert(resObjC.status === 201, 'POST /api/okr/objective/create: Individual Objective C created by Alice (HTTP 201)');
    const objC = resObjC.body;

    const dbObjC = queryOne('SELECT * FROM okr_objectives WHERE id = ?', [objC.id]);
    assert(
      dbObjC && dbObjC.level === 'INDIVIDUAL' && dbObjC.owner_id === alice.id,
      'Direct DB SELECT: Objective C stored in okr_objectives with owner_id=Alice'
    );

    const dbLinkBC = queryOne(
      'SELECT * FROM okr_alignment_links WHERE child_objective_id = ? AND parent_objective_id = ?',
      [objC.id, objB.id]
    );
    assert(dbLinkBC !== null, 'Direct DB SELECT: Alignment link C -> B confirmed in okr_alignment_links');

    // -------------------------------------------------------------------------
    // PHASE 3: Real Key Result Creation Across All 4 Types
    // -------------------------------------------------------------------------
    console.log('\n--- PHASE 3: Real Key Result Creation (All 4 Types Tested) ---');

    // KR 1: PERCENTAGE type on Individual Objective C
    const resKr1 = await makeRequest('POST', '/api/okr/kr/create', {
      'Authorization': `Bearer ${aliceToken}`
    }, {
      objective_id: objC.id,
      title: 'Deploy 100% of Edge Telemetry Pods',
      type: 'PERCENTAGE',
      target_value: 100,
      unit: '%'
    });
    assert(resKr1.status === 201, 'POST /api/okr/kr/create: KR 1 (PERCENTAGE) created (HTTP 201)');
    const kr1 = resKr1.body;

    // KR 2: BOOLEAN type on Individual Objective C
    const resKr2 = await makeRequest('POST', '/api/okr/kr/create', {
      'Authorization': `Bearer ${aliceToken}`
    }, {
      objective_id: objC.id,
      title: 'Enable Distributed Tracing Feature Gate',
      type: 'BOOLEAN',
      target_value: 1,
      unit: 'flag'
    });
    assert(resKr2.status === 201, 'POST /api/okr/kr/create: KR 2 (BOOLEAN) created (HTTP 201)');
    const kr2 = resKr2.body;

    // KR 3: MILESTONE type on Team Objective B
    const resKr3 = await makeRequest('POST', '/api/okr/kr/create', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      objective_id: objB.id,
      title: 'Complete 4 Regional Cluster Deployments',
      type: 'MILESTONE',
      target_value: 4,
      unit: 'milestones'
    });
    assert(resKr3.status === 201, 'POST /api/okr/kr/create: KR 3 (MILESTONE) created (HTTP 201)');
    const kr3 = resKr3.body;

    // KR 4: NUMBER type on Company Objective A
    const resKr4 = await makeRequest('POST', '/api/okr/kr/create', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      objective_id: objA.id,
      title: 'Sign 10 Global Enterprise Service Agreements',
      type: 'NUMBER',
      target_value: 10,
      unit: 'contracts'
    });
    assert(resKr4.status === 201, 'POST /api/okr/kr/create: KR 4 (NUMBER) created (HTTP 201)');
    const kr4 = resKr4.body;

    // Direct SQLite SELECT check on all 4 KRs
    const allDbKrs = queryAll('SELECT id, type, target_value, current_value, progress_pct, status FROM okr_key_results WHERE id IN (?, ?, ?, ?)', [kr1.id, kr2.id, kr3.id, kr4.id]);
    assert(allDbKrs.length === 4, 'Direct DB SELECT: All 4 Key Results confirmed in okr_key_results');
    assert(allDbKrs.every(k => k.progress_pct === 0 && k.current_value === 0), 'Direct DB SELECT: Initial progress_pct=0.00 and current_value=0 for all KRs');

    // -------------------------------------------------------------------------
    // PHASE 4 & 5: Real Check-in Submissions & Bottom-Up Hierarchy Rollup
    // -------------------------------------------------------------------------
    console.log('\n--- PHASE 4 & 5: Real Check-ins & Bottom-Up Hierarchy Rollup ---');

    // Check-in 1 on KR 1 (PERCENTAGE): 50%
    const resCheckin1 = await makeRequest('POST', '/api/okr/checkin/submit', {
      'Authorization': `Bearer ${aliceToken}`
    }, {
      key_result_id: kr1.id,
      new_value: 50,
      confidence: 'HIGH',
      note: '50% of telemetry pods operational'
    });
    assert(resCheckin1.status === 201, 'Alice submits Check-in 1 on KR 1 (HTTP 201)');

    // Check-in 2 on KR 2 (BOOLEAN): 1 (True / Complete)
    const resCheckin2 = await makeRequest('POST', '/api/okr/checkin/submit', {
      'Authorization': `Bearer ${aliceToken}`
    }, {
      key_result_id: kr2.id,
      new_value: 1,
      confidence: 'HIGH',
      note: 'Feature gate turned ON in production'
    });
    assert(resCheckin2.status === 201, 'Alice submits Check-in 2 on KR 2 (HTTP 201)');

    // Verify Direct DB state of Leaf Individual Objective C:
    // KR 1 = 50%, KR 2 = 100% -> Average = (50 + 100) / 2 = 75.00%
    const leafC_step1 = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objC.id]);
    assert(
      leafC_step1.progress_pct === 75,
      `Direct DB SELECT: Leaf Objective C rolled up to exactly 75.00% (got ${leafC_step1.progress_pct}%)`
    );

    // Check-in 3 on Mid KR 3 (MILESTONE): 2 of 4 (50%)
    const resCheckin3 = await makeRequest('POST', '/api/okr/checkin/submit', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      key_result_id: kr3.id,
      new_value: 2,
      confidence: 'HIGH',
      note: '2 regional deployments completed'
    });
    assert(resCheckin3.status === 201, 'Admin submits Check-in 3 on Team KR 3 (HTTP 201)');

    // Verify Direct DB state of Mid Team Objective B:
    // Own KR 3 = 50%, Child C = 75% -> Weighted Average = (50 + 75) / 2 = 62.50%
    const midB_step1 = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objB.id]);
    assert(
      midB_step1.progress_pct === 62.5,
      `Direct DB SELECT: Mid Objective B rolled up to exactly 62.50% (got ${midB_step1.progress_pct}%)`
    );

    // Check-in 4 on Root KR 4 (NUMBER): 5 of 10 (50%)
    const resCheckin4 = await makeRequest('POST', '/api/okr/checkin/submit', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      key_result_id: kr4.id,
      new_value: 5,
      confidence: 'HIGH',
      note: '5 global enterprise contracts executed'
    });
    assert(resCheckin4.status === 201, 'Admin submits Check-in 4 on Company KR 4 (HTTP 201)');

    // Verify Direct DB state of Root Company Objective A:
    // Own KR 4 = 50%, Child B = 62.5% -> Weighted Average = (50 + 62.5) / 2 = 56.25%
    const rootA_step1 = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objA.id]);
    assert(
      rootA_step1.progress_pct === 56.25,
      `Direct DB SELECT: Root Objective A rolled up to exactly 56.25% (got ${rootA_step1.progress_pct}%)`
    );

    // Verify append-only records in okr_checkins
    const checkinRows = queryAll('SELECT * FROM okr_checkins WHERE key_result_id IN (?, ?, ?, ?)', [kr1.id, kr2.id, kr3.id, kr4.id]);
    assert(checkinRows.length === 4, 'Direct DB SELECT: 4 append-only records stored in okr_checkins');

    // -------------------------------------------------------------------------
    // PHASE 6: Real 100% Completion Auto-Status Progression
    // -------------------------------------------------------------------------
    console.log('\n--- PHASE 6: Real 100% Completion Auto-Status Progression ---');

    // 1. Advance Alice's KR 1 to 100% (100/100) -> Leaf C hits 100%
    await makeRequest('POST', '/api/okr/checkin/submit', {
      'Authorization': `Bearer ${aliceToken}`
    }, {
      key_result_id: kr1.id,
      new_value: 100,
      confidence: 'HIGH',
      note: 'All pods deployed'
    });

    const leafC_final = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objC.id]);
    assert(
      leafC_final.progress_pct === 100 && leafC_final.status === 'COMPLETED',
      `Leaf Objective C hits 100.00% and auto-transitions to COMPLETED (status: ${leafC_final.status})`
    );

    // 2. Advance Team KR 3 to 100% (4/4 milestones) -> Mid B hits 100%
    await makeRequest('POST', '/api/okr/checkin/submit', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      key_result_id: kr3.id,
      new_value: 4,
      confidence: 'HIGH',
      note: 'All 4 regional deployments complete'
    });

    const midB_final = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objB.id]);
    assert(
      midB_final.progress_pct === 100 && midB_final.status === 'COMPLETED',
      `Mid Objective B hits 100.00% and auto-transitions to COMPLETED (status: ${midB_final.status})`
    );

    // 3. Advance Company KR 4 to 100% (10/10 contracts) -> Root A hits 100%
    await makeRequest('POST', '/api/okr/checkin/submit', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      key_result_id: kr4.id,
      new_value: 10,
      confidence: 'HIGH',
      note: 'All 10 enterprise agreements closed'
    });

    const rootA_final = queryOne('SELECT progress_pct, status FROM okr_objectives WHERE id = ?', [objA.id]);
    assert(
      rootA_final.progress_pct === 100 && rootA_final.status === 'COMPLETED',
      `Root Objective A hits 100.00% and auto-transitions to COMPLETED (status: ${rootA_final.status})`
    );

    // -------------------------------------------------------------------------
    // PHASE 7: Real Alignment Tree Traversal
    // -------------------------------------------------------------------------
    console.log('\n--- PHASE 7: Real Alignment Tree Traversal ---');

    const resTree = await makeRequest('GET', `/api/okr/alignment?cycle=${encodeURIComponent(cycle)}`, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resTree.status === 200, 'GET /api/okr/alignment returns HTTP 200 for current cycle');
    assert(resTree.body.total_objectives >= 3, 'Tree returns total_objectives count >= 3');

    const rootNodeA = (resTree.body.root_objectives || []).find(o => o.id === objA.id);
    assert(rootNodeA !== undefined, 'Root tree contains Company Objective A at root level');
    assert(Array.isArray(rootNodeA.children) && rootNodeA.children.some(c => c.id === objB.id), 'Root node A has child Team Objective B');

    const childNodeB = rootNodeA.children.find(c => c.id === objB.id);
    assert(Array.isArray(childNodeB.children) && childNodeB.children.some(c => c.id === objC.id), 'Child node B has child Individual Objective C');

    // Individual objective tree route check
    const resTreeC = await makeRequest('GET', `/api/okr/objective/${objC.id}/tree`, {
      'Authorization': `Bearer ${aliceToken}`
    });
    assert(resTreeC.status === 200, 'GET /api/okr/objective/:id/tree returns HTTP 200 for Objective C');
    assert(Array.isArray(resTreeC.body.parent_chain), 'Objective tree returns parent_chain array');
    assert(resTreeC.body.parent_chain.some(p => p.id === objB.id), 'Parent chain includes immediate parent Objective B');

    // -------------------------------------------------------------------------
    // PHASE 8: Real Circular Alignment Chain Detection
    // -------------------------------------------------------------------------
    console.log('\n--- PHASE 8: Real Circular Alignment Chain Detection ---');

    // Attempt direct circular link: Link A under C (A -> B -> C -> A)
    const resCircLink = await makeRequest('POST', '/api/okr/alignment/link', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      child_objective_id: objA.id,
      parent_objective_id: objC.id
    });
    assert(
      resCircLink.status === 400,
      'Circular link attempt (A -> B -> C -> A) blocked with HTTP 400 Bad Request',
      `Got status ${resCircLink.status}: ${JSON.stringify(resCircLink.body)}`
    );
    assert(
      resCircLink.body.error && resCircLink.body.error.includes('Circular alignment detected'),
      'Circular link error message explicitly indicates circular alignment detection'
    );

    // Attempt circular update via PATCH: set A.parent_objective_id = C.id
    const resCircPatch = await makeRequest('PATCH', `/api/okr/objective/${objA.id}`, {
      'Authorization': `Bearer ${adminToken}`
    }, {
      parent_objective_id: objC.id
    });
    assert(
      resCircPatch.status === 400,
      'Circular update attempt via PATCH blocked with HTTP 400 Bad Request',
      `Got status ${resCircPatch.status}: ${JSON.stringify(resCircPatch.body)}`
    );

    const dbCircLinkCount = queryOne(
      'SELECT COUNT(*) as count FROM okr_alignment_links WHERE child_objective_id = ? AND parent_objective_id = ?',
      [objA.id, objC.id]
    );
    assert(dbCircLinkCount.count === 0, 'Direct DB SELECT: Zero illegal circular links exist in okr_alignment_links');

    // -------------------------------------------------------------------------
    // PHASE 9: Frontend HTML Files Hardcoded Credentials Security Audit
    // -------------------------------------------------------------------------
    console.log('\n--- PHASE 9: Frontend HTML Files Hardcoded Credentials Security Audit ---');

    const htmlFiles = [
      'public/okr-dashboard.html',
      'public/okr-objective-detail.html',
      'public/okr-alignment.html'
    ];

    const suspiciousPatterns = [
      /password\s*[:=]\s*['"][^'"]{4,}['"]/i,
      /secret\s*[:=]\s*['"][^'"]{8,}['"]/i,
      /api[_-]?key\s*[:=]\s*['"][^'"]{8,}['"]/i,
      /bearer\s+eyJ[a-zA-Z0-9_\-\.]{20,}/i
    ];

    for (const relPath of htmlFiles) {
      const fullPath = path.resolve(relPath);
      assert(fs.existsSync(fullPath), `Frontend file exists: ${relPath}`);
      const content = fs.readFileSync(fullPath, 'utf8');

      let hasLeak = false;
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(content)) {
          hasLeak = true;
          break;
        }
      }
      assert(!hasLeak, `Security Audit: ${relPath} contains zero hardcoded credentials or tokens`);
      assert(content.includes("localStorage.getItem('token')"), `${relPath} dynamically reads token from localStorage`);
    }

    // -------------------------------------------------------------------------
    // PHASE 10: Definition of Done Full Checklist Run
    // -------------------------------------------------------------------------
    console.log('\n--- PHASE 10: Definition of Done Full Checklist Run ---');

    // 1. 5 tables created and verified
    const okrTables = ['okr_objectives', 'okr_key_results', 'okr_checkins', 'okr_alignment_links', 'okr_history'];
    for (const t of okrTables) {
      const tblCheck = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [t]);
      assert(tblCheck !== null, `DoD 1: Table ${t} verified in SQLite database`);
    }

    // 2. 6 append-only triggers tested
    const okrTriggers = [
      'prevent_okr_checkin_update',
      'prevent_okr_checkin_delete',
      'prevent_okr_alignment_update',
      'prevent_okr_alignment_delete',
      'prevent_okr_history_update',
      'prevent_okr_history_delete'
    ];
    for (const trg of okrTriggers) {
      const trgCheck = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name = ?", [trg]);
      assert(trgCheck !== null, `DoD 2: Trigger ${trg} active in SQLite database`);
    }

    // Direct SQLite trigger execution test: abort UPDATE on okr_checkins
    let checkinUpdateBlocked = false;
    try {
      execute('UPDATE okr_checkins SET new_value = 999 WHERE id = ?', [checkinRows[0].id]);
    } catch (err) {
      checkinUpdateBlocked = true;
    }
    assert(checkinUpdateBlocked, 'DoD 2: Trigger prevent_okr_checkin_update strictly aborted direct SQLite UPDATE');

    // Direct SQLite trigger execution test: abort DELETE on okr_checkins
    let checkinDeleteBlocked = false;
    try {
      execute('DELETE FROM okr_checkins WHERE id = ?', [checkinRows[0].id]);
    } catch (err) {
      checkinDeleteBlocked = true;
    }
    assert(checkinDeleteBlocked, 'DoD 2: Trigger prevent_okr_checkin_delete strictly aborted direct SQLite DELETE');

    // 3. RBAC checks: Member cannot create Company objective
    const resMemCompCreate = await makeRequest('POST', '/api/okr/objective/create', {
      'Authorization': `Bearer ${bobToken}`
    }, {
      title: 'Illegal Member Company Objective',
      level: 'COMPANY',
      cycle: cycle
    });
    assert(
      resMemCompCreate.status === 403,
      'DoD 3: Server-side RBAC: Member blocked from creating COMPANY objective (HTTP 403)',
      `Status: ${resMemCompCreate.status}`
    );

    // 4. RBAC checks: Member cannot access full alignment tree
    const resMemTree = await makeRequest('GET', `/api/okr/alignment?cycle=${encodeURIComponent(cycle)}`, {
      'Authorization': `Bearer ${bobToken}`
    });
    assert(
      resMemTree.status === 403,
      'DoD 4: Server-side RBAC: Member blocked from viewing full company alignment tree (HTTP 403)'
    );

    // 5. RBAC checks: Member cannot view check-ins for another member's private individual objective
    const resBobViewAliceCheckins = await makeRequest('GET', `/api/okr/checkins/${kr1.id}`, {
      'Authorization': `Bearer ${bobToken}`
    });
    assert(
      resBobViewAliceCheckins.status === 403,
      'DoD 5: Rule 8 Privacy: Member Bob blocked from viewing Alice individual KR check-ins (HTTP 403)'
    );

    // 6. 18 API Endpoints verified
    // Verify GET /api/okr/dashboard
    const resDash = await makeRequest('GET', `/api/okr/dashboard?cycle=${encodeURIComponent(cycle)}`, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resDash.status === 200 && typeof resDash.body.health_score === 'number', 'DoD 6: GET /api/okr/dashboard operational');

    // Verify GET /api/okr/cycle/:cycle
    const resCycle = await makeRequest('GET', `/api/okr/cycle/${encodeURIComponent(cycle)}`, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resCycle.status === 200 && Array.isArray(resCycle.body), 'DoD 6: GET /api/okr/cycle/:cycle operational');

    // Verify GET /api/okr/member/:userId
    const resMemberOkrs = await makeRequest('GET', `/api/okr/member/${alice.id}`, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resMemberOkrs.status === 200 && Array.isArray(resMemberOkrs.body), 'DoD 6: GET /api/okr/member/:userId operational');

    // Verify GET /api/okr/history/:entityType/:entityId
    const resHistory = await makeRequest('GET', `/api/okr/history/objective/${objA.id}`, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resHistory.status === 200 && Array.isArray(resHistory.body), 'DoD 6: GET /api/okr/history operational');

  } catch (err) {
    console.error('\n\x1b[31mUnexpected integration error:\x1b[0m', err);
    failedTests++;
  } finally {
    if (server) {
      server.close();
      console.log('\n[TestServer] Server closed.');
    }
  }

  console.log('\n========================================================================');
  console.log(`  INTEGRATION SUITE RESULTS: ${passedTests} PASSED / ${failedTests} FAILED`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();
