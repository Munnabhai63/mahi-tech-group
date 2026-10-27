import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { queryOne, queryAll } from '../db/database.js';
import * as pointPoolService from '../services/pointPoolService.js';
import { isLeadOrAdmin } from '../services/pipelineService.js';

const router = express.Router();

/**
 * Helper to verify project membership
 */
function isProjectMember(userId, projectId) {
  if (!userId || !projectId) return false;
  const user = queryOne('SELECT role FROM users WHERE id = ?', [userId]);
  if (user && user.role === 'admin') return true;
  const project = queryOne('SELECT owner_id FROM projects WHERE id = ?', [projectId]);
  if (project && project.owner_id === userId) return true;
  const member = queryOne('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  return Boolean(member);
}

/**
 * Helper to verify admin role
 */
function isAdmin(userId) {
  if (!userId) return false;
  const user = queryOne('SELECT role FROM users WHERE id = ?', [userId]);
  return Boolean(user && user.role === 'admin');
}

/**
 * Helper for sanitized JSON error responses
 */
function handleServiceError(res, err) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  const msg = err.message || 'An error occurred';
  if (msg.includes('not found') || msg.includes('Not found')) {
    return res.status(404).json({ error: msg });
  }
  if (
    msg.includes('Unauthorized') ||
    msg.includes('Forbidden') ||
    msg.includes('Role mismatch') ||
    msg.includes('only Lead or Admin') ||
    msg.includes('Admin role required')
  ) {
    return res.status(403).json({ error: msg });
  }
  if (
    msg.includes('already claimed') ||
    msg.includes('cannot be claimed in status') ||
    msg.includes('already locked')
  ) {
    return res.status(409).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ===================================================================
// ROUTE ORDER RULE: Static paths BEFORE parameterized routes
// ===================================================================

/**
 * 1. GET /api/pointpool/projects/:projectId/participation/me
 * Auth: requireAuth + any project member
 */
router.get('/projects/:projectId/participation/me', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isProjectMember(req.user.id, projectId)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const stagesList = ['RESEARCH', 'DESIGN', 'DEV', 'TEST'];
    const stages = {};
    for (const stg of stagesList) {
      stages[stg] = pointPoolService.computeParticipationPct(req.user.id, projectId, stg);
    }
    const overall = pointPoolService.computeOverallParticipationPct(req.user.id, projectId);
    const thresholdRecord = pointPoolService.getThreshold(projectId);
    const threshold = Number(thresholdRecord.threshold_pct);
    const eligible = overall >= threshold;
    const atRisk = overall < (threshold + 10);

    return res.status(200).json({
      stages,
      overall,
      threshold,
      eligible,
      atRisk
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 2. GET /api/pointpool/projects/:projectId/participation
 * Auth: requireAuth + any project member
 * Logic:
 *   If Lead/Admin → returns all members' participation
 *   If regular member → returns ONLY own participation (server enforced)
 */
router.get('/projects/:projectId/participation', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isProjectMember(req.user.id, projectId)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const isPrivileged = isLeadOrAdmin(req.user.id, projectId);
    const pool = pointPoolService.getPointPool(projectId);

    if (isPrivileged) {
      return res.status(200).json(pool.participation);
    } else {
      const myParticipation = pool.participation.filter(p => p.userId === req.user.id);
      return res.status(200).json(myParticipation);
    }
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 3. GET /api/pointpool/projects/:projectId/revenue-blocks
 * Auth: requireAuth + Admin only
 */
router.get('/projects/:projectId/revenue-blocks', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isAdmin(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden: Admin role required' });
    }

    const blockedSplits = queryAll(`
      SELECT rs.*, u.name as member_name, u.email as member_email, u.role as member_role,
             re.event_date, re.source, p.title as project_title
      FROM revenue_splits rs
      JOIN revenue_events re ON rs.revenue_event_id = re.id
      JOIN users u ON rs.user_id = u.id
      JOIN projects p ON re.project_id = p.id
      WHERE re.project_id = ? AND rs.is_blocked = 1
      ORDER BY rs.created_at DESC
    `, [projectId]);

    return res.status(200).json(blockedSplits);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 4. PATCH /api/pointpool/revenue-splits/:splitId/unblock
 * Auth: requireAuth + Admin only
 * Body: { reason } (min 10 chars)
 */
router.patch('/revenue-splits/:splitId/unblock', authenticate, (req, res) => {
  try {
    const { splitId } = req.params;
    if (!isAdmin(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden: Admin role required' });
    }

    const { reason } = req.body || {};
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({ error: 'Unblock reason must be at least 10 characters' });
    }

    const updatedSplit = pointPoolService.unblockRevenueSplit(splitId, req.user.id, reason);
    return res.status(200).json(updatedSplit);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 5. GET /api/pointpool/projects/:projectId/abandoned
 * Auth: requireAuth + Lead or Admin only
 */
router.get('/projects/:projectId/abandoned', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isLeadOrAdmin(req.user.id, projectId)) {
      return res.status(403).json({ error: 'Forbidden: Lead or Admin role required' });
    }

    const abandoned = pointPoolService.getAbandonedPoints(projectId);
    return res.status(200).json(abandoned);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 6. GET /api/pointpool/projects/:projectId/pool
 * Auth: requireAuth + any project member
 */
router.get('/projects/:projectId/pool', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isProjectMember(req.user.id, projectId)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const user = queryOne('SELECT role, sub_role FROM users WHERE id = ?', [req.user.id]);
    const effectiveRole = user?.role || req.user.role;

    const pool = pointPoolService.getPointPool(projectId, req.user.id, effectiveRole);
    return res.status(200).json(pool);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 7. GET /api/pointpool/projects/:projectId/threshold
 * Auth: requireAuth + Admin only
 */
router.get('/projects/:projectId/threshold', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isAdmin(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden: Admin role required' });
    }

    const threshold = pointPoolService.getThreshold(projectId);
    return res.status(200).json(threshold);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 8. PATCH /api/pointpool/projects/:projectId/threshold
 * Auth: requireAuth + Admin only
 * Body: { threshold_pct, abandonment_days }
 */
router.patch('/projects/:projectId/threshold', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isAdmin(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden: Admin role required' });
    }

    const { threshold_pct, abandonment_days } = req.body || {};
    const updated = pointPoolService.setThreshold(projectId, threshold_pct, abandonment_days, req.user.id);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 9. POST /api/pointpool/points/:id/tools
 * Auth: requireAuth
 * Body: { tool_name, tool_url }
 */
router.post('/points/:id/tools', authenticate, (req, res) => {
  try {
    const pointId = req.params.id;
    const { tool_name, tool_url } = req.body || {};

    const point = queryOne('SELECT deliverable_id FROM pipeline_checklist_points WHERE id = ?', [pointId]);
    if (!point) {
      return res.status(404).json({ error: 'Point not found' });
    }

    const deliverable = queryOne('SELECT project_id FROM pipeline_deliverables WHERE id = ?', [point.deliverable_id]);
    const projectId = deliverable?.project_id;
    if (!projectId) {
      return res.status(404).json({ error: 'Deliverable not found for point' });
    }

    const toolLink = pointPoolService.addToolLink(pointId, projectId, req.user.id, tool_name, tool_url);
    return res.status(201).json(toolLink);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 10. GET /api/pointpool/points/:id/tools
 * Auth: requireAuth + any project member
 */
router.get('/points/:id/tools', authenticate, (req, res) => {
  try {
    const pointId = req.params.id;
    const point = queryOne('SELECT deliverable_id FROM pipeline_checklist_points WHERE id = ?', [pointId]);
    if (!point) {
      return res.status(404).json({ error: 'Point not found' });
    }

    const deliverable = queryOne('SELECT project_id FROM pipeline_deliverables WHERE id = ?', [point.deliverable_id]);
    const projectId = deliverable?.project_id;
    if (projectId && !isProjectMember(req.user.id, projectId)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const toolLinks = pointPoolService.getToolLinks(pointId);
    return res.status(200).json(toolLinks);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 11. DELETE /api/pointpool/points/:id/tools/:toolId (and /tools/:toolId)
 * Auth: requireAuth
 */
router.delete('/points/:id/tools/:toolId', authenticate, (req, res) => {
  try {
    const { toolId } = req.params;
    const result = pointPoolService.deleteToolLink(toolId, req.user.id);
    return res.status(200).json({ message: 'Tool link removed', ...result });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

router.delete('/tools/:toolId', authenticate, (req, res) => {
  try {
    const { toolId } = req.params;
    const result = pointPoolService.deleteToolLink(toolId, req.user.id);
    return res.status(200).json({ message: 'Tool link removed', ...result });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 12. PATCH /api/pointpool/points/:id/claim
 * Auth: requireAuth
 * userId from JWT, userRole from server
 */
router.patch('/points/:id/claim', authenticate, (req, res) => {
  try {
    const pointId = req.params.id;
    const user = queryOne('SELECT role, sub_role FROM users WHERE id = ?', [req.user.id]);
    const effectiveRole = user?.role || req.user.role;

    const result = pointPoolService.claimPoint(pointId, req.user.id, effectiveRole);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 13. PATCH /api/pointpool/points/:id/release
 * Auth: requireAuth + Lead or Admin only
 * Body: { reason }
 */
router.patch('/points/:id/release', authenticate, (req, res) => {
  try {
    const pointId = req.params.id;
    const { reason } = req.body || {};

    const updated = pointPoolService.releasePoint(pointId, req.user.id, reason);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;
