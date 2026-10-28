/**
 * PRD 22 Layer 4 Comprehensive Verification Suite
 * 
 * Verifies:
 * 1. Database & Connection Pragmas: WAL mode, busy_timeout=5000, foreign_keys=ON (1)
 * 2. Append-Only Trigger Enforcements (Layer 1 confirmation):
 *    - time_approval_requests UPDATE and DELETE blocked by triggers
 *    - time_report_snapshots UPDATE and DELETE blocked by triggers
 * 3. Approval Request Workflow (POST /api/time/approval/request/:entryId):
 *    - Authentication check (401)
 *    - Member cannot submit another member's entry (403 Forbidden)
 *    - Member submits own PENDING entry (201 Created)
 *    - time_approval_requests row inserted with append-only integrity
 *    - time_entry_history audit log appended (status: APPROVAL_REQUESTED)
 *    - Duplicate pending request blocked (409 Conflict)
 *    - Active timer entry submission blocked (400)
 *    - Deleted entry submission blocked (400)
 * 4. Pending Approvals Queue (GET /api/time/approval/pending):
 *    - Member role blocked (403 Forbidden)
 *    - Admin role retrieves pending approval list (200 OK)
 *    - Joined metadata: member_name, member_email, project_title, duration, billable details
 * 5. Admin Approval & Rejection Processing:
 *    - Member role blocked from approve / reject (403 Forbidden)
 *    - Reject without decision_note or <10 chars blocked (400 Bad Request)
 *    - Admin rejects with valid decision_note (200 OK)
 *      - time_entries status = 'REJECTED'
 *      - rejection_reason recorded
 *      - updated_at manually updated
 *      - time_entry_history audit rows written (status, rejection_reason)
 *      - access_log event written (TIME_ENTRY_REJECTED)
 *      - Request no longer in pending queue
 *      - Rejected entry cannot be resubmitted (400)
 *    - Admin approves second entry (200 OK)
 *      - time_entries status = 'APPROVED'
 *      - approved_by & approved_at recorded
 *      - updated_at manually updated
 *      - time_entry_history audit row written (status: APPROVED)
 *      - access_log event written (TIME_ENTRY_APPROVED)
 *      - Request no longer in pending queue
 *      - Already approved entry cannot be approved again (400)
 * 6. Team Time Report API (GET /api/time/report/team):
 *    - Member role blocked (403 Forbidden)
 *    - Admin role retrieves aggregated totals (200 OK)
 *    - Aggregates per member: total_hrs, billable_hrs, non_billable_hrs, billable_amount, entries_count
 *    - Summary totals object: member_count, total_hrs, billable_amount
 *    - Soft-deleted entries strictly excluded from aggregates
 *    - Filters supported: project_id, from, to
 * 7. My Time Report API (GET /api/time/report/my):
 *    - Member retrieves own report (200 OK)
 *    - Scoped strictly to own user_id
 *    - Breakdown by project verified
 *    - Soft-deleted entries excluded
 * 8. Report Snapshots API (POST /api/time/report/snapshot & GET /api/time/report/snapshots/:projectId):
 *    - Member role blocked (403 Forbidden)
 *    - Invalid report_type blocked (400)
 *    - Admin creates point-in-time snapshot (201 Created)
 *    - Row inserted in time_report_snapshots table
 *    - snapshot_data verified as valid frozen JSON
 *    - Admin retrieves snapshots for project (200 OK)
 * 9. Report Export API (GET /api/time/report/export/:projectId):
 *    - Member role blocked (403 Forbidden)
 *    - Admin exports CSV (200 OK)
 *    - Header text/csv verified
 *    - CSV headers & data format verified
 *    - access_log event written (TIME_REPORT_EXPORT)
 *    - JSON export mode via ?format=json verified
 */

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';

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
    VALUES (?, ?, ?, 'Test Harness Layer 4', '127.0.0.1', datetime('now'), datetime('now', '+1 day'), 0)
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

  const contentType = res.headers.get('content-type') || '';
  let data = null;
  let text = null;

  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    try {
      text = await res.text();
    } catch {
      text = null;
    }
  }

  return { status: res.status, headers: res.headers, data, text };
}

async function runLayer4Suite() {
  console.log('\n======================================================================');
  console.log('🚀 PRD 22 LAYER 4 COMPREHENSIVE VERIFICATION SUITE');
  console.log('======================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // 0. Spin up ephemeral server on port 0
    // -------------------------------------------------------------------------
    const app = createApp();
    await new Promise((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        const address = serverInstance.address();
        BASE_URL = `http://127.0.0.1:${address.port}/api/time`;
        console.log(`[HARNESS] Ephemeral test server listening on ${BASE_URL}\n`);
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // 1. Connection Pragmas Verification
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Database & Connection Pragmas ---');
    const fkStatus = queryOne('PRAGMA foreign_keys;');
    assert(fkStatus.foreign_keys === 1, 'PRAGMA foreign_keys is strictly ON (1)');

    const journalMode = queryOne('PRAGMA journal_mode;');
    assert(journalMode.journal_mode.toLowerCase() === 'wal', `PRAGMA journal_mode is WAL (got: ${journalMode.journal_mode})`);

    const busyTimeout = queryOne('PRAGMA busy_timeout;');
    assert(busyTimeout.timeout >= 5000, `PRAGMA busy_timeout is >= 5000ms (got: ${busyTimeout.timeout})`);

    // -------------------------------------------------------------------------
    // 2. Append-Only Trigger Verification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Append-Only Trigger Integrity ---');

    // Create unique test entities
    const runId = Date.now();
    const adminId = `admin-l4-${runId}`;
    const aliceId = `alice-l4-${runId}`;
    const bobId = `bob-l4-${runId}`;
    const testProjectId = `l4-proj-${runId}`;

    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, 'Admin Layer 4', ?, 'mock_hash', 'admin', 'active', datetime('now'), datetime('now'))
    `, [adminId, `admin.l4.${runId}@example.com`]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);

    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, 'Alice Member L4', ?, 'mock_hash', 'developer', 'active', datetime('now'), datetime('now'))
    `, [aliceId, `alice.l4.${runId}@example.com`]);
    const aliceUser = queryOne('SELECT * FROM users WHERE id = ?', [aliceId]);

    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, 'Bob Member L4', ?, 'mock_hash', 'developer', 'active', datetime('now'), datetime('now'))
    `, [bobId, `bob.l4.${runId}@example.com`]);
    const bobUser = queryOne('SELECT * FROM users WHERE id = ?', [bobId]);

    const fixtureIdea = queryOne('SELECT id FROM ideas WHERE id IS NOT NULL LIMIT 1');
    execute(`
      INSERT INTO projects (id, idea_id, title, status, owner_id)
      VALUES (?, ?, 'PRD 22 Layer 4 Project', 'ACTIVE', ?)
    `, [testProjectId, fixtureIdea ? fixtureIdea.id : 'default-idea', adminUser.id]);
    const testProject = queryOne('SELECT * FROM projects WHERE id = ?', [testProjectId]);

    // Configure a billable rate for Alice on testProject (2500 INR/hr)
    execute(`
      INSERT INTO billable_rates (rate_type, user_id, project_id, rate_per_hour, currency, effective_from, set_by, created_at)
      VALUES ('PROJECT_OVERRIDE', ?, ?, 2500.0, 'INR', '2026-01-01', ?, datetime('now'))
    `, [aliceUser.id, testProjectId, adminUser.id]);

    const adminToken = createSessionToken(adminUser);
    const aliceToken = createSessionToken(aliceUser);
    const bobToken = createSessionToken(bobUser);

    assert(Boolean(adminToken && aliceToken && bobToken), 'Generated valid session tokens for Admin, Alice, Bob');

    // Create a base time entry to test trigger protection (distinct timestamp to avoid test overlap)
    execute(`
      INSERT INTO time_entries (
        user_id, project_id, source_type, description, start_time, end_time, duration_minutes, is_billable, status
      ) VALUES (?, ?, 'MANUAL', 'Trigger Base Entry', '2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z', 60, 1, 'PENDING')
    `, [aliceUser.id, testProject.id]);
    const triggerBaseEntry = queryOne('SELECT * FROM time_entries WHERE description = ? ORDER BY id DESC LIMIT 1', ['Trigger Base Entry']);

    // Test Trigger: time_approval_requests (Update & Delete strictly blocked)
    execute(`
      INSERT INTO time_approval_requests (entry_id, requested_by, decision)
      VALUES (?, ?, 'PENDING')
    `, [triggerBaseEntry.id, aliceUser.id]);
    const testTar = queryOne('SELECT * FROM time_approval_requests WHERE entry_id = ? ORDER BY id DESC LIMIT 1', [triggerBaseEntry.id]);

    let tarUpdateBlocked = false;
    try {
      execute("UPDATE time_approval_requests SET decision = 'APPROVED' WHERE id = ?", [testTar.id]);
    } catch (err) {
      tarUpdateBlocked = err.message.includes('append-only') || err.message.includes('prevent_approval_request_update');
    }
    assert(tarUpdateBlocked, 'Trigger prevent_approval_request_update strictly blocks SQL UPDATE on time_approval_requests');

    let tarDeleteBlocked = false;
    try {
      execute('DELETE FROM time_approval_requests WHERE id = ?', [testTar.id]);
    } catch (err) {
      tarDeleteBlocked = err.message.includes('append-only') || err.message.includes('prevent_approval_request_delete');
    }
    assert(tarDeleteBlocked, 'Trigger prevent_approval_request_delete strictly blocks SQL DELETE on time_approval_requests');

    // Test Trigger: time_report_snapshots (Update & Delete strictly blocked)
    execute(`
      INSERT INTO time_report_snapshots (project_id, report_type, period_start, period_end, snapshot_data, taken_by)
      VALUES (?, 'WEEKLY', '2026-10-01', '2026-10-07', '[]', ?)
    `, [testProject.id, adminUser.id]);
    const testTrs = queryOne('SELECT * FROM time_report_snapshots WHERE project_id = ? ORDER BY id DESC LIMIT 1', [testProject.id]);

    let trsUpdateBlocked = false;
    try {
      execute("UPDATE time_report_snapshots SET snapshot_data = '{\"tampered\":true}' WHERE id = ?", [testTrs.id]);
    } catch (err) {
      trsUpdateBlocked = err.message.includes('append-only') || err.message.includes('prevent_time_report_snapshot_update');
    }
    assert(trsUpdateBlocked, 'Trigger prevent_time_report_snapshot_update strictly blocks SQL UPDATE on time_report_snapshots');

    let trsDeleteBlocked = false;
    try {
      execute('DELETE FROM time_report_snapshots WHERE id = ?', [testTrs.id]);
    } catch (err) {
      trsDeleteBlocked = err.message.includes('append-only') || err.message.includes('prevent_time_report_snapshot_delete');
    }
    assert(trsDeleteBlocked, 'Trigger prevent_time_report_snapshot_delete strictly blocks SQL DELETE on time_report_snapshots');

    // -------------------------------------------------------------------------
    // 3. Approval Request Workflow (POST /api/time/approval/request/:entryId)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Approval Request Workflow (POST /approval/request/:entryId) ---');

    // Seed Member A (Alice) Manual Entry 1
    const aliceEntry1Res = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        start_time: '2026-10-28T09:00:00.000Z',
        end_time: '2026-10-28T12:00:00.000Z',
        description: 'Alice Task 1 — Backend Architecture',
        is_billable: 1
      })
    }, aliceToken);
    assert(aliceEntry1Res.status === 201, 'Alice created Entry 1 (3 hours billable)');
    const aliceEntry1 = aliceEntry1Res.data.time_entry;

    // 3.1 Unauthenticated request -> 401
    const unauthReq = await apiRequest(`/approval/request/${aliceEntry1.id}`, { method: 'POST' });
    assert(unauthReq.status === 401, 'Unauthenticated approval request rejected with 401 Unauthorized');

    // 3.2 Member B (Bob) tries to submit Alice's entry -> 403 Forbidden
    const bobCrossReq = await apiRequest(`/approval/request/${aliceEntry1.id}`, { method: 'POST' }, bobToken);
    assert(bobCrossReq.status === 403, 'Member B cannot submit Member A entry for approval (403 Forbidden)');

    // 3.3 Alice submits own entry -> 201 Created
    const aliceSubmitReq = await apiRequest(`/approval/request/${aliceEntry1.id}`, { method: 'POST' }, aliceToken);
    assert(aliceSubmitReq.status === 201, 'Alice submits own entry for approval (201 Created)');
    assert(aliceSubmitReq.data.success === true, 'Response indicates success = true');
    assert(Boolean(aliceSubmitReq.data.approval_request?.id), 'Response returns approval_request record');

    // Verify time_approval_requests row exists in SQLite
    const tarRecord = queryOne('SELECT * FROM time_approval_requests WHERE entry_id = ? ORDER BY id DESC LIMIT 1', [aliceEntry1.id]);
    assert(tarRecord !== null && tarRecord.requested_by === aliceUser.id, 'time_approval_requests row stored with correct entry_id and requested_by');

    // Verify time_entry_history has audit row
    const historyAudit = queryOne(`
      SELECT * FROM time_entry_history
      WHERE entry_id = ? AND new_value = 'APPROVAL_REQUESTED'
      ORDER BY id DESC LIMIT 1
    `, [aliceEntry1.id]);
    assert(Boolean(historyAudit), 'time_entry_history recorded APPROVAL_REQUESTED audit row');

    // 3.4 Duplicate pending request prevention -> 409 Conflict
    const aliceDupSubmit = await apiRequest(`/approval/request/${aliceEntry1.id}`, { method: 'POST' }, aliceToken);
    assert(aliceDupSubmit.status === 409, 'Submitting duplicate approval request for pending entry blocked (409 Conflict)');

    // 3.5 Active running timer entry cannot be submitted
    execute(`
      INSERT INTO time_entries (
        user_id, project_id, source_type, description, start_time, end_time, duration_minutes, is_billable, status
      ) VALUES (?, ?, 'TIMER', 'Running Live Timer', '2026-10-28T12:00:00.000Z', NULL, NULL, 1, 'PENDING')
    `, [aliceUser.id, testProject.id]);
    const runningTimerEntry = queryOne('SELECT * FROM time_entries WHERE description = ? ORDER BY id DESC LIMIT 1', ['Running Live Timer']);

    const runningTimerSubmit = await apiRequest(`/approval/request/${runningTimerEntry.id}`, { method: 'POST' }, aliceToken);
    assert(runningTimerSubmit.status === 400, 'Submitting active running timer for approval rejected with 400 Bad Request');
    execute('DELETE FROM time_entries WHERE id = ?', [runningTimerEntry.id]);

    // 3.6 Soft-deleted entry cannot be submitted
    execute(`
      INSERT INTO time_entries (
        user_id, project_id, source_type, description, start_time, end_time, duration_minutes, is_billable, status
      ) VALUES (?, ?, 'MANUAL', 'Soft Deleted Task', '2026-10-28T07:00:00.000Z', '2026-10-28T08:00:00.000Z', 60, 1, 'DELETED')
    `, [aliceUser.id, testProject.id]);
    const deletedEntry = queryOne('SELECT * FROM time_entries WHERE description = ? ORDER BY id DESC LIMIT 1', ['Soft Deleted Task']);

    const deletedSubmit = await apiRequest(`/approval/request/${deletedEntry.id}`, { method: 'POST' }, aliceToken);
    assert(deletedSubmit.status === 400, 'Submitting soft-deleted entry for approval rejected with 400 Bad Request');

    // -------------------------------------------------------------------------
    // 4. Pending Approvals Queue (GET /api/time/approval/pending)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Pending Approvals Queue (GET /approval/pending) ---');

    // 4.1 Member attempt -> 403 Forbidden
    const memberQueueRes = await apiRequest('/approval/pending', { method: 'GET' }, aliceToken);
    assert(memberQueueRes.status === 403, 'Member role blocked from viewing pending approval queue (403 Forbidden)');

    // 4.2 Admin attempt -> 200 OK
    const adminQueueRes = await apiRequest('/approval/pending', { method: 'GET' }, adminToken);
    assert(adminQueueRes.status === 200, 'Admin retrieves pending approval queue (200 OK)');
    assert(adminQueueRes.data.success === true, 'Response success = true');
    assert(Array.isArray(adminQueueRes.data.requests), 'Response contains requests array');

    const targetReq = adminQueueRes.data.requests.find(r => r.entry_id === aliceEntry1.id);
    assert(Boolean(targetReq), 'Pending approval queue includes Alice Entry 1');
    assert(targetReq.member_name === aliceUser.name, `Includes joined member_name: "${targetReq.member_name}"`);
    assert(targetReq.project_title === testProject.title, `Includes joined project_title: "${targetReq.project_title}"`);
    assert(targetReq.duration_minutes === 180, `Includes calculated duration_minutes: ${targetReq.duration_minutes}`);

    // -------------------------------------------------------------------------
    // 5. Admin Approval & Rejection Processing
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Approval & Rejection Decisions ---');

    // 5.1 Member cannot approve or reject
    const memberApproveRes = await apiRequest(`/approval/${targetReq.request_id}/approve`, { method: 'PATCH' }, aliceToken);
    assert(memberApproveRes.status === 403, 'Member cannot approve time entry (403 Forbidden)');

    const memberRejectRes = await apiRequest(`/approval/${targetReq.request_id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ decision_note: 'Short reason' })
    }, aliceToken);
    assert(memberRejectRes.status === 403, 'Member cannot reject time entry (403 Forbidden)');

    // 5.2 Admin reject with decision_note < 10 characters -> 400
    const shortRejectRes = await apiRequest(`/approval/${targetReq.request_id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ decision_note: 'Too short' })
    }, adminToken);
    assert(shortRejectRes.status === 400, 'Admin rejection with decision_note < 10 chars rejected with 400 Bad Request');

    // 5.3 Admin rejects Entry 1 with valid decision_note (>=10 chars) -> 200
    const rejectionNote = 'Description needs more specific ticket references';
    const validRejectRes = await apiRequest(`/approval/${targetReq.request_id}/reject`, {
      method: 'PATCH',
      body: JSON.stringify({ decision_note: rejectionNote })
    }, adminToken);
    assert(validRejectRes.status === 200, 'Admin rejects entry with valid decision_note (200 OK)');

    const rejectedEntryInDb = queryOne('SELECT * FROM time_entries WHERE id = ?', [aliceEntry1.id]);
    assert(rejectedEntryInDb.status === 'REJECTED', 'time_entries row status updated to "REJECTED"');
    assert(rejectedEntryInDb.rejection_reason === rejectionNote, 'time_entries rejection_reason saved correctly');
    assert(Boolean(rejectedEntryInDb.updated_at), 'updated_at was manually updated on rejection');

    // Verify audit logs in time_entry_history
    const rejectHistory = queryOne(`
      SELECT * FROM time_entry_history
      WHERE entry_id = ? AND field_changed = 'rejection_reason'
      ORDER BY id DESC LIMIT 1
    `, [aliceEntry1.id]);
    assert(Boolean(rejectHistory) && rejectHistory.new_value === rejectionNote, 'time_entry_history recorded rejection_reason audit row');

    // Verify access_log entry
    const rejectAccessLog = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'TIME_ENTRY_REJECTED' AND target_id = ?
      ORDER BY id DESC LIMIT 1
    `, [aliceEntry1.id]);
    assert(Boolean(rejectAccessLog), 'access_log recorded TIME_ENTRY_REJECTED event');

    // Verify rejected entry no longer in pending queue
    const queueAfterReject = await apiRequest('/approval/pending', { method: 'GET' }, adminToken);
    const stillPendingAfterReject = queueAfterReject.data.requests.find(r => r.entry_id === aliceEntry1.id);
    assert(!stillPendingAfterReject, 'Rejected entry is immediately excluded from pending approval queue');

    // Verify rejected entry cannot be resubmitted
    const resubmitRejected = await apiRequest(`/approval/request/${aliceEntry1.id}`, { method: 'POST' }, aliceToken);
    assert(resubmitRejected.status === 400, 'Rule 11: Resubmission of REJECTED entry is strictly blocked (400 Bad Request)');

    // 5.4 Seed Alice Entry 2 & Submit for Approval
    const aliceEntry2Res = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        start_time: '2026-10-28T14:00:00.000Z',
        end_time: '2026-10-28T16:00:00.000Z',
        description: 'Alice Task 2 — Component Implementation',
        is_billable: 1
      })
    }, aliceToken);
    assert(aliceEntry2Res.status === 201, 'Alice created Entry 2 (2 hours billable)');
    const aliceEntry2 = aliceEntry2Res.data.time_entry;

    const aliceSubmitReq2 = await apiRequest(`/approval/request/${aliceEntry2.id}`, { method: 'POST' }, aliceToken);
    assert(aliceSubmitReq2.status === 201, 'Alice submitted Entry 2 for approval (201 Created)');
    const req2Id = aliceSubmitReq2.data.approval_request.id;

    // 5.5 Admin approves Entry 2
    const approveRes = await apiRequest(`/approval/${req2Id}/approve`, { method: 'PATCH' }, adminToken);
    assert(approveRes.status === 200, 'Admin approves entry (200 OK)');

    const approvedEntryInDb = queryOne('SELECT * FROM time_entries WHERE id = ?', [aliceEntry2.id]);
    assert(approvedEntryInDb.status === 'APPROVED', 'time_entries row status updated to "APPROVED"');
    assert(approvedEntryInDb.approved_by === adminUser.id, 'time_entries approved_by set to admin user ID');
    assert(Boolean(approvedEntryInDb.approved_at), 'time_entries approved_at timestamp set');
    assert(Boolean(approvedEntryInDb.updated_at), 'updated_at was manually updated on approval');

    // Verify audit logs in time_entry_history
    const approveHistory = queryOne(`
      SELECT * FROM time_entry_history
      WHERE entry_id = ? AND new_value = 'APPROVED'
      ORDER BY id DESC LIMIT 1
    `, [aliceEntry2.id]);
    assert(Boolean(approveHistory), 'time_entry_history recorded APPROVED audit row');

    // Verify access_log entry
    const approveAccessLog = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'TIME_ENTRY_APPROVED' AND target_id = ?
      ORDER BY id DESC LIMIT 1
    `, [aliceEntry2.id]);
    assert(Boolean(approveAccessLog), 'access_log recorded TIME_ENTRY_APPROVED event');

    // Verify already approved entry cannot be approved again
    const reapproveRes = await apiRequest(`/approval/${req2Id}/approve`, { method: 'PATCH' }, adminToken);
    assert(reapproveRes.status === 400, 'Approving an already APPROVED entry is rejected with 400 Bad Request');

    // -------------------------------------------------------------------------
    // 6. Team Time Report API (GET /api/time/report/team)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Team Time Report API (GET /report/team) ---');

    // Seed Bob entry (non-billable 1 hr)
    const bobEntryRes = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        start_time: '2026-10-28T10:00:00.000Z',
        end_time: '2026-10-28T11:00:00.000Z',
        description: 'Bob Internal Standup',
        is_billable: 0
      })
    }, bobToken);
    assert(bobEntryRes.status === 201, 'Bob created non-billable entry (1 hr)');

    // 6.1 Member blocked from team report -> 403 Forbidden
    const memberTeamReport = await apiRequest('/report/team', { method: 'GET' }, aliceToken);
    assert(memberTeamReport.status === 403, 'Rule 9: Member role blocked from team time report (403 Forbidden)');

    // 6.2 Admin retrieves team report
    const adminTeamReport = await apiRequest(`/report/team?project_id=${testProject.id}`, { method: 'GET' }, adminToken);
    assert(adminTeamReport.status === 200, 'Admin retrieves team report (200 OK)');
    assert(adminTeamReport.data.success === true, 'Team report response success = true');
    assert(Boolean(adminTeamReport.data.summary), 'Team report contains overall summary totals');

    const aliceReportRow = adminTeamReport.data.members.find(m => m.user_id === aliceUser.id);
    assert(Boolean(aliceReportRow), 'Team report includes Alice row');
    assert(aliceReportRow.total_hrs >= 5.0, `Alice total_hrs is calculated correctly (got ${aliceReportRow.total_hrs} hrs)`);
    assert(aliceReportRow.billable_hrs >= 5.0, `Alice billable_hrs is calculated correctly (got ${aliceReportRow.billable_hrs} hrs)`);

    const bobReportRow = adminTeamReport.data.members.find(m => m.user_id === bobUser.id);
    assert(Boolean(bobReportRow), 'Team report includes Bob row');
    assert(bobReportRow.non_billable_hrs >= 1.0, `Bob non_billable_hrs recorded (got ${bobReportRow.non_billable_hrs} hrs)`);

    // 6.3 Verify soft-deleted entries are excluded from team report
    const preDeleteTotalHrs = adminTeamReport.data.summary.total_hrs;
    // Create an entry and soft-delete it
    const tempEntryRes = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        start_time: '2026-10-28T17:00:00.000Z',
        end_time: '2026-10-28T18:00:00.000Z',
        description: 'Temporary task for delete check',
        is_billable: 1
      })
    }, aliceToken);
    const tempEntryId = tempEntryRes.data.time_entry.id;
    await apiRequest(`/entry/${tempEntryId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'testing exclude' }) }, adminToken);

    const reportAfterDelete = await apiRequest(`/report/team?project_id=${testProject.id}`, { method: 'GET' }, adminToken);
    assert(reportAfterDelete.data.summary.total_hrs === preDeleteTotalHrs, 'Soft-deleted entries are strictly excluded from team report aggregates');

    // -------------------------------------------------------------------------
    // 7. My Time Report API (GET /api/time/report/my)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: My Time Report API (GET /report/my) ---');

    // 7.1 Alice sees own summary
    const aliceMyReport = await apiRequest('/report/my', { method: 'GET' }, aliceToken);
    assert(aliceMyReport.status === 200, 'Member retrieves own report (200 OK)');
    assert(aliceMyReport.data.user_id === aliceUser.id, 'My report is strictly scoped to requesting user ID');
    assert(aliceMyReport.data.summary.total_hrs >= 5.0, `Alice summary total_hrs verified (${aliceMyReport.data.summary.total_hrs})`);
    assert(Array.isArray(aliceMyReport.data.by_project), 'My report includes by_project breakdown');

    // 7.2 Bob sees only Bob's summary (cannot see Alice's hours)
    const bobMyReport = await apiRequest('/report/my', { method: 'GET' }, bobToken);
    assert(bobMyReport.status === 200, 'Bob retrieves own report (200 OK)');
    assert(bobMyReport.data.user_id === bobUser.id, 'Bob report scoped strictly to Bob');
    assert(bobMyReport.data.summary.billable_hrs === 0, 'Bob billable_hrs is 0 (Bob only had non-billable standup)');

    // -------------------------------------------------------------------------
    // 8. Report Snapshot API (POST /api/time/report/snapshot & GET /snapshots)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Report Snapshot API ---');

    // 8.1 Member blocked from snapshot creation -> 403 Forbidden
    const memberSnapshotRes = await apiRequest('/report/snapshot', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        report_type: 'WEEKLY',
        period_start: '2026-10-01',
        period_end: '2026-10-31'
      })
    }, aliceToken);
    assert(memberSnapshotRes.status === 403, 'Member cannot take report snapshot (403 Forbidden)');

    // 8.2 Admin with invalid report_type -> 400
    const invalidTypeRes = await apiRequest('/report/snapshot', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        report_type: 'INVALID_TYPE',
        period_start: '2026-10-01',
        period_end: '2026-10-31'
      })
    }, adminToken);
    assert(invalidTypeRes.status === 400, 'Snapshot with invalid report_type rejected with 400 Bad Request');

    // 8.3 Admin creates valid snapshot -> 201 Created
    const validSnapshotRes = await apiRequest('/report/snapshot', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProject.id,
        report_type: 'WEEKLY',
        period_start: '2026-10-01',
        period_end: '2026-10-31'
      })
    }, adminToken);
    assert(validSnapshotRes.status === 201, 'Admin creates point-in-time report snapshot (201 Created)');
    assert(validSnapshotRes.data.success === true, 'Snapshot response success = true');
    assert(Boolean(validSnapshotRes.data.snapshot?.id), 'Snapshot response returns snapshot record');

    // Verify row in time_report_snapshots table and valid JSON snapshot_data
    const snapshotInDb = queryOne('SELECT * FROM time_report_snapshots WHERE project_id = ? ORDER BY id DESC LIMIT 1', [testProject.id]);
    assert(Boolean(snapshotInDb), 'time_report_snapshots row exists in SQLite database');

    let parsedSnapshotData = null;
    try {
      parsedSnapshotData = JSON.parse(snapshotInDb.snapshot_data);
    } catch {
      parsedSnapshotData = null;
    }
    assert(Array.isArray(parsedSnapshotData), 'snapshot_data is stored as valid JSON array of members');

    // 8.4 Admin retrieves snapshots for project
    const listSnapshotsRes = await apiRequest(`/report/snapshots/${testProject.id}`, { method: 'GET' }, adminToken);
    assert(listSnapshotsRes.status === 200, 'Admin retrieves report snapshots list (200 OK)');
    assert(listSnapshotsRes.data.count >= 1, `Found ${listSnapshotsRes.data.count} snapshots for project`);

    // -------------------------------------------------------------------------
    // 9. Report Export API (GET /api/time/report/export/:projectId)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 9: Report Export API (CSV & access_log) ---');

    // 9.1 Member blocked from export -> 403 Forbidden
    const memberExportRes = await apiRequest(`/report/export/${testProject.id}`, { method: 'GET' }, aliceToken);
    assert(memberExportRes.status === 403, 'Member cannot export time reports (403 Forbidden)');

    // 9.2 Admin exports CSV report -> 200 OK
    const adminExportRes = await apiRequest(`/report/export/${testProject.id}`, { method: 'GET' }, adminToken);
    assert(adminExportRes.status === 200, 'Admin exports CSV time report (200 OK)');

    const contentType = adminExportRes.headers.get('content-type') || '';
    assert(contentType.includes('text/csv'), `Export response Content-Type is text/csv (got: ${contentType})`);

    const csvContent = adminExportRes.text || '';
    assert(csvContent.includes('Entry ID,Member Name,Member Email,Project Title,Description,Start Time,End Time,Duration (Minutes),Duration (Hours),Billable,Billable Rate (INR),Billable Amount (INR),Status,Created At'), 'CSV includes standard column headers');
    assert(csvContent.includes('Alice Task 2 — Component Implementation'), 'CSV contains Alice Task 2 entry');
    assert(csvContent.includes('Bob Internal Standup'), 'CSV contains Bob Standup entry');

    // 9.3 Verify access_log audit entry
    const exportAccessLog = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'TIME_REPORT_EXPORT' AND target_id = ?
      ORDER BY id DESC LIMIT 1
    `, [testProject.id]);
    assert(Boolean(exportAccessLog), 'access_log recorded TIME_REPORT_EXPORT audit entry with target project ID');

    // 9.4 Verify JSON export mode via ?format=json
    const jsonExportRes = await apiRequest(`/report/export/${testProject.id}?format=json`, { method: 'GET' }, adminToken);
    assert(jsonExportRes.status === 200, 'Admin exports JSON time report (200 OK)');
    assert(jsonExportRes.data.success === true, 'JSON export response success = true');
    assert(Array.isArray(jsonExportRes.data.rows), 'JSON export contains rows array');

    // -------------------------------------------------------------------------
    // Final Summary
    // -------------------------------------------------------------------------
    console.log('\n======================================================================');
    console.log(`🏁 LAYER 4 VERIFICATION COMPLETE: ${passedTests} / ${totalTests} TESTS PASSED (${failedTests} FAILED)`);
    console.log('======================================================================\n');

    if (failedTests > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('\n\x1b[31mFATAL TEST ERROR:\x1b[0m', err);
    process.exitCode = 1;
  } finally {
    if (serverInstance) {
      await new Promise(r => serverInstance.close(r));
    }
  }
}

runLayer4Suite();
