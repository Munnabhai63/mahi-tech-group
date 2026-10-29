import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as sprintService from '../services/sprintService.js';

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
  if (msg.includes('Forbidden') || msg.includes('Admin or Lead role required')) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes('Unauthorized')) {
    return res.status(401).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ===================================================================
// SPRINT ROUTES (PRD 18 — Layer 2)
// ===================================================================

/**
 * 1. POST /api/sprint/create
 * Body: { project_id, name, goal, start_date, end_date }
 * Role: Admin+
 */
router.post(['/create', '/'], authenticate, (req, res) => {
  try {
    const { project_id, name, goal, start_date, end_date } = req.body || {};
    const sprint = sprintService.createSprint({
      project_id,
      name,
      goal,
      start_date,
      end_date,
      userId: req.user?.id
    });
    return res.status(201).json(sprint);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 2. GET /api/sprint/project/:projectId
 * Returns: all sprints for project (with item count, point totals)
 * Role: All authenticated users
 */
router.get('/project/:projectId', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    const sprints = sprintService.getProjectSprints(projectId, req.user?.id);
    return res.json(sprints);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 3. PATCH /api/sprint/:sprintId/start
 * Rule: Project must have no other ACTIVE sprint
 * Role: Admin+
 */
router.patch('/:sprintId/start', authenticate, (req, res) => {
  try {
    const { sprintId } = req.params;
    const sprint = sprintService.startSprint(sprintId, req.user?.id);
    return res.json(sprint);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 4. PATCH /api/sprint/:sprintId/complete
 * Rule: Logs velocity automatically into sprint_velocity_log on completion
 * Role: Admin+
 */
router.patch('/:sprintId/complete', authenticate, (req, res) => {
  try {
    const { sprintId } = req.params;
    const result = sprintService.completeSprint(sprintId, req.user?.id);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 5. GET /api/sprint/velocity/:projectId
 * Returns: all velocity_log rows for project (for chart rendering)
 * Role: All authenticated users
 */
router.get('/velocity/:projectId', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    const velocityData = sprintService.getProjectVelocity(projectId, req.user?.id);
    return res.json(velocityData);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 6. GET /api/sprint/:sprintId/burndown
 * Returns: day-by-day remaining points for active sprint
 * Rule: calculated from item status change history (derived, not stored)
 * Role: All authenticated users
 */
router.get('/:sprintId/burndown', authenticate, (req, res) => {
  try {
    const { sprintId } = req.params;
    const burndown = sprintService.getSprintBurndown(sprintId, req.user?.id);
    return res.json(burndown);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 7. GET /api/sprint/:sprintId
 * Returns: sprint detail + all items in sprint
 * Role: All authenticated users
 */
router.get('/:sprintId', authenticate, (req, res) => {
  try {
    const { sprintId } = req.params;
    const sprint = sprintService.getSprintDetail(sprintId, req.user?.id);
    return res.json(sprint);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 6. PATCH /api/sprint/:sprintId
 * Body: { name, goal, start_date, end_date }
 * Role: Admin+
 */
router.patch('/:sprintId', authenticate, (req, res) => {
  try {
    const { sprintId } = req.params;
    const { name, goal, start_date, end_date } = req.body || {};
    const sprint = sprintService.updateSprint(
      sprintId,
      { name, goal, start_date, end_date },
      req.user?.id
    );
    return res.json(sprint);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 7. DELETE /api/sprint/:sprintId
 * Rule: Only DRAFT sprints deletable
 * Role: Admin+
 */
router.delete('/:sprintId', authenticate, (req, res) => {
  try {
    const { sprintId } = req.params;
    const result = sprintService.deleteSprint(sprintId, req.user?.id);
    return res.json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;
