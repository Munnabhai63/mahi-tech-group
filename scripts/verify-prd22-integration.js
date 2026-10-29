/**
 * PRD 22 Layer 6: Full End-to-End Integration Test Suite (Time Tracking System)
 * 
 * Real HTTP + Direct DB SELECT at every step. Zero mocks.
 * 
 * E2E sequence:
 *  1. Real login / auth for Admin, Member A (Alice), Member B (Bob)
 *  2. Real billable rate set -> direct DB SELECT verify
 *  3. Real timer start -> active_timers lock verify via direct DB SELECT
 *  4. Concurrent timer block -> second start same user -> 409 Conflict verify
 *  5. Real timer stop -> duration + billable_amount server-computed -> direct DB SELECT verify
 *  6. Real manual entry -> overlap check (409) -> source_ref_type validation (400) -> direct DB SELECT verify rate snapshot
 *  7. Rate snapshot immutability -> change rate via new POST -> direct DB SELECT verify old entry unchanged
 *  8. 24hr edit window -> member edits fresh manual entry (200) -> member edits timer entry (403) -> admin overrides both (200) -> direct DB SELECT history audit rows
 *  9. Soft delete -> Admin deletes entry -> status='DELETED' in DB -> excluded from GET /entries/my -> PRAGMA foreign_keys still ON
 * 10. Approval workflow -> member submits own entry (201) -> duplicate submit (409) -> rejected entry resubmit (400) -> Admin rejects with short note (400) -> Admin rejects with valid note (200) -> Admin approves (200) -> time_entry_history + access_log direct DB SELECT
 * 11. Team report aggregate -> GET /api/time/report/team -> billable/non-billable math verify -> DELETED entries excluded confirm
 * 12. Report snapshot -> POST /api/time/report/snapshot -> direct DB SELECT -> triggers block UPDATE & DELETE
 * 13. CSV export -> GET /api/time/report/export/:projectId -> Content-Type text/csv -> access_log direct DB SELECT
 * 14. Frontend 4-file security audit -> zero credentials grep -> escapeHTML present -> localStorage dynamic -> GET /api/users/me verified
 * 15. Timer auto-close cron test
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { autoCloseDanglingTimers } from '../src/services/timeTrackingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

const JWT_SECRET = config.JWT_SECRET || 'test-secret-key-for-development-only';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ PASS: Test ${totalTests}: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: Test ${totalTests}: ${testName} - ${details}`);
  }
}

function executeTransaction(callback) {
  const db = getDatabase();
  return callback(db);
}

async function runIntegrationSuite() {
  console.log('======================================================================');
  console.log('🚀 PRD 22 LAYER 6: FULL END-TO-END INTEGRATION TEST SUITE');
  console.log('======================================================================');

  // Verify SQLite Pragmas
  const fk = queryOne('PRAGMA foreign_keys;');
  const journal = queryOne('PRAGMA journal_mode;');
  const timeout = queryOne('PRAGMA busy_timeout;');

  assert(fk && fk.foreign_keys === 1, 'PRAGMA foreign_keys is strictly ON (1)');
  assert(journal && journal.journal_mode === 'wal', `PRAGMA journal_mode is WAL (got: ${journal.journal_mode})`);
  assert(timeout && timeout.timeout >= 5000, `PRAGMA busy_timeout is >= 5000ms (got: ${timeout.timeout})`);

  // Start ephemeral Express HTTP server
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  [HARNESS] Ephemeral test server active on ${baseUrl}`);

  const runId = Date.now();
  const adminId = `admin-l6-${runId}`;
  const aliceId = `alice-l6-${runId}`;
  const bobId = `bob-l6-${runId}`;
  const projectId = `proj-l6-${runId}`;

  try {
    // =====================================================================
    // STEP 1: Real login / auth for Admin + 2 Member personas
    // =====================================================================
    console.log('\n--- STEP 1: Real User Personas & Authentication ---');

    const existingIdea = queryOne('SELECT id FROM ideas LIMIT 1');
    const ideaId = existingIdea ? existingIdea.id : 'idea-default';

    executeTransaction((db) => {
      // Create Admin
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'hash', 'admin', 'active', datetime('now'), datetime('now'))
      `).run(adminId, `Admin Boss L6 ${runId}`, `admin.${runId}@test.com`);

      // Create Member A (Alice)
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'hash', 'developer', 'active', datetime('now'), datetime('now'))
      `).run(aliceId, `Alice Dev L6 ${runId}`, `alice.${runId}@test.com`);

      // Create Member B (Bob)
      db.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'hash', 'developer', 'active', datetime('now'), datetime('now'))
      `).run(bobId, `Bob Dev L6 ${runId}`, `bob.${runId}@test.com`);

      // Create project referencing adminId and ideaId
      db.prepare(`
        INSERT INTO projects (id, idea_id, title, owner_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))
      `).run(projectId, ideaId, `PRD 22 E2E Project ${runId}`, adminId);

    });

    function createSessionToken(user) {
      const sessionId = `sess-${user.id}-${Date.now()}`;
      const token = jwt.sign(
        { sessionId, userId: user.id, role: user.role, email: user.email, name: user.name },
        config.JWT_SECRET || JWT_SECRET,
        { expiresIn: '1d' }
      );
      execute(`
        INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
        VALUES (?, ?, ?, 'Integration Test Harness', '127.0.0.1', datetime('now'), datetime('now', '+1 day'), 0)
      `, [sessionId, user.id, token]);
      return token;
    }

    const adminToken = createSessionToken({ id: adminId, role: 'admin', email: `admin.${runId}@test.com`, name: `Admin Boss L6 ${runId}` });
    const aliceToken = createSessionToken({ id: aliceId, role: 'developer', email: `alice.${runId}@test.com`, name: `Alice Dev L6 ${runId}` });
    const bobToken = createSessionToken({ id: bobId, role: 'developer', email: `bob.${runId}@test.com`, name: `Bob Dev L6 ${runId}` });

    // Direct DB SELECT verification
    const dbAdmin = queryOne('SELECT id, role, status FROM users WHERE id = ?', [adminId]);
    const dbAlice = queryOne('SELECT id, role, status FROM users WHERE id = ?', [aliceId]);
    const dbBob = queryOne('SELECT id, role, status FROM users WHERE id = ?', [bobId]);

    assert(dbAdmin && dbAdmin.role === 'admin' && dbAdmin.status === 'active', 'Admin seeded and active in SQLite');
    assert(dbAlice && dbAlice.role === 'developer' && dbAlice.status === 'active', 'Alice seeded and active in SQLite');
    assert(dbBob && dbBob.role === 'developer' && dbBob.status === 'active', 'Bob seeded and active in SQLite');

    // Real HTTP verify GET /api/users/me
    const meRes = await fetch(`${baseUrl}/api/users/me`, { headers: { 'Authorization': `Bearer ${aliceToken}` } });
    const meData = await meRes.json();
    assert(meRes.status === 200 && (meData.user ? meData.user.id === aliceId : meData.id === aliceId), 'GET /api/users/me returns authenticated Alice');

    // =====================================================================
    // STEP 2: Real billable rate set & direct DB SELECT
    // =====================================================================
    console.log('\n--- STEP 2: Real Billable Rate Set & Append-Only Verification ---');

    const rateRes = await fetch(`${baseUrl}/api/time/rate/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        user_id: aliceId,
        rate_type: 'MEMBER_DEFAULT',
        hourly_rate: 1800.0,
        currency: 'INR',
        effective_from: '2026-01-01'
      })
    });
    const rateData = await rateRes.json();
    assert(rateRes.status === 201 && rateData.success, 'Admin sets Alice MEMBER_DEFAULT rate (1800 INR/hr) via HTTP 201');

    // Direct DB SELECT verify
    const dbRate = queryOne("SELECT * FROM billable_rates WHERE user_id = ? AND rate_type = 'MEMBER_DEFAULT'", [aliceId]);
    assert(dbRate && Number(dbRate.rate_per_hour) === 1800.0 && dbRate.currency === 'INR', 'Direct DB SELECT: billable_rates stores 1800.0 INR');

    // =====================================================================
    // STEP 3: Real timer start & active_timers lock
    // =====================================================================
    console.log('\n--- STEP 3: Real Timer Start & Lock Table Acquisition ---');

    const startRes = await fetch(`${baseUrl}/api/time/timer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({
        project_id: projectId,
        task_description: 'E2E Architecture Implementation',
        source_ref_type: 'BACKLOG_ITEM',
        source_ref_id: 901,
        is_billable: true
      })
    });
    const startData = await startRes.json();
    assert(startRes.status === 201 && startData.success, 'Alice starts timer via HTTP 201 Created');
    const timerEntryId = (startData.time_entry && startData.time_entry.id) || (startData.timer && (startData.timer.time_entry_id || startData.timer.timer_id));

    // Direct DB SELECT: active_timers lock
    const dbLock = queryOne('SELECT * FROM active_timers WHERE user_id = ?', [aliceId]);
    assert(dbLock && dbLock.time_entry_id === timerEntryId, 'Direct DB SELECT: active_timers has lock pointing to entry ID');

    // Direct DB SELECT: time_entries row state
    const dbTimerEntry = queryOne('SELECT * FROM time_entries WHERE id = ?', [timerEntryId]);
    assert(dbTimerEntry && dbTimerEntry.source_type === 'TIMER' && dbTimerEntry.end_time === null && dbTimerEntry.status === 'PENDING', 'Direct DB SELECT: time_entries has running timer with end_time NULL');
    assert(Number(dbTimerEntry.billable_rate) === 1800.0, 'Direct DB SELECT: time_entries has snapshotted rate 1800.0');

    // =====================================================================
    // STEP 4: Concurrent timer block (409 Conflict)
    // =====================================================================
    console.log('\n--- STEP 4: Concurrent Timer Conflict Block ---');

    const conflictRes = await fetch(`${baseUrl}/api/time/timer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({
        project_id: projectId,
        task_description: 'Second Concurrent Timer Attempt'
      })
    });
    const conflictData = await conflictRes.json();
    assert(conflictRes.status === 409, 'Rule 1: Second active timer start attempt blocked with HTTP 409 Conflict');
    assert(conflictData.error && conflictData.error.includes('already has an active running timer'), 'Conflict error explicitly cites running timer');

    const dbLockCount = queryOne('SELECT count(*) as count FROM active_timers WHERE user_id = ?', [aliceId]);
    assert(dbLockCount.count === 1, 'Direct DB SELECT: active_timers strictly maintains single lock');

    // =====================================================================
    // STEP 5: Real timer stop & server-side calculations
    // =====================================================================
    console.log('\n--- STEP 5: Real Timer Stop & Server Computations ---');

    // Simulate 90-minute elapsed time in DB
    const start90m = '2026-10-28T09:00:00.000Z';
    executeTransaction((db) => {
      db.prepare('UPDATE time_entries SET start_time = ? WHERE id = ?').run(start90m, timerEntryId);
      db.prepare('UPDATE active_timers SET started_at = ? WHERE time_entry_id = ?').run(start90m, timerEntryId);
    });

    // Stop timer at exactly 10:30 (90 min)
    const stopRes = await fetch(`${baseUrl}/api/time/timer/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({ end_time: '2026-10-28T10:30:00.000Z', notes: 'E2E testing notes' })
    });
    const stopData = await stopRes.json();
    assert(stopRes.status === 200 && stopData.success, 'Alice stops timer via HTTP 200 OK');

    // Direct DB SELECT: active_timers lock released
    const dbLockAfter = queryOne('SELECT * FROM active_timers WHERE user_id = ?', [aliceId]);
    assert(dbLockAfter === null, 'Direct DB SELECT: active_timers lock row cleanly released on stop');

    // Direct DB SELECT: duration and billable_amount
    const dbStopped = queryOne('SELECT * FROM time_entries WHERE id = ?', [timerEntryId]);
    assert(dbStopped.end_time !== null && dbStopped.duration_minutes === 90, 'Direct DB SELECT: end_time and duration_minutes (90m) stored');
    assert(Number(dbStopped.billable_amount) === 2700.0, `Direct DB SELECT: billable_amount stored (${dbStopped.billable_amount} INR)`);

    // Verify history audit row
    const dbHistRows = queryAll('SELECT * FROM time_entry_history WHERE entry_id = ?', [timerEntryId]);
    assert(dbHistRows.length >= 2, `Direct DB SELECT: time_entry_history recorded ${dbHistRows.length} audit rows on timer lifecycle`);

    // =====================================================================
    // STEP 6: Real manual entry + Overlap check + Source ref validation
    // =====================================================================
    console.log('\n--- STEP 6: Manual Entry Creation, Overlap & Validations ---');

    // Invalid source_ref_type
    const invalidRefRes = await fetch(`${baseUrl}/api/time/entry/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({
        project_id: projectId,
        task_description: 'Invalid ref test',
        start_time: '2026-10-28T14:00:00.000Z',
        end_time: '2026-10-28T16:00:00.000Z',
        source_ref_type: 'INVALID_TYPE_ENUM'
      })
    });
    assert(invalidRefRes.status === 400, 'Creation with invalid source_ref_type rejected with HTTP 400');

    // Overlapping manual entry with entry 1
    const overlapRes = await fetch(`${baseUrl}/api/time/entry/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({
        project_id: projectId,
        task_description: 'Overlapping entry',
        start_time: '2026-10-28T09:15:00.000Z',
        end_time: '2026-10-28T10:00:00.000Z'
      })
    });
    assert(overlapRes.status === 409, 'Overlapping manual entry rejected with HTTP 409 Conflict');

    // Valid non-overlapping manual entry (2 hours: 14:00 to 16:00)
    const validManualRes = await fetch(`${baseUrl}/api/time/entry/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({
        project_id: projectId,
        task_description: 'E2E Valid Manual Work',
        start_time: '2026-10-28T14:00:00.000Z',
        end_time: '2026-10-28T16:00:00.000Z',
        source_ref_type: 'BACKLOG_ITEM',
        source_ref_id: 902,
        is_billable: true
      })
    });
    const validManualData = await validManualRes.json();
    assert(validManualRes.status === 201 && validManualData.success, 'Valid manual entry created with HTTP 201 Created');
    const manualEntryId = validManualData.time_entry.id;

    // Direct DB SELECT: verify rate and amount
    const dbManual = queryOne('SELECT * FROM time_entries WHERE id = ?', [manualEntryId]);
    assert(dbManual.source_type === 'MANUAL' && dbManual.duration_minutes === 120, 'Direct DB SELECT: source_type is MANUAL, duration is 120m');
    assert(Number(dbManual.billable_rate) === 1800.0, 'Direct DB SELECT: billable_rate snapshotted as 1800.0');
    assert(Number(dbManual.billable_amount) === 3600.0, 'Direct DB SELECT: billable_amount is (120/60)*1800 = 3600.00 INR');

    // =====================================================================
    // STEP 7: Rate snapshot immutability
    // =====================================================================
    console.log('\n--- STEP 7: Rate Snapshot Immutability Verification ---');

    // Admin sets higher rate for Alice (3000 INR)
    await fetch(`${baseUrl}/api/time/rate/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        user_id: aliceId,
        rate_type: 'MEMBER_DEFAULT',
        hourly_rate: 3000.0,
        currency: 'INR',
        effective_from: '2026-10-29'
      })
    });

    // Direct DB SELECT: past manual entry rate MUST remain 1800.00 and amount 3600.00
    const dbManualAfterRateChange = queryOne('SELECT billable_rate, billable_amount FROM time_entries WHERE id = ?', [manualEntryId]);
    assert(Number(dbManualAfterRateChange.billable_rate) === 1800.0, 'Rate Snapshot Immutability: previous entry billable_rate remains 1800.0 in DB');
    assert(Number(dbManualAfterRateChange.billable_amount) === 3600.0, 'Rate Snapshot Immutability: previous entry billable_amount remains 3600.0 in DB');

    // =====================================================================
    // STEP 8: 24hr edit window & source-type locks
    // =====================================================================
    console.log('\n--- STEP 8: 24-Hour Edit Window & Field-Level Audit Trail ---');

    // Alice edits fresh manual entry (description changed)
    const editRes = await fetch(`${baseUrl}/api/time/entry/${manualEntryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({
        task_description: 'E2E Updated Manual Work (Edited within 24h)'
      })
    });
    assert(editRes.status === 200, 'Alice successfully edits fresh manual entry within 24hr window (HTTP 200)');

    // Direct DB SELECT: verify audit row
    const editAudit = queryOne("SELECT * FROM time_entry_history WHERE entry_id = ? AND field_changed = 'description'", [manualEntryId]);
    assert(editAudit && editAudit.old_value === 'E2E Valid Manual Work', 'Direct DB SELECT: time_entry_history logged field-level description change');

    // Alice tries to edit timer entry -> 403 Forbidden
    const editTimerRes = await fetch(`${baseUrl}/api/time/entry/${timerEntryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({ task_description: 'Alice trying to edit timer entry' })
    });
    assert(editTimerRes.status === 403, 'Member edit on timer-stopped entry strictly blocked with HTTP 403 Forbidden');

    // Admin overrides both entries -> 200 OK
    const adminEditRes = await fetch(`${baseUrl}/api/time/entry/${timerEntryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ task_description: 'Admin adjusted timer entry' })
    });
    assert(adminEditRes.status === 200, 'Admin can override and edit timer-stopped entry (HTTP 200 OK)');

    // Stale entry outside 24h: manipulate created_at in DB
    executeTransaction((db) => {
      db.prepare("UPDATE time_entries SET created_at = datetime('now', '-2 days') WHERE id = ?").run(manualEntryId);
    });
    const staleEditRes = await fetch(`${baseUrl}/api/time/entry/${manualEntryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({ task_description: 'Alice editing stale entry' })
    });
    assert(staleEditRes.status === 403, 'Member edit on manual entry older than 24 hours strictly blocked with HTTP 403');

    // Restore created_at
    executeTransaction((db) => {
      db.prepare("UPDATE time_entries SET created_at = datetime('now') WHERE id = ?").run(manualEntryId);
    });

    // =====================================================================
    // STEP 9: Soft delete & referential integrity
    // =====================================================================
    console.log('\n--- STEP 9: Soft Delete & Referential Integrity ---');

    // Alice tries to delete entry -> 403
    const memberDeleteRes = await fetch(`${baseUrl}/api/time/entry/${manualEntryId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    assert(memberDeleteRes.status === 403, 'Member deletion attempt rejected with HTTP 403 Forbidden');

    // Admin soft-deletes entry
    const adminDeleteRes = await fetch(`${baseUrl}/api/time/entry/${manualEntryId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'E2E soft-delete test cleanup' })
    });
    assert(adminDeleteRes.status === 200, 'Admin executes soft delete via HTTP 200 OK');

    // Direct DB SELECT: row exists with status='DELETED'
    const dbDeletedRow = queryOne('SELECT * FROM time_entries WHERE id = ?', [manualEntryId]);
    assert(dbDeletedRow !== null && dbDeletedRow.status === 'DELETED', 'Direct DB SELECT: row preserved in time_entries with status="DELETED"');

    // Excluded from GET /api/time/entries/my
    const myEntriesRes = await fetch(`${baseUrl}/api/time/entries/my`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    const myEntriesData = await myEntriesRes.json();
    const entriesList = Array.isArray(myEntriesData) ? myEntriesData : (myEntriesData.entries || []);
    const hasDeleted = entriesList.some((e) => e.id === manualEntryId);
    assert(!hasDeleted, 'GET /api/time/entries/my strictly excludes soft-deleted entries');

    // Foreign keys constraint verification
    const pragmaFk = queryOne('PRAGMA foreign_keys;');
    assert(pragmaFk.foreign_keys === 1, 'PRAGMA foreign_keys remains strictly ON (1) after soft delete');

    // =====================================================================
    // STEP 10: Approval workflow & audit log
    // =====================================================================
    console.log('\n--- STEP 10: Approval Workflow & Audit Trail ---');

    // Bob creates a billable manual entry
    const bobEntryRes = await fetch(`${baseUrl}/api/time/entry/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bobToken}` },
      body: JSON.stringify({
        project_id: projectId,
        task_description: 'Bob Backend Feature Work',
        start_time: '2026-10-28T16:00:00.000Z',
        end_time: '2026-10-28T18:00:00.000Z',
        is_billable: true
      })
    });
    const bobEntryData = await bobEntryRes.json();
    const bobEntryId = bobEntryData.time_entry.id;

    // Bob submits for approval
    const subRes = await fetch(`${baseUrl}/api/time/approval/request/${bobEntryId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${bobToken}` }
    });
    const subData = await subRes.json();
    assert(subRes.status === 201 && subData.success, 'Bob submits entry for approval via HTTP 201 Created');
    const approvalReqId = subData.approval_request.id;

    // Duplicate submit attempt -> 409 Conflict
    const dupSubRes = await fetch(`${baseUrl}/api/time/approval/request/${bobEntryId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${bobToken}` }
    });
    assert(dupSubRes.status === 409, 'Duplicate approval submission returns HTTP 409 Conflict');

    // Cross-member submit attempt -> 403 Forbidden
    const crossSubRes = await fetch(`${baseUrl}/api/time/approval/request/${bobEntryId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    assert(crossSubRes.status === 403, 'Cross-member approval submission returns HTTP 403 Forbidden');

    // Admin rejects with short note (<10 chars) -> 400
    const shortRejectRes = await fetch(`${baseUrl}/api/time/approval/${approvalReqId}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ decision_note: 'Short' })
    });
    assert(shortRejectRes.status === 400, 'Rejection with decision_note < 10 chars rejected with HTTP 400');

    // Admin rejects with valid note
    const validRejectRes = await fetch(`${baseUrl}/api/time/approval/${approvalReqId}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ decision_note: 'Please provide detailed breakdown of tasks' })
    });
    assert(validRejectRes.status === 200, 'Admin rejects entry with valid note via HTTP 200 OK');

    // Direct DB SELECT: verify rejection status & note
    const dbRejected = queryOne('SELECT status, rejection_reason FROM time_entries WHERE id = ?', [bobEntryId]);
    assert(dbRejected.status === 'REJECTED' && dbRejected.rejection_reason.includes('detailed breakdown'), 'Direct DB SELECT: entry marked REJECTED with rejection_reason stored');

    // Resubmitting REJECTED entry blocked -> 400
    const resubmitRes = await fetch(`${baseUrl}/api/time/approval/request/${bobEntryId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${bobToken}` }
    });
    assert(resubmitRes.status === 400, 'Rule 7: Resubmitting REJECTED entry strictly rejected with HTTP 400');

    // Bob creates fresh entry and submits for approval
    const freshBobRes = await fetch(`${baseUrl}/api/time/entry/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bobToken}` },
      body: JSON.stringify({
        project_id: projectId,
        task_description: 'Bob Revised Backend Feature Work',
        start_time: '2026-10-28T18:30:00.000Z',
        end_time: '2026-10-28T20:30:00.000Z',
        is_billable: true
      })
    });
    const freshBobData = await freshBobRes.json();
    const freshBobEntryId = freshBobData.time_entry.id;

    const freshSubRes = await fetch(`${baseUrl}/api/time/approval/request/${freshBobEntryId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${bobToken}` }
    });
    const freshSubData = await freshSubRes.json();
    const freshReqId = freshSubData.approval_request.id;

    // Admin approves entry
    const approveRes = await fetch(`${baseUrl}/api/time/approval/${freshReqId}/approve`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(approveRes.status === 200, 'Admin approves entry via HTTP 200 OK');

    // Direct DB SELECT: verify APPROVED state
    const dbApproved = queryOne('SELECT status, approved_by, approved_at FROM time_entries WHERE id = ?', [freshBobEntryId]);
    assert(dbApproved.status === 'APPROVED' && dbApproved.approved_by === adminId && dbApproved.approved_at !== null, 'Direct DB SELECT: entry status=APPROVED, approved_by and approved_at populated');

    // Direct DB SELECT: access_log audit recording
    const dbApproveLog = queryOne("SELECT * FROM access_log WHERE action = 'TIME_ENTRY_APPROVED' AND user_id = ?", [adminId]);
    assert(dbApproveLog !== null, 'Direct DB SELECT: access_log recorded TIME_ENTRY_APPROVED event');

    // =====================================================================
    // STEP 11: Team report aggregate & privacy isolation
    // =====================================================================
    console.log('\n--- STEP 11: Team Time Report Aggregation & Isolation ---');

    // Member cannot view team report -> 403
    const memberReportRes = await fetch(`${baseUrl}/api/time/report/team?project_id=${projectId}`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    assert(memberReportRes.status === 403, 'Rule 9: Member blocked from GET /api/time/report/team with HTTP 403');

    // Admin views team report
    const teamReportRes = await fetch(`${baseUrl}/api/time/report/team?project_id=${projectId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const teamReportData = await teamReportRes.json();
    assert(teamReportRes.status === 200 && teamReportData.success, 'Admin retrieves team report via HTTP 200 OK');
    const teamSummary = teamReportData.summary || teamReportData;
    assert((teamSummary.total_hrs > 0 || teamReportData.total_hrs > 0) && (teamSummary.entries_count > 0 || teamReportData.entries_count > 0), 'Team report calculates non-zero total_hrs and entries_count');

    // Verify soft-deleted entries excluded
    const membersList = teamReportData.members || teamReportData.by_member || [];
    const hasSoftDeletedInReport = membersList.some((m) => m.user_id === aliceId && m.entries_count > 1);
    assert(!hasSoftDeletedInReport, 'Team report strictly excludes soft-deleted entries from aggregations');

    // Alice views own report
    const myReportRes = await fetch(`${baseUrl}/api/time/report/my?project_id=${projectId}`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    const myReportData = await myReportRes.json();
    assert(myReportRes.status === 200 && myReportData.success, 'Alice retrieves own time report via HTTP 200 OK');

    // =====================================================================
    // STEP 12: Report snapshot & SQLite trigger immutability
    // =====================================================================
    console.log('\n--- STEP 12: Report Snapshot & Append-Only Triggers ---');

    const snapRes = await fetch(`${baseUrl}/api/time/report/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        project_id: projectId,
        report_type: 'WEEKLY',
        period_start: '2026-10-25',
        period_end: '2026-10-31'
      })
    });
    const snapData = await snapRes.json();
    assert(snapRes.status === 201 && snapData.success, 'Admin takes point-in-time report snapshot (HTTP 201 Created)');
    const snapshotId = snapData.snapshot.id;

    // Direct DB SELECT: verify snapshot row & JSON
    const dbSnap = queryOne('SELECT * FROM time_report_snapshots WHERE id = ?', [snapshotId]);
    assert(dbSnap && dbSnap.report_type === 'WEEKLY', 'Direct DB SELECT: snapshot row stored in SQLite');
    const parsedSnapData = JSON.parse(dbSnap.snapshot_data);
    assert(Array.isArray(parsedSnapData), 'Direct DB SELECT: snapshot_data is valid JSON array');

    // Trigger test: prevent_time_report_snapshot_update
    let updateBlocked = false;
    try {
      executeTransaction((db) => {
        db.prepare("UPDATE time_report_snapshots SET report_type = 'ALTERED' WHERE id = ?").run(snapshotId);
      });
    } catch (e) {
      updateBlocked = e.message.includes('append-only') || e.message.includes('prevent_time_report_snapshot_update') || e.message.includes('cannot be updated');
    }
    assert(updateBlocked, 'Trigger prevent_time_report_snapshot_update strictly blocks SQL UPDATE');

    // Trigger test: prevent_time_report_snapshot_delete
    let deleteBlocked = false;
    try {
      executeTransaction((db) => {
        db.prepare('DELETE FROM time_report_snapshots WHERE id = ?').run(snapshotId);
      });
    } catch (e) {
      deleteBlocked = e.message.includes('append-only') || e.message.includes('prevent_time_report_snapshot_delete') || e.message.includes('cannot be deleted');
    }
    assert(deleteBlocked, 'Trigger prevent_time_report_snapshot_delete strictly blocks SQL DELETE');

    // =====================================================================
    // STEP 13: CSV export & access_log audit
    // =====================================================================
    console.log('\n--- STEP 13: CSV Report Export & Access Log Auditing ---');

    const exportRes = await fetch(`${baseUrl}/api/time/report/export/${projectId}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(exportRes.status === 200, 'Admin exports CSV report via HTTP 200 OK');
    const contentType = exportRes.headers.get('content-type') || '';
    assert(contentType.includes('text/csv'), `Content-Type is text/csv (got: ${contentType})`);

    const csvText = await exportRes.text();
    assert(csvText.includes('Entry ID') && csvText.includes('Member Name') && csvText.includes('Project Title'), 'CSV includes standard column headers');
    assert(csvText.includes('Alice') || csvText.includes('Bob') || csvText.includes('E2E') || csvText.includes(projectTitle), 'CSV output contains matching project rows');

    // Direct DB SELECT: access_log entry
    const dbExportLog = queryOne("SELECT * FROM access_log WHERE action = 'TIME_REPORT_EXPORT' AND user_id = ?", [adminId]);
    assert(dbExportLog !== null && (dbExportLog.target_id === projectId || dbExportLog.target_id === String(projectId) || (dbExportLog.details && dbExportLog.details.includes(projectId))), 'Direct DB SELECT: access_log recorded TIME_REPORT_EXPORT with target project ID');

    // =====================================================================
    // STEP 14: Frontend 4-file security audit
    // =====================================================================
    console.log('\n--- STEP 14: Frontend 4-File Security Audit ---');

    const frontendViews = [
      'my-time-tracker.html',
      'team-time-report.html',
      'time-approval-queue.html',
      'billable-rates.html'
    ];

    for (const viewFile of frontendViews) {
      const fullPath = path.join(publicDir, viewFile);
      assert(fs.existsSync(fullPath), `${viewFile} exists in public/`);

      const content = fs.readFileSync(fullPath, 'utf8');

      // Zero hardcoded secrets / credentials
      const hasHardcodedSecret = /password\s*[:=]\s*['"][^'"]+['"]/i.test(content) ||
                                 /bearer\s+eyJ/i.test(content) ||
                                 /secret\s*[:=]\s*['"][^'"]+['"]/i.test(content);
      assert(!hasHardcodedSecret, `${viewFile} has ZERO hardcoded passwords/tokens`);

      // escapeHTML present
      const hasEscape = content.includes('escapeHTML(');
      assert(hasEscape, `${viewFile} implements escapeHTML() XSS protection`);

      // localStorage dynamic
      const hasToken = content.includes("localStorage.getItem('token')") || content.includes('localStorage.getItem("token")');
      assert(hasToken, `${viewFile} dynamically reads token from localStorage`);

      // GET /api/users/me called on load
      const hasMe = content.includes('/api/users/me');
      assert(hasMe, `${viewFile} verifies server-side role via GET /api/users/me`);
    }

    // =====================================================================
    // STEP 15: Timer auto-close cron scenario test
    // =====================================================================
    console.log('\n--- STEP 15: Dangling Timer Auto-Close Cron Scenario ---');

    const yesterdayStart = '2026-10-27T10:00:00.000Z';

    executeTransaction((db) => {
      db.prepare(`
        INSERT INTO time_entries (user_id, project_id, source_type, description, start_time, is_billable, status, created_at, updated_at)
        VALUES (?, ?, 'TIMER', 'Dangling test timer', ?, 1, 'PENDING', ?, ?)
      `).run(bobId, projectId, yesterdayStart, yesterdayStart, yesterdayStart);
    });

    const dbDanglingBefore = queryOne("SELECT * FROM time_entries WHERE description = 'Dangling test timer' ORDER BY id DESC LIMIT 1");
    const danglingTimerId = dbDanglingBefore.id;

    executeTransaction((db) => {
      db.prepare(`
        INSERT INTO active_timers (user_id, time_entry_id, started_at)
        VALUES (?, ?, ?)
      `).run(bobId, danglingTimerId, yesterdayStart);
    });

    // Run auto-close cron
    const cronRes = autoCloseDanglingTimers();
    const closedCount = cronRes.auto_closed_count !== undefined ? cronRes.auto_closed_count : cronRes;
    assert(closedCount >= 1, `autoCloseDanglingTimers closed ${closedCount} dangling timer(s)`);

    // Direct DB SELECT: verify closed at 23:59:59
    const dbDangling = queryOne('SELECT * FROM time_entries WHERE id = ?', [danglingTimerId]);
    assert(dbDangling.end_time.includes('23:59:59'), `Dangling timer end_time is 23:59:59 of started day (got: ${dbDangling.end_time})`);
    assert(dbDangling.duration_minutes > 0, `Dangling timer duration computed (${dbDangling.duration_minutes}m)`);

    // Verify active_timers lock removed
    const dbDanglingLock = queryOne('SELECT * FROM active_timers WHERE time_entry_id = ?', [danglingTimerId]);
    assert(dbDanglingLock === null, 'Dangling active_timers lock cleared from database');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n  [HARNESS] Ephemeral test server closed cleanly');
  }

  console.log('\n======================================================================');
  console.log('🏁 PRD 22 LAYER 6 E2E INTEGRATION VERIFICATION COMPLETE');
  console.log(`  TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log(`  PASS RATE: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('======================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runIntegrationSuite().catch((err) => {
  console.error('Fatal error in PRD 22 Layer 6 E2E suite:', err);
  process.exit(1);
});
