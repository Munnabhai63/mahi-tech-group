/**
 * src/services/automationService.js
 * Workflow Automation Engine — Rule Management, Governance & Statistics Service
 *
 * Implements:
 * 1. Server-side RBAC (Admin+ required for rule mutations).
 * 2. Max 50 active automation rules per project enforcement on create/toggle.
 * 3. Pre-save circular dependency detection and chain depth checks (rejects, never persists).
 * 4. Rule CRUD and toggle operations.
 * 5. Rule update protection while queue is PROCESSING.
 * 6. Automatic cancellation of pending queue items on rule deactivation.
 * 7. Admin audit logging in access_log.
 * 8. Comprehensive global and project-level automation metrics and statistics.
 */

import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { detectCircularDependency, evaluateConditions } from './automationEngine.js';
import { resolveActionParams } from './automationActionExecutor.js';

/**
 * Validates admin role on current user
 */
export function verifyAdminRole(currentUser, actionName = 'manage automations') {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw { status: 403, message: `Forbidden: Admin privilege required to ${actionName}` };
  }
}

/**
 * Creates a new automation rule with pre-save validation
 */
export function createRule(ruleData, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'create automation rule');

  if (!ruleData.name || typeof ruleData.name !== 'string' || ruleData.name.trim().length < 2) {
    throw { status: 400, message: 'Rule name is required (min 2 characters)' };
  }

  if (!ruleData.trigger_module || typeof ruleData.trigger_module !== 'string') {
    throw { status: 400, message: 'trigger_module is required' };
  }

  if (!ruleData.trigger_event || typeof ruleData.trigger_event !== 'string') {
    throw { status: 400, message: 'trigger_event is required' };
  }

  // Validate actions
  let actionsJson = '[]';
  if (typeof ruleData.actions === 'string') {
    try {
      const parsed = JSON.parse(ruleData.actions);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error();
      }
      actionsJson = ruleData.actions;
    } catch {
      throw { status: 400, message: 'actions must be a valid non-empty JSON array' };
    }
  } else if (Array.isArray(ruleData.actions)) {
    if (ruleData.actions.length === 0) {
      throw { status: 400, message: 'actions must contain at least one action' };
    }
    actionsJson = JSON.stringify(ruleData.actions);
  } else {
    throw { status: 400, message: 'actions is required' };
  }

  // Validate conditions
  let conditionsJson = null;
  if (ruleData.trigger_conditions) {
    if (typeof ruleData.trigger_conditions === 'string') {
      try {
        JSON.parse(ruleData.trigger_conditions);
        conditionsJson = ruleData.trigger_conditions;
      } catch {
        throw { status: 400, message: 'trigger_conditions must be a valid JSON array or null' };
      }
    } else if (Array.isArray(ruleData.trigger_conditions)) {
      conditionsJson = JSON.stringify(ruleData.trigger_conditions);
    }
  }

  const scope = String(ruleData.scope || 'PROJECT').toUpperCase();
  const projectId = ruleData.project_id !== undefined && ruleData.project_id !== null ? ruleData.project_id : null;
  const isActive = ruleData.is_active === undefined ? 1 : Number(Boolean(ruleData.is_active));
  const conditionLogic = String(ruleData.condition_logic || 'AND').toUpperCase();

  // Enforce Max 50 active rules per project limit (Rule 5)
  if (isActive === 1 && projectId) {
    const activeCount = queryOne(
      'SELECT COUNT(*) as count FROM automation_rules WHERE project_id = ? AND is_active = 1;',
      [projectId]
    )?.count || 0;

    if (activeCount >= 50) {
      throw {
        status: 400,
        message: `Max 50 active automation rules per project reached (current: ${activeCount})`
      };
    }
  }

  // Enforce Pre-Save Circular Dependency Detection (Rule 3 & Rule 4)
  const candidateRule = {
    id: 'NEW_CANDIDATE',
    name: ruleData.name.trim(),
    trigger_module: ruleData.trigger_module.toUpperCase(),
    trigger_event: ruleData.trigger_event.toUpperCase(),
    actions: actionsJson,
    is_active: isActive
  };

  const existingActiveRules = queryAll('SELECT * FROM automation_rules WHERE is_active = 1;');
  const circularCheck = detectCircularDependency(candidateRule, existingActiveRules);

  if (circularCheck.circular) {
    throw {
      status: 400,
      message: circularCheck.reason
    };
  }

  if (circularCheck.maxDepthExceeded) {
    throw {
      status: 400,
      message: circularCheck.reason
    };
  }

  // Insert rule
  const insertRes = execute(
    `INSERT INTO automation_rules (
       name, description, project_id, scope, is_active, trigger_module, trigger_event,
       trigger_conditions, condition_logic, actions, is_ai_suggested, created_by,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));`,
    [
      ruleData.name.trim(),
      ruleData.description ? ruleData.description.trim() : null,
      projectId,
      scope,
      isActive,
      ruleData.trigger_module.toUpperCase(),
      ruleData.trigger_event.toUpperCase(),
      conditionsJson,
      conditionLogic,
      actionsJson,
      ruleData.is_ai_suggested ? 1 : 0,
      currentUser.id
    ]
  );

  const createdRule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [insertRes.lastInsertRowid]);

  // Log to access_log
  logAccess({
    userId: currentUser.id,
    action: 'automation_rule_created',
    resource: '/api/automation/rule/create',
    targetId: String(createdRule.id),
    ipAddress
  });

  return createdRule;
}

/**
 * Lists automation rules with optional filters
 * Members can only view rules that affected them
 */
export function getRules(filter = {}, currentUser) {
  const isAdmin = currentUser && ['admin', 'superadmin'].includes(currentUser.role);

  let sql = '';
  const params = [];

  if (!isAdmin) {
    sql = `
      SELECT DISTINCT r.* 
      FROM automation_rules r
      JOIN automation_run_log l ON r.id = l.automation_id
      WHERE l.triggered_by_user_id = ?
    `;
    params.push(currentUser ? currentUser.id : null);
  } else {
    sql = 'SELECT r.* FROM automation_rules r WHERE 1=1';
  }

  if (filter.project_id) {
    sql += " AND (r.project_id = ? OR r.scope = 'COMPANY')";
    params.push(filter.project_id);
  }

  if (filter.scope) {
    sql += ' AND r.scope = ?';
    params.push(String(filter.scope).toUpperCase());
  }

  if (filter.is_active !== undefined) {
    sql += ' AND r.is_active = ?';
    params.push(Number(Boolean(filter.is_active)));
  }

  if (filter.trigger_module) {
    sql += ' AND r.trigger_module = ?';
    params.push(String(filter.trigger_module).toUpperCase());
  }

  sql += ' ORDER BY r.id DESC;';
  return queryAll(sql, params);
}

/**
 * Retrieves rule details, last 10 execution logs, and error count
 */
export function getRuleDetail(ruleId, currentUser) {
  const rule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [ruleId]);
  if (!rule) {
    throw { status: 404, message: 'Automation rule not found' };
  }

  const isAdmin = currentUser && ['admin', 'superadmin'].includes(currentUser.role);
  if (!isAdmin) {
    const affected = queryOne(
      'SELECT id FROM automation_run_log WHERE automation_id = ? AND triggered_by_user_id = ? LIMIT 1;',
      [ruleId, currentUser ? currentUser.id : null]
    );
    if (!affected) {
      throw { status: 403, message: 'Forbidden: You do not have permission to view this automation rule' };
    }
  }

  const runLogs = queryAll(
    'SELECT * FROM automation_run_log WHERE automation_id = ? ORDER BY id DESC LIMIT 10;',
    [ruleId]
  );

  const errorCount = queryOne(
    'SELECT COUNT(*) as count FROM automation_errors WHERE automation_id = ? AND acknowledged_at IS NULL;',
    [ruleId]
  )?.count || 0;

  return {
    ...rule,
    run_logs: runLogs,
    error_count: errorCount
  };
}

/**
 * Updates an automation rule with queue lock and circular dependency protection
 */
export function updateRule(ruleId, updateData, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'update automation rule');

  const rule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [ruleId]);
  if (!rule) {
    throw { status: 404, message: 'Automation rule not found' };
  }

  // Prevent edit while automation has active job PROCESSING in queue
  const isProcessing = queryOne(
    "SELECT id FROM automation_queue WHERE automation_id = ? AND status = 'PROCESSING' LIMIT 1;",
    [ruleId]
  );
  if (isProcessing) {
    throw {
      status: 400,
      message: 'Cannot edit automation rule while an execution is currently PROCESSING in queue'
    };
  }

  const newName = updateData.name !== undefined ? updateData.name.trim() : rule.name;
  const newDesc = updateData.description !== undefined ? updateData.description : rule.description;
  const newModule = updateData.trigger_module !== undefined ? updateData.trigger_module.toUpperCase() : rule.trigger_module;
  const newEvent = updateData.trigger_event !== undefined ? updateData.trigger_event.toUpperCase() : rule.trigger_event;
  const newScope = updateData.scope !== undefined ? updateData.scope.toUpperCase() : rule.scope;
  const newProjectId = updateData.project_id !== undefined ? updateData.project_id : rule.project_id;
  const newIsActive = updateData.is_active !== undefined ? Number(Boolean(updateData.is_active)) : rule.is_active;
  const newLogic = updateData.condition_logic !== undefined ? updateData.condition_logic.toUpperCase() : rule.condition_logic;

  let newActions = rule.actions;
  if (updateData.actions !== undefined) {
    if (typeof updateData.actions === 'string') {
      try {
        const parsed = JSON.parse(updateData.actions);
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
        newActions = updateData.actions;
      } catch {
        throw { status: 400, message: 'actions must be a valid non-empty JSON array' };
      }
    } else if (Array.isArray(updateData.actions)) {
      if (updateData.actions.length === 0) {
        throw { status: 400, message: 'actions must contain at least one action' };
      }
      newActions = JSON.stringify(updateData.actions);
    }
  }

  let newConditions = rule.trigger_conditions;
  if (updateData.trigger_conditions !== undefined) {
    if (updateData.trigger_conditions === null) {
      newConditions = null;
    } else if (typeof updateData.trigger_conditions === 'string') {
      try {
        JSON.parse(updateData.trigger_conditions);
        newConditions = updateData.trigger_conditions;
      } catch {
        throw { status: 400, message: 'trigger_conditions must be a valid JSON array or null' };
      }
    } else if (Array.isArray(updateData.trigger_conditions)) {
      newConditions = JSON.stringify(updateData.trigger_conditions);
    }
  }

  // Check 50 active rules per project limit if activating
  if (newIsActive === 1 && rule.is_active === 0 && newProjectId) {
    const activeCount = queryOne(
      'SELECT COUNT(*) as count FROM automation_rules WHERE project_id = ? AND is_active = 1;',
      [newProjectId]
    )?.count || 0;

    if (activeCount >= 50) {
      throw {
        status: 400,
        message: `Max 50 active automation rules per project reached (current: ${activeCount})`
      };
    }
  }

  // Check circular dependency if trigger or actions changed
  if (newEvent !== rule.trigger_event || newActions !== rule.actions) {
    const candidateRule = {
      id: rule.id,
      name: newName,
      trigger_module: newModule,
      trigger_event: newEvent,
      actions: newActions,
      is_active: newIsActive
    };
    const otherActiveRules = queryAll('SELECT * FROM automation_rules WHERE is_active = 1 AND id != ?;', [rule.id]);
    const circ = detectCircularDependency(candidateRule, otherActiveRules);
    if (circ.circular) {
      throw { status: 400, message: circ.reason };
    }
    if (circ.maxDepthExceeded) {
      throw { status: 400, message: circ.reason };
    }
  }

  execute(
    `UPDATE automation_rules
     SET name = ?, description = ?, trigger_module = ?, trigger_event = ?,
         scope = ?, project_id = ?, is_active = ?, trigger_conditions = ?,
         condition_logic = ?, actions = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [
      newName,
      newDesc,
      newModule,
      newEvent,
      newScope,
      newProjectId,
      newIsActive,
      newConditions,
      newLogic,
      newActions,
      ruleId
    ]
  );

  // If rule is being deactivated, cancel pending queue jobs (Rule 13)
  if (newIsActive === 0 && rule.is_active === 1) {
    execute(
      `UPDATE automation_queue
       SET status = 'DONE', updated_at = datetime('now')
       WHERE automation_id = ? AND status = 'QUEUED';`,
      [ruleId]
    );
  }

  const updatedRule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [ruleId]);

  logAccess({
    userId: currentUser.id,
    action: 'automation_rule_updated',
    resource: `/api/automation/rule/${ruleId}`,
    targetId: String(ruleId),
    ipAddress
  });

  return updatedRule;
}

/**
 * Deletes an automation rule and cleans up pending queue items
 */
export function deleteRule(ruleId, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'delete automation rule');

  const rule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [ruleId]);
  if (!rule) {
    throw { status: 404, message: 'Automation rule not found' };
  }

  if (rule.is_system_template === 1 || rule.is_system_template === true) {
    throw { status: 400, message: 'System-template-based rules cannot be deleted' };
  }

  // Clean up any queued jobs for this rule
  execute('DELETE FROM automation_queue WHERE automation_id = ?;', [ruleId]);

  // Delete rule
  execute('DELETE FROM automation_rules WHERE id = ?;', [ruleId]);

  logAccess({
    userId: currentUser.id,
    action: 'automation_rule_deleted',
    resource: `/api/automation/rule/${ruleId}`,
    targetId: String(ruleId),
    ipAddress
  });

  return { success: true, deleted_id: ruleId };
}

/**
 * Toggles an automation rule's active state
 */
export function toggleRule(ruleId, isActive, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'toggle automation rule');

  const rule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [ruleId]);
  if (!rule) {
    throw { status: 404, message: 'Automation rule not found' };
  }

  const activeVal = Number(Boolean(isActive));

  // If activating, enforce 50 active rules per project limit
  if (activeVal === 1 && rule.is_active === 0 && rule.project_id) {
    const activeCount = queryOne(
      'SELECT COUNT(*) as count FROM automation_rules WHERE project_id = ? AND is_active = 1;',
      [rule.project_id]
    )?.count || 0;

    if (activeCount >= 50) {
      throw {
        status: 400,
        message: `Max 50 active automation rules per project reached (current: ${activeCount})`
      };
    }
  }

  execute(
    "UPDATE automation_rules SET is_active = ?, updated_at = datetime('now') WHERE id = ?;",
    [activeVal, ruleId]
  );

  // If disabling, clear pending queue entries immediately (Rule 13)
  if (activeVal === 0) {
    execute(
      `UPDATE automation_queue
       SET status = 'DONE', updated_at = datetime('now')
       WHERE automation_id = ? AND status = 'QUEUED';`,
      [ruleId]
    );
  }

  const updatedRule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [ruleId]);

  logAccess({
    userId: currentUser.id,
    action: 'automation_rule_toggled',
    resource: `/api/automation/rule/${ruleId}/toggle`,
    targetId: String(ruleId),
    ipAddress
  });

  return updatedRule;
}

/**
 * Computes global automation engine statistics
 */
export function getStats(currentUser) {
  verifyAdminRole(currentUser, 'view automation stats');

  const totalRules = queryOne('SELECT COUNT(*) as count FROM automation_rules;')?.count || 0;
  const activeRules = queryOne('SELECT COUNT(*) as count FROM automation_rules WHERE is_active = 1;')?.count || 0;
  const runsToday = queryOne("SELECT COUNT(*) as count FROM automation_run_log WHERE started_at >= date('now');")?.count || 0;

  const totalRuns = queryOne('SELECT COUNT(*) as count FROM automation_run_log;')?.count || 0;
  const successRuns = queryOne("SELECT COUNT(*) as count FROM automation_run_log WHERE overall_status = 'SUCCESS';")?.count || 0;

  const successRate = totalRuns > 0 ? Number(((successRuns / totalRuns) * 100).toFixed(2)) : 100.0;

  const topTriggered = queryAll(
    `SELECT id, name, trigger_module, trigger_event, run_count, last_run_at
     FROM automation_rules
     ORDER BY run_count DESC LIMIT 5;`
  );

  const errorCount = queryOne(
    'SELECT COUNT(*) as count FROM automation_errors WHERE acknowledged_at IS NULL;'
  )?.count || 0;

  return {
    total_rules: totalRules,
    active_rules: activeRules,
    runs_today: runsToday,
    total_runs: totalRuns,
    success_rate: successRate,
    top_triggered: topTriggered,
    error_count: errorCount
  };
}

/**
 * Computes project-level automation statistics
 */
export function getProjectStats(projectId, currentUser) {
  verifyAdminRole(currentUser, 'view project automation stats');

  const totalRules = queryOne(
    'SELECT COUNT(*) as count FROM automation_rules WHERE project_id = ?;',
    [projectId]
  )?.count || 0;

  const activeRules = queryOne(
    'SELECT COUNT(*) as count FROM automation_rules WHERE project_id = ? AND is_active = 1;',
    [projectId]
  )?.count || 0;

  const runsToday = queryOne(
    `SELECT COUNT(*) as count FROM automation_run_log l
     JOIN automation_rules r ON l.automation_id = r.id
     WHERE r.project_id = ? AND l.started_at >= date('now');`,
    [projectId]
  )?.count || 0;

  const totalRuns = queryOne(
    `SELECT COUNT(*) as count FROM automation_run_log l
     JOIN automation_rules r ON l.automation_id = r.id
     WHERE r.project_id = ?;`,
    [projectId]
  )?.count || 0;

  const successRuns = queryOne(
    `SELECT COUNT(*) as count FROM automation_run_log l
     JOIN automation_rules r ON l.automation_id = r.id
     WHERE r.project_id = ? AND l.overall_status = 'SUCCESS';`,
    [projectId]
  )?.count || 0;

  const successRate = totalRuns > 0 ? Number(((successRuns / totalRuns) * 100).toFixed(2)) : 100.0;

  const topTriggered = queryAll(
    `SELECT id, name, trigger_module, trigger_event, run_count, last_run_at
     FROM automation_rules
     WHERE project_id = ?
     ORDER BY run_count DESC LIMIT 5;`,
    [projectId]
  );

  const errorCount = queryOne(
    `SELECT COUNT(*) as count FROM automation_errors e
     JOIN automation_rules r ON e.automation_id = r.id
     WHERE r.project_id = ? AND e.acknowledged_at IS NULL;`,
    [projectId]
  )?.count || 0;

  return {
    project_id: projectId,
    total_rules: totalRules,
    active_rules: activeRules,
    runs_today: runsToday,
    total_runs: totalRuns,
    success_rate: successRate,
    top_triggered: topTriggered,
    error_count: errorCount
  };
}

/**
 * -------------------------------------------------------------------
 * PRD 26 Layer 4: REST API Service Methods
 * -------------------------------------------------------------------
 */

/**
 * Dry-run test execution: evaluates conditions and simulates action outcome
 * Non-destructive: strictly ZERO database mutations, zero emails, zero notifications
 */
export function testRuleDryRun(ruleId, mockTriggerData = {}, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'run automation dry-run test');

  const rule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [ruleId]);
  if (!rule) {
    throw { status: 404, message: 'Automation rule not found' };
  }

  let conditions = [];
  if (rule.trigger_conditions) {
    try {
      conditions = typeof rule.trigger_conditions === 'string' ? JSON.parse(rule.trigger_conditions) : rule.trigger_conditions;
    } catch {
      conditions = [];
    }
  }

  let actions = [];
  try {
    actions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : rule.actions;
  } catch {
    actions = [];
  }

  const condResult = evaluateConditions(conditions, rule.condition_logic || 'AND', mockTriggerData || {});

  let actionsThatWouldFire = [];
  let estimatedOutcome = 'SKIPPED';

  if (condResult.passed) {
    estimatedOutcome = 'WOULD_EXECUTE';
    actionsThatWouldFire = actions.map((act, index) => {
      const recordedVariables = [];
      const simulatedParams = resolveActionParams(act.params || {}, mockTriggerData || {}, recordedVariables);
      return {
        action_index: index,
        action: act.action || act.action_type,
        action_type: act.action_type || act.action,
        simulated_params: simulatedParams,
        rendered_params: simulatedParams,
        status: 'WOULD_FIRE',
        variables_resolved: recordedVariables
      };
    });
  }

  logAccess({
    userId: currentUser.id,
    action: 'automation_rule_dry_run_tested',
    resource: `/api/automation/rule/${ruleId}/test`,
    targetId: String(ruleId),
    ipAddress
  });

  return {
    rule_id: rule.id,
    rule_name: rule.name,
    conditions_passed: condResult.passed ? 1 : 0,
    conditions_evaluated: condResult.details || condResult.evaluations || [],
    actions_that_would_fire: actionsThatWouldFire,
    actions_resolved: actionsThatWouldFire,
    estimated_outcome: estimatedOutcome
  };
}

/**
 * Lists automation run logs with optional filters
 * Non-admin members only see runs they triggered
 */
export function getRunLogs(filter = {}, currentUser) {
  const isAdmin = currentUser && ['admin', 'superadmin'].includes(currentUser.role);

  let sql = `
    SELECT l.*, r.name as rule_name, r.trigger_module
    FROM automation_run_log l
    JOIN automation_rules r ON l.automation_id = r.id
    WHERE 1=1
  `;
  const params = [];

  if (!isAdmin) {
    sql += ' AND l.triggered_by_user_id = ?';
    params.push(currentUser ? currentUser.id : null);
  }

  if (filter.automation_id) {
    sql += ' AND l.automation_id = ?';
    params.push(filter.automation_id);
  }

  if (filter.status) {
    sql += ' AND l.overall_status = ?';
    params.push(String(filter.status).toUpperCase());
  }

  if (filter.from) {
    sql += ' AND l.started_at >= ?';
    params.push(filter.from);
  }

  if (filter.to) {
    sql += ' AND l.started_at <= ?';
    params.push(filter.to);
  }

  if (filter.project_id) {
    sql += ' AND r.project_id = ?';
    params.push(filter.project_id);
  }

  sql += ' ORDER BY l.id DESC LIMIT 100;';
  return queryAll(sql, params);
}

/**
 * Retrieves full run log detail with evaluated conditions, actions, resolved variables, and errors
 */
export function getRunLogDetail(runLogId, currentUser) {
  const log = queryOne(
    `SELECT l.*, r.name as rule_name, r.project_id, r.trigger_module
     FROM automation_run_log l
     JOIN automation_rules r ON l.automation_id = r.id
     WHERE l.id = ?;`,
    [runLogId]
  );
  if (!log) {
    throw { status: 404, message: 'Automation run log not found' };
  }

  const isAdmin = currentUser && ['admin', 'superadmin'].includes(currentUser.role);
  if (!isAdmin && log.triggered_by_user_id !== currentUser?.id) {
    throw { status: 403, message: 'Forbidden: You do not have permission to view this run log' };
  }

  const variableStore = queryAll(
    'SELECT variable_name, variable_value, created_at FROM automation_variable_store WHERE run_log_id = ? ORDER BY id ASC;',
    [runLogId]
  );

  const errors = queryAll(
    'SELECT * FROM automation_errors WHERE run_log_id = ? ORDER BY id ASC;',
    [runLogId]
  );

  let conditionsEvaluated = [];
  try {
    conditionsEvaluated = log.conditions_evaluated ? JSON.parse(log.conditions_evaluated) : [];
  } catch {
    conditionsEvaluated = [];
  }

  let actionsExecuted = [];
  try {
    actionsExecuted = log.actions_executed ? JSON.parse(log.actions_executed) : [];
  } catch {
    actionsExecuted = [];
  }

  return {
    ...log,
    conditions_evaluated: conditionsEvaluated,
    actions_executed: actionsExecuted,
    resolved_variables: variableStore,
    errors
  };
}

/**
 * Lists automation errors with optional filters
 */
export function getErrors(filter = {}, currentUser) {
  verifyAdminRole(currentUser, 'view automation errors');

  let sql = `
    SELECT e.*, r.name as rule_name, r.trigger_module, r.trigger_event, u.name as acknowledged_by_name
    FROM automation_errors e
    JOIN automation_rules r ON e.automation_id = r.id
    LEFT JOIN users u ON e.acknowledged_by = u.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.automation_id) {
    sql += ' AND e.automation_id = ?';
    params.push(filter.automation_id);
  }

  if (filter.acknowledged !== undefined && filter.acknowledged !== '') {
    const isAck = filter.acknowledged === '1' || filter.acknowledged === 'true' || filter.acknowledged === true;
    if (isAck) {
      sql += ' AND e.acknowledged_at IS NOT NULL';
    } else {
      sql += ' AND e.acknowledged_at IS NULL';
    }
  }

  sql += ' ORDER BY e.id DESC LIMIT 100;';
  return queryAll(sql, params);
}

/**
 * Acknowledges an automation error
 */
export function acknowledgeError(errorId, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'acknowledge automation error');

  const errorRecord = queryOne('SELECT * FROM automation_errors WHERE id = ?;', [errorId]);
  if (!errorRecord) {
    throw { status: 404, message: 'Automation error not found' };
  }

  execute(
    "UPDATE automation_errors SET acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?;",
    [currentUser.id, errorId]
  );

  const updated = queryOne(
    `SELECT e.*, u.name as acknowledged_by_name
     FROM automation_errors e
     LEFT JOIN users u ON e.acknowledged_by = u.id
     WHERE e.id = ?;`,
    [errorId]
  );

  logAccess({
    userId: currentUser.id,
    action: 'automation_error_acknowledged',
    resource: `/api/automation/error/${errorId}/acknowledge`,
    targetId: String(errorId),
    ipAddress
  });

  return updated;
}

/**
 * Re-queues a failed automation run from an error
 * Increments retry_count, max 3 retries
 */
export function retryError(errorId, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'retry automation error');

  const errorRecord = queryOne('SELECT * FROM automation_errors WHERE id = ?;', [errorId]);
  if (!errorRecord) {
    throw { status: 404, message: 'Automation error not found' };
  }

  const runLog = queryOne('SELECT * FROM automation_run_log WHERE id = ?;', [errorRecord.run_log_id]);
  if (!runLog) {
    throw { status: 404, message: 'Associated run log not found' };
  }

  const retryCount = queryOne(
    "SELECT COUNT(*) as count FROM automation_queue WHERE run_log_id = ? AND trigger_source_type = 'MANUAL_RETRY';",
    [runLog.id]
  )?.count || 0;

  if (retryCount >= 3) {
    throw { status: 400, message: 'Max 3 retries reached for this automation run' };
  }

  const existingJob = queryOne(
    'SELECT trigger_data FROM automation_queue WHERE run_log_id = ? ORDER BY id DESC LIMIT 1;',
    [runLog.id]
  );
  const triggerData = existingJob ? existingJob.trigger_data : '{}';

  const nextRetryAttempt = retryCount + 1;
  const insertQueue = execute(
    `INSERT INTO automation_queue (
       automation_id, run_log_id, trigger_event, trigger_source_type, trigger_source_id,
       triggered_by_user_id, trigger_data, status, scheduled_at, attempts, max_attempts,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'MANUAL_RETRY', ?, ?, ?, 'QUEUED', datetime('now'), ?, 3, datetime('now'), datetime('now'));`,
    [
      runLog.automation_id,
      runLog.id,
      runLog.trigger_event,
      runLog.trigger_source_id,
      runLog.triggered_by_user_id,
      triggerData,
      nextRetryAttempt
    ]
  );

  execute('UPDATE automation_errors SET retry_scheduled = ? WHERE id = ?;', [nextRetryAttempt, errorId]);

  logAccess({
    userId: currentUser.id,
    action: 'automation_error_retried',
    resource: `/api/automation/error/${errorId}/retry`,
    targetId: String(errorId),
    ipAddress
  });

  return {
    success: true,
    message: 'Automation re-queued for retry',
    queue_id: insertQueue.lastInsertRowid,
    attempt: nextRetryAttempt
  };
}

/**
 * Lists templates (system + user-saved)
 */
export function getTemplates(category = null, currentUser) {
  verifyAdminRole(currentUser, 'view automation templates');

  let sql = 'SELECT * FROM automation_templates WHERE 1=1';
  const params = [];

  if (category && category !== 'ALL') {
    sql += ' AND category = ?';
    params.push(String(category).toUpperCase());
  }

  sql += ' ORDER BY is_system_template DESC, usage_count DESC, id ASC;';
  return queryAll(sql, params);
}

/**
 * Saves a rule configuration as reusable template
 */
export function saveTemplate(templateData, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'save automation template');

  if (!templateData.name || typeof templateData.name !== 'string' || templateData.name.trim().length < 2) {
    throw { status: 400, message: 'Template name is required (min 2 characters)' };
  }

  if (!templateData.description || typeof templateData.description !== 'string') {
    throw { status: 400, message: 'Template description is required' };
  }

  if (!templateData.trigger_module || !templateData.trigger_event) {
    throw { status: 400, message: 'trigger_module and trigger_event are required' };
  }

  const category = String(templateData.category || 'GENERAL').toUpperCase();

  let actionsJson = '[]';
  if (typeof templateData.actions === 'string') {
    try {
      const parsed = JSON.parse(templateData.actions);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
      actionsJson = templateData.actions;
    } catch {
      throw { status: 400, message: 'actions must be a valid non-empty JSON array' };
    }
  } else if (Array.isArray(templateData.actions)) {
    if (templateData.actions.length === 0) {
      throw { status: 400, message: 'actions must contain at least one action' };
    }
    actionsJson = JSON.stringify(templateData.actions);
  } else {
    throw { status: 400, message: 'actions is required' };
  }

  let conditionsJson = null;
  if (templateData.trigger_conditions) {
    if (typeof templateData.trigger_conditions === 'string') {
      try {
        JSON.parse(templateData.trigger_conditions);
        conditionsJson = templateData.trigger_conditions;
      } catch {
        throw { status: 400, message: 'trigger_conditions must be a valid JSON array or null' };
      }
    } else if (Array.isArray(templateData.trigger_conditions)) {
      conditionsJson = JSON.stringify(templateData.trigger_conditions);
    }
  }

  const insertRes = execute(
    `INSERT INTO automation_templates (
       name, description, category, trigger_module, trigger_event, trigger_conditions,
       actions, is_system_template, created_by, usage_count, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, datetime('now'));`,
    [
      templateData.name.trim(),
      templateData.description.trim(),
      category,
      templateData.trigger_module.toUpperCase(),
      templateData.trigger_event.toUpperCase(),
      conditionsJson,
      actionsJson,
      currentUser.id
    ]
  );

  const createdTemplate = queryOne('SELECT * FROM automation_templates WHERE id = ?;', [insertRes.lastInsertRowid]);

  logAccess({
    userId: currentUser.id,
    action: 'automation_template_saved',
    resource: '/api/automation/template/save',
    targetId: String(createdTemplate.id),
    ipAddress
  });

  return createdTemplate;
}

/**
 * Deletes a custom template
 * System templates (is_system_template=1) cannot be deleted
 */
export function deleteTemplate(templateId, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'delete automation template');

  const template = queryOne('SELECT * FROM automation_templates WHERE id = ?;', [templateId]);
  if (!template) {
    throw { status: 404, message: 'Automation template not found' };
  }

  if (template.is_system_template === 1 || template.is_system_template === true) {
    throw { status: 403, message: 'Forbidden: System templates cannot be deleted' };
  }

  execute('DELETE FROM automation_templates WHERE id = ?;', [templateId]);

  logAccess({
    userId: currentUser.id,
    action: 'automation_template_deleted',
    resource: `/api/automation/template/${templateId}`,
    targetId: String(templateId),
    ipAddress
  });

  return { success: true, deleted_id: templateId };
}

/**
 * Creates new automation rule from template and increments usage count
 */
export function useTemplate(templateId, useData = {}, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'use automation template');

  const template = queryOne('SELECT * FROM automation_templates WHERE id = ?;', [templateId]);
  if (!template) {
    throw { status: 404, message: 'Automation template not found' };
  }

  const projectId = useData.project_id || null;
  const scope = projectId ? 'PROJECT' : 'COMPANY';
  const ruleName = (useData.name && useData.name.trim()) || template.name;

  const ruleData = {
    name: ruleName,
    description: template.description,
    project_id: projectId,
    scope,
    trigger_module: template.trigger_module,
    trigger_event: template.trigger_event,
    trigger_conditions: template.trigger_conditions,
    condition_logic: 'AND',
    actions: template.actions,
    is_active: 1
  };

  const createdRule = createRule(ruleData, currentUser, ipAddress);

  execute('UPDATE automation_templates SET usage_count = usage_count + 1 WHERE id = ?;', [templateId]);

  logAccess({
    userId: currentUser.id,
    action: 'automation_template_used',
    resource: `/api/automation/template/${templateId}/use`,
    targetId: String(createdRule.id),
    ipAddress
  });

  return createdRule;
}

/**
 * Lists all pending AI suggestions
 */
export function getSuggestions(currentUser) {
  verifyAdminRole(currentUser, 'view AI suggestions');

  return queryAll(
    "SELECT * FROM automation_ai_suggestions WHERE status = 'PENDING' ORDER BY id DESC;"
  );
}

/**
 * Approves an AI suggestion and creates an automation rule
 * Key rule: suggestion-only, never auto-executes
 */
export function approveSuggestion(suggestionId, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'approve AI suggestion');

  const suggestion = queryOne('SELECT * FROM automation_ai_suggestions WHERE id = ?;', [suggestionId]);
  if (!suggestion) {
    throw { status: 404, message: 'AI suggestion not found' };
  }

  if (suggestion.status !== 'PENDING') {
    throw { status: 400, message: `Suggestion is already ${suggestion.status}` };
  }

  const ruleData = {
    name: suggestion.suggested_name,
    description: suggestion.suggested_description,
    project_id: null,
    scope: 'COMPANY',
    trigger_module: suggestion.suggested_trigger_module,
    trigger_event: suggestion.suggested_trigger_event,
    trigger_conditions: suggestion.suggested_conditions,
    condition_logic: 'AND',
    actions: suggestion.suggested_actions,
    is_ai_suggested: 1,
    is_active: 1
  };

  const createdRule = createRule(ruleData, currentUser, ipAddress);

  execute(
    `UPDATE automation_ai_suggestions
     SET status = 'APPROVED', reviewed_by = ?, reviewed_at = datetime('now'),
         approved_automation_id = ?
     WHERE id = ?;`,
    [currentUser.id, createdRule.id, suggestionId]
  );

  logAccess({
    userId: currentUser.id,
    action: 'automation_suggestion_approved',
    resource: `/api/automation/suggestion/${suggestionId}/approve`,
    targetId: String(suggestionId),
    ipAddress
  });

  const updatedSuggestion = queryOne('SELECT * FROM automation_ai_suggestions WHERE id = ?;', [suggestionId]);

  return {
    success: true,
    rule: createdRule,
    created_rule_id: createdRule.id,
    suggestion: updatedSuggestion
  };
}

/**
 * Rejects an AI suggestion with optional reason
 */
export function rejectSuggestion(suggestionId, rejectionReason = null, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'reject AI suggestion');

  const suggestion = queryOne('SELECT * FROM automation_ai_suggestions WHERE id = ?;', [suggestionId]);
  if (!suggestion) {
    throw { status: 404, message: 'AI suggestion not found' };
  }

  if (suggestion.status !== 'PENDING') {
    throw { status: 400, message: `Suggestion is already ${suggestion.status}` };
  }

  execute(
    `UPDATE automation_ai_suggestions
     SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = datetime('now')
     WHERE id = ?;`,
    [rejectionReason ? String(rejectionReason).trim() : 'Rejected by Admin', currentUser.id, suggestionId]
  );

  logAccess({
    userId: currentUser.id,
    action: 'automation_suggestion_rejected',
    resource: `/api/automation/suggestion/${suggestionId}/reject`,
    targetId: String(suggestionId),
    ipAddress
  });

  return { success: true, rejected_id: suggestionId };
}

/**
 * Lists current automation queue state
 */
export function getQueue(filter = {}, currentUser) {
  verifyAdminRole(currentUser, 'view automation queue');

  let sql = `
    SELECT q.*, r.name as rule_name, r.trigger_module
    FROM automation_queue q
    JOIN automation_rules r ON q.automation_id = r.id
    WHERE 1=1
  `;
  const params = [];

  if (filter.status) {
    sql += ' AND q.status = ?';
    params.push(String(filter.status).toUpperCase());
  }

  if (filter.automation_id) {
    sql += ' AND q.automation_id = ?';
    params.push(filter.automation_id);
  }

  sql += ' ORDER BY q.id DESC LIMIT 100;';
  return queryAll(sql, params);
}

