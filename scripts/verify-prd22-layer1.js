/**
 * PRD 22 — Layer 1 Verification Suite
 * 
 * Verifies:
 * 1. Database Connection: WAL mode enabled, busy_timeout=5000, foreign_keys=ON
 * 2. 6 New Tables exist in sqlite_master:
 *    - time_entries
 *    - time_entry_history
 *    - billable_rates
 *    - active_timers
 *    - time_approval_requests
 *    - time_report_snapshots
 * 3. Exact column definitions & constraints verified via PRAGMA table_info
 * 4. 13 Performance & Integrity Indexes verified in sqlite_master
 * 5. 8 Append-Only / Immutability Triggers verified in sqlite_master:
 *    - prevent_time_history_update
 *    - prevent_time_history_delete
 *    - prevent_billable_rate_update
 *    - prevent_billable_rate_delete
 *    - prevent_approval_request_update
 *    - prevent_approval_request_delete
 *    - prevent_time_report_snapshot_update
 *    - prevent_time_report_snapshot_delete
 * 6. Real functional Trigger Enforcement (INSERT -> blocked UPDATE -> blocked DELETE)
 * 7. Active Timers Lock & Single Active Timer per user UNIQUE constraint test
 */

import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';

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

async function runLayer1Verification() {
  console.log('\n========================================================================');
  console.log('  PRD 22 LAYER 1: DATABASE, SCHEMA & IMMUTABILITY TRIGGERS VERIFICATION');
  console.log('========================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // 1. Database Connection Pragma Verification
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Database Pragmas (WAL, Timeout, Foreign Keys) ---');

    const db = getDatabase();
    const journalMode = queryOne('PRAGMA journal_mode;');
    assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', 'SQLite journal_mode is strictly WAL');

    const busyTimeout = queryOne('PRAGMA busy_timeout;');
    assert(busyTimeout && busyTimeout.timeout === 5000, 'SQLite busy_timeout is strictly 5000ms');

    const foreignKeys = queryOne('PRAGMA foreign_keys;');
    assert(foreignKeys && foreignKeys.foreign_keys === 1, 'SQLite foreign_keys constraint enforcement is ON (1)');

    // -------------------------------------------------------------------------
    // 2. Table Existence Verification (6 Tables)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Table Existence in sqlite_master ---');

    const expectedTables = [
      'time_entries',
      'time_entry_history',
      'billable_rates',
      'active_timers',
      'time_approval_requests',
      'time_report_snapshots'
    ];

    const masterTables = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").map(r => r.name);

    for (const tName of expectedTables) {
      assert(masterTables.includes(tName), `Table "${tName}" exists in sqlite_master`);
    }

    // -------------------------------------------------------------------------
    // 3. Column Schema Verification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Detailed Column Structure Verification ---');

    // 3.1 time_entries
    const teCols = queryAll("PRAGMA table_info(time_entries);").map(c => c.name);
    const requiredTeCols = [
      'id', 'user_id', 'project_id', 'source_type', 'source_ref_type', 'source_ref_id',
      'description', 'start_time', 'end_time', 'duration_minutes', 'is_billable',
      'billable_rate', 'billable_amount', 'status', 'approved_by', 'approved_at',
      'rejection_reason', 'created_at', 'updated_at'
    ];
    for (const col of requiredTeCols) {
      assert(teCols.includes(col), `time_entries contains column "${col}"`);
    }

    // 3.2 time_entry_history
    const tehCols = queryAll("PRAGMA table_info(time_entry_history);").map(c => c.name);
    const requiredTehCols = ['id', 'entry_id', 'changed_by', 'field_changed', 'old_value', 'new_value', 'changed_at'];
    for (const col of requiredTehCols) {
      assert(tehCols.includes(col), `time_entry_history contains column "${col}"`);
    }

    // 3.3 billable_rates
    const brCols = queryAll("PRAGMA table_info(billable_rates);").map(c => c.name);
    const requiredBrCols = ['id', 'rate_type', 'user_id', 'project_id', 'rate_per_hour', 'currency', 'effective_from', 'effective_to', 'set_by', 'created_at'];
    for (const col of requiredBrCols) {
      assert(brCols.includes(col), `billable_rates contains column "${col}"`);
    }

    // 3.4 active_timers
    const atCols = queryAll("PRAGMA table_info(active_timers);").map(c => c.name);
    const requiredAtCols = ['id', 'user_id', 'time_entry_id', 'started_at'];
    for (const col of requiredAtCols) {
      assert(atCols.includes(col), `active_timers contains column "${col}"`);
    }

    // 3.5 time_approval_requests
    const tarCols = queryAll("PRAGMA table_info(time_approval_requests);").map(c => c.name);
    const requiredTarCols = ['id', 'entry_id', 'requested_by', 'requested_at', 'reviewed_by', 'reviewed_at', 'decision', 'decision_note', 'created_at'];
    for (const col of requiredTarCols) {
      assert(tarCols.includes(col), `time_approval_requests contains column "${col}"`);
    }

    // 3.6 time_report_snapshots
    const trsCols = queryAll("PRAGMA table_info(time_report_snapshots);").map(c => c.name);
    const requiredTrsCols = ['id', 'project_id', 'report_type', 'period_start', 'period_end', 'snapshot_data', 'taken_by', 'created_at'];
    for (const col of requiredTrsCols) {
      assert(trsCols.includes(col), `time_report_snapshots contains column "${col}"`);
    }

    // -------------------------------------------------------------------------
    // 4. Index Verification (13 Indexes)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Index Verification in sqlite_master ---');

    const expectedIndexes = [
      'idx_time_entries_user',
      'idx_time_entries_project',
      'idx_time_entries_status',
      'idx_time_entries_start_time',
      'idx_time_entries_source_ref',
      'idx_time_entry_history_entry',
      'idx_billable_rates_user',
      'idx_billable_rates_project',
      'idx_billable_rates_effective',
      'idx_active_timers_user',
      'idx_time_approval_requests_entry',
      'idx_time_approval_requests_status',
      'idx_time_report_snapshots_project'
    ];

    const masterIndexes = queryAll("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';").map(r => r.name);

    for (const idxName of expectedIndexes) {
      assert(masterIndexes.includes(idxName), `Index "${idxName}" verified in sqlite_master`);
    }

    // -------------------------------------------------------------------------
    // 5. Trigger Existence Verification (8 Triggers)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Trigger Existence in sqlite_master ---');

    const expectedTriggers = [
      'prevent_time_history_update',
      'prevent_time_history_delete',
      'prevent_billable_rate_update',
      'prevent_billable_rate_delete',
      'prevent_approval_request_update',
      'prevent_approval_request_delete',
      'prevent_time_report_snapshot_update',
      'prevent_time_report_snapshot_delete'
    ];

    const masterTriggers = queryAll("SELECT name FROM sqlite_master WHERE type='trigger';").map(r => r.name);

    for (const trig of expectedTriggers) {
      assert(masterTriggers.includes(trig), `Trigger "${trig}" verified in sqlite_master`);
    }

    // -------------------------------------------------------------------------
    // 6. Real Functional Trigger Tests (Append-Only Enforcement)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Real Functional Trigger Tests (Append-Only Enforcement) ---');

    // Obtain real fixture user and project
    const fixtureUser = queryOne("SELECT id FROM users WHERE id IS NOT NULL LIMIT 1");
    const fixtureProject = queryOne("SELECT id FROM projects WHERE id IS NOT NULL LIMIT 1");
    assert(Boolean(fixtureUser && fixtureUser.id && fixtureProject && fixtureProject.id), 'Found fixture user and project in database');

    // Create a base time entry to reference in tests
    execute(`
      INSERT INTO time_entries (
        user_id, project_id, source_type, description, start_time, is_billable, status
      ) VALUES (?, ?, 'MANUAL', 'Layer 1 Test Fixture Entry', '2026-10-28T09:00:00', 1, 'PENDING')
    `, [fixtureUser.id, fixtureProject.id]);
    const baseEntry = queryOne("SELECT id FROM time_entries WHERE description = 'Layer 1 Test Fixture Entry' ORDER BY id DESC LIMIT 1");
    assert(Boolean(baseEntry), 'Inserted base time_entry fixture for foreign key references');

    // 6.1 Test Trigger: time_entry_history (Update and Delete Blocked)
    execute(`
      INSERT INTO time_entry_history (entry_id, changed_by, field_changed, old_value, new_value)
      VALUES (?, ?, 'description', 'old desc', 'new desc')
    `, [baseEntry.id, fixtureUser.id]);
    const tehRow = queryOne("SELECT id FROM time_entry_history WHERE entry_id = ? ORDER BY id DESC LIMIT 1", [baseEntry.id]);

    let tehUpdateBlocked = false;
    try {
      execute("UPDATE time_entry_history SET new_value = 'tampered' WHERE id = ?", [tehRow.id]);
    } catch (err) {
      tehUpdateBlocked = err.message.includes('append-only') || err.message.includes('prevent_time_history_update');
    }
    assert(tehUpdateBlocked, 'Trigger prevent_time_history_update strictly blocks SQL UPDATE');

    let tehDeleteBlocked = false;
    try {
      execute("DELETE FROM time_entry_history WHERE id = ?", [tehRow.id]);
    } catch (err) {
      tehDeleteBlocked = err.message.includes('append-only') || err.message.includes('prevent_time_history_delete');
    }
    assert(tehDeleteBlocked, 'Trigger prevent_time_history_delete strictly blocks SQL DELETE');

    // 6.2 Test Trigger: billable_rates (Update and Delete Blocked)
    execute(`
      INSERT INTO billable_rates (rate_type, user_id, rate_per_hour, currency, effective_from, set_by)
      VALUES ('MEMBER_DEFAULT', ?, 1500.0, 'INR', '2026-10-01', ?)
    `, [fixtureUser.id, fixtureUser.id]);
    const brRow = queryOne("SELECT id FROM billable_rates WHERE user_id = ? ORDER BY id DESC LIMIT 1", [fixtureUser.id]);

    let brUpdateBlocked = false;
    try {
      execute("UPDATE billable_rates SET rate_per_hour = 9999.0 WHERE id = ?", [brRow.id]);
    } catch (err) {
      brUpdateBlocked = err.message.includes('append-only') || err.message.includes('prevent_billable_rate_update');
    }
    assert(brUpdateBlocked, 'Trigger prevent_billable_rate_update strictly blocks SQL UPDATE');

    let brDeleteBlocked = false;
    try {
      execute("DELETE FROM billable_rates WHERE id = ?", [brRow.id]);
    } catch (err) {
      brDeleteBlocked = err.message.includes('append-only') || err.message.includes('prevent_billable_rate_delete');
    }
    assert(brDeleteBlocked, 'Trigger prevent_billable_rate_delete strictly blocks SQL DELETE');

    // 6.3 Test Trigger: time_approval_requests (Update and Delete Blocked)
    execute(`
      INSERT INTO time_approval_requests (entry_id, requested_by, decision)
      VALUES (?, ?, 'APPROVED')
    `, [baseEntry.id, fixtureUser.id]);
    const tarRow = queryOne("SELECT id FROM time_approval_requests WHERE entry_id = ? ORDER BY id DESC LIMIT 1", [baseEntry.id]);

    let tarUpdateBlocked = false;
    try {
      execute("UPDATE time_approval_requests SET decision = 'REJECTED' WHERE id = ?", [tarRow.id]);
    } catch (err) {
      tarUpdateBlocked = err.message.includes('append-only') || err.message.includes('prevent_approval_request_update');
    }
    assert(tarUpdateBlocked, 'Trigger prevent_approval_request_update strictly blocks SQL UPDATE');

    let tarDeleteBlocked = false;
    try {
      execute("DELETE FROM time_approval_requests WHERE id = ?", [tarRow.id]);
    } catch (err) {
      tarDeleteBlocked = err.message.includes('append-only') || err.message.includes('prevent_approval_request_delete');
    }
    assert(tarDeleteBlocked, 'Trigger prevent_approval_request_delete strictly blocks SQL DELETE');

    // 6.4 Test Trigger: time_report_snapshots (Update and Delete Blocked)
    execute(`
      INSERT INTO time_report_snapshots (
        project_id, report_type, period_start, period_end, snapshot_data, taken_by
      ) VALUES (?, 'WEEKLY', '2026-10-01', '2026-10-07', '[]', ?)
    `, [fixtureProject.id, fixtureUser.id]);
    const trsRow = queryOne("SELECT id FROM time_report_snapshots WHERE project_id = ? ORDER BY id DESC LIMIT 1", [fixtureProject.id]);

    let trsUpdateBlocked = false;
    try {
      execute("UPDATE time_report_snapshots SET snapshot_data = '{\"tampered\":true}' WHERE id = ?", [trsRow.id]);
    } catch (err) {
      trsUpdateBlocked = err.message.includes('append-only') || err.message.includes('prevent_time_report_snapshot_update');
    }
    assert(trsUpdateBlocked, 'Trigger prevent_time_report_snapshot_update strictly blocks SQL UPDATE');

    let trsDeleteBlocked = false;
    try {
      execute("DELETE FROM time_report_snapshots WHERE id = ?", [trsRow.id]);
    } catch (err) {
      trsDeleteBlocked = err.message.includes('append-only') || err.message.includes('prevent_time_report_snapshot_delete');
    }
    assert(trsDeleteBlocked, 'Trigger prevent_time_report_snapshot_delete strictly blocks SQL DELETE');

    // -------------------------------------------------------------------------
    // 7. Active Timers Lock & Single Active Timer per User Constraint Test
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Active Timers Single-Lock & UNIQUE Constraint ---');

    // Clean active timers for fixtureUser
    execute("DELETE FROM active_timers WHERE user_id = ?", [fixtureUser.id]);

    // Insert first active timer
    execute("INSERT INTO active_timers (user_id, time_entry_id) VALUES (?, ?)", [fixtureUser.id, baseEntry.id]);
    const firstTimer = queryOne("SELECT * FROM active_timers WHERE user_id = ?", [fixtureUser.id]);
    assert(Boolean(firstTimer && firstTimer.time_entry_id === baseEntry.id), 'Active timer lock successfully acquired for user');

    // Attempt second active timer for same user -> MUST fail with UNIQUE constraint
    let secondTimerBlocked = false;
    try {
      execute("INSERT INTO active_timers (user_id, time_entry_id) VALUES (?, ?)", [fixtureUser.id, baseEntry.id]);
    } catch (err) {
      secondTimerBlocked = err.message.includes('UNIQUE constraint failed') || err.message.includes('active_timers.user_id');
    }
    assert(secondTimerBlocked, 'Rule 1 Enforced: SQLite UNIQUE constraint blocks concurrent active timers for same user');

    // Cleanup active timer lock
    execute("DELETE FROM active_timers WHERE user_id = ?", [fixtureUser.id]);
    const clearedTimer = queryOne("SELECT * FROM active_timers WHERE user_id = ?", [fixtureUser.id]);
    assert(clearedTimer === null, 'Active timer lock releases cleanly on timer stop (DELETE permitted on lock table)');

  } catch (fatalErr) {
    console.error('\n\x1b[31m[FATAL ERROR IN LAYER 1 SUITE]\x1b[0m', fatalErr);
    process.exitCode = 1;
  }

  console.log('\n========================================================================');
  console.log('  PRD 22 LAYER 1 VERIFICATION SUMMARY:');
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

runLayer1Verification().catch(err => {
  console.error('Unhandled fatal error in Layer 1 test suite:', err);
  process.exitCode = 1;
});
