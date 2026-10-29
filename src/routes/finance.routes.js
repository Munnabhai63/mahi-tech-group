/**
 * src/routes/finance.routes.js
 * PRD 25: Budget & Financial Management API Routes
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as financeService from '../services/financeService.js';

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
    msg.includes('Access Revoked')
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
    return res.status(400).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ===================================================================
// BUDGET ROUTES (LAYER 2)
// ===================================================================

/**
 * POST /api/finance/budget/create
 * Creates a project budget. One budget per project enforced.
 * Role: Admin+
 */
router.post('/budget/create', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.createBudget(req.body, req.user, ipAddress);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/budget/:projectId
 * Returns budget detail + current consumption breakdown + active alerts.
 * Role: Admin+
 */
router.get('/budget/:projectId', authenticate, (req, res) => {
  try {
    const result = financeService.getBudgetByProjectId(req.params.projectId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/budget/:projectId
 * Updates project budget. Mandatory reason (min 10 chars) auto-logged to budget_history.
 * Role: Admin+
 */
router.patch('/budget/:projectId', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.updateBudget(req.params.projectId, req.body, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/budget/:projectId/history
 * Returns full append-only budget_history for project.
 * Role: Admin+
 */
router.get('/budget/:projectId/history', authenticate, (req, res) => {
  try {
    const result = financeService.getBudgetHistory(req.params.projectId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// EXPENSE CATEGORY ROUTES (LAYER 3)
// ===================================================================

/**
 * POST /api/finance/category/create
 * Creates an expense category.
 * Role: Admin+
 */
router.post('/category/create', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.createCategory(req.body, req.user, ipAddress);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/categories
 * Returns active expense categories.
 * Role: All authenticated members
 */
router.get('/categories', authenticate, (req, res) => {
  try {
    const options = { all: req.query.all === 'true' };
    const categories = financeService.getCategories(req.user, options);
    return res.status(200).json({ categories });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/category/:categoryId
 * Updates expense category.
 * Role: Admin+
 */
router.patch('/category/:categoryId', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.updateCategory(req.params.categoryId, req.body, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// EXPENSE ROUTES (LAYER 3)
// ===================================================================

/**
 * POST /api/finance/expense/submit
 * Submits an expense for a project with status = 'PENDING'.
 * Role: All authenticated members (submits own expense)
 */
router.post('/expense/submit', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.submitExpense(req.body, req.user, ipAddress);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/expenses/project/:projectId
 * Returns all expenses for a project with filters.
 * STRICT RULE: Admin+ only. Regular members strictly blocked (403).
 */
router.get('/expenses/project/:projectId', authenticate, (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      category_id: req.query.category_id,
      from: req.query.from,
      to: req.query.to,
      submitted_by: req.query.submitted_by
    };
    const result = financeService.getProjectExpenses(req.params.projectId, filters, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/expenses/my
 * Returns only current user's submitted expenses.
 * STRICT RULE: Members can only submit/view their own expenses — never others.
 * Role: All authenticated members
 */
router.get('/expenses/my', authenticate, (req, res) => {
  try {
    const filters = {
      project_id: req.query.project_id,
      status: req.query.status
    };
    const result = financeService.getMyExpenses(filters, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/expense/:expenseId
 * Returns single expense detail.
 * Role: Admin+ or Owner
 */
router.get('/expense/:expenseId', authenticate, (req, res) => {
  try {
    const result = financeService.getExpenseById(req.params.expenseId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/expense/:expenseId/history
 * Returns full append-only audit trail for an expense.
 * Role: Admin+ or Owner
 */
router.get('/expense/:expenseId/history', authenticate, (req, res) => {
  try {
    const result = financeService.getExpenseHistory(req.params.expenseId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/expense/:expenseId/approve
 * Approves an expense, triggers budget recalculation and alert checks.
 * Role: Admin+
 */
router.patch(['/expense/:expenseId/approve', '/expenses/:expenseId/approve'], authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.approveExpense(req.params.expenseId, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/expense/:expenseId/reject
 * Rejects an expense with mandatory reason (min 10 chars).
 * Role: Admin+
 */
router.patch('/expense/:expenseId/reject', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.rejectExpense(req.params.expenseId, req.body, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/expense/:expenseId
 * Modifies an expense. Only PENDING expenses can be edited.
 * Role: Owner or Admin+
 */
router.patch('/expense/:expenseId', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.updateExpense(req.params.expenseId, req.body, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// INVOICE ROUTES (LAYER 4)
// ===================================================================

/**
 * POST /api/finance/invoice/create
 * Creates an invoice in DRAFT status. Invoice number auto-generated server-side.
 * Role: Admin+
 */
router.post('/invoice/create', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.createInvoice(req.body, req.user, ipAddress);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/finance/invoice/:invoiceId/line-item/add
 * Adds a line item to a DRAFT invoice. Amount computed server-side.
 * Role: Admin+
 */
router.post('/invoice/:invoiceId/line-item/add', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.addInvoiceLineItem(req.params.invoiceId, req.body, req.user, ipAddress);
    return res.status(201).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/invoices/project/:projectId
 * Returns all invoices for a project.
 * Role: Admin+
 */
router.get('/invoices/project/:projectId', authenticate, (req, res) => {
  try {
    const result = financeService.getProjectInvoices(req.params.projectId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/invoice/:invoiceId
 * Returns invoice detail + line items.
 * Query: ?client_view=true strips internal_notes for client-facing view.
 * Role: Admin+ or Client
 */
router.get('/invoice/:invoiceId', authenticate, (req, res) => {
  try {
    const options = {
      clientView: req.query.client_view === 'true'
    };
    const result = financeService.getInvoiceById(req.params.invoiceId, req.user, options);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/invoice/:invoiceId/send
 * Transitions invoice from DRAFT -> SENT.
 * Role: Admin+
 */
router.patch('/invoice/:invoiceId/send', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.sendInvoice(req.params.invoiceId, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/invoice/:invoiceId/mark-paid
 * Marks invoice as PAID and records payment details.
 * Role: Admin+
 */
router.patch('/invoice/:invoiceId/mark-paid', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.markInvoiceAsPaid(req.params.invoiceId, req.body, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/invoice/:invoiceId/cancel
 * Cancels an invoice (only DRAFT, SENT, VIEWED, or OVERDUE invoices).
 * Role: Admin+
 */
router.patch('/invoice/:invoiceId/cancel', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.cancelInvoice(req.params.invoiceId, req.body, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/invoice/:invoiceId/view
 * Marks invoice as VIEWED if status is SENT.
 */
router.patch('/invoice/:invoiceId/view', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const invoice = financeService.recordInvoiceViewed(req.params.invoiceId, req.user, ipAddress);
    return res.status(200).json({ message: 'Invoice marked as viewed', invoice });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/finance/cron/overdue-check
 * Daily cron handler: auto-transitions SENT/VIEWED invoices past due_date to OVERDUE.
 * Role: Admin+
 */
router.post('/cron/overdue-check', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.processOverdueInvoices(req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// FINANCIAL REPORTS & ALERTS ROUTES (LAYER 5)
// ===================================================================

/**
 * GET /api/finance/dashboard
 * Returns company-wide financial rollup across all projects.
 * Role: Admin+
 */
router.get('/dashboard', authenticate, (req, res) => {
  try {
    const result = financeService.getFinancialDashboard(req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/report/project/:projectId
 * Returns detailed P&L and category breakdown for a project.
 * Role: Admin+
 */
router.get('/report/project/:projectId', authenticate, (req, res) => {
  try {
    const result = financeService.getProjectReport(req.params.projectId, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/alerts
 * Returns all unacknowledged and acknowledged budget alerts.
 * Role: Admin+
 */
router.get('/alerts', authenticate, (req, res) => {
  try {
    const result = financeService.getBudgetAlerts(req.user, req.query);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * PATCH /api/finance/alert/:alertId/acknowledge
 * Sets acknowledged_by and acknowledged_at. Append-only (DELETE blocked).
 * Role: Admin+
 */
router.patch('/alert/:alertId/acknowledge', authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.acknowledgeBudgetAlert(req.params.alertId, req.user, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * POST /api/finance/report/export
 * Exports financial report (JSON or CSV) and logs audit record to analytics_report_exports.
 * Role: Admin+
 */
router.post(['/report/export', '/export'], authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.exportFinancialReport(req.body || {}, req.user, ipAddress);
    if (result.export_format === 'CSV' && result.csv) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="financial_report_${Date.now()}.csv"`);
      return res.status(200).send(result.csv);
    }
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * GET /api/finance/report/export
 * GET variant for direct browser downloads.
 * Role: Admin+
 */
router.get(['/report/export', '/export'], authenticate, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = financeService.exportFinancialReport(req.query || {}, req.user, ipAddress);
    if (result.export_format === 'CSV' && result.csv) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="financial_report_${Date.now()}.csv"`);
      return res.status(200).send(result.csv);
    }
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;



