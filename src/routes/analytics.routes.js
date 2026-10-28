/**
 * PRD 23 — Analytics & KPI Dashboard API Routes
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as analyticsService from '../services/analyticsService.js';

const router = express.Router();

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
    msg.includes('Admin')
  ) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes('Unauthorized')) {
    return res.status(401).json({ error: msg });
  }
  if (
    msg.includes('already exists') ||
    msg.includes('UNIQUE constraint failed')
  ) {
    return res.status(409).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  const role = String(req.user.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden: Admin role required for KPI operations' });
  }
  next();
}

// -----------------------------------------------------------------------------
// KPI Definition Routes (Admin+)
// -----------------------------------------------------------------------------

/**
 * POST /api/analytics/kpi/create
 * Creates a new KPI definition and takes an initial snapshot
 */
router.post('/kpi/create', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.createKpiDefinition(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/kpis
 * Returns all active KPI definitions joined with their latest snapshot
 */
router.get('/kpis', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getKpis(req.query, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/kpi/:kpiId
 * Returns single KPI definition + last 30 snapshots
 */
router.get('/kpi/:kpiId', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getKpiById(req.params.kpiId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/analytics/kpi/:kpiId
 * Updates an existing KPI definition with manual updated_at maintenance
 */
router.patch('/kpi/:kpiId', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.updateKpiDefinition(req.params.kpiId, req.body, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * DELETE /api/analytics/kpi/:kpiId
 * Deletes a custom KPI definition (blocks seeded KPIs with 400 Bad Request)
 */
router.delete('/kpi/:kpiId', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.deleteKpiDefinition(req.params.kpiId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/analytics/kpi/:kpiId/refresh
 * Forces immediate calculation and snapshot insert for a KPI
 */
router.post('/kpi/:kpiId/refresh', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.refreshKpi(req.params.kpiId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// =============================================================================
// Dashboard Routes (Layer 3)
// =============================================================================

/**
 * POST /api/analytics/dashboard/create
 * Role: All (PERSONAL), Admin+ (TEAM/COMPANY)
 */
router.post('/dashboard/create', authenticate, async (req, res) => {
  try {
    const result = analyticsService.createDashboard(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/dashboards
 * Role: All (returns dashboards visible to current user based on scope & role)
 */
router.get('/dashboards', authenticate, async (req, res) => {
  try {
    const result = analyticsService.getDashboards(req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/dashboard/:dashboardId
 * Role: Scoped by role and dashboard scope
 */
router.get('/dashboard/:dashboardId', authenticate, async (req, res) => {
  try {
    const result = analyticsService.getDashboardById(req.params.dashboardId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/analytics/dashboard/:dashboardId
 * Role: Owner or Admin+
 */
router.patch('/dashboard/:dashboardId', authenticate, async (req, res) => {
  try {
    const result = analyticsService.updateDashboard(req.params.dashboardId, req.body, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * DELETE /api/analytics/dashboard/:dashboardId
 * Role: Owner or Admin+ (cannot delete sole COMPANY dashboard)
 */
router.delete('/dashboard/:dashboardId', authenticate, async (req, res) => {
  try {
    const result = analyticsService.deleteDashboard(req.params.dashboardId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// =============================================================================
// Widget Routes (Layer 3)
// =============================================================================

/**
 * POST /api/analytics/widget/create
 * Role: Dashboard owner or Admin+
 */
router.post('/widget/create', authenticate, async (req, res) => {
  try {
    const result = analyticsService.createWidget(req.body, req.user);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/analytics/widget/:widgetId
 * Role: Dashboard owner or Admin+
 */
router.patch('/widget/:widgetId', authenticate, async (req, res) => {
  try {
    const result = analyticsService.updateWidget(req.params.widgetId, req.body, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * DELETE /api/analytics/widget/:widgetId
 * Role: Dashboard owner or Admin+
 */
router.delete('/widget/:widgetId', authenticate, async (req, res) => {
  try {
    const result = analyticsService.deleteWidget(req.params.widgetId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// =============================================================================
// KPI Alert Routes (Layer 4)
// =============================================================================

/**
 * GET /api/analytics/alerts
 * Returns unacknowledged KPI alerts (Admin sees all; Member sees accessible dashboard KPIs only)
 * Role: Authenticated (scoped)
 */
router.get('/alerts', authenticate, async (req, res) => {
  try {
    const result = analyticsService.getKpiAlerts(req.query, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/analytics/alert/:alertId/acknowledge
 * Acknowledges a KPI alert
 * Role: Admin+ only
 */
router.patch('/alert/:alertId/acknowledge', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.acknowledgeKpiAlert(req.params.alertId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// =============================================================================
// KPI Snapshot History Route (Layer 4)
// =============================================================================

/**
 * GET /api/analytics/kpi/:kpiId/snapshots
 * Returns paginated snapshots for a KPI
 * Role: Admin+ only
 */
router.get('/kpi/:kpiId/snapshots', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getKpiSnapshots(req.params.kpiId, req.query, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// =============================================================================
// Report & Export Routes (Layer 4)
// =============================================================================

/**
 * GET /api/analytics/report/sprint/:projectId?
 * Returns sprint analytics (velocity, burndown, completion rate)
 * Role: Admin+ only
 */
router.get('/report/sprint', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getSprintAnalyticsReport(null, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

router.get('/report/sprint/:projectId', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getSprintAnalyticsReport(req.params.projectId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/report/okr
 * Returns OKR progress report summary
 * Role: Admin+ only
 */
router.get('/report/okr', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getOkrProgressReport(req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/report/time
 * Returns time tracking summary report
 * Role: Admin+ only
 */
router.get('/report/time', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getTimeAnalyticsReport(req.query, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/report/workload
 * Returns workload utilization report
 * Role: Admin+ only
 */
router.get('/report/workload', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getWorkloadAnalyticsReport(req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/summary/company
 * Returns company-wide KPI summary cards (10 built-in KPIs)
 * Role: Admin+ only
 */
router.get('/summary/company', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.getCompanyKpiSummary(req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/analytics/report/export
 * Exports report in JSON or RFC 4180 CSV format (append-only audit logged)
 * Role: Admin+ only
 */
router.post('/report/export', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = analyticsService.exportAnalyticsReport(req.body, req.query, req.user);
    if (result.export_format === 'CSV' || result.csv) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${(req.body.report_type || 'analytics').toLowerCase()}_report.csv"`);
      return res.status(200).send(result.csv);
    }
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/report/export
 * Exports company-wide or filtered report
 * Role: Admin+ only
 */
router.get('/report/export', authenticate, requireAdmin, async (req, res) => {
  try {
    const data = {
      project_id: req.query.project_id || null,
      report_type: req.query.report_type || 'KPI_SUMMARY',
      export_format: req.query.format || (req.headers.accept?.includes('text/csv') ? 'CSV' : 'JSON')
    };
    const result = analyticsService.exportAnalyticsReport(data, req.query, req.user);
    if (result.export_format === 'CSV' || result.csv) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${data.report_type.toLowerCase()}_report.csv"`);
      return res.status(200).send(result.csv);
    }
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/analytics/report/export/:projectId
 * Exports project-scoped report
 * Role: Admin+ only
 */
router.get('/report/export/:projectId', authenticate, requireAdmin, async (req, res) => {
  try {
    const data = {
      project_id: req.params.projectId,
      report_type: req.query.report_type || 'KPI_SUMMARY',
      export_format: req.query.format || (req.headers.accept?.includes('text/csv') ? 'CSV' : 'JSON')
    };
    const result = analyticsService.exportAnalyticsReport(data, req.query, req.user);
    if (result.export_format === 'CSV' || result.csv) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${data.report_type.toLowerCase()}_report.csv"`);
      return res.status(200).send(result.csv);
    }
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;
