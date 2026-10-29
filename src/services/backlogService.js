import { queryOne, queryAll, execute, getDatabase } from '../db/database.js';
import { isSprintAdmin } from './sprintService.js';
import { logAccess } from './auditService.js';
import { fireTrigger } from './automationEngine.js';

const VALID_TYPES = new Set(['STORY', 'BUG', 'TASK', 'EPIC']);
const VALID_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_STATUSES = new Set(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);

/**
 * Validates story points: integer between 0 and 999 (PRD 18 Rule 3)
 */
function validateStoryPoints(points) {
  if (points === undefined || points === null) return 0;
  const n = Number(points);
  if (!Number.isInteger(n) || n < 0 || n > 999) {
    const err = new Error('Story points must be an integer between 0 and 999');
    err.status = 400;
    throw err;
  }
  return n;
}

/**
 * Appends a field change to backlog_item_history (PRD 18 Rule 7)
 */
function recordHistory(itemId, userId, fieldName, oldValue, newValue) {
  const oldStr = oldValue !== null && oldValue !== undefined ? String(oldValue) : null;
  const newStr = newValue !== null && newValue !== undefined ? String(newValue) : null;
  execute(`
    INSERT INTO backlog_item_history (item_id, changed_by, field_changed, old_value, new_value, changed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [itemId, userId, fieldName, oldStr, newStr]);
}

/**
 * 1. Create a backlog item
 * Role: All authenticated users
 */
export function createBacklogItem({
  project_id,
  sprint_id = null,
  title,
  description = '',
  type = 'STORY',
  priority = 'MEDIUM',
  story_points = 0,
  assigned_to = null,
  userId
}) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!project_id) {
    const err = new Error('Project ID is required');
    err.status = 400;
    throw err;
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [project_id]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  if (!title || !title.trim()) {
    const err = new Error('Title is required');
    err.status = 400;
    throw err;
  }

  const cleanTitle = title.trim();
  const cleanType = VALID_TYPES.has(type?.toUpperCase()) ? type.toUpperCase() : 'STORY';
  const cleanPriority = VALID_PRIORITIES.has(priority?.toUpperCase()) ? priority.toUpperCase() : 'MEDIUM';
  const cleanPoints = validateStoryPoints(story_points);

  // If assigned_to provided, check user exists
  if (assigned_to) {
    const assignee = queryOne('SELECT id FROM users WHERE id = ?', [assigned_to]);
    if (!assignee) {
      const err = new Error('Assigned user not found');
      err.status = 404;
      throw err;
    }
  }

  // If sprint_id provided, verify sprint exists and user has Admin role
  let targetSprintId = null;
  if (sprint_id) {
    const sprint = queryOne('SELECT id, project_id, status FROM sprints WHERE id = ?', [sprint_id]);
    if (!sprint) {
      const err = new Error('Sprint not found');
      err.status = 404;
      throw err;
    }
    if (sprint.project_id !== project_id) {
      const err = new Error('Sprint does not belong to this project');
      err.status = 400;
      throw err;
    }
    if (!isSprintAdmin(userId, project_id)) {
      const err = new Error('Forbidden: Admin role required to assign item directly to a sprint');
      err.status = 403;
      throw err;
    }
    targetSprintId = sprint.id;
  }

  // Determine next position
  const maxPosRow = queryOne('SELECT MAX(position) as max_pos FROM backlog_items WHERE project_id = ?', [project_id]);
  const position = maxPosRow && maxPosRow.max_pos !== null ? maxPosRow.max_pos + 1 : 0;

  const result = execute(`
    INSERT INTO backlog_items (
      project_id, sprint_id, title, description, type, priority,
      story_points, status, assigned_to, created_by, position, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, 'TODO', ?, ?, ?, datetime('now'), datetime('now')
    )
  `, [
    project_id,
    targetSprintId,
    cleanTitle,
    description ? description.trim() : '',
    cleanType,
    cleanPriority,
    cleanPoints,
    assigned_to || null,
    userId,
    position
  ]);

  const itemId = Number(result.lastInsertRowid);
  const detail = getBacklogItemDetail(itemId, userId);

  try {
    fireTrigger('BACKLOG', 'ITEM_CREATED', 'BACKLOG_ITEM', itemId, userId, {
      project_id,
      item: {
        id: itemId,
        title: cleanTitle,
        type: cleanType,
        priority: cleanPriority,
        story_points: cleanPoints,
        assigned_to: assigned_to || null,
        status: 'TODO',
        project_id
      }
    });
  } catch (tErr) {
    console.error('[BacklogService] fireTrigger error:', tErr);
  }

  return detail;
}

/**
 * 2. Get pure backlog for a project (where sprint_id IS NULL)
 * Role: All authenticated users
 */
export function getProjectBacklog(projectId, userId = null) {
  if (!projectId) {
    const err = new Error('Project ID is required');
    err.status = 400;
    throw err;
  }

  const project = queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  return queryAll(`
    SELECT 
      bi.*,
      creator.name as creator_name,
      assignee.name as assignee_name
    FROM backlog_items bi
    LEFT JOIN users creator ON bi.created_by = creator.id
    LEFT JOIN users assignee ON bi.assigned_to = assignee.id
    WHERE bi.project_id = ? AND bi.sprint_id IS NULL
    ORDER BY bi.position ASC, bi.id ASC
  `, [projectId]);
}

/**
 * 3. Get item detail with history
 * Role: All authenticated users
 */
export function getBacklogItemDetail(itemId, userId = null) {
  if (!itemId) {
    const err = new Error('Item ID is required');
    err.status = 400;
    throw err;
  }

  const item = queryOne(`
    SELECT 
      bi.*,
      creator.name as creator_name,
      assignee.name as assignee_name,
      s.name as sprint_name,
      s.status as sprint_status,
      p.title as project_name
    FROM backlog_items bi
    JOIN projects p ON bi.project_id = p.id
    LEFT JOIN sprints s ON bi.sprint_id = s.id
    LEFT JOIN users creator ON bi.created_by = creator.id
    LEFT JOIN users assignee ON bi.assigned_to = assignee.id
    WHERE bi.id = ?
  `, [itemId]);

  if (!item) {
    const err = new Error('Backlog item not found');
    err.status = 404;
    throw err;
  }

  const history = queryAll(`
    SELECT bih.*, u.name as changer_name
    FROM backlog_item_history bih
    LEFT JOIN users u ON bih.changed_by = u.id
    WHERE bih.item_id = ?
    ORDER BY bih.id ASC
  `, [itemId]);

  return {
    ...item,
    history
  };
}

/**
 * 4. Update backlog item fields
 * Role: Owner or Admin+
 * Rule: Auto-logs to backlog_item_history
 */
export function updateBacklogItem(itemId, fields, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const item = queryOne('SELECT * FROM backlog_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Backlog item not found');
    err.status = 404;
    throw err;
  }

  const isOwner = item.created_by === userId;
  const isAdmin = isSprintAdmin(userId, item.project_id);

  if (!isOwner && !isAdmin) {
    const err = new Error('Forbidden: Only the item creator or Admin can edit this item');
    err.status = 403;
    throw err;
  }

  const updates = {};
  const historyEntries = [];

  if (fields.title !== undefined) {
    if (!fields.title || !fields.title.trim()) {
      const err = new Error('Title cannot be empty');
      err.status = 400;
      throw err;
    }
    const cleanTitle = fields.title.trim();
    if (cleanTitle !== item.title) {
      updates.title = cleanTitle;
      historyEntries.push({ field: 'title', oldVal: item.title, newVal: cleanTitle });
    }
  }

  if (fields.description !== undefined) {
    const cleanDesc = fields.description ? fields.description.trim() : '';
    if (cleanDesc !== (item.description || '')) {
      updates.description = cleanDesc;
      historyEntries.push({ field: 'description', oldVal: item.description, newVal: cleanDesc });
    }
  }

  if (fields.type !== undefined) {
    const upper = fields.type.toUpperCase();
    if (!VALID_TYPES.has(upper)) {
      const err = new Error(`Invalid type. Must be one of: ${Array.from(VALID_TYPES).join(', ')}`);
      err.status = 400;
      throw err;
    }
    if (upper !== item.type) {
      updates.type = upper;
      historyEntries.push({ field: 'type', oldVal: item.type, newVal: upper });
    }
  }

  if (fields.priority !== undefined) {
    const upper = fields.priority.toUpperCase();
    if (!VALID_PRIORITIES.has(upper)) {
      const err = new Error(`Invalid priority. Must be one of: ${Array.from(VALID_PRIORITIES).join(', ')}`);
      err.status = 400;
      throw err;
    }
    if (upper !== item.priority) {
      updates.priority = upper;
      historyEntries.push({ field: 'priority', oldVal: item.priority, newVal: upper });
    }
  }

  if (fields.story_points !== undefined) {
    const pts = validateStoryPoints(fields.story_points);
    if (pts !== item.story_points) {
      updates.story_points = pts;
      historyEntries.push({ field: 'story_points', oldVal: item.story_points, newVal: pts });
    }
  }

  if (fields.assigned_to !== undefined) {
    const newAssignee = fields.assigned_to || null;
    if (newAssignee) {
      const user = queryOne('SELECT id FROM users WHERE id = ?', [newAssignee]);
      if (!user) {
        const err = new Error('Assigned user not found');
        err.status = 404;
        throw err;
      }
    }
    if (newAssignee !== item.assigned_to) {
      updates.assigned_to = newAssignee;
      historyEntries.push({ field: 'assigned_to', oldVal: item.assigned_to, newVal: newAssignee });
    }
  }

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(itemId);

    execute(`
      UPDATE backlog_items
      SET ${setClauses}, updated_at = datetime('now')
      WHERE id = ?
    `, values);

    for (const h of historyEntries) {
      recordHistory(itemId, userId, h.field, h.oldVal, h.newVal);
    }
  }

  const detail = getBacklogItemDetail(itemId, userId);

  if (updates.assigned_to !== undefined) {
    try {
      fireTrigger('BACKLOG', 'ITEM_ASSIGNED', 'BACKLOG_ITEM', itemId, userId, {
        project_id: item.project_id,
        assigned_to: updates.assigned_to,
        item: {
          id: itemId,
          title: detail.title,
          assigned_to: updates.assigned_to,
          project_id: item.project_id
        }
      });
    } catch (tErr) {
      console.error('[BacklogService] fireTrigger error:', tErr);
    }
  }

  return detail;
}

/**
 * 5. Move backlog item between Sprint <-> Backlog
 * Role: Admin+
 * Rule 9: Admin moving items in someone else's ACTIVE sprint must log reason (min 10 chars) in access_log
 * Rule: Auto-logs to backlog_item_history
 */
export function moveBacklogItem(itemId, { sprint_id, reason = '' }, userId, ipAddress = '127.0.0.1') {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const item = queryOne('SELECT * FROM backlog_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Backlog item not found');
    err.status = 404;
    throw err;
  }

  if (!isSprintAdmin(userId, item.project_id)) {
    const err = new Error('Forbidden: Admin role required to move items between sprint and backlog');
    err.status = 403;
    throw err;
  }

  const targetSprintId = sprint_id || null;
  let targetSprint = null;

  if (targetSprintId) {
    targetSprint = queryOne('SELECT * FROM sprints WHERE id = ?', [targetSprintId]);
    if (!targetSprint) {
      const err = new Error('Target sprint not found');
      err.status = 404;
      throw err;
    }
    if (targetSprint.project_id !== item.project_id) {
      const err = new Error('Cannot move item to a sprint in another project');
      err.status = 400;
      throw err;
    }
    if (targetSprint.status === 'COMPLETED') {
      const err = new Error('Cannot move item into a COMPLETED sprint');
      err.status = 400;
      throw err;
    }
    if (targetSprint.status === 'CANCELLED') {
      const err = new Error('Cannot move item into a CANCELLED sprint');
      err.status = 400;
      throw err;
    }
  }

  // Non-negotiable Rule 9: Admin moving items in someone else's ACTIVE sprint must log reason (min 10 chars) in access_log
  let currentSprint = null;
  if (item.sprint_id) {
    currentSprint = queryOne('SELECT * FROM sprints WHERE id = ?', [item.sprint_id]);
  }

  const isLeavingOtherActiveSprint = currentSprint && currentSprint.status === 'ACTIVE' && currentSprint.created_by !== userId;
  const isEnteringOtherActiveSprint = targetSprint && targetSprint.status === 'ACTIVE' && targetSprint.created_by !== userId;

  if (isLeavingOtherActiveSprint || isEnteringOtherActiveSprint) {
    if (!reason || reason.trim().length < 10) {
      const err = new Error("Moving items in someone else's ACTIVE sprint requires a reason of at least 10 characters");
      err.status = 400;
      throw err;
    }
    logAccess({
      userId,
      action: 'backlog_item_moved_active_sprint',
      resource: `reason: ${reason.trim()}`.slice(0, 100),
      ipAddress,
      targetId: String(itemId)
    });
  }

  if (targetSprintId !== item.sprint_id) {
    execute(`
      UPDATE backlog_items
      SET sprint_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [targetSprintId, itemId]);

    recordHistory(itemId, userId, 'sprint_id', item.sprint_id, targetSprintId);
  }

  return getBacklogItemDetail(itemId, userId);
}

/**
 * 6. Update backlog item status
 * Role: Assigned member or Admin+
 * Rule: Auto-logs to backlog_item_history
 */
export function updateItemStatus(itemId, { status }, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const item = queryOne('SELECT * FROM backlog_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Backlog item not found');
    err.status = 404;
    throw err;
  }

  const isAssigned = item.assigned_to === userId;
  const isAdmin = isSprintAdmin(userId, item.project_id);
  const isCreator = item.created_by === userId;

  if (!isAssigned && !isAdmin && !isCreator) {
    const err = new Error('Forbidden: Only the assigned member or Admin can update item status');
    err.status = 403;
    throw err;
  }

  const upper = status?.toUpperCase();
  if (!VALID_STATUSES.has(upper)) {
    const err = new Error(`Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`);
    err.status = 400;
    throw err;
  }

  if (upper !== item.status) {
    execute(`
      UPDATE backlog_items
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [upper, itemId]);

    recordHistory(itemId, userId, 'status', item.status, upper);
  }

  const detail = getBacklogItemDetail(itemId, userId);

  if (upper !== item.status) {
    try {
      fireTrigger('BACKLOG', 'ITEM_STATUS_CHANGED', 'BACKLOG_ITEM', itemId, userId, {
        project_id: item.project_id,
        old_status: item.status,
        new_status: upper,
        status: upper,
        is_overdue: false,
        item: {
          id: itemId,
          title: item.title,
          status: upper,
          assigned_to: item.assigned_to,
          project_id: item.project_id
        }
      });
    } catch (tErr) {
      console.error('[BacklogService] fireTrigger error:', tErr);
    }
  }

  return detail;
}

/**
 * 7. Reorder backlog item position
 * Role: Admin+
 */
export function reorderBacklogItem(itemId, { position }, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const item = queryOne('SELECT * FROM backlog_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Backlog item not found');
    err.status = 404;
    throw err;
  }

  if (!isSprintAdmin(userId, item.project_id)) {
    const err = new Error('Forbidden: Admin role required to reorder items');
    err.status = 403;
    throw err;
  }

  const posNum = Number(position);
  if (!Number.isInteger(posNum) || posNum < 0) {
    const err = new Error('Position must be a non-negative integer');
    err.status = 400;
    throw err;
  }

  if (posNum !== item.position) {
    execute(`
      UPDATE backlog_items
      SET position = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [posNum, itemId]);

    recordHistory(itemId, userId, 'position', item.position, posNum);
  }

  return getBacklogItemDetail(itemId, userId);
}

/**
 * 8. Delete backlog item
 * Rule: Only TODO items deletable, must not be in ACTIVE sprint (Rule 5 & Line 217)
 * Role: Admin+
 */
export function deleteBacklogItem(itemId, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const item = queryOne('SELECT * FROM backlog_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Backlog item not found');
    err.status = 404;
    throw err;
  }

  if (!isSprintAdmin(userId, item.project_id)) {
    const err = new Error('Forbidden: Admin role required to delete items');
    err.status = 403;
    throw err;
  }

  // Non-negotiable Rule 5 & Line 217: only TODO items deletable
  if (item.status !== 'TODO') {
    const err = new Error(`Cannot delete item with status '${item.status}'. Only TODO items can be deleted.`);
    err.status = 400;
    throw err;
  }

  // Non-negotiable Rule 5: must not be in ACTIVE sprint
  if (item.sprint_id) {
    const sprint = queryOne('SELECT status FROM sprints WHERE id = ?', [item.sprint_id]);
    if (sprint && sprint.status === 'ACTIVE') {
      const err = new Error('Cannot delete item in an ACTIVE sprint. Only status changes are permitted.');
      err.status = 400;
      throw err;
    }
  }

  // Safely delete item with foreign keys temporarily toggled so child history rows are preserved per triggers
  const db = getDatabase();
  db.exec('PRAGMA foreign_keys = OFF;');
  execute('DELETE FROM backlog_items WHERE id = ?', [itemId]);
  db.exec('PRAGMA foreign_keys = ON;');

  return {
    success: true,
    message: 'Backlog item deleted successfully',
    id: Number(itemId)
  };
}
