import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as ganttService from '../services/ganttService.js';

const router = express.Router();

/**
 * Clean error handler mapping domain errors to HTTP response codes
 */
function handleServiceError(res, err) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  const msg = err.message || 'An error occurred';
  if (msg.toLowerCase().includes('not found')) {
    return res.status(404).json({ error: msg });
  }
  if (msg.includes('Forbidden') || msg.includes('role required') || msg.includes('permission')) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes('Unauthorized')) {
    return res.status(401).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ===================================================================
// GANTT ITEM ROUTES
// ===================================================================

/**
 * POST /api/gantt/item/create
 * Role: Admin+
 */
router.post('/item/create', authenticate, (req, res) => {
  try {
    const item = ganttService.createItem(req.body, req.user);
    return res.status(201).json({
      message: 'Gantt item created successfully',
      item
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/gantt/project/:projectId
 * GET /api/gantt/items/:projectId
 * Role: All members
 */
router.get(['/project/:projectId', '/items/:projectId'], authenticate, (req, res) => {
  try {
    const data = ganttService.getProjectGantt(req.params.projectId, req.user);
    return res.status(200).json(data);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/gantt/item/:itemId
 * Role: All members
 */
router.get('/item/:itemId', authenticate, (req, res) => {
  try {
    const item = ganttService.getItemDetail(req.params.itemId, req.user);
    return res.status(200).json(item);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/gantt/item/:itemId
 * Role: Admin+ or Assignee (Assignee progress_pct only)
 */
router.patch('/item/:itemId', authenticate, (req, res) => {
  try {
    const result = ganttService.updateItem(req.params.itemId, req.body, req.user);
    return res.status(200).json({
      message: 'Gantt item updated successfully',
      ...result
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/gantt/item/:itemId/progress
 * Role: Assignee or Admin+
 */
router.patch('/item/:itemId/progress', authenticate, (req, res) => {
  try {
    const { progress_pct, progressPct } = req.body || {};
    const val = progress_pct !== undefined ? progress_pct : progressPct;
    const updated = ganttService.updateProgress(req.params.itemId, val, req.user);
    return res.status(200).json({
      message: 'Progress updated successfully',
      item: updated
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * DELETE /api/gantt/item/:itemId
 * Role: Admin+
 */
router.delete('/item/:itemId', authenticate, (req, res) => {
  try {
    const result = ganttService.deleteItem(req.params.itemId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// DEPENDENCY ROUTES
// ===================================================================

/**
 * POST /api/gantt/dependency/add
 * Role: Admin+
 */
router.post('/dependency/add', authenticate, (req, res) => {
  try {
    const dep = ganttService.addDependency(req.body, req.user);
    return res.status(201).json({
      message: 'Dependency added successfully',
      dependency: dep
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/gantt/dependencies/:projectId
 * Role: All members
 */
router.get('/dependencies/:projectId', authenticate, (req, res) => {
  try {
    const dependencies = ganttService.getProjectDependencies(req.params.projectId, req.user);
    return res.status(200).json({
      project_id: req.params.projectId,
      dependencies
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * DELETE /api/gantt/dependency/:dependencyId
 * Role: Admin+
 */
router.delete('/dependency/:dependencyId', authenticate, (req, res) => {
  try {
    const result = ganttService.removeDependency(req.params.dependencyId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// MILESTONE ROUTES
// ===================================================================

/**
 * POST /api/gantt/milestone/create
 * Role: Admin+
 */
router.post('/milestone/create', authenticate, (req, res) => {
  try {
    const milestone = ganttService.createMilestone(req.body, req.user);
    return res.status(201).json({
      message: 'Milestone created successfully',
      milestone
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/gantt/milestone/:milestoneId/achieve
 * Role: Admin+
 */
router.patch('/milestone/:milestoneId/achieve', authenticate, (req, res) => {
  try {
    const milestone = ganttService.achieveMilestone(req.params.milestoneId, req.user);
    return res.status(200).json({
      message: 'Milestone marked as achieved',
      milestone
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/gantt/milestone/:milestoneId
 * Role: Admin+
 */
router.patch('/milestone/:milestoneId', authenticate, (req, res) => {
  try {
    const milestone = ganttService.updateMilestone(req.params.milestoneId, req.body, req.user);
    return res.status(200).json({
      message: 'Milestone updated successfully',
      milestone
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * DELETE /api/gantt/milestone/:milestoneId
 * Role: Admin+
 */
router.delete('/milestone/:milestoneId', authenticate, (req, res) => {
  try {
    const result = ganttService.deleteMilestone(req.params.milestoneId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/gantt/milestones/:projectId
 * Role: All members
 */
router.get('/milestones/:projectId', authenticate, (req, res) => {
  try {
    const milestones = ganttService.getProjectMilestones(req.params.projectId, req.user);
    return res.status(200).json({
      project_id: req.params.projectId,
      milestones
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});


// ===================================================================
// GANTT HISTORY
// ===================================================================

/**
 * GET /api/gantt/history/:itemId
 * Role: Admin+
 */
router.get('/history/:itemId', authenticate, (req, res) => {
  try {
    const history = ganttService.getItemHistory(req.params.itemId, req.user);
    return res.status(200).json({
      gantt_item_id: req.params.itemId,
      history
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// BASELINE ROUTES
// ===================================================================

/**
 * POST /api/gantt/baseline/snapshot
 * Role: Admin+
 */
router.post('/baseline/snapshot', authenticate, (req, res) => {
  try {
    const result = ganttService.takeBaselineSnapshot(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/gantt/baselines/:projectId
 * Role: All members
 */
router.get('/baselines/:projectId', authenticate, (req, res) => {
  try {
    const baselines = ganttService.getProjectBaselines(req.params.projectId, req.user);
    return res.status(200).json(baselines);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// CRITICAL PATH & EXPORT ROUTES
// ===================================================================

/**
 * GET /api/gantt/criticalpath/:projectId
 * Role: All members
 */
router.get('/criticalpath/:projectId', authenticate, (req, res) => {
  try {
    const criticalPath = ganttService.calculateCriticalPath(req.params.projectId, req.user);
    return res.status(200).json(criticalPath);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/gantt/export/:projectId
 * Role: All members
 */
router.get('/export/:projectId', authenticate, (req, res) => {
  try {
    const bundle = ganttService.exportProjectGantt(req.params.projectId, req.user);
    return res.status(200).json(bundle);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;

