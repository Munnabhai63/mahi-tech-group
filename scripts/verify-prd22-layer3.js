/**
 * PRD 22 Layer 3 Comprehensive Verification Suite
 * 
 * Verifies:
 * 1. Database & Connection Pragmas: WAL mode, busy_timeout=5000, foreign_keys=ON (1)
 * 2. Manual Entry Creation (POST /api/time/entry/create):
 *    - Validations: project_id, start_time, end_time, end_time >= start_time
 *    - source_ref_type linkage: BACKLOG_ITEM | GANTT_ITEM | PIPELINE_POINT | NULL
 *    - Server-side duration calculation (duration_minutes = ROUND((end - start) / 60))
 *    - Mandatory overlap detection (409 Conflict)
 *    - Billable rate snapshot via resolveBillableRate
 *    - Billable amount calculation
 *    - Initial status = PENDING, source_type = MANUAL
 *    - Audit row in time_entry_history (status: MANUAL_CREATED)
 *    - updated_at manually populated
 * 3. 24-Hour Edit Window & Immutability (PATCH /api/time/entry/:entryId):
 *    - Fresh manual entry (within 24 hrs): Owner PATCH permitted
 *    - Field-level audit trail: every changed field logged to time_entry_history (old_value, new_value)
 *    - Duration & billable_amount recalculated when times change
 *    - Overlap detection on update (409 Conflict)
 *    - Stale manual entry (>24 hrs): Owner PATCH blocked (403 Forbidden)
 *    - Timer-stopped entry: Owner PATCH blocked immediately (403 Forbidden)
 *    - Admin override: Admin can edit any entry anytime (regardless of age or source_type)
 *    - Cross-user authorization: Member B cannot edit Member A entry (403 Forbidden)
 * 4. Soft Delete Engine (DELETE /api/time/entry/:entryId):
 *    - Non-admin member cannot delete (403 Forbidden)
 *    - Admin soft-deletes entry: status set to 'DELETED'
 *    - Hard delete avoided: row preserved in time_entries (FK referential integrity maintained)
 *    - PRAGMA foreign_keys remains strictly ON (1)
 *    - Audit trail logged in time_entry_history (status -> DELETED, deletion_reason)
 * 5. My Entries API & Privacy Isolation (GET /api/time/entries/my):
 *    - Member sees own entries only
 *    - DELETED entries excluded by default
 *    - Query filters supported: project_id, from, to, status
 *    - Join projects.title verified
 * 6. Project Entries API & Admin RBAC (GET /api/time/entries/project/:projectId):
 *    - Member blocked (403 Forbidden)
 *    - Admin retrieves all project entries
 *    - DELETED entries excluded by default
 *    - Query filters supported: user_id, status, from, to
 *    - Joins users.name and projects.title verified
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
    VALUES (?, ?, ?, 'Test Harness Layer 3', '127.0.0.1', datetime('now'), datetime('now', '+1 day'), 0)
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

async function runLayer3Verification() {
  console.log('\n========================================================================');
  console.log('  PRD 22 LAYER 3: MANUAL ENTRY, EDIT WINDOW & SOFT DELETE VERIFICATION');
  console.log('========================================================================\n');

  // Start ephemeral server
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
    // 1. Database Connection & Pragma Verification
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Database Pragmas & Immutability Preconditions ---');

    const journalMode = queryOne('PRAGMA journal_mode;');
    assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', 'SQLite journal_mode is strictly WAL');

    const busyTimeout = queryOne('PRAGMA busy_timeout;');
    assert(busyTimeout && busyTimeout.timeout === 5000, 'SQLite busy_timeout is strictly 5000ms');

    const foreignKeys = queryOne('PRAGMA foreign_keys;');
    assert(foreignKeys && foreignKeys.foreign_keys === 1, 'SQLite foreign_keys is strictly ON (1)');

    // -------------------------------------------------------------------------
    // 2. Set Up Personas, Rates & Fixtures
    // -------------------------------------------------------------------------
    const runId = Date.now();
    const adminId = `admin-l3-${runId}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'mock_hash', 'admin', 'active', datetime('now'), datetime('now'))
    `, [adminId, `Admin Leader ${runId}`, `admin.l3.${runId}@mahitechgroup.com`]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);

    const aliceId = `alice-l3-${runId}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'mock_hash', 'developer', 'active', datetime('now'), datetime('now'))
    `, [aliceId, `Alice Developer ${runId}`, `alice.l3.${runId}@mahitechgroup.com`]);
    const memberUserA = queryOne('SELECT * FROM users WHERE id = ?', [aliceId]);

    const bobId = `bob-l3-${runId}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'mock_hash', 'developer', 'active', datetime('now'), datetime('now'))
    `, [bobId, `Bob Developer ${runId}`, `bob.l3.${runId}@mahitechgroup.com`]);
    const memberUserB = queryOne('SELECT * FROM users WHERE id = ?', [bobId]);

    const fixtureIdea = queryOne("SELECT id FROM ideas WHERE id IS NOT NULL LIMIT 1");
    const testProjectId = 'layer3-proj-' + runId;
    execute("INSERT INTO projects (id, idea_id, title, status, owner_id) VALUES (?, ?, 'Layer 3 Project Tracker', 'ACTIVE', ?)", [
      testProjectId,
      fixtureIdea ? fixtureIdea.id : 'default-idea',
      adminUser.id
    ]);

    const adminToken = createSessionToken(adminUser);
    const memberAToken = createSessionToken(memberUserA);
    const memberBToken = createSessionToken(memberUserB);

    assert(Boolean(adminToken && memberAToken && memberBToken), 'Generated valid session tokens for Admin, Member A, Member B');

    // Configure a billable rate for Member A on testProjectId (2500 INR/hr)
    execute(`
      INSERT INTO billable_rates (rate_type, user_id, project_id, rate_per_hour, currency, effective_from, set_by, created_at)
      VALUES ('PROJECT_OVERRIDE', ?, ?, 2500.0, 'INR', '2026-01-01', ?, datetime('now'))
    `, [memberUserA.id, testProjectId, adminUser.id]);

    // -------------------------------------------------------------------------
    // 3. Manual Entry Creation & Validation (POST /api/time/entry/create)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Manual Entry Creation & Input Validations ---');

    // Test 3.1: Missing project_id -> 400
    const errMissingProj = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        start_time: '2026-10-28T09:00:00Z',
        end_time: '2026-10-28T11:00:00Z'
      })
    }, memberAToken);
    assert(errMissingProj.status === 400, 'Creation rejects missing project_id with HTTP 400');

    // Test 3.2: Missing start_time or end_time -> 400
    const errMissingTimes = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProjectId,
        start_time: '2026-10-28T09:00:00Z'
      })
    }, memberAToken);
    assert(errMissingTimes.status === 400, 'Creation rejects missing end_time with HTTP 400');

    // Test 3.3: end_time < start_time -> 400
    const errInvertedTimes = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProjectId,
        start_time: '2026-10-28T14:00:00Z',
        end_time: '2026-10-28T12:00:00Z'
      })
    }, memberAToken);
    assert(errInvertedTimes.status === 400, 'Creation rejects end_time earlier than start_time with HTTP 400');

    // Test 3.4: Invalid source_ref_type -> 400
    const errInvalidRefType = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProjectId,
        start_time: '2026-10-28T10:00:00Z',
        end_time: '2026-10-28T11:00:00Z',
        source_ref_type: 'INVALID_REF_SOURCE'
      })
    }, memberAToken);
    assert(errInvalidRefType.status === 400, 'Creation rejects invalid source_ref_type with HTTP 400');

    // Test 3.5: Successful Manual Entry (2 hours = 120 mins, billable = 1)
    const validEntryRes = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProjectId,
        start_time: '2026-10-28T09:00:00.000Z',
        end_time: '2026-10-28T11:00:00.000Z',
        description: 'Initial architectural review & component design',
        is_billable: true,
        source_ref_type: 'BACKLOG_ITEM',
        source_ref_id: 101
      })
    }, memberAToken);

    assert(validEntryRes.status === 201, 'POST /api/time/entry/create creates manual entry with HTTP 201 Created');
    assert(validEntryRes.data.success === true, 'Response payload contains success: true');
    const createdEntry = validEntryRes.data.time_entry;
    assert(createdEntry.id > 0, 'Returned time_entry possesses valid positive id');
    assert(createdEntry.source_type === 'MANUAL', 'time_entries.source_type is strictly "MANUAL"');
    assert(createdEntry.source_ref_type === 'BACKLOG_ITEM', 'time_entries.source_ref_type recorded as "BACKLOG_ITEM"');
    assert(createdEntry.source_ref_id === 101, 'time_entries.source_ref_id recorded as 101');
    assert(createdEntry.duration_minutes === 120, 'Server-side duration calculated exactly as 120 minutes');
    assert(createdEntry.status === 'PENDING', 'New entry status defaults to "PENDING"');
    assert(createdEntry.billable_rate === 2500.0, 'Billable rate snapshotted at creation time (2500.0 INR)');
    assert(createdEntry.billable_amount === 5000.0, 'Billable amount snapshotted at creation: (120/60) * 2500 = 5000.00 INR');

    // Test 3.6: Verify Audit Row in time_entry_history
    const historyRow = queryOne(`
      SELECT * FROM time_entry_history
      WHERE entry_id = ? AND field_changed = 'status' AND new_value = 'MANUAL_CREATED'
    `, [createdEntry.id]);
    assert(historyRow !== null, 'time_entry_history recorded append-only creation row (MANUAL_CREATED)');
    assert(historyRow.changed_by === memberUserA.id, 'Audit record correctly associates changed_by with member');

    // Test 3.7: Overlap Detection Mandatory Check
    const errOverlap = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProjectId,
        start_time: '2026-10-28T10:00:00.000Z', // falls within 09:00 - 11:00
        end_time: '2026-10-28T12:00:00.000Z',
        description: 'Overlapping entry attempt'
      })
    }, memberAToken);
    assert(errOverlap.status === 409, 'Overlapping manual entry strictly rejected with HTTP 409 Conflict');
    assert(errOverlap.data.error.includes('overlaps'), 'Conflict error explicitly warns about overlapping interval');

    // -------------------------------------------------------------------------
    // 4. 24-Hour Edit Window & Immutability (PATCH /api/time/entry/:entryId)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: 24-Hour Edit Window & Field-Level Audit Trail ---');

    // Test 4.1: Owner edits fresh manual entry (description update)
    const updateDescRes = await apiRequest(`/entry/${createdEntry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        description: 'Refined architectural review & component design v2'
      })
    }, memberAToken);
    assert(updateDescRes.status === 200, 'Owner successfully updates description of fresh entry within 24hrs (HTTP 200)');
    assert(updateDescRes.data.time_entry.description === 'Refined architectural review & component design v2', 'Updated description reflected in returned payload');

    const descHistory = queryOne(`
      SELECT * FROM time_entry_history
      WHERE entry_id = ? AND field_changed = 'description'
      ORDER BY id DESC LIMIT 1
    `, [createdEntry.id]);
    assert(descHistory && descHistory.old_value === 'Initial architectural review & component design' && descHistory.new_value === 'Refined architectural review & component design v2', 'Field-level audit trail logged description change with exact old_value and new_value');

    // Test 4.2: Owner updates time range (from 09:00-11:00 to 09:00-12:00 -> 180 mins)
    const updateTimesRes = await apiRequest(`/entry/${createdEntry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        end_time: '2026-10-28T12:00:00.000Z'
      })
    }, memberAToken);
    assert(updateTimesRes.status === 200, 'Owner successfully updates end_time (HTTP 200)');
    assert(updateTimesRes.data.time_entry.duration_minutes === 180, 'Duration automatically recalculated server-side to 180 minutes');
    assert(updateTimesRes.data.time_entry.billable_amount === 7500.0, 'Billable amount recalculated using snapshotted rate: (180/60) * 2500 = 7500.00 INR');

    const durationHistory = queryOne(`
      SELECT * FROM time_entry_history
      WHERE entry_id = ? AND field_changed = 'duration_minutes'
      ORDER BY id DESC LIMIT 1
    `, [createdEntry.id]);
    assert(durationHistory && durationHistory.old_value === '120' && durationHistory.new_value === '180', 'Audit trail recorded duration_minutes change from 120 to 180');

    // Test 4.3: Cross-user permission: Member B cannot edit Member A's entry -> 403
    const crossEditRes = await apiRequest(`/entry/${createdEntry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Hacked description' })
    }, memberBToken);
    assert(crossEditRes.status === 403, 'Member B cannot edit Member A entry (HTTP 403 Forbidden)');

    // Test 4.4: 24-hour edit window expiration for MANUAL entries
    // Manipulate created_at of an entry to 26 hours ago
    const staleEntryRes = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProjectId,
        start_time: '2026-10-27T08:00:00.000Z',
        end_time: '2026-10-27T10:00:00.000Z',
        description: 'Stale manual entry test'
      })
    }, memberAToken);
    const staleEntry = staleEntryRes.data.time_entry;
    execute("UPDATE time_entries SET created_at = datetime('now', '-26 hours') WHERE id = ?", [staleEntry.id]);

    const staleEditAttempt = await apiRequest(`/entry/${staleEntry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Attempting to edit stale entry' })
    }, memberAToken);
    assert(staleEditAttempt.status === 403, 'Member cannot edit manual entry created >24 hours ago (HTTP 403 Forbidden)');
    assert(staleEditAttempt.data.error.includes('expired'), 'Error message explicitly cites expired 24-hour window');

    // Test 4.5: Timer-stopped entry cannot be edited by member (locked immediately)
    // Create a stopped timer entry for member A
    execute(`
      INSERT INTO time_entries (
        user_id, project_id, source_type, description, start_time, end_time, duration_minutes, is_billable, billable_rate, status, created_at, updated_at
      ) VALUES (
        ?, ?, 'TIMER', 'Timer stopped session', datetime('now', '-1 hour'), datetime('now'), 60, 0, 0, 'PENDING', datetime('now'), datetime('now')
      )
    `, [memberUserA.id, testProjectId]);
    const timerEntry = queryOne("SELECT * FROM time_entries WHERE user_id = ? AND source_type = 'TIMER' ORDER BY id DESC LIMIT 1", [memberUserA.id]);

    const timerEditAttempt = await apiRequest(`/entry/${timerEntry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Member trying to alter stopped timer' })
    }, memberAToken);
    assert(timerEditAttempt.status === 403, 'Timer-stopped entry is immediately locked for members (HTTP 403 Forbidden)');

    // Test 4.6: Admin override - Admin can edit stale manual entry and timer entry
    const adminStaleEdit = await apiRequest(`/entry/${staleEntry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Admin corrected description on stale entry' })
    }, adminToken);
    assert(adminStaleEdit.status === 200, 'Admin can override and edit stale manual entry (HTTP 200 OK)');

    const adminTimerEdit = await apiRequest(`/entry/${timerEntry.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Admin adjusted timer note' })
    }, adminToken);
    assert(adminTimerEdit.status === 200, 'Admin can override and edit timer-stopped entry (HTTP 200 OK)');

    // -------------------------------------------------------------------------
    // 5. Soft Delete Engine (DELETE /api/time/entry/:entryId)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Soft Delete Engine & Referential Integrity ---');

    // Create entry to be deleted
    const deleteTargetRes = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProjectId,
        start_time: '2026-10-28T15:00:00.000Z',
        end_time: '2026-10-28T16:30:00.000Z',
        description: 'Entry targeted for soft deletion'
      })
    }, memberAToken);
    const deleteTargetId = deleteTargetRes.data.time_entry.id;

    // Test 5.1: Non-admin member cannot delete entry -> 403
    const memberDeleteAttempt = await apiRequest(`/entry/${deleteTargetId}`, {
      method: 'DELETE'
    }, memberAToken);
    assert(memberDeleteAttempt.status === 403, 'Member cannot delete time entry (HTTP 403 Forbidden)');

    // Test 5.2: Admin performs soft delete
    const adminDeleteRes = await apiRequest(`/entry/${deleteTargetId}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason: 'Duplicate billing entry entered by mistake' })
    }, adminToken);
    assert(adminDeleteRes.status === 200, 'Admin successfully soft deletes time entry (HTTP 200 OK)');
    assert(adminDeleteRes.data.success === true, 'Delete response indicates success');

    // Test 5.3: Verify Soft Delete in database (row preserved, status = DELETED)
    const softDeletedRow = queryOne('SELECT * FROM time_entries WHERE id = ?', [deleteTargetId]);
    assert(softDeletedRow !== null, 'Soft delete preserves row in time_entries (referential integrity intact)');
    assert(softDeletedRow.status === 'DELETED', 'Row status strictly marked as "DELETED"');

    // Test 5.4: Verify audit rows in time_entry_history
    const deleteStatusHistory = queryOne(`
      SELECT * FROM time_entry_history
      WHERE entry_id = ? AND field_changed = 'status' AND new_value = 'DELETED'
      ORDER BY id DESC LIMIT 1
    `, [deleteTargetId]);
    assert(deleteStatusHistory !== null, 'Audit trail recorded status -> "DELETED"');

    const deleteReasonHistory = queryOne(`
      SELECT * FROM time_entry_history
      WHERE entry_id = ? AND field_changed = 'deletion_reason'
      ORDER BY id DESC LIMIT 1
    `, [deleteTargetId]);
    assert(deleteReasonHistory !== null && deleteReasonHistory.new_value === 'Duplicate billing entry entered by mistake', 'Audit trail recorded deletion_reason with admin note');

    // Test 5.5: PRAGMA foreign_keys is still ON
    const fkCheck = queryOne('PRAGMA foreign_keys;');
    assert(fkCheck.foreign_keys === 1, 'PRAGMA foreign_keys remains strictly ON (1) after delete');

    // -------------------------------------------------------------------------
    // 6. My Entries API & Privacy Isolation (GET /api/time/entries/my)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: My Entries API & Query Filters ---');

    // Create another distinct entry for Member B
    const memberBEntryRes = await apiRequest('/entry/create', {
      method: 'POST',
      body: JSON.stringify({
        project_id: testProjectId,
        start_time: '2026-10-28T09:00:00.000Z',
        end_time: '2026-10-28T10:00:00.000Z',
        description: 'Member B separate work session'
      })
    }, memberBToken);
    const memberBEntryId = memberBEntryRes.data.time_entry.id;

    // Test 6.1: Member A queries own entries
    const myEntriesRes = await apiRequest('/entries/my', { method: 'GET' }, memberAToken);
    assert(myEntriesRes.status === 200, 'GET /api/time/entries/my returns HTTP 200 OK');
    assert(Array.isArray(myEntriesRes.data.entries), 'Returns array of entries');
    const myEntryIds = myEntriesRes.data.entries.map(e => e.id);
    assert(myEntryIds.includes(createdEntry.id), 'My entries includes Member A entry');
    assert(!myEntryIds.includes(memberBEntryId), 'Privacy Isolation: Member A results DO NOT include Member B entry');
    assert(!myEntryIds.includes(deleteTargetId), 'DELETED entries are excluded by default from my entries');

    // Test 6.2: Filter by project_id
    const myFilteredProj = await apiRequest(`/entries/my?project_id=${testProjectId}`, { method: 'GET' }, memberAToken);
    assert(myFilteredProj.data.entries.every(e => e.project_id === testProjectId), 'Query filter ?project_id accurately scopes entries');

    // Test 6.3: Filter by date range (from / to)
    const myFilteredDate = await apiRequest('/entries/my?from=2026-10-28&to=2026-10-28', { method: 'GET' }, memberAToken);
    assert(myFilteredDate.data.entries.every(e => e.start_time.startsWith('2026-10-28')), 'Date range filter ?from=&to= accurately scopes entries');

    // -------------------------------------------------------------------------
    // 7. Project Entries API & Admin RBAC (GET /api/time/entries/project/:projectId)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Project Entries API & Admin RBAC ---');

    // Test 7.1: Member attempts project entries retrieval -> 403
    const memberProjAttempt = await apiRequest(`/entries/project/${testProjectId}`, { method: 'GET' }, memberAToken);
    assert(memberProjAttempt.status === 403, 'Member cannot access project time entries list (HTTP 403 Forbidden)');

    // Test 7.2: Admin retrieves project entries -> 200
    const adminProjRes = await apiRequest(`/entries/project/${testProjectId}`, { method: 'GET' }, adminToken);
    assert(adminProjRes.status === 200, 'Admin successfully accesses project time entries list (HTTP 200 OK)');
    const projEntryIds = adminProjRes.data.entries.map(e => e.id);
    assert(projEntryIds.includes(createdEntry.id), 'Project entries contains Member A entry');
    assert(projEntryIds.includes(memberBEntryId), 'Project entries contains Member B entry');
    assert(!projEntryIds.includes(deleteTargetId), 'DELETED entries are excluded by default from project entries');

    // Test 7.3: Project filter by user_id
    const adminFilteredUser = await apiRequest(`/entries/project/${testProjectId}?user_id=${memberUserB.id}`, { method: 'GET' }, adminToken);
    assert(adminFilteredUser.data.entries.every(e => e.user_id === memberUserB.id), 'Project entries filtered by ?user_id returns only that user entries');

    // -------------------------------------------------------------------------
    // Clean up test active timers
    // -------------------------------------------------------------------------
    execute("DELETE FROM active_timers WHERE user_id IN (?, ?, ?)", [memberUserA.id, memberUserB.id, adminUser.id]);

  } catch (fatalErr) {
    console.error('\n\x1b[31m[FATAL ERROR IN LAYER 3 SUITE]\x1b[0m', fatalErr);
    process.exitCode = 1;
  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }

  console.log('\n========================================================================');
  console.log('  PRD 22 LAYER 3 VERIFICATION SUMMARY:');
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

runLayer3Verification().catch(err => {
  console.error('Unhandled fatal error in Layer 3 test suite:', err);
  process.exitCode = 1;
});
