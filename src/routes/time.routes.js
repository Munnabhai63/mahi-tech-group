import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as timeTrackingService from '../services/timeTrackingService.js';

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
    msg.includes('only stop your own') ||
    msg.includes('only submit your own') ||
    msg.includes('locked immediately')
  ) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes('Unauthorized')) {
    return res.status(401).json({ error: msg });
  }
  if (
    msg.includes('already has an active') ||
    msg.includes('already has a pending') ||
    msg.includes('overlaps with') ||
    msg.includes('UNIQUE constraint failed')
  ) {
    return res.status(409).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ===================================================================
// TIMER ROUTES (LAYER 2)
// ===================================================================

/**
 * POST /api/time/timer/start
 * Starts a live stopwatch timer for the authenticated user
 * Role: All
 */
router.post('/timer/start', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.startTimer(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/time/timer/stop
 * Stops the running timer, calculates duration & billable amount, updates entry
 * Role: All (own timer only)
 */
router.post('/timer/stop', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.stopTimer(req.body, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/timer/status
 * Returns current running timer status for the authenticated user
 * Role: All
 */
router.get('/timer/status', authenticate, (req, res) => {
  try {
    const status = timeTrackingService.getTimerStatus(req.user.id);
    return res.status(200).json(status);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// BILLABLE RATE ROUTES (FOUNDATION FOR RESOLUTION)
// ===================================================================

/**
 * POST /api/time/rate/set
 * Sets a member default rate or project override rate
 * Role: Admin+
 */
router.post('/rate/set', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.setBillableRate(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/rate/member/:userId
 * Retrieves rate history for a member
 * Role: Admin+
 */
router.get('/rate/member/:userId', authenticate, (req, res) => {
  try {
    const data = timeTrackingService.getMemberRates(req.params.userId, req.user);
    return res.status(200).json(data);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/rate/project/:projectId
 * Retrieves rate override history for a project
 * Role: Admin+
 */
router.get('/rate/project/:projectId', authenticate, (req, res) => {
  try {
    const data = timeTrackingService.getProjectRates(req.params.projectId, req.user);
    return res.status(200).json(data);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/entry/:entryId
 * Retrieves a single time entry
 * Role: Owner or Admin+
 */
router.get('/entry/:entryId', authenticate, (req, res) => {
  try {
    const entry = timeTrackingService.getTimeEntryById(req.params.entryId, req.user);
    return res.status(200).json({ success: true, time_entry: entry });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// MANUAL ENTRY & TIMESHEET ROUTES (LAYER 3)
// ===================================================================

/**
 * POST /api/time/entry/create
 * Creates a manual time entry for the authenticated user
 * Role: All
 */
router.post('/entry/create', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.createManualEntry(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/time/entry/:entryId
 * Updates an existing time entry (24hr limit for manual owner, Admin anytime)
 * Role: Owner (24hr limit) or Admin+
 */
router.patch('/entry/:entryId', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.updateTimeEntry(req.params.entryId, req.body, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * DELETE /api/time/entry/:entryId
 * Soft deletes a time entry (sets status = 'DELETED') and logs deletion reason
 * Role: Admin+ only
 */
router.delete('/entry/:entryId', authenticate, (req, res) => {
  try {
    const reason = req.body?.reason || req.query?.reason;
    const result = timeTrackingService.deleteTimeEntry(req.params.entryId, reason, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// REST Plural aliases for /entries
router.post('/entries', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.createManualEntry(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

router.patch('/entries/:entryId/approve', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.approveTimeEntry(req.params.entryId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

router.delete('/entries/:entryId', authenticate, (req, res) => {
  try {
    const reason = req.body?.reason || req.query?.reason || 'Verified test cleanup';
    const result = timeTrackingService.deleteTimeEntry(req.params.entryId, reason, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/entries/my
 * Retrieves own time entries with optional filters (project_id, from, to, status)
 * Role: All
 */
router.get('/entries/my', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.getMyTimeEntries(req.query, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/entries/project/:projectId
 * Retrieves all time entries for a project with optional filters (user_id, from, to, status)
 * Role: Admin+ only
 */
router.get('/entries/project/:projectId', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.getProjectTimeEntries(req.params.projectId, req.query, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// APPROVAL ROUTES (LAYER 4)
// ===================================================================

/**
 * POST /api/time/approval/request/:entryId
 * Submits a time entry for approval
 * Role: Owner of entry (or Admin)
 */
router.post('/approval/request/:entryId', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.requestApproval(req.params.entryId, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/time/approval/:requestId/approve
 * Approves a time entry request
 * Role: Admin+ only
 */
router.patch('/approval/:requestId/approve', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.approveTimeEntry(req.params.requestId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/time/approval/:requestId/reject
 * Rejects a time entry request with mandatory decision_note
 * Role: Admin+ only
 */
router.patch('/approval/:requestId/reject', authenticate, (req, res) => {
  try {
    const note = req.body?.decision_note || req.body?.reason;
    const result = timeTrackingService.rejectTimeEntry(req.params.requestId, note, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/approval/pending
 * Returns all PENDING approval requests
 * Role: Admin+ only
 */
router.get('/approval/pending', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.getPendingApprovals(req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// REPORT ROUTES (LAYER 4)
// ===================================================================

/**
 * GET /api/time/report/team
 * Retrieves aggregated team time report
 * Role: Admin+ only
 */
router.get('/report/team', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.getTeamTimeReport(req.query, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/report/my
 * Retrieves own time summary report
 * Role: All authenticated members
 */
router.get('/report/my', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.getMyTimeReport(req.query, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/time/report/snapshot
 * Creates a point-in-time snapshot of the report
 * Role: Admin+ only
 */
router.post('/report/snapshot', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.createReportSnapshot(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/report/snapshots/:projectId
 * Retrieves all report snapshots for a project
 * Role: Admin+ only
 */
router.get('/report/snapshots/:projectId', authenticate, (req, res) => {
  try {
    const result = timeTrackingService.getReportSnapshots(req.params.projectId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/time/report/export/:projectId
 * Returns CSV format with headers (or JSON if format=json)
 * Audit-logged in access_log
 * Role: Admin+ only
 */
router.get('/report/export/:projectId', authenticate, (req, res) => {
  try {
    const format = req.query?.format || (req.headers.accept?.includes('application/json') ? 'json' : 'csv');
    const data = timeTrackingService.exportTimeReportData(req.params.projectId, req.query, req.user);

    if (format === 'json') {
      return res.status(200).json({ success: true, ...data });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="time_report_${req.params.projectId}.csv"`);
    return res.status(200).send(data.csv);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;
