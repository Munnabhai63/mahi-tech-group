import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as backlogService from '../services/backlogService.js';

const router = express.Router();

/**
 * Helper to handle errors cleanly from service calls
 */
function handleServiceError(res, err) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  const msg = err.message || 'An error occurred';
  if (msg.toLowerCase().includes('not found')) {
    return res.status(404).json({ error: msg });
  }
  if (msg.includes('Forbidden') || msg.includes('Admin role required') || msg.includes('Only the item creator')) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes('Unauthorized')) {
    return res.status(401).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ===================================================================
// BACKLOG ROUTES (PRD 18 — Layer 3)
// ===================================================================

/**
 * 1. POST /api/backlog/item/create
 * Body: { project_id, sprint_id, title, description, type, priority, story_points, assigned_to }
 * Role: All authenticated users
 */
router.post('/item/create', authenticate, (req, res) => {
  try {
    const {
      project_id,
      sprint_id,
      title,
      description,
      type,
      priority,
      story_points,
      assigned_to
    } = req.body || {};

    const item = backlogService.createBacklogItem({
      project_id,
      sprint_id,
      title,
      description,
      type,
      priority,
      story_points,
      assigned_to,
      userId: req.user?.id
    });
    return res.status(201).json(item);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 2. GET /api/backlog/project/:projectId
 * Returns: all items where sprint_id IS NULL (pure backlog)
 * Role: All authenticated users
 */
router.get('/project/:projectId', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    const items = backlogService.getProjectBacklog(projectId, req.user?.id);
    return res.json(items);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 3. PATCH /api/backlog/item/:itemId/move
 * Body: { sprint_id, reason }
 * Rule: null = move back to backlog
 * Role: Admin+
 */
router.patch('/item/:itemId/move', authenticate, (req, res) => {
  try {
    const { itemId } = req.params;
    const { sprint_id, reason } = req.body || {};
    const ipAddress = req.ip || req.socket.remoteAddress;
    const item = backlogService.moveBacklogItem(
      itemId,
      { sprint_id, reason },
      req.user?.id,
      ipAddress
    );
    return res.json(item);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 4. PATCH /api/backlog/item/:itemId/status
 * Body: { status }
 * Rule: auto-logs to backlog_item_history
 * Role: Assigned member or Admin+
 */
router.patch('/item/:itemId/status', authenticate, (req, res) => {
  try {
    const { itemId } = req.params;
    const { status } = req.body || {};
    const item = backlogService.updateItemStatus(itemId, { status }, req.user?.id);
    return res.json(item);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 5. PATCH /api/backlog/item/:itemId/reorder
 * Body: { position }
 * Role: Admin+
 */
router.patch('/item/:itemId/reorder', authenticate, (req, res) => {
  try {
    const { itemId } = req.params;
    const { position } = req.body || {};
    const item = backlogService.reorderBacklogItem(itemId, { position }, req.user?.id);
    return res.json(item);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 6. GET /api/backlog/item/:itemId
 * Returns: item detail + change history
 * Role: All authenticated users
 */
router.get('/item/:itemId', authenticate, (req, res) => {
  try {
    const { itemId } = req.params;
    const item = backlogService.getBacklogItemDetail(itemId, req.user?.id);
    return res.json(item);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 7. PATCH /api/backlog/item/:itemId
 * Body: any editable field (title, description, type, priority, story_points, assigned_to)
 * Rule: auto-logs to backlog_item_history
 * Role: Owner or Admin+
 */
router.patch('/item/:itemId', authenticate, (req, res) => {
  try {
    const { itemId } = req.params;
    const fields = req.body || {};
    const item = backlogService.updateBacklogItem(itemId, fields, req.user?.id);
    return res.json(item);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 8. DELETE /api/backlog/item/:itemId
 * Rule: only TODO items deletable, must not be in ACTIVE sprint
 * Role: Admin+
 */
router.delete('/item/:itemId', authenticate, (req, res) => {
  try {
    const { itemId } = req.params;
    const result = backlogService.deleteBacklogItem(itemId, req.user?.id);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;
