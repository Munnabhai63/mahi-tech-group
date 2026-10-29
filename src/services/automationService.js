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
import { detectCircularDependency } from './automationEngine.js';

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
 */
export function getRules(filter = {}, currentUser) {
  // Members can view rules; admins see full governance
  let sql = 'SELECT * FROM automation_rules WHERE 1=1';
  const params = [];

  if (filter.project_id) {
    sql += " AND (project_id = ? OR scope = 'COMPANY')";
    params.push(filter.project_id);
  }

  if (filter.scope) {
    sql += ' AND scope = ?';
    params.push(String(filter.scope).toUpperCase());
  }

  if (filter.is_active !== undefined) {
    sql += ' AND is_active = ?';
    params.push(Number(Boolean(filter.is_active)));
  }

  if (filter.trigger_module) {
    sql += ' AND trigger_module = ?';
    params.push(String(filter.trigger_module).toUpperCase());
  }

  sql += ' ORDER BY id DESC;';
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
