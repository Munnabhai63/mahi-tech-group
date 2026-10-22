import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { updateTaskStatus } from '../services/fanoutService.js';

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

export default router;
