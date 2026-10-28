/**
 * PRD 23 — Layer 2 Verification Suite
 * 
 * Verifies:
 * 1. Database Connection & Pragmas (WAL, busy_timeout=5000, foreign_keys=ON)
 * 2. Express HTTP Server integration on ephemeral port
 * 3. RBAC Enforcement on all 6 KPI routes (Members blocked with 403, Admins allowed)
 * 4. Built-in KPI calculations across all data sources with live DB verification:
 *    - Sprint Velocity (AVERAGE)
 *    - Sprint Completion Rate (PERCENTAGE)
 *    - OKR Progress (Company Level) (AVERAGE)
 *    - Team Utilization (AVERAGE)
 *    - Billable Hours This Month (SUM)
 *    - Pipeline Completion Rate (PERCENTAGE)
 *    - GitHub PR Merge Rate (Graceful fallback on empty tables -> 0.0)
 *    - Revenue This Month (SUM)
 *    - Active Backlog Items (COUNT)
 *    - Overloaded Members (COUNT)
 * 5. KPI Creation & Validations (POST /api/analytics/kpi/create):
 *    - Missing name -> 400 Bad Request
 *    - Invalid data_source -> 400 Bad Request
 *    - Sub-15 refresh interval -> 400 Bad Request
 *    - Invalid calculation_query agg -> 400 Bad Request
 *    - Disallowed table name -> 400 Bad Request
 *    - Valid custom KPI creation -> 201 Created with initial snapshot
 * 6. Snapshot Append-Only Engine:
 *    - Force refresh creates new snapshot row
 *    - Immutability trigger prevents direct SQL UPDATE
 * 7. Alert Auto-Generation & Deduplication:
 *    - Breach of alert_threshold_low creates BELOW_THRESHOLD alert
 *    - Subsequent refresh does not duplicate unacknowledged alert
 *    - Breach of alert_threshold_high creates ABOVE_THRESHOLD alert
 * 8. Seeded KPI Delete Protection:
 *    - DELETE on built-in KPI (IDs 1-10) rejected with 400 Bad Request
 *    - Non-seeded custom KPI deleted successfully with 200 OK
 * 9. updated_at manual timestamp maintenance verified via direct DB SELECT
 * 10. Background Cron Refresh Engine (refreshDueKpis) execution
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import * as analyticsService from '../src/services/analyticsService.js';

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

// HTTP Helper for testing endpoints
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

function generateToken(user) {
  const secret = config.JWT_SECRET || 'test_jwt_secret_mahi_tech_group_default';
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    {
      sessionId,
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name
    },
    secret,
    { expiresIn: '2h' }
  );

  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  execute(`
    INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at)
    VALUES (?, ?, ?, ?, 0, datetime('now'));
  `, [sessionId, user.id, token, expiresAt]);

  return token;
}

async function runLayer2Verification() {
  console.log('\n========================================================================');
  console.log('  PRD 23 LAYER 2: KPI CALCULATION, SNAPSHOTS, ALERTS & API VERIFICATION');
  console.log('========================================================================\n');

  let server;
  let serverUrl;

  try {
    // -------------------------------------------------------------------------
    // 1. Database Connection & Pragmas
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Database Pragmas & Preconditions ---');

    const db = getDatabase();
    const journalMode = queryOne('PRAGMA journal_mode;');
    assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', 'SQLite journal_mode is strictly WAL');

    const busyTimeout = queryOne('PRAGMA busy_timeout;');
    assert(busyTimeout && Number(busyTimeout.timeout) >= 5000, `SQLite busy_timeout is >= 5000ms (got: ${busyTimeout.timeout})`);

    const foreignKeys = queryOne('PRAGMA foreign_keys;');
    assert(foreignKeys && Number(foreignKeys.foreign_keys) === 1, 'SQLite foreign_keys constraint enforcement is ON (1)');

    // -------------------------------------------------------------------------
    // 2. HTTP Server & Test Personas
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: HTTP Test Server & Personas ---');

    const app = createApp();
    server = app.listen(0);
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
    console.log(`  [HARNESS] Ephemeral test server active on ${serverUrl}`);

    // Seed/retrieve Admin Persona
    let admin = queryOne("SELECT id, name, role, email FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1;");
    if (!admin) {
      execute(`
        INSERT INTO users (id, name, email, role, status)
        VALUES ('admin-prd23-l2', 'PRD23 Admin', 'admin.prd23@example.com', 'admin', 'active');
      `);
      admin = queryOne("SELECT id, name, role, email FROM users WHERE id = 'admin-prd23-l2';");
    }
    const adminToken = generateToken(admin);
    assert(!!adminToken, 'Admin persona authenticated and JWT token issued');

    // Seed/retrieve Regular Member Persona
    let member = queryOne("SELECT id, name, role, email FROM users WHERE role NOT IN ('admin', 'superadmin') LIMIT 1;");
    if (!member) {
      execute(`
        INSERT INTO users (id, name, email, role, status)
        VALUES ('member-prd23-l2', 'PRD23 Member', 'member.prd23@example.com', 'developer', 'active');
      `);
      member = queryOne("SELECT id, name, role, email FROM users WHERE id = 'member-prd23-l2';");
    }
    const memberToken = generateToken(member);
    assert(!!memberToken, 'Regular member persona authenticated and JWT token issued');

    // -------------------------------------------------------------------------
    // 3. RBAC Enforcement (Regular Members Blocked on Admin+ Routes)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: RBAC Protection on KPI Routes ---');

    // POST /api/analytics/kpi/create
    const resCreateMember = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Unauthorized KPI', data_source: 'CUSTOM', metric_type: 'COUNT', calculation_query: { agg: 'COUNT' } }
    });
    assert(resCreateMember.status === 403, 'Member blocked from POST /api/analytics/kpi/create (403 Forbidden)');

    // GET /api/analytics/kpis
    const resListMember = await makeRequest(serverUrl, '/api/analytics/kpis', {
      method: 'GET',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(resListMember.status === 403, 'Member blocked from GET /api/analytics/kpis (403 Forbidden)');

    // GET /api/analytics/kpi/:id
    const resGetMember = await makeRequest(serverUrl, '/api/analytics/kpi/1', {
      method: 'GET',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(resGetMember.status === 403, 'Member blocked from GET /api/analytics/kpi/:kpiId (403 Forbidden)');

    // PATCH /api/analytics/kpi/:id
    const resPatchMember = await makeRequest(serverUrl, '/api/analytics/kpi/1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { description: 'Hacked' }
    });
    assert(resPatchMember.status === 403, 'Member blocked from PATCH /api/analytics/kpi/:kpiId (403 Forbidden)');

    // DELETE /api/analytics/kpi/:id
    const resDeleteMember = await makeRequest(serverUrl, '/api/analytics/kpi/1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(resDeleteMember.status === 403, 'Member blocked from DELETE /api/analytics/kpi/:kpiId (403 Forbidden)');

    // POST /api/analytics/kpi/:id/refresh
    const resRefreshMember = await makeRequest(serverUrl, '/api/analytics/kpi/1/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(resRefreshMember.status === 403, 'Member blocked from POST /api/analytics/kpi/:kpiId/refresh (403 Forbidden)');

    // Unauthenticated request
    const resUnauth = await makeRequest(serverUrl, '/api/analytics/kpis', { method: 'GET' });
    assert(resUnauth.status === 401, 'Unauthenticated request rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // 4. Built-in KPI Refresh & Calculations
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Built-in KPI Calculations & Forced Refresh ---');

    // Admin lists all active KPIs
    const resListAdmin = await makeRequest(serverUrl, '/api/analytics/kpis', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resListAdmin.status === 200, 'Admin successfully accesses GET /api/analytics/kpis (200 OK)');
    assert(resListAdmin.data.success === true, 'Response contains success = true');
    assert(Array.isArray(resListAdmin.data.kpis) && resListAdmin.data.kpis.length >= 10, 'Returned at least 10 seeded KPIs');

    const seededKpis = resListAdmin.data.kpis;

    for (let i = 1; i <= 10; i++) {
      const kpi = seededKpis.find(k => k.id === i || k.name.includes(`KPI 0${i}`));
      const targetId = kpi ? kpi.id : i;

      const refreshRes = await makeRequest(serverUrl, `/api/analytics/kpi/${targetId}/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });

      assert(refreshRes.status === 200, `POST /api/analytics/kpi/${targetId}/refresh returns 200 OK (${kpi ? kpi.name : 'KPI ' + i})`);
      assert(typeof refreshRes.data.value === 'number' && !isNaN(refreshRes.data.value), `KPI ${targetId} calculated value is a valid number (got: ${refreshRes.data.value})`);
      assert(!!refreshRes.data.period_label, `KPI ${targetId} returned period_label: "${refreshRes.data.period_label}"`);

      // Direct DB SELECT verify snapshot insertion
      const dbSnap = queryOne(`
        SELECT id, value, period_label FROM kpi_snapshots 
        WHERE kpi_id = ? ORDER BY id DESC LIMIT 1;
      `, [targetId]);
      assert(!!dbSnap, `Direct DB SELECT: snapshot row created in kpi_snapshots for KPI ${targetId}`);
      assert(dbSnap.value === refreshRes.data.value, `Direct DB SELECT: stored snapshot value (${dbSnap.value}) matches returned value (${refreshRes.data.value})`);
    }

    // Specific Standing Rule Verification: GitHub PR Merge Rate Graceful Fallback
    const githubKpi = seededKpis.find(k => k.name === 'GitHub PR Merge Rate');
    assert(!!githubKpi, 'Found GitHub PR Merge Rate KPI definition');
    const ghRes = await makeRequest(serverUrl, `/api/analytics/kpi/${githubKpi.id}/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(ghRes.status === 200, 'GitHub PR Merge Rate refresh returns 200 OK without crashing');
    assert(typeof ghRes.data.value === 'number', `GitHub fallback returns numeric value: ${ghRes.data.value}`);

    // -------------------------------------------------------------------------
    // 5. KPI Creation & Validations (POST /api/analytics/kpi/create)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: KPI Creation & Input Validations ---');

    // Missing Name
    const resNoName = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { data_source: 'SPRINT', metric_type: 'COUNT', calculation_query: { table: 'backlog_items', agg: 'COUNT' } }
    });
    assert(resNoName.status === 400, 'Creation without name rejected with 400 Bad Request');

    // Invalid data_source
    const resBadSource = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Bad Source KPI', data_source: 'NON_EXISTENT_SOURCE', metric_type: 'COUNT', calculation_query: { agg: 'COUNT' } }
    });
    assert(resBadSource.status === 400, 'Creation with invalid data_source rejected with 400 Bad Request');

    // Sub-15 refresh interval
    const resSub15 = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Sub 15 Min KPI',
        data_source: 'CUSTOM',
        metric_type: 'COUNT',
        calculation_query: { table: 'users', agg: 'COUNT' },
        refresh_interval_minutes: 10
      }
    });
    assert(resSub15.status === 400, 'Creation with refresh_interval_minutes < 15 rejected with 400 Bad Request');
    assert(resSub15.data.error.includes('Minimum refresh interval is 15 minutes'), 'Error explicitly cites 15-minute minimum');

    // Invalid aggregation type
    const resBadAgg = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Bad Agg KPI',
        data_source: 'CUSTOM',
        metric_type: 'COUNT',
        calculation_query: { table: 'users', agg: 'INVALID_AGG' }
      }
    });
    assert(resBadAgg.status === 400, 'Creation with unsupported agg type rejected with 400 Bad Request');

    // Disallowed / SQL injection table name
    const resBadTable = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Bad Table KPI',
        data_source: 'CUSTOM',
        metric_type: 'COUNT',
        calculation_query: { table: 'sqlite_master; DROP TABLE users;', agg: 'COUNT' }
      }
    });
    assert(resBadTable.status === 400, 'Creation with unauthorized table spec rejected with 400 Bad Request');

    const runSuffix = Date.now();

    // Valid Custom KPI Creation
    const customKpiPayload = {
      name: `Custom Active Users Count L2 ${runSuffix}`,
      description: 'Count of active system users',
      data_source: 'CUSTOM',
      metric_type: 'COUNT',
      calculation_query: { table: 'users', agg: 'COUNT', filter: { status: 'active' } },
      unit: 'members',
      target_value: 50,
      alert_threshold_low: 10,
      alert_threshold_high: 100,
      refresh_interval_minutes: 30
    };

    const resCreateValid = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: customKpiPayload
    });

    assert(resCreateValid.status === 201, 'Valid custom KPI created with 201 Created');
    assert(resCreateValid.data.success === true, 'Response indicates success = true');
    const createdKpi = resCreateValid.data.kpi;
    assert(createdKpi && createdKpi.id > 10, `Created custom KPI assigned valid ID: ${createdKpi.id}`);
    assert(resCreateValid.data.initial_snapshot && typeof resCreateValid.data.initial_snapshot.value === 'number', 'Immediate initial snapshot taken upon creation');

    // Direct DB SELECT verify custom KPI properties
    const dbCustom = queryOne('SELECT * FROM kpi_definitions WHERE id = ?;', [createdKpi.id]);
    assert(!!dbCustom, 'Direct DB SELECT: Custom KPI row exists in kpi_definitions');
    assert(dbCustom.is_built_in === 0, 'Custom KPI has is_built_in = 0');
    assert(dbCustom.refresh_interval_minutes === 30, 'Custom KPI stored refresh_interval_minutes = 30');

    // -------------------------------------------------------------------------
    // 6. Snapshot Append-Only Engine
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Snapshot Append-Only Engine ---');

    const snapCountBefore = queryOne('SELECT COUNT(*) as c FROM kpi_snapshots WHERE kpi_id = ?;', [createdKpi.id]).c;

    // Refresh custom KPI
    const resRefCustom = await makeRequest(serverUrl, `/api/analytics/kpi/${createdKpi.id}/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resRefCustom.status === 200, 'Refresh on custom KPI returns 200 OK');

    const snapCountAfter = queryOne('SELECT COUNT(*) as c FROM kpi_snapshots WHERE kpi_id = ?;', [createdKpi.id]).c;
    assert(snapCountAfter === snapCountBefore + 1, `Snapshot count incremented by exactly 1 (from ${snapCountBefore} to ${snapCountAfter})`);

    // Verify append-only trigger still active
    let blockedUpdate = false;
    try {
      execute('UPDATE kpi_snapshots SET value = 9999 WHERE kpi_id = ?;', [createdKpi.id]);
    } catch (e) {
      blockedUpdate = e.message.includes('kpi_snapshots is append-only');
    }
    assert(blockedUpdate, 'Trigger prevent_kpi_snapshot_update strictly blocks SQL UPDATE on snapshots');

    // -------------------------------------------------------------------------
    // 7. Alert Auto-Generation & Deduplication
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Alert Auto-Generation & Deduplication ---');

    // Create KPI configured to breach alert_threshold_low immediately
    // e.g. target 100, alert_threshold_low: 999999 (current value < 999999 -> triggers alert)
    const alertKpiPayload = {
      name: `Alert Low Threshold Test KPI ${runSuffix}`,
      description: 'Test below threshold alert generation',
      data_source: 'CUSTOM',
      metric_type: 'COUNT',
      calculation_query: { table: 'users', agg: 'COUNT' },
      unit: 'count',
      target_value: 1000000,
      alert_threshold_low: 999999, // Will breach!
      refresh_interval_minutes: 15
    };

    const resAlertKpi = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: alertKpiPayload
    });

    assert(resAlertKpi.status === 201, 'Alert test KPI created with 201 Created');
    const alertKpiId = resAlertKpi.data.kpi.id;

    // Direct DB SELECT verify alert created
    const alertsBefore = queryAll(`
      SELECT id, kpi_id, alert_type, triggered_value, threshold_value, acknowledged_at 
      FROM kpi_alerts 
      WHERE kpi_id = ?;
    `, [alertKpiId]);

    assert(alertsBefore.length === 1, `Direct DB SELECT: Exactly 1 alert auto-generated for breached KPI (found: ${alertsBefore.length})`);
    assert(alertsBefore[0].alert_type === 'BELOW_THRESHOLD', `Alert type is strictly "BELOW_THRESHOLD" (got: ${alertsBefore[0].alert_type})`);
    assert(alertsBefore[0].threshold_value === 999999, `Threshold value recorded accurately as 999999`);
    assert(alertsBefore[0].acknowledged_at === null, 'Alert initialized as unacknowledged (acknowledged_at is NULL)');

    // Deduplication check: refresh again while unacknowledged alert exists
    const resRefDup = await makeRequest(serverUrl, `/api/analytics/kpi/${alertKpiId}/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resRefDup.status === 200, 'Second refresh on breached KPI returns 200 OK');

    const alertsAfter = queryAll('SELECT id FROM kpi_alerts WHERE kpi_id = ?;', [alertKpiId]);
    assert(alertsAfter.length === 1, `Deduplication: unacknowledged alert not duplicated on subsequent refresh (still 1 alert)`);

    // High Threshold breach test
    const alertHighPayload = {
      name: `Alert High Threshold Test KPI ${runSuffix}`,
      description: 'Test above threshold alert generation',
      data_source: 'CUSTOM',
      metric_type: 'COUNT',
      calculation_query: { table: 'users', agg: 'COUNT' },
      unit: 'count',
      target_value: 1,
      alert_threshold_high: 0.1, // Will breach since users count >= 1!
      refresh_interval_minutes: 15
    };

    const resHighAlert = await makeRequest(serverUrl, '/api/analytics/kpi/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: alertHighPayload
    });
    assert(resHighAlert.status === 201, 'High alert test KPI created');
    const highKpiId = resHighAlert.data.kpi.id;

    const highAlerts = queryAll('SELECT id, alert_type FROM kpi_alerts WHERE kpi_id = ?;', [highKpiId]);
    assert(highAlerts.length === 1 && highAlerts[0].alert_type === 'ABOVE_THRESHOLD', 'ABOVE_THRESHOLD alert generated when value exceeds high threshold');

    // -------------------------------------------------------------------------
    // 8. Seeded KPI Delete Protection
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Seeded KPI Delete Protection ---');

    // Attempt to DELETE built-in KPI 1 (Sprint Velocity)
    const resDelBuiltIn1 = await makeRequest(serverUrl, '/api/analytics/kpi/1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDelBuiltIn1.status === 400, 'DELETE /api/analytics/kpi/1 rejected with 400 Bad Request');
    assert(resDelBuiltIn1.data.error.includes('Seeded built-in KPIs cannot be deleted'), 'Error explicitly warns seeded KPIs cannot be deleted');

    // Direct DB verify KPI 1 still exists
    const kpi1Db = queryOne('SELECT id, name FROM kpi_definitions WHERE id = 1;');
    assert(!!kpi1Db, 'Direct DB SELECT: Built-in KPI 1 remains intact in database');

    // Attempt to DELETE built-in KPI 5 (Billable Hours)
    const resDelBuiltIn5 = await makeRequest(serverUrl, '/api/analytics/kpi/5', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDelBuiltIn5.status === 400, 'DELETE /api/analytics/kpi/5 rejected with 400 Bad Request');

    // Verify non-seeded custom KPI with snapshots is soft-deleted to protect audit history
    const resDelCustom = await makeRequest(serverUrl, `/api/analytics/kpi/${createdKpi.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDelCustom.status === 200, 'DELETE on custom KPI returns 200 OK');

    const dbCustomDeleted = queryOne('SELECT id, is_active FROM kpi_definitions WHERE id = ?;', [createdKpi.id]);
    assert(dbCustomDeleted && dbCustomDeleted.is_active === 0, 'Direct DB SELECT: Custom KPI deactivated/soft-deleted (is_active = 0) to preserve snapshot history');

    // Verify non-seeded custom KPI WITHOUT snapshots is completely hard-deleted
    const tempName = `Temporary Unsnapshotted KPI ${runSuffix}`;
    execute(`
      INSERT INTO kpi_definitions (name, data_source, metric_type, calculation_query, is_built_in, created_by)
      VALUES (?, 'TIME_TRACKING', 'SUM', '{}', 0, ?);
    `, [tempName, admin.id]);
    const tempKpi = queryOne('SELECT id FROM kpi_definitions WHERE name = ?;', [tempName]);
    const resDelTemp = await makeRequest(serverUrl, `/api/analytics/kpi/${tempKpi.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDelTemp.status === 200, 'DELETE on unsnapshotted custom KPI returns 200 OK');
    const dbTempDeleted = queryOne('SELECT id FROM kpi_definitions WHERE id = ?;', [tempKpi.id]);
    assert(!dbTempDeleted, 'Direct DB SELECT: Unsnapshotted custom KPI completely removed from kpi_definitions');

    // -------------------------------------------------------------------------
    // 9. updated_at Manual Timestamp Maintenance on PATCH
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 9: updated_at Maintenance & PATCH API ---');

    const kpiBeforePatch = queryOne('SELECT id, description, updated_at FROM kpi_definitions WHERE id = ?;', [alertKpiId]);

    // Wait 1 second to ensure updated_at timestamp changes visibly
    await new Promise(r => setTimeout(r, 1000));

    const resPatch = await makeRequest(serverUrl, `/api/analytics/kpi/${alertKpiId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        description: 'Updated Description via PATCH L2',
        target_value: 2000000
      }
    });

    assert(resPatch.status === 200, 'PATCH /api/analytics/kpi/:kpiId returns 200 OK');
    assert(resPatch.data.kpi.description === 'Updated Description via PATCH L2', 'Updated description returned in response');

    const kpiAfterPatch = queryOne('SELECT id, description, target_value, updated_at FROM kpi_definitions WHERE id = ?;', [alertKpiId]);
    assert(kpiAfterPatch.description === 'Updated Description via PATCH L2', 'Direct DB SELECT: Updated description saved in SQLite');
    assert(kpiAfterPatch.target_value === 2000000, 'Direct DB SELECT: Updated target_value saved in SQLite');
    assert(kpiAfterPatch.updated_at !== kpiBeforePatch.updated_at, `Direct DB SELECT: updated_at changed from "${kpiBeforePatch.updated_at}" to "${kpiAfterPatch.updated_at}"`);

    // Verify access_log recorded KPI_UPDATED
    const updateLog = queryOne(`
      SELECT id, action, target_id FROM access_log 
      WHERE action = 'KPI_UPDATED' AND target_id = ? 
      ORDER BY id DESC LIMIT 1;
    `, [String(alertKpiId)]);
    assert(!!updateLog, 'access_log recorded KPI_UPDATED audit entry');

    // -------------------------------------------------------------------------
    // 10. Background Cron Refresh Engine (refreshDueKpis)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 10: Background Cron Engine (refreshDueKpis) ---');

    const cronSummary = analyticsService.refreshDueKpis();
    assert(typeof cronSummary === 'object' && cronSummary !== null, 'refreshDueKpis() returned summary object');
    assert(typeof cronSummary.refreshedCount === 'number', `refreshDueKpis processed ${cronSummary.refreshedCount} due KPIs`);
    assert(cronSummary.errorsCount === 0, `refreshDueKpis executed with 0 errors (errors: ${JSON.stringify(cronSummary.errors)})`);

    // Clean up test alert KPI
    execute('UPDATE kpi_definitions SET is_active = 0 WHERE id IN (?, ?);', [alertKpiId, highKpiId]);

    console.log('\n========================================================================');
    console.log('  PRD 23 LAYER 2 VERIFICATION SUMMARY:');
    console.log(`  Total Tests:  ${totalTests}`);
    console.log(`  Passed Tests: ${passedTests}`);
    console.log(`  Failed Tests: ${failedTests}`);
    console.log('========================================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during PRD 23 Layer 2 verification:', error);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
      console.log('  [HARNESS] Ephemeral test server closed cleanly');
    }
  }
}

runLayer2Verification();
