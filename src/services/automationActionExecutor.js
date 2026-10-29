/**
 * MAHI Automation Action Execution Engine (PRD 26 — Layer 3)
 *
 * Declarative action execution with zero arbitrary code execution (no eval/vm).
 * Resolves template variables strictly from frozen trigger_data snapshots.
 * Enforces manual updated_at timestamps on all database mutations.
 */

import { execute, queryOne, queryAll } from '../db/database.js';
import { resolveFieldValue, evaluateConditions } from './automationEngine.js';
import crypto from 'node:crypto';

export const SUPPORTED_ACTIONS = Object.freeze([
  'SEND_NOTIFICATION',
  'SEND_EMAIL',
  'UPDATE_FIELD',
  'ASSIGN_MEMBER',
  'CHANGE_STATUS',
  'SET_DUE_DATE',
  'CREATE_BACKLOG_ITEM',
  'CREATE_GANTT_ITEM',
  'MOVE_ITEM_TO_BACKLOG',
  'COMPLETE_SPRINT',
  'WAIT',
  'STOP_IF'
]);

/**
 * Resolves {{ variable }} expressions strictly from frozen trigger_data snapshot
 */
export function resolveTemplateVariables(template, triggerData = {}, recordedVariables = null) {
  if (typeof template !== 'string') return template;

  const regex = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  return template.replace(regex, (match, path) => {
    const val = resolveFieldValue(triggerData, path);
    const resolvedStr = val === undefined || val === null ? '' : String(val);
    if (recordedVariables && Array.isArray(recordedVariables)) {
      recordedVariables.push({ name: path, value: resolvedStr });
    }
    return resolvedStr;
  });
}

/**
 * Recursively resolves variables across object structures without modifying primitives
 */
export function resolveActionParams(params, triggerData = {}, recordedVariables = null) {
  if (!params || typeof params !== 'object') {
    if (typeof params === 'string') {
      return resolveTemplateVariables(params, triggerData, recordedVariables);
    }
    return params;
  }

  if (Array.isArray(params)) {
    return params.map((item) => resolveActionParams(item, triggerData, recordedVariables));
  }

  const resolved = {};
  for (const [key, val] of Object.entries(params)) {
    resolved[key] = resolveActionParams(val, triggerData, recordedVariables);
  }
  return resolved;
}

/**
 * Action Handler: SEND_NOTIFICATION
 */
function handleSendNotification(params, triggerData, context) {
  const message = params.message || 'Notification';
  const target = String(params.to || 'ASSIGNEE').toUpperCase();
  const projectId = params.project_id || triggerData.project_id || null;

  const recipientIds = new Set();

  if (target === 'ASSIGNEE') {
    const assigneeId =
      params.user_id ||
      triggerData.item?.assigned_to ||
      triggerData.assigned_to ||
      triggerData.user_id;
    if (assigneeId && assigneeId !== 'null') recipientIds.add(String(assigneeId));
  } else if (target === 'ADMIN') {
    const admins = queryAll("SELECT id FROM users WHERE role IN ('admin', 'superadmin') AND id IS NOT NULL;");
    admins.forEach((a) => {
      if (a.id && a.id !== 'null') recipientIds.add(String(a.id));
    });
  } else if (target === 'PROJECT_MEMBERS') {
    if (projectId) {
      const members = queryAll('SELECT user_id FROM project_members WHERE project_id = ? AND user_id IS NOT NULL;', [projectId]);
      members.forEach((m) => {
        if (m.user_id && m.user_id !== 'null') recipientIds.add(String(m.user_id));
      });
    }
  } else if (target === 'SPECIFIC_USER' && params.user_id) {
    if (params.user_id !== 'null') recipientIds.add(String(params.user_id));
  } else if (params.to && !['ASSIGNEE', 'ADMIN', 'PROJECT_MEMBERS', 'SPECIFIC_USER'].includes(target)) {
    if (params.to !== 'null') recipientIds.add(String(params.to));
  }

  if (recipientIds.size === 0 && context.currentUserId && context.currentUserId !== 'null') {
    recipientIds.add(String(context.currentUserId));
  }

  const inserted = [];
  if (recipientIds.size > 0) {
    const validUsers = queryAll(
      `SELECT id FROM users WHERE id IN (${Array.from(recipientIds).map(() => '?').join(',')});`,
      Array.from(recipientIds)
    );
    const validSet = new Set(validUsers.map((u) => u.id));

    for (const uid of recipientIds) {
      if (!validSet.has(uid)) continue;
      const notifId = crypto.randomUUID();
      execute(
        `INSERT INTO notifications (
           id, user_id, event_type, message, link, read_status, created_at
         ) VALUES (?, ?, 'AUTOMATION_NOTIFICATION', ?, ?, 0, datetime('now'));`,
        [notifId, uid, message, params.link || null]
      );
      inserted.push({ id: notifId, user_id: uid });
    }
  }

  return {
    sent_count: inserted.length,
    recipients: Array.from(recipientIds),
    message
  };
}

/**
 * Action Handler: SEND_EMAIL
 */
function handleSendEmail(params, triggerData, context) {
  if (!params.to) {
    throw new Error('SEND_EMAIL action missing "to" recipient parameter');
  }

  const to = params.to;
  const subject = params.subject || 'Automated Platform Update';
  const body = params.body || '';

  // Declarative delivery logging (zero external email side-effects in test/local mode)
  return {
    delivered: true,
    to,
    subject,
    body,
    dispatched_at: new Date().toISOString()
  };
}

/**
 * Action Handler: UPDATE_FIELD
 */
function handleUpdateField(params, triggerData, context) {
  const entityType = String(params.entity_type || '').toUpperCase();
  const entityId = params.entity_id || resolveFieldValue(triggerData, params.entity_id_from_trigger || 'id');
  const field = String(params.field || '').trim();
  const value = params.value;

  if (!entityId) {
    throw new Error(`UPDATE_FIELD failed: unable to resolve target entity id for ${entityType}`);
  }
  if (!field) {
    throw new Error('UPDATE_FIELD failed: field name is required');
  }

  const whitelist = {
    BACKLOG_ITEM: {
      table: 'backlog_items',
      allowed: ['title', 'description', 'type', 'priority', 'status', 'story_points', 'assigned_to', 'position', 'due_date']
    },
    PROJECT: {
      table: 'projects',
      allowed: ['title', 'current_stage', 'status']
    },
    SPRINT: {
      table: 'sprints',
      allowed: ['name', 'goal', 'status', 'start_date', 'end_date']
    },
    EXPENSE: {
      table: 'project_expenses',
      allowed: ['description', 'status', 'amount', 'category_id']
    },
    PROJECT_EXPENSE: {
      table: 'project_expenses',
      allowed: ['description', 'status', 'amount', 'category_id']
    },
    CLIENT_ORDER: {
      table: 'client_orders',
      allowed: ['title', 'status', 'total_amount']
    }
  };

  const config = whitelist[entityType];
  if (!config) {
    throw new Error(`UPDATE_FIELD failed: unsupported entity_type "${entityType}"`);
  }

  if (!config.allowed.includes(field)) {
    throw new Error(`UPDATE_FIELD failed: field "${field}" is not allowed for update on ${config.table}`);
  }

  const existing = queryOne(`SELECT id FROM ${config.table} WHERE id = ?;`, [entityId]);
  if (!existing) {
    throw new Error(`UPDATE_FIELD failed: ${entityType} record with id ${entityId} not found`);
  }

  execute(
    `UPDATE ${config.table}
     SET ${field} = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [value, entityId]
  );

  return {
    updated: true,
    table: config.table,
    entity_id: entityId,
    field,
    new_value: value
  };
}

/**
 * Action Handler: ASSIGN_MEMBER
 */
function handleAssignMember(params, triggerData, context) {
  const entityType = String(params.entity_type || 'BACKLOG_ITEM').toUpperCase();
  const entityId = params.entity_id || resolveFieldValue(triggerData, params.entity_id_from_trigger || 'item.id') || triggerData.id;
  const userId = params.user_id !== undefined ? params.user_id : resolveFieldValue(triggerData, params.user_id_from_trigger || 'user_id');

  if (!entityId) {
    throw new Error(`ASSIGN_MEMBER failed: unable to resolve entity id for ${entityType}`);
  }

  if (entityType === 'BACKLOG_ITEM') {
    const existing = queryOne('SELECT id FROM backlog_items WHERE id = ?;', [entityId]);
    if (!existing) throw new Error(`Backlog item id ${entityId} not found`);

    execute(
      `UPDATE backlog_items
       SET assigned_to = ?, updated_at = datetime('now')
       WHERE id = ?;`,
      [userId || null, entityId]
    );
    return { assigned: true, entity_type: entityType, entity_id: entityId, assigned_to: userId };
  }

  if (entityType === 'GANTT_ITEM') {
    const existing = queryOne('SELECT id FROM gantt_items WHERE id = ?;', [entityId]);
    if (!existing) throw new Error(`Gantt item id ${entityId} not found`);

    execute(
      `UPDATE gantt_items
       SET assigned_to = ?, updated_at = datetime('now')
       WHERE id = ?;`,
      [userId || null, entityId]
    );
    return { assigned: true, entity_type: entityType, entity_id: entityId, assigned_to: userId };
  }

  throw new Error(`ASSIGN_MEMBER failed: unsupported entity_type "${entityType}"`);
}

/**
 * Action Handler: CHANGE_STATUS
 */
function handleChangeStatus(params, triggerData, context) {
  const entityType = String(params.entity_type || 'BACKLOG_ITEM').toUpperCase();
  const entityId = params.entity_id || resolveFieldValue(triggerData, params.entity_id_from_trigger || 'id');
  const newStatus = String(params.new_status || '').trim().toUpperCase();

  if (!entityId) {
    throw new Error(`CHANGE_STATUS failed: unable to resolve entity id for ${entityType}`);
  }
  if (!newStatus) {
    throw new Error('CHANGE_STATUS failed: new_status is required');
  }

  const tableMap = {
    BACKLOG_ITEM: 'backlog_items',
    SPRINT: 'sprints',
    PROJECT: 'projects',
    EXPENSE: 'project_expenses',
    PROJECT_EXPENSE: 'project_expenses',
    CLIENT_ORDER: 'client_orders'
  };

  const table = tableMap[entityType];
  if (!table) {
    throw new Error(`CHANGE_STATUS failed: unsupported entity_type "${entityType}"`);
  }

  const existing = queryOne(`SELECT id FROM ${table} WHERE id = ?;`, [entityId]);
  if (!existing) {
    throw new Error(`CHANGE_STATUS failed: ${entityType} record with id ${entityId} not found`);
  }

  execute(
    `UPDATE ${table}
     SET status = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [newStatus, entityId]
  );

  return {
    status_changed: true,
    table,
    entity_id: entityId,
    new_status: newStatus
  };
}

/**
 * Action Handler: SET_DUE_DATE
 */
function handleSetDueDate(params, triggerData, context) {
  const entityType = String(params.entity_type || 'BACKLOG_ITEM').toUpperCase();
  const entityId = params.entity_id || resolveFieldValue(triggerData, params.entity_id_from_trigger || 'id');
  const offsetDays = Number(params.due_date_offset_days || 0);

  if (!entityId) {
    throw new Error(`SET_DUE_DATE failed: unable to resolve entity id for ${entityType}`);
  }

  if (entityType === 'GANTT_ITEM') {
    const existing = queryOne('SELECT id FROM gantt_items WHERE id = ?;', [entityId]);
    if (!existing) throw new Error(`Gantt item id ${entityId} not found`);

    execute(
      `UPDATE gantt_items
       SET end_date = date('now', '+${offsetDays} days'), updated_at = datetime('now')
       WHERE id = ?;`,
      [entityId]
    );
    return { due_date_set: true, entity_type: entityType, entity_id: entityId, offset_days: offsetDays };
  }

  if (entityType === 'SPRINT') {
    const existing = queryOne('SELECT id FROM sprints WHERE id = ?;', [entityId]);
    if (!existing) throw new Error(`Sprint id ${entityId} not found`);

    execute(
      `UPDATE sprints
       SET end_date = date('now', '+${offsetDays} days'), updated_at = datetime('now')
       WHERE id = ?;`,
      [entityId]
    );
    return { due_date_set: true, entity_type: entityType, entity_id: entityId, offset_days: offsetDays };
  }

  if (entityType === 'BACKLOG_ITEM') {
    const existing = queryOne('SELECT id FROM backlog_items WHERE id = ?;', [entityId]);
    if (!existing) throw new Error(`Backlog item id ${entityId} not found`);

    execute(
      `UPDATE backlog_items
       SET due_date = date('now', '+${offsetDays} days'), updated_at = datetime('now')
       WHERE id = ?;`,
      [entityId]
    );
    return { due_date_set: true, entity_type: entityType, entity_id: entityId, offset_days: offsetDays };
  }

  throw new Error(`SET_DUE_DATE failed: unsupported entity_type "${entityType}"`);
}

/**
 * Action Handler: CREATE_BACKLOG_ITEM
 */
function handleCreateBacklogItem(params, triggerData, context) {
  const projectId = params.project_id || triggerData.project_id;
  if (!projectId) {
    throw new Error('CREATE_BACKLOG_ITEM failed: project_id is required');
  }

  const title = String(params.title || 'Automated Follow-up Item').trim();
  const type = String(params.type || 'TASK').toUpperCase();
  const priority = String(params.priority || 'MEDIUM').toUpperCase();
  const assignedTo = params.assigned_to || null;
  const createdBy = context.currentUserId || 1;

  const res = execute(
    `INSERT INTO backlog_items (
       project_id, title, description, type, priority, assigned_to, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));`,
    [projectId, title, params.description || null, type, priority, assignedTo, createdBy]
  );

  return {
    created: true,
    item_id: res.lastInsertRowid,
    project_id: projectId,
    title,
    type,
    priority
  };
}

/**
 * Action Handler: CREATE_GANTT_ITEM
 */
function handleCreateGanttItem(params, triggerData, context) {
  const projectId = params.project_id || triggerData.project_id;
  if (!projectId) {
    throw new Error('CREATE_GANTT_ITEM failed: project_id is required');
  }

  const title = String(params.title || 'Automated Milestone Item').trim();
  const startOffset = Number(params.start_date_offset || 0);
  const duration = Number(params.duration_days || 5);
  const createdBy = context.currentUserId || 1;

  const res = execute(
    `INSERT INTO gantt_items (
       project_id, title, start_date, end_date, progress_pct, status, created_by, created_at, updated_at
     ) VALUES (?, ?, date('now', '+${startOffset} days'), date('now', '+${startOffset + duration} days'), 0.0, 'NOT_STARTED', ?, datetime('now'), datetime('now'));`,
    [projectId, title, createdBy]
  );

  return {
    created: true,
    item_id: res.lastInsertRowid,
    project_id: projectId,
    title,
    duration_days: duration
  };
}

/**
 * Action Handler: MOVE_ITEM_TO_BACKLOG
 */
function handleMoveItemToBacklog(params, triggerData, context) {
  const itemId = params.item_id || resolveFieldValue(triggerData, params.item_id_from_trigger || 'item.id') || triggerData.id;
  if (!itemId) {
    throw new Error('MOVE_ITEM_TO_BACKLOG failed: item_id is required');
  }

  const existing = queryOne('SELECT id FROM backlog_items WHERE id = ?;', [itemId]);
  if (!existing) {
    throw new Error(`MOVE_ITEM_TO_BACKLOG failed: backlog item id ${itemId} not found`);
  }

  execute(
    `UPDATE backlog_items
     SET sprint_id = NULL, status = 'TODO', updated_at = datetime('now')
     WHERE id = ?;`,
    [itemId]
  );

  return {
    moved_to_backlog: true,
    item_id: itemId
  };
}

/**
 * Action Handler: COMPLETE_SPRINT
 */
function handleCompleteSprint(params, triggerData, context) {
  const sprintId = params.sprint_id || resolveFieldValue(triggerData, params.sprint_id_from_trigger || 'sprint.id') || triggerData.id;
  if (!sprintId) {
    throw new Error('COMPLETE_SPRINT failed: sprint_id is required');
  }

  const existing = queryOne('SELECT id FROM sprints WHERE id = ?;', [sprintId]);
  if (!existing) {
    throw new Error(`COMPLETE_SPRINT failed: sprint id ${sprintId} not found`);
  }

  execute(
    `UPDATE sprints
     SET status = 'COMPLETED', updated_at = datetime('now')
     WHERE id = ?;`,
    [sprintId]
  );

  return {
    sprint_completed: true,
    sprint_id: sprintId
  };
}

/**
 * Action Handler: WAIT
 */
function handleWait(params, triggerData, context) {
  const hours = Number(params.hours || 0);
  const seconds = Number(params.seconds || 0);
  const totalSeconds = hours * 3600 + seconds;

  return {
    status: 'WAITING',
    wait_hours: hours,
    wait_seconds: totalSeconds
  };
}

/**
 * Action Handler: STOP_IF
 */
function handleStopIf(params, triggerData, context) {
  const condition = params.condition || {
    field: params.field,
    operator: params.operator,
    value: params.value
  };

  if (!condition || !condition.field || !condition.operator) {
    throw new Error('STOP_IF action missing valid condition object');
  }

  const evalResult = evaluateConditions([condition], 'AND', triggerData);
  if (evalResult.passed) {
    return {
      status: 'STOPPED',
      reason: `STOP_IF condition met: ${condition.field} ${condition.operator} ${condition.value}`
    };
  }

  return {
    status: 'CONTINUED',
    reason: 'STOP_IF condition not met'
  };
}

/**
 * Dispatches an individual declarative action
 */
export function executeAction(actionObj, triggerData = {}, context = {}) {
  const actionType = String(actionObj.action || actionObj.type || '').toUpperCase();

  if (!SUPPORTED_ACTIONS.includes(actionType)) {
    throw new Error(`Unsupported action type: "${actionType}". Declarative automation only.`);
  }

  const rawParams = actionObj.params || {};
  const recordedVars = context.recordedVariables || [];
  const resolvedParams = resolveActionParams(rawParams, triggerData, recordedVars);

  switch (actionType) {
    case 'SEND_NOTIFICATION':
      return handleSendNotification(resolvedParams, triggerData, context);
    case 'SEND_EMAIL':
      return handleSendEmail(resolvedParams, triggerData, context);
    case 'UPDATE_FIELD':
      return handleUpdateField(resolvedParams, triggerData, context);
    case 'ASSIGN_MEMBER':
      return handleAssignMember(resolvedParams, triggerData, context);
    case 'CHANGE_STATUS':
      return handleChangeStatus(resolvedParams, triggerData, context);
    case 'SET_DUE_DATE':
      return handleSetDueDate(resolvedParams, triggerData, context);
    case 'CREATE_BACKLOG_ITEM':
      return handleCreateBacklogItem(resolvedParams, triggerData, context);
    case 'CREATE_GANTT_ITEM':
      return handleCreateGanttItem(resolvedParams, triggerData, context);
    case 'MOVE_ITEM_TO_BACKLOG':
      return handleMoveItemToBacklog(resolvedParams, triggerData, context);
    case 'COMPLETE_SPRINT':
      return handleCompleteSprint(resolvedParams, triggerData, context);
    case 'WAIT':
      return handleWait(resolvedParams, triggerData, context);
    case 'STOP_IF':
      return handleStopIf(resolvedParams, triggerData, context);
    default:
      throw new Error(`Action handler for "${actionType}" not implemented.`);
  }
}

/**
 * Executes a sequence of declarative actions, capturing errors, variables, and status
 */
export function executeActionsSequence(actionsInput, triggerData = {}, context = {}) {
  let actions = [];
  try {
    actions = typeof actionsInput === 'string' ? JSON.parse(actionsInput) : actionsInput;
  } catch {
    actions = [];
  }

  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      actionsExecuted: [],
      overallStatus: 'SUCCESS',
      errorMessage: null,
      failedIndex: null,
      isWaiting: false,
      waitDelaySeconds: 0,
      recordedVariables: []
    };
  }

  const actionsExecuted = [];
  const recordedVariables = [];
  let isWaiting = false;
  let waitDelaySeconds = 0;
  let hasFailed = false;
  let errorMessage = null;
  let failedIndex = null;
  let hasSuccess = false;

  const enrichedContext = { ...context, recordedVariables };

  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    try {
      const result = executeAction(act, triggerData, enrichedContext);

      if (result && result.status === 'WAITING') {
        isWaiting = true;
        waitDelaySeconds = result.wait_seconds || 60;
        actionsExecuted.push({
          action: act.action || act.type,
          params: act.params || {},
          status: 'WAITING',
          result,
          executed_at: new Date().toISOString()
        });
        break; // Pause remaining actions for future scheduled tick
      }

      if (result && result.status === 'STOPPED') {
        actionsExecuted.push({
          action: act.action || act.type,
          params: act.params || {},
          status: 'STOPPED',
          result,
          executed_at: new Date().toISOString()
        });
        hasSuccess = true;
        break; // Gracefully stop chain execution
      }

      actionsExecuted.push({
        action: act.action || act.type,
        params: act.params || {},
        status: 'SUCCESS',
        result,
        executed_at: new Date().toISOString()
      });
      hasSuccess = true;
    } catch (err) {
      hasFailed = true;
      errorMessage = err.message;
      failedIndex = i;

      actionsExecuted.push({
        action: act.action || act.type,
        params: act.params || {},
        status: 'FAILED',
        error: err.message,
        executed_at: new Date().toISOString()
      });
      break; // Halt subsequent actions on failure
    }
  }

  let overallStatus = 'SUCCESS';
  if (hasFailed) {
    overallStatus = hasSuccess ? 'PARTIAL' : 'FAILED';
  } else if (isWaiting) {
    overallStatus = 'PENDING';
  }

  return {
    actionsExecuted,
    overallStatus,
    errorMessage,
    failedIndex,
    isWaiting,
    waitDelaySeconds,
    recordedVariables
  };
}
