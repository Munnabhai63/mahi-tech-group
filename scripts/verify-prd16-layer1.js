import { getDatabase, queryAll, queryOne, execute, execRaw } from '../src/db/database.js';
import crypto from 'node:crypto';

console.log('===================================================================');
console.log('   PRD 16 — LAYER 1: DATABASE SCHEMA & TRIGGERS VERIFICATION');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

try {
  const db = getDatabase();

  // -------------------------------------------------------------
  // CHECK 1: pipeline_checklist_points columns
  // -------------------------------------------------------------
  console.log('--- CHECK 1: pipeline_checklist_points Alterations ---');
  const pointCols = queryAll('PRAGMA table_info(pipeline_checklist_points);');
  const pointColMap = Object.fromEntries(pointCols.map(c => [c.name, c]));

  assert(!!pointColMap.claim_locked_by, 'pipeline_checklist_points has claim_locked_by column', `type: ${pointColMap.claim_locked_by?.type}`);
  assert(!!pointColMap.claim_locked_at, 'pipeline_checklist_points has claim_locked_at column', `type: ${pointColMap.claim_locked_at?.type}`);

  // -------------------------------------------------------------
  // CHECK 2: point_pool_claims table structure & trigger
  // -------------------------------------------------------------
  console.log('\n--- CHECK 2: point_pool_claims Table & Append-Only Trigger ---');
  const claimCols = queryAll('PRAGMA table_info(point_pool_claims);');
  const claimColMap = Object.fromEntries(claimCols.map(c => [c.name, c]));

  const expectedClaimCols = [
    'id', 'point_id', 'project_id', 'deliverable_id', 'stage',
    'claimed_by', 'claimed_at', 'released_at', 'release_reason', 'released_by'
  ];
  for (const col of expectedClaimCols) {
    assert(!!claimColMap[col], `point_pool_claims has column: ${col}`, `type: ${claimColMap[col]?.type}`);
  }

  // Test prevent_claim_delete trigger inside transaction with rollback
  db.exec('SAVEPOINT test_claim_delete;');
  let deleteTriggerRejected = false;
  let triggerErrorMessage = '';
  try {
    const testClaimId = 'test-claim-' + crypto.randomUUID();
    // We insert with dummy values (or valid foreign keys)
    // First find any existing user or insert dummy
    const anyUser = queryOne('SELECT id FROM users LIMIT 1;');
    const anyProj = queryOne('SELECT id FROM projects LIMIT 1;');
    const anyDeliv = queryOne('SELECT id FROM pipeline_deliverables LIMIT 1;');
    const anyPoint = queryOne('SELECT id FROM pipeline_checklist_points LIMIT 1;');

    if (anyUser && anyProj && anyDeliv && anyPoint) {
      execute(`
        INSERT INTO point_pool_claims (id, point_id, project_id, deliverable_id, stage, claimed_by)
        VALUES (?, ?, ?, ?, 'DEV', ?)
      `, [testClaimId, anyPoint.id, anyProj.id, anyDeliv.id, anyUser.id]);

      try {
        execute('DELETE FROM point_pool_claims WHERE id = ?;', [testClaimId]);
      } catch (err) {
        deleteTriggerRejected = true;
        triggerErrorMessage = err.message;
      }
    } else {
      // Direct raw without FK check inside savepoint
      db.exec('PRAGMA foreign_keys = OFF;');
      execute(`
        INSERT INTO point_pool_claims (id, point_id, project_id, deliverable_id, stage, claimed_by)
        VALUES (?, 'p1', 'prj1', 'd1', 'DEV', 'u1')
      `, [testClaimId]);

      try {
        execute('DELETE FROM point_pool_claims WHERE id = ?;', [testClaimId]);
      } catch (err) {
        deleteTriggerRejected = true;
        triggerErrorMessage = err.message;
      }
      db.exec('PRAGMA foreign_keys = ON;');
    }
  } finally {
    db.exec('ROLLBACK TO SAVEPOINT test_claim_delete;');
    db.exec('RELEASE SAVEPOINT test_claim_delete;');
  }

  assert(
    deleteTriggerRejected && triggerErrorMessage.includes('point_pool_claims is append-only. Deletes forbidden.'),
    'prevent_claim_delete trigger strictly rejects DELETE',
    `Trigger error: "${triggerErrorMessage}"`
  );

  // -------------------------------------------------------------
  // CHECK 3: participation_thresholds table & unique constraint
  // -------------------------------------------------------------
  console.log('\n--- CHECK 3: participation_thresholds Table & Defaults ---');
  const threshCols = queryAll('PRAGMA table_info(participation_thresholds);');
  const threshColMap = Object.fromEntries(threshCols.map(c => [c.name, c]));

  const expectedThreshCols = [
    'id', 'project_id', 'threshold_pct', 'abandonment_days', 'set_by', 'created_at', 'updated_at'
  ];
  for (const col of expectedThreshCols) {
    assert(!!threshColMap[col], `participation_thresholds has column: ${col}`, `type: ${threshColMap[col]?.type}`);
  }

  // Test default values and unique constraint inside savepoint
  db.exec('SAVEPOINT test_threshold_savepoint;');
  try {
    const anyUser = queryOne('SELECT id FROM users LIMIT 1;');
    const anyProj = queryOne('SELECT id FROM projects LIMIT 1;');

    const threshId1 = 'thresh-1-' + crypto.randomUUID();
    const threshId2 = 'thresh-2-' + crypto.randomUUID();

    execute(`
      INSERT INTO participation_thresholds (id, project_id, set_by)
      VALUES (?, ?, ?)
    `, [threshId1, anyProj.id, anyUser.id]);

    const createdThresh = queryOne('SELECT * FROM participation_thresholds WHERE id = ?;', [threshId1]);
    assert(Number(createdThresh.threshold_pct) === 20, 'Default threshold_pct is 20.00', `Actual: ${createdThresh.threshold_pct}`);
    assert(Number(createdThresh.abandonment_days) === 7, 'Default abandonment_days is 7', `Actual: ${createdThresh.abandonment_days}`);

    // Verify UNIQUE constraint on project_id
    let uniqueFailed = false;
    let uniqueError = '';
    try {
      execute(`
        INSERT INTO participation_thresholds (id, project_id, set_by)
        VALUES (?, ?, ?)
      `, [threshId2, anyProj.id, anyUser.id]);
    } catch (err) {
      uniqueFailed = true;
      uniqueError = err.message;
    }
    assert(uniqueFailed, 'UNIQUE(project_id) constraint rejected duplicate project threshold', `Error: "${uniqueError}"`);
  } finally {
    db.exec('ROLLBACK TO SAVEPOINT test_threshold_savepoint;');
    db.exec('RELEASE SAVEPOINT test_threshold_savepoint;');
  }

  // -------------------------------------------------------------
  // CHECK 4: point_tool_links table
  // -------------------------------------------------------------
  console.log('\n--- CHECK 4: point_tool_links Table & Soft Delete Column ---');
  const toolCols = queryAll('PRAGMA table_info(point_tool_links);');
  const toolColMap = Object.fromEntries(toolCols.map(c => [c.name, c]));

  const expectedToolCols = [
    'id', 'point_id', 'project_id', 'added_by', 'tool_name', 'tool_url', 'deleted_at', 'created_at'
  ];
  for (const col of expectedToolCols) {
    assert(!!toolColMap[col], `point_tool_links has column: ${col}`, `type: ${toolColMap[col]?.type}`);
  }

  // -------------------------------------------------------------
  // CHECK 5: revenue_splits alterations & trigger behavior
  // -------------------------------------------------------------
  console.log('\n--- CHECK 5: revenue_splits Alterations & Participation Gate Trigger ---');
  const revSplitCols = queryAll('PRAGMA table_info(revenue_splits);');
  const revSplitColMap = Object.fromEntries(revSplitCols.map(c => [c.name, c]));

  assert(!!revSplitColMap.is_blocked, 'revenue_splits has is_blocked column', `default: ${revSplitColMap.is_blocked?.dflt_value}`);
  assert(!!revSplitColMap.block_reason, 'revenue_splits has block_reason column');
  assert(!!revSplitColMap.unblocked_by, 'revenue_splits has unblocked_by column');
  assert(!!revSplitColMap.unblocked_at, 'revenue_splits has unblocked_at column');

  // Test updating is_blocked vs updating financial column inside savepoint
  db.exec('SAVEPOINT test_rev_splits_trigger;');
  try {
    const testSplitId = 'test-split-' + crypto.randomUUID();
    const anyEvent = queryOne('SELECT id FROM revenue_events LIMIT 1;');
    const anyUser = queryOne('SELECT id FROM users LIMIT 1;');

    execute(`
      INSERT INTO revenue_splits (id, revenue_event_id, user_id, amount, rule_applied, split_type)
      VALUES (?, ?, ?, 500.00, 'TEAM_100', 'TEAM_CONTRIBUTOR')
    `, [testSplitId, anyEvent.id, anyUser.id]);

    // Test 5A: Updating participation fields (is_blocked, block_reason, unblocked_by, unblocked_at) MUST SUCCEED
    let updateBlockFailed = false;
    try {
      execute(`
        UPDATE revenue_splits
        SET is_blocked = 1, block_reason = 'Participation under 20% threshold'
        WHERE id = ?
      `, [testSplitId]);
    } catch (err) {
      updateBlockFailed = true;
      console.error('Update block failed:', err.message);
    }
    assert(!updateBlockFailed, 'Updating is_blocked and block_reason succeeds on revenue_splits');

    const updatedSplit = queryOne('SELECT is_blocked, block_reason FROM revenue_splits WHERE id = ?;', [testSplitId]);
    assert(updatedSplit.is_blocked === 1, 'is_blocked verified as 1 in DB');
    assert(updatedSplit.block_reason === 'Participation under 20% threshold', 'block_reason verified in DB');

    // Test 5B: Unblocking with admin id and timestamp MUST SUCCEED
    let unblockFailed = false;
    try {
      execute(`
        UPDATE revenue_splits
        SET is_blocked = 0, unblocked_by = ?, unblocked_at = CURRENT_TIMESTAMP, block_reason = 'Admin override'
        WHERE id = ?
      `, [anyUser.id, testSplitId]);
    } catch (err) {
      unblockFailed = true;
      console.error('Unblock failed:', err.message);
    }
    assert(!unblockFailed, 'Unblocking revenue split succeeds with unblocked_by and unblocked_at');

    // Test 5C: Updating FINANCIAL fields (amount, user_id, rule_applied) MUST BE BLOCKED BY TRIGGER
    let financialUpdateRejected = false;
    let financialErrorMessage = '';
    try {
      execute(`
        UPDATE revenue_splits
        SET amount = 99999.00
        WHERE id = ?
      `, [testSplitId]);
    } catch (err) {
      financialUpdateRejected = true;
      financialErrorMessage = err.message;
    }
    assert(
      financialUpdateRejected && financialErrorMessage.includes('Immutable ledger: UPDATE not allowed on revenue_splits'),
      'Financial mutation on revenue_splits (amount) is strictly blocked by immutable trigger',
      `Trigger error: "${financialErrorMessage}"`
    );

    // Test 5D: DELETE on revenue_splits MUST BE BLOCKED BY TRIGGER
    let deleteSplitRejected = false;
    let deleteSplitErrorMessage = '';
    try {
      execute('DELETE FROM revenue_splits WHERE id = ?;', [testSplitId]);
    } catch (err) {
      deleteSplitRejected = true;
      deleteSplitErrorMessage = err.message;
    }
    assert(
      deleteSplitRejected && deleteSplitErrorMessage.includes('Immutable ledger: DELETE not allowed on revenue_splits'),
      'DELETE on revenue_splits is strictly blocked by immutable trigger',
      `Trigger error: "${deleteSplitErrorMessage}"`
    );
  } finally {
    db.exec('ROLLBACK TO SAVEPOINT test_rev_splits_trigger;');
    db.exec('RELEASE SAVEPOINT test_rev_splits_trigger;');
  }

  // -------------------------------------------------------------
  // CHECK 6: Index Verification
  // -------------------------------------------------------------
  console.log('\n--- CHECK 6: Index Verification ---');
  const allIndexes = queryAll("SELECT name FROM sqlite_master WHERE type='index';").map(i => i.name);

  const expectedIndexes = [
    'idx_point_pool_claims_point_id',
    'idx_point_pool_claims_project_id',
    'idx_point_pool_claims_claimed_by',
    'idx_point_pool_claims_stage',
    'idx_participation_thresholds_project_id',
    'idx_point_tool_links_point_id',
    'idx_point_tool_links_project_id'
  ];

  for (const idx of expectedIndexes) {
    assert(allIndexes.includes(idx), `Index exists: ${idx}`);
  }

  // Summary
  console.log('\n===================================================================');
  console.log(`  PRD 16 LAYER 1 SUMMARY: ${passedTests} / ${totalTests} CHECKS PASSED`);
  console.log('===================================================================');

  if (passedTests === totalTests) {
    console.log('>>> LAYER 1 100% COMPLETE & VERIFIED CLEAN.');
    process.exit(0);
  } else {
    console.error('>>> LAYER 1 VERIFICATION FAILED.');
    process.exit(1);
  }
} catch (err) {
  console.error('Layer 1 Verification Error:', err);
  process.exit(1);
}
