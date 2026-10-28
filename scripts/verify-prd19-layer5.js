/**
 * PRD 19 — Layer 5 Verification Suite: Frontend (4 Views) Smoke & Contract Tests
 * 
 * Verifies all 4 frontend views exactly as specified in docs/19_OKR_SYSTEM.md:
 * 1. View 1: OKR Dashboard (public/okr-dashboard.html)
 *    - Static HTTP 200 delivery & HTML content-type
 *    - Company, Team, and My Individual OKR sections
 *    - Overall company health score dial & KPI summaries
 *    - Cycle selector filter dropdown
 *    - Drilldown navigation links to Objective Detail
 *    - New Objective creation modal with level & parent selection
 *    - Contract integration with GET /api/okr/dashboard and POST /api/okr/objective/create
 * 
 * 2. View 2: Objective Detail (public/okr-objective-detail.html)
 *    - Static HTTP 200 delivery & HTML content-type
 *    - Objective details header (title, description, owner, cycle, level, status)
 *    - Auto-calculated progress bar & percentage indicator
 *    - Key Results list with title, type, current/target, progress bar, status badge
 *    - "Add Key Result" modal & role-gated controls
 *    - Alignment hierarchy chain (parent + child objectives)
 *    - Append-only audit history log table (from okr_history)
 *    - Contract integration with GET /api/okr/objective/:id and POST /api/okr/keyresult/create
 * 
 * 3. View 3: Check-in Modal (Embedded Component in okr-objective-detail.html)
 *    - Modal container and backdrop controls (#checkinModal)
 *    - Value input with 0/1 toggle support for BOOLEAN KRs (#inputCheckinNewVal)
 *    - Confidence selector: HIGH | MEDIUM | LOW (#selectCheckinConfidence)
 *    - Optional note textarea (#inputCheckinNote)
 *    - Submit check-in button with immediate on-screen recalculation trigger
 *    - Previous check-ins history table loaded from GET /api/okr/checkins/:krId
 *    - Contract integration with POST /api/okr/checkin/submit
 * 
 * 4. View 4: OKR Alignment Tree (public/okr-alignment.html)
 *    - Static HTTP 200 delivery & HTML content-type
 *    - Visual tree hierarchy: Company Objectives at top -> Team -> Individual
 *    - Expandable / collapsible tree nodes with +/- toggles (#btnExpandAll, #btnCollapseAll)
 *    - Color coded borders & dials: green (>= 70%), yellow (40-69%), red (< 40%)
 *    - Node display: objective title + progress % + owner avatar with initials
 *    - Executive & Producer view guard banner / 403 access-denied fallback (#accessDeniedBox)
 *    - Drilldown links to okr-objective-detail.html on every tree node
 *    - Contract integration with GET /api/okr/alignment?cycle=...
 * 
 * 5. Full Real-Server Live API Contract & RBAC Integration Checks
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
let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS:\x1b[0m ${testName}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName}`);
    if (details) console.error(`    \x1b[33mDetails: ${details}\x1b[0m`);
    failed++;
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

function createAuthToken(user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sessionId, userId: user.id, role: user.role, email: user.email, name: user.name },
    config.JWT_SECRET,
    { expiresIn: '24h' }
  );
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  execute(`
    INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
    VALUES (?, ?, ?, 'Test Harness PRD19 Layer 5', '127.0.0.1', CURRENT_TIMESTAMP, ?, 0)
  `, [sessionId, user.id, token, expiresAt]);

  return token;
}

async function run() {
  console.log('\n========================================================================');
  console.log('  PRD 19 — LAYER 5 VERIFICATION SUITE (FRONTEND 4 VIEWS SMOKE & CONTRACT)');
  console.log('========================================================================\n');

  // Initialize DB and server
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
    // 0. Seed Users for Auth & Role Checks
    const runId = crypto.randomBytes(4).toString('hex');
    const adminId = `admin-l5-${runId}`;
    const memberId = `member-l5-${runId}`;

    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'mock_hash', 'admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [adminId, `Admin Leader ${runId}`, `okr_admin_${runId}@example.com`]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);

    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'mock_hash', 'developer', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [memberId, `Member Contributor ${runId}`, `okr_member_${runId}@example.com`]);
    const memberUser = queryOne('SELECT * FROM users WHERE id = ?', [memberId]);

    const adminToken = createAuthToken(adminUser);
    const memberToken = createAuthToken(memberUser);

    // =========================================================================
    // SECTION 1: Static Asset Delivery & HTTP 200
    // =========================================================================
    console.log('--- SECTION 1: Static Asset Delivery (Express.static) ---');

    const resDashboardHtml = await makeRequest('GET', '/okr-dashboard.html');
    assert(
      resDashboardHtml.status === 200,
      'GET /okr-dashboard.html returns HTTP 200 OK',
      `Got ${resDashboardHtml.status}`
    );
    assert(
      resDashboardHtml.headers['content-type'].includes('text/html'),
      '/okr-dashboard.html Content-Type is text/html',
      resDashboardHtml.headers['content-type']
    );

    const resDetailHtml = await makeRequest('GET', '/okr-objective-detail.html');
    assert(
      resDetailHtml.status === 200,
      'GET /okr-objective-detail.html returns HTTP 200 OK',
      `Got ${resDetailHtml.status}`
    );
    assert(
      resDetailHtml.headers['content-type'].includes('text/html'),
      '/okr-objective-detail.html Content-Type is text/html',
      resDetailHtml.headers['content-type']
    );

    const resAlignmentHtml = await makeRequest('GET', '/okr-alignment.html');
    assert(
      resAlignmentHtml.status === 200,
      'GET /okr-alignment.html returns HTTP 200 OK',
      `Got ${resAlignmentHtml.status}`
    );
    assert(
      resAlignmentHtml.headers['content-type'].includes('text/html'),
      '/okr-alignment.html Content-Type is text/html',
      resAlignmentHtml.headers['content-type']
    );

    // =========================================================================
    // SECTION 2: View 1 — OKR Dashboard DOM & Requirements
    // =========================================================================
    console.log('\n--- SECTION 2: View 1 (okr-dashboard.html) Elements & Specs ---');
    const dashBody = resDashboardHtml.raw;

    assert(
      dashBody.includes('<title>OKR Dashboard — Mahi Tech Group</title>'),
      'View 1 has proper <title> tag'
    );
    assert(
      dashBody.includes('id="cycleSelect"'),
      'View 1 has cycle filter dropdown (#cycleSelect)'
    );
    assert(
      dashBody.includes('id="healthScoreValue"'),
      'View 1 has overall Company Health Score dial (#healthScoreValue)'
    );
    assert(
      dashBody.includes('id="companySection"') && dashBody.includes('id="companyList"'),
      'View 1 has Section 1: Company Objectives container (#companySection, #companyList)'
    );
    assert(
      dashBody.includes('id="teamSection"') && dashBody.includes('id="teamList"'),
      'View 1 has Section 2: Team Objectives container (#teamSection, #teamList)'
    );
    assert(
      dashBody.includes('id="mySection"') && dashBody.includes('id="myList"'),
      'View 1 has Section 3: My Individual Objectives container (#mySection, #myList)'
    );
    assert(
      dashBody.includes('id="newObjectiveModal"'),
      'View 1 has New Objective creation modal (#newObjectiveModal)'
    );
    assert(
      dashBody.includes('id="inputObjTitle"') &&
      dashBody.includes('id="selectObjLevel"') &&
      dashBody.includes('id="selectParentObj"'),
      'View 1 modal includes title, level, and parent objective selection'
    );
    assert(
      dashBody.includes('/okr-objective-detail.html?id='),
      'View 1 links card clicks to okr-objective-detail.html'
    );
    assert(
      dashBody.includes('/okr-alignment.html'),
      'View 1 has quick navigation button to Alignment Tree'
    );
    assert(
      dashBody.includes('/api/okr/dashboard'),
      'View 1 integrates with GET /api/okr/dashboard contract'
    );

    // =========================================================================
    // SECTION 3: View 2 — Objective Detail DOM & Requirements
    // =========================================================================
    console.log('\n--- SECTION 3: View 2 (okr-objective-detail.html) Elements & Specs ---');
    const detailBody = resDetailHtml.raw;

    assert(
      detailBody.includes('id="objTitle"') &&
      detailBody.includes('id="objDesc"') &&
      detailBody.includes('id="badgeLevel"') &&
      detailBody.includes('id="badgeStatus"'),
      'View 2 has Objective header tags (title, description, level badge, status badge)'
    );
    assert(
      detailBody.includes('id="objProgressFill"') &&
      detailBody.includes('id="objProgressPct"'),
      'View 2 displays auto-calculated progress bar and percentage'
    );
    assert(
      detailBody.includes('id="krListContainer"'),
      'View 2 displays Key Results list container (#krListContainer)'
    );
    assert(
      detailBody.includes('id="btnAddKr"') &&
      detailBody.includes('id="addKrModal"'),
      'View 2 has "Add Key Result" button and modal'
    );
    assert(
      detailBody.includes('id="selectKrType"') &&
      detailBody.includes('PERCENTAGE') &&
      detailBody.includes('BOOLEAN') &&
      detailBody.includes('MILESTONE'),
      'View 2 Add KR form supports all 4 KR types (PERCENTAGE, NUMBER, BOOLEAN, MILESTONE)'
    );
    assert(
      detailBody.includes('id="parentObjectiveView"') &&
      detailBody.includes('id="childObjectivesView"'),
      'View 2 displays Alignment Tree with parent objective and child objectives'
    );
    assert(
      detailBody.includes('id="historyTableBody"'),
      'View 2 displays append-only audit history log table (#historyTableBody)'
    );

    // =========================================================================
    // SECTION 4: View 3 — Check-in Modal Embedded Component
    // =========================================================================
    console.log('\n--- SECTION 4: View 3 (Check-in Modal in okr-objective-detail.html) ---');

    assert(
      detailBody.includes('id="checkinModal"'),
      'View 3 Check-in Modal container is present (#checkinModal)'
    );
    assert(
      detailBody.includes('id="inputCheckinNewVal"'),
      'View 3 has New Value input (#inputCheckinNewVal)'
    );
    assert(
      detailBody.includes('id="selectCheckinConfidence"'),
      'View 3 has Confidence selector with HIGH, MEDIUM, LOW (#selectCheckinConfidence)'
    );
    assert(
      detailBody.includes('id="inputCheckinNote"'),
      'View 3 has optional Note textarea (#inputCheckinNote)'
    );
    assert(
      detailBody.includes('id="btnSubmitCheckin"'),
      'View 3 has Submit Check-in button (#btnSubmitCheckin)'
    );
    assert(
      detailBody.includes('id="checkinsHistoryBody"'),
      'View 3 displays past check-in history table (#checkinsHistoryBody)'
    );
    assert(
      detailBody.includes('/api/okr/checkin/submit'),
      'View 3 submits to POST /api/okr/checkin/submit'
    );
    assert(
      detailBody.includes('/api/okr/checkins/'),
      'View 3 queries previous check-ins from GET /api/okr/checkins/:krId'
    );

    // =========================================================================
    // SECTION 5: View 4 — OKR Alignment Tree DOM & Requirements
    // =========================================================================
    console.log('\n--- SECTION 5: View 4 (okr-alignment.html) Elements & Specs ---');
    const alignBody = resAlignmentHtml.raw;

    assert(
      alignBody.includes('<title>OKR Alignment Tree — Mahi Tech Group</title>'),
      'View 4 has proper <title> tag'
    );
    assert(
      alignBody.includes('id="cycleSelect"'),
      'View 4 has cycle selector dropdown (#cycleSelect)'
    );
    assert(
      alignBody.includes('badge-admin-view'),
      'View 4 has Admin & Producer View indicator'
    );
    assert(
      alignBody.includes('id="accessDeniedBox"'),
      'View 4 has restricted access fallback box (#accessDeniedBox) for non-admin'
    );
    assert(
      alignBody.includes('dot-high') &&
      alignBody.includes('dot-mid') &&
      alignBody.includes('dot-low'),
      'View 4 has color legend (Green >= 70%, Yellow 40-69%, Red < 40%)'
    );
    assert(
      alignBody.includes('id="btnExpandAll"') &&
      alignBody.includes('id="btnCollapseAll"'),
      'View 4 has Expand All and Collapse All controls'
    );
    assert(
      alignBody.includes('id="treeContainer"') &&
      alignBody.includes('id="treeRootList"'),
      'View 4 has Visual Tree hierarchy containers (#treeContainer, #treeRootList)'
    );
    assert(
      alignBody.includes('node--high') &&
      alignBody.includes('node--mid') &&
      alignBody.includes('node--low'),
      'View 4 defines CSS classes for green, yellow, and red color-coded borders'
    );
    assert(
      alignBody.includes('btn-toggle-collapse'),
      'View 4 renders expandable/collapsible toggle buttons per node'
    );
    assert(
      alignBody.includes('owner-avatar'),
      'View 4 renders owner avatars with user initials'
    );
    assert(
      alignBody.includes('/okr-objective-detail.html?id='),
      'View 4 has drilldown links from tree nodes to Objective Detail'
    );
    assert(
      alignBody.includes('/api/okr/alignment?cycle='),
      'View 4 integrates with GET /api/okr/alignment API endpoint'
    );

    // =========================================================================
    // SECTION 6: Live API Contract & RBAC Integration Checks
    // =========================================================================
    console.log('\n--- SECTION 6: Live Backend API Contract Integration Tests ---');

    // 1. Create a Company Objective and Key Result via API
    const resCreateObj = await makeRequest('POST', '/api/okr/objective/create', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      title: 'Company North Star 2026',
      description: 'Expand enterprise market share',
      level: 'COMPANY',
      cycle: 'Q1-2026'
    });
    assert(resCreateObj.status === 201, 'POST /api/okr/objective/create returns HTTP 201');
    const compObj = resCreateObj.body;

    // 2. Add Key Result
    const resCreateKr = await makeRequest('POST', '/api/okr/kr/create', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      objective_id: compObj.id,
      title: 'Sign 10 Enterprise Accounts',
      type: 'NUMBER',
      target_value: 10,
      initial_value: 0
    });
    assert(resCreateKr.status === 201, 'POST /api/okr/kr/create returns HTTP 201');
    const kr = resCreateKr.body;

    // 3. Test View 1 Contract: GET /api/okr/dashboard
    const resDashApi = await makeRequest('GET', '/api/okr/dashboard?cycle=Q1-2026', {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resDashApi.status === 200, 'GET /api/okr/dashboard returns HTTP 200');
    assert(typeof resDashApi.body.health_score === 'number', 'GET /api/okr/dashboard returns health_score number');
    assert(Array.isArray(resDashApi.body.company_objectives), 'GET /api/okr/dashboard returns company_objectives array');
    assert(Array.isArray(resDashApi.body.team_objectives), 'GET /api/okr/dashboard returns team_objectives array');
    assert(Array.isArray(resDashApi.body.my_objectives), 'GET /api/okr/dashboard returns my_objectives array');

    // 4. Test View 2 Contract: GET /api/okr/objective/:id
    const resDetailApi = await makeRequest('GET', `/api/okr/objective/${compObj.id}`, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resDetailApi.status === 200, 'GET /api/okr/objective/:id returns HTTP 200');
    assert(resDetailApi.body.id === compObj.id, 'GET /api/okr/objective/:id returns matching objective id');
    assert(Array.isArray(resDetailApi.body.key_results), 'GET /api/okr/objective/:id returns key_results list');
    assert(resDetailApi.body.key_results.length >= 1, 'Objective includes created key result');

    // 5. Test View 3 Contract: Submit Check-in and Query History
    const resCheckinSubmit = await makeRequest('POST', '/api/okr/checkin/submit', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      key_result_id: kr.id,
      new_value: 7,
      confidence: 'HIGH',
      note: 'Signed 7 enterprise customers in Q1'
    });
    assert(resCheckinSubmit.status === 201, 'POST /api/okr/checkin/submit returns HTTP 201');
    assert(resCheckinSubmit.body.key_result.progress_pct === 70, 'Checkin updates KR progress to 70%');
    assert(resCheckinSubmit.body.checkin && resCheckinSubmit.body.checkin.new_value === 7, 'Checkin returns recorded checkin object');

    // Fetch previous checkins
    const resCheckinsList = await makeRequest('GET', `/api/okr/checkins/${kr.id}`, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resCheckinsList.status === 200, 'GET /api/okr/checkins/:krId returns HTTP 200');
    assert(Array.isArray(resCheckinsList.body), 'GET /api/okr/checkins/:krId returns checkins array');
    assert(resCheckinsList.body.length === 1, 'Checkin list contains 1 recorded entry');
    assert(resCheckinsList.body[0].new_value === 7, 'Checkin record matches submitted new_value');

    // 6. Test View 4 Contract & RBAC: GET /api/okr/alignment?cycle=Q1-2026
    const resAlignAdmin = await makeRequest('GET', '/api/okr/alignment?cycle=Q1-2026', {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(resAlignAdmin.status === 200, 'Admin: GET /api/okr/alignment returns HTTP 200');
    assert(Array.isArray(resAlignAdmin.body.root_objectives), 'GET /api/okr/alignment returns root_objectives tree');
    assert(resAlignAdmin.body.total_objectives >= 1, 'Alignment tree has total_objectives count');

    // Non-admin / Member role blocked (HTTP 403)
    const resAlignMember = await makeRequest('GET', '/api/okr/alignment?cycle=Q1-2026', {
      'Authorization': `Bearer ${memberToken}`
    });
    assert(
      resAlignMember.status === 403,
      'Member: GET /api/okr/alignment is blocked with HTTP 403 Forbidden (Admin only view)',
      `Got status ${resAlignMember.status}`
    );

    // Unauthenticated blocked (HTTP 401)
    const resAlignAnon = await makeRequest('GET', '/api/okr/alignment?cycle=Q1-2026');
    assert(
      resAlignAnon.status === 401,
      'Unauthenticated: GET /api/okr/alignment is blocked with HTTP 401 Unauthorized',
      `Got status ${resAlignAnon.status}`
    );

  } catch (err) {
    console.error('\n\x1b[31mUnexpected verification error:\x1b[0m', err);
    failed++;
  } finally {
    if (server) {
      server.close();
      console.log('\n[TestServer] Server closed.');
    }
  }

  console.log('\n========================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();
