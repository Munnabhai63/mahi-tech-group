import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as workloadService from '../services/workloadService.js';

const router = express.Router();

/**
 * Maps domain and service errors to appropriate HTTP status codes
 */
function handleServiceError(res, err) {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  const msg = err.message || 'An error occurred';
  if (msg.toLowerCase().includes('not found')) {
    return res.status(404).json({ error: msg });
  }
  if (
    msg.includes('Forbidden') ||
    msg.includes('role required') ||
    msg.includes('permission') ||
    msg.includes('own capacity') ||
    msg.includes('own availability')
  ) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes('Unauthorized')) {
    return res.status(401).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ===================================================================
// CAPACITY ROUTES (LAYER 2)
// ===================================================================

/**
 * POST /api/workload/capacity/set
 * Sets a member's weekly capacity hours (append-only)
 * Role: Admin+
 */
router.post('/capacity/set', authenticate, (req, res) => {
  try {
    const result = workloadService.setMemberCapacity(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/workload/capacity/:userId
 * Retrieves current active capacity + history
 * Role: Admin+ or own member
 */
router.get('/capacity/:userId', authenticate, (req, res) => {
  try {
    const data = workloadService.getMemberCapacity(req.params.userId, req.user);
    return res.status(200).json(data);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// AVAILABILITY ROUTES (LAYER 2)
// ===================================================================

/**
 * POST /api/workload/availability/set
 * Submits planned leave, holiday, training, or partial availability
 * Role: Admin+ or own member (future dates only for members)
 */
router.post('/availability/set', authenticate, (req, res) => {
  try {
    const result = workloadService.setMemberAvailability(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/workload/availability/:userId
 * Retrieves all availability records for a member
 * Role: Admin+ or own member
 */
router.get('/availability/:userId', authenticate, (req, res) => {
  try {
    const data = workloadService.getMemberAvailability(req.params.userId, req.user);
    return res.status(200).json(data);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/workload/availability/:availabilityId/approve
 * Approves a pending availability entry (e.g. LEAVE)
 * Role: Admin+
 */
router.patch('/availability/:availabilityId/approve', authenticate, (req, res) => {
  try {
    const result = workloadService.approveAvailability(req.params.availabilityId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// UTILIZATION CALCULATION & ALERTS (SERVER-SIDE MATH)
// ===================================================================

/**
 * POST /api/workload/utilization/calculate
 * 100% Server-side utilization math. Formula: (allocated_hours / available_hours) * 100
 * Accepts either:
 *  - { allocated_hours, available_hours }
 *  OR
 *  - { user_id, week_start_date, allocated_hours } (auto-calculates available_hours from capacity & leaves)
 * Role: Admin+ or own member
 */
router.post('/utilization/calculate', authenticate, (req, res) => {
  try {
    const { user_id, week_start_date, allocated_hours, available_hours } = req.body;

    let available = available_hours;
    let capacityInfo = null;

    if (user_id && week_start_date) {
      if (!workloadService.isAdmin(req.user) && String(req.user.id) !== String(user_id)) {
        return res.status(403).json({ error: 'Forbidden: You can only query your own utilization' });
      }
      capacityInfo = workloadService.calculateMemberWeeklyAvailability(user_id, week_start_date);
      available = capacityInfo.available_hours;
    }

    const result = workloadService.calculateUtilization(allocated_hours, available);
    return res.status(200).json({
      ...result,
      capacity_info: capacityInfo
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/workload/alerts/evaluate
 * Evaluates utilization and automatically generates alerts (>100% overload or <30% underload)
 * Role: Admin+
 */
router.post('/alerts/evaluate', authenticate, (req, res) => {
  try {
    if (!workloadService.isAdmin(req.user)) {
      return res.status(403).json({ error: 'Forbidden: Admin role required to evaluate alerts' });
    }

    const { user_id, week_start_date, allocated_hours, available_hours } = req.body;
    if (!user_id || !week_start_date) {
      return res.status(400).json({ error: 'user_id and week_start_date are required' });
    }

    let available = available_hours;
    if (available === undefined) {
      const capacityInfo = workloadService.calculateMemberWeeklyAvailability(user_id, week_start_date);
      available = capacityInfo.available_hours;
    }

    const result = workloadService.evaluateAndCreateWorkloadAlert(
      user_id,
      week_start_date,
      allocated_hours,
      available
    );

    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/workload/alerts
 * Lists active workload alerts
 * Role: Admin+
 */
router.get('/alerts', authenticate, (req, res) => {
  try {
    const unack = req.query.unacknowledged !== 'false';
    const result = workloadService.getWorkloadAlerts(req.user, { unacknowledgedOnly: unack });
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/workload/alert/:alertId/acknowledge
 * Acknowledges an active workload alert
 * Role: Admin+
 */
router.patch('/alert/:alertId/acknowledge', authenticate, (req, res) => {
  try {
    const result = workloadService.acknowledgeAlert(req.params.alertId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// WORKLOAD ASSIGNMENT & TEAM UTILIZATION ROUTES (LAYER 3)
// ===================================================================

/**
 * POST /api/workload/assignment/create
 * Creates a new workload assignment
 * Role: Admin+
 */
router.post('/assignment/create', authenticate, (req, res) => {
  try {
    const result = workloadService.createAssignment(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/workload/assignments/:userId
 * Retrieves all active assignments for a member
 * Role: Admin+ or own member
 */
router.get('/assignments/:userId', authenticate, (req, res) => {
  try {
    const { status = 'ACTIVE', projectId } = req.query;
    const result = workloadService.getMemberAssignments(req.params.userId, req.user, {
      status,
      projectId
    });
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/workload/assignment/:assignmentId
 * Updates estimated hours, date range, status, or title
 * Role: Admin+
 */
router.patch('/assignment/:assignmentId', authenticate, (req, res) => {
  try {
    const result = workloadService.updateAssignment(req.params.assignmentId, req.body, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * DELETE /api/workload/assignment/:assignmentId
 * Deletes a workload assignment
 * Role: Admin+
 */
router.delete('/assignment/:assignmentId', authenticate, (req, res) => {
  try {
    const result = workloadService.deleteAssignment(req.params.assignmentId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/workload/prorate/calculate
 * Helper route to compute multi-week proration math
 * Server-side calculation
 */
router.post('/prorate/calculate', authenticate, (req, res) => {
  try {
    const { start_date, end_date, week_start_date, estimated_hrs } = req.body;
    if (!start_date || !end_date || !week_start_date) {
      return res.status(400).json({ error: 'start_date, end_date, and week_start_date are required' });
    }
    const prorated = workloadService.calculateProratedHours(
      start_date,
      end_date,
      week_start_date,
      estimated_hrs
    );
    return res.status(200).json({
      start_date,
      end_date,
      week_start: workloadService.getWeekStart(week_start_date),
      week_end: workloadService.getWeekEnd(week_start_date),
      full_estimated_hrs: Number(estimated_hrs || 0),
      prorated_week_hrs: prorated
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/workload/member/workload/:userId
 * Retrieves full weekly workload breakdown for a single member
 * Role: Admin+ or own member
 */
router.get('/member/workload/:userId', authenticate, (req, res) => {
  try {
    if (!workloadService.isAdmin(req.user) && String(req.user.id) !== String(req.params.userId)) {
      return res.status(403).json({ error: 'Forbidden: You can only view your own workload breakdown' });
    }
    const weekStart = req.query.week_start_date || new Date().toISOString().split('T')[0];
    const result = workloadService.getMemberWeeklyWorkload(req.params.userId, weekStart);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/workload/team/:projectId
 * Team-wide utilization aggregation across all project members
 * Role: Admin+
 */
router.get('/team/:projectId', authenticate, (req, res) => {
  try {
    const weekStart = req.query.week_start_date || new Date().toISOString().split('T')[0];
    const result = workloadService.getTeamWorkload(req.params.projectId, weekStart, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;

