/**
 * src/services/automationEngine.js
 * Workflow Automation Engine — Core Worker, Queue Processor, and Condition Evaluator
 *
 * Implements:
 * 1. Non-blocking trigger detection and enqueueing (fireTrigger).
 * 2. Immutable trigger_data snapshot frozen at enqueue time.
 * 3. Rate limiting (max 100 fires/project/hour, max 10 fires/rule/minute).
 * 4. Condition evaluator supporting 8 comparison operators and AND/OR compound logic.
 * 5. Pre-save circular automation dependency detection with max chain depth of 5 levels.
 * 6. Asynchronous queue processor batch worker (processQueueBatch).
 * 7. Background worker interval scheduler (startQueueWorker / stopQueueWorker).
 */

import { queryOne, queryAll, execute } from '../db/database.js';

let workerIntervalId = null;

/**
 * Resolves a dotted field path from trigger data (e.g. 'item.status', 'spent_percentage')
 */
export function resolveFieldValue(data, field) {
  if (!data || !field) return undefined;

  // Direct key lookup
  if (Object.prototype.hasOwnProperty.call(data, field)) {
    return data[field];
  }

  // Dotted traversal (e.g. 'item.status')
  const parts = field.split('.');
  let current = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      current = undefined;
      break;
    }
    current = current[part];
  }
  if (current !== undefined) return current;

  // Fallback: If looking for 'item.status' but object has top-level 'status'
  if (parts.length > 1) {
    const leaf = parts[parts.length - 1];
    if (Object.prototype.hasOwnProperty.call(data, leaf)) {
      return data[leaf];
    }
  }

  return undefined;
}

/**
 * Helper to test equality across types (numbers, booleans, strings)
 */
function isLooseEqual(actual, expected) {
  if (actual === expected) return true;
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return actual == expected;
  }
  if (typeof expected === 'boolean') {
    return String(actual).toLowerCase() === String(expected).toLowerCase();
  }
  if (typeof expected === 'number' || (!isNaN(Number(expected)) && typeof expected !== 'string')) {
    if (!isNaN(Number(actual))) {
      return Number(actual) === Number(expected);
    }
  }
  return String(actual).trim() === String(expected).trim();
}

/**
 * Evaluates trigger_conditions against triggerData
 * Supports: EQUALS, NOT_EQUALS, GREATER_THAN, LESS_THAN, GREATER_THAN_OR_EQUAL,
 *           LESS_THAN_OR_EQUAL, CONTAINS, IS_EMPTY
 * Compound logic: AND | OR (default AND)
 */
export function evaluateConditions(conditionsInput, conditionLogic = 'AND', triggerData = {}) {
  let conditions = [];
  if (typeof conditionsInput === 'string') {
    try {
      conditions = JSON.parse(conditionsInput);
    } catch {
      conditions = [];
    }
  } else if (Array.isArray(conditionsInput)) {
    conditions = conditionsInput;
  }

  if (!conditions || conditions.length === 0) {
    return { passed: true, details: [] };
  }

  const logic = String(conditionLogic || 'AND').toUpperCase();
  const details = [];

  for (const cond of conditions) {
    const { field, operator, value } = cond;
    const actual = resolveFieldValue(triggerData, field);
    let condPassed = false;

    const op = String(operator || 'EQUALS').toUpperCase();
    switch (op) {
      case 'EQUALS':
        condPassed = isLooseEqual(actual, value);
        break;
      case 'NOT_EQUALS':
        condPassed = !isLooseEqual(actual, value);
        break;
      case 'GREATER_THAN':
        condPassed = Number(actual) > Number(value);
        break;
      case 'LESS_THAN':
        condPassed = Number(actual) < Number(value);
        break;
      case 'GREATER_THAN_OR_EQUAL':
        condPassed = Number(actual) >= Number(value);
        break;
      case 'LESS_THAN_OR_EQUAL':
        condPassed = Number(actual) <= Number(value);
        break;
      case 'CONTAINS':
        condPassed =
          actual !== null &&
          actual !== undefined &&
          String(actual).toLowerCase().includes(String(value ?? '').toLowerCase());
        break;
      case 'IS_EMPTY':
        condPassed =
          actual === null ||
          actual === undefined ||
          actual === '' ||
          (Array.isArray(actual) && actual.length === 0) ||
          (typeof actual === 'object' && Object.keys(actual).length === 0);
        break;
      default:
        condPassed = isLooseEqual(actual, value);
        break;
    }

    details.push({
      field,
      operator: op,
      expected: value,
      actual,
      passed: Boolean(condPassed)
    });
  }

  const overallPassed =
    logic === 'OR'
      ? details.some((d) => d.passed)
      : details.every((d) => d.passed);

  return {
    passed: overallPassed,
    details
  };
}

/**
 * Maps an action to potential event triggers it produces
 */
export function getEventsFromAction(actionObj) {
  if (!actionObj || !actionObj.action) return [];
  const action = String(actionObj.action).toUpperCase();
  const params = actionObj.params || {};
  const events = [];

  switch (action) {
    case 'CHANGE_STATUS':
    case 'UPDATE_FIELD': {
      const entity = String(params.entity_type || '').toUpperCase();
      const newStatus = String(params.new_status || params.value || '').toUpperCase();
      if (entity === 'BACKLOG_ITEM' || entity === 'TASK') {
        events.push('ITEM_STATUS_CHANGED');
      } else if (entity === 'SPRINT') {
        if (newStatus === 'COMPLETED') events.push('SPRINT_COMPLETED');
        else if (newStatus === 'ACTIVE' || newStatus === 'STARTED') events.push('SPRINT_STARTED');
        else if (newStatus === 'CANCELLED') events.push('SPRINT_CANCELLED');
        else events.push('SPRINT_COMPLETED', 'SPRINT_STARTED');
      } else if (entity === 'MILESTONE') {
        if (newStatus === 'ACHIEVED') events.push('MILESTONE_ACHIEVED');
        events.push('GANTT_ITEM_STATUS_CHANGED');
      } else if (entity === 'OKR' || entity === 'OBJECTIVE') {
        if (newStatus === 'COMPLETED') events.push('OKR_COMPLETED');
        if (newStatus === 'AT_RISK') events.push('OKR_AT_RISK');
        events.push('OKR_PROGRESS_REACHED');
      } else if (entity === 'CLIENT_ORDER') {
        events.push('CLIENT_ORDER_STATUS_CHANGED');
      } else if (entity === 'EXPENSE') {
        if (newStatus === 'APPROVED') events.push('EXPENSE_APPROVED');
        if (newStatus === 'REJECTED') events.push('EXPENSE_REJECTED');
      } else if (entity === 'INVOICE') {
        if (newStatus === 'PAID') events.push('INVOICE_PAID');
        if (newStatus === 'SENT') events.push('INVOICE_SENT');
        if (newStatus === 'OVERDUE') events.push('INVOICE_OVERDUE');
      }
      break;
    }
    case 'ASSIGN_MEMBER':
      events.push('ITEM_ASSIGNED');
      break;
    case 'CREATE_BACKLOG_ITEM':
      events.push('ITEM_CREATED');
      break;
    case 'CREATE_GANTT_ITEM':
      events.push('GANTT_ITEM_STATUS_CHANGED');
      break;
    case 'MOVE_ITEM_TO_BACKLOG':
      events.push('SPRINT_ITEM_MOVED_TO_BACKLOG');
      break;
    case 'COMPLETE_SPRINT':
      events.push('SPRINT_COMPLETED');
      break;
    case 'CREATE_GITHUB_BRANCH':
      events.push('BRANCH_CREATED');
      break;
    default:
      break;
  }
  return events;
}

/**
 * Detects circular automation loops and chains exceeding max depth = 5
 */
export function detectCircularDependency(newRule, existingRules = []) {
  const allRules = [...existingRules.filter((r) => r.id !== newRule.id), newRule];

  // Helper to extract actions array
  const parseActions = (r) => {
    if (typeof r.actions === 'string') {
      try {
        return JSON.parse(r.actions);
      } catch {
        return [];
      }
    }
    return Array.isArray(r.actions) ? r.actions : [];
  };

  // Build adjacency list: rule -> [downstream rules]
  const ruleOutputs = new Map();
  for (const r of allRules) {
    const actions = parseActions(r);
    const producedEvents = actions.flatMap(getEventsFromAction);
    ruleOutputs.set(r, producedEvents);
  }

  // DFS cycle detection starting from newRule
  function dfs(currentRule, path = []) {
    if (path.length > 5) {
      return {
        circular: false,
        maxDepthExceeded: true,
        reason: `Chain exceeds max allowed depth of 5 levels: ${path.map((p) => p.name || p.trigger_event).join(' -> ')}`
      };
    }

    const outputs = ruleOutputs.get(currentRule) || [];
    for (const evt of outputs) {
      // Find downstream rules that trigger on evt
      const matchingRules = allRules.filter(
        (r) => r.trigger_event === evt && (r.is_active === undefined || r.is_active === 1)
      );

      for (const nextRule of matchingRules) {
        // Direct cycle back to any rule in current call path
        if (path.includes(nextRule) || nextRule === newRule) {
          const cyclePath = [...path.map((p) => p.name || p.trigger_event), nextRule.name || nextRule.trigger_event];
          return {
            circular: true,
            maxDepthExceeded: false,
            reason: `Circular automation loop detected: ${cyclePath.join(' -> ')}`
          };
        }

        const res = dfs(nextRule, [...path, nextRule]);
        if (res && (res.circular || res.maxDepthExceeded)) {
          return res;
        }
      }
    }

    return null;
  }

  const check = dfs(newRule, [newRule]);
  if (check) {
    return check;
  }

  return { circular: false, maxDepthExceeded: false };
}

/**
 * Evaluates rate limit constraints for a project and rule
 * Returns { isRateLimited: boolean, reason?: string, scheduleOffsetSeconds?: number }
 */
export function checkRateLimits(projectId, ruleId) {
  // 1. Rule limit: max 10 fires per automation rule per minute
  if (ruleId) {
    const ruleCount = queryOne(
      `SELECT COUNT(*) as count FROM automation_queue
       WHERE automation_id = ? AND created_at >= datetime('now', '-1 minute');`,
      [ruleId]
    )?.count || 0;

    if (ruleCount >= 10) {
      return {
        isRateLimited: true,
        reason: 'Rule rate limit exceeded (max 10 fires/rule/minute)',
        scheduleOffsetSeconds: 60
      };
    }
  }

  // 2. Project limit: max 100 fires per project per hour
  if (projectId) {
    const projCount = queryOne(
      `SELECT COUNT(*) as count FROM automation_queue q
       JOIN automation_rules r ON q.automation_id = r.id
       WHERE r.project_id = ? AND q.created_at >= datetime('now', '-1 hour');`,
      [projectId]
    )?.count || 0;

    if (projCount >= 100) {
      return {
        isRateLimited: true,
        reason: 'Project rate limit exceeded (max 100 fires/project/hour)',
        scheduleOffsetSeconds: 3600
      };
    }
  }

  return { isRateLimited: false, scheduleOffsetSeconds: 0 };
}

/**
 * Non-blocking trigger detection and queue dispatcher
 * Called by platform services after state-changing operations
 */
export function fireTrigger(module, event, sourceType, sourceId, userId = null, data = {}) {
  try {
    const cleanModule = String(module || '').toUpperCase();
    const cleanEvent = String(event || '').toUpperCase();

    // Query active rules matching module and event
    const matchingRules = queryAll(
      `SELECT * FROM automation_rules
       WHERE trigger_module = ? AND trigger_event = ? AND is_active = 1;`,
      [cleanModule, cleanEvent]
    );

    if (matchingRules.length === 0) {
      return { enqueued: 0, queue_ids: [] };
    }

    const projectId = data.project_id || (sourceType === 'PROJECT' ? sourceId : null);
    const triggerDataSnapshot = JSON.stringify(data || {});
    const queueIds = [];

    for (const rule of matchingRules) {
      // Scope validation: PROJECT rules only fire if project matches
      if (rule.scope === 'PROJECT' && rule.project_id) {
        if (projectId && rule.project_id !== projectId) {
          continue; // Mismatched project
        }
      }

      // Check rate limits
      const rateLimit = checkRateLimits(rule.project_id || projectId, rule.id);
      let scheduledAtSql = "datetime('now')";
      if (rateLimit.isRateLimited) {
        scheduledAtSql = `datetime('now', '+${rateLimit.scheduleOffsetSeconds} seconds')`;
      }

      // Enqueue non-blocking job
      const res = execute(
        `INSERT INTO automation_queue (
           automation_id, trigger_event, trigger_source_type, trigger_source_id,
           triggered_by_user_id, trigger_data, status, scheduled_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ${scheduledAtSql}, datetime('now'), datetime('now'));`,
        [
          rule.id,
          cleanEvent,
          sourceType || null,
          sourceId || null,
          userId || null,
          triggerDataSnapshot
        ]
      );

      queueIds.push(res.lastInsertRowid);
    }

    return { enqueued: queueIds.length, queue_ids: queueIds };
  } catch (err) {
    console.error('[AutomationEngine] fireTrigger error:', err);
    return { enqueued: 0, queue_ids: [], error: err.message };
  }
}

/**
 * Processes queued automation jobs in batch
 */
export function processQueueBatch(limit = 10) {
  try {
    const pendingJobs = queryAll(
      `SELECT * FROM automation_queue
       WHERE status = 'QUEUED' AND scheduled_at <= datetime('now')
       ORDER BY id ASC LIMIT ?;`,
      [limit]
    );

    let processedCount = 0;

    for (const job of pendingJobs) {
      // 1. Mark PROCESSING
      execute(
        `UPDATE automation_queue
         SET status = 'PROCESSING', attempts = attempts + 1, updated_at = datetime('now')
         WHERE id = ?;`,
        [job.id]
      );

      // 2. Fetch Rule
      const rule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [job.automation_id]);

      // If rule disabled or deleted: auto-mark DONE and skip (Rule 13)
      if (!rule || rule.is_active === 0) {
        execute(
          `UPDATE automation_queue
           SET status = 'DONE', updated_at = datetime('now')
           WHERE id = ?;`,
          [job.id]
        );
        processedCount++;
        continue;
      }

      let triggerData = {};
      try {
        triggerData = JSON.parse(job.trigger_data || '{}');
      } catch {
        triggerData = {};
      }

      // 3. Evaluate Conditions
      const evalResult = evaluateConditions(
        rule.trigger_conditions,
        rule.condition_logic,
        triggerData
      );

      const conditionsEvaluatedJson = JSON.stringify(evalResult.details || []);

      if (!evalResult.passed) {
        // Conditions not met -> record SKIPPED in run_log
        const logRes = execute(
          `INSERT INTO automation_run_log (
             automation_id, trigger_event, trigger_source_type, trigger_source_id,
             triggered_by_user_id, conditions_evaluated, conditions_passed,
             actions_executed, overall_status, error_message, started_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, ?, 0, '[]', 'SKIPPED', NULL, datetime('now'), datetime('now'));`,
          [
            rule.id,
            job.trigger_event,
            job.trigger_source_type,
            job.trigger_source_id,
            job.triggered_by_user_id,
            conditionsEvaluatedJson
          ]
        );

        execute(
          `UPDATE automation_queue
           SET status = 'DONE', run_log_id = ?, updated_at = datetime('now')
           WHERE id = ?;`,
          [logRes.lastInsertRowid, job.id]
        );

        processedCount++;
        continue;
      }

      // 4. Conditions Passed -> Execute actions (placeholder/recorded for Layer 2, full executor in Layer 3)
      let actions = [];
      try {
        actions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : rule.actions;
      } catch {
        actions = [];
      }

      const actionsExecuted = actions.map((act) => ({
        action: act.action,
        params: act.params || {},
        status: 'SUCCESS',
        executed_at: new Date().toISOString()
      }));

      // Insert append-only run log
      const logRes = execute(
        `INSERT INTO automation_run_log (
           automation_id, trigger_event, trigger_source_type, trigger_source_id,
           triggered_by_user_id, conditions_evaluated, conditions_passed,
           actions_executed, overall_status, error_message, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'SUCCESS', NULL, datetime('now'), datetime('now'));`,
        [
          rule.id,
          job.trigger_event,
          job.trigger_source_type,
          job.trigger_source_id,
          job.triggered_by_user_id,
          conditionsEvaluatedJson,
          JSON.stringify(actionsExecuted)
        ]
      );

      // Increment rule run count
      execute(
        `UPDATE automation_rules
         SET run_count = run_count + 1, last_run_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?;`,
        [rule.id]
      );

      // Mark queue item DONE
      execute(
        `UPDATE automation_queue
         SET status = 'DONE', run_log_id = ?, updated_at = datetime('now')
         WHERE id = ?;`,
        [logRes.lastInsertRowid, job.id]
      );

      processedCount++;
    }

    return { processed: processedCount };
  } catch (err) {
    console.error('[AutomationEngine] processQueueBatch error:', err);
    return { processed: 0, error: err.message };
  }
}

/**
 * Starts background queue poller
 */
export function startQueueWorker(intervalMs = 5000) {
  if (workerIntervalId) return;
  workerIntervalId = setInterval(() => {
    processQueueBatch(10);
  }, intervalMs);
  if (workerIntervalId && typeof workerIntervalId.unref === 'function') {
    workerIntervalId.unref();
  }
}

/**
 * Stops background queue poller
 */
export function stopQueueWorker() {
  if (workerIntervalId) {
    clearInterval(workerIntervalId);
    workerIntervalId = null;
  }
}
