import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { updateTaskStatus } from '../services/fanoutService.js';
import { queryOne } from '../db/database.js';
import { createAsset } from '../services/assetService.js';

const router = express.Router();

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
 * Attaches a research PDF or QA test report, registers ORG asset, and completes task
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

export default router;

