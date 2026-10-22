import crypto from 'node:crypto';
import { queryOne, queryAll, execute, execRaw } from '../db/database.js';
import { logAccess } from './auditService.js';

/**
 * Workload-Based Member Selection:
 * 1. Least active assigned tasks (status != 'DONE')
 * 2. Highest rating_avg tiebreaker
 * 3. Oldest creation date tiebreaker
 */
export function getAvailableMember(role, subRole = null, excludeUserIds = []) {
  let baseQuery = `
    SELECT u.id, u.name, u.email, u.role, u.sub_role, u.rating_avg,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.assigned_to = u.id AND pt.status != 'DONE') as active_tasks_count
    FROM users u
    WHERE u.status = 'active' AND u.role = ?
  `;
  const baseParams = [role];

  if (excludeUserIds && excludeUserIds.length > 0) {
    const placeholders = excludeUserIds.map(() => '?').join(',');
    baseQuery += ` AND u.id NOT IN (${placeholders})`;
    baseParams.push(...excludeUserIds);
  }

  if (subRole) {
    const subQuery = baseQuery + ' AND (u.sub_role = ? OR u.sub_role IS NULL) ORDER BY active_tasks_count ASC, u.rating_avg DESC, u.created_at ASC LIMIT 1';
    const subParams = [...baseParams, subRole];
    const candidate = queryOne(subQuery, subParams);
    if (candidate) return candidate;
  }

  const query = baseQuery + ' ORDER BY active_tasks_count ASC, u.rating_avg DESC, u.created_at ASC LIMIT 1';
  let candidate = queryOne(query, baseParams);

  // If no candidate found and we were excluding users, fall back to allow shared assignment
  if (!candidate && excludeUserIds && excludeUserIds.length > 0) {
    return getAvailableMember(role, subRole, []);
  }

  return candidate || null;
}

/**
 * Trigger Parallel Fan-Out:
 * Executed the second an idea is APPROVED.
 * Creates project, permanently locks owner_id, starts 5-month revenue clock,
 * assigns members in parallel, and spawns the 4 zero-dependency tasks simultaneously
 * in a single atomic transaction.
 */
export function triggerProjectFanout(ideaId) {
  const existingProject = queryOne('SELECT * FROM projects WHERE idea_id = ?', [ideaId]);
  if (existingProject) {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [existingProject.id]);
    const tasks = queryAll('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY created_at ASC', [existingProject.id]);
    const members = queryAll(`
      SELECT pm.*, u.name, u.email, u.role
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ?
    `, [existingProject.id]);
    return { success: true, project, members, tasks, alreadyExisted: true };
  }

  const idea = queryOne('SELECT * FROM ideas WHERE id = ?', [ideaId]);
  if (!idea) {
    throw new Error(`Cannot trigger fanout: Idea ${ideaId} not found`);
  }

  if (idea.status !== 'APPROVED') {
    throw new Error(`Cannot trigger fanout: Idea status is '${idea.status}' (must be 'APPROVED')`);
  }

  const projectId = crypto.randomUUID();

  // 1. Workload-based member selection
  const researcher = getAvailableMember('researcher');
  const backendDev = getAvailableMember('developer', 'backend');
  const frontendDev = getAvailableMember('developer', 'frontend', backendDev ? [backendDev.id] : []);
  const producer = getAvailableMember('producer');
  const admin = queryOne("SELECT id, name, email, role FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1");

  const assignments = [
    { user: researcher, roleInProject: 'researcher' },
    { user: backendDev, roleInProject: 'backend_dev' },
    { user: frontendDev, roleInProject: 'frontend_dev' },
    { user: producer, roleInProject: 'producer' },
    { user: admin, roleInProject: 'admin_reviewer' }
  ];

  // 2. Task IDs for initial and dependent tasks
  const taskResearchId = crypto.randomUUID();
  const taskBackendId = crypto.randomUUID();
  const taskFrontendId = crypto.randomUUID();
  const taskTestingPrepId = crypto.randomUUID();

  const taskApiIntegrationId = crypto.randomUUID();
  const taskLogicLockId = crypto.randomUUID();
  const taskFullQaId = crypto.randomUUID();
  const taskAdminReviewId = crypto.randomUUID();

  // ATOMIC DATABASE TRANSACTION FOR TRUE PARALLEL CREATION
  execRaw('BEGIN TRANSACTION');
  try {
    // A. Create project with permanently locked owner_id and revenue_clock_start
    execute(`
      INSERT INTO projects (
        id, idea_id, org_id, title, owner_id, revenue_clock_start,
        current_stage, status, created_at, updated_at
      ) VALUES (?, ?, 'DEFAULT_ORG', ?, ?, CURRENT_TIMESTAMP, 'RESEARCH_DEV_PARALLEL', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [projectId, idea.id, idea.title, idea.owner_id]);

    // B. Assign members
    for (const a of assignments) {
      if (a.user) {
        execute(`
          INSERT INTO project_members (
            id, project_id, user_id, role_in_project, task_status, contribution_weight, joined_at
          ) VALUES (?, ?, ?, ?, 'ASSIGNED', 0.0, CURRENT_TIMESTAMP)
        `, [crypto.randomUUID(), projectId, a.user.id, a.roleInProject]);
      }
    }

    // C. 4 Initial Parallel Tasks (zero dependencies, status = 'TODO')
    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at)
      VALUES (?, ?, ?, 'Deep Research', 'research', NULL, 'TODO', CURRENT_TIMESTAMP)
    `, [taskResearchId, projectId, researcher ? researcher.id : null]);

    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at)
      VALUES (?, ?, ?, 'Backend Architecture Setup', 'backend', NULL, 'TODO', CURRENT_TIMESTAMP)
    `, [taskBackendId, projectId, backendDev ? backendDev.id : null]);

    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at)
      VALUES (?, ?, ?, 'Frontend UI Scaffolding', 'frontend', NULL, 'TODO', CURRENT_TIMESTAMP)
    `, [taskFrontendId, projectId, frontendDev ? frontendDev.id : null]);

    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at)
      VALUES (?, ?, ?, 'Test Plan Preparation', 'testing', NULL, 'TODO', CURRENT_TIMESTAMP)
    `, [taskTestingPrepId, projectId, producer ? producer.id : null]);

    // D. 4 Dependent Tasks (status = 'BLOCKED', depends_on set)
    // Task 5: Frontend API Integration (depends on Backend Architecture Setup)
    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at)
      VALUES (?, ?, ?, 'Frontend API Integration', 'frontend', ?, 'BLOCKED', CURRENT_TIMESTAMP)
    `, [taskApiIntegrationId, projectId, frontendDev ? frontendDev.id : null, taskBackendId]);

    // Task 6: Feature Logic Lock (depends on Deep Research)
    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at)
      VALUES (?, ?, ?, 'Feature Logic Lock', 'backend', ?, 'BLOCKED', CURRENT_TIMESTAMP)
    `, [taskLogicLockId, projectId, backendDev ? backendDev.id : null, taskResearchId]);

    // Task 7: Full QA Testing (depends on Feature Logic Lock)
    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at)
      VALUES (?, ?, ?, 'Full QA Testing', 'testing', ?, 'BLOCKED', CURRENT_TIMESTAMP)
    `, [taskFullQaId, projectId, producer ? producer.id : null, taskLogicLockId]);

    // Task 8: Admin Final Review (depends on Full QA Testing)
    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at)
      VALUES (?, ?, ?, 'Admin Final Review', 'review', ?, 'BLOCKED', CURRENT_TIMESTAMP)
    `, [taskAdminReviewId, projectId, admin ? admin.id : null, taskFullQaId]);

    execRaw('COMMIT');
  } catch (err) {
    execRaw('ROLLBACK');
    throw err;
  }

  logAccess({
    userId: idea.owner_id,
    action: 'project_fanout_created',
    resource: `/api/projects/${projectId} (idea_id: ${idea.id}, title: "${idea.title}")`
  });

  const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  const tasks = queryAll('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY created_at ASC', [projectId]);
  const members = queryAll(`
    SELECT pm.*, u.name, u.email, u.role
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
  `, [projectId]);

  return {
    success: true,
    project,
    members,
    tasks
  };
}

/**
 * Recalculate Project Stage:
 * RESEARCH_DEV_PARALLEL -> INTEGRATION -> TESTING -> ADMIN_REVIEW -> LIVE
 */
export function evaluateProjectStage(projectId) {
  const tasks = queryAll('SELECT task_name, status FROM project_tasks WHERE project_id = ?', [projectId]);
  const taskMap = {};
  for (const t of tasks) {
    taskMap[t.task_name] = t.status;
  }

  let stage = 'RESEARCH_DEV_PARALLEL';

  if (taskMap['Admin Final Review'] === 'DONE') {
    stage = 'LIVE';
  } else if (taskMap['Full QA Testing'] === 'DONE') {
    stage = 'ADMIN_REVIEW';
  } else if (taskMap['Full QA Testing'] === 'IN_PROGRESS' || taskMap['Full QA Testing'] === 'TODO') {
    stage = 'TESTING';
  } else if (
    (taskMap['Backend Architecture Setup'] === 'DONE' && taskMap['Deep Research'] === 'DONE') ||
    taskMap['Frontend API Integration'] === 'IN_PROGRESS' ||
    taskMap['Frontend API Integration'] === 'DONE' ||
    taskMap['Feature Logic Lock'] === 'IN_PROGRESS' ||
    taskMap['Feature Logic Lock'] === 'DONE'
  ) {
    stage = 'INTEGRATION';
  }

  execute(
    'UPDATE projects SET current_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [stage, projectId]
  );

  return stage;
}

/**
 * Update Task Status with Dependency Auto-Unblock:
 */
export function updateTaskStatus({ taskId, userId, newStatus, isAdmin = false, ipAddress = null }) {
  const validStatuses = ['TODO', 'IN_PROGRESS', 'DONE'];
  if (!validStatuses.includes(newStatus)) {
    return { success: false, status: 400, error: `Status must be one of: ${validStatuses.join(', ')}` };
  }

  const task = queryOne('SELECT * FROM project_tasks WHERE id = ?', [taskId]);
  if (!task) {
    return { success: false, status: 404, error: 'Task not found' };
  }

  if (!isAdmin && task.assigned_to !== userId) {
    return { success: false, status: 403, error: 'Forbidden: You can only update tasks assigned to you' };
  }

  // Structural prevention of sequential fallback: BLOCKED tasks cannot be started
  if (task.status === 'BLOCKED' && newStatus !== 'BLOCKED') {
    let parentTaskName = 'parent dependency';
    if (task.depends_on_task_id) {
      const parent = queryOne('SELECT task_name, status FROM project_tasks WHERE id = ?', [task.depends_on_task_id]);
      if (parent) parentTaskName = `"${parent.task_name}" (currently: ${parent.status})`;
    }
    return {
      success: false,
      status: 400,
      error: `Cannot start task. This task is BLOCKED until ${parentTaskName} is marked DONE.`
    };
  }

  const completedAt = newStatus === 'DONE' ? new Date().toISOString() : null;

  execute(`
    UPDATE project_tasks
    SET status = ?, completed_at = ?
    WHERE id = ?
  `, [newStatus, completedAt, taskId]);

  let unblockedTasks = [];

  // If task is completed, automatically unblock all dependent tasks
  if (newStatus === 'DONE') {
    const dependentTasks = queryAll(
      "SELECT id, task_name, assigned_to FROM project_tasks WHERE depends_on_task_id = ? AND status = 'BLOCKED'",
      [taskId]
    );

    for (const dep of dependentTasks) {
      execute(
        "UPDATE project_tasks SET status = 'TODO' WHERE id = ?",
        [dep.id]
      );
      unblockedTasks.push(dep);

      logAccess({
        userId: dep.assigned_to,
        action: 'task_auto_unblocked',
        resource: `/api/tasks/${dep.id} ("${dep.task_name}" unblocked by completion of task "${task.task_name}")`,
        ipAddress
      });
    }
  }

  // Recalculate project stage
  const newStage = evaluateProjectStage(task.project_id);

  logAccess({
    userId,
    action: `task_status_${newStatus.toLowerCase()}`,
    resource: `/api/tasks/${taskId} ("${task.task_name}" -> ${newStatus})`,
    ipAddress
  });

  const updatedTask = queryOne('SELECT * FROM project_tasks WHERE id = ?', [taskId]);

  return {
    success: true,
    task: updatedTask,
    unblockedTasks,
    currentStage: newStage
  };
}

/**
 * Reassign Project Member/Task (Admin Only)
 */
export function reassignTask({ taskId, newUserId, adminUserId, ipAddress = null }) {
  const task = queryOne('SELECT * FROM project_tasks WHERE id = ?', [taskId]);
  if (!task) {
    return { success: false, status: 404, error: 'Task not found' };
  }

  const targetUser = queryOne('SELECT id, name, role, status FROM users WHERE id = ?', [newUserId]);
  if (!targetUser) {
    return { success: false, status: 404, error: 'New user not found' };
  }

  if (targetUser.status !== 'active') {
    return { success: false, status: 400, error: 'Cannot assign task to an inactive user' };
  }

  execute(
    'UPDATE project_tasks SET assigned_to = ? WHERE id = ?',
    [newUserId, taskId]
  );

  // Ensure user is in project_members
  const existingMember = queryOne(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
    [task.project_id, newUserId]
  );
  if (!existingMember) {
    let roleInProject = 'backend_dev';
    if (targetUser.role === 'researcher') roleInProject = 'researcher';
    else if (targetUser.role === 'producer') roleInProject = 'producer';
    else if (targetUser.role === 'admin') roleInProject = 'admin_reviewer';
    else if (task.task_type === 'frontend' || targetUser.sub_role === 'frontend') roleInProject = 'frontend_dev';
    else roleInProject = 'backend_dev';

    execute(`
      INSERT INTO project_members (id, project_id, user_id, role_in_project, task_status, joined_at)
      VALUES (?, ?, ?, ?, 'ASSIGNED', CURRENT_TIMESTAMP)
    `, [crypto.randomUUID(), task.project_id, newUserId, roleInProject]);
  }

  logAccess({
    userId: adminUserId,
    action: 'task_reassigned_by_admin',
    resource: `/api/tasks/${taskId} (new_assigned: ${newUserId} - ${targetUser.name})`,
    ipAddress
  });

  const updatedTask = queryOne('SELECT * FROM project_tasks WHERE id = ?', [taskId]);
  return { success: true, task: updatedTask };
}

/**
 * Admin Final Review
 */
export function adminFinalReview({ projectId, adminUserId, approved, notes = null, ipAddress = null }) {
  const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    return { success: false, status: 404, error: 'Project not found' };
  }

  const newStage = approved ? 'LIVE' : 'REJECTED_AT_REVIEW';
  const newStatus = approved ? 'LIVE' : 'ACTIVE';

  execute(
    'UPDATE projects SET current_stage = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newStage, newStatus, projectId]
  );

  if (approved) {
    // Mark Admin Final Review task as DONE
    execute(`
      UPDATE project_tasks
      SET status = 'DONE', completed_at = CURRENT_TIMESTAMP
      WHERE project_id = ? AND task_type = 'review'
    `, [projectId]);
  }

  logAccess({
    userId: adminUserId,
    action: approved ? 'project_approved_live' : 'project_rejected_at_review',
    resource: `/api/admin/projects/${projectId}/final-review (stage: ${newStage}, notes: "${notes || 'None'}")`,
    ipAddress
  });

  const updatedProject = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  return { success: true, project: updatedProject, stage: newStage };
}
