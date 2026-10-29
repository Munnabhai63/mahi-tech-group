import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as okrService from '../services/okrService.js';

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
// OKR OBJECTIVE ROUTES (PRD 19 — Layer 2)
// ===================================================================

/**
 * 1. POST /api/okr/objective/create
 * Body: { title, description, level, project_id, cycle, parent_objective_id, owner_id, status }
 * Role: Admin+ for COMPANY/TEAM level; Member for own INDIVIDUAL
 */
router.post(['/objective/create', '/objectives', '/objective', '/'], authenticate, (req, res) => {
  try {
    const {
      title,
      description,
      level,
      project_id,
      cycle,
      parent_objective_id,
      owner_id,
      status
    } = req.body || {};

    const objective = okrService.createObjective({
      title,
      description,
      level,
      project_id,
      cycle,
      parent_objective_id,
      owner_id,
      status,
      user: req.user
    });

    return res.status(201).json(objective);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 2. GET /api/okr/objectives
 * Query: level, cycle, project_id, status, owner_id
 * Returns: all objectives (filtered by level, cycle, project_id via query params)
 * Role: All (Rule 8: Member can only see own INDIVIDUAL objectives)
 */
router.get('/objectives', authenticate, (req, res) => {
  try {
    const { level, cycle, project_id, status, owner_id } = req.query || {};
    const objectives = okrService.getObjectives({
      level,
      cycle,
      project_id,
      status,
      owner_id,
      user: req.user
    });

    return res.status(200).json(objectives);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 3. GET /api/okr/dashboard
 * Returns: company OKRs + team OKRs + my OKRs + overall progress summary
 * Role: All (filtered by role)
 */
router.get('/dashboard', authenticate, (req, res) => {
  try {
    const { cycle } = req.query;
    const dashboard = okrService.getOkrDashboard(cycle, req.user);
    return res.status(200).json(dashboard);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 4. GET /api/okr/alignment
 * Returns: full company-wide alignment tree for current cycle
 * Role: Admin+
 */
router.get('/alignment', authenticate, (req, res) => {
  try {
    const cycle = req.query.cycle || 'Q1-2026';
    const tree = okrService.getCompanyAlignmentTree(cycle, req.user);
    return res.status(200).json(tree);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 4. POST /api/okr/alignment/link
 * Body: { child_objective_id, parent_objective_id }
 * Role: Admin+
 */
router.post('/alignment/link', authenticate, (req, res) => {
  try {
    const { child_objective_id, parent_objective_id } = req.body || {};
    if (!child_objective_id || !parent_objective_id) {
      return res.status(400).json({ error: 'Both child_objective_id and parent_objective_id are required' });
    }

    const link = okrService.createAlignmentLink({
      child_objective_id,
      parent_objective_id,
      user: req.user
    });

    return res.status(201).json(link);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 5. GET /api/okr/cycle/:cycle
 * Returns: all objectives for given cycle (e.g. Q1-2026)
 * Role: All (filtered by role)
 */
router.get('/cycle/:cycle', authenticate, (req, res) => {
  try {
    const { cycle } = req.params;
    const objectives = okrService.getObjectives({
      cycle,
      user: req.user
    });

    return res.status(200).json(objectives);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 6. GET /api/okr/member/:userId
 * Returns: all individual OKRs for a specific member
 * Role: Admin+ or own user
 */
router.get('/member/:userId', authenticate, (req, res) => {
  try {
    const { userId } = req.params;
    const objectives = okrService.getMemberObjectives(userId, req.user);
    return res.status(200).json(objectives);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 7. GET /api/okr/history/:entityType/:entityId
 * Returns: full change history for objective or KR
 * Role: Admin+
 */
router.get('/history/:entityType/:entityId', authenticate, (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const history = okrService.getOkrHistory(entityType, entityId, req.user);
    return res.status(200).json(history);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 8. GET /api/okr/objective/:objectiveId/tree
 * Returns: full alignment tree (parent chain + child objectives)
 * Role: All
 */
router.get('/objective/:objectiveId/tree', authenticate, (req, res) => {
  try {
    const { objectiveId } = req.params;
    const tree = okrService.getObjectiveTree(objectiveId, req.user);
    return res.status(200).json(tree);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 9. GET /api/okr/objective/:objectiveId
 * Returns: objective detail + all key results + progress_pct
 * Role: All
 */
router.get('/objective/:objectiveId', authenticate, (req, res) => {
  try {
    const { objectiveId } = req.params;
    const objective = okrService.getObjectiveById(objectiveId, req.user);
    return res.status(200).json(objective);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 10. PATCH /api/okr/objective/:objectiveId
 * Body: any editable field
 * Rule: auto-logs to okr_history
 * Role: Admin+ or owner (own INDIVIDUAL only)
 */
router.patch('/objective/:objectiveId', authenticate, (req, res) => {
  try {
    const { objectiveId } = req.params;
    const updated = okrService.updateObjective(objectiveId, req.body || {}, req.user);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 11. PATCH /api/okr/objective/:objectiveId/archive
 * Rule: status → ARCHIVED, all KRs frozen
 * Role: Admin+
 */
router.patch('/objective/:objectiveId/archive', authenticate, (req, res) => {
  try {
    const { objectiveId } = req.params;
    const archived = okrService.archiveObjective(objectiveId, req.user);
    return res.status(200).json(archived);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 12. DELETE /api/okr/objective/:objectiveId
 * Rule: only DRAFT status deletable, cannot be deleted if it has Key Results
 * Role: Admin+
 */
router.delete('/objective/:objectiveId', authenticate, (req, res) => {
  try {
    const { objectiveId } = req.params;
    const result = okrService.deleteObjective(objectiveId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// KEY RESULT ROUTES (PRD 19 — Layer 3)
// ===================================================================

/**
 * 13. POST /api/okr/kr/create
 * Body: { objective_id, title, description, type, target_value, unit, assigned_to, due_date }
 * Role: Admin+ or objective owner
 */
router.post(['/kr/create', '/key-results', '/objectives/:objectiveId/key-results'], authenticate, (req, res) => {
  try {
    const objectiveId = req.params.objectiveId || req.body.objective_id;
    const kr = okrService.createKeyResult({
      ...req.body,
      objective_id: objectiveId,
      user: req.user
    });
    return res.status(201).json(kr);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 14. GET /api/okr/kr/:krId
 * Returns: KR detail + all check-ins
 * Role: All
 */
router.get('/kr/:krId', authenticate, (req, res) => {
  try {
    const { krId } = req.params;
    const kr = okrService.getKeyResultById(krId, req.user);
    return res.status(200).json(kr);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 15. PATCH /api/okr/kr/:krId
 * Body: any editable field (title, description, type, target_value, unit, assigned_to, due_date, status)
 * Rule: auto-logs to okr_history
 * Role: Admin+ or KR assignee (or objective owner)
 */
router.patch('/kr/:krId', authenticate, (req, res) => {
  try {
    const { krId } = req.params;
    const updated = okrService.updateKeyResult(krId, req.body || {}, req.user);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 16. DELETE /api/okr/kr/:krId
 * Rule: only if parent objective is DRAFT
 * Role: Admin+
 */
router.delete('/kr/:krId', authenticate, (req, res) => {
  try {
    const { krId } = req.params;
    const result = okrService.deleteKeyResult(krId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// CHECK-IN ROUTES (PRD 19 — Layer 4)
// ===================================================================

/**
 * 17. POST /api/okr/checkin/submit
 * Body: { key_result_id, new_value, confidence, note }
 * Rule: updates KR current_value, recalculates KR progress_pct,
 *       recalculates parent Objective progress_pct automatically & propagates up parent chain
 * Role: KR assignee, Objective owner, or Admin+
 */
router.post(['/checkin/submit', '/checkins', '/checkin', '/kr/:krId/check-in', '/kr/:krId/checkin'], authenticate, (req, res) => {
  try {
    const key_result_id = req.params.krId || req.body.key_result_id || req.body.kr_id;
    const { new_value, confidence, note } = req.body || {};
    const result = okrService.submitCheckin({
      key_result_id,
      new_value,
      confidence,
      note,
      user: req.user
    });
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 18. GET /api/okr/checkins/:krId
 * Returns: all check-ins for a Key Result (chronological)
 * Role: All (Rule 8: If individual objective, only owner or Admin+)
 */
router.get('/checkins/:krId', authenticate, (req, res) => {
  try {
    const { krId } = req.params;
    const checkins = okrService.getCheckinsByKrId(krId, req.user);
    return res.status(200).json(checkins);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;
