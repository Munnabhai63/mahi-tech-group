import { queryOne, queryAll, execute } from '../db/database.js';
import { fireTrigger } from './automationEngine.js';

/**
 * Helper to verify if user has Admin or Lead permissions for a sprint / project
 */
export function isSprintAdmin(userId, projectId = null) {
  if (!userId) return false;
  const user = queryOne('SELECT id, role, sub_role FROM users WHERE id = ?', [userId]);
  if (!user) return false;

  // Superadmin or Admin global role
  if (user.role === 'superadmin' || user.role === 'admin') {
    return true;
  }

  // Global Lead role
  if (user.role === 'lead' || user.sub_role === 'lead') {
    return true;
  }

  // Project-level Lead or Owner
  if (projectId) {
    const project = queryOne('SELECT id, owner_id FROM projects WHERE id = ?', [projectId]);
    if (project && project.owner_id === userId) {
      return true;
    }

    const pm = queryOne(
      'SELECT role_in_project FROM project_members WHERE project_id = ? AND user_id = ?',
      [projectId, userId]
    );
    if (pm && ['admin', 'lead', 'admin_reviewer'].includes(pm.role_in_project)) {
      return true;
    }
  }

  return false;
}

/**
 * 1. Create a new sprint (status: DRAFT)
 * Role: Admin+
 */
export function createSprint({ project_id, name, goal = null, start_date = null, end_date = null, userId }) {
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

  if (!isSprintAdmin(userId, project_id)) {
    const err = new Error('Forbidden: Admin or Lead role required to create sprints');
    err.status = 403;
    throw err;
  }

  if (!name || !name.trim()) {
    const err = new Error('Sprint name is required');
    err.status = 400;
    throw err;
  }

  const cleanName = name.trim();
  const cleanGoal = goal && goal.trim() ? goal.trim() : null;

  if (start_date && end_date) {
    const s = new Date(start_date);
    const e = new Date(end_date);
    if (s > e) {
      const err = new Error('End date must be on or after start date');
      err.status = 400;
      throw err;
    }
  }

  const result = execute(`
    INSERT INTO sprints (
      project_id, name, goal, status, start_date, end_date, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, 'DRAFT', ?, ?, ?, datetime('now'), datetime('now')
    )
  `, [project_id, cleanName, cleanGoal, start_date || null, end_date || null, userId]);

  const sprintId = Number(result.lastInsertRowid);

  return queryOne(`
    SELECT s.*, u.name as creator_name, p.title as project_name
    FROM sprints s
    JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.id = ?
  `, [sprintId]);
}

/**
 * 2. Get all sprints for a project with item counts and story point stats
 * Role: All authenticated users
 */
export function getProjectSprints(projectId, userId = null) {
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

  const rows = queryAll(`
    SELECT 
      s.*,
      u.name as creator_name,
      COUNT(bi.id) as item_count,
      COALESCE(SUM(bi.story_points), 0) as total_story_points,
      COALESCE(SUM(CASE WHEN bi.status = 'DONE' THEN bi.story_points ELSE 0 END), 0) as completed_story_points
    FROM sprints s
    LEFT JOIN users u ON s.created_by = u.id
    LEFT JOIN backlog_items bi ON bi.sprint_id = s.id
    WHERE s.project_id = ?
    GROUP BY s.id
    ORDER BY s.id DESC
  `, [projectId]);

  return rows.map(row => ({
    ...row,
    item_count: Number(row.item_count) || 0,
    total_story_points: Number(row.total_story_points) || 0,
    completed_story_points: Number(row.completed_story_points) || 0,
    completion_rate: (Number(row.total_story_points) || 0) > 0
      ? Math.round(((Number(row.completed_story_points) || 0) / Number(row.total_story_points)) * 10000) / 100
      : 0.0
  }));
}

/**
 * 3. Get sprint detail along with its backlog items
 * Role: All authenticated users
 */
export function getSprintDetail(sprintId, userId = null) {
  if (!sprintId) {
    const err = new Error('Sprint ID is required');
    err.status = 400;
    throw err;
  }

  const sprint = queryOne(`
    SELECT s.*, u.name as creator_name, p.title as project_name
    FROM sprints s
    JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.id = ?
  `, [sprintId]);

  if (!sprint) {
    const err = new Error('Sprint not found');
    err.status = 404;
    throw err;
  }

  const items = queryAll(`
    SELECT bi.*, u.name as assignee_name
    FROM backlog_items bi
    LEFT JOIN users u ON bi.assigned_to = u.id
    WHERE bi.sprint_id = ?
    ORDER BY bi.position ASC, bi.id ASC
  `, [sprintId]);

  const itemCount = items.length;
  const totalPoints = items.reduce((sum, it) => sum + (Number(it.story_points) || 0), 0);
  const completedPoints = items
    .filter(it => it.status === 'DONE')
    .reduce((sum, it) => sum + (Number(it.story_points) || 0), 0);
  const completionRate = totalPoints > 0
    ? Math.round((completedPoints / totalPoints) * 10000) / 100
    : (completedPoints > 0 ? 100.0 : 0.0);

  return {
    ...sprint,
    item_count: itemCount,
    total_story_points: totalPoints,
    completed_story_points: completedPoints,
    completion_rate: completionRate,
    items
  };
}

/**
 * 4. Update sprint details (name, goal, dates)
 * Role: Admin+
 */
export function updateSprint(sprintId, { name, goal, start_date, end_date }, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const sprint = queryOne('SELECT * FROM sprints WHERE id = ?', [sprintId]);
  if (!sprint) {
    const err = new Error('Sprint not found');
    err.status = 404;
    throw err;
  }

  if (!isSprintAdmin(userId, sprint.project_id)) {
    const err = new Error('Forbidden: Admin or Lead role required to update sprint');
    err.status = 403;
    throw err;
  }

  if (sprint.status === 'COMPLETED') {
    const err = new Error('Cannot modify a completed sprint');
    err.status = 400;
    throw err;
  }

  if (sprint.status === 'CANCELLED') {
    const err = new Error('Cannot modify a cancelled sprint');
    err.status = 400;
    throw err;
  }

  const newStart = start_date !== undefined ? start_date : sprint.start_date;
  const newEnd = end_date !== undefined ? end_date : sprint.end_date;

  if (newStart && newEnd) {
    const s = new Date(newStart);
    const e = new Date(newEnd);
    if (s > e) {
      const err = new Error('End date must be on or after start date');
      err.status = 400;
      throw err;
    }
  }

  const newName = name !== undefined ? (name.trim() || sprint.name) : sprint.name;
  const newGoal = goal !== undefined ? (goal ? goal.trim() : null) : sprint.goal;

  execute(`
    UPDATE sprints
    SET name = ?,
        goal = ?,
        start_date = ?,
        end_date = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [newName, newGoal, newStart, newEnd, sprintId]);

  return getSprintDetail(sprintId, userId);
}

/**
 * 5. Start a sprint (DRAFT -> ACTIVE)
 * Rule: Project must have no other ACTIVE sprint
 * Role: Admin+
 */
export function startSprint(sprintId, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const sprint = queryOne('SELECT * FROM sprints WHERE id = ?', [sprintId]);
  if (!sprint) {
    const err = new Error('Sprint not found');
    err.status = 404;
    throw err;
  }

  if (!isSprintAdmin(userId, sprint.project_id)) {
    const err = new Error('Forbidden: Admin or Lead role required to start sprint');
    err.status = 403;
    throw err;
  }

  if (sprint.status === 'ACTIVE') {
    const err = new Error('Sprint is already ACTIVE');
    err.status = 400;
    throw err;
  }

  if (sprint.status !== 'DRAFT') {
    const err = new Error(`Cannot start sprint with status '${sprint.status}'. Only DRAFT sprints can be started.`);
    err.status = 400;
    throw err;
  }

  // Non-negotiable rule 1: One Active Sprint Per Project
  const activeSprint = queryOne(
    "SELECT id, name FROM sprints WHERE project_id = ? AND status = 'ACTIVE' AND id != ?",
    [sprint.project_id, sprintId]
  );
  if (activeSprint) {
    const err = new Error(
      `Cannot start sprint: Project already has an active sprint "${activeSprint.name}" (ID ${activeSprint.id}). Only one sprint per project can be active at a time.`
    );
    err.status = 400;
    throw err;
  }

  execute(`
    UPDATE sprints
    SET status = 'ACTIVE',
        start_date = COALESCE(start_date, date('now')),
        updated_at = datetime('now')
    WHERE id = ?
  `, [sprintId]);

  const detail = getSprintDetail(sprintId, userId);
  try {
    fireTrigger('SPRINT', 'SPRINT_STARTED', 'SPRINT', sprintId, userId, {
      project_id: sprint.project_id,
      sprint: {
        id: sprintId,
        name: sprint.name,
        goal: sprint.goal,
        project_id: sprint.project_id,
        status: 'ACTIVE'
      }
    });
  } catch (tErr) {
    console.error('[SprintService] fireTrigger error:', tErr);
  }

  return detail;
}

/**
 * 6. Complete a sprint (ACTIVE -> COMPLETED)
 * Rule: Automatically log to sprint_velocity_log
 * Role: Admin+
 */
export function completeSprint(sprintId, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const sprint = queryOne('SELECT * FROM sprints WHERE id = ?', [sprintId]);
  if (!sprint) {
    const err = new Error('Sprint not found');
    err.status = 404;
    throw err;
  }

  if (!isSprintAdmin(userId, sprint.project_id)) {
    const err = new Error('Forbidden: Admin or Lead role required to complete sprint');
    err.status = 403;
    throw err;
  }

  if (sprint.status === 'COMPLETED') {
    const err = new Error('Sprint is already COMPLETED');
    err.status = 400;
    throw err;
  }

  if (sprint.status !== 'ACTIVE') {
    const err = new Error(`Cannot complete sprint with status '${sprint.status}'. Only ACTIVE sprints can be completed.`);
    err.status = 400;
    throw err;
  }

  // Calculate story points in sprint
  const stats = queryOne(`
    SELECT 
      COALESCE(SUM(story_points), 0) as total_committed,
      COALESCE(SUM(CASE WHEN status = 'DONE' THEN story_points ELSE 0 END), 0) as total_completed
    FROM backlog_items
    WHERE sprint_id = ?
  `, [sprintId]);

  const committed = Number(stats?.total_committed) || 0;
  const completed = Number(stats?.total_completed) || 0;
  const rate = committed > 0
    ? Math.round((completed / committed) * 10000) / 100
    : (completed > 0 ? 100.0 : 0.0);

  // Update sprint status
  execute(`
    UPDATE sprints
    SET status = 'COMPLETED',
        end_date = COALESCE(end_date, date('now')),
        updated_at = datetime('now')
    WHERE id = ?
  `, [sprintId]);

  // Non-negotiable rule 2: Velocity Auto-Log on complete into sprint_velocity_log
  const logResult = execute(`
    INSERT INTO sprint_velocity_log (
      sprint_id, project_id, total_points_committed, total_points_completed, completion_rate, logged_at
    ) VALUES (
      ?, ?, ?, ?, ?, datetime('now')
    )
  `, [sprintId, sprint.project_id, committed, completed, rate]);

  const velocityLog = queryOne('SELECT * FROM sprint_velocity_log WHERE id = ?', [Number(logResult.lastInsertRowid)]);
  const updatedSprint = getSprintDetail(sprintId, userId);

  try {
    fireTrigger('SPRINT', 'SPRINT_COMPLETED', 'SPRINT', sprintId, userId, {
      project_id: sprint.project_id,
      sprint: {
        id: sprintId,
        name: sprint.name,
        goal: sprint.goal,
        project_id: sprint.project_id,
        status: 'COMPLETED',
        committed_points: committed,
        completed_points: completed,
        completion_rate: rate
      }
    });
  } catch (tErr) {
    console.error('[SprintService] fireTrigger error:', tErr);
  }

  return {
    sprint: updatedSprint,
    velocity_log: velocityLog
  };
}

/**
 * 7. Delete a sprint
 * Rule: Only DRAFT sprints can be deleted (Rule 6)
 * Role: Admin+
 */
export function deleteSprint(sprintId, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const sprint = queryOne('SELECT * FROM sprints WHERE id = ?', [sprintId]);
  if (!sprint) {
    const err = new Error('Sprint not found');
    err.status = 404;
    throw err;
  }

  if (!isSprintAdmin(userId, sprint.project_id)) {
    const err = new Error('Forbidden: Admin or Lead role required to delete sprint');
    err.status = 403;
    throw err;
  }

  // Non-negotiable rule 6: only DRAFT sprints deletable
  if (sprint.status !== 'DRAFT') {
    const err = new Error(`Cannot delete sprint with status '${sprint.status}'. Only DRAFT sprints can be deleted.`);
    err.status = 400;
    throw err;
  }

  // Release any items assigned to this draft sprint back to backlog
  execute(`
    UPDATE backlog_items 
    SET sprint_id = NULL, updated_at = datetime('now') 
    WHERE sprint_id = ?
  `, [sprintId]);

  // Remove any sprint members
  execute('DELETE FROM sprint_members WHERE sprint_id = ?', [sprintId]);

  // Delete the sprint
  execute('DELETE FROM sprints WHERE id = ?', [sprintId]);

  return {
    success: true,
    message: 'Sprint deleted successfully',
    id: Number(sprintId)
  };
}

/**
 * Helper to parse a date string safely to YYYY-MM-DD
 */
function parseDateStr(val, fallbackDate = new Date()) {
  if (!val) {
    return fallbackDate.toISOString().slice(0, 10);
  }
  const match = String(val).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return fallbackDate.toISOString().slice(0, 10);
}

/**
 * Helper to generate array of date strings between start and end (inclusive)
 */
function generateDateRange(startStr, endStr) {
  const dates = [];
  let curr = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');

  if (curr > end) {
    dates.push(startStr);
    return dates;
  }

  let count = 0;
  while (curr <= end && count < 90) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setUTCDate(curr.getUTCDate() + 1);
    count++;
  }
  return dates;
}

/**
 * 8. Get all velocity log rows for project
 * Role: All authenticated users
 */
export function getProjectVelocity(projectId, userId = null) {
  if (!projectId) {
    const err = new Error('Project ID is required');
    err.status = 400;
    throw err;
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const logs = queryAll(`
    SELECT 
      vl.*,
      s.name as sprint_name,
      s.status as sprint_status,
      s.start_date,
      s.end_date
    FROM sprint_velocity_log vl
    JOIN sprints s ON vl.sprint_id = s.id
    WHERE vl.project_id = ?
    ORDER BY vl.id ASC
  `, [projectId]);

  const totalSprints = logs.length;
  const totalCompleted = logs.reduce((sum, r) => sum + (Number(r.total_points_completed) || 0), 0);
  const totalCommitted = logs.reduce((sum, r) => sum + (Number(r.total_points_committed) || 0), 0);
  const avgVelocity = totalSprints > 0
    ? Math.round((totalCompleted / totalSprints) * 100) / 100
    : 0.0;
  const avgCompletionRate = totalCommitted > 0
    ? Math.round((totalCompleted / totalCommitted) * 10000) / 100
    : 0.0;

  return {
    project_id: projectId,
    project_title: project.title,
    total_sprints: totalSprints,
    average_velocity: avgVelocity,
    average_completion_rate: avgCompletionRate,
    velocity_log: logs.map(row => ({
      id: row.id,
      sprint_id: row.sprint_id,
      sprint_name: row.sprint_name,
      sprint_status: row.sprint_status,
      start_date: row.start_date,
      end_date: row.end_date,
      total_points_committed: Number(row.total_points_committed) || 0,
      total_points_completed: Number(row.total_points_completed) || 0,
      completion_rate: Number(row.completion_rate) || 0,
      logged_at: row.logged_at
    }))
  };
}

/**
 * 9. Get day-by-day burndown calculation for a sprint
 * Rule 4: Calculated dynamically from backlog_item_history timestamps, derived and not stored
 * Role: All authenticated users
 */
export function getSprintBurndown(sprintId, userId = null) {
  if (!sprintId) {
    const err = new Error('Sprint ID is required');
    err.status = 400;
    throw err;
  }

  const sprint = queryOne('SELECT * FROM sprints WHERE id = ?', [sprintId]);
  if (!sprint) {
    const err = new Error('Sprint not found');
    err.status = 404;
    throw err;
  }

  // Retrieve items in this sprint
  const items = queryAll(`
    SELECT id, title, story_points, status, created_at, updated_at
    FROM backlog_items
    WHERE sprint_id = ?
    ORDER BY id ASC
  `, [sprintId]);

  const totalPoints = items.reduce((sum, it) => sum + (Number(it.story_points) || 0), 0);

  // Retrieve status changes for items in this sprint
  const historyRows = queryAll(`
    SELECT bih.item_id, bih.old_value, bih.new_value, bih.changed_at
    FROM backlog_item_history bih
    JOIN backlog_items bi ON bih.item_id = bi.id
    WHERE bi.sprint_id = ? AND bih.field_changed = 'status'
    ORDER BY bih.id ASC
  `, [sprintId]);

  // Determine when each item was completed
  const processedItems = items.map(item => {
    let doneDate = null;
    if (item.status === 'DONE') {
      const doneEvent = historyRows
        .filter(h => h.item_id === item.id && h.new_value === 'DONE')
        .pop();
      if (doneEvent) {
        doneDate = parseDateStr(doneEvent.changed_at);
      } else {
        doneDate = parseDateStr(item.updated_at || item.created_at);
      }
    }
    return {
      ...item,
      story_points: Number(item.story_points) || 0,
      doneDate
    };
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const startStr = parseDateStr(sprint.start_date, new Date(sprint.created_at || Date.now()));

  // Default end date is start_date + 13 days if not specified
  let endStr;
  if (sprint.end_date) {
    endStr = parseDateStr(sprint.end_date);
  } else {
    const d = new Date(startStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 13);
    endStr = d.toISOString().slice(0, 10);
  }

  const dateList = generateDateRange(startStr, endStr);
  const totalDays = dateList.length;

  const days = dateList.map((dayStr, idx) => {
    // Ideal burndown decreases linearly from totalPoints to 0
    const idealRemaining = totalDays > 1
      ? Math.max(0, Math.round((totalPoints - (idx / (totalDays - 1)) * totalPoints) * 100) / 100)
      : 0;

    const completedUpToDay = processedItems
      .filter(it => it.doneDate && it.doneDate <= dayStr)
      .reduce((sum, it) => sum + it.story_points, 0);

    const completedOnDay = processedItems
      .filter(it => it.doneDate === dayStr)
      .reduce((sum, it) => sum + it.story_points, 0);

    let actualRemaining;
    if (sprint.status === 'ACTIVE' && dayStr > todayStr) {
      actualRemaining = null; // Future days in active sprint have not elapsed yet
    } else {
      actualRemaining = Math.max(0, totalPoints - completedUpToDay);
    }

    return {
      day: dayStr,
      day_index: idx,
      ideal_remaining: idealRemaining,
      actual_remaining: actualRemaining,
      points_completed: completedOnDay,
      total_completed_to_date: completedUpToDay
    };
  });

  const currentCompleted = processedItems
    .filter(it => it.status === 'DONE')
    .reduce((sum, it) => sum + it.story_points, 0);
  const currentRemaining = Math.max(0, totalPoints - currentCompleted);

  return {
    sprint_id: sprint.id,
    sprint_name: sprint.name,
    sprint_status: sprint.status,
    start_date: startStr,
    end_date: endStr,
    total_story_points: totalPoints,
    completed_story_points: currentCompleted,
    remaining_story_points: currentRemaining,
    days
  };
}
