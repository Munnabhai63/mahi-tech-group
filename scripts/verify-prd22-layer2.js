/**
 * PRD 22 Layer 2 Comprehensive Verification Suite
 * 
 * Verifies:
 * 1. Database & Connection Pragmas: WAL mode, busy_timeout=5000, foreign_keys=ON
 * 2. Billable Rate Priority Hierarchy & Resolution Engine:
 *    - MEMBER_DEFAULT vs PROJECT_OVERRIDE (general vs member-specific)
 *    - Priority: (user, project) > (project default) > (member default) > 0.0 INR
 *    - Temporal validity checking (effective_from, effective_to)
 *    - Snapshotting behavior
 * 3. Single Active Timer Rule & Lock Mechanism:
 *    - HTTP POST /api/time/timer/start acquires lock
 *    - Second start attempt blocked by service (409 Conflict)
 *    - Database UNIQUE(user_id) constraint blocks concurrent inserts
 * 4. Timer Status API:
 *    - HTTP GET /api/time/timer/status returns live timer with elapsed_seconds
 *    - User privacy: Member B sees active: false
 * 5. Timer Stop & Server-Side Math Calculation:
 *    - HTTP POST /api/time/timer/stop calculates duration_minutes & billable_amount
 *    - Manual updated_at set on time_entries row
 *    - active_timers lock released (DELETE permitted on lock table)
 *    - Audit trail written to time_entry_history (append-only)
 *    - Calling stop with no active timer returns 404
 * 6. Overlap Detection Engine:
 *    - Detects and blocks overlapping intervals for same user
 * 7. Timer Immutability & 24hr Edit Window:
 *    - Timer-stopped entries immediately locked for members
 *    - Admin role permitted
 * 8. Dangling Timer Auto-Close Cron Logic:
 *    - Timers passing 23:59:59 of their start day auto-close cleanly
 */

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import * as timeTrackingService from '../src/services/timeTrackingService.js';

let BASE_URL = 'http://localhost:4000/api/time';
let serverInstance = null;

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

function createSessionToken(user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sessionId, userId: user.id, role: user.role, email: user.email, name: user.name },
    config.JWT_SECRET,
    { expiresIn: '1d' }
  );
  execute(`
    INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
    VALUES (?, ?, ?, 'Test Harness Layer 2', '127.0.0.1', datetime('now'), datetime('now', '+1 day'), 0)
  `, [sessionId, user.id, token]);
  return token;
}

async function apiRequest(endpoint, options = {}, token = null) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };

  const res = await fetch(url, {
    ...options,
    headers
  });

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }

  return { status: res.status, ok: res.ok, data };
}

async function runLayer2Verification() {
  console.log('\n========================================================================');
  console.log('  PRD 22 LAYER 2: TIMER SERVICE, LOCK ENGINE & RATE RESOLUTION VERIFICATION');
  console.log('========================================================================\n');

  // Start ephemeral test server
  const app = createApp();
  await new Promise((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const port = serverInstance.address().port;
      BASE_URL = `http://127.0.0.1:${port}/api/time`;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // 1. Database Connection & Table Preconditions
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Database Pragmas & Immutability Preconditions ---');

    const journalMode = queryOne('PRAGMA journal_mode;');
    assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', 'SQLite journal_mode is strictly WAL');

    const busyTimeout = queryOne('PRAGMA busy_timeout;');
    assert(busyTimeout && busyTimeout.timeout === 5000, 'SQLite busy_timeout is strictly 5000ms');

    const foreignKeys = queryOne('PRAGMA foreign_keys;');
    assert(foreignKeys && foreignKeys.foreign_keys === 1, 'SQLite foreign_keys is strictly ON (1)');

    const masterTables = queryAll("SELECT name FROM sqlite_master WHERE type = 'table'").map(t => t.name);
    assert(masterTables.includes('time_entries'), 'Table "time_entries" verified in sqlite_master');
    assert(masterTables.includes('active_timers'), 'Table "active_timers" verified in sqlite_master');
    assert(masterTables.includes('billable_rates'), 'Table "billable_rates" verified in sqlite_master');
    assert(masterTables.includes('time_entry_history'), 'Table "time_entry_history" verified in sqlite_master');

    // -------------------------------------------------------------------------
    // Set Up Personas & Tokens
    // -------------------------------------------------------------------------
    let adminUser = queryOne("SELECT * FROM users WHERE role IN ('admin', 'superadmin') AND id IS NOT NULL LIMIT 1");
    let memberUserB = queryOne("SELECT * FROM users WHERE role NOT IN ('admin', 'superadmin') AND id IS NOT NULL LIMIT 1");
    
    const fixtureIdea = queryOne("SELECT id FROM ideas WHERE id IS NOT NULL LIMIT 1");
    const testProjectId = 'rate-test-proj-' + Date.now();
    execute("INSERT INTO projects (id, idea_id, title, status, owner_id) VALUES (?, ?, 'Rate Priority Project', 'ACTIVE', ?)", [testProjectId, fixtureIdea ? fixtureIdea.id : 'default-idea', adminUser.id]);
    const testProject = queryOne("SELECT * FROM projects WHERE id = ?", [testProjectId]);

    const testMemberId = 'rate-test-mem-' + Date.now();
    const testMemberEmail = `member_${Date.now()}@mahitechgroup.com`;
    execute("INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Rate Member', ?, 'fake_hash', 'developer', 'active')", [testMemberId, testMemberEmail]);
    const memberUserA = queryOne("SELECT * FROM users WHERE id = ?", [testMemberId]);

    assert(Boolean(adminUser && memberUserA && testProject), 'Verified existence of real admin, member, and project fixtures');

    const adminToken = createSessionToken(adminUser);
    const memberTokenA = createSessionToken(memberUserA);
    const memberTokenB = memberUserB ? createSessionToken(memberUserB) : adminToken;

    // -------------------------------------------------------------------------
    // 2. Billable Rate Priority Hierarchy & Resolution Engine
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Billable Rate Priority Hierarchy & Resolution ---');

    // 2.1 Default rate when nothing configured -> 0.0 INR
    const initialRate = timeTrackingService.resolveBillableRate(memberUserA.id, testProject.id, '2026-10-28');
    assert(initialRate.rate === 0.0 && initialRate.currency === 'INR', 'Fallback rate is 0.0 INR when no rates configured');

    // 2.2 Configure MEMBER_DEFAULT rate (1200 INR/hr)
    const setMemRes = await apiRequest('/rate/set', {
      method: 'POST',
      body: JSON.stringify({
        rate_type: 'MEMBER_DEFAULT',
        user_id: memberUserA.id,
        rate_per_hour: 1200.0,
        currency: 'INR',
        effective_from: '2026-10-01'
      })
    }, adminToken);
    assert(setMemRes.status === 201 && setMemRes.data.success, 'Admin sets MEMBER_DEFAULT rate (1200 INR/hr) via POST /api/time/rate/set');

    const rateAfterMem = timeTrackingService.resolveBillableRate(memberUserA.id, testProject.id, '2026-10-28');
    assert(rateAfterMem.rate === 1200.0 && rateAfterMem.source === 'MEMBER_DEFAULT', 'Rate resolution applies MEMBER_DEFAULT (1200.0 INR)');

    // 2.3 Configure general PROJECT_OVERRIDE (1600 INR/hr)
    const setProjRes = await apiRequest('/rate/set', {
      method: 'POST',
      body: JSON.stringify({
        rate_type: 'PROJECT_OVERRIDE',
        project_id: testProject.id,
        rate_per_hour: 1600.0,
        currency: 'INR',
        effective_from: '2026-10-01'
      })
    }, adminToken);
    assert(setProjRes.status === 201 && setProjRes.data.success, 'Admin sets project general PROJECT_OVERRIDE (1600 INR/hr) via API');

    const rateAfterProj = timeTrackingService.resolveBillableRate(memberUserA.id, testProject.id, '2026-10-28');
    assert(rateAfterProj.rate === 1600.0 && rateAfterProj.source === 'PROJECT_DEFAULT_OVERRIDE', 'PROJECT_OVERRIDE takes precedence over MEMBER_DEFAULT (1600.0 INR)');

    // 2.4 Configure specific (user_id, project_id) PROJECT_OVERRIDE (2200 INR/hr)
    const setMemberProjRes = await apiRequest('/rate/set', {
      method: 'POST',
      body: JSON.stringify({
        rate_type: 'PROJECT_OVERRIDE',
        user_id: memberUserA.id,
        project_id: testProject.id,
        rate_per_hour: 2200.0,
        currency: 'INR',
        effective_from: '2026-10-01'
      })
    }, adminToken);
    assert(setMemberProjRes.status === 201 && setMemberProjRes.data.success, 'Admin sets specific member PROJECT_OVERRIDE (2200 INR/hr) via API');

    const rateAfterSpecific = timeTrackingService.resolveBillableRate(memberUserA.id, testProject.id, '2026-10-28');
    assert(rateAfterSpecific.rate === 2200.0 && rateAfterSpecific.source === 'PROJECT_MEMBER_OVERRIDE', 'Specific member PROJECT_OVERRIDE takes highest priority (2200.0 INR)');

    // 2.5 Temporal bound check: future rate should NOT apply to current date
    execute(`
      INSERT INTO billable_rates (rate_type, user_id, project_id, rate_per_hour, currency, effective_from, set_by)
      VALUES ('PROJECT_OVERRIDE', ?, ?, 9999.0, 'INR', '2027-01-01', ?)
    `, [memberUserA.id, testProject.id, adminUser.id]);
    const rateWithFuture = timeTrackingService.resolveBillableRate(memberUserA.id, testProject.id, '2026-10-28');
    assert(rateWithFuture.rate === 2200.0, 'Future effective_from rate (2027-01-01) does not apply to past/current date (2026-10-28)');

    // 2.6 Fetch member rate history via API
    const getMemRatesRes = await apiRequest(`/rate/member/${memberUserA.id}`, { method: 'GET' }, adminToken);
    assert(getMemRatesRes.status === 200 && Array.isArray(getMemRatesRes.data.rates), 'GET /api/time/rate/member/:userId returns member rate history');

    // 2.7 Fetch project rate history via API
    const getProjRatesRes = await apiRequest(`/rate/project/${testProject.id}`, { method: 'GET' }, adminToken);
    assert(getProjRatesRes.status === 200 && Array.isArray(getProjRatesRes.data.rates), 'GET /api/time/rate/project/:projectId returns project rate history');

    // 2.8 Non-admin role cannot set rates
    const nonAdminRateRes = await apiRequest('/rate/set', {
      method: 'POST',
      body: JSON.stringify({
        rate_type: 'MEMBER_DEFAULT',
        user_id: memberUserA.id,
        rate_per_hour: 5000.0,
        currency: 'INR',
        effective_from: '2026-10-01'
      })
    }, memberTokenA);
    assert(nonAdminRateRes.status === 403, 'Non-admin member cannot set billable rates (HTTP 403 Forbidden)');

    // -------------------------------------------------------------------------
    // 3. Timer Start & Single-Active-Timer Lock Engine
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Timer Start & Concurrency Lock Engine ---');

    // Start timer for Member A
    const startRes = await apiRequest('/timer/start', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        source_ref_type: 'GANTT_ITEM',
        source_ref_id: 101,
        description: 'Implementing Core Kernel Driver',
        is_billable: true
      })
    }, memberTokenA);

    assert(startRes.status === 201 && startRes.data.success, 'POST /api/time/timer/start returns HTTP 201 Created');
    assert(startRes.data.timer && startRes.data.timer.billable_rate === 2200.0, 'Active timer snapshots resolved billable rate (2200.0 INR)');

    const entryId = startRes.data.timer.time_entry_id;

    // Verify time_entries row in SQLite
    const entryRow = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
    assert(Boolean(entryRow), 'time_entries row successfully created in SQLite');
    assert(entryRow.source_type === 'TIMER', 'time_entries.source_type is strictly "TIMER"');
    assert(entryRow.end_time === null, 'Running timer time_entries.end_time is NULL');
    assert(entryRow.duration_minutes === null, 'Running timer time_entries.duration_minutes is NULL');
    assert(entryRow.status === 'PENDING', 'Running timer time_entries.status is "PENDING"');
    assert(entryRow.billable_rate === 2200.0, 'time_entries.billable_rate snapshotted as 2200.0');

    // Verify active_timers lock table
    const lockRow = queryOne('SELECT * FROM active_timers WHERE user_id = ?', [memberUserA.id]);
    assert(Boolean(lockRow && lockRow.time_entry_id === entryId), 'Lock table active_timers has single active lock for user');

    // Verify audit history in time_entry_history
    const historyRow = queryOne("SELECT * FROM time_entry_history WHERE entry_id = ? AND field_changed = 'status'", [entryId]);
    assert(Boolean(historyRow && historyRow.new_value === 'TIMER_STARTED'), 'time_entry_history recorded TIMER_STARTED audit row');

    // Rule 1: Attempt to start second concurrent timer for Member A -> MUST return 409 Conflict
    const secondStartRes = await apiRequest('/timer/start', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        description: 'Attempting concurrent task',
        is_billable: false
      })
    }, memberTokenA);

    assert(secondStartRes.status === 409, 'Rule 1: Second active timer start attempt rejected with HTTP 409 Conflict');
    assert(secondStartRes.data.error.includes('already has an active'), 'Conflict error explicitly warns: "User already has an active running timer"');

    // Verify DB UNIQUE constraint protects against direct SQL insertion
    let dbConstraintBlocked = false;
    try {
      execute('INSERT INTO active_timers (user_id, time_entry_id) VALUES (?, ?)', [memberUserA.id, entryId]);
    } catch (err) {
      dbConstraintBlocked = err.message.includes('UNIQUE constraint failed') || err.message.includes('active_timers.user_id');
    }
    assert(dbConstraintBlocked, 'Direct SQL duplicate lock insertion blocked by SQLite UNIQUE(user_id) constraint');

    // -------------------------------------------------------------------------
    // 4. Timer Status API & User Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Timer Status API & User Privacy Isolation ---');

    const statusResA = await apiRequest('/timer/status', { method: 'GET' }, memberTokenA);
    assert(statusResA.status === 200 && statusResA.data.active === true, 'GET /api/time/timer/status returns active: true for timer owner');
    assert(statusResA.data.timer && statusResA.data.timer.project_id === testProject.id, 'Status returns associated project_id');
    assert(typeof statusResA.data.timer.elapsed_seconds === 'number' && statusResA.data.timer.elapsed_seconds >= 0, 'Status returns numeric elapsed_seconds counter');

    // Member B checking status -> must be active: false
    const statusResB = await apiRequest('/timer/status', { method: 'GET' }, memberTokenB);
    assert(statusResB.status === 200 && statusResB.data.active === false, 'Privacy Isolation: Member B checking status returns active: false');

    // -------------------------------------------------------------------------
    // 5. Timer Stop & Server-Side Math Calculation Verification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Timer Stop & Calculation Verification ---');

    // Member B attempts to stop Member A's timer -> MUST be blocked
    const foreignStopRes = await apiRequest('/timer/stop', {
      method: 'POST',
      body: JSON.stringify({ time_entry_id: entryId })
    }, memberTokenB);
    assert(foreignStopRes.status === 404 || foreignStopRes.status === 403, 'Member B cannot stop Member A active timer (blocked)');

    // Simulate stopping timer with an explicit 90-minute session duration
    const startTimeDate = new Date(entryRow.start_time);
    const simulatedEndTime = new Date(startTimeDate.getTime() + 90 * 60 * 1000).toISOString(); // +90 mins

    const stopRes = await apiRequest('/timer/stop', {
      method: 'POST',
      body: JSON.stringify({
        time_entry_id: entryId,
        end_time: simulatedEndTime
      })
    }, memberTokenA);

    assert(stopRes.status === 200 && stopRes.data.success, 'POST /api/time/timer/stop returns HTTP 200 OK');

    // Direct SQLite verification of the closed time_entry
    const closedEntry = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
    assert(closedEntry.end_time === simulatedEndTime, 'time_entries.end_time correctly written on stop');
    assert(closedEntry.duration_minutes === 90, 'Server-side duration calculated exactly as 90 minutes');
    
    // Billable calculation check: (90 / 60) * 2200.0 = 1.5 * 2200.0 = 3300.00
    assert(closedEntry.billable_amount === 3300.0, 'Server-side billable_amount calculated: (90 / 60) * 2200.0 = 3300.00 INR');
    assert(closedEntry.billable_rate === 2200.0, 'Billable rate remains snapshotted (not altered)');

    // Verify updated_at was manually updated
    assert(Boolean(closedEntry.updated_at), 'updated_at is populated in database');

    // Verify lock released from active_timers (DELETE allowed on lock table)
    const lockAfterStop = queryOne('SELECT * FROM active_timers WHERE user_id = ?', [memberUserA.id]);
    assert(lockAfterStop === null, 'Lock table active_timers row cleanly released (DELETE on stop verified)');

    // Verify audit logs in time_entry_history
    const stopAuditLogs = queryAll('SELECT * FROM time_entry_history WHERE entry_id = ?', [entryId]);
    const loggedFields = stopAuditLogs.map(l => l.field_changed);
    assert(loggedFields.includes('end_time'), 'Audit history logged "end_time" modification');
    assert(loggedFields.includes('duration_minutes'), 'Audit history logged "duration_minutes" modification');
    assert(loggedFields.includes('billable_amount'), 'Audit history logged "billable_amount" modification');

    // Calling stop when no timer is active -> returns 404
    const stopAgainRes = await apiRequest('/timer/stop', { method: 'POST', body: '{}' }, memberTokenA);
    assert(stopAgainRes.status === 404, 'Stopping when no timer is running returns HTTP 404 Not Found');

    // -------------------------------------------------------------------------
    // 6. Overlap Detection Engine
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Overlap Detection Engine ---');

    // Closed entry spans: [startTimeDate, simulatedEndTime] (e.g. 09:00 to 10:30)
    // Attempting to check overlap for an interval inside [startTimeDate + 10m, startTimeDate + 40m]
    const insideStart = new Date(startTimeDate.getTime() + 10 * 60 * 1000).toISOString();
    const insideEnd = new Date(startTimeDate.getTime() + 40 * 60 * 1000).toISOString();

    const overlappingCheck = timeTrackingService.checkTimeOverlap(memberUserA.id, insideStart, insideEnd);
    assert(Boolean(overlappingCheck && overlappingCheck.id === entryId), 'Overlap detected for interval falling inside existing entry');

    // Attempting an interval after the closed entry: [simulatedEndTime + 10m, simulatedEndTime + 50m]
    const afterStart = new Date(new Date(simulatedEndTime).getTime() + 10 * 60 * 1000).toISOString();
    const afterEnd = new Date(new Date(simulatedEndTime).getTime() + 50 * 60 * 1000).toISOString();

    const nonOverlappingCheck = timeTrackingService.checkTimeOverlap(memberUserA.id, afterStart, afterEnd);
    assert(nonOverlappingCheck === null, 'No overlap detected for non-overlapping future time window');

    // -------------------------------------------------------------------------
    // 7. 24-Hour Edit Window & Timer Immutability
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: 24-Hour Edit Window & Timer Immutability ---');

    // Rule: Timer-stopped entries are locked immediately on stop for members
    const timerEditCheckMember = timeTrackingService.canEditTimeEntry(closedEntry, memberUserA);
    assert(timerEditCheckMember.allowed === false, 'Timer-stopped entry is strictly locked against member edits');
    assert(timerEditCheckMember.reason.includes('locked immediately'), 'Lock reason states timer entries cannot be edited by members');

    // Admin can edit
    const timerEditCheckAdmin = timeTrackingService.canEditTimeEntry(closedEntry, adminUser);
    assert(timerEditCheckAdmin.allowed === true, 'Admin possesses privilege to edit/adjust closed entries');

    // Test Manual entry edit window check (within 24 hrs -> allowed, >24 hrs -> blocked)
    const freshManualEntry = {
      user_id: memberUserA.id,
      source_type: 'MANUAL',
      created_at: new Date().toISOString()
    };
    const manualFreshCheck = timeTrackingService.canEditTimeEntry(freshManualEntry, memberUserA);
    assert(manualFreshCheck.allowed === true, 'Fresh MANUAL entry within 24 hours is editable by owner');

    const staleManualEntry = {
      user_id: memberUserA.id,
      source_type: 'MANUAL',
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25 hours ago
    };
    const manualStaleCheck = timeTrackingService.canEditTimeEntry(staleManualEntry, memberUserA);
    assert(manualStaleCheck.allowed === false, 'Stale MANUAL entry older than 24 hours is locked against member edits');

    // -------------------------------------------------------------------------
    // 8. Dangling Timer Auto-Close Cron Logic
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Dangling Timer Auto-Close Cron Logic ---');

    // Insert an artificial dangling timer started yesterday
    const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayDateStr = yesterdayDate.toISOString().split('T')[0];
    const yesterdayStartStr = `${yesterdayDateStr}T10:00:00.000Z`;

    execute(`
      INSERT INTO time_entries (
        user_id, project_id, source_type, description, start_time, end_time, is_billable, billable_rate, status
      ) VALUES (?, ?, 'TIMER', 'Dangling Timer Session', ?, NULL, 1, 1000.0, 'PENDING')
    `, [memberUserA.id, testProject.id, yesterdayStartStr]);

    const danglingEntry = queryOne("SELECT * FROM time_entries WHERE description = 'Dangling Timer Session' ORDER BY id DESC LIMIT 1");
    execute('INSERT INTO active_timers (user_id, time_entry_id, started_at) VALUES (?, ?, ?)', [memberUserA.id, danglingEntry.id, yesterdayStartStr]);

    // Run autoCloseDanglingTimers
    const cronResult = timeTrackingService.autoCloseDanglingTimers();
    assert(cronResult.auto_closed_count >= 1, 'autoCloseDanglingTimers identifies and closes dangling timer from previous day');

    const resolvedDangling = queryOne('SELECT * FROM time_entries WHERE id = ?', [danglingEntry.id]);
    assert(resolvedDangling.end_time === `${yesterdayDateStr}T23:59:59.000Z`, 'Dangling timer auto-closed at 23:59:59 of started day');
    assert(resolvedDangling.duration_minutes > 0, 'Dangling timer auto-calculates duration up to 23:59:59');

    const danglingLock = queryOne('SELECT * FROM active_timers WHERE time_entry_id = ?', [danglingEntry.id]);
    assert(danglingLock === null, 'Dangling timer active_timers lock cleared on auto-close');

    // -------------------------------------------------------------------------
    // Clean up test session data
    // -------------------------------------------------------------------------
    execute("DELETE FROM active_timers WHERE user_id IN (?, ?)", [memberUserA.id, adminUser.id]);

  } catch (fatalErr) {
    console.error('\n\x1b[31m[FATAL ERROR IN LAYER 2 SUITE]\x1b[0m', fatalErr);
    process.exitCode = 1;
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }

  console.log('\n========================================================================');
  console.log('  PRD 22 LAYER 2 VERIFICATION SUMMARY:');
  console.log(`  Total Tests:  ${totalTests}`);
  console.log(`  Passed Tests: ${passedTests}`);
  console.log(`  Failed Tests: ${failedTests}`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

runLayer2Verification().catch(err => {
  console.error('Unhandled fatal error in Layer 2 test suite:', err);
  process.exitCode = 1;
});
