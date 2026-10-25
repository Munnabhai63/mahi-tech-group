import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { updateTaskStatus } from '../services/fanoutService.js';
import { queryOne, queryAll, execute } from '../db/database.js';
import { createAsset } from '../services/assetService.js';
import { logAccess } from '../services/auditService.js';
import { createNotification } from '../services/notificationService.js';
import { pushToUser } from '../services/wsService.js';

const router = express.Router();

// Real file attachment storage (25MB cap, extension-validated)
const taskUploadsDir = path.join(process.cwd(), 'uploads', 'tasks');
fs.mkdirSync(taskUploadsDir, { recursive: true });
const taskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, taskUploadsDir),
    filename: (req, file, cb) => cb(null, `task_${Date.now()}_${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.md', '.mp4', '.webm', '.mp3', '.wav'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type not allowed. Supported: ${allowed.join(', ')}`));
  }
});

/**
 * Task access guard: assignee, project member, or admin.
 */
function canAccessTask(task, user) {
  if (user.role === 'admin') return true;
  if (task.assigned_to === user.id) return true;
  const member = queryOne('SELECT id FROM project_members WHERE project_id = ? AND user_id = ? AND removed_at IS NULL', [task.project_id, user.id]);
  return Boolean(member);
}

/**
 * PATCH /api/tasks/:id/status (Assigned user or Admin)
 * Updates task status (TODO -> IN_PROGRESS -> DONE), triggers auto-unblock of child tasks,
 * and dynamically recalculates current_stage.
 */
router.patch('/:id/status', authenticate, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (!status) {
    return res.status(400).json({ error: 'Status is required (TODO, IN_PROGRESS, DONE)' });
  }

  const isAdmin = req.user.role === 'admin';

  if (!isAdmin && req.user.role === 'designer') {
    const task = queryOne('SELECT task_type FROM project_tasks WHERE id = ?', [id]);
    if (task && task.task_type !== 'design') {
      return res.status(403).json({ error: 'Forbidden: Designer can only act on design tasks' });
    }
  }

  const result = updateTaskStatus({
    taskId: id,
    userId: req.user.id,
    newStatus: status,
    isAdmin,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(200).json({
    message: `Task status updated to ${status}`,
    task: result.task,
    unblockedTasks: result.unblockedTasks,
    currentStage: result.currentStage
  });
});

/**
 * POST /api/tasks/:id/upload (Assigned user or Admin)
 * Attaches a research PDF, design asset, or QA test report, registers ORG asset, and completes task
 */
router.post('/:id/upload', authenticate, (req, res) => {
  const { id } = req.params;
  const { file_url, notes, mark_done = true, asset_type = 'pdf_doc' } = req.body || {};
  const ipAddress = req.ip || req.socket.remoteAddress;

  const task = queryOne('SELECT * FROM project_tasks WHERE id = ?', [id]);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && task.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: You can only upload files to your assigned tasks' });
  }

  if (!isAdmin && req.user.role === 'designer' && task.task_type !== 'design') {
    return res.status(403).json({ error: 'Forbidden: Designer can only upload files to design tasks' });
  }

  let asset = null;
  if (file_url) {
    const assetResult = createAsset({
      projectId: task.project_id,
      type: asset_type,
      url: file_url,
      uploadedBy: req.user.id,
      ipAddress
    });
    if (assetResult.success) {
      asset = assetResult.asset;
    }
  }

  let updateResult = null;
  if (mark_done) {
    updateResult = updateTaskStatus({
      taskId: id,
      userId: req.user.id,
      newStatus: 'DONE',
      isAdmin,
      ipAddress
    });
    if (!updateResult.success) {
      return res.status(updateResult.status || 400).json({ error: updateResult.error });
    }
  }

  const updatedTask = queryOne('SELECT * FROM project_tasks WHERE id = ?', [id]);

  return res.status(200).json({
    message: 'File uploaded and task processed successfully',
    task: updatedTask,
    asset,
    unblockedTasks: updateResult ? updateResult.unblockedTasks : [],
    currentStage: updateResult ? updateResult.currentStage : null
  });
});

/**
 * GET /api/tasks/:id/comments (Assignee / project member / Admin)
 */
router.get('/:id/comments', authenticate, (req, res) => {
  const task = queryOne('SELECT * FROM project_tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!canAccessTask(task, req.user)) {
    return res.status(403).json({ error: 'Forbidden: You are not part of this task project' });
  }
  const comments = queryAll(`
    SELECT tc.*, u.name as author_name, u.role as author_role
    FROM task_comments tc JOIN users u ON tc.user_id = u.id
    WHERE tc.task_id = ? ORDER BY tc.created_at ASC
  `, [req.params.id]);
  return res.status(200).json({ count: comments.length, comments });
});

/**
 * POST /api/tasks/:id/comments (Assignee / project member / Admin)
 * Append-only discussion thread per task.
 */
router.post('/:id/comments', authenticate, (req, res) => {
  const task = queryOne('SELECT * FROM project_tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!canAccessTask(task, req.user)) {
    return res.status(403).json({ error: 'Forbidden: You are not part of this task project' });
  }

  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment body is required' });
  if (body.length > 4000) return res.status(400).json({ error: 'Comment too long (max 4000 characters)' });

  const id = crypto.randomUUID();
  execute(`
    INSERT INTO task_comments (id, task_id, user_id, body, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [id, task.id, req.user.id, body]);

  logAccess({
    userId: req.user.id,
    action: 'task_comment_added',
    resource: `/api/tasks/${task.id}/comments`,
    ipAddress: req.ip
  });

  const comment = queryOne(`
    SELECT tc.*, u.name as author_name, u.role as author_role
    FROM task_comments tc JOIN users u ON tc.user_id = u.id
    WHERE tc.id = ?
  `, [id]);

  // Notify assignee (unless the commenter is the assignee)
  if (task.assigned_to && task.assigned_to !== req.user.id) {
    createNotification({
      userId: task.assigned_to,
      eventType: 'task.comment',
      message: `New comment on "${task.task_name}" from ${req.user.name}`,
      link: `/`
    });
    pushToUser(task.assigned_to, 'notification', { message: `New comment on "${task.task_name}"`, link: '/' });
  }

  return res.status(201).json({ message: 'Comment added', comment });
});

/**
 * POST /api/tasks/:id/attachments (Assignee / Admin)
 * Real multipart file upload — stored on disk, recorded in assets, served by URL.
 */
router.post('/:id/attachments', authenticate, (req, res) => {
  const task = queryOne('SELECT * FROM project_tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && task.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: Only the assignee or an Admin can attach files' });
  }

  taskUpload.single('file')(req, res, (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'No file provided (expected field: file)' });

    const servedUrl = `/uploads/tasks/${req.file.filename}`;
    const assetResult = createAsset({
      projectId: task.project_id,
      type: (req.body && req.body.asset_type) || 'attachment',
      url: servedUrl,
      uploadedBy: req.user.id,
      ipAddress: req.ip
    });

    logAccess({
      userId: req.user.id,
      action: 'task_file_attached',
      resource: `/api/tasks/${task.id}/attachments (${req.file.originalname}, ${req.file.size} bytes)`,
      ipAddress: req.ip
    });

    return res.status(201).json({
      message: 'File attached to task',
      file: {
        original_name: req.file.originalname,
        stored_as: req.file.filename,
        size: req.file.size,
        url: servedUrl
      },
      asset: assetResult.success ? assetResult.asset : null
    });
  });
});

export default router;