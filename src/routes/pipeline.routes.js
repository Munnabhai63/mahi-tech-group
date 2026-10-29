import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { queryOne, queryAll, execute } from '../db/database.js';
import * as pipelineService from '../services/pipelineService.js';

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

// ===================================================================
// SECTION A: DELIVERABLE MANAGEMENT
// ===================================================================

/**
 * 1. POST /api/pipeline/deliverables
 * Auth: requireAuth + Lead or Admin role only
 * Body: { project_id, title, description }
 */
router.post('/deliverables', authenticate, (req, res, next) => {
  try {
    const { project_id, title, description } = req.body || {};
    if (!project_id || !title) {
      return res.status(400).json({ error: 'project_id and title are required' });
    }

    const project = queryOne('SELECT * FROM projects WHERE id = ?', [project_id]);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!pipelineService.isLeadOrAdmin(req.user.id, project_id)) {
      return res.status(403).json({ error: 'Forbidden: Lead or Admin role required' });
    }

    const deliverable = pipelineService.createDeliverable(
      project_id,
      title,
      description || '',
      req.user.id
    );

    return res.status(201).json(deliverable);
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/pipeline/deliverables/:id/detail
 * Auth: requireAuth + any project member
 * (Registered before :project_id generic param)
 */
router.get('/deliverables/:id/detail', authenticate, (req, res, next) => {
  try {
    const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [req.params.id]);
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    if (!isProjectMember(req.user.id, deliverable.project_id)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const detail = pipelineService.getDeliverableDetail(req.params.id);
    return res.status(200).json(detail);
  } catch (err) {
    next(err);
  }
});

/**
 * 3. POST /api/pipeline/deliverables/:id/points
 * Auth: requireAuth + Lead or Admin only
 * Body: { stage, point_title, point_description, weight }
 */
router.post('/deliverables/:id/points', authenticate, (req, res, next) => {
  try {
    const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [req.params.id]);
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    if (!pipelineService.isLeadOrAdmin(req.user.id, deliverable.project_id)) {
      return res.status(403).json({ error: 'Forbidden: Lead or Admin role required' });
    }

    const { stage, point_title, point_description, weight } = req.body || {};
    try {
      const point = pipelineService.addChecklistPoint(
        req.params.id,
        stage,
        point_title,
        point_description,
        weight,
        req.user.id
      );
      return res.status(201).json(point);
    } catch (serviceErr) {
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 4. POST /api/pipeline/deliverables/:id/handoff
 * Auth: requireAuth + Lead or Admin only
 * Body: { from_stage, to_stage, handoff_notes }
 */
router.post('/deliverables/:id/handoff', authenticate, (req, res, next) => {
  try {
    const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [req.params.id]);
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    if (!pipelineService.isLeadOrAdmin(req.user.id, deliverable.project_id)) {
      return res.status(403).json({ error: 'Forbidden: Lead or Admin role required' });
    }

    const { from_stage, to_stage, handoff_notes } = req.body || {};
    try {
      const handoff = pipelineService.approveHandoff(
        req.params.id,
        from_stage,
        to_stage,
        handoff_notes,
        req.user.id
      );
      return res.status(201).json(handoff);
    } catch (serviceErr) {
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 5. GET /api/pipeline/deliverables/:id/handoffs
 * Auth: requireAuth + any project member
 */
router.get('/deliverables/:id/handoffs', authenticate, (req, res, next) => {
  try {
    const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [req.params.id]);
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    if (!isProjectMember(req.user.id, deliverable.project_id)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const handoffs = queryAll(
      'SELECT * FROM pipeline_stage_handoffs WHERE deliverable_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    return res.status(200).json(handoffs);
  } catch (err) {
    next(err);
  }
});

/**
 * 6. POST /api/pipeline/deliverables/:id/addendum
 * Auth: requireAuth
 * Body: { requesting_stage, target_stage, point_title, reason, type }
 */
router.post('/deliverables/:id/addendum', authenticate, (req, res, next) => {
  try {
    const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [req.params.id]);
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    if (!isProjectMember(req.user.id, deliverable.project_id)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const { requesting_stage, target_stage, point_title, reason, point_description, type } = req.body || {};
    try {
      const addendum = pipelineService.raiseAddendum(
        req.params.id,
        requesting_stage,
        target_stage,
        point_title,
        reason || point_description || '',
        type,
        req.user.id
      );
      return res.status(201).json(addendum);
    } catch (serviceErr) {
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 7. GET /api/pipeline/deliverables/:id/addendums
 * Auth: requireAuth + any project member
 */
router.get('/deliverables/:id/addendums', authenticate, (req, res, next) => {
  try {
    const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [req.params.id]);
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    if (!isProjectMember(req.user.id, deliverable.project_id)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const addendums = queryAll(
      'SELECT * FROM pipeline_addendum_requests WHERE deliverable_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    return res.status(200).json(addendums);
  } catch (err) {
    next(err);
  }
});

/**
 * 8. PATCH /api/pipeline/deliverables/:id
 * Auth: requireAuth + Lead or Admin only
 * Body: { title?, description?, status? }
 */
router.patch('/deliverables/:id', authenticate, (req, res, next) => {
  try {
    const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [req.params.id]);
    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    if (!pipelineService.isLeadOrAdmin(req.user.id, deliverable.project_id)) {
      return res.status(403).json({ error: 'Forbidden: Lead or Admin role required' });
    }

    const { title, description, status } = req.body || {};
    execute(`
      UPDATE pipeline_deliverables 
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          status = COALESCE(?, status),
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [title || null, description !== undefined ? description : null, status || null, req.params.id]);

    const updated = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [req.params.id]);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * 9. GET /api/pipeline/deliverables/:project_id
 * Auth: requireAuth + any project member
 * Returns all deliverables in project with computed stage %
 */
router.get('/deliverables/:project_id', authenticate, (req, res, next) => {
  try {
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.project_id]);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!isProjectMember(req.user.id, req.params.project_id)) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }

    const deliverables = queryAll(
      'SELECT * FROM pipeline_deliverables WHERE project_id = ? ORDER BY created_at ASC',
      [req.params.project_id]
    );

    const list = deliverables.map(d => {
      const detail = pipelineService.getDeliverableDetail(d.id);
      return {
        ...d,
        stages: detail.stages,
        summary: detail.summary
      };
    });

    return res.status(200).json(list);
  } catch (err) {
    next(err);
  }
});

// ===================================================================
// SECTION B: CHECKLIST POINT MANAGEMENT
// ===================================================================

/**
 * 10. PATCH /api/pipeline/points/:id/claim
 * Auth: requireAuth
 */
router.patch('/points/:id/claim', authenticate, (req, res, next) => {
  try {
    const user = queryOne('SELECT role, sub_role FROM users WHERE id = ?', [req.user.id]);
    const effectiveRole = user ? (user.role || req.user.role) : req.user.role;

    try {
      const point = pipelineService.claimPoint(req.params.id, req.user.id, effectiveRole);
      return res.status(200).json(point);
    } catch (serviceErr) {
      if (serviceErr.message.includes('not found')) {
        return res.status(404).json({ error: serviceErr.message });
      }
      if (serviceErr.message.includes('Role mismatch')) {
        return res.status(403).json({ error: serviceErr.message });
      }
      if (serviceErr.message.includes('cannot be claimed in status')) {
        return res.status(409).json({ error: serviceErr.message });
      }
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 11. PATCH /api/pipeline/points/:id/start
 * Auth: requireAuth
 */
router.patch('/points/:id/start', authenticate, (req, res, next) => {
  try {
    try {
      const point = pipelineService.startPoint(req.params.id, req.user.id);
      return res.status(200).json(point);
    } catch (serviceErr) {
      if (serviceErr.message.includes('not found')) {
        return res.status(404).json({ error: serviceErr.message });
      }
      if (serviceErr.message.includes('Only the assigned member')) {
        return res.status(403).json({ error: serviceErr.message });
      }
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 12. PATCH /api/pipeline/points/:id/submit
 * Auth: requireAuth
 * Body: { asset_url?, tool_link?, notes? }
 */
router.patch('/points/:id/submit', authenticate, (req, res, next) => {
  try {
    const { asset_url, tool_link, notes } = req.body || {};
    try {
      const point = pipelineService.submitPoint(
        req.params.id,
        req.user.id,
        asset_url,
        tool_link,
        notes
      );
      return res.status(200).json(point);
    } catch (serviceErr) {
      if (serviceErr.message.includes('not found')) {
        return res.status(404).json({ error: serviceErr.message });
      }
      if (serviceErr.message.includes('Only the assigned member')) {
        return res.status(403).json({ error: serviceErr.message });
      }
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 13. PATCH /api/pipeline/points/:id/approve
 * Auth: requireAuth + Lead or Admin only
 */
router.patch('/points/:id/approve', authenticate, (req, res, next) => {
  try {
    try {
      const result = pipelineService.approvePoint(req.params.id, req.user.id);
      return res.status(200).json(result);
    } catch (serviceErr) {
      if (serviceErr.message.includes('Unauthorized')) {
        return res.status(403).json({ error: serviceErr.message });
      }
      if (serviceErr.message.includes('not found')) {
        return res.status(404).json({ error: serviceErr.message });
      }
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 14. PATCH /api/pipeline/points/:id/revision
 * Auth: requireAuth + Lead or Admin only
 * Body: { reason }
 */
router.patch('/points/:id/revision', authenticate, (req, res, next) => {
  try {
    const { reason } = req.body || {};
    try {
      const point = pipelineService.revisionPoint(req.params.id, req.user.id, reason);
      return res.status(200).json(point);
    } catch (serviceErr) {
      if (serviceErr.message.includes('Unauthorized')) {
        return res.status(403).json({ error: serviceErr.message });
      }
      if (serviceErr.message.includes('not found')) {
        return res.status(404).json({ error: serviceErr.message });
      }
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

// ===================================================================
// SECTION C: ADDENDUM & BUG TICKET RESOLUTION
// ===================================================================

/**
 * 15. PATCH /api/pipeline/addendum/:id/fulfill
 * Auth: requireAuth + Lead or Admin only
 * Body: { point_id }
 */
router.patch('/addendum/:id/fulfill', authenticate, (req, res, next) => {
  try {
    const { point_id } = req.body || {};
    try {
      const addendum = pipelineService.fulfillAddendum(req.params.id, point_id, req.user.id);
      return res.status(200).json(addendum);
    } catch (serviceErr) {
      if (serviceErr.message.includes('Unauthorized')) {
        return res.status(403).json({ error: serviceErr.message });
      }
      if (serviceErr.message.includes('not found')) {
        return res.status(404).json({ error: serviceErr.message });
      }
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * 16. PATCH /api/pipeline/addendum/:id/reject
 * Auth: requireAuth + Admin only
 * Body: { reason }
 */
router.patch('/addendum/:id/reject', authenticate, (req, res, next) => {
  try {
    const { reason } = req.body || {};
    try {
      const addendum = pipelineService.rejectAddendum(req.params.id, reason, req.user.id);
      return res.status(200).json(addendum);
    } catch (serviceErr) {
      if (serviceErr.message.includes('Unauthorized')) {
        return res.status(403).json({ error: serviceErr.message });
      }
      if (serviceErr.message.includes('not found')) {
        return res.status(404).json({ error: serviceErr.message });
      }
      return res.status(400).json({ error: serviceErr.message });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
