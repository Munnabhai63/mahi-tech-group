import express from 'express';
import { queryOne, queryAll, execute } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { triggerProjectFanout } from '../services/fanoutService.js';
import { logAccess } from '../services/auditService.js';
import { createAsset, getProjectAssets } from '../services/assetService.js';

const router = express.Router();

/**
 * 1. POST /api/projects/auto-create (Internal / Admin trigger)
 * Creates a project and triggers parallel fanout from an approved idea
 */
router.post('/auto-create', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { idea_id } = req.body || {};

  if (!idea_id) {
    return res.status(400).json({ error: 'idea_id is required' });
  }

  const idea = queryOne('SELECT * FROM ideas WHERE id = ?', [idea_id]);
  if (!idea) {
    return res.status(404).json({ error: 'Idea not found' });
  }

  if (idea.status !== 'APPROVED') {
    return res.status(400).json({
      error: `Cannot trigger fanout for idea with status '${idea.status}'. Must be 'APPROVED'.`
    });
  }

  try {
    const fanoutResult = triggerProjectFanout(idea_id);
    return res.status(201).json({
      message: fanoutResult.alreadyExisted ? 'Project already existed for this idea' : 'Parallel fanout successfully initiated',
      project: fanoutResult.project,
      members: fanoutResult.members,
      tasks: fanoutResult.tasks
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to initiate project fanout', message: err.message });
  }
});

/**
 * 2. GET /api/projects/my-tasks (Authenticated)
 * Returns all project tasks assigned to the current user
 * Must be mounted before /:id so 'my-tasks' isn't treated as an ID
 */
router.get('/my-tasks', authenticate, (req, res) => {
  const { role, task_type, status } = req.query;

  let query = `
    SELECT pt.*, p.title as project_title, p.current_stage as project_stage,
           dep.task_name as depends_on_task_name, dep.status as depends_on_task_status
    FROM project_tasks pt
    JOIN projects p ON pt.project_id = p.id
    LEFT JOIN project_tasks dep ON pt.depends_on_task_id = dep.id
    WHERE pt.assigned_to = ?
  `;
  const params = [req.user.id];

  if (task_type) {
    query += ' AND pt.task_type = ?';
    params.push(task_type);
  } else if (role === 'researcher') {
    query += " AND pt.task_type = 'research'";
  } else if (role === 'developer') {
    query += " AND pt.task_type IN ('backend', 'frontend')";
  } else if (role === 'producer') {
    query += " AND pt.task_type = 'testing'";
  } else if (role === 'designer') {
    query += " AND pt.task_type = 'design'";
  }

  if (status) {
    query += ' AND pt.status = ?';
    params.push(status);
  }

  query += ' ORDER BY pt.created_at ASC';

  const tasks = queryAll(query, params);

  return res.status(200).json({
    userId: req.user.id,
    taskCount: tasks.length,
    tasks
  });
});

/**
 * 2b. GET /api/projects/my (Authenticated)
 * Returns projects where the current user is owner or an active member
 */
router.get('/my', authenticate, (req, res) => {
  const projects = queryAll(`
    SELECT DISTINCT p.*, u.name as owner_name, u.email as owner_email
    FROM projects p
    JOIN users u ON p.owner_id = u.id
    LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ? AND pm.removed_at IS NULL
    WHERE p.owner_id = ? OR pm.user_id = ?
    ORDER BY p.created_at DESC
  `, [req.user.id, req.user.id, req.user.id]);

  return res.status(200).json({
    count: projects.length,
    projects
  });
});

/**
 * 3. GET /api/projects/:id (Project Members + Admin)
 * Project detail + all members + all tasks
 */
router.get('/:id', authenticate, (req, res) => {
  const { id } = req.params;

  const project = queryOne(`
    SELECT p.*, u.name as owner_name, u.email as owner_email
    FROM projects p
    JOIN users u ON p.owner_id = u.id
    WHERE p.id = ?
  `, [id]);

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Access check: Admin or member of project or owner
  const isOwner = project.owner_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const memberRecord = queryOne(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ? AND removed_at IS NULL',
    [id, req.user.id]
  );

  if (!isAdmin && !isOwner && !memberRecord) {
    return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
  }

  const members = queryAll(`
    SELECT pm.*, u.name, u.email, u.role, u.profile_photo_url
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
    ORDER BY pm.joined_at ASC
  `, [id]);

  const tasks = queryAll(`
    SELECT pt.*, u.name as assigned_to_name, u.email as assigned_to_email,
           dep.task_name as depends_on_task_name, dep.status as depends_on_task_status
    FROM project_tasks pt
    LEFT JOIN users u ON pt.assigned_to = u.id
    LEFT JOIN project_tasks dep ON pt.depends_on_task_id = dep.id
    WHERE pt.project_id = ?
    ORDER BY pt.created_at ASC
  `, [id]);

  return res.status(200).json({
    project,
    members,
    tasks
  });
});

/**
 * 4. PATCH /api/projects/:id (Immutability check on owner_id)
 * Non-negotiable rule: owner_id on projects is permanently locked and strictly immutable
 */
router.patch('/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const ipAddress = req.ip || req.socket.remoteAddress;

  const project = queryOne('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Immutability rule test
  if (req.body.owner_id && req.body.owner_id !== project.owner_id) {
    logAccess({
      userId: req.user.id,
      action: 'security_violation_owner_id_tamper_attempt',
      resource: `/api/projects/${id} (attempted to change owner_id from ${project.owner_id} to ${req.body.owner_id})`,
      ipAddress
    });
    return res.status(403).json({
      error: 'Forbidden: owner_id on projects is permanently locked and strictly immutable'
    });
  }

  const { title, status } = req.body;
  if (title) {
    execute('UPDATE projects SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [title.trim(), id]);
  }
  if (status && ['ACTIVE', 'PAUSED', 'LIVE', 'ARCHIVED'].includes(status)) {
    execute('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);
  }

  const updatedProject = queryOne('SELECT * FROM projects WHERE id = ?', [id]);
  return res.status(200).json({ project: updatedProject });
});

/**
 * 5. POST /api/projects/:id/assets (Authenticated)
 * Registers an asset. Hardcodes owner_entity = 'ORG'
 */
router.post('/:id/assets', authenticate, (req, res) => {
  const { id } = req.params;
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { type, url } = req.body || {};

  const result = createAsset({
    projectId: id,
    type,
    url,
    uploadedBy: req.user.id,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(201).json(result);
});

/**
 * 6. GET /api/projects/:id/assets (Authenticated)
 * Lists all assets for a project with attribution formatting
 */
router.get('/:id/assets', authenticate, (req, res) => {
  const { id } = req.params;
  const result = getProjectAssets(id);

  if (!result.success) {
    return res.status(result.status || 404).json({ error: result.error });
  }

  return res.status(200).json(result);
});

export default router;
