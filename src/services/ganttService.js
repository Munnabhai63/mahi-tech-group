import { queryOne, queryAll, execute, getDatabase } from '../db/database.js';
import { fireTrigger } from './automationEngine.js';

/**
 * Check if a user has Admin or Producer role for Gantt management
 */
export function isGanttAdmin(user) {
  if (!user) return false;
  const role = user.role;
  return role === 'admin' || role === 'superadmin' || role === 'producer';
}

/**
 * Append-only history logger for gantt item changes
 */
export function logGanttHistory({ ganttItemId, changedBy, fieldChanged, oldValue, newValue }) {
  try {
    execute(`
      INSERT INTO gantt_history (
        gantt_item_id, changed_by, field_changed, old_value, new_value, changed_at
      ) VALUES (
        ?, ?, ?, ?, ?, datetime('now')
      )
    `, [
      Number(ganttItemId),
      changedBy,
      fieldChanged,
      oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
      newValue !== null && newValue !== undefined ? String(newValue) : null
    ]);
  } catch (err) {
    console.error('[ganttService] Failed to log gantt history:', err.message);
  }
}

/**
 * Detect if adding a directed dependency edge (predId -> succId) creates a cycle
 * Returns true if adding edge predId -> succId would create a cycle (i.e. succId can already reach predId)
 */
export function wouldCreateGanttCycle(predecessorId, successorId) {
  const predId = Number(predecessorId);
  const succId = Number(successorId);

  if (predId === succId) return true;

  // Active dependencies (excluding soft-removed reversal records)
  const deps = queryAll(`
    SELECT predecessor_item_id, successor_item_id
    FROM gantt_dependencies
    WHERE id NOT IN (
      SELECT CAST(old_value AS INTEGER) FROM gantt_history WHERE field_changed = 'dependency_removed'
    )
  `);

  const adj = new Map();
  for (const dep of deps) {
    const u = Number(dep.predecessor_item_id);
    const v = Number(dep.successor_item_id);
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u).push(v);
  }

  // BFS search starting from succId: can we reach predId?
  const queue = [succId];
  const visited = new Set();

  while (queue.length > 0) {
    const curr = queue.shift();
    if (curr === predId) {
      return true; // Cycle detected: succ can already reach pred!
    }
    if (visited.has(curr)) continue;
    visited.add(curr);

    const neighbors = adj.get(curr) || [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return false;
}

// ===================================================================
// GANTT ITEM CRUD & PROGRESS
// ===================================================================

/**
 * Create a new Gantt timeline item
 * Role: Admin+
 */
export function createItem(data, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to create timeline items');
    err.status = 403;
    throw err;
  }

  const {
    project_id,
    projectId,
    title,
    description = null,
    type = 'TASK',
    assigned_to = null,
    assignedTo = null,
    start_date,
    startDate,
    end_date,
    endDate,
    progress_pct = 0.0,
    progressPct = 0.0,
    color = '#4A90E2',
    parent_item_id = null,
    parentItemId = null,
    sprint_id = null,
    sprintId = null,
    backlog_item_id = null,
    backlogItemId = null,
    position = 0,
    status = 'NOT_STARTED'
  } = data || {};

  const targetProjectId = project_id || projectId;
  if (!targetProjectId) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }

  // Verify project exists
  const project = queryOne('SELECT id FROM projects WHERE id = ?', [targetProjectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  if (!title || !String(title).trim()) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }

  const itemStart = String(start_date || startDate || '').trim();
  let itemEnd = String(end_date || endDate || '').trim();

  if (!itemStart) {
    const err = new Error('start_date is required');
    err.status = 400;
    throw err;
  }

  const itemType = (type || 'TASK').toUpperCase();
  const validTypes = ['TASK', 'MILESTONE', 'PHASE', 'EPIC'];
  if (!validTypes.includes(itemType)) {
    const err = new Error(`type must be one of: ${validTypes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  // Rule 2: MILESTONE type must have start_date = end_date (single point in time)
  if (itemType === 'MILESTONE') {
    if (!itemEnd) {
      itemEnd = itemStart;
    } else if (itemEnd !== itemStart) {
      const err = new Error('MILESTONE type must have start_date equal to end_date');
      err.status = 400;
      throw err;
    }
  } else {
    if (!itemEnd) {
      itemEnd = itemStart;
    }
  }

  // Rule 1: end_date must always be >= start_date
  if (itemEnd < itemStart) {
    const err = new Error('end_date must be greater than or equal to start_date');
    err.status = 400;
    throw err;
  }

  const initialProgress = Number(progress_pct || progressPct || 0.0);
  if (isNaN(initialProgress) || initialProgress < 0 || initialProgress > 100) {
    const err = new Error('progress_pct must be between 0 and 100');
    err.status = 400;
    throw err;
  }

  const targetAssignee = assigned_to || assignedTo || null;
  if (targetAssignee) {
    const assigneeRow = queryOne('SELECT id FROM users WHERE id = ?', [targetAssignee]);
    if (!assigneeRow) {
      const err = new Error('assigned_to user not found');
      err.status = 404;
      throw err;
    }
  }

  const targetParent = parent_item_id || parentItemId || null;
  if (targetParent) {
    const parentRow = queryOne('SELECT id, project_id FROM gantt_items WHERE id = ?', [targetParent]);
    if (!parentRow) {
      const err = new Error('parent_item_id not found');
      err.status = 404;
      throw err;
    }
    if (String(parentRow.project_id) !== String(targetProjectId)) {
      const err = new Error('parent_item_id must belong to the same project');
      err.status = 400;
      throw err;
    }
  }

  const initialStatus = initialProgress >= 100 ? 'COMPLETED' : (status || 'NOT_STARTED');

  const res = execute(`
    INSERT INTO gantt_items (
      project_id, sprint_id, backlog_item_id, title, description,
      type, assigned_to, start_date, end_date, progress_pct,
      color, parent_item_id, position, status, created_by,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      datetime('now'), datetime('now')
    )
  `, [
    targetProjectId,
    sprint_id || sprintId || null,
    backlog_item_id || backlogItemId || null,
    String(title).trim(),
    description ? String(description).trim() : null,
    itemType,
    targetAssignee,
    itemStart,
    itemEnd,
    initialProgress,
    color || '#4A90E2',
    targetParent ? Number(targetParent) : null,
    Number(position || 0),
    initialStatus,
    user.id
  ]);

  const newItemId = Number(res.lastInsertRowid);

  // Auto-log initial creation to gantt_history
  logGanttHistory({
    ganttItemId: newItemId,
    changedBy: user.id,
    fieldChanged: 'created',
    oldValue: null,
    newValue: `Created ${itemType}: ${title}`
  });

  return queryOne('SELECT * FROM gantt_items WHERE id = ?', [newItemId]);
}

/**
 * Retrieve all items, dependencies, milestones, and baselines for a project
 * Role: All members
 */
export function getProjectGantt(projectId, user) {
  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const items = queryAll(`
    SELECT g.*, 
           u.name AS assignee_name,
           u.email AS assignee_email
    FROM gantt_items g
    LEFT JOIN users u ON g.assigned_to = u.id
    WHERE g.project_id = ?
    ORDER BY g.position ASC, g.start_date ASC
  `, [projectId]);

  const dependencies = queryAll(`
    SELECT d.*,
           p.title AS predecessor_title,
           s.title AS successor_title
    FROM gantt_dependencies d
    JOIN gantt_items p ON d.predecessor_item_id = p.id
    JOIN gantt_items s ON d.successor_item_id = s.id
    WHERE d.project_id = ?
      AND d.id NOT IN (
        SELECT CAST(old_value AS INTEGER) FROM gantt_history WHERE field_changed = 'dependency_removed'
      )
    ORDER BY d.created_at ASC
  `, [projectId]);

  const milestones = queryAll(`
    SELECT m.*
    FROM gantt_milestones m
    WHERE m.project_id = ?
    ORDER BY m.milestone_date ASC
  `, [projectId]);

  const baselines = queryAll(`
    SELECT b.*
    FROM gantt_baselines b
    WHERE b.project_id = ?
    ORDER BY b.snapshot_taken_at DESC
  `, [projectId]);

  return {
    project_id: projectId,
    project_title: project.title,
    items,
    dependencies,
    milestones,
    baselines
  };
}

/**
 * Get detailed gantt item by ID with dependencies and history
 * Role: All members
 */
export function getItemDetail(itemId, user) {
  const item = queryOne(`
    SELECT g.*,
           u.name AS assignee_name,
           u.email AS assignee_email,
           c.name AS creator_name
    FROM gantt_items g
    LEFT JOIN users u ON g.assigned_to = u.id
    LEFT JOIN users c ON g.created_by = c.id
    WHERE g.id = ?
  `, [itemId]);

  if (!item) {
    const err = new Error('Gantt item not found');
    err.status = 404;
    throw err;
  }

  const dependencies = queryAll(`
    SELECT d.*,
           p.title AS predecessor_title,
           s.title AS successor_title
    FROM gantt_dependencies d
    JOIN gantt_items p ON d.predecessor_item_id = p.id
    JOIN gantt_items s ON d.successor_item_id = s.id
    WHERE (d.predecessor_item_id = ? OR d.successor_item_id = ?)
      AND d.id NOT IN (
        SELECT CAST(old_value AS INTEGER) FROM gantt_history WHERE field_changed = 'dependency_removed'
      )
  `, [itemId, itemId]);

  const history = queryAll(`
    SELECT h.*, u.name AS changed_by_name
    FROM gantt_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.gantt_item_id = ?
    ORDER BY h.changed_at DESC
  `, [itemId]);

  return {
    ...item,
    dependencies,
    history
  };
}

/**
 * Update any editable field on a gantt item
 * Role: Admin+ or Assignee (Assignee restricted to progress_pct only)
 */
export function updateItem(itemId, updates, user) {
  const item = queryOne('SELECT * FROM gantt_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Gantt item not found');
    err.status = 404;
    throw err;
  }

  const isAdmin = isGanttAdmin(user);
  const isAssignee = item.assigned_to && String(item.assigned_to) === String(user.id);

  if (!isAdmin && !isAssignee) {
    const err = new Error('Forbidden: You do not have permission to edit this item');
    err.status = 403;
    throw err;
  }

  // If user is NOT admin (only assignee), they are restricted to progress_pct updates
  if (!isAdmin && isAssignee) {
    const restrictedKeys = Object.keys(updates).filter(
      k => !['progress_pct', 'progressPct'].includes(k)
    );
    if (restrictedKeys.length > 0) {
      const err = new Error('Forbidden: Assignees can only update progress percentage');
      err.status = 403;
      throw err;
    }
  }

  const warnings = [];

  // 1. Date adjustments
  let newStart = item.start_date;
  let newEnd = item.end_date;

  if (updates.start_date !== undefined || updates.startDate !== undefined) {
    newStart = String(updates.start_date || updates.startDate).trim();
  }
  if (updates.end_date !== undefined || updates.endDate !== undefined) {
    newEnd = String(updates.end_date || updates.endDate).trim();
  }

  const effectiveType = updates.type || item.type;
  if (effectiveType === 'MILESTONE') {
    if (updates.start_date && !updates.end_date) {
      newEnd = newStart;
    } else if (updates.end_date && !updates.start_date) {
      newStart = newEnd;
    } else if (newStart !== newEnd) {
      const err = new Error('MILESTONE type must have start_date equal to end_date');
      err.status = 400;
      throw err;
    }
  }

  if (newEnd < newStart) {
    const err = new Error('end_date must be greater than or equal to start_date');
    err.status = 400;
    throw err;
  }

  // Rule 4: If predecessor end_date changes, warn about potential successor date conflict
  if (newEnd !== item.end_date) {
    const successorDeps = queryAll(`
      SELECT d.*, s.title, s.start_date
      FROM gantt_dependencies d
      JOIN gantt_items s ON d.successor_item_id = s.id
      WHERE d.predecessor_item_id = ?
        AND d.dependency_type = 'FINISH_TO_START'
        AND d.id NOT IN (
          SELECT CAST(old_value AS INTEGER) FROM gantt_history WHERE field_changed = 'dependency_removed'
        )
    `, [itemId]);

    for (const dep of successorDeps) {
      // Check if successor start date is earlier than predecessor newEnd + lagDays
      if (dep.start_date < newEnd) {
        warnings.push(
          `Date conflict warning: Successor item "${dep.title}" starts on ${dep.start_date}, which is earlier than updated predecessor end date ${newEnd} (lag: ${dep.lag_days}d).`
        );
      }
    }
  }

  // 2. Progress percentage
  let newProgress = item.progress_pct;
  if (updates.progress_pct !== undefined || updates.progressPct !== undefined) {
    const pVal = Number(updates.progress_pct ?? updates.progressPct);
    if (isNaN(pVal) || pVal < 0 || pVal > 100) {
      const err = new Error('progress_pct must be between 0 and 100');
      err.status = 400;
      throw err;
    }
    newProgress = pVal;
  }

  // 3. Status
  let newStatus = updates.status !== undefined ? updates.status : item.status;
  if (newProgress === 100) {
    newStatus = 'COMPLETED';
  }

  // Build field updates and auto-log to history
  const fieldsToUpdate = {};

  if (updates.title !== undefined && updates.title !== item.title) {
    fieldsToUpdate.title = updates.title;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'title', oldValue: item.title, newValue: updates.title });
  }
  if (updates.description !== undefined && updates.description !== item.description) {
    fieldsToUpdate.description = updates.description;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'description', oldValue: item.description, newValue: updates.description });
  }
  if (newStart !== item.start_date) {
    fieldsToUpdate.start_date = newStart;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'start_date', oldValue: item.start_date, newValue: newStart });
  }
  if (newEnd !== item.end_date) {
    fieldsToUpdate.end_date = newEnd;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'end_date', oldValue: item.end_date, newValue: newEnd });
  }
  if (newProgress !== item.progress_pct) {
    fieldsToUpdate.progress_pct = newProgress;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'progress_pct', oldValue: item.progress_pct, newValue: newProgress });
  }
  if (newStatus !== item.status) {
    fieldsToUpdate.status = newStatus;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'status', oldValue: item.status, newValue: newStatus });
  }
  if (updates.color !== undefined && updates.color !== item.color) {
    fieldsToUpdate.color = updates.color;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'color', oldValue: item.color, newValue: updates.color });
  }
  if (updates.assigned_to !== undefined && updates.assigned_to !== item.assigned_to) {
    fieldsToUpdate.assigned_to = updates.assigned_to;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'assigned_to', oldValue: item.assigned_to, newValue: updates.assigned_to });
  }
  if (updates.position !== undefined && Number(updates.position) !== item.position) {
    fieldsToUpdate.position = Number(updates.position);
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'position', oldValue: item.position, newValue: updates.position });
  }
  if (updates.type !== undefined && updates.type !== item.type) {
    fieldsToUpdate.type = updates.type;
    logGanttHistory({ ganttItemId: itemId, changedBy: user.id, fieldChanged: 'type', oldValue: item.type, newValue: updates.type });
  }

  const setClauses = [];
  const setParams = [];
  for (const [col, val] of Object.entries(fieldsToUpdate)) {
    setClauses.push(`${col} = ?`);
    setParams.push(val);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = datetime('now')");
    setParams.push(itemId);
    execute(`UPDATE gantt_items SET ${setClauses.join(', ')} WHERE id = ?`, setParams);
  }

  const updatedItem = queryOne('SELECT * FROM gantt_items WHERE id = ?', [itemId]);

  if (updatedItem && (updatedItem.progress_pct === 100 || updatedItem.status === 'COMPLETED') && (item.progress_pct !== 100 && item.status !== 'COMPLETED')) {
    try {
      fireTrigger('GANTT', 'TASK_COMPLETED', 'GANTT_ITEM', itemId, user.id, {
        project_id: item.project_id,
        item: {
          id: itemId,
          title: updatedItem.title,
          status: updatedItem.status,
          progress_pct: updatedItem.progress_pct,
          project_id: item.project_id
        }
      });
    } catch (tErr) {
      console.error('[GanttService] fireTrigger error:', tErr);
    }
  }

  return {
    item: updatedItem,
    warnings
  };
}

/**
 * Quick progress update endpoint
 * Role: Assignee or Admin+
 */
export function updateProgress(itemId, progressPct, user) {
  const item = queryOne('SELECT * FROM gantt_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Gantt item not found');
    err.status = 404;
    throw err;
  }

  const isAdmin = isGanttAdmin(user);
  const isAssignee = item.assigned_to && String(item.assigned_to) === String(user.id);

  if (!isAdmin && !isAssignee) {
    const err = new Error('Forbidden: Only the assignee or an Admin can update progress');
    err.status = 403;
    throw err;
  }

  const pVal = Number(progressPct);
  if (isNaN(pVal) || pVal < 0 || pVal > 100) {
    const err = new Error('progress_pct must be between 0 and 100');
    err.status = 400;
    throw err;
  }

  const newStatus = pVal === 100 ? 'COMPLETED' : item.status;

  if (pVal !== item.progress_pct) {
    logGanttHistory({
      ganttItemId: itemId,
      changedBy: user.id,
      fieldChanged: 'progress_pct',
      oldValue: item.progress_pct,
      newValue: pVal
    });
  }

  if (newStatus !== item.status) {
    logGanttHistory({
      ganttItemId: itemId,
      changedBy: user.id,
      fieldChanged: 'status',
      oldValue: item.status,
      newValue: newStatus
    });
  }

  execute(`
    UPDATE gantt_items
    SET progress_pct = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [pVal, newStatus, itemId]);

  const updated = queryOne('SELECT * FROM gantt_items WHERE id = ?', [itemId]);

  if ((pVal === 100 || newStatus === 'COMPLETED') && (item.progress_pct !== 100 && item.status !== 'COMPLETED')) {
    try {
      fireTrigger('GANTT', 'TASK_COMPLETED', 'GANTT_ITEM', itemId, user.id, {
        project_id: item.project_id,
        item: {
          id: itemId,
          title: updated.title,
          status: updated.status,
          progress_pct: updated.progress_pct,
          project_id: item.project_id
        }
      });
    } catch (tErr) {
      console.error('[GanttService] fireTrigger error:', tErr);
    }
  }

  return updated;
}

/**
 * Delete a Gantt item
 * Rule: cannot delete if other items depend on this item
 * Role: Admin+
 */
export function deleteItem(itemId, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to delete timeline items');
    err.status = 403;
    throw err;
  }

  const item = queryOne('SELECT * FROM gantt_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Gantt item not found');
    err.status = 404;
    throw err;
  }

  // Check if other active items depend on this item (item is predecessor)
  const dependents = queryOne(`
    SELECT count(*) AS count
    FROM gantt_dependencies
    WHERE predecessor_item_id = ?
      AND id NOT IN (
        SELECT CAST(old_value AS INTEGER) FROM gantt_history WHERE field_changed = 'dependency_removed'
      )
  `, [itemId]);

  if (dependents && dependents.count > 0) {
    const err = new Error('Cannot delete item: other timeline items depend on it');
    err.status = 400;
    throw err;
  }

  const db = getDatabase();
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.prepare('DELETE FROM gantt_items WHERE id = ?').run(Number(itemId));
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  return {
    message: 'Gantt item deleted successfully',
    id: Number(itemId)
  };
}

// ===================================================================
// DEPENDENCY MANAGEMENT & DAG CYCLE DETECTION
// ===================================================================

/**
 * Add a dependency between two timeline items
 * Rule: DAG cycle detection (blocks A -> B -> C -> A)
 * Role: Admin+
 */
export function addDependency(data, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to add dependencies');
    err.status = 403;
    throw err;
  }

  const {
    project_id,
    projectId,
    predecessor_item_id,
    predecessorItemId,
    successor_item_id,
    successorItemId,
    dependency_type = 'FINISH_TO_START',
    dependencyType = 'FINISH_TO_START',
    lag_days = 0,
    lagDays = 0
  } = data || {};

  const targetProjectId = project_id || projectId;
  const predId = Number(predecessor_item_id || predecessorItemId);
  const succId = Number(successor_item_id || successorItemId);

  if (!targetProjectId) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }
  if (!predId || !succId) {
    const err = new Error('predecessor_item_id and successor_item_id are required');
    err.status = 400;
    throw err;
  }

  if (predId === succId) {
    const err = new Error('Cannot create dependency on self');
    err.status = 400;
    throw err;
  }

  // Verify both items exist and belong to the project
  const pred = queryOne('SELECT id, project_id, title FROM gantt_items WHERE id = ?', [predId]);
  const succ = queryOne('SELECT id, project_id, title FROM gantt_items WHERE id = ?', [succId]);

  if (!pred || !succ) {
    const err = new Error('Predecessor or successor item not found');
    err.status = 404;
    throw err;
  }

  if (String(pred.project_id) !== String(targetProjectId) || String(succ.project_id) !== String(targetProjectId)) {
    const err = new Error('Both items must belong to the specified project');
    err.status = 400;
    throw err;
  }

  const validDepTypes = ['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH'];
  const effectiveDepType = (dependency_type || dependencyType || 'FINISH_TO_START').toUpperCase();
  if (!validDepTypes.includes(effectiveDepType)) {
    const err = new Error(`dependency_type must be one of: ${validDepTypes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  // DAG Cycle Detection
  if (wouldCreateGanttCycle(predId, succId)) {
    const err = new Error('Circular dependency detected: adding this link creates a dependency cycle (A → B → C → A)');
    err.status = 400;
    throw err;
  }

  const effectiveLag = Math.max(0, parseInt(lag_days || lagDays || 0, 10));

  try {
    const res = execute(`
      INSERT INTO gantt_dependencies (
        project_id, predecessor_item_id, successor_item_id,
        dependency_type, lag_days, created_by, created_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, datetime('now')
      )
    `, [
      targetProjectId,
      predId,
      succId,
      effectiveDepType,
      effectiveLag,
      user.id
    ]);

    const newDepId = Number(res.lastInsertRowid);

    // Auto-log to history for both predecessor and successor
    logGanttHistory({
      ganttItemId: predId,
      changedBy: user.id,
      fieldChanged: 'dependency_added',
      oldValue: null,
      newValue: `Added dependency: Predecessor to ${succ.title} (${effectiveDepType})`
    });

    logGanttHistory({
      ganttItemId: succId,
      changedBy: user.id,
      fieldChanged: 'dependency_added',
      oldValue: null,
      newValue: `Added dependency: Successor of ${pred.title} (${effectiveDepType})`
    });

    return queryOne('SELECT * FROM gantt_dependencies WHERE id = ?', [newDepId]);
  } catch (dbErr) {
    if (dbErr.message.includes('UNIQUE constraint failed')) {
      const err = new Error('A dependency between these items already exists');
      err.status = 400;
      throw err;
    }
    throw dbErr;
  }
}

/**
 * Get all active dependencies for a project
 * Role: All members
 */
export function getProjectDependencies(projectId, user) {
  return queryAll(`
    SELECT d.*,
           p.title AS predecessor_title,
           s.title AS successor_title
    FROM gantt_dependencies d
    JOIN gantt_items p ON d.predecessor_item_id = p.id
    JOIN gantt_items s ON d.successor_item_id = s.id
    WHERE d.project_id = ?
      AND d.id NOT IN (
        SELECT CAST(old_value AS INTEGER) FROM gantt_history WHERE field_changed = 'dependency_removed'
      )
    ORDER BY d.created_at ASC
  `, [projectId]);
}

/**
 * Soft-remove a dependency by inserting a reversal audit entry (keeps append-only DB integrity)
 * Role: Admin+
 */
export function removeDependency(dependencyId, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to remove dependencies');
    err.status = 403;
    throw err;
  }

  const dep = queryOne('SELECT * FROM gantt_dependencies WHERE id = ?', [dependencyId]);
  if (!dep) {
    const err = new Error('Dependency not found');
    err.status = 404;
    throw err;
  }

  // Check if already reversed
  const alreadyRemoved = queryOne(`
    SELECT id FROM gantt_history
    WHERE field_changed = 'dependency_removed' AND CAST(old_value AS INTEGER) = ?
  `, [Number(dependencyId)]);

  if (alreadyRemoved) {
    return {
      message: 'Dependency already removed',
      id: Number(dependencyId)
    };
  }

  // Soft-remove by recording reversal in append-only gantt_history
  logGanttHistory({
    ganttItemId: dep.predecessor_item_id,
    changedBy: user.id,
    fieldChanged: 'dependency_removed',
    oldValue: String(dependencyId),
    newValue: `Reversed dependency to item ${dep.successor_item_id}`
  });

  return {
    message: 'Dependency removed successfully',
    id: Number(dependencyId)
  };
}

// ===================================================================
// MILESTONE MANAGEMENT
// ===================================================================

/**
 * Create a new milestone
 * Role: Admin+
 */
export function createMilestone(data, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to create milestones');
    err.status = 403;
    throw err;
  }

  const {
    project_id,
    projectId,
    title,
    milestone_date,
    milestoneDate,
    gantt_item_id = null,
    ganttItemId = null
  } = data || {};

  const targetProjectId = project_id || projectId;
  if (!targetProjectId) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }

  if (!title || !String(title).trim()) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }

  const targetDate = String(milestone_date || milestoneDate || '').trim();
  if (!targetDate) {
    const err = new Error('milestone_date is required');
    err.status = 400;
    throw err;
  }

  const linkedItemId = gantt_item_id || ganttItemId || null;
  if (linkedItemId) {
    const item = queryOne('SELECT id, project_id FROM gantt_items WHERE id = ?', [linkedItemId]);
    if (!item) {
      const err = new Error('Linked gantt_item not found');
      err.status = 404;
      throw err;
    }
  }

  const res = execute(`
    INSERT INTO gantt_milestones (
      project_id, gantt_item_id, title, milestone_date,
      status, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?,
      'PENDING', ?, datetime('now'), datetime('now')
    )
  `, [
    targetProjectId,
    linkedItemId ? Number(linkedItemId) : null,
    String(title).trim(),
    targetDate,
    user.id
  ]);

  const newMilestoneId = Number(res.lastInsertRowid);
  return queryOne('SELECT * FROM gantt_milestones WHERE id = ?', [newMilestoneId]);
}

/**
 * Mark a milestone as achieved
 * Role: Admin+
 */
export function achieveMilestone(milestoneId, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to achieve milestones');
    err.status = 403;
    throw err;
  }

  const milestone = queryOne('SELECT * FROM gantt_milestones WHERE id = ?', [milestoneId]);
  if (!milestone) {
    const err = new Error('Milestone not found');
    err.status = 404;
    throw err;
  }

  execute(`
    UPDATE gantt_milestones
    SET status = 'ACHIEVED', achieved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `, [milestoneId]);

  // If milestone is linked to a gantt item, mark it complete and log to history
  if (milestone.gantt_item_id) {
    execute(`
      UPDATE gantt_items
      SET progress_pct = 100.0, status = 'COMPLETED', updated_at = datetime('now')
      WHERE id = ?
    `, [milestone.gantt_item_id]);

    logGanttHistory({
      ganttItemId: milestone.gantt_item_id,
      changedBy: user.id,
      fieldChanged: 'milestone_achieved',
      oldValue: 'PENDING',
      newValue: 'ACHIEVED'
    });
  }

  return queryOne('SELECT * FROM gantt_milestones WHERE id = ?', [milestoneId]);
}

/**
 * Update an existing milestone (title, date, linked item, status)
 * Role: Admin+
 */
export function updateMilestone(milestoneId, updates, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to update milestones');
    err.status = 403;
    throw err;
  }

  const milestone = queryOne('SELECT * FROM gantt_milestones WHERE id = ?', [milestoneId]);
  if (!milestone) {
    const err = new Error('Milestone not found');
    err.status = 404;
    throw err;
  }

  const { title, milestone_date, milestoneDate, gantt_item_id, ganttItemId, status } = updates || {};
  const newTitle = title !== undefined ? String(title).trim() : milestone.title;
  const newDate = (milestone_date || milestoneDate) ? String(milestone_date || milestoneDate).trim() : milestone.milestone_date;
  const newLinkedItem = (gantt_item_id !== undefined || ganttItemId !== undefined)
    ? ((gantt_item_id || ganttItemId) ? Number(gantt_item_id || ganttItemId) : null)
    : milestone.gantt_item_id;
  const newStatus = status !== undefined ? String(status).toUpperCase() : milestone.status;

  if (!newTitle) {
    const err = new Error('title cannot be empty');
    err.status = 400;
    throw err;
  }
  if (!newDate) {
    const err = new Error('milestone_date cannot be empty');
    err.status = 400;
    throw err;
  }

  if (newLinkedItem) {
    const item = queryOne('SELECT id, project_id FROM gantt_items WHERE id = ?', [newLinkedItem]);
    if (!item) {
      const err = new Error('Linked gantt_item not found');
      err.status = 404;
      throw err;
    }
  }

  execute(`
    UPDATE gantt_milestones
    SET title = ?, milestone_date = ?, gantt_item_id = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [newTitle, newDate, newLinkedItem, newStatus, milestoneId]);

  const updatedMilestone = queryOne('SELECT * FROM gantt_milestones WHERE id = ?', [milestoneId]);

  if (newStatus === 'MISSED' && milestone.status !== 'MISSED') {
    try {
      fireTrigger('GANTT', 'MILESTONE_MISSED', 'MILESTONE', milestoneId, user.id, {
        project_id: milestone.project_id,
        milestone: {
          id: milestoneId,
          title: newTitle,
          milestone_date: newDate,
          status: 'MISSED',
          project_id: milestone.project_id
        }
      });
    } catch (tErr) {
      console.error('[GanttService] fireTrigger error:', tErr);
    }
  }

  return updatedMilestone;
}

/**
 * Delete a milestone
 * Role: Admin+
 */
export function deleteMilestone(milestoneId, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to delete milestones');
    err.status = 403;
    throw err;
  }

  const milestone = queryOne('SELECT * FROM gantt_milestones WHERE id = ?', [milestoneId]);
  if (!milestone) {
    const err = new Error('Milestone not found');
    err.status = 404;
    throw err;
  }

  execute('DELETE FROM gantt_milestones WHERE id = ?', [milestoneId]);

  return {
    message: 'Milestone deleted successfully',
    id: Number(milestoneId)
  };
}

/**
 * Get all milestones for a project (auto-marks overdue pending as MISSED)
 * Role: All members
 */
export function getProjectMilestones(projectId, user) {
  const project = queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  // Auto-mark overdue pending milestones as MISSED
  const todayStr = new Date().toISOString().split('T')[0];
  execute(`
    UPDATE gantt_milestones
    SET status = 'MISSED', updated_at = datetime('now')
    WHERE project_id = ? AND status = 'PENDING' AND milestone_date < ?
  `, [projectId, todayStr]);

  return queryAll(`
    SELECT m.*,
           i.title AS linked_item_title,
           i.status AS linked_item_status,
           i.progress_pct AS linked_item_progress_pct
    FROM gantt_milestones m
    LEFT JOIN gantt_items i ON m.gantt_item_id = i.id
    WHERE m.project_id = ?
    ORDER BY m.milestone_date ASC, m.id ASC
  `, [projectId]);
}


// ===================================================================
// GANTT HISTORY
// ===================================================================

/**
 * Get full change history for a gantt item
 * Role: Admin+
 */
export function getItemHistory(itemId, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to view item history');
    err.status = 403;
    throw err;
  }

  const item = queryOne('SELECT id FROM gantt_items WHERE id = ?', [itemId]);
  if (!item) {
    const err = new Error('Gantt item not found');
    err.status = 404;
    throw err;
  }

  return queryAll(`
    SELECT h.*, u.name AS changed_by_name
    FROM gantt_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.gantt_item_id = ?
    ORDER BY h.changed_at DESC
  `, [itemId]);
}

// ===================================================================
// LAYER 3: BASELINE SNAPSHOTS & SCHEDULE SLIP
// ===================================================================

/**
 * Helper to parse YYYY-MM-DD into a UTC date to prevent timezone discrepancies
 */
function parseDateUtc(dateStr) {
  if (!dateStr) return new Date();
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Helper to calculate day difference between two YYYY-MM-DD strings (d1 - d2)
 */
function daysDiff(d1Str, d2Str) {
  if (!d1Str || !d2Str) return 0;
  const t1 = parseDateUtc(d1Str).getTime();
  const t2 = parseDateUtc(d2Str).getTime();
  return Math.round((t1 - t2) / 86400000);
}

/**
 * Helper to add days to a YYYY-MM-DD string
 */
function addDaysToIsoDate(dateStr, numDays) {
  const dt = parseDateUtc(dateStr);
  dt.setUTCDate(dt.getUTCDate() + numDays);
  return dt.toISOString().split('T')[0];
}

/**
 * Take an append-only baseline snapshot of all current item dates for a project
 * Role: Admin+
 */
export function takeBaselineSnapshot(data, user) {
  if (!isGanttAdmin(user)) {
    const err = new Error('Forbidden: Admin role required to create baseline snapshot');
    err.status = 403;
    throw err;
  }

  const targetProjectId = data?.project_id || data?.projectId;
  if (!targetProjectId) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [targetProjectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const items = queryAll(`
    SELECT id, title, type, start_date, end_date
    FROM gantt_items
    WHERE project_id = ?
    ORDER BY position ASC, id ASC
  `, [targetProjectId]);

  if (items.length === 0) {
    return {
      message: 'No items in project to snapshot',
      project_id: targetProjectId,
      count: 0,
      baselines: []
    };
  }

  const snapshotTimestamp = new Date().toISOString();
  const insertedBaselines = [];

  for (const item of items) {
    const res = execute(`
      INSERT INTO gantt_baselines (
        project_id, gantt_item_id, baseline_start_date, baseline_end_date,
        snapshot_taken_by, snapshot_taken_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?
      )
    `, [
      targetProjectId,
      item.id,
      item.start_date,
      item.end_date,
      user.id,
      snapshotTimestamp
    ]);

    insertedBaselines.push({
      id: Number(res.lastInsertRowid),
      project_id: targetProjectId,
      gantt_item_id: item.id,
      item_title: item.title,
      item_type: item.type,
      baseline_start_date: item.start_date,
      baseline_end_date: item.end_date,
      snapshot_taken_by: user.id,
      snapshot_taken_at: snapshotTimestamp
    });

    logGanttHistory({
      ganttItemId: item.id,
      changedBy: user.id,
      fieldChanged: 'baseline_snapshot',
      oldValue: null,
      newValue: `Baseline snapshot created at ${snapshotTimestamp}`
    });
  }

  return {
    message: 'Baseline snapshot created successfully',
    project_id: targetProjectId,
    count: insertedBaselines.length,
    snapshot_taken_at: snapshotTimestamp,
    snapshot_taken_by: user.id,
    baselines: insertedBaselines
  };
}

/**
 * Retrieve all baseline snapshots for a project with schedule slip analysis
 * Role: All members
 */
export function getProjectBaselines(projectId, user) {
  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const rows = queryAll(`
    SELECT b.*,
           i.title AS item_title,
           i.type AS item_type,
           i.start_date AS current_start_date,
           i.end_date AS current_end_date,
           i.status AS current_status,
           i.progress_pct AS current_progress_pct,
           u.name AS snapshot_taken_by_name
    FROM gantt_baselines b
    JOIN gantt_items i ON b.gantt_item_id = i.id
    LEFT JOIN users u ON b.snapshot_taken_by = u.id
    WHERE b.project_id = ?
    ORDER BY b.snapshot_taken_at DESC, b.gantt_item_id ASC
  `, [projectId]);

  const baselines = rows.map(r => {
    const endSlip = daysDiff(r.current_end_date, r.baseline_end_date);
    const startSlip = daysDiff(r.current_start_date, r.baseline_start_date);
    return {
      ...r,
      slip_days: endSlip,
      start_slip_days: startSlip,
      is_delayed: endSlip > 0,
      is_ahead: endSlip < 0,
      is_on_track: endSlip === 0
    };
  });

  const snapshotsMap = new Map();
  for (const b of baselines) {
    const key = b.snapshot_taken_at;
    if (!snapshotsMap.has(key)) {
      snapshotsMap.set(key, {
        snapshot_taken_at: key,
        snapshot_taken_by: b.snapshot_taken_by,
        snapshot_taken_by_name: b.snapshot_taken_by_name,
        item_count: 0,
        delayed_count: 0
      });
    }
    const snap = snapshotsMap.get(key);
    snap.item_count += 1;
    if (b.is_delayed) snap.delayed_count += 1;
  }

  return {
    project_id: projectId,
    project_title: project.title,
    total_baselines: baselines.length,
    snapshots: Array.from(snapshotsMap.values()),
    baselines
  };
}

// ===================================================================
// LAYER 3: CRITICAL PATH METHOD (CPM) & LONGEST PATH SLACK ANALYSIS
// ===================================================================

/**
 * Server-side Critical Path Method (CPM) calculation using Topological Sort
 * and Longest-Path Slack analysis. Zero client-side computation.
 * 
 * Returns earliest_start (ES), earliest_finish (EF), latest_start (LS),
 * latest_finish (LF), and total float/slack for every item, and flags
 * critical path items (slack === 0).
 * 
 * Role: All members
 */
export function calculateCriticalPath(projectId, user) {
  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const items = queryAll(`
    SELECT id, title, type, start_date, end_date, progress_pct, status, color
    FROM gantt_items
    WHERE project_id = ?
    ORDER BY position ASC, id ASC
  `, [projectId]);

  if (items.length === 0) {
    return {
      project_id: projectId,
      project_title: project.title,
      project_duration_days: 0,
      critical_path_item_ids: [],
      critical_path_items: [],
      items: []
    };
  }

  // Active dependencies (excluding soft-removed reversal records)
  const dependencies = queryAll(`
    SELECT d.id, d.predecessor_item_id, d.successor_item_id, d.dependency_type, d.lag_days
    FROM gantt_dependencies d
    JOIN gantt_items p ON d.predecessor_item_id = p.id
    WHERE d.project_id = ?
      AND d.id NOT IN (
        SELECT CAST(old_value AS INTEGER) FROM gantt_history WHERE field_changed = 'dependency_removed'
      )
  `, [projectId]);

  // Map item details and compute intrinsic durations
  const itemMap = new Map();
  let minProjectStartDate = items[0].start_date;

  for (const it of items) {
    if (it.start_date < minProjectStartDate) {
      minProjectStartDate = it.start_date;
    }
    // Duration in inclusive calendar days (MILESTONE = 0)
    let dur = 0;
    if (it.type !== 'MILESTONE') {
      const diff = daysDiff(it.end_date, it.start_date);
      dur = Math.max(1, diff + 1);
    }
    itemMap.set(it.id, {
      ...it,
      duration_days: dur,
      planned_offset_days: Math.max(0, daysDiff(it.start_date, minProjectStartDate))
    });
  }

  // Build directed graph adjacency maps
  const succAdj = new Map(); // u -> [{ succId, type, lag }]
  const predAdj = new Map(); // v -> [{ predId, type, lag }]
  const inDegree = new Map();

  for (const it of items) {
    succAdj.set(it.id, []);
    predAdj.set(it.id, []);
    inDegree.set(it.id, 0);
  }

  for (const dep of dependencies) {
    const u = Number(dep.predecessor_item_id);
    const v = Number(dep.successor_item_id);
    if (itemMap.has(u) && itemMap.has(v)) {
      const edge = {
        successor_id: v,
        predecessor_id: u,
        dependency_type: dep.dependency_type || 'FINISH_TO_START',
        lag_days: Number(dep.lag_days || 0)
      };
      succAdj.get(u).push(edge);
      predAdj.get(v).push(edge);
      inDegree.set(v, inDegree.get(v) + 1);
    }
  }

  // Step 1: Topological Sort (Kahn's Algorithm)
  const topoOrder = [];
  const queue = [];
  const inDegreeCopy = new Map(inDegree);

  for (const [id, deg] of inDegreeCopy.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift();
    topoOrder.push(curr);

    const edges = succAdj.get(curr) || [];
    for (const edge of edges) {
      const nextId = edge.successor_id;
      const newDeg = inDegreeCopy.get(nextId) - 1;
      inDegreeCopy.set(nextId, newDeg);
      if (newDeg === 0) {
        queue.push(nextId);
      }
    }
  }

  // Fallback: If any disconnected or unvisited items exist, append them
  if (topoOrder.length < items.length) {
    for (const it of items) {
      if (!topoOrder.includes(it.id)) {
        topoOrder.push(it.id);
      }
    }
  }

  // Step 2: Forward Pass (Compute Earliest Start ES and Earliest Finish EF)
  const ES = new Map();
  const EF = new Map();

  for (const id of topoOrder) {
    const it = itemMap.get(id);
    // Unconstrained tasks start at their planned schedule offset or day 0
    let earliestStart = it.planned_offset_days;

    const incoming = predAdj.get(id) || [];
    for (const edge of incoming) {
      const predId = edge.predecessor_id;
      const predEF = EF.get(predId) !== undefined ? EF.get(predId) : 0;
      const predES = ES.get(predId) !== undefined ? ES.get(predId) : 0;
      const lag = edge.lag_days;

      switch (edge.dependency_type) {
        case 'START_TO_START':
          earliestStart = Math.max(earliestStart, predES + lag);
          break;
        case 'FINISH_TO_FINISH':
          earliestStart = Math.max(earliestStart, predEF + lag - it.duration_days);
          break;
        case 'START_TO_FINISH':
          earliestStart = Math.max(earliestStart, predES + lag - it.duration_days);
          break;
        case 'FINISH_TO_START':
        default:
          earliestStart = Math.max(earliestStart, predEF + lag);
          break;
      }
    }

    earliestStart = Math.max(0, earliestStart);
    ES.set(id, earliestStart);
    EF.set(id, earliestStart + it.duration_days);
  }

  // Overall project duration / makespan
  let projectDurationDays = 0;
  for (const finish of EF.values()) {
    if (finish > projectDurationDays) {
      projectDurationDays = finish;
    }
  }

  // Step 3: Backward Pass (Compute Latest Finish LF and Latest Start LS)
  const LF = new Map();
  const LS = new Map();

  for (const it of items) {
    const dur = itemMap.get(it.id).duration_days;
    LF.set(it.id, projectDurationDays);
    LS.set(it.id, projectDurationDays - dur);
  }

  // Traverse in reverse topological order
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const it = itemMap.get(id);
    const outgoing = succAdj.get(id) || [];

    let latestFinish = LF.get(id);

    // If node has successors, its latest finish/start is constrained by them
    if (outgoing.length > 0) {
      let constrainedFinish = Infinity;

      for (const edge of outgoing) {
        const succId = edge.successor_id;
        const succLS = LS.get(succId) !== undefined ? LS.get(succId) : projectDurationDays;
        const succLF = LF.get(succId) !== undefined ? LF.get(succId) : projectDurationDays;
        const lag = edge.lag_days;

        switch (edge.dependency_type) {
          case 'START_TO_START':
            constrainedFinish = Math.min(constrainedFinish, succLS - lag + it.duration_days);
            break;
          case 'FINISH_TO_FINISH':
            constrainedFinish = Math.min(constrainedFinish, succLF - lag);
            break;
          case 'START_TO_FINISH':
            constrainedFinish = Math.min(constrainedFinish, succLF - lag + it.duration_days);
            break;
          case 'FINISH_TO_START':
          default:
            constrainedFinish = Math.min(constrainedFinish, succLS - lag);
            break;
        }
      }

      if (constrainedFinish !== Infinity) {
        latestFinish = Math.min(latestFinish, constrainedFinish);
      }
    }

    LF.set(id, latestFinish);
    LS.set(id, latestFinish - it.duration_days);
  }

  // Step 4: Calculate Float/Slack and Flag Critical Path Items
  const computedItems = items.map(it => {
    const id = it.id;
    const dur = itemMap.get(id).duration_days;
    const es = ES.get(id) || 0;
    const ef = EF.get(id) || 0;
    const ls = LS.get(id) !== undefined ? LS.get(id) : es;
    const lf = LF.get(id) !== undefined ? LF.get(id) : ef;

    // Total Float / Slack = LS - ES (or LF - EF)
    const floatSlack = Math.max(0, ls - es);
    const isCritical = floatSlack === 0;

    const calES = addDaysToIsoDate(minProjectStartDate, es);
    const calEF = addDaysToIsoDate(minProjectStartDate, Math.max(es, ef - (dur > 0 ? 1 : 0)));
    const calLS = addDaysToIsoDate(minProjectStartDate, ls);
    const calLF = addDaysToIsoDate(minProjectStartDate, Math.max(ls, lf - (dur > 0 ? 1 : 0)));

    return {
      id: it.id,
      title: it.title,
      type: it.type,
      status: it.status,
      progress_pct: it.progress_pct,
      color: it.color,
      duration_days: dur,
      earliest_start: es,
      earliest_finish: ef,
      latest_start: ls,
      latest_finish: lf,
      slack: floatSlack,
      float: floatSlack,
      is_critical: isCritical,
      calendar_earliest_start: calES,
      calendar_earliest_finish: calEF,
      calendar_latest_start: calLS,
      calendar_latest_finish: calLF
    };
  });

  const criticalPathItems = computedItems.filter(it => it.is_critical);
  const criticalPathItemIds = criticalPathItems.map(it => it.id);

  return {
    project_id: projectId,
    project_title: project.title,
    project_duration_days: projectDurationDays,
    critical_path_item_ids: criticalPathItemIds,
    critical_path_items: criticalPathItems,
    items: computedItems
  };
}

// ===================================================================
// LAYER 3: GANTT EXPORT BUNDLE
// ===================================================================

/**
 * Export complete project Gantt chart bundle formatted for frontend export
 * Role: All members
 */
export function exportProjectGantt(projectId, user) {
  const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const ganttData = getProjectGantt(projectId, user);
  const criticalPath = calculateCriticalPath(projectId, user);
  const baselines = getProjectBaselines(projectId, user);

  return {
    export_format: 'JSON',
    version: '1.0',
    exported_at: new Date().toISOString(),
    exported_by: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    },
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
      start_date: project.start_date,
      end_date: project.end_date
    },
    items: ganttData.items,
    dependencies: ganttData.dependencies,
    milestones: ganttData.milestones,
    baselines: baselines.baselines,
    baseline_snapshots: baselines.snapshots,
    critical_path: {
      project_duration_days: criticalPath.project_duration_days,
      critical_path_item_ids: criticalPath.critical_path_item_ids,
      critical_path_items: criticalPath.critical_path_items,
      all_cpm_items: criticalPath.items
    }
  };
}

