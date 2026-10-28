/**
 * PRD 23 — Layer 1 Verification Suite
 * 
 * Verifies:
 * 1. Database Connection: WAL mode enabled, busy_timeout >= 5000, foreign_keys = ON
 * 2. 6 New Tables exist in sqlite_master:
 *    - kpi_definitions
 *    - kpi_snapshots
 *    - analytics_dashboards
 *    - dashboard_widgets
 *    - kpi_alerts
 *    - analytics_report_exports
 * 3. Exact column definitions & constraints verified via PRAGMA table_info
 * 4. 11 Performance & Integrity Indexes verified in sqlite_master
 * 5. 5 Append-Only / Immutability Triggers verified in sqlite_master:
 *    - prevent_kpi_snapshot_update
 *    - prevent_kpi_snapshot_delete
 *    - prevent_kpi_alert_delete
 *    - prevent_analytics_export_update
 *    - prevent_analytics_export_delete
 * 6. Real functional Trigger Enforcement (INSERT -> blocked UPDATE -> blocked DELETE via SQL abort)
 * 7. Verification of 10 Pre-Seeded Built-In KPI Definitions with valid JSON calculation specs
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
  console.log('  PRD 23 LAYER 1: DATABASE, SCHEMA & IMMUTABILITY TRIGGERS VERIFICATION');
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
    assert(busyTimeout && Number(busyTimeout.timeout) >= 5000, `SQLite busy_timeout is >= 5000ms (got: ${busyTimeout ? busyTimeout.timeout : 'null'})`);

    const foreignKeys = queryOne('PRAGMA foreign_keys;');
    assert(foreignKeys && Number(foreignKeys.foreign_keys) === 1, 'SQLite foreign_keys constraint enforcement is strictly ON (1)');

    // -------------------------------------------------------------------------
    // 2. Table Existence Verification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Table Existence in sqlite_master ---');

    const requiredTables = [
      'kpi_definitions',
      'kpi_snapshots',
      'analytics_dashboards',
      'dashboard_widgets',
      'kpi_alerts',
      'analytics_report_exports'
    ];

    for (const table of requiredTables) {
      const found = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name=?;", [table]);
      assert(!!found, `Table "${table}" exists in sqlite_master`);
    }

    // -------------------------------------------------------------------------
    // 3. Detailed Column Structure Verification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Detailed Column Structure Verification ---');

    const expectedColumns = {
      kpi_definitions: [
        'id', 'name', 'description', 'data_source', 'metric_type',
        'calculation_query', 'unit', 'target_value', 'alert_threshold_low',
        'alert_threshold_high', 'refresh_interval_minutes', 'is_active',
        'created_by', 'created_at', 'updated_at'
      ],
      kpi_snapshots: [
        'id', 'kpi_id', 'value', 'period_label', 'snapshotted_at', 'calculation_metadata'
      ],
      analytics_dashboards: [
        'id', 'name', 'description', 'owner_id', 'scope', 'is_default', 'layout', 'created_at', 'updated_at'
      ],
      dashboard_widgets: [
        'id', 'dashboard_id', 'kpi_id', 'widget_type', 'title', 'config',
        'position_x', 'position_y', 'width', 'height', 'created_at', 'updated_at'
      ],
      kpi_alerts: [
        'id', 'kpi_id', 'alert_type', 'triggered_value', 'threshold_value',
        'message', 'acknowledged_by', 'acknowledged_at', 'created_at'
      ],
      analytics_report_exports: [
        'id', 'exported_by', 'report_type', 'filters', 'export_format', 'row_count', 'created_at'
      ]
    };

    for (const [table, columns] of Object.entries(expectedColumns)) {
      const tableInfo = queryAll(`PRAGMA table_info(${table});`);
      const existingColNames = tableInfo.map(col => col.name);

      for (const col of columns) {
        assert(existingColNames.includes(col), `${table} contains column "${col}"`);
      }
    }

    // -------------------------------------------------------------------------
    // 4. Index Verification in sqlite_master
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Index Verification in sqlite_master ---');

    const requiredIndexes = [
      'idx_kpi_definitions_data_source',
      'idx_kpi_definitions_is_active',
      'idx_kpi_snapshots_kpi_id',
      'idx_kpi_snapshots_snapshotted_at',
      'idx_analytics_dashboards_owner',
      'idx_analytics_dashboards_scope',
      'idx_dashboard_widgets_dashboard',
      'idx_dashboard_widgets_kpi',
      'idx_kpi_alerts_kpi_id',
      'idx_kpi_alerts_acknowledged',
      'idx_analytics_report_exports_user'
    ];

    for (const idx of requiredIndexes) {
      const found = queryOne("SELECT name FROM sqlite_master WHERE type='index' AND name=?;", [idx]);
      assert(!!found, `Index "${idx}" verified in sqlite_master`);
    }

    // -------------------------------------------------------------------------
    // 5. Trigger Existence in sqlite_master
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Trigger Existence in sqlite_master ---');

    const requiredTriggers = [
      'prevent_kpi_snapshot_update',
      'prevent_kpi_snapshot_delete',
      'prevent_kpi_alert_delete',
      'prevent_analytics_export_update',
      'prevent_analytics_export_delete'
    ];

    for (const trg of requiredTriggers) {
      const found = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?;", [trg]);
      assert(!!found, `Trigger "${trg}" verified in sqlite_master`);
    }

    // -------------------------------------------------------------------------
    // 6. Real Functional Trigger Tests (Append-Only Enforcement)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Real Functional Trigger Tests (Append-Only Enforcement) ---');

    // Retrieve or seed a fixture user
    let userFixture = queryOne("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1;");
    if (!userFixture) {
      userFixture = queryOne("SELECT id FROM users LIMIT 1;");
    }
    assert(!!userFixture, 'Found fixture user in database for foreign key references');
    const userId = userFixture.id;

    // Retrieve or seed a fixture KPI definition
    let kpiFixture = queryOne('SELECT id FROM kpi_definitions LIMIT 1;');
    assert(!!kpiFixture, 'Found fixture KPI definition in database');
    const kpiId = kpiFixture.id;

    // --- Test prevent_kpi_snapshot_update & delete ---
    execute(`
      INSERT INTO kpi_snapshots (kpi_id, value, period_label, calculation_metadata)
      VALUES (?, ?, ?, ?);
    `, [kpiId, 42.5, 'Test-Period-L1', JSON.stringify({ verified: true })]);
    const snapshotRow = queryOne('SELECT id, value FROM kpi_snapshots WHERE period_label=? ORDER BY id DESC LIMIT 1;', ['Test-Period-L1']);
    assert(!!snapshotRow, 'Inserted test fixture row into kpi_snapshots');

    let updateSnapshotBlocked = false;
    try {
      execute('UPDATE kpi_snapshots SET value = 99.9 WHERE id = ?;', [snapshotRow.id]);
    } catch (err) {
      updateSnapshotBlocked = err.message.includes('kpi_snapshots is append-only');
    }
    assert(updateSnapshotBlocked, 'Trigger prevent_kpi_snapshot_update strictly blocks SQL UPDATE with RAISE(ABORT)');

    let deleteSnapshotBlocked = false;
    try {
      execute('DELETE FROM kpi_snapshots WHERE id = ?;', [snapshotRow.id]);
    } catch (err) {
      deleteSnapshotBlocked = err.message.includes('kpi_snapshots is append-only');
    }
    assert(deleteSnapshotBlocked, 'Trigger prevent_kpi_snapshot_delete strictly blocks SQL DELETE with RAISE(ABORT)');

    // --- Test prevent_kpi_alert_delete ---
    execute(`
      INSERT INTO kpi_alerts (kpi_id, alert_type, triggered_value, threshold_value, message)
      VALUES (?, ?, ?, ?, ?);
    `, [kpiId, 'BELOW_THRESHOLD', 12.0, 15.0, 'Layer 1 Test Alert Message']);
    const alertRow = queryOne('SELECT id FROM kpi_alerts WHERE message=? ORDER BY id DESC LIMIT 1;', ['Layer 1 Test Alert Message']);
    assert(!!alertRow, 'Inserted test fixture row into kpi_alerts');

    // Updating acknowledged fields must succeed (acknowledged_by & acknowledged_at mutable per MD line 158)
    let alertUpdateSucceeded = false;
    try {
      execute(`
        UPDATE kpi_alerts
        SET acknowledged_by = ?, acknowledged_at = datetime('now')
        WHERE id = ?;
      `, [userId, alertRow.id]);
      alertUpdateSucceeded = true;
    } catch (err) {
      alertUpdateSucceeded = false;
    }
    assert(alertUpdateSucceeded, 'UPDATE on kpi_alerts acknowledged fields is permitted per business spec');

    let deleteAlertBlocked = false;
    try {
      execute('DELETE FROM kpi_alerts WHERE id = ?;', [alertRow.id]);
    } catch (err) {
      deleteAlertBlocked = err.message.includes('kpi_alerts is append-only');
    }
    assert(deleteAlertBlocked, 'Trigger prevent_kpi_alert_delete strictly blocks SQL DELETE with RAISE(ABORT)');

    // --- Test prevent_analytics_export_update & delete ---
    execute(`
      INSERT INTO analytics_report_exports (exported_by, report_type, filters, export_format, row_count)
      VALUES (?, ?, ?, ?, ?);
    `, [userId, 'KPI_SUMMARY', JSON.stringify({ range: '30d' }), 'JSON', 10]);
    const exportRow = queryOne('SELECT id FROM analytics_report_exports WHERE exported_by=? ORDER BY id DESC LIMIT 1;', [userId]);
    assert(!!exportRow, 'Inserted test fixture row into analytics_report_exports');

    let updateExportBlocked = false;
    try {
      execute('UPDATE analytics_report_exports SET row_count = 999 WHERE id = ?;', [exportRow.id]);
    } catch (err) {
      updateExportBlocked = err.message.includes('analytics_report_exports is append-only');
    }
    assert(updateExportBlocked, 'Trigger prevent_analytics_export_update strictly blocks SQL UPDATE with RAISE(ABORT)');

    let deleteExportBlocked = false;
    try {
      execute('DELETE FROM analytics_report_exports WHERE id = ?;', [exportRow.id]);
    } catch (err) {
      deleteExportBlocked = err.message.includes('analytics_report_exports is append-only');
    }
    assert(deleteExportBlocked, 'Trigger prevent_analytics_export_delete strictly blocks SQL DELETE with RAISE(ABORT)');

    // -------------------------------------------------------------------------
    // 7. Seed Verification (10 Built-In KPI Definitions)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Seed Verification (10 Built-in KPIs) ---');

    const expectedSeedKpis = [
      { name: 'Sprint Velocity', source: 'SPRINT', metric: 'AVERAGE', unit: 'pts', target: 30.0 },
      { name: 'Sprint Completion Rate', source: 'SPRINT', metric: 'PERCENTAGE', unit: '%', target: 85.0 },
      { name: 'OKR Progress (Company Level)', source: 'OKR', metric: 'AVERAGE', unit: '%', target: 75.0 },
      { name: 'Team Utilization', source: 'WORKLOAD', metric: 'AVERAGE', unit: '%', target: 80.0 },
      { name: 'Billable Hours This Month', source: 'TIME_TRACKING', metric: 'SUM', unit: 'hrs', target: 160.0 },
      { name: 'Pipeline Completion Rate', source: 'PIPELINE', metric: 'PERCENTAGE', unit: '%', target: 80.0 },
      { name: 'GitHub PR Merge Rate', source: 'GITHUB', metric: 'PERCENTAGE', unit: '%', target: 90.0 },
      { name: 'Revenue This Month', source: 'REVENUE', metric: 'SUM', unit: '₹', target: 500000.0 },
      { name: 'Active Backlog Items', source: 'SPRINT', metric: 'COUNT', unit: 'count', target: 20.0 },
      { name: 'Overloaded Members', source: 'WORKLOAD', metric: 'COUNT', unit: 'count', target: 0.0 }
    ];

    const allKpis = queryAll('SELECT * FROM kpi_definitions;');
    assert(allKpis.length >= 10, `At least 10 KPI definitions seeded (found: ${allKpis.length})`);

    for (const exp of expectedSeedKpis) {
      const match = allKpis.find(k => k.name === exp.name);
      assert(!!match, `Seeded KPI "${exp.name}" exists in kpi_definitions`);
      if (match) {
        assert(match.data_source === exp.source, `KPI "${exp.name}" data_source is ${exp.source} (got: ${match.data_source})`);
        assert(match.metric_type === exp.metric, `KPI "${exp.name}" metric_type is ${exp.metric} (got: ${match.metric_type})`);
        assert(match.unit === exp.unit, `KPI "${exp.name}" unit is "${exp.unit}" (got: "${match.unit}")`);
        assert(match.target_value === exp.target, `KPI "${exp.name}" target_value is ${exp.target} (got: ${match.target_value})`);
        assert(match.refresh_interval_minutes >= 15, `KPI "${exp.name}" refresh_interval_minutes is >= 15 (got: ${match.refresh_interval_minutes})`);
        assert(match.is_active === 1, `KPI "${exp.name}" is_active is 1 (active)`);

        let validJson = false;
        try {
          const parsed = JSON.parse(match.calculation_query);
          validJson = typeof parsed === 'object' && parsed !== null;
        } catch (e) {
          validJson = false;
        }
        assert(validJson, `KPI "${exp.name}" calculation_query is valid structured JSON`);
      }
    }

    console.log('\n========================================================================');
    console.log('  PRD 23 LAYER 1 VERIFICATION SUMMARY:');
    console.log(`  Total Tests:  ${totalTests}`);
    console.log(`  Passed Tests: ${passedTests}`);
    console.log(`  Failed Tests: ${failedTests}`);
    console.log('========================================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during PRD 23 Layer 1 verification:', error);
    process.exit(1);
  }
}

runLayer1Verification();
