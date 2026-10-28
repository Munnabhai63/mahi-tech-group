import assert from 'node:assert';
import { queryOne, queryAll, execute } from '../src/db/database.js';

console.log('================================================================');
console.log('  PRD 21 LAYER 1 VERIFICATION: WORKLOAD DATABASE & TRIGGERS');
console.log('================================================================\n');

let passedAssertions = 0;
function pass(msg) {
  passedAssertions++;
  console.log(`  [PASS] ${msg}`);
}

async function runLayer1Tests() {
  try {
    // -------------------------------------------------------------
    // Test 1: Verify all 5 Workload tables exist
    // -------------------------------------------------------------
    console.log('[STAGE 1] Verifying Workload Table Existence...');
    const expectedTables = [
      'member_capacity',
      'member_availability',
      'workload_assignments',
      'workload_snapshots',
      'workload_alerts'
    ];

    for (const tableName of expectedTables) {
      const tableRow = queryOne(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [tableName]
      );
      assert.ok(tableRow, `Table ${tableName} must exist in sqlite_master`);
      pass(`Table ${tableName} verified.`);
    }

    // -------------------------------------------------------------
    // Test 2: Verify column structure for each table
    // -------------------------------------------------------------
    console.log('\n[STAGE 2] Verifying Column Structures...');
    const tableColumns = {
      member_capacity: [
        'id', 'user_id', 'weekly_capacity_hrs', 'effective_from',
        'effective_to', 'set_by', 'created_at'
      ],
      member_availability: [
        'id', 'user_id', 'date', 'availability_type', 'available_hrs',
        'reason', 'approved_by', 'created_by', 'created_at', 'updated_at'
      ],
      workload_assignments: [
        'id', 'user_id', 'project_id', 'source_type', 'source_id',
        'title', 'estimated_hrs', 'start_date', 'end_date', 'status',
        'created_by', 'created_at', 'updated_at'
      ],
      workload_snapshots: [
        'id', 'project_id', 'snapshot_date', 'snapshot_data',
        'taken_by', 'created_at'
      ],
      workload_alerts: [
        'id', 'user_id', 'alert_type', 'week_start_date', 'assigned_hrs',
        'capacity_hrs', 'utilization_pct', 'acknowledged_by', 'acknowledged_at',
        'created_at'
      ]
    };

    for (const [table, expectedCols] of Object.entries(tableColumns)) {
      const cols = queryAll(`PRAGMA table_info(${table})`);
      const colNames = cols.map(c => c.name);
      for (const col of expectedCols) {
        assert.ok(colNames.includes(col), `Column ${col} must exist on table ${table}`);
      }
      pass(`Table ${table} contains all ${expectedCols.length} expected columns.`);
    }

    // -------------------------------------------------------------
    // Test 3: Verify all 5 append-only triggers exist
    // -------------------------------------------------------------
    console.log('\n[STAGE 3] Verifying 5 Append-Only Triggers in sqlite_master...');
    const expectedTriggers = [
      'prevent_capacity_update',
      'prevent_capacity_delete',
      'prevent_workload_snapshot_update',
      'prevent_workload_snapshot_delete',
      'prevent_workload_alert_delete'
    ];

    for (const trig of expectedTriggers) {
      const trigRow = queryOne(
        "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        [trig]
      );
      assert.ok(trigRow, `Trigger ${trig} must exist in sqlite_master`);
      assert.ok(trigRow.sql.includes('append-only'), `Trigger ${trig} must raise append-only abort`);
      pass(`Trigger ${trig} verified.`);
    }

    // -------------------------------------------------------------
    // Test 4: Setup test seed records (User & Project)
    // -------------------------------------------------------------
    console.log('\n[STAGE 4] Setting up Test Fixtures (User & Project)...');
    let testUser = queryOne("SELECT id FROM users WHERE email = 'workload.tester@example.com'");
    if (!testUser) {
      execute(`
        INSERT INTO users (id, email, password_hash, name, role, status)
        VALUES ('workload_user_t1', 'workload.tester@example.com', 'dummy_hash', 'Workload Tester', 'developer', 'active')
      `);
      testUser = { id: 'workload_user_t1' };
    }
    pass(`Test user established with ID: ${testUser.id}`);

    let testAdmin = queryOne("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!testAdmin) {
      execute(`
        INSERT INTO users (id, email, password_hash, name, role, status)
        VALUES ('workload_admin_t1', 'workload.admin@example.com', 'dummy_hash', 'Workload Admin', 'admin', 'active')
      `);
      testAdmin = { id: 'workload_admin_t1' };
    }
    pass(`Test admin established with ID: ${testAdmin.id}`);

    let testProject = queryOne("SELECT id FROM projects LIMIT 1");
    if (!testProject) {
      execute(`
        INSERT INTO projects (id, title, description, owner_id, status, stage)
        VALUES ('workload_proj_t1', 'Workload Test Project', 'Testing Workload Dashboard', ?, 'ACTIVE', 'DEV')
      `, [testAdmin.id]);
      testProject = { id: 'workload_proj_t1' };
    }
    pass(`Test project established with ID: ${testProject.id}`);

    // -------------------------------------------------------------
    // Test 5: Verify Trigger Enforcements (Real Aborts)
    // -------------------------------------------------------------
    console.log('\n[STAGE 5] Testing Append-Only Trigger Enforcements (Real SQL Aborts)...');

    // 5A. member_capacity triggers
    execute(`
      INSERT INTO member_capacity (user_id, weekly_capacity_hrs, effective_from, set_by)
      VALUES (?, 35.0, '2026-11-01', ?)
    `, [testUser.id, testAdmin.id]);
    const insertedCap = queryOne("SELECT id FROM member_capacity WHERE user_id = ? ORDER BY id DESC LIMIT 1", [testUser.id]);
    assert.ok(insertedCap, "Capacity row must be inserted");
    pass("member_capacity INSERT succeeded.");

    // UPDATE on member_capacity must abort
    let capUpdateBlocked = false;
    try {
      execute("UPDATE member_capacity SET weekly_capacity_hrs = 40.0 WHERE id = ?", [insertedCap.id]);
    } catch (err) {
      capUpdateBlocked = err.message.includes('append-only');
    }
    assert.ok(capUpdateBlocked, "Trigger prevent_capacity_update must abort UPDATE");
    pass("prevent_capacity_update correctly aborted UPDATE on member_capacity.");

    // DELETE on member_capacity must abort
    let capDeleteBlocked = false;
    try {
      execute("DELETE FROM member_capacity WHERE id = ?", [insertedCap.id]);
    } catch (err) {
      capDeleteBlocked = err.message.includes('append-only');
    }
    assert.ok(capDeleteBlocked, "Trigger prevent_capacity_delete must abort DELETE");
    pass("prevent_capacity_delete correctly aborted DELETE on member_capacity.");

    // 5B. workload_snapshots triggers
    execute(`
      INSERT INTO workload_snapshots (project_id, snapshot_date, snapshot_data, taken_by)
      VALUES (?, '2026-11-01', '{"test":true}', ?)
    `, [testProject.id, testAdmin.id]);
    const insertedSnap = queryOne("SELECT id FROM workload_snapshots WHERE project_id = ? ORDER BY id DESC LIMIT 1", [testProject.id]);
    assert.ok(insertedSnap, "Snapshot row must be inserted");
    pass("workload_snapshots INSERT succeeded.");

    // UPDATE on workload_snapshots must abort
    let snapUpdateBlocked = false;
    try {
      execute("UPDATE workload_snapshots SET snapshot_date = '2026-11-02' WHERE id = ?", [insertedSnap.id]);
    } catch (err) {
      snapUpdateBlocked = err.message.includes('append-only');
    }
    assert.ok(snapUpdateBlocked, "Trigger prevent_workload_snapshot_update must abort UPDATE");
    pass("prevent_workload_snapshot_update correctly aborted UPDATE on workload_snapshots.");

    // DELETE on workload_snapshots must abort
    let snapDeleteBlocked = false;
    try {
      execute("DELETE FROM workload_snapshots WHERE id = ?", [insertedSnap.id]);
    } catch (err) {
      snapDeleteBlocked = err.message.includes('append-only');
    }
    assert.ok(snapDeleteBlocked, "Trigger prevent_workload_snapshot_delete must abort DELETE");
    pass("prevent_workload_snapshot_delete correctly aborted DELETE on workload_snapshots.");

    // 5C. workload_alerts triggers
    execute(`
      INSERT INTO workload_alerts (user_id, alert_type, week_start_date, assigned_hrs, capacity_hrs, utilization_pct)
      VALUES (?, 'OVERLOADED', '2026-11-02', 50.0, 40.0, 125.0)
    `, [testUser.id]);
    const insertedAlert = queryOne("SELECT id FROM workload_alerts WHERE user_id = ? ORDER BY id DESC LIMIT 1", [testUser.id]);
    assert.ok(insertedAlert, "Alert row must be inserted");
    pass("workload_alerts INSERT succeeded.");

    // DELETE on workload_alerts must abort
    let alertDeleteBlocked = false;
    try {
      execute("DELETE FROM workload_alerts WHERE id = ?", [insertedAlert.id]);
    } catch (err) {
      alertDeleteBlocked = err.message.includes('append-only');
    }
    assert.ok(alertDeleteBlocked, "Trigger prevent_workload_alert_delete must abort DELETE");
    pass("prevent_workload_alert_delete correctly aborted DELETE on workload_alerts.");

    // UPDATE on workload_alerts (acknowledgement) MUST succeed per design
    let alertUpdateSucceeded = false;
    try {
      execute(`
        UPDATE workload_alerts
        SET acknowledged_by = ?, acknowledged_at = datetime('now')
        WHERE id = ?
      `, [testAdmin.id, insertedAlert.id]);
      alertUpdateSucceeded = true;
    } catch (err) {
      alertUpdateSucceeded = false;
    }
    assert.ok(alertUpdateSucceeded, "Updating acknowledged fields on workload_alerts must be permitted");
    pass("Acknowledging workload_alerts permitted and verified.");

    // -------------------------------------------------------------
    // Test 6: Verify Unique Constraint on member_availability
    // -------------------------------------------------------------
    console.log('\n[STAGE 6] Testing UNIQUE(user_id, date) Constraint on member_availability...');
    const testDate = '2026-12-25';
    execute("DELETE FROM member_availability WHERE user_id = ? AND date = ?", [testUser.id, testDate]);

    execute(`
      INSERT INTO member_availability (user_id, date, availability_type, available_hrs, reason, created_by)
      VALUES (?, ?, 'HOLIDAY', 0.0, 'Christmas Day Off', ?)
    `, [testUser.id, testDate, testUser.id]);
    pass("Initial member_availability entry inserted successfully.");

    let duplicateBlocked = false;
    try {
      execute(`
        INSERT INTO member_availability (user_id, date, availability_type, available_hrs, reason, created_by)
        VALUES (?, ?, 'LEAVE', 0.0, 'Duplicate request', ?)
      `, [testUser.id, testDate, testUser.id]);
    } catch (err) {
      duplicateBlocked = err.message.includes('UNIQUE constraint failed');
    }
    assert.ok(duplicateBlocked, "UNIQUE(user_id, date) constraint must prevent duplicate date entries");
    pass("UNIQUE constraint on (user_id, date) strictly enforced.");

    // -------------------------------------------------------------
    // Test 7: Verify workload_assignments CRUD
    // -------------------------------------------------------------
    console.log('\n[STAGE 7] Testing workload_assignments Operations...');
    execute(`
      INSERT INTO workload_assignments (
        user_id, project_id, source_type, source_id, title,
        estimated_hrs, start_date, end_date, status, created_by
      ) VALUES (
        ?, ?, 'GANTT_ITEM', 101, 'Implement Auth Middleware',
        16.0, '2026-11-02', '2026-11-06', 'ACTIVE', ?
      )
    `, [testUser.id, testProject.id, testAdmin.id]);

    const insertedAssign = queryOne(`
      SELECT * FROM workload_assignments
      WHERE user_id = ? AND title = 'Implement Auth Middleware'
      ORDER BY id DESC LIMIT 1
    `, [testUser.id]);
    assert.ok(insertedAssign, "Workload assignment must be queryable");
    assert.strictEqual(insertedAssign.estimated_hrs, 16.0);
    assert.strictEqual(insertedAssign.status, 'ACTIVE');
    pass("workload_assignments INSERT and field integrity verified.");

    execute(`
      UPDATE workload_assignments
      SET status = 'COMPLETED', updated_at = datetime('now')
      WHERE id = ?
    `, [insertedAssign.id]);
    const updatedAssign = queryOne("SELECT status FROM workload_assignments WHERE id = ?", [insertedAssign.id]);
    assert.strictEqual(updatedAssign.status, 'COMPLETED');
    pass("workload_assignments UPDATE status to COMPLETED verified.");

    // -------------------------------------------------------------
    // Test 8: Verify Indexes in sqlite_master
    // -------------------------------------------------------------
    console.log('\n[STAGE 8] Verifying Indexes in sqlite_master...');
    const expectedIndexes = [
      'idx_member_capacity_user',
      'idx_member_capacity_effective',
      'idx_member_availability_user',
      'idx_member_availability_date',
      'idx_workload_assignments_user',
      'idx_workload_assignments_project',
      'idx_workload_assignments_status',
      'idx_workload_assignments_dates',
      'idx_workload_snapshots_project',
      'idx_workload_alerts_user',
      'idx_workload_alerts_week'
    ];

    for (const idx of expectedIndexes) {
      const idxRow = queryOne(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        [idx]
      );
      assert.ok(idxRow, `Index ${idx} must exist in sqlite_master`);
      pass(`Index ${idx} verified.`);
    }

    console.log('\n================================================================');
    console.log(`  ALL LAYER 1 ASSERTIONS PASSED: ${passedAssertions} / ${passedAssertions} OK`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n[LAYER 1 TEST FAILURE]:', err);
    process.exit(1);
  }
}

runLayer1Tests();
