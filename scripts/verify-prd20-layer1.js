import assert from 'node:assert';
import { queryOne, queryAll, execute } from '../src/db/database.js';

console.log('================================================================');
console.log('  PRD 20 LAYER 1 VERIFICATION: GANTT DATABASE & TRIGGERS');
console.log('================================================================\n');

let passedAssertions = 0;
function pass(msg) {
  passedAssertions++;
  console.log(`  [PASS] ${msg}`);
}

async function runLayer1Tests() {
  try {
    // -------------------------------------------------------------
    // Test 1: Verify all 5 Gantt tables exist
    // -------------------------------------------------------------
    console.log('[STAGE 1] Verifying Gantt Table Existence...');
    const expectedTables = [
      'gantt_items',
      'gantt_dependencies',
      'gantt_milestones',
      'gantt_baselines',
      'gantt_history'
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
      gantt_items: [
        'id', 'project_id', 'sprint_id', 'backlog_item_id', 'title',
        'description', 'type', 'assigned_to', 'start_date', 'end_date',
        'progress_pct', 'color', 'parent_item_id', 'position', 'status',
        'created_by', 'created_at', 'updated_at'
      ],
      gantt_dependencies: [
        'id', 'project_id', 'predecessor_item_id', 'successor_item_id',
        'dependency_type', 'lag_days', 'created_by', 'created_at'
      ],
      gantt_milestones: [
        'id', 'project_id', 'gantt_item_id', 'title', 'milestone_date',
        'status', 'achieved_at', 'created_by', 'created_at', 'updated_at'
      ],
      gantt_baselines: [
        'id', 'project_id', 'gantt_item_id', 'baseline_start_date',
        'baseline_end_date', 'snapshot_taken_by', 'snapshot_taken_at'
      ],
      gantt_history: [
        'id', 'gantt_item_id', 'changed_by', 'field_changed',
        'old_value', 'new_value', 'changed_at'
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
    // Test 3: Verify all 6 append-only triggers exist
    // -------------------------------------------------------------
    console.log('\n[STAGE 3] Verifying 6 Append-Only Triggers in sqlite_master...');
    const expectedTriggers = [
      'prevent_gantt_dependency_update',
      'prevent_gantt_dependency_delete',
      'prevent_gantt_baseline_update',
      'prevent_gantt_baseline_delete',
      'prevent_gantt_history_update',
      'prevent_gantt_history_delete'
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
    console.log('\n[STAGE 4] Seeding Fixtures for Trigger & Constraint Testing...');
    const testUserId = `test-user-gantt-l1-${Date.now()}`;
    const testProjectId = `test-proj-gantt-l1-${Date.now()}`;
    const testIdeaId = `test-idea-gantt-l1-${Date.now()}`;

    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, 'Gantt Tester', ?, 'hash123', 'admin', 'active')
    `, [testUserId, `gantt_tester_${Date.now()}@example.com`]);

    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Gantt Test Idea', 'Idea for gantt test', 'APPROVED')
    `, [testIdeaId, testUserId]);

    execute(`
      INSERT INTO projects (id, idea_id, owner_id, title, status)
      VALUES (?, ?, ?, 'Gantt Test Project', 'ACTIVE')
    `, [testProjectId, testIdeaId, testUserId]);

    pass('Test fixtures seeded (user, idea, project).');

    // -------------------------------------------------------------
    // Test 5: Insert Gantt Items
    // -------------------------------------------------------------
    console.log('\n[STAGE 5] Inserting Gantt Items & Validating Column Defaults...');
    const item1Res = execute(`
      INSERT INTO gantt_items (project_id, title, type, assigned_to, start_date, end_date, progress_pct, created_by)
      VALUES (?, 'Task 1: Architecture Planning', 'TASK', ?, '2026-11-01', '2026-11-05', 25.0, ?)
    `, [testProjectId, testUserId, testUserId]);
    const item1Id = Number(item1Res.lastInsertRowid);
    assert.ok(item1Id > 0, 'Item 1 insert must return row ID');

    const item2Res = execute(`
      INSERT INTO gantt_items (project_id, title, type, assigned_to, start_date, end_date, progress_pct, parent_item_id, created_by)
      VALUES (?, 'Task 2: Implementation', 'TASK', ?, '2026-11-06', '2026-11-15', 0.0, ?, ?)
    `, [testProjectId, testUserId, item1Id, testUserId]);
    const item2Id = Number(item2Res.lastInsertRowid);
    assert.ok(item2Id > 0, 'Item 2 insert must return row ID');

    const item1 = queryOne('SELECT * FROM gantt_items WHERE id = ?', [item1Id]);
    assert.strictEqual(item1.title, 'Task 1: Architecture Planning');
    assert.strictEqual(item1.progress_pct, 25.0);
    assert.strictEqual(item1.color, '#4A90E2');
    assert.strictEqual(item1.status, 'NOT_STARTED');
    pass('Gantt items inserted and verified with default values.');

    // -------------------------------------------------------------
    // Test 6: Trigger Verification: gantt_dependencies (Append-Only)
    // -------------------------------------------------------------
    console.log('\n[STAGE 6] Verifying gantt_dependencies Append-Only Triggers...');
    const depRes = execute(`
      INSERT INTO gantt_dependencies (project_id, predecessor_item_id, successor_item_id, dependency_type, lag_days, created_by)
      VALUES (?, ?, ?, 'FINISH_TO_START', 1, ?)
    `, [testProjectId, item1Id, item2Id, testUserId]);
    const depId = Number(depRes.lastInsertRowid);
    assert.ok(depId > 0, 'Dependency insert must succeed');
    pass('Dependency inserted successfully.');

    // 6a: Test UPDATE abort
    let depUpdateFailed = false;
    try {
      execute('UPDATE gantt_dependencies SET lag_days = 3 WHERE id = ?', [depId]);
    } catch (err) {
      depUpdateFailed = true;
      assert.ok(err.message.includes('gantt_dependencies is append-only'), `Expected append-only message, got: ${err.message}`);
    }
    assert.ok(depUpdateFailed, 'UPDATE on gantt_dependencies must fail via trigger');
    pass('Trigger prevent_gantt_dependency_update successfully blocked UPDATE.');

    // 6b: Test DELETE abort
    let depDeleteFailed = false;
    try {
      execute('DELETE FROM gantt_dependencies WHERE id = ?', [depId]);
    } catch (err) {
      depDeleteFailed = true;
      assert.ok(err.message.includes('gantt_dependencies is append-only'), `Expected append-only message, got: ${err.message}`);
    }
    assert.ok(depDeleteFailed, 'DELETE on gantt_dependencies must fail via trigger');
    pass('Trigger prevent_gantt_dependency_delete successfully blocked DELETE.');

    // 6c: Test UNIQUE constraint on (predecessor_item_id, successor_item_id)
    let duplicateFailed = false;
    try {
      execute(`
        INSERT INTO gantt_dependencies (project_id, predecessor_item_id, successor_item_id, created_by)
        VALUES (?, ?, ?, ?)
      `, [testProjectId, item1Id, item2Id, testUserId]);
    } catch (err) {
      duplicateFailed = true;
      assert.ok(err.message.includes('UNIQUE constraint failed'), `Expected UNIQUE constraint message, got: ${err.message}`);
    }
    assert.ok(duplicateFailed, 'Duplicate (predecessor, successor) must be rejected by UNIQUE constraint');
    pass('UNIQUE constraint on (predecessor_item_id, successor_item_id) verified.');

    // -------------------------------------------------------------
    // Test 7: gantt_milestones: Insert & Mutable Update
    // -------------------------------------------------------------
    console.log('\n[STAGE 7] Verifying gantt_milestones Insert & Status Progression...');
    const mRes = execute(`
      INSERT INTO gantt_milestones (project_id, gantt_item_id, title, milestone_date, status, created_by)
      VALUES (?, ?, 'Beta Launch Milestone', '2026-11-20', 'PENDING', ?)
    `, [testProjectId, item2Id, testUserId]);
    const milestoneId = Number(mRes.lastInsertRowid);
    assert.ok(milestoneId > 0, 'Milestone insert must succeed');

    // Milestones are mutable (Admin can mark ACHIEVED)
    execute(`
      UPDATE gantt_milestones
      SET status = 'ACHIEVED', achieved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, [milestoneId]);

    const updatedMilestone = queryOne('SELECT * FROM gantt_milestones WHERE id = ?', [milestoneId]);
    assert.strictEqual(updatedMilestone.status, 'ACHIEVED');
    assert.ok(updatedMilestone.achieved_at, 'achieved_at timestamp must be set');
    pass('Milestone update to ACHIEVED succeeded (milestones are appropriately mutable).');

    // -------------------------------------------------------------
    // Test 8: Trigger Verification: gantt_baselines (Append-Only)
    // -------------------------------------------------------------
    console.log('\n[STAGE 8] Verifying gantt_baselines Append-Only Triggers...');
    const baseRes = execute(`
      INSERT INTO gantt_baselines (project_id, gantt_item_id, baseline_start_date, baseline_end_date, snapshot_taken_by)
      VALUES (?, ?, '2026-11-01', '2026-11-05', ?)
    `, [testProjectId, item1Id, testUserId]);
    const baselineId = Number(baseRes.lastInsertRowid);
    assert.ok(baselineId > 0, 'Baseline insert must succeed');
    pass('Baseline snapshot inserted successfully.');

    // 8a: Test UPDATE abort
    let baseUpdateFailed = false;
    try {
      execute('UPDATE gantt_baselines SET baseline_start_date = ? WHERE id = ?', ['2026-11-02', baselineId]);
    } catch (err) {
      baseUpdateFailed = true;
      assert.ok(err.message.includes('gantt_baselines is append-only'), `Expected append-only message, got: ${err.message}`);
    }
    assert.ok(baseUpdateFailed, 'UPDATE on gantt_baselines must fail via trigger');
    pass('Trigger prevent_gantt_baseline_update successfully blocked UPDATE.');

    // 8b: Test DELETE abort
    let baseDeleteFailed = false;
    try {
      execute('DELETE FROM gantt_baselines WHERE id = ?', [baselineId]);
    } catch (err) {
      baseDeleteFailed = true;
      assert.ok(err.message.includes('gantt_baselines is append-only'), `Expected append-only message, got: ${err.message}`);
    }
    assert.ok(baseDeleteFailed, 'DELETE on gantt_baselines must fail via trigger');
    pass('Trigger prevent_gantt_baseline_delete successfully blocked DELETE.');

    // -------------------------------------------------------------
    // Test 9: Trigger Verification: gantt_history (Append-Only)
    // -------------------------------------------------------------
    console.log('\n[STAGE 9] Verifying gantt_history Append-Only Triggers...');
    const histRes = execute(`
      INSERT INTO gantt_history (gantt_item_id, changed_by, field_changed, old_value, new_value)
      VALUES (?, ?, 'start_date', '2026-11-01', '2026-11-02')
    `, [item1Id, testUserId]);
    const histId = Number(histRes.lastInsertRowid);
    assert.ok(histId > 0, 'History log insert must succeed');
    pass('History record inserted successfully.');

    // 9a: Test UPDATE abort
    let histUpdateFailed = false;
    try {
      execute('UPDATE gantt_history SET new_value = ? WHERE id = ?', ['2026-11-03', histId]);
    } catch (err) {
      histUpdateFailed = true;
      assert.ok(err.message.includes('gantt_history is append-only'), `Expected append-only message, got: ${err.message}`);
    }
    assert.ok(histUpdateFailed, 'UPDATE on gantt_history must fail via trigger');
    pass('Trigger prevent_gantt_history_update successfully blocked UPDATE.');

    // 9b: Test DELETE abort
    let histDeleteFailed = false;
    try {
      execute('DELETE FROM gantt_history WHERE id = ?', [histId]);
    } catch (err) {
      histDeleteFailed = true;
      assert.ok(err.message.includes('gantt_history is append-only'), `Expected append-only message, got: ${err.message}`);
    }
    assert.ok(histDeleteFailed, 'DELETE on gantt_history must fail via trigger');
    pass('Trigger prevent_gantt_history_delete successfully blocked DELETE.');

    // -------------------------------------------------------------
    // Test 10: Composite Indexes Verification
    // -------------------------------------------------------------
    console.log('\n[STAGE 10] Verifying Composite Indexes...');
    const expectedIndexes = [
      'idx_gantt_items_project',
      'idx_gantt_items_sprint',
      'idx_gantt_items_backlog',
      'idx_gantt_items_assigned',
      'idx_gantt_items_parent',
      'idx_gantt_dependencies_project',
      'idx_gantt_dependencies_pred',
      'idx_gantt_dependencies_succ',
      'idx_gantt_milestones_project',
      'idx_gantt_milestones_item',
      'idx_gantt_baselines_project',
      'idx_gantt_baselines_item',
      'idx_gantt_history_item'
    ];

    for (const idxName of expectedIndexes) {
      const idxRow = queryOne(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
        [idxName]
      );
      assert.ok(idxRow, `Index ${idxName} must exist in sqlite_master`);
      pass(`Index ${idxName} verified.`);
    }

    console.log('\n================================================================');
    console.log(`  PRD 20 LAYER 1 ALL TESTS PASSED: ${passedAssertions}/${passedAssertions} ASSERTIONS!`);
    console.log('================================================================\n');

  } catch (error) {
    console.error('\n[FAIL] PRD 20 Layer 1 Verification Failed:');
    console.error(error);
    process.exit(1);
  }
}

runLayer1Tests();
