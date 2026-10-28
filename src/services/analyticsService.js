/**
 * PRD 23 — Analytics & KPI Service
 * 
 * Implements:
 * 1. Safe KPI Calculation Engine with parameterized SQLite queries (no client/arbitrary SQL execution)
 * 2. Supported aggregation types: SUM, COUNT, AVERAGE, PERCENTAGE, LATEST, RATIO
 * 3. Graceful fallback for empty/inactive sources (e.g. GitHub returns 0.0 without throwing)
 * 4. Append-only KPI Snapshot Engine
 * 5. Automated Alert Generation with threshold breach detection and deduplication
 * 6. Built-in KPI Seed Protection (is_built_in = 1 returns 400 Bad Request on DELETE)
 * 7. Cron refresh scheduler enforcing minimum refresh_interval_minutes >= 15
 * 8. Manual updated_at timestamps on all updates
 * 9. Server-side RBAC validation
 */

import { queryOne, queryAll, execute, getDatabase } from '../db/database.js';
import * as workloadService from './workloadService.js';

const ALLOWED_AGGS = ['SUM', 'COUNT', 'AVERAGE', 'PERCENTAGE', 'LATEST', 'RATIO'];

const ALLOWED_TABLES = [
  'time_entries',
  'sprints',
  'backlog_items',
  'sprint_velocity_log',
  'okr_objectives',
  'okr_key_results',
  'workload_snapshots',
  'workload_assignments',
  'workload_alerts',
  'member_capacity',
  'pipeline_deliverables',
  'pipeline_checklist_points',
  'github_webhook_log',
  'revenue_events',
  'revenue_splits',
  'ideas',
  'votes',
  'users'
];

const TABLE_ALIASES = {
  'objectives': 'okr_objectives',
  'revenue_transactions': 'revenue_events',
  'workload_snapshots': 'workload_alerts'
};

/**
 * Enforces Admin or SuperAdmin role
 */
export function requireAdmin(user) {
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    const err = new Error('Admin or SuperAdmin role required');
    err.status = 403;
    throw err;
  }
}

/**
 * Parses and validates calculation_query specification
 */
export function parseCalculationQuery(querySpec) {
  let spec = querySpec;
  if (typeof spec === 'string') {
    try {
      spec = JSON.parse(querySpec);
    } catch (e) {
      const err = new Error('Invalid calculation_query JSON format');
      err.status = 400;
      throw err;
    }
  }

  if (!spec || typeof spec !== 'object') {
    const err = new Error('calculation_query must be a valid structured JSON object');
    err.status = 400;
    throw err;
  }

  const rawTable = spec.table || spec.source;
  const table = TABLE_ALIASES[rawTable] || rawTable;
  const agg = (spec.agg || 'COUNT').toUpperCase();

  if (!ALLOWED_AGGS.includes(agg)) {
    const err = new Error(`Unsupported agg type: "${agg}". Allowed: ${ALLOWED_AGGS.join(', ')}`);
    err.status = 400;
    throw err;
  }

  if (table && !ALLOWED_TABLES.includes(table)) {
    const err = new Error(`Table "${table}" is not permitted in calculation_query spec`);
    err.status = 400;
    throw err;
  }

  return { ...spec, table, agg };
}

/**
 * Computes live KPI value from database based on KPI definition and query spec
 */
export function calculateKpiValue(kpi) {
  const spec = parseCalculationQuery(kpi.calculation_query);
  const kpiName = (kpi.name || '').trim();

  // Specialized built-in KPI calculation paths
  switch (kpiName) {
    case 'Sprint Velocity': {
      const row = queryOne(`
        SELECT COALESCE(AVG(total_points_completed), 0.0) as val
        FROM (
          SELECT total_points_completed
          FROM sprint_velocity_log
          ORDER BY logged_at DESC, id DESC
          LIMIT 5
        );
      `);
      const val = row ? Number(row.val || 0) : 0.0;
      return { value: Math.round(val * 100) / 100, metadata: { method: 'sprint_velocity_5_avg', sample_count: 5 } };
    }

    case 'Sprint Completion Rate': {
      // Find active sprint, or fallback to latest sprint
      let sprint = queryOne("SELECT id FROM sprints WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1;");
      if (!sprint) {
        sprint = queryOne("SELECT id FROM sprints ORDER BY id DESC LIMIT 1;");
      }
      if (!sprint) {
        return { value: 0.0, metadata: { reason: 'no_sprints_found' } };
      }

      const counts = queryOne(`
        SELECT 
          COALESCE(SUM(story_points), 0) as committed,
          COALESCE(SUM(CASE WHEN status = 'DONE' THEN story_points ELSE 0 END), 0) as completed
        FROM backlog_items
        WHERE sprint_id = ?;
      `, [sprint.id]);

      const committed = counts ? Number(counts.committed || 0) : 0;
      const completed = counts ? Number(counts.completed || 0) : 0;
      const rate = committed > 0 ? (completed / committed) * 100 : 0.0;
      return { value: Math.round(rate * 100) / 100, metadata: { sprint_id: sprint.id, committed, completed } };
    }

    case 'OKR Progress (Company Level)': {
      const row = queryOne(`
        SELECT COALESCE(AVG(progress_pct), 0.0) as val
        FROM okr_objectives
        WHERE level = 'COMPANY' AND status = 'ACTIVE';
      `);
      const val = row ? Number(row.val || 0) : 0.0;
      return { value: Math.round(val * 100) / 100, metadata: { scope: 'COMPANY', status: 'ACTIVE' } };
    }

    case 'Team Utilization': {
      try {
        const teamWorkload = workloadService.getTeamWorkload(null);
        const val = teamWorkload && teamWorkload.summary ? teamWorkload.summary.team_utilization_pct : 0.0;
        return { value: Number(val) || 0.0, metadata: { source: 'workload_service', members: teamWorkload.summary ? teamWorkload.summary.total_members : 0 } };
      } catch (err) {
        const row = queryOne(`
          SELECT COALESCE(AVG(utilization_pct), 0.0) as val
          FROM workload_alerts;
        `);
        const val = row ? Number(row.val || 0) : 0.0;
        return { value: Math.round(val * 100) / 100, metadata: { source: 'workload_alerts' } };
      }
    }

    case 'Billable Hours This Month': {
      const row = queryOne(`
        SELECT COALESCE(SUM(duration_minutes), 0) as total_min
        FROM time_entries
        WHERE is_billable = 1 AND status = 'APPROVED';
      `);
      const totalMin = row ? Number(row.total_min || 0) : 0;
      const hrs = totalMin / 60.0;
      return { value: Math.round(hrs * 100) / 100, metadata: { total_minutes: totalMin } };
    }

    case 'Pipeline Completion Rate': {
      const row = queryOne(`
        SELECT 
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END), 0) as approved
        FROM pipeline_checklist_points;
      `);
      const total = row ? Number(row.total || 0) : 0;
      const approved = row ? Number(row.approved || 0) : 0;
      const rate = total > 0 ? (approved / total) * 100 : 0.0;
      return { value: Math.round(rate * 100) / 100, metadata: { total_points: total, approved_points: approved } };
    }

    case 'GitHub PR Merge Rate': {
      try {
        const row = queryOne(`
          SELECT 
            COUNT(*) as total,
            COALESCE(SUM(CASE WHEN action = 'closed' AND payload LIKE '%"merged":true%' THEN 1 ELSE 0 END), 0) as merged
          FROM github_webhook_log
          WHERE event_type = 'pull_request';
        `);
        const total = row ? Number(row.total || 0) : 0;
        const merged = row ? Number(row.merged || 0) : 0;
        const rate = total > 0 ? (merged / total) * 100 : 0.0;
        return { value: Math.round(rate * 100) / 100, metadata: { total_prs: total, merged_prs: merged } };
      } catch (err) {
        // Standing rule: Graceful fallback on empty or inactive GitHub tables
        return { value: 0.0, metadata: { error: err.message, fallback: true } };
      }
    }

    case 'Revenue This Month': {
      const row = queryOne(`
        SELECT COALESCE(SUM(amount), 0.0) as total_amt
        FROM revenue_events;
      `);
      const val = row ? Number(row.total_amt || 0) : 0.0;
      return { value: Math.round(val * 100) / 100, metadata: { currency: 'INR' } };
    }

    case 'Active Backlog Items': {
      const row = queryOne(`
        SELECT COUNT(*) as count
        FROM backlog_items
        WHERE sprint_id IS NULL AND status != 'DONE';
      `);
      const count = row ? Number(row.count || 0) : 0;
      return { value: count, metadata: { filter: 'sprint_id IS NULL AND status != DONE' } };
    }

    case 'Overloaded Members': {
      try {
        const teamWorkload = workloadService.getTeamWorkload(null);
        const count = teamWorkload && teamWorkload.summary ? teamWorkload.summary.overloaded_count : 0;
        return { value: Number(count) || 0, metadata: { source: 'workload_service', threshold: 100 } };
      } catch (err) {
        const row = queryOne(`
          SELECT COUNT(DISTINCT user_id) as count
          FROM workload_alerts
          WHERE alert_type = 'OVERLOAD' OR utilization_pct > 100;
        `);
        const count = row ? Number(row.count || 0) : 0;
        return { value: count, metadata: { threshold: 100 } };
      }
    }
  }

  // Generic custom calculation engine based on validated spec
  const table = spec.table;
  const field = spec.field ? spec.field.replace(/[^a-zA-Z0-9_]/g, '') : null;
  const filter = spec.filter || {};
  const divisor = Number(spec.divisor || 1);

  const whereClauses = [];
  const params = [];

  for (const [key, val] of Object.entries(filter)) {
    const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, '');
    if (val === null) {
      whereClauses.push(`${cleanKey} IS NULL`);
    } else if (cleanKey === 'not_status') {
      whereClauses.push(`status != ?`);
      params.push(val);
    } else if (cleanKey === 'min_utilization') {
      whereClauses.push(`utilization_pct > ?`);
      params.push(val);
    } else {
      whereClauses.push(`${cleanKey} = ?`);
      params.push(val);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  let calculatedVal = 0.0;

  switch (spec.agg) {
    case 'COUNT': {
      const sql = `SELECT COUNT(*) as val FROM ${table} ${whereSql};`;
      const res = queryOne(sql, params);
      calculatedVal = res ? Number(res.val || 0) : 0;
      break;
    }
    case 'SUM': {
      const targetField = field || 'id';
      const sql = `SELECT COALESCE(SUM(${targetField}), 0.0) as val FROM ${table} ${whereSql};`;
      const res = queryOne(sql, params);
      calculatedVal = res ? Number(res.val || 0) : 0.0;
      break;
    }
    case 'AVERAGE': {
      const targetField = field || 'id';
      const sql = `SELECT COALESCE(AVG(${targetField}), 0.0) as val FROM ${table} ${whereSql};`;
      const res = queryOne(sql, params);
      calculatedVal = res ? Number(res.val || 0) : 0.0;
      break;
    }
    case 'LATEST': {
      const targetField = field || 'id';
      const sql = `SELECT ${targetField} as val FROM ${table} ${whereSql} ORDER BY id DESC LIMIT 1;`;
      const res = queryOne(sql, params);
      calculatedVal = res ? Number(res.val || 0) : 0.0;
      break;
    }
    case 'PERCENTAGE':
    case 'RATIO': {
      const totalSql = `SELECT COUNT(*) as total FROM ${table} ${whereSql};`;
      const totalRes = queryOne(totalSql, params);
      const total = totalRes ? Number(totalRes.total || 0) : 0;
      if (total > 0 && spec.filter_numerator) {
        const numClauses = [...whereClauses];
        const numParams = [...params];
        for (const [k, v] of Object.entries(spec.filter_numerator)) {
          numClauses.push(`${k.replace(/[^a-zA-Z0-9_]/g, '')} = ?`);
          numParams.push(v);
        }
        const numSql = `SELECT COUNT(*) as num FROM ${table} WHERE ${numClauses.join(' AND ')};`;
        const numRes = queryOne(numSql, numParams);
        const num = numRes ? Number(numRes.num || 0) : 0;
        calculatedVal = (num / total) * 100;
      } else {
        calculatedVal = total;
      }
      break;
    }
  }

  if (divisor && divisor !== 1) {
    calculatedVal = calculatedVal / divisor;
  }

  return {
    value: Math.round(calculatedVal * 100) / 100,
    metadata: { agg: spec.agg, table, filter }
  };
}

/**
 * Checks for threshold breaches and generates deduplicated alerts
 */
export function checkAndGenerateKpiAlert(kpi, value) {
  const alertsCreated = [];

  // Low threshold check
  if (kpi.alert_threshold_low !== null && kpi.alert_threshold_low !== undefined) {
    const lowThresh = Number(kpi.alert_threshold_low);
    if (value < lowThresh) {
      // Deduplication: check if unacknowledged alert already exists for this KPI and type
      const existing = queryOne(`
        SELECT id FROM kpi_alerts 
        WHERE kpi_id = ? AND alert_type = 'BELOW_THRESHOLD' AND acknowledged_at IS NULL 
        LIMIT 1;
      `, [kpi.id]);

      if (!existing) {
        const message = `KPI "${kpi.name}" dropped to ${value}${kpi.unit || ''}, falling below low threshold of ${lowThresh}${kpi.unit || ''}`;
        execute(`
          INSERT INTO kpi_alerts (kpi_id, alert_type, triggered_value, threshold_value, message, created_at)
          VALUES (?, 'BELOW_THRESHOLD', ?, ?, ?, datetime('now'));
        `, [kpi.id, value, lowThresh, message]);
        alertsCreated.push({ type: 'BELOW_THRESHOLD', threshold: lowThresh, value });
      }
    }
  }

  // High threshold check
  if (kpi.alert_threshold_high !== null && kpi.alert_threshold_high !== undefined) {
    const highThresh = Number(kpi.alert_threshold_high);
    if (value > highThresh) {
      const existing = queryOne(`
        SELECT id FROM kpi_alerts 
        WHERE kpi_id = ? AND alert_type = 'ABOVE_THRESHOLD' AND acknowledged_at IS NULL 
        LIMIT 1;
      `, [kpi.id]);

      if (!existing) {
        const message = `KPI "${kpi.name}" reached ${value}${kpi.unit || ''}, exceeding high threshold of ${highThresh}${kpi.unit || ''}`;
        execute(`
          INSERT INTO kpi_alerts (kpi_id, alert_type, triggered_value, threshold_value, message, created_at)
          VALUES (?, 'ABOVE_THRESHOLD', ?, ?, ?, datetime('now'));
        `, [kpi.id, value, highThresh, message]);
        alertsCreated.push({ type: 'ABOVE_THRESHOLD', threshold: highThresh, value });
      }
    }
  }

  return alertsCreated;
}

/**
 * Forces immediate calculation and snapshot insert for a KPI
 */
export function refreshKpi(kpiId, user = null) {
  if (user) requireAdmin(user);

  const kpi = queryOne('SELECT * FROM kpi_definitions WHERE id = ?;', [kpiId]);
  if (!kpi) {
    const err = new Error(`KPI definition with ID ${kpiId} not found`);
    err.status = 404;
    throw err;
  }

  const { value, metadata } = calculateKpiValue(kpi);

  // Generate period label (ISO date string)
  const now = new Date();
  const periodLabel = now.toISOString().split('T')[0];

  // Append-only snapshot insertion
  execute(`
    INSERT INTO kpi_snapshots (kpi_id, value, period_label, calculation_metadata, snapshotted_at)
    VALUES (?, ?, ?, ?, datetime('now'));
  `, [kpi.id, value, periodLabel, JSON.stringify(metadata)]);

  const snapshot = queryOne('SELECT * FROM kpi_snapshots WHERE kpi_id = ? ORDER BY id DESC LIMIT 1;', [kpi.id]);

  // Alert check & creation
  const alertsTriggered = checkAndGenerateKpiAlert(kpi, value);

  return {
    success: true,
    kpi_id: kpi.id,
    kpi_name: kpi.name,
    value,
    unit: kpi.unit,
    period_label: periodLabel,
    snapshotted_at: snapshot ? snapshot.snapshotted_at : now.toISOString(),
    calculation_metadata: metadata,
    alerts_triggered: alertsTriggered
  };
}

/**
 * Creates a new custom KPI definition and takes initial snapshot
 */
export function createKpiDefinition(data, user) {
  requireAdmin(user);

  const {
    name,
    description,
    data_source,
    metric_type,
    calculation_query,
    unit,
    target_value,
    alert_threshold_low,
    alert_threshold_high,
    refresh_interval_minutes = 60
  } = data;

  if (!name || typeof name !== 'string' || !name.trim()) {
    const err = new Error('KPI name is required and cannot be empty');
    err.status = 400;
    throw err;
  }

  const allowedSources = ['SPRINT', 'OKR', 'TIME_TRACKING', 'WORKLOAD', 'PIPELINE', 'REVENUE', 'GITHUB', 'CUSTOM'];
  if (!data_source || !allowedSources.includes(data_source.toUpperCase())) {
    const err = new Error(`Invalid data_source. Allowed: ${allowedSources.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const allowedMetrics = ['COUNT', 'SUM', 'AVERAGE', 'PERCENTAGE', 'RATIO', 'LATEST'];
  if (!metric_type || !allowedMetrics.includes(metric_type.toUpperCase())) {
    const err = new Error(`Invalid metric_type. Allowed: ${allowedMetrics.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const refreshInterval = Number(refresh_interval_minutes || 60);
  if (isNaN(refreshInterval) || refreshInterval < 15) {
    const err = new Error('Minimum refresh interval is 15 minutes');
    err.status = 400;
    throw err;
  }

  // Validate calculation_query structure
  const parsedSpec = parseCalculationQuery(calculation_query);
  const queryStr = JSON.stringify(parsedSpec);

  // Check unique name constraint
  const existing = queryOne('SELECT id FROM kpi_definitions WHERE name = ?;', [name.trim()]);
  if (existing) {
    const err = new Error(`A KPI with name "${name.trim()}" already exists`);
    err.status = 409;
    throw err;
  }

  execute(`
    INSERT INTO kpi_definitions (
      name, description, data_source, metric_type, calculation_query, unit,
      target_value, alert_threshold_low, alert_threshold_high, refresh_interval_minutes,
      is_active, is_built_in, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, datetime('now'), datetime('now'));
  `, [
    name.trim(),
    description || null,
    data_source.toUpperCase(),
    metric_type.toUpperCase(),
    queryStr,
    unit || null,
    target_value !== undefined && target_value !== null ? Number(target_value) : null,
    alert_threshold_low !== undefined && alert_threshold_low !== null ? Number(alert_threshold_low) : null,
    alert_threshold_high !== undefined && alert_threshold_high !== null ? Number(alert_threshold_high) : null,
    refreshInterval,
    user.id
  ]);

  const newKpi = queryOne('SELECT * FROM kpi_definitions WHERE name = ? ORDER BY id DESC LIMIT 1;', [name.trim()]);

  // Log creation to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'KPI_CREATED', '/api/analytics/kpi/create', ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(newKpi.id)]);

  // Immediate initial snapshot calculation
  const snapshotRes = refreshKpi(newKpi.id);

  return {
    success: true,
    kpi: newKpi,
    initial_snapshot: snapshotRes
  };
}

/**
 * Retrieves all active KPI definitions joined with their latest snapshot
 */
export function getKpis(filters = {}, user) {
  requireAdmin(user);

  let sql = `
    SELECT 
      k.*,
      s.value as latest_value,
      s.snapshotted_at as latest_snapshot_at,
      s.period_label as latest_period_label
    FROM kpi_definitions k
    LEFT JOIN (
      SELECT kpi_id, value, snapshotted_at, period_label,
             ROW_NUMBER() OVER(PARTITION BY kpi_id ORDER BY id DESC) as rn
      FROM kpi_snapshots
    ) s ON k.id = s.kpi_id AND s.rn = 1
  `;

  const whereClauses = [];
  const params = [];

  if (filters.data_source) {
    whereClauses.push('k.data_source = ?');
    params.push(filters.data_source.toUpperCase());
  }

  if (filters.is_active !== undefined) {
    whereClauses.push('k.is_active = ?');
    params.push(Number(filters.is_active));
  } else {
    // By default return active KPIs
    whereClauses.push('k.is_active = 1');
  }

  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  sql += ' ORDER BY k.id ASC;';

  const rows = queryAll(sql, params);
  return { success: true, count: rows.length, kpis: rows };
}

/**
 * Retrieves a single KPI definition with its last 30 snapshots
 */
export function getKpiById(kpiId, user) {
  requireAdmin(user);

  const kpi = queryOne('SELECT * FROM kpi_definitions WHERE id = ?;', [kpiId]);
  if (!kpi) {
    const err = new Error(`KPI definition with ID ${kpiId} not found`);
    err.status = 404;
    throw err;
  }

  const snapshots = queryAll(`
    SELECT id, value, period_label, snapshotted_at, calculation_metadata
    FROM kpi_snapshots
    WHERE kpi_id = ?
    ORDER BY id DESC
    LIMIT 30;
  `, [kpiId]);

  return {
    success: true,
    kpi,
    snapshots: snapshots.reverse() // Return chronological for trend charting
  };
}

/**
 * Updates a KPI definition with manual updated_at maintenance
 */
export function updateKpiDefinition(kpiId, data, user) {
  requireAdmin(user);

  const kpi = queryOne('SELECT * FROM kpi_definitions WHERE id = ?;', [kpiId]);
  if (!kpi) {
    const err = new Error(`KPI definition with ID ${kpiId} not found`);
    err.status = 404;
    throw err;
  }

  const updates = [];
  const params = [];

  if (data.name !== undefined) {
    if (!data.name || !data.name.trim()) {
      const err = new Error('KPI name cannot be empty');
      err.status = 400;
      throw err;
    }
    updates.push('name = ?');
    params.push(data.name.trim());
  }

  if (data.description !== undefined) {
    updates.push('description = ?');
    params.push(data.description);
  }

  if (data.unit !== undefined) {
    updates.push('unit = ?');
    params.push(data.unit);
  }

  if (data.target_value !== undefined) {
    updates.push('target_value = ?');
    params.push(data.target_value !== null ? Number(data.target_value) : null);
  }

  if (data.alert_threshold_low !== undefined) {
    updates.push('alert_threshold_low = ?');
    params.push(data.alert_threshold_low !== null ? Number(data.alert_threshold_low) : null);
  }

  if (data.alert_threshold_high !== undefined) {
    updates.push('alert_threshold_high = ?');
    params.push(data.alert_threshold_high !== null ? Number(data.alert_threshold_high) : null);
  }

  if (data.refresh_interval_minutes !== undefined) {
    const interval = Number(data.refresh_interval_minutes);
    if (isNaN(interval) || interval < 15) {
      const err = new Error('Minimum refresh interval is 15 minutes');
      err.status = 400;
      throw err;
    }
    updates.push('refresh_interval_minutes = ?');
    params.push(interval);
  }

  if (data.is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(Number(data.is_active) ? 1 : 0);
  }

  if (data.calculation_query !== undefined) {
    const spec = parseCalculationQuery(data.calculation_query);
    updates.push('calculation_query = ?');
    params.push(JSON.stringify(spec));
  }

  if (updates.length === 0) {
    return { success: true, kpi };
  }

  // Rule: updated_at manually updated in every service function that modifies a row
  updates.push("updated_at = datetime('now')");

  params.push(kpiId);
  execute(`UPDATE kpi_definitions SET ${updates.join(', ')} WHERE id = ?;`, params);

  // Log update to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'KPI_UPDATED', '/api/analytics/kpi/' || ?, ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(kpiId), String(kpiId)]);

  const updatedKpi = queryOne('SELECT * FROM kpi_definitions WHERE id = ?;', [kpiId]);
  return { success: true, kpi: updatedKpi };
}

/**
 * Deletes a non-seeded KPI definition (blocks seeded KPIs with 400 Bad Request)
 */
export function deleteKpiDefinition(kpiId, user) {
  requireAdmin(user);

  const kpi = queryOne('SELECT * FROM kpi_definitions WHERE id = ?;', [kpiId]);
  if (!kpi) {
    const err = new Error(`KPI definition with ID ${kpiId} not found`);
    err.status = 404;
    throw err;
  }

  // Standing Rule & MD Rule 3: Seeded KPIs cannot be deleted
  if (kpi.is_built_in === 1 || Number(kpi.id) <= 10) {
    const err = new Error('Seeded built-in KPIs cannot be deleted. You can only deactivate them via PATCH with is_active = 0.');
    err.status = 400;
    throw err;
  }

  // Check if KPI has append-only snapshots or alerts
  const hasSnapshots = queryOne('SELECT id FROM kpi_snapshots WHERE kpi_id = ? LIMIT 1;', [kpiId]);
  const hasAlerts = queryOne('SELECT id FROM kpi_alerts WHERE kpi_id = ? LIMIT 1;', [kpiId]);

  if (hasSnapshots || hasAlerts) {
    // Soft-delete to preserve referential integrity of append-only audit history
    execute("UPDATE kpi_definitions SET is_active = 0, updated_at = datetime('now') WHERE id = ?;", [kpiId]);
  } else {
    // Hard-delete when no child references exist
    execute('DELETE FROM kpi_definitions WHERE id = ?;', [kpiId]);
  }

  // Log deletion to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'KPI_DELETED', '/api/analytics/kpi/' || ?, ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(kpiId), String(kpiId)]);

  return {
    success: true,
    message: `KPI definition "${kpi.name}" deleted successfully`,
    soft_deleted: Boolean(hasSnapshots || hasAlerts)
  };
}

/**
 * Background / Cron Engine: Refreshes all active KPIs that are due for recalculation
 */
export function refreshDueKpis() {
  const activeKpis = queryAll('SELECT * FROM kpi_definitions WHERE is_active = 1;');
  let refreshedCount = 0;
  let totalAlerts = 0;
  const errors = [];

  const nowEpoch = Date.now();

  for (const kpi of activeKpis) {
    try {
      const latestSnapshot = queryOne(`
        SELECT snapshotted_at 
        FROM kpi_snapshots 
        WHERE kpi_id = ? 
        ORDER BY id DESC LIMIT 1;
      `, [kpi.id]);

      let isDue = false;
      if (!latestSnapshot) {
        isDue = true;
      } else {
        const lastSnapshotEpoch = new Date(latestSnapshot.snapshotted_at).getTime();
        const intervalMs = (kpi.refresh_interval_minutes || 60) * 60 * 1000;
        if (nowEpoch - lastSnapshotEpoch >= intervalMs) {
          isDue = true;
        }
      }

      if (isDue) {
        const res = refreshKpi(kpi.id);
        refreshedCount++;
        totalAlerts += (res.alerts_triggered || []).length;
      }
    } catch (err) {
      errors.push({ kpi_id: kpi.id, error: err.message });
    }
  }

  return {
    refreshedCount,
    totalAlerts,
    errorsCount: errors.length,
    errors
  };
}

// =============================================================================
// PRD 23 LAYER 3: DASHBOARDS & 12-COLUMN GRID WIDGET ENGINE
// =============================================================================

export const ALLOWED_DASHBOARD_SCOPES = ['PERSONAL', 'TEAM', 'COMPANY'];

export const ALLOWED_WIDGET_TYPES = [
  'NUMBER_CARD',
  'BAR_CHART',
  'LINE_CHART',
  'PIE_CHART',
  'PROGRESS_BAR',
  'TABLE',
  'HEATMAP',
  'BURNDOWN',
  'VELOCITY'
];

function requireUser(user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: Authentication required');
    err.status = 401;
    throw err;
  }
}

function sanitizeCalculationMetadataForMember(metadata) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const sanitized = { ...metadata };
  // Strictly redact raw individual member details for non-admin viewers
  delete sanitized.members;
  delete sanitized.memberResults;
  delete sanitized.individual_contributions;
  delete sanitized.member_breakdown;
  delete sanitized.user_id;
  delete sanitized.users;
  return sanitized;
}

/**
 * Creates a new dashboard (PERSONAL for any member; TEAM/COMPANY for Admin+)
 */
export function createDashboard(data, user) {
  requireUser(user);

  const { name, description, scope, is_default, layout } = data;

  if (!name || !name.trim()) {
    const err = new Error('Dashboard name is required');
    err.status = 400;
    throw err;
  }

  const resolvedScope = (scope || 'PERSONAL').toUpperCase();
  if (!ALLOWED_DASHBOARD_SCOPES.includes(resolvedScope)) {
    const err = new Error(`Invalid dashboard scope "${scope}". Allowed: ${ALLOWED_DASHBOARD_SCOPES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  // Scope rule: TEAM and COMPANY can only be created by Admin+
  if ((resolvedScope === 'TEAM' || resolvedScope === 'COMPANY') && !isAdmin) {
    const err = new Error(`Forbidden: Only Admins can create ${resolvedScope} dashboards`);
    err.status = 403;
    throw err;
  }

  // Validate layout as valid JSON if provided
  let layoutStr = null;
  if (layout !== undefined && layout !== null) {
    if (typeof layout === 'string') {
      try {
        JSON.parse(layout);
        layoutStr = layout;
      } catch (e) {
        const err = new Error('Invalid layout JSON format');
        err.status = 400;
        throw err;
      }
    } else if (typeof layout === 'object') {
      layoutStr = JSON.stringify(layout);
    }
  }

  const isDefaultInt = is_default ? 1 : 0;
  if (isDefaultInt === 1) {
    // Reset any prior default dashboard for this owner
    execute('UPDATE analytics_dashboards SET is_default = 0, updated_at = datetime(\'now\') WHERE owner_id = ?;', [user.id]);
  }

  execute(`
    INSERT INTO analytics_dashboards (
      name, description, owner_id, scope, is_default, layout, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));
  `, [
    name.trim(),
    description || null,
    user.id,
    resolvedScope,
    isDefaultInt,
    layoutStr
  ]);

  const newDashboard = queryOne('SELECT * FROM analytics_dashboards WHERE owner_id = ? ORDER BY id DESC LIMIT 1;', [user.id]);

  // Log creation to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'DASHBOARD_CREATED', '/api/analytics/dashboard/create', ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(newDashboard.id)]);

  return {
    success: true,
    dashboard: {
      ...newDashboard,
      layout: newDashboard.layout ? JSON.parse(newDashboard.layout) : null
    }
  };
}

/**
 * Returns all dashboards visible to current user:
 * - Admins: own PERSONAL + all TEAM + all COMPANY
 * - Members: own PERSONAL + all TEAM (COMPANY and other's PERSONAL strictly excluded)
 */
export function getDashboards(user) {
  requireUser(user);

  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  let sql = `
    SELECT d.*, u.name as owner_name 
    FROM analytics_dashboards d
    LEFT JOIN users u ON d.owner_id = u.id
  `;
  const params = [];

  if (isAdmin) {
    sql += ` WHERE d.scope IN ('TEAM', 'COMPANY') OR (d.scope = 'PERSONAL' AND d.owner_id = ?)`;
    params.push(user.id);
  } else {
    sql += ` WHERE d.scope = 'TEAM' OR (d.scope = 'PERSONAL' AND d.owner_id = ?)`;
    params.push(user.id);
  }

  sql += ' ORDER BY d.id ASC;';

  const rows = queryAll(sql, params).map(d => ({
    ...d,
    layout: d.layout ? JSON.parse(d.layout) : null
  }));

  return {
    success: true,
    count: rows.length,
    dashboards: rows
  };
}

/**
 * Returns single dashboard + all widgets with latest pre-computed KPI snapshots & 30-point trend
 */
export function getDashboardById(dashboardId, user) {
  requireUser(user);

  const dashboard = queryOne(`
    SELECT d.*, u.name as owner_name 
    FROM analytics_dashboards d
    LEFT JOIN users u ON d.owner_id = u.id
    WHERE d.id = ?;
  `, [dashboardId]);

  if (!dashboard) {
    const err = new Error(`Dashboard with ID ${dashboardId} not found`);
    err.status = 404;
    throw err;
  }

  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  // Strict scope checks:
  // - PERSONAL: owner or Admin only
  // - COMPANY: Admin only
  // - TEAM: all authenticated members
  if (dashboard.scope === 'PERSONAL' && dashboard.owner_id !== user.id && !isAdmin) {
    const err = new Error("Forbidden: Cannot view another user's personal dashboard");
    err.status = 403;
    throw err;
  }

  if (dashboard.scope === 'COMPANY' && !isAdmin) {
    const err = new Error('Forbidden: Only Admins can view COMPANY dashboards');
    err.status = 403;
    throw err;
  }

  // Fetch all widgets for this dashboard
  const widgetsRaw = queryAll(`
    SELECT * FROM dashboard_widgets 
    WHERE dashboard_id = ? 
    ORDER BY position_y ASC, position_x ASC;
  `, [dashboard.id]);

  const widgets = widgetsRaw.map(w => {
    let parsedConfig = null;
    if (w.config) {
      try {
        parsedConfig = JSON.parse(w.config);
      } catch (e) {
        parsedConfig = w.config;
      }
    }

    let kpiDetails = null;
    let latestSnapshot = null;
    let trendSnapshots = [];

    if (w.kpi_id) {
      kpiDetails = queryOne(`
        SELECT id, name, unit, data_source, metric_type, target_value, alert_threshold_low, alert_threshold_high
        FROM kpi_definitions
        WHERE id = ?;
      `, [w.kpi_id]);

      // Pre-computed snapshot engine: always pull latest from kpi_snapshots
      const snapRow = queryOne(`
        SELECT value, snapshotted_at, period_label, calculation_metadata 
        FROM kpi_snapshots 
        WHERE kpi_id = ? 
        ORDER BY snapshotted_at DESC, id DESC LIMIT 1;
      `, [w.kpi_id]);

      if (snapRow) {
        let meta = null;
        if (snapRow.calculation_metadata) {
          try {
            meta = JSON.parse(snapRow.calculation_metadata);
          } catch (e) {
            meta = snapRow.calculation_metadata;
          }
        }

        // Privacy rule: Raw individual member contribution data must NEVER be returned to non-admin roles
        if (!isAdmin) {
          meta = sanitizeCalculationMetadataForMember(meta);
        }

        latestSnapshot = {
          value: snapRow.value,
          snapshotted_at: snapRow.snapshotted_at,
          period_label: snapRow.period_label,
          calculation_metadata: meta
        };
      }

      // Last 30 snapshots for sparkline trend (ORDER BY snapshotted_at DESC LIMIT 30)
      const rawTrend = queryAll(`
        SELECT id, value, snapshotted_at, period_label 
        FROM kpi_snapshots 
        WHERE kpi_id = ? 
        ORDER BY snapshotted_at DESC, id DESC LIMIT 30;
      `, [w.kpi_id]);

      trendSnapshots = rawTrend.reverse();
    }

    return {
      id: w.id,
      dashboard_id: w.dashboard_id,
      kpi_id: w.kpi_id,
      widget_type: w.widget_type,
      title: w.title,
      config: parsedConfig,
      position_x: w.position_x,
      position_y: w.position_y,
      width: w.width,
      height: w.height,
      created_at: w.created_at,
      updated_at: w.updated_at,
      kpi: kpiDetails,
      latest_snapshot: latestSnapshot,
      trend_snapshots: trendSnapshots
    };
  });

  return {
    success: true,
    dashboard: {
      ...dashboard,
      layout: dashboard.layout ? JSON.parse(dashboard.layout) : null
    },
    widgets
  };
}

/**
 * Updates an existing dashboard (Owner or Admin+)
 */
export function updateDashboard(dashboardId, data, user) {
  requireUser(user);

  const dashboard = queryOne('SELECT * FROM analytics_dashboards WHERE id = ?;', [dashboardId]);
  if (!dashboard) {
    const err = new Error(`Dashboard with ID ${dashboardId} not found`);
    err.status = 404;
    throw err;
  }

  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  // Permissions: owner or Admin only
  if (dashboard.scope === 'PERSONAL' && dashboard.owner_id !== user.id && !isAdmin) {
    const err = new Error("Forbidden: Cannot edit another user's personal dashboard");
    err.status = 403;
    throw err;
  }

  if ((dashboard.scope === 'TEAM' || dashboard.scope === 'COMPANY') && !isAdmin) {
    const err = new Error(`Forbidden: Only Admins can edit ${dashboard.scope} dashboards`);
    err.status = 403;
    throw err;
  }

  const updates = [];
  const params = [];

  if (data.name !== undefined) {
    if (!data.name || !data.name.trim()) {
      const err = new Error('Dashboard name cannot be empty');
      err.status = 400;
      throw err;
    }
    updates.push('name = ?');
    params.push(data.name.trim());
  }

  if (data.description !== undefined) {
    updates.push('description = ?');
    params.push(data.description);
  }

  if (data.layout !== undefined) {
    let layoutStr = null;
    if (data.layout !== null) {
      if (typeof data.layout === 'string') {
        try {
          JSON.parse(data.layout);
          layoutStr = data.layout;
        } catch (e) {
          const err = new Error('Invalid layout JSON format');
          err.status = 400;
          throw err;
        }
      } else if (typeof data.layout === 'object') {
        layoutStr = JSON.stringify(data.layout);
      }
    }
    updates.push('layout = ?');
    params.push(layoutStr);
  }

  if (data.is_default !== undefined) {
    const isDef = data.is_default ? 1 : 0;
    if (isDef === 1) {
      execute('UPDATE analytics_dashboards SET is_default = 0, updated_at = datetime(\'now\') WHERE owner_id = ?;', [dashboard.owner_id]);
    }
    updates.push('is_default = ?');
    params.push(isDef);
  }

  if (updates.length === 0) {
    return {
      success: true,
      dashboard: {
        ...dashboard,
        layout: dashboard.layout ? JSON.parse(dashboard.layout) : null
      }
    };
  }

  // Rule: updated_at manually updated in every service function that modifies a row
  updates.push("updated_at = datetime('now')");
  params.push(dashboardId);

  execute(`UPDATE analytics_dashboards SET ${updates.join(', ')} WHERE id = ?;`, params);

  // Log update to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'DASHBOARD_UPDATED', '/api/analytics/dashboard/' || ?, ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(dashboardId), String(dashboardId)]);

  const updatedDashboard = queryOne('SELECT * FROM analytics_dashboards WHERE id = ?;', [dashboardId]);

  return {
    success: true,
    dashboard: {
      ...updatedDashboard,
      layout: updatedDashboard.layout ? JSON.parse(updatedDashboard.layout) : null
    }
  };
}

/**
 * Deletes a dashboard (Owner or Admin+; blocks deleting sole COMPANY dashboard)
 */
export function deleteDashboard(dashboardId, user) {
  requireUser(user);

  const dashboard = queryOne('SELECT * FROM analytics_dashboards WHERE id = ?;', [dashboardId]);
  if (!dashboard) {
    const err = new Error(`Dashboard with ID ${dashboardId} not found`);
    err.status = 404;
    throw err;
  }

  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  if (dashboard.scope === 'PERSONAL' && dashboard.owner_id !== user.id && !isAdmin) {
    const err = new Error("Forbidden: Cannot delete another user's personal dashboard");
    err.status = 403;
    throw err;
  }

  if ((dashboard.scope === 'TEAM' || dashboard.scope === 'COMPANY') && !isAdmin) {
    const err = new Error(`Forbidden: Only Admins can delete ${dashboard.scope} dashboards`);
    err.status = 403;
    throw err;
  }

  // MD Rule: Cannot delete COMPANY scope dashboard if it is the only one
  if (dashboard.scope === 'COMPANY') {
    const compCountRow = queryOne("SELECT COUNT(*) as count FROM analytics_dashboards WHERE scope = 'COMPANY';");
    const count = compCountRow ? compCountRow.count : 0;
    if (count <= 1) {
      const err = new Error('Cannot delete COMPANY scope dashboard as it is the only company dashboard');
      err.status = 400;
      throw err;
    }
  }

  // Delete attached widgets first
  execute('DELETE FROM dashboard_widgets WHERE dashboard_id = ?;', [dashboardId]);

  // Delete dashboard
  execute('DELETE FROM analytics_dashboards WHERE id = ?;', [dashboardId]);

  // Log deletion to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'DASHBOARD_DELETED', '/api/analytics/dashboard/' || ?, ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(dashboardId), String(dashboardId)]);

  return {
    success: true,
    message: `Dashboard "${dashboard.name}" deleted successfully`
  };
}

/**
 * Creates a widget on a 12-column grid inside a dashboard
 */
export function createWidget(data, user) {
  requireUser(user);

  const { dashboard_id, kpi_id, widget_type, title, config, position_x, position_y, width, height } = data;

  if (!dashboard_id) {
    const err = new Error('dashboard_id is required');
    err.status = 400;
    throw err;
  }

  const dashboard = queryOne('SELECT * FROM analytics_dashboards WHERE id = ?;', [dashboard_id]);
  if (!dashboard) {
    const err = new Error(`Dashboard with ID ${dashboard_id} not found`);
    err.status = 404;
    throw err;
  }

  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  // Permission on parent dashboard
  if (dashboard.scope === 'PERSONAL' && dashboard.owner_id !== user.id && !isAdmin) {
    const err = new Error("Forbidden: Cannot add widgets to another user's personal dashboard");
    err.status = 403;
    throw err;
  }

  if ((dashboard.scope === 'TEAM' || dashboard.scope === 'COMPANY') && !isAdmin) {
    const err = new Error(`Forbidden: Only Admins can add widgets to ${dashboard.scope} dashboards`);
    err.status = 403;
    throw err;
  }

  if (!title || !title.trim()) {
    const err = new Error('Widget title is required');
    err.status = 400;
    throw err;
  }

  const resolvedType = (widget_type || '').toUpperCase();
  if (!ALLOWED_WIDGET_TYPES.includes(resolvedType)) {
    const err = new Error(`Invalid widget_type "${widget_type}". Allowed: ${ALLOWED_WIDGET_TYPES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  // 12-Column Grid Validation
  const posX = position_x !== undefined ? Number(position_x) : 0;
  const posY = position_y !== undefined ? Number(position_y) : 0;
  const wWidth = width !== undefined ? Number(width) : 2;
  const wHeight = height !== undefined ? Number(height) : 2;

  if (isNaN(posX) || posX < 0) {
    const err = new Error('position_x must be an integer >= 0');
    err.status = 400;
    throw err;
  }
  if (isNaN(posY) || posY < 0) {
    const err = new Error('position_y must be an integer >= 0');
    err.status = 400;
    throw err;
  }
  if (isNaN(wWidth) || wWidth < 1 || wWidth > 12) {
    const err = new Error('width must be between 1 and 12 columns');
    err.status = 400;
    throw err;
  }
  if (isNaN(wHeight) || wHeight < 1) {
    const err = new Error('height must be >= 1');
    err.status = 400;
    throw err;
  }

  // Strict 12-column grid rule: position_x + width <= 12
  if (posX + wWidth > 12) {
    const err = new Error(`Widget grid error: position_x + width (${posX} + ${wWidth} = ${posX + wWidth}) cannot exceed 12 columns`);
    err.status = 400;
    throw err;
  }

  // FK validation for kpi_id if supplied
  let resolvedKpiId = null;
  if (kpi_id !== undefined && kpi_id !== null && kpi_id !== '') {
    resolvedKpiId = Number(kpi_id);
    const kpi = queryOne('SELECT id FROM kpi_definitions WHERE id = ?;', [resolvedKpiId]);
    if (!kpi) {
      const err = new Error(`Referenced KPI with ID ${resolvedKpiId} does not exist`);
      err.status = 404;
      throw err;
    }
  }

  let configStr = null;
  if (config !== undefined && config !== null) {
    if (typeof config === 'string') {
      try {
        JSON.parse(config);
        configStr = config;
      } catch (e) {
        const err = new Error('Invalid widget config JSON format');
        err.status = 400;
        throw err;
      }
    } else if (typeof config === 'object') {
      configStr = JSON.stringify(config);
    }
  }

  execute(`
    INSERT INTO dashboard_widgets (
      dashboard_id, kpi_id, widget_type, title, config, position_x, position_y, width, height, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));
  `, [
    dashboard.id,
    resolvedKpiId,
    resolvedType,
    title.trim(),
    configStr,
    posX,
    posY,
    wWidth,
    wHeight
  ]);

  const newWidget = queryOne('SELECT * FROM dashboard_widgets WHERE dashboard_id = ? ORDER BY id DESC LIMIT 1;', [dashboard.id]);

  // Maintain updated_at on parent dashboard
  execute("UPDATE analytics_dashboards SET updated_at = datetime('now') WHERE id = ?;", [dashboard.id]);

  // Log creation to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'WIDGET_CREATED', '/api/analytics/widget/create', ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(newWidget.id)]);

  return {
    success: true,
    widget: {
      ...newWidget,
      config: newWidget.config ? JSON.parse(newWidget.config) : null
    }
  };
}

/**
 * Updates a widget on a dashboard (Owner or Admin+)
 */
export function updateWidget(widgetId, data, user) {
  requireUser(user);

  const widget = queryOne('SELECT * FROM dashboard_widgets WHERE id = ?;', [widgetId]);
  if (!widget) {
    const err = new Error(`Widget with ID ${widgetId} not found`);
    err.status = 404;
    throw err;
  }

  const dashboard = queryOne('SELECT * FROM analytics_dashboards WHERE id = ?;', [widget.dashboard_id]);
  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  if (dashboard && dashboard.scope === 'PERSONAL' && dashboard.owner_id !== user.id && !isAdmin) {
    const err = new Error("Forbidden: Cannot modify widgets on another user's personal dashboard");
    err.status = 403;
    throw err;
  }

  if (dashboard && (dashboard.scope === 'TEAM' || dashboard.scope === 'COMPANY') && !isAdmin) {
    const err = new Error(`Forbidden: Only Admins can modify widgets on ${dashboard.scope} dashboards`);
    err.status = 403;
    throw err;
  }

  const updates = [];
  const params = [];

  if (data.title !== undefined) {
    if (!data.title || !data.title.trim()) {
      const err = new Error('Widget title cannot be empty');
      err.status = 400;
      throw err;
    }
    updates.push('title = ?');
    params.push(data.title.trim());
  }

  if (data.widget_type !== undefined) {
    const resolvedType = data.widget_type.toUpperCase();
    if (!ALLOWED_WIDGET_TYPES.includes(resolvedType)) {
      const err = new Error(`Invalid widget_type "${data.widget_type}". Allowed: ${ALLOWED_WIDGET_TYPES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    updates.push('widget_type = ?');
    params.push(resolvedType);
  }

  if (data.kpi_id !== undefined) {
    if (data.kpi_id === null || data.kpi_id === '') {
      updates.push('kpi_id = NULL');
    } else {
      const kId = Number(data.kpi_id);
      const kpi = queryOne('SELECT id FROM kpi_definitions WHERE id = ?;', [kId]);
      if (!kpi) {
        const err = new Error(`Referenced KPI with ID ${kId} does not exist`);
        err.status = 404;
        throw err;
      }
      updates.push('kpi_id = ?');
      params.push(kId);
    }
  }

  if (data.config !== undefined) {
    let configStr = null;
    if (data.config !== null) {
      if (typeof data.config === 'string') {
        try {
          JSON.parse(data.config);
          configStr = data.config;
        } catch (e) {
          const err = new Error('Invalid widget config JSON format');
          err.status = 400;
          throw err;
        }
      } else if (typeof data.config === 'object') {
        configStr = JSON.stringify(data.config);
      }
    }
    updates.push('config = ?');
    params.push(configStr);
  }

  // 12-Column Grid Updates
  const posX = data.position_x !== undefined ? Number(data.position_x) : widget.position_x;
  const posY = data.position_y !== undefined ? Number(data.position_y) : widget.position_y;
  const wWidth = data.width !== undefined ? Number(data.width) : widget.width;
  const wHeight = data.height !== undefined ? Number(data.height) : widget.height;

  if (data.position_x !== undefined || data.width !== undefined) {
    if (posX < 0 || isNaN(posX)) {
      const err = new Error('position_x must be an integer >= 0');
      err.status = 400;
      throw err;
    }
    if (wWidth < 1 || wWidth > 12 || isNaN(wWidth)) {
      const err = new Error('width must be between 1 and 12 columns');
      err.status = 400;
      throw err;
    }
    if (posX + wWidth > 12) {
      const err = new Error(`Widget grid error: position_x + width (${posX} + ${wWidth} = ${posX + wWidth}) cannot exceed 12 columns`);
      err.status = 400;
      throw err;
    }
  }

  if (data.position_x !== undefined) {
    updates.push('position_x = ?');
    params.push(posX);
  }
  if (data.position_y !== undefined) {
    updates.push('position_y = ?');
    params.push(posY);
  }
  if (data.width !== undefined) {
    updates.push('width = ?');
    params.push(wWidth);
  }
  if (data.height !== undefined) {
    updates.push('height = ?');
    params.push(wHeight);
  }

  if (updates.length === 0) {
    return {
      success: true,
      widget: {
        ...widget,
        config: widget.config ? JSON.parse(widget.config) : null
      }
    };
  }

  // Rule: updated_at manually updated in every service function that modifies a row
  updates.push("updated_at = datetime('now')");
  params.push(widgetId);

  execute(`UPDATE dashboard_widgets SET ${updates.join(', ')} WHERE id = ?;`, params);

  // Maintain updated_at on parent dashboard
  if (dashboard) {
    execute("UPDATE analytics_dashboards SET updated_at = datetime('now') WHERE id = ?;", [dashboard.id]);
  }

  // Log update to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'WIDGET_UPDATED', '/api/analytics/widget/' || ?, ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(widgetId), String(widgetId)]);

  const updatedWidget = queryOne('SELECT * FROM dashboard_widgets WHERE id = ?;', [widgetId]);

  return {
    success: true,
    widget: {
      ...updatedWidget,
      config: updatedWidget.config ? JSON.parse(updatedWidget.config) : null
    }
  };
}

/**
 * Deletes a widget from a dashboard (Owner or Admin+)
 */
export function deleteWidget(widgetId, user) {
  requireUser(user);

  const widget = queryOne('SELECT * FROM dashboard_widgets WHERE id = ?;', [widgetId]);
  if (!widget) {
    const err = new Error(`Widget with ID ${widgetId} not found`);
    err.status = 404;
    throw err;
  }

  const dashboard = queryOne('SELECT * FROM analytics_dashboards WHERE id = ?;', [widget.dashboard_id]);
  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  if (dashboard && dashboard.scope === 'PERSONAL' && dashboard.owner_id !== user.id && !isAdmin) {
    const err = new Error("Forbidden: Cannot delete widgets on another user's personal dashboard");
    err.status = 403;
    throw err;
  }

  if (dashboard && (dashboard.scope === 'TEAM' || dashboard.scope === 'COMPANY') && !isAdmin) {
    const err = new Error(`Forbidden: Only Admins can delete widgets on ${dashboard.scope} dashboards`);
    err.status = 403;
    throw err;
  }

  execute('DELETE FROM dashboard_widgets WHERE id = ?;', [widgetId]);

  // Maintain updated_at on parent dashboard
  if (dashboard) {
    execute("UPDATE analytics_dashboards SET updated_at = datetime('now') WHERE id = ?;", [dashboard.id]);
  }

  // Log deletion to access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'WIDGET_DELETED', '/api/analytics/widget/' || ?, ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(widgetId), String(widgetId)]);

  return {
    success: true,
    message: `Widget "${widget.title}" deleted successfully`
  };
}

// =============================================================================
// Layer 4: Alerts, Reports, Export Engine & Snapshot History
// =============================================================================

function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Returns KPI alerts
 * - Admins see all alerts
 * - Members see alerts for KPIs on their accessible dashboards (PERSONAL + TEAM)
 */
export function getKpiAlerts(query = {}, user) {
  requireUser(user);

  const role = String(user.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  let sql = `
    SELECT a.*, k.name as kpi_name, k.data_source, k.unit, u.name as acknowledged_by_name
    FROM kpi_alerts a
    JOIN kpi_definitions k ON a.kpi_id = k.id
    LEFT JOIN users u ON a.acknowledged_by = u.id
  `;
  const params = [];
  const whereClauses = [];

  if (!isAdmin) {
    whereClauses.push(`
      a.kpi_id IN (
        SELECT w.kpi_id 
        FROM dashboard_widgets w
        JOIN analytics_dashboards d ON w.dashboard_id = d.id
        WHERE w.kpi_id IS NOT NULL 
          AND (d.scope = 'TEAM' OR (d.scope = 'PERSONAL' AND d.owner_id = ?))
      )
    `);
    params.push(user.id);
  }

  const status = (query.status || 'all').toLowerCase();
  if (status === 'unacknowledged') {
    whereClauses.push('a.acknowledged_at IS NULL');
  } else if (status === 'acknowledged') {
    whereClauses.push('a.acknowledged_at IS NOT NULL');
  }

  if (whereClauses.length > 0) {
    sql += ' WHERE ' + whereClauses.join(' AND ');
  }

  sql += ' ORDER BY a.id DESC;';

  const rows = queryAll(sql, params);
  return {
    success: true,
    count: rows.length,
    alerts: rows
  };
}

/**
 * Acknowledges a KPI alert (Admin only)
 */
export function acknowledgeKpiAlert(alertId, user) {
  requireAdmin(user);

  const alert = queryOne('SELECT * FROM kpi_alerts WHERE id = ?;', [alertId]);
  if (!alert) {
    const err = new Error(`KPI alert with ID ${alertId} not found`);
    err.status = 404;
    throw err;
  }

  if (alert.acknowledged_at) {
    const err = new Error('Alert has already been acknowledged');
    err.status = 400;
    throw err;
  }

  // Update acknowledgment fields (only ack fields permitted by Layer 1 triggers)
  execute(`
    UPDATE kpi_alerts 
    SET acknowledged_by = ?, acknowledged_at = datetime('now')
    WHERE id = ?;
  `, [user.id, alertId]);

  // Record audit log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'KPI_ALERT_ACKNOWLEDGED', '/api/analytics/alert/' || ?, ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(alertId), String(alertId)]);

  const updatedAlert = queryOne(`
    SELECT a.*, k.name as kpi_name, u.name as acknowledged_by_name
    FROM kpi_alerts a
    JOIN kpi_definitions k ON a.kpi_id = k.id
    LEFT JOIN users u ON a.acknowledged_by = u.id
    WHERE a.id = ?;
  `, [alertId]);

  return {
    success: true,
    message: 'KPI alert acknowledged successfully',
    alert: updatedAlert
  };
}

/**
 * Returns paginated snapshots history for a KPI (Admin only)
 */
export function getKpiSnapshots(kpiId, query = {}, user) {
  requireAdmin(user);

  const kpi = queryOne('SELECT * FROM kpi_definitions WHERE id = ?;', [kpiId]);
  if (!kpi) {
    const err = new Error(`KPI definition with ID ${kpiId} not found`);
    err.status = 404;
    throw err;
  }

  const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const totalRow = queryOne('SELECT COUNT(*) as count FROM kpi_snapshots WHERE kpi_id = ?;', [kpiId]);
  const total = totalRow ? totalRow.count : 0;

  const rows = queryAll(`
    SELECT id, kpi_id, value, period_label, snapshotted_at, calculation_metadata
    FROM kpi_snapshots
    WHERE kpi_id = ?
    ORDER BY snapshotted_at DESC, id DESC
    LIMIT ? OFFSET ?;
  `, [kpiId, limit, offset]).map(s => {
    let meta = null;
    if (s.calculation_metadata) {
      try {
        meta = JSON.parse(s.calculation_metadata);
      } catch (e) {
        meta = s.calculation_metadata;
      }
    }
    return {
      ...s,
      calculation_metadata: meta
    };
  });

  return {
    success: true,
    kpi_id: Number(kpiId),
    kpi_name: kpi.name,
    total_count: total,
    limit,
    offset,
    snapshots: rows
  };
}

/**
 * Sprint Analytics Report (Admin only)
 */
export function getSprintAnalyticsReport(projectId, user) {
  requireAdmin(user);

  const sprintParams = [];
  let sprintWhere = '';
  if (projectId && projectId !== 'all') {
    sprintWhere = 'WHERE project_id = ?';
    sprintParams.push(String(projectId));
  }

  const sprintRows = queryAll(`
    SELECT id, name, start_date, end_date, status, project_id
    FROM sprints
    ${sprintWhere}
    ORDER BY start_date DESC, id DESC
    LIMIT 10;
  `, sprintParams);

  // Velocity Trend: last completed or logged sprints
  const velocityRows = queryAll(`
    SELECT sprint_id, total_points_completed, logged_at
    FROM sprint_velocity_log
    ORDER BY logged_at DESC, id DESC
    LIMIT 10;
  `);

  // Active / Latest Sprint Details
  let activeSprint = sprintRows.find(s => s.status === 'ACTIVE') || sprintRows[0] || null;

  let sprintComparison = [];
  let totalCommitted = 0;
  let totalCompleted = 0;

  for (const s of sprintRows) {
    const sId = s.id;
    const stats = queryOne(`
      SELECT 
        COALESCE(SUM(story_points), 0) as committed,
        COALESCE(SUM(CASE WHEN status = 'DONE' THEN story_points ELSE 0 END), 0) as completed
      FROM backlog_items
      WHERE sprint_id = ?;
    `, [sId]);

    const committed = stats ? Number(stats.committed || 0) : 0;
    const completed = stats ? Number(stats.completed || 0) : 0;
    const rate = committed > 0 ? Math.round((completed / committed) * 10000) / 100 : 0.0;

    totalCommitted += committed;
    totalCompleted += completed;

    sprintComparison.push({
      sprint_id: sId,
      sprint_name: s.name || `Sprint ${sId}`,
      start_date: s.start_date,
      end_date: s.end_date,
      status: s.status,
      committed_points: committed,
      completed_points: completed,
      completion_rate_pct: rate
    });
  }

  // Backlog Health Breakdown
  const backlogStats = queryAll(`
    SELECT 
      COALESCE(type, 'STORY') as item_type,
      COALESCE(priority, 'MEDIUM') as priority,
      COUNT(*) as count,
      COALESCE(SUM(story_points), 0) as total_points
    FROM backlog_items
    GROUP BY type, priority;
  `);

  // Burndown Data for active sprint
  let burndown = [];
  if (activeSprint) {
    const remainingItems = queryAll(`
      SELECT id, title, story_points, status
      FROM backlog_items
      WHERE sprint_id = ? AND status != 'DONE';
    `, [activeSprint.id]);

    const remainingPoints = remainingItems.reduce((acc, it) => acc + Number(it.story_points || 0), 0);
    burndown.push({
      date: new Date().toISOString().split('T')[0],
      remaining_points: remainingPoints,
      items_remaining: remainingItems.length
    });
  }

  const avgVelocityRow = queryOne('SELECT COALESCE(AVG(total_points_completed), 0.0) as val FROM sprint_velocity_log;');
  const avgVelocity = avgVelocityRow ? Math.round(Number(avgVelocityRow.val || 0) * 100) / 100 : 0.0;
  const overallRate = totalCommitted > 0 ? Math.round((totalCompleted / totalCommitted) * 10000) / 100 : 0.0;

  return {
    success: true,
    project_id: projectId || 'all',
    summary: {
      total_sprints: sprintRows.length,
      average_velocity: avgVelocity,
      total_committed_points: totalCommitted,
      total_completed_points: totalCompleted,
      overall_completion_rate: overallRate
    },
    active_sprint: activeSprint ? {
      id: activeSprint.id,
      name: activeSprint.name,
      status: activeSprint.status
    } : null,
    sprint_comparison: sprintComparison,
    velocity_trend: velocityRows,
    backlog_health: backlogStats,
    burndown
  };
}

/**
 * OKR Progress Report (Admin only)
 */
export function getOkrProgressReport(user) {
  requireAdmin(user);

  const companyRow = queryOne(`
    SELECT COALESCE(AVG(progress_pct), 0.0) as val, COUNT(*) as count
    FROM okr_objectives
    WHERE level = 'COMPANY' AND status = 'ACTIVE';
  `);
  const teamRow = queryOne(`
    SELECT COALESCE(AVG(progress_pct), 0.0) as val, COUNT(*) as count
    FROM okr_objectives
    WHERE level = 'TEAM' AND status = 'ACTIVE';
  `);
  const indivRow = queryOne(`
    SELECT COALESCE(AVG(progress_pct), 0.0) as val, COUNT(*) as count
    FROM okr_objectives
    WHERE level = 'INDIVIDUAL' AND status = 'ACTIVE';
  `);

  const krStats = queryOne(`
    SELECT 
      COUNT(*) as total_kr,
      COALESCE(SUM(CASE WHEN current_value >= target_value OR progress_pct >= 100 THEN 1 ELSE 0 END), 0) as completed_kr
    FROM okr_key_results;
  `);

  const objectivesList = queryAll(`
    SELECT o.id, o.title, o.level, o.progress_pct, o.status, o.owner_id, u.name as owner_name
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    ORDER BY o.level ASC, o.progress_pct DESC;
  `);

  return {
    success: true,
    summary: {
      company_progress_pct: companyRow ? Math.round(Number(companyRow.val || 0) * 100) / 100 : 0.0,
      active_company_objectives: companyRow ? companyRow.count : 0,
      team_progress_pct: teamRow ? Math.round(Number(teamRow.val || 0) * 100) / 100 : 0.0,
      active_team_objectives: teamRow ? teamRow.count : 0,
      individual_progress_pct: indivRow ? Math.round(Number(indivRow.val || 0) * 100) / 100 : 0.0,
      active_individual_objectives: indivRow ? indivRow.count : 0,
      total_key_results: krStats ? krStats.total_kr : 0,
      completed_key_results: krStats ? krStats.completed_kr : 0
    },
    objectives: objectivesList
  };
}

/**
 * Time Analytics Report (Admin only)
 */
export function getTimeAnalyticsReport(filters = {}, user) {
  requireAdmin(user);

  const whereConditions = ["te.status != 'DELETED'"];
  const params = [];

  if (filters.project_id && filters.project_id !== 'all') {
    whereConditions.push('te.project_id = ?');
    params.push(String(filters.project_id));
  }
  if (filters.user_id) {
    whereConditions.push('te.user_id = ?');
    params.push(filters.user_id);
  }
  if (filters.from) {
    whereConditions.push('date(te.start_time) >= date(?)');
    params.push(filters.from.includes('T') ? filters.from.split('T')[0] : filters.from);
  }
  if (filters.to) {
    whereConditions.push('date(te.start_time) <= date(?)');
    params.push(filters.to.includes('T') ? filters.to.split('T')[0] : filters.to);
  }

  const whereClause = whereConditions.join(' AND ');

  const summaryRow = queryOne(`
    SELECT 
      COALESCE(SUM(te.duration_minutes), 0) as total_min,
      COALESCE(SUM(CASE WHEN te.is_billable = 1 AND te.status = 'APPROVED' THEN te.duration_minutes ELSE 0 END), 0) as billable_min,
      COALESCE(SUM(CASE WHEN te.is_billable = 0 OR te.is_billable IS NULL OR te.status != 'APPROVED' THEN te.duration_minutes ELSE 0 END), 0) as non_billable_min,
      COALESCE(SUM(CASE WHEN te.status = 'APPROVED' THEN te.billable_amount ELSE 0.0 END), 0.0) as total_billable_amt,
      COUNT(*) as total_entries
    FROM time_entries te
    WHERE ${whereClause};
  `, params);

  const totalMin = summaryRow ? Number(summaryRow.total_min || 0) : 0;
  const billableMin = summaryRow ? Number(summaryRow.billable_min || 0) : 0;
  const nonBillableMin = summaryRow ? Number(summaryRow.non_billable_min || 0) : 0;
  const billableAmt = summaryRow ? Math.round(Number(summaryRow.total_billable_amt || 0) * 100) / 100 : 0.0;

  // Breakdown per member
  const memberRows = queryAll(`
    SELECT 
      te.user_id,
      u.name as member_name,
      u.email as member_email,
      ROUND(SUM(te.duration_minutes) / 60.0, 2) as total_hours,
      ROUND(SUM(CASE WHEN te.is_billable = 1 AND te.status = 'APPROVED' THEN te.duration_minutes ELSE 0 END) / 60.0, 2) as billable_hours,
      ROUND(SUM(CASE WHEN te.is_billable = 0 OR te.is_billable IS NULL OR te.status != 'APPROVED' THEN te.duration_minutes ELSE 0 END) / 60.0, 2) as non_billable_hours,
      ROUND(SUM(CASE WHEN te.status = 'APPROVED' THEN te.billable_amount ELSE 0.0 END), 2) as billable_amount,
      COUNT(*) as entries_count
    FROM time_entries te
    LEFT JOIN users u ON te.user_id = u.id
    WHERE ${whereClause}
    GROUP BY te.user_id
    ORDER BY total_hours DESC;
  `, params);

  // Breakdown per project
  const projectRows = queryAll(`
    SELECT 
      te.project_id,
      COALESCE(p.title, 'General Workspace') as project_title,
      ROUND(SUM(te.duration_minutes) / 60.0, 2) as total_hours,
      ROUND(SUM(CASE WHEN te.is_billable = 1 AND te.status = 'APPROVED' THEN te.duration_minutes ELSE 0 END) / 60.0, 2) as billable_hours,
      ROUND(SUM(CASE WHEN te.status = 'APPROVED' THEN te.billable_amount ELSE 0.0 END), 2) as billable_amount,
      COUNT(*) as entries_count
    FROM time_entries te
    LEFT JOIN projects p ON te.project_id = p.id
    WHERE ${whereClause}
    GROUP BY te.project_id
    ORDER BY total_hours DESC;
  `, params);

  return {
    success: true,
    filters,
    summary: {
      total_hours: Math.round((totalMin / 60.0) * 100) / 100,
      billable_hours: Math.round((billableMin / 60.0) * 100) / 100,
      non_billable_hours: Math.round((nonBillableMin / 60.0) * 100) / 100,
      billable_amount: billableAmt,
      total_entries: summaryRow ? summaryRow.total_entries : 0
    },
    members: memberRows,
    projects: projectRows
  };
}

/**
 * Workload Analytics Report (Admin only)
 */
export function getWorkloadAnalyticsReport(user) {
  requireAdmin(user);

  let teamWorkload = null;
  try {
    teamWorkload = workloadService.getTeamWorkload(null);
  } catch (e) {
    // Fallback if needed
  }

  const activeMembers = queryAll(`
    SELECT id, name, email, role, sub_role
    FROM users
    WHERE status = 'active'
    ORDER BY name ASC;
  `);

  const membersList = [];
  let overloaded = 0;
  let balanced = 0;
  let underloaded = 0;
  let totalUtil = 0;

  for (const m of activeMembers) {
    let util = 0.0;
    let cap = 40.0;
    let assigned = 0.0;

    if (teamWorkload && Array.isArray(teamWorkload.members)) {
      const match = teamWorkload.members.find(w => String(w.user_id) === String(m.id) || String(w.id) === String(m.id));
      if (match) {
        util = Number(match.utilization_pct || 0);
        cap = Number(match.capacity_hours || 40);
        assigned = Number(match.assigned_hours || 0);
      }
    } else {
      const alertRow = queryOne('SELECT utilization_pct FROM workload_alerts WHERE user_id = ? ORDER BY id DESC LIMIT 1;', [m.id]);
      if (alertRow) {
        util = Number(alertRow.utilization_pct || 0);
      }
    }

    let status = 'BALANCED';
    if (util > 100) {
      status = 'OVERLOADED';
      overloaded++;
    } else if (util >= 70) {
      status = 'BALANCED';
      balanced++;
    } else {
      status = 'UNDERLOADED';
      underloaded++;
    }

    totalUtil += util;
    membersList.push({
      member_id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      utilization_pct: util,
      capacity_hours: cap,
      assigned_hours: assigned,
      status
    });
  }

  const avgUtil = activeMembers.length > 0 ? Math.round((totalUtil / activeMembers.length) * 100) / 100 : 0.0;

  return {
    success: true,
    summary: {
      total_active_members: activeMembers.length,
      average_utilization: avgUtil,
      overloaded_count: overloaded,
      balanced_count: balanced,
      underloaded_count: underloaded
    },
    members: membersList
  };
}

/**
 * Company KPI Summary Cards (All 10 built-in KPIs) (Admin only)
 */
export function getCompanyKpiSummary(user) {
  requireAdmin(user);

  const kpis = queryAll(`
    SELECT * FROM kpi_definitions
    WHERE is_built_in = 1 OR id <= 10
    ORDER BY id ASC;
  `);

  const cards = kpis.map(k => {
    // 2 latest snapshots for trend arrow
    const snaps = queryAll(`
      SELECT value, period_label, snapshotted_at
      FROM kpi_snapshots
      WHERE kpi_id = ?
      ORDER BY snapshotted_at DESC, id DESC
      LIMIT 2;
    `, [k.id]);

    const latest = snaps[0] || null;
    const prev = snaps[1] || null;

    let trendArrow = 'NONE';
    if (latest && prev) {
      if (latest.value > prev.value) trendArrow = 'UP';
      else if (latest.value < prev.value) trendArrow = 'DOWN';
      else trendArrow = 'FLAT';
    }

    let status = 'NORMAL';
    if (latest) {
      if (k.alert_threshold_low !== null && latest.value < k.alert_threshold_low) {
        status = 'BELOW_THRESHOLD';
      } else if (k.alert_threshold_high !== null && latest.value > k.alert_threshold_high) {
        status = 'ABOVE_THRESHOLD';
      } else if (k.target_value !== null && latest.value >= k.target_value) {
        status = 'TARGET_REACHED';
      }
    }

    return {
      id: k.id,
      name: k.name,
      description: k.description,
      data_source: k.data_source,
      metric_type: k.metric_type,
      unit: k.unit,
      target_value: k.target_value,
      alert_threshold_low: k.alert_threshold_low,
      alert_threshold_high: k.alert_threshold_high,
      refresh_interval_minutes: k.refresh_interval_minutes,
      is_active: k.is_active,
      current_value: latest ? latest.value : null,
      previous_value: prev ? prev.value : null,
      trend_arrow: trendArrow,
      status,
      snapshotted_at: latest ? latest.snapshotted_at : null
    };
  });

  return {
    success: true,
    count: cards.length,
    kpis: cards,
    generated_at: new Date().toISOString()
  };
}

/**
 * Report Export Engine (Admin only)
 * Inserts row into analytics_report_exports (append-only)
 * Logs to access_log (ANALYTICS_REPORT_EXPORT)
 * Dual-mode CSV / JSON
 */
export function exportAnalyticsReport(data = {}, query = {}, user) {
  requireAdmin(user);

  const reportType = (data.report_type || query.report_type || 'KPI_SUMMARY').toUpperCase();
  const rawFormat = (data.export_format || query.format || 'JSON').toUpperCase();
  const format = rawFormat === 'CSV' ? 'CSV' : 'JSON';
  const projectId = data.project_id || query.project_id || null;
  const filters = data.filters || query.filters || (projectId ? { project_id: projectId } : {});

  let rows = [];
  let headers = [];

  switch (reportType) {
    case 'KPI_SUMMARY': {
      const summary = getCompanyKpiSummary(user);
      headers = ['KPI ID', 'Name', 'Data Source', 'Metric Type', 'Unit', 'Target', 'Current Value', 'Trend', 'Status', 'Snapshotted At'];
      rows = summary.kpis.map(k => [
        k.id,
        k.name,
        k.data_source,
        k.metric_type,
        k.unit,
        k.target_value,
        k.current_value,
        k.trend_arrow,
        k.status,
        k.snapshotted_at
      ]);
      break;
    }

    case 'TIME_SUMMARY': {
      const timeData = getTimeAnalyticsReport(filters, user);
      headers = ['Member ID', 'Member Name', 'Member Email', 'Total Hours', 'Billable Hours', 'Non-Billable Hours', 'Billable Amount', 'Entries Count'];
      rows = timeData.members.map(m => [
        m.user_id,
        m.member_name,
        m.member_email,
        m.total_hours,
        m.billable_hours,
        m.non_billable_hours,
        m.billable_amount,
        m.entries_count
      ]);
      break;
    }

    case 'SPRINT_ANALYTICS': {
      const sprintData = getSprintAnalyticsReport(projectId, user);
      headers = ['Sprint ID', 'Sprint Name', 'Start Date', 'End Date', 'Status', 'Committed Points', 'Completed Points', 'Completion Rate %'];
      rows = sprintData.sprint_comparison.map(s => [
        s.sprint_id,
        s.sprint_name,
        s.start_date,
        s.end_date,
        s.status,
        s.committed_points,
        s.completed_points,
        s.completion_rate_pct
      ]);
      break;
    }

    case 'OKR_PROGRESS': {
      const okrData = getOkrProgressReport(user);
      headers = ['Objective ID', 'Title', 'Level', 'Progress %', 'Status', 'Owner Name'];
      rows = okrData.objectives.map(o => [
        o.id,
        o.title,
        o.level,
        o.progress_pct,
        o.status,
        o.owner_name
      ]);
      break;
    }

    case 'WORKLOAD_SUMMARY': {
      const workloadData = getWorkloadAnalyticsReport(user);
      headers = ['Member ID', 'Name', 'Email', 'Role', 'Utilization %', 'Capacity Hours', 'Assigned Hours', 'Status'];
      rows = workloadData.members.map(m => [
        m.member_id,
        m.name,
        m.email,
        m.role,
        m.utilization_pct,
        m.capacity_hours,
        m.assigned_hours,
        m.status
      ]);
      break;
    }

    default: {
      // CUSTOM fallback
      const kpis = queryAll('SELECT id, name, data_source, unit, target_value FROM kpi_definitions WHERE is_active = 1;');
      headers = ['ID', 'Name', 'Data Source', 'Unit', 'Target Value'];
      rows = kpis.map(k => [k.id, k.name, k.data_source, k.unit, k.target_value]);
      break;
    }
  }

  const rowCount = rows.length;

  // Insert into append-only analytics_report_exports
  execute(`
    INSERT INTO analytics_report_exports (
      exported_by, report_type, filters, export_format, row_count, created_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'));
  `, [
    user.id,
    reportType,
    typeof filters === 'object' ? JSON.stringify(filters) : String(filters || ''),
    format,
    rowCount
  ]);

  const newExport = queryOne('SELECT * FROM analytics_report_exports WHERE exported_by = ? ORDER BY id DESC LIMIT 1;', [user.id]);

  // Audit event in access_log
  execute(`
    INSERT INTO access_log (user_id, action, resource, target_id, ip_address, timestamp)
    VALUES (?, 'ANALYTICS_REPORT_EXPORT', '/api/analytics/report/export', ?, '127.0.0.1', datetime('now'));
  `, [user.id, String(newExport.id)]);

  if (format === 'CSV') {
    const csvLines = [headers.map(escapeCsvValue).join(',')];
    for (const r of rows) {
      csvLines.push(r.map(escapeCsvValue).join(','));
    }
    return {
      csv: csvLines.join('\r\n'),
      export_id: newExport.id,
      report_type: reportType,
      export_format: 'CSV',
      row_count: rowCount,
      exported_at: newExport.created_at
    };
  }

  return {
    success: true,
    export_id: newExport.id,
    report_type: reportType,
    export_format: 'JSON',
    row_count: rowCount,
    headers,
    data: rows,
    exported_at: newExport.created_at
  };
}


