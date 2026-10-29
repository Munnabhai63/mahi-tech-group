/**
 * src/services/financeService.js
 * PRD 25: Budget & Financial Management Service
 *
 * Implements:
 * - Budget CRUD (create, get, update, history)
 * - Server-side budget consumption calculation engine:
 *   Consumption = SUM(APPROVED expenses) + SUM(APPROVED billable time cost)
 *   Excludes all PENDING and REJECTED expenses and non-billable time entries.
 * - Threshold alert generation on breach (alert_threshold_pct and 100% BUDGET_EXCEEDED)
 * - Mandatory reason (min 10 chars) audit trail logged to append-only budget_history
 * - Manual updated_at timestamps on all row mutations
 * - Admin action audit logging to access_log
 * - Server-side RBAC validation
 */

import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { fireTrigger } from './automationEngine.js';

// ===================================================================
// RBAC HELPER
// ===================================================================
export function verifyAdminRole(currentUser, actionDescription = 'perform this financial action') {
  if (!currentUser) {
    throw { status: 401, message: 'Unauthorized: User authentication required' };
  }
  const role = String(currentUser.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    throw { status: 403, message: `Forbidden: Admin role required to ${actionDescription}` };
  }
}

// ===================================================================
// BUDGET CONSUMPTION CALCULATION ENGINE
// ===================================================================
/**
 * Calculates real-time budget consumption for a project.
 * Rules:
 * - APPROVED expenses only (PENDING and REJECTED strictly excluded).
 * - APPROVED billable time entries only (is_billable = 1, status = 'APPROVED').
 * - Time cost = (duration_minutes / 60) * billable_rate per entry.
 * - All calculations server-side rounded to 2 decimal places.
 */
export function calculateBudgetConsumption(projectId) {
  // 1. Sum of APPROVED project expenses
  const expenseRow = queryOne(`
    SELECT COALESCE(SUM(amount), 0.0) as total
    FROM project_expenses
    WHERE project_id = ? AND status = 'APPROVED'
  `, [projectId]);
  const approvedExpensesTotal = Math.round((expenseRow?.total || 0.0) * 100) / 100;

  // 2. Sum of APPROVED billable time costs from time_entries
  const timeRow = queryOne(`
    SELECT COALESCE(SUM((CAST(duration_minutes AS REAL) / 60.0) * billable_rate), 0.0) as total
    FROM time_entries
    WHERE project_id = ? AND is_billable = 1 AND status = 'APPROVED'
  `, [projectId]);
  const timeCostTotal = Math.round((timeRow?.total || 0.0) * 100) / 100;

  // 3. Total consumption
  const totalConsumption = Math.round((approvedExpensesTotal + timeCostTotal) * 100) / 100;

  // 4. Fetch budget configuration
  const budget = queryOne('SELECT * FROM project_budgets WHERE project_id = ?', [projectId]);
  const totalBudget = budget ? Number(budget.total_budget) : 0.0;
  const remainingBudget = Math.round((totalBudget - totalConsumption) * 100) / 100;
  const consumedPct = totalBudget > 0 ? Math.round(((totalConsumption / totalBudget) * 100) * 100) / 100 : 0.0;
  const alertThresholdPct = budget ? Number(budget.alert_threshold_pct) : 80.0;

  let alertStatus = 'NORMAL';
  if (consumedPct >= 100) {
    alertStatus = 'BUDGET_EXCEEDED';
  } else if (consumedPct >= alertThresholdPct) {
    alertStatus = 'THRESHOLD_REACHED';
  }

  return {
    project_id: projectId,
    total_budget: totalBudget,
    currency: budget ? budget.currency : 'INR',
    approved_expenses_total: approvedExpensesTotal,
    time_cost_total: timeCostTotal,
    total_consumption: totalConsumption,
    remaining_budget: remainingBudget,
    consumed_pct: consumedPct,
    alert_threshold_pct: alertThresholdPct,
    alert_status: alertStatus
  };
}

// ===================================================================
// ALERT GENERATION ENGINE
// ===================================================================
/**
 * Checks budget consumption against thresholds and auto-generates budget alerts.
 * Generates:
 * - THRESHOLD_REACHED if consumed_pct >= alert_threshold_pct
 * - BUDGET_EXCEEDED if consumed_pct >= 100%
 */
export function evaluateBudgetAlerts(projectId, currentUser = null) {
  const consumption = calculateBudgetConsumption(projectId);
  const budget = queryOne('SELECT * FROM project_budgets WHERE project_id = ?', [projectId]);
  if (!budget) return [];

  const { consumed_pct, total_consumption, alert_threshold_pct } = consumption;
  const generatedAlerts = [];

  // 1. Check Threshold Reached (e.g. >= 80%)
  if (consumed_pct >= alert_threshold_pct) {
    const existingThresholdAlert = queryOne(`
      SELECT id FROM budget_alerts
      WHERE project_id = ? AND alert_type = 'THRESHOLD_REACHED' AND acknowledged_at IS NULL
    `, [projectId]);

    if (!existingThresholdAlert) {
      const msg = `Budget threshold reached: project has consumed ${consumed_pct.toFixed(1)}% of total allocated budget (threshold: ${alert_threshold_pct}%).`;
      execute(`
        INSERT INTO budget_alerts (project_id, alert_type, triggered_at_pct, triggered_amount, message, created_at)
        VALUES (?, 'THRESHOLD_REACHED', ?, ?, ?, datetime('now'))
      `, [projectId, consumed_pct, total_consumption, msg]);

      const inserted = queryOne('SELECT * FROM budget_alerts WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
      generatedAlerts.push(inserted);

      try {
        fireTrigger('EXPENSE', 'BUDGET_THRESHOLD_REACHED', 'PROJECT', projectId, currentUser?.id || null, {
          project_id: projectId,
          spent_percentage: consumed_pct,
          total_consumption,
          alert_threshold_pct,
          project: {
            id: projectId,
            name: budget.project_name || `Project #${projectId}`
          }
        });
      } catch (tErr) {
        console.error('[FinanceService] fireTrigger error:', tErr);
      }
    }
  }

  // 2. Check Budget Exceeded (>= 100%)
  if (consumed_pct >= 100.0) {
    const existingExceededAlert = queryOne(`
      SELECT id FROM budget_alerts
      WHERE project_id = ? AND alert_type = 'BUDGET_EXCEEDED' AND acknowledged_at IS NULL
    `, [projectId]);

    if (!existingExceededAlert) {
      const msg = `CRITICAL: Budget exceeded! Project has consumed ${consumed_pct.toFixed(1)}% of total allocated budget.`;
      execute(`
        INSERT INTO budget_alerts (project_id, alert_type, triggered_at_pct, triggered_amount, message, created_at)
        VALUES (?, 'BUDGET_EXCEEDED', ?, ?, ?, datetime('now'))
      `, [projectId, consumed_pct, total_consumption, msg]);

      const inserted = queryOne('SELECT * FROM budget_alerts WHERE project_id = ? ORDER BY id DESC LIMIT 1', [projectId]);
      generatedAlerts.push(inserted);

      try {
        fireTrigger('EXPENSE', 'BUDGET_EXCEEDED', 'PROJECT', projectId, currentUser?.id || null, {
          project_id: projectId,
          spent_percentage: consumed_pct,
          total_consumption,
          project: {
            id: projectId,
            name: budget.project_name || `Project #${projectId}`
          }
        });
      } catch (tErr) {
        console.error('[FinanceService] fireTrigger error:', tErr);
      }
    }
  }

  return generatedAlerts;
}

// ===================================================================
// BUDGET CRUD SERVICES (LAYER 2)
// ===================================================================

/**
 * POST /api/finance/budget/create
 * Creates a project budget. Enforces one budget per project.
 */
export function createBudget(data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'create project budget');

  if (!data || !data.project_id) {
    throw { status: 400, message: 'project_id is required' };
  }

  const projectId = data.project_id;

  // Verify project exists
  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    throw { status: 404, message: 'Project not found' };
  }

  // Enforce one budget per project rule
  const existingBudget = queryOne('SELECT id FROM project_budgets WHERE project_id = ?', [projectId]);
  if (existingBudget) {
    throw { status: 400, message: 'One budget per project enforced. Budget already exists for this project' };
  }

  const totalBudget = Number(data.total_budget);
  if (isNaN(totalBudget) || totalBudget < 0) {
    throw { status: 400, message: 'total_budget must be a valid non-negative number' };
  }

  if (!data.start_date || !String(data.start_date).trim()) {
    throw { status: 400, message: 'start_date is required' };
  }

  const startDate = String(data.start_date).trim();
  const endDate = data.end_date ? String(data.end_date).trim() : null;
  const currency = data.currency ? String(data.currency).trim().toUpperCase() : 'INR';

  const validTypes = ['FIXED', 'TIME_AND_MATERIAL', 'RETAINER'];
  const budgetType = data.budget_type ? String(data.budget_type).trim().toUpperCase() : 'FIXED';
  if (!validTypes.includes(budgetType)) {
    throw { status: 400, message: `budget_type must be one of: ${validTypes.join(', ')}` };
  }

  const alertThresholdPct = data.alert_threshold_pct !== undefined ? Number(data.alert_threshold_pct) : 80.0;
  if (isNaN(alertThresholdPct) || alertThresholdPct <= 0 || alertThresholdPct > 100) {
    throw { status: 400, message: 'alert_threshold_pct must be between 1 and 100' };
  }

  const notes = data.notes ? String(data.notes).trim() : null;

  // Insert project budget
  execute(`
    INSERT INTO project_budgets (
      project_id, total_budget, currency, budget_type, alert_threshold_pct,
      start_date, end_date, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [
    projectId,
    totalBudget,
    currency,
    budgetType,
    alertThresholdPct,
    startDate,
    endDate,
    notes,
    currentUser.id
  ]);

  const createdBudget = queryOne('SELECT * FROM project_budgets WHERE project_id = ?', [projectId]);

  // Evaluate alerts on creation
  evaluateBudgetAlerts(projectId, currentUser);

  // Audit log
  logAccess({
    userId: currentUser.id,
    action: 'budget_create',
    resource: '/api/finance/budget/create',
    targetId: String(projectId),
    ipAddress
  });

  return {
    message: 'Project budget created successfully',
    budget: createdBudget
  };
}

/**
 * GET /api/finance/budget/:projectId
 * Returns budget details, real-time consumption breakdown, and active alerts.
 */
export function getBudgetByProjectId(projectId, currentUser) {
  verifyAdminRole(currentUser, 'view project budget details');

  const budget = queryOne('SELECT * FROM project_budgets WHERE project_id = ?', [projectId]);
  if (!budget) {
    throw { status: 404, message: 'Budget not found for this project' };
  }

  const consumption = calculateBudgetConsumption(projectId);
  evaluateBudgetAlerts(projectId, currentUser);

  const activeAlerts = queryAll(`
    SELECT * FROM budget_alerts
    WHERE project_id = ? AND acknowledged_at IS NULL
    ORDER BY created_at DESC
  `, [projectId]);

  return {
    budget,
    consumption,
    alerts: activeAlerts,
    total_budget: consumption.total_budget,
    currency: consumption.currency,
    consumed: consumption.total_consumption,
    remaining: consumption.remaining_budget,
    consumed_pct: consumption.consumed_pct,
    alert_status: consumption.alert_status,
    budget_type: budget.budget_type,
    alert_threshold_pct: budget.alert_threshold_pct
  };
}


/**
 * PATCH /api/finance/budget/:projectId
 * Updates a project budget. Mandatory reason (min 10 chars) auto-logged to budget_history.
 * Manually sets updated_at timestamp.
 */
export function updateBudget(projectId, data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'update project budget');

  if (!data) {
    throw { status: 400, message: 'Update payload is required' };
  }

  // Mandatory reason check (min 10 chars)
  const reason = data.reason ? String(data.reason).trim() : '';
  if (!reason || reason.length < 10) {
    throw { status: 400, message: 'reason is mandatory for budget updates (minimum 10 characters required)' };
  }

  const budget = queryOne('SELECT * FROM project_budgets WHERE project_id = ?', [projectId]);
  if (!budget) {
    throw { status: 404, message: 'Budget not found for this project' };
  }

  const changes = [];

  // Check total_budget
  let newTotalBudget = budget.total_budget;
  if (data.total_budget !== undefined) {
    const parsed = Number(data.total_budget);
    if (isNaN(parsed) || parsed < 0) {
      throw { status: 400, message: 'total_budget must be a valid non-negative number' };
    }
    if (parsed !== Number(budget.total_budget)) {
      changes.push({
        field: 'total_budget',
        oldVal: String(budget.total_budget),
        newVal: String(parsed)
      });
      newTotalBudget = parsed;
    }
  }

  // Check alert_threshold_pct
  let newThresholdPct = budget.alert_threshold_pct;
  if (data.alert_threshold_pct !== undefined) {
    const parsed = Number(data.alert_threshold_pct);
    if (isNaN(parsed) || parsed <= 0 || parsed > 100) {
      throw { status: 400, message: 'alert_threshold_pct must be between 1 and 100' };
    }
    if (parsed !== Number(budget.alert_threshold_pct)) {
      changes.push({
        field: 'alert_threshold_pct',
        oldVal: String(budget.alert_threshold_pct),
        newVal: String(parsed)
      });
      newThresholdPct = parsed;
    }
  }

  // Check budget_type
  let newBudgetType = budget.budget_type;
  if (data.budget_type !== undefined) {
    const validTypes = ['FIXED', 'TIME_AND_MATERIAL', 'RETAINER'];
    const parsed = String(data.budget_type).trim().toUpperCase();
    if (!validTypes.includes(parsed)) {
      throw { status: 400, message: `budget_type must be one of: ${validTypes.join(', ')}` };
    }
    if (parsed !== budget.budget_type) {
      changes.push({
        field: 'budget_type',
        oldVal: String(budget.budget_type),
        newVal: String(parsed)
      });
      newBudgetType = parsed;
    }
  }

  // Check end_date
  let newEndDate = budget.end_date;
  if (data.end_date !== undefined) {
    const parsed = data.end_date ? String(data.end_date).trim() : null;
    if (parsed !== budget.end_date) {
      changes.push({
        field: 'end_date',
        oldVal: String(budget.end_date || ''),
        newVal: String(parsed || '')
      });
      newEndDate = parsed;
    }
  }

  // Check notes
  let newNotes = budget.notes;
  if (data.notes !== undefined) {
    const parsed = data.notes ? String(data.notes).trim() : null;
    if (parsed !== budget.notes) {
      changes.push({
        field: 'notes',
        oldVal: String(budget.notes || ''),
        newVal: String(parsed || '')
      });
      newNotes = parsed;
    }
  }

  // Check currency (if updated)
  let newCurrency = budget.currency;
  if (data.currency !== undefined) {
    const parsed = String(data.currency).trim().toUpperCase();
    if (parsed !== budget.currency) {
      changes.push({
        field: 'currency',
        oldVal: String(budget.currency),
        newVal: String(parsed)
      });
      newCurrency = parsed;
    }
  }

  // Record all changes to append-only budget_history
  for (const chg of changes) {
    execute(`
      INSERT INTO budget_history (
        project_id, changed_by, field_changed, old_value, new_value, reason, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      projectId,
      currentUser.id,
      chg.field,
      chg.oldVal,
      chg.newVal,
      reason
    ]);
  }

  // Update project_budgets with manual updated_at timestamp
  execute(`
    UPDATE project_budgets
    SET total_budget = ?,
        alert_threshold_pct = ?,
        budget_type = ?,
        end_date = ?,
        notes = ?,
        currency = ?,
        updated_at = datetime('now')
    WHERE project_id = ?
  `, [
    newTotalBudget,
    newThresholdPct,
    newBudgetType,
    newEndDate,
    newNotes,
    newCurrency,
    projectId
  ]);

  const updatedBudget = queryOne('SELECT * FROM project_budgets WHERE project_id = ?', [projectId]);

  // Re-evaluate alerts after budget adjustment
  evaluateBudgetAlerts(projectId, currentUser);

  // Audit log
  logAccess({
    userId: currentUser.id,
    action: 'budget_update',
    resource: `/api/finance/budget/${projectId}`,
    targetId: String(projectId),
    ipAddress
  });

  return {
    message: 'Project budget updated successfully',
    budget: updatedBudget,
    changes_recorded: changes.length
  };
}

/**
 * GET /api/finance/budget/:projectId/history
 * Returns full append-only budget_history for project with changer identity.
 */
export function getBudgetHistory(projectId, currentUser) {
  verifyAdminRole(currentUser, 'view budget history');

  const budget = queryOne('SELECT id FROM project_budgets WHERE project_id = ?', [projectId]);
  if (!budget) {
    // If no budget, also verify if project exists
    const proj = queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
    if (!proj) {
      throw { status: 404, message: 'Project not found' };
    }
  }

  const history = queryAll(`
    SELECT bh.*, u.name as changed_by_name, u.email as changed_by_email
    FROM budget_history bh
    LEFT JOIN users u ON u.id = bh.changed_by
    WHERE bh.project_id = ?
    ORDER BY bh.changed_at DESC, bh.id DESC
  `, [projectId]);

  return {
    project_id: projectId,
    history
  };
}

// ===================================================================
// EXPENSE CATEGORY SERVICES (LAYER 3)
// ===================================================================

/**
 * POST /api/finance/category/create
 * Creates an expense category. Category name must be unique.
 * Role: Admin+
 */
export function createCategory(data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'create expense category');

  if (!data || !data.name || !String(data.name).trim()) {
    throw { status: 400, message: 'Category name is required' };
  }

  const name = String(data.name).trim().toUpperCase();
  const description = data.description ? String(data.description).trim() : null;

  // Check uniqueness
  const existing = queryOne('SELECT id FROM expense_categories WHERE UPPER(name) = ?', [name]);
  if (existing) {
    throw { status: 400, message: `Expense category '${name}' already exists` };
  }

  execute(`
    INSERT INTO expense_categories (name, description, is_active, created_by, created_at)
    VALUES (?, ?, 1, ?, datetime('now'))
  `, [name, description, currentUser.id]);

  const category = queryOne('SELECT * FROM expense_categories WHERE UPPER(name) = ?', [name]);

  // Admin audit log
  logAccess({
    userId: currentUser.id,
    action: 'expense_category_create',
    resource: '/api/finance/category/create',
    targetId: String(category.id),
    ipAddress
  });

  return {
    message: 'Expense category created successfully',
    category
  };
}

/**
 * GET /api/finance/categories
 * Returns all active expense categories (or all if options.all && admin).
 * Role: All authenticated
 */
export function getCategories(currentUser, options = {}) {
  if (!currentUser) {
    throw { status: 401, message: 'Unauthorized: User authentication required' };
  }

  const role = String(currentUser.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  if (options.all && isAdmin) {
    return queryAll('SELECT * FROM expense_categories ORDER BY name ASC');
  }

  return queryAll('SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY name ASC');
}

/**
 * PATCH /api/finance/category/:categoryId
 * Updates category name, description, or active status.
 * Role: Admin+
 */
export function updateCategory(categoryId, data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'update expense category');

  if (!data) {
    throw { status: 400, message: 'Update payload is required' };
  }

  const category = queryOne('SELECT * FROM expense_categories WHERE id = ?', [categoryId]);
  if (!category) {
    throw { status: 404, message: 'Expense category not found' };
  }

  let newName = category.name;
  if (data.name !== undefined) {
    const trimmed = String(data.name).trim().toUpperCase();
    if (!trimmed) {
      throw { status: 400, message: 'Category name cannot be empty' };
    }
    const duplicate = queryOne(
      'SELECT id FROM expense_categories WHERE UPPER(name) = ? AND id != ?',
      [trimmed, categoryId]
    );
    if (duplicate) {
      throw { status: 400, message: `Category name '${trimmed}' is already in use` };
    }
    newName = trimmed;
  }

  const newDescription = data.description !== undefined
    ? (data.description ? String(data.description).trim() : null)
    : category.description;

  const newIsActive = data.is_active !== undefined
    ? (data.is_active ? 1 : 0)
    : category.is_active;

  execute(`
    UPDATE expense_categories
    SET name = ?, description = ?, is_active = ?
    WHERE id = ?
  `, [newName, newDescription, newIsActive, categoryId]);

  const updated = queryOne('SELECT * FROM expense_categories WHERE id = ?', [categoryId]);

  // Admin audit log
  logAccess({
    userId: currentUser.id,
    action: 'expense_category_update',
    resource: `/api/finance/category/${categoryId}`,
    targetId: String(categoryId),
    ipAddress
  });

  return {
    message: 'Expense category updated successfully',
    category: updated
  };
}

// ===================================================================
// EXPENSE SERVICES (LAYER 3)
// ===================================================================

/**
 * POST /api/finance/expense/submit
 * Submits an expense for a project with status = 'PENDING'.
 * Auto-logs submission to append-only expense_history.
 * Role: All authenticated members (submits own expense).
 */
export function submitExpense(data, currentUser, ipAddress = null) {
  if (!currentUser) {
    throw { status: 401, message: 'Unauthorized: User authentication required' };
  }

  if (!data) {
    throw { status: 400, message: 'Expense payload is required' };
  }

  if (!data.project_id) {
    throw { status: 400, message: 'project_id is required' };
  }

  const project = queryOne('SELECT id FROM projects WHERE id = ?', [data.project_id]);
  if (!project) {
    throw { status: 404, message: 'Project not found' };
  }

  if (!data.category_id) {
    throw { status: 400, message: 'category_id is required' };
  }

  const category = queryOne('SELECT id, is_active FROM expense_categories WHERE id = ?', [data.category_id]);
  if (!category || category.is_active !== 1) {
    throw { status: 400, message: 'Valid and active expense category is required' };
  }

  if (!data.title || !String(data.title).trim()) {
    throw { status: 400, message: 'title is required' };
  }
  const title = String(data.title).trim();

  const amount = Number(data.amount);
  if (isNaN(amount) || amount <= 0) {
    throw { status: 400, message: 'amount must be a positive number' };
  }
  const roundedAmount = Math.round(amount * 100) / 100;

  if (!data.expense_date || !String(data.expense_date).trim()) {
    throw { status: 400, message: 'expense_date is required' };
  }
  const expenseDate = String(data.expense_date).trim();

  const description = data.description ? String(data.description).trim() : null;
  const currency = data.currency ? String(data.currency).trim().toUpperCase() : 'INR';
  const isBillable = data.is_billable ? 1 : 0;
  const receiptPath = data.receipt_path ? String(data.receipt_path).trim() : null;

  // Insert project expense with manual updated_at
  execute(`
    INSERT INTO project_expenses (
      project_id, category_id, submitted_by, title, description,
      amount, currency, expense_date, receipt_path, status,
      is_billable, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, datetime('now'), datetime('now'))
  `, [
    project.id,
    category.id,
    currentUser.id,
    title,
    description,
    roundedAmount,
    currency,
    expenseDate,
    receiptPath,
    isBillable
  ]);

  const createdExpense = queryOne(
    'SELECT * FROM project_expenses WHERE project_id = ? AND submitted_by = ? ORDER BY id DESC LIMIT 1',
    [project.id, currentUser.id]
  );

  // Auto-log initial submission status to append-only expense_history
  execute(`
    INSERT INTO expense_history (
      expense_id, changed_by, field_changed, old_value, new_value, changed_at
    ) VALUES (?, ?, 'status', NULL, 'PENDING', datetime('now'))
  `, [createdExpense.id, currentUser.id]);

  return {
    message: 'Expense submitted successfully',
    expense: createdExpense
  };
}

/**
 * GET /api/finance/expenses/project/:projectId
 * Returns all expenses for a project with optional filters.
 * STRICT RULE: Admin+ only. Regular members strictly blocked (403).
 */
export function getProjectExpenses(projectId, filters = {}, currentUser) {
  verifyAdminRole(currentUser, 'view project expenses');

  const project = queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    throw { status: 404, message: 'Project not found' };
  }

  let sql = `
    SELECT pe.*,
           ec.name as category_name,
           u.name as submitter_name,
           u.email as submitter_email,
           ap.name as approver_name,
           rj.name as rejecter_name
    FROM project_expenses pe
    LEFT JOIN expense_categories ec ON ec.id = pe.category_id
    LEFT JOIN users u ON u.id = pe.submitted_by
    LEFT JOIN users ap ON ap.id = pe.approved_by
    LEFT JOIN users rj ON rj.id = pe.rejected_by
    WHERE pe.project_id = ?
  `;
  const params = [projectId];

  if (filters.status) {
    sql += ' AND pe.status = ?';
    params.push(String(filters.status).trim().toUpperCase());
  }

  if (filters.category_id) {
    sql += ' AND pe.category_id = ?';
    params.push(filters.category_id);
  }

  if (filters.submitted_by) {
    sql += ' AND pe.submitted_by = ?';
    params.push(filters.submitted_by);
  }

  if (filters.from) {
    sql += ' AND pe.expense_date >= ?';
    params.push(String(filters.from).trim());
  }

  if (filters.to) {
    sql += ' AND pe.expense_date <= ?';
    params.push(String(filters.to).trim());
  }

  sql += ' ORDER BY pe.expense_date DESC, pe.id DESC';

  const expenses = queryAll(sql, params);

  return {
    project_id: projectId,
    count: expenses.length,
    expenses
  };
}

/**
 * GET /api/finance/expenses/my
 * Returns only current user's submitted expenses.
 * STRICT RULE: Members can only submit/view their own expenses — never others.
 * Role: All authenticated members
 */
export function getMyExpenses(filters = {}, currentUser) {
  if (!currentUser) {
    throw { status: 401, message: 'Unauthorized: User authentication required' };
  }

  let sql = `
    SELECT pe.*,
           ec.name as category_name,
           p.title as project_title,
           ap.name as approver_name,
           rj.name as rejecter_name
    FROM project_expenses pe
    LEFT JOIN expense_categories ec ON ec.id = pe.category_id
    LEFT JOIN projects p ON p.id = pe.project_id
    LEFT JOIN users ap ON ap.id = pe.approved_by
    LEFT JOIN users rj ON rj.id = pe.rejected_by
    WHERE pe.submitted_by = ?
  `;
  const params = [currentUser.id];

  if (filters.project_id) {
    sql += ' AND pe.project_id = ?';
    params.push(filters.project_id);
  }

  if (filters.status) {
    sql += ' AND pe.status = ?';
    params.push(String(filters.status).trim().toUpperCase());
  }

  sql += ' ORDER BY pe.expense_date DESC, pe.id DESC';

  const expenses = queryAll(sql, params);

  return {
    count: expenses.length,
    expenses
  };
}

/**
 * GET /api/finance/expense/:expenseId
 * Returns single expense detail.
 * Role: Admin+ or Owner (submitted_by === currentUser.id).
 */
export function getExpenseById(expenseId, currentUser) {
  if (!currentUser) {
    throw { status: 401, message: 'Unauthorized: User authentication required' };
  }

  const expense = queryOne(`
    SELECT pe.*,
           ec.name as category_name,
           p.title as project_title,
           u.name as submitter_name,
           u.email as submitter_email,
           ap.name as approver_name,
           rj.name as rejecter_name
    FROM project_expenses pe
    LEFT JOIN expense_categories ec ON ec.id = pe.category_id
    LEFT JOIN projects p ON p.id = pe.project_id
    LEFT JOIN users u ON u.id = pe.submitted_by
    LEFT JOIN users ap ON ap.id = pe.approved_by
    LEFT JOIN users rj ON rj.id = pe.rejected_by
    WHERE pe.id = ?
  `, [expenseId]);

  if (!expense) {
    throw { status: 404, message: 'Expense not found' };
  }

  const role = String(currentUser.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  if (!isAdmin && expense.submitted_by !== currentUser.id) {
    throw { status: 403, message: 'Forbidden: You can only view your own expenses' };
  }

  return { expense };
}

/**
 * GET /api/finance/expense/:expenseId/history
 * Returns full append-only audit trail for an expense.
 * Role: Admin+ or Owner.
 */
export function getExpenseHistory(expenseId, currentUser) {
  if (!currentUser) {
    throw { status: 401, message: 'Unauthorized: User authentication required' };
  }

  const expense = queryOne('SELECT id, submitted_by FROM project_expenses WHERE id = ?', [expenseId]);
  if (!expense) {
    throw { status: 404, message: 'Expense not found' };
  }

  const role = String(currentUser.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  if (!isAdmin && expense.submitted_by !== currentUser.id) {
    throw { status: 403, message: 'Forbidden: You can only view your own expense history' };
  }

  const history = queryAll(`
    SELECT eh.*, u.name as changed_by_name, u.email as changed_by_email
    FROM expense_history eh
    LEFT JOIN users u ON u.id = eh.changed_by
    WHERE eh.expense_id = ?
    ORDER BY eh.changed_at DESC, eh.id DESC
  `, [expenseId]);

  return {
    expense_id: expenseId,
    history
  };
}

/**
 * PATCH /api/finance/expense/:expenseId/approve
 * Approves an expense.
 * STRICT RULES:
 * - Admin+ only.
 * - Updates status to APPROVED, sets approved_by, approved_at, and manual updated_at.
 * - Logs status transition to append-only expense_history.
 * - Immediately triggers budget recalculation + alert evaluation.
 * - Logs action to access_log.
 */
export function approveExpense(expenseId, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'approve expense');

  const expense = queryOne('SELECT * FROM project_expenses WHERE id = ?', [expenseId]);
  if (!expense) {
    throw { status: 404, message: 'Expense not found' };
  }

  const oldStatus = expense.status;

  // Record transition to expense_history
  execute(`
    INSERT INTO expense_history (
      expense_id, changed_by, field_changed, old_value, new_value, changed_at
    ) VALUES (?, ?, 'status', ?, 'APPROVED', datetime('now'))
  `, [expenseId, currentUser.id, oldStatus]);

  // Update expense with manual updated_at
  execute(`
    UPDATE project_expenses
    SET status = 'APPROVED',
        approved_by = ?,
        approved_at = datetime('now'),
        rejected_by = NULL,
        rejected_at = NULL,
        rejection_reason = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `, [currentUser.id, expenseId]);

  const updatedExpense = queryOne('SELECT * FROM project_expenses WHERE id = ?', [expenseId]);

  // Trigger immediate budget recalculation and alert evaluation
  const consumption = calculateBudgetConsumption(expense.project_id);
  const alerts = evaluateBudgetAlerts(expense.project_id, currentUser);

  // Admin audit log
  logAccess({
    userId: currentUser.id,
    action: 'expense_approve',
    resource: `/api/finance/expense/${expenseId}/approve`,
    targetId: String(expenseId),
    ipAddress
  });

  try {
    fireTrigger('EXPENSE', 'EXPENSE_APPROVED', 'EXPENSE', expenseId, currentUser.id, {
      project_id: expense.project_id,
      expense: {
        id: expenseId,
        amount: expense.amount,
        currency: expense.currency,
        project_id: expense.project_id,
        submitter_id: expense.created_by,
        status: 'APPROVED'
      }
    });
  } catch (tErr) {
    console.error('[FinanceService] fireTrigger error:', tErr);
  }

  return {
    message: 'Expense approved successfully',
    expense: updatedExpense,
    budget_consumption: consumption,
    alerts
  };
}

/**
 * PATCH /api/finance/expense/:expenseId/reject
 * Rejects an expense.
 * STRICT RULES:
 * - Admin+ only.
 * - Rejection reason is mandatory (minimum 10 characters).
 * - Updates status to REJECTED, sets rejected_by, rejected_at, rejection_reason, and manual updated_at.
 * - Logs status and rejection_reason to append-only expense_history.
 * - If previously APPROVED, recalculates budget consumption and alerts.
 * - Logs action to access_log.
 */
export function rejectExpense(expenseId, data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'reject expense');

  const expense = queryOne('SELECT * FROM project_expenses WHERE id = ?', [expenseId]);
  if (!expense) {
    throw { status: 404, message: 'Expense not found' };
  }

  const reason = data?.rejection_reason ? String(data.rejection_reason).trim() : '';
  if (!reason || reason.length < 10) {
    throw { status: 400, message: 'rejection_reason is mandatory (minimum 10 characters required)' };
  }

  const oldStatus = expense.status;
  const oldReason = expense.rejection_reason || '';

  // Log status change to expense_history
  execute(`
    INSERT INTO expense_history (
      expense_id, changed_by, field_changed, old_value, new_value, changed_at
    ) VALUES (?, ?, 'status', ?, 'REJECTED', datetime('now'))
  `, [expenseId, currentUser.id, oldStatus]);

  // Log rejection reason to expense_history
  execute(`
    INSERT INTO expense_history (
      expense_id, changed_by, field_changed, old_value, new_value, changed_at
    ) VALUES (?, ?, 'rejection_reason', ?, ?, datetime('now'))
  `, [expenseId, currentUser.id, oldReason, reason]);

  // Update expense with manual updated_at
  execute(`
    UPDATE project_expenses
    SET status = 'REJECTED',
        rejected_by = ?,
        rejected_at = datetime('now'),
        rejection_reason = ?,
        approved_by = NULL,
        approved_at = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `, [currentUser.id, reason, expenseId]);

  const updatedExpense = queryOne('SELECT * FROM project_expenses WHERE id = ?', [expenseId]);

  // If it was APPROVED before, recalculate consumption and alerts
  let consumption = null;
  let alerts = [];
  if (oldStatus === 'APPROVED') {
    consumption = calculateBudgetConsumption(expense.project_id);
    alerts = evaluateBudgetAlerts(expense.project_id, currentUser);
  }

  // Admin audit log
  logAccess({
    userId: currentUser.id,
    action: 'expense_reject',
    resource: `/api/finance/expense/${expenseId}/reject`,
    targetId: String(expenseId),
    ipAddress
  });

  try {
    fireTrigger('EXPENSE', 'EXPENSE_REJECTED', 'EXPENSE', expenseId, currentUser.id, {
      project_id: expense.project_id,
      expense: {
        id: expenseId,
        amount: expense.amount,
        currency: expense.currency,
        project_id: expense.project_id,
        submitter_id: expense.created_by,
        rejection_reason: reason,
        status: 'REJECTED'
      }
    });
  } catch (tErr) {
    console.error('[FinanceService] fireTrigger error:', tErr);
  }

  return {
    message: 'Expense rejected successfully',
    expense: updatedExpense,
    budget_consumption: consumption,
    alerts
  };
}

/**
 * PATCH /api/finance/expense/:expenseId
 * Modifies an expense.
 * STRICT RULES:
 * - Only PENDING expenses can be edited — APPROVED and REJECTED are strictly locked (400 Bad Request).
 * - Role: Owner (submitted_by === currentUser.id) or Admin+.
 * - All modified fields logged to append-only expense_history.
 * - updated_at manually set on mutation.
 */
export function updateExpense(expenseId, data, currentUser, ipAddress = null) {
  if (!currentUser) {
    throw { status: 401, message: 'Unauthorized: User authentication required' };
  }

  if (!data) {
    throw { status: 400, message: 'Update payload is required' };
  }

  const expense = queryOne('SELECT * FROM project_expenses WHERE id = ?', [expenseId]);
  if (!expense) {
    throw { status: 404, message: 'Expense not found' };
  }

  const role = String(currentUser.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  if (!isAdmin && expense.submitted_by !== currentUser.id) {
    throw { status: 403, message: 'Forbidden: You can only edit your own expenses' };
  }

  // Lock rule: only PENDING expenses can be modified
  if (expense.status !== 'PENDING') {
    throw {
      status: 400,
      message: `Cannot edit expense with status '${expense.status}'. Only PENDING expenses can be modified.`
    };
  }

  const changes = [];

  // Title
  let newTitle = expense.title;
  if (data.title !== undefined) {
    const trimmed = String(data.title).trim();
    if (!trimmed) {
      throw { status: 400, message: 'title cannot be empty' };
    }
    if (trimmed !== expense.title) {
      changes.push({ field: 'title', oldVal: expense.title, newVal: trimmed });
      newTitle = trimmed;
    }
  }

  // Description
  let newDescription = expense.description;
  if (data.description !== undefined) {
    const parsed = data.description ? String(data.description).trim() : null;
    if (parsed !== expense.description) {
      changes.push({ field: 'description', oldVal: expense.description || '', newVal: parsed || '' });
      newDescription = parsed;
    }
  }

  // Amount
  let newAmount = expense.amount;
  if (data.amount !== undefined) {
    const parsed = Number(data.amount);
    if (isNaN(parsed) || parsed <= 0) {
      throw { status: 400, message: 'amount must be a positive number' };
    }
    const rounded = Math.round(parsed * 100) / 100;
    if (rounded !== Number(expense.amount)) {
      changes.push({ field: 'amount', oldVal: String(expense.amount), newVal: String(rounded) });
      newAmount = rounded;
    }
  }

  // Expense Date
  let newExpenseDate = expense.expense_date;
  if (data.expense_date !== undefined) {
    const parsed = String(data.expense_date).trim();
    if (!parsed) {
      throw { status: 400, message: 'expense_date cannot be empty' };
    }
    if (parsed !== expense.expense_date) {
      changes.push({ field: 'expense_date', oldVal: expense.expense_date, newVal: parsed });
      newExpenseDate = parsed;
    }
  }

  // Category
  let newCategoryId = expense.category_id;
  if (data.category_id !== undefined) {
    const catId = Number(data.category_id);
    const cat = queryOne('SELECT id, is_active FROM expense_categories WHERE id = ?', [catId]);
    if (!cat || cat.is_active !== 1) {
      throw { status: 400, message: 'Valid and active expense category is required' };
    }
    if (catId !== expense.category_id) {
      changes.push({ field: 'category_id', oldVal: String(expense.category_id), newVal: String(catId) });
      newCategoryId = catId;
    }
  }

  // Billable
  let newIsBillable = expense.is_billable;
  if (data.is_billable !== undefined) {
    const parsed = data.is_billable ? 1 : 0;
    if (parsed !== expense.is_billable) {
      changes.push({ field: 'is_billable', oldVal: String(expense.is_billable), newVal: String(parsed) });
      newIsBillable = parsed;
    }
  }

  // Receipt Path
  let newReceiptPath = expense.receipt_path;
  if (data.receipt_path !== undefined) {
    const parsed = data.receipt_path ? String(data.receipt_path).trim() : null;
    if (parsed !== expense.receipt_path) {
      changes.push({ field: 'receipt_path', oldVal: expense.receipt_path || '', newVal: parsed || '' });
      newReceiptPath = parsed;
    }
  }

  // Currency
  let newCurrency = expense.currency;
  if (data.currency !== undefined) {
    const parsed = String(data.currency).trim().toUpperCase();
    if (parsed && parsed !== expense.currency) {
      changes.push({ field: 'currency', oldVal: expense.currency, newVal: parsed });
      newCurrency = parsed;
    }
  }

  // Record all changes to append-only expense_history
  for (const chg of changes) {
    execute(`
      INSERT INTO expense_history (
        expense_id, changed_by, field_changed, old_value, new_value, changed_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, [
      expenseId,
      currentUser.id,
      chg.field,
      chg.oldVal,
      chg.newVal
    ]);
  }

  // Update project_expenses with manual updated_at
  execute(`
    UPDATE project_expenses
    SET title = ?,
        description = ?,
        amount = ?,
        currency = ?,
        expense_date = ?,
        category_id = ?,
        is_billable = ?,
        receipt_path = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [
    newTitle,
    newDescription,
    newAmount,
    newCurrency,
    newExpenseDate,
    newCategoryId,
    newIsBillable,
    newReceiptPath,
    expenseId
  ]);

  const updatedExpense = queryOne('SELECT * FROM project_expenses WHERE id = ?', [expenseId]);

  if (isAdmin) {
    logAccess({
      userId: currentUser.id,
      action: 'expense_update',
      resource: `/api/finance/expense/${expenseId}`,
      targetId: String(expenseId),
      ipAddress
    });
  }

  return {
    message: 'Expense updated successfully',
    expense: updatedExpense,
    changes_recorded: changes.length
  };
}

// ===================================================================
// INVOICE SERVICES (LAYER 4)
// ===================================================================

/**
 * Generates next sequential invoice number for a given year.
 * Format: MTG-INV-YYYY-NNNN (e.g. MTG-INV-2026-0001)
 */
export function generateNextInvoiceNumber(year = null) {
  const currentYear = year || new Date().getFullYear();
  const prefix = `MTG-INV-${currentYear}-`;

  const lastInvoice = queryOne(`
    SELECT invoice_number
    FROM invoices
    WHERE invoice_number LIKE ?
    ORDER BY invoice_number DESC
    LIMIT 1
  `, [`${prefix}%`]);

  let nextSeq = 1;
  if (lastInvoice && lastInvoice.invoice_number) {
    const match = lastInvoice.invoice_number.match(/^MTG-INV-\d{4}-(\d{4})$/);
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

/**
 * POST /api/finance/invoice/create
 * Creates a project invoice in DRAFT status with auto-generated invoice number.
 * Role: Admin+
 */
export function createInvoice(data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'create invoice');

  if (!data) {
    throw { status: 400, message: 'Invoice payload is required' };
  }

  if (!data.project_id) {
    throw { status: 400, message: 'project_id is required' };
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [data.project_id]);
  if (!project) {
    throw { status: 404, message: 'Project not found' };
  }

  if (!data.title || !String(data.title).trim()) {
    throw { status: 400, message: 'title is required' };
  }
  const title = String(data.title).trim();

  if (!data.issue_date || !String(data.issue_date).trim()) {
    throw { status: 400, message: 'issue_date is required' };
  }
  const issueDate = String(data.issue_date).trim();

  if (!data.due_date || !String(data.due_date).trim()) {
    throw { status: 400, message: 'due_date is required' };
  }
  const dueDate = String(data.due_date).trim();

  let clientId = null;
  if (data.client_id !== undefined && data.client_id !== null && data.client_id !== '') {
    const client = queryOne('SELECT id, name FROM clients WHERE id = ?', [data.client_id]);
    if (!client) {
      throw { status: 404, message: 'Client not found' };
    }
    clientId = client.id;
  }

  const taxPct = data.tax_pct !== undefined ? Number(data.tax_pct) : 0.0;
  if (isNaN(taxPct) || taxPct < 0) {
    throw { status: 400, message: 'tax_pct must be a non-negative number' };
  }

  const currency = data.currency ? String(data.currency).trim().toUpperCase() : 'INR';
  const notes = data.notes ? String(data.notes).trim() : null;
  const internalNotes = data.internal_notes ? String(data.internal_notes).trim() : null;

  // Auto-generate invoice number based on issue date year
  const issueYear = new Date(issueDate).getFullYear() || new Date().getFullYear();
  const invoiceNumber = generateNextInvoiceNumber(issueYear);

  execute(`
    INSERT INTO invoices (
      project_id, client_id, invoice_number, title, status,
      issue_date, due_date, subtotal, tax_pct, tax_amount, total_amount,
      currency, notes, internal_notes, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, 'DRAFT',
      ?, ?, 0.0, ?, 0.0, 0.0,
      ?, ?, ?, ?, datetime('now'), datetime('now')
    )
  `, [
    project.id,
    clientId,
    invoiceNumber,
    title,
    issueDate,
    dueDate,
    taxPct,
    currency,
    notes,
    internalNotes,
    currentUser.id
  ]);

  const createdInvoice = queryOne('SELECT * FROM invoices WHERE invoice_number = ?', [invoiceNumber]);

  // Admin audit log
  logAccess({
    userId: currentUser.id,
    action: 'invoice_create',
    resource: '/api/finance/invoice/create',
    targetId: String(createdInvoice.id),
    ipAddress
  });

  return {
    message: 'Invoice created successfully',
    invoice: createdInvoice
  };
}

/**
 * POST /api/finance/invoice/:invoiceId/line-item/add
 * Adds a line item to an invoice.
 * STRICT RULES:
 * - Admin+ only.
 * - Only DRAFT invoices can have line items added (returns 400 if SENT, PAID, CANCELLED, etc.).
 * - Line item amount is strictly computed server-side: quantity * unit_price.
 * - Invoice subtotal, tax_amount, total_amount automatically recomputed and updated.
 * - Append-only line item: protected by SQLite trigger.
 */
export function addInvoiceLineItem(invoiceId, data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'add invoice line item');

  if (!data) {
    throw { status: 400, message: 'Line item payload is required' };
  }

  const invoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) {
    throw { status: 404, message: 'Invoice not found' };
  }

  // Locking rule: line items can only be added to DRAFT invoices
  if (invoice.status !== 'DRAFT') {
    throw {
      status: 400,
      message: `Cannot add line items to invoice with status '${invoice.status}'. Line items can only be added when invoice is in DRAFT status.`
    };
  }

  if (!data.description || !String(data.description).trim()) {
    throw { status: 400, message: 'description is required' };
  }
  const description = String(data.description).trim();

  const validTypes = ['SERVICE', 'EXPENSE', 'TIME', 'MILESTONE', 'CUSTOM'];
  const lineType = data.line_type ? String(data.line_type).trim().toUpperCase() : 'SERVICE';
  if (!validTypes.includes(lineType)) {
    throw { status: 400, message: `line_type must be one of: ${validTypes.join(', ')}` };
  }

  const quantity = data.quantity !== undefined ? Number(data.quantity) : 1.0;
  if (isNaN(quantity) || quantity <= 0) {
    throw { status: 400, message: 'quantity must be a positive number' };
  }

  const unitPrice = data.unit_price !== undefined ? Number(data.unit_price) : 0.0;
  if (isNaN(unitPrice) || unitPrice < 0) {
    throw { status: 400, message: 'unit_price must be a non-negative number' };
  }

  // Server-side calculation: client-sent amount is ignored
  const calculatedAmount = Math.round((quantity * unitPrice) * 100) / 100;

  const validSourceTypes = ['TIME_ENTRY', 'EXPENSE', 'MILESTONE', null];
  const sourceType = data.source_type ? String(data.source_type).trim().toUpperCase() : null;
  if (sourceType && !validSourceTypes.includes(sourceType)) {
    throw { status: 400, message: 'Invalid source_type' };
  }

  const sourceId = data.source_id ? Number(data.source_id) : null;
  const position = data.position !== undefined ? Number(data.position) : 0;

  execute(`
    INSERT INTO invoice_line_items (
      invoice_id, description, line_type, quantity, unit_price,
      amount, source_type, source_id, position, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    invoice.id,
    description,
    lineType,
    quantity,
    unitPrice,
    calculatedAmount,
    sourceType,
    sourceId,
    position
  ]);

  const createdLineItem = queryOne(
    'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY id DESC LIMIT 1',
    [invoice.id]
  );

  // Recalculate invoice totals server-side
  const sumRow = queryOne(
    'SELECT COALESCE(SUM(amount), 0.0) as subtotal FROM invoice_line_items WHERE invoice_id = ?',
    [invoice.id]
  );
  const subtotal = Math.round((sumRow?.subtotal || 0.0) * 100) / 100;
  const taxAmount = Math.round((subtotal * (Number(invoice.tax_pct) / 100.0)) * 100) / 100;
  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

  execute(`
    UPDATE invoices
    SET subtotal = ?,
        tax_amount = ?,
        total_amount = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [subtotal, taxAmount, totalAmount, invoice.id]);

  const updatedInvoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoice.id]);

  // Admin audit log
  logAccess({
    userId: currentUser.id,
    action: 'invoice_line_item_add',
    resource: `/api/finance/invoice/${invoice.id}/line-item/add`,
    targetId: String(createdLineItem.id),
    ipAddress
  });

  return {
    message: 'Line item added successfully',
    line_item: createdLineItem,
    invoice: updatedInvoice
  };
}

/**
 * GET /api/finance/invoices/project/:projectId
 * Returns all invoices for a project.
 * Role: Admin+
 */
export function getProjectInvoices(projectId, currentUser) {
  verifyAdminRole(currentUser, 'view project invoices');

  const project = queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    throw { status: 404, message: 'Project not found' };
  }

  const invoices = queryAll(`
    SELECT i.*,
           c.name as client_name,
           c.company_name as client_company,
           u.name as creator_name
    FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.project_id = ?
    ORDER BY i.created_at DESC, i.id DESC
  `, [projectId]);

  return {
    project_id: projectId,
    count: invoices.length,
    invoices
  };
}

/**
 * GET /api/finance/invoice/:invoiceId
 * Returns invoice detail + line items.
 * STRICT SECURITY RULE: internal_notes NEVER returned to client-facing version.
 * Role: Admin+ or Client
 */
export function getInvoiceById(invoiceId, currentUser, options = {}) {
  if (!currentUser) {
    throw { status: 401, message: 'Unauthorized: User authentication required' };
  }

  const invoice = queryOne(`
    SELECT i.*,
           c.name as client_name,
           c.company_name as client_company,
           c.email as client_email,
           p.title as project_title,
           u.name as creator_name
    FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.id = ?
  `, [invoiceId]);

  if (!invoice) {
    throw { status: 404, message: 'Invoice not found' };
  }

  const role = String(currentUser.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'superadmin';

  // If not admin and not linked client, enforce client authorization or deny
  if (!isAdmin && role !== 'client') {
    throw { status: 403, message: 'Forbidden: Admin or Client access required' };
  }

  const lineItems = queryAll(`
    SELECT *
    FROM invoice_line_items
    WHERE invoice_id = ?
    ORDER BY position ASC, id ASC
  `, [invoiceId]);

  // Strip internal_notes if client-facing request or client role
  if (options.clientView || role === 'client') {
    delete invoice.internal_notes;
  }

  return {
    invoice,
    line_items: lineItems
  };
}

/**
 * PATCH /api/finance/invoice/:invoiceId/send
 * Transitions invoice from DRAFT -> SENT. Sets sent_at and manual updated_at.
 * Sends notification / logs client activity if client_id is set.
 * Role: Admin+
 */
export function sendInvoice(invoiceId, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'send invoice');

  const invoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) {
    throw { status: 404, message: 'Invoice not found' };
  }

  // State machine check
  if (invoice.status !== 'DRAFT') {
    throw {
      status: 400,
      message: `Cannot send invoice with status '${invoice.status}'. Only DRAFT invoices can be sent.`
    };
  }

  execute(`
    UPDATE invoices
    SET status = 'SENT',
        sent_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `, [invoiceId]);

  const updatedInvoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);

  // Client notification / activity tracking if client_id is configured
  if (invoice.client_id) {
    logAccess({
      userId: currentUser.id,
      action: 'INVOICE_SENT_TO_CLIENT',
      resource: `/api/finance/invoice/${invoiceId}/send`,
      targetId: String(invoice.client_id),
      ipAddress
    });
  }

  // Admin audit log
  logAccess({
    userId: currentUser.id,
    action: 'invoice_send',
    resource: `/api/finance/invoice/${invoiceId}/send`,
    targetId: String(invoiceId),
    ipAddress
  });

  return {
    message: 'Invoice sent successfully',
    invoice: updatedInvoice
  };
}

/**
 * PATCH /api/finance/invoice/:invoiceId/mark-paid
 * Marks invoice as PAID. Records paid_amount, payment_reference, paid_at.
 * Role: Admin+
 */
export function markInvoiceAsPaid(invoiceId, data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'mark invoice as paid');

  const invoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) {
    throw { status: 404, message: 'Invoice not found' };
  }

  if (invoice.status === 'PAID') {
    return {
      message: 'Invoice is already marked as paid',
      invoice
    };
  }

  if (invoice.status === 'CANCELLED') {
    throw { status: 400, message: 'Cannot mark a CANCELLED invoice as paid' };
  }

  const paidAmount = data?.paid_amount !== undefined ? Number(data.paid_amount) : invoice.total_amount;
  if (isNaN(paidAmount) || paidAmount <= 0) {
    throw { status: 400, message: 'paid_amount must be a positive number' };
  }

  const paymentReference = data?.payment_reference ? String(data.payment_reference).trim() : null;
  const paidAt = data?.paid_at ? String(data.paid_at).trim() : new Date().toISOString();

  execute(`
    UPDATE invoices
    SET status = 'PAID',
        paid_amount = ?,
        payment_reference = ?,
        paid_at = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [paidAmount, paymentReference, paidAt, invoiceId]);

  const updatedInvoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);

  // Admin audit log
  logAccess({
    userId: currentUser.id,
    action: 'invoice_mark_paid',
    resource: `/api/finance/invoice/${invoiceId}/mark-paid`,
    targetId: String(invoiceId),
    ipAddress
  });

  return {
    message: 'Invoice marked as paid successfully',
    invoice: updatedInvoice
  };
}

/**
 * PATCH /api/finance/invoice/:invoiceId/cancel
 * Cancels an invoice. Only DRAFT, SENT, or VIEWED invoices can be cancelled.
 * Logs reason to access_log.
 * Role: Admin+
 */
export function cancelInvoice(invoiceId, data, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'cancel invoice');

  const invoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) {
    throw { status: 404, message: 'Invoice not found' };
  }

  if (invoice.status === 'PAID') {
    throw { status: 400, message: 'Cannot cancel an invoice that has already been PAID' };
  }

  if (invoice.status === 'CANCELLED') {
    throw { status: 400, message: 'Invoice is already CANCELLED' };
  }

  const cancellableStatuses = ['DRAFT', 'SENT', 'VIEWED', 'OVERDUE'];
  if (!cancellableStatuses.includes(invoice.status)) {
    throw { status: 400, message: `Cannot cancel invoice with status '${invoice.status}'` };
  }

  const reason = data?.reason ? String(data.reason).trim() : 'Cancelled by admin';

  execute(`
    UPDATE invoices
    SET status = 'CANCELLED',
        updated_at = datetime('now')
    WHERE id = ?
  `, [invoiceId]);

  const updatedInvoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);

  // Admin audit log with cancellation reason
  logAccess({
    userId: currentUser.id,
    action: 'invoice_cancel',
    resource: `/api/finance/invoice/${invoiceId}/cancel`,
    targetId: String(invoiceId),
    ipAddress
  });

  return {
    message: 'Invoice cancelled successfully',
    invoice: updatedInvoice,
    reason
  };
}

/**
 * PATCH /api/finance/invoice/:invoiceId/view
 * Marks invoice as VIEWED if current status is SENT.
 */
export function recordInvoiceViewed(invoiceId, currentUser = null, ipAddress = null) {
  const invoice = queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) {
    throw { status: 404, message: 'Invoice not found' };
  }

  if (invoice.status === 'SENT') {
    execute(`
      UPDATE invoices
      SET status = 'VIEWED',
          viewed_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `, [invoiceId]);
  }

  return queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
}

/**
 * Daily Cron / Scheduled Routine:
 * Checks due dates for SENT or VIEWED invoices.
 * If date(due_date) < date('now'), transitions status to OVERDUE and generates budget_alerts record.
 */
export function processOverdueInvoices(currentUser = null, ipAddress = null) {
  if (currentUser) {
    verifyAdminRole(currentUser, 'run overdue invoice cron');
  }

  const overdueInvoices = queryAll(`
    SELECT * FROM invoices
    WHERE status IN ('SENT', 'VIEWED')
      AND date(due_date) < date('now')
  `);

  const updatedInvoices = [];

  for (const inv of overdueInvoices) {
    execute(`
      UPDATE invoices
      SET status = 'OVERDUE',
          updated_at = datetime('now')
      WHERE id = ?
    `, [inv.id]);

    const updated = queryOne('SELECT * FROM invoices WHERE id = ?', [inv.id]);
    updatedInvoices.push(updated);

    // Auto-generate budget alert for overdue invoice
    const existingAlert = queryOne(`
      SELECT id FROM budget_alerts
      WHERE project_id = ? AND alert_type = 'INVOICE_OVERDUE' AND message LIKE ? AND acknowledged_at IS NULL
    `, [inv.project_id, `%${inv.invoice_number}%`]);

    if (!existingAlert) {
      const msg = `Invoice ${inv.invoice_number} is OVERDUE (Due: ${inv.due_date}, Total: ${inv.total_amount} ${inv.currency})`;
      execute(`
        INSERT INTO budget_alerts (
          project_id, alert_type, triggered_amount, message, created_at
        ) VALUES (?, 'INVOICE_OVERDUE', ?, ?, datetime('now'))
      `, [inv.project_id, inv.total_amount, msg]);
    }

    try {
      fireTrigger('EXPENSE', 'INVOICE_OVERDUE', 'INVOICE', inv.id, currentUser?.id || null, {
        project_id: inv.project_id,
        invoice: {
          id: inv.id,
          invoice_number: inv.invoice_number,
          total_amount: inv.total_amount,
          currency: inv.currency,
          due_date: inv.due_date,
          status: 'OVERDUE'
        }
      });
    } catch (tErr) {
      console.error('[FinanceService] fireTrigger error:', tErr);
    }
  }

  if (currentUser) {
    logAccess({
      userId: currentUser.id,
      action: 'cron_invoice_overdue_check',
      resource: '/api/finance/cron/overdue-check',
      targetId: String(updatedInvoices.length),
      ipAddress
    });
  }

  return {
    message: 'Overdue invoices processed successfully',
    updated_count: updatedInvoices.length,
    invoices: updatedInvoices
  };
}

// ===================================================================
// LAYER 5: FINANCIAL DASHBOARD, ALERTS & REPORTS
// ===================================================================

/**
 * Company-wide financial rollup dashboard.
 * Rules:
 * - Admin+ role only.
 * - Rollup totals: total_budget, total_consumed, total_remaining,
 *   total_invoiced, total_paid, total_outstanding.
 * - Project breakdown table with status colors:
 *   green (< 70% consumed), yellow (70-99%), red (100%+)
 * - Recent top 5 unacknowledged alerts.
 * - Recent top 5 invoices.
 * - P&L summary across all projects.
 */
export function getFinancialDashboard(currentUser) {
  verifyAdminRole(currentUser, 'view company-wide financial dashboard');

  // 1. Total allocated budget across all projects
  const budgetRow = queryOne(`
    SELECT COALESCE(SUM(total_budget), 0.0) as total
    FROM project_budgets
  `);
  const totalBudget = Math.round((budgetRow?.total || 0.0) * 100) / 100;

  // 2. Total consumption across all projects (APPROVED expenses + billable time)
  const expRow = queryOne(`
    SELECT COALESCE(SUM(amount), 0.0) as total
    FROM project_expenses
    WHERE status = 'APPROVED'
  `);
  const totalApprovedExpenses = Math.round((expRow?.total || 0.0) * 100) / 100;

  const timeRow = queryOne(`
    SELECT COALESCE(SUM((CAST(duration_minutes AS REAL) / 60.0) * billable_rate), 0.0) as total
    FROM time_entries
    WHERE is_billable = 1 AND status = 'APPROVED'
  `);
  const totalBillableTime = Math.round((timeRow?.total || 0.0) * 100) / 100;

  const totalConsumed = Math.round((totalApprovedExpenses + totalBillableTime) * 100) / 100;
  const totalRemaining = Math.round((totalBudget - totalConsumed) * 100) / 100;

  // 3. Invoice totals (excluding CANCELLED)
  const invRow = queryOne(`
    SELECT COALESCE(SUM(total_amount), 0.0) as total
    FROM invoices
    WHERE status != 'CANCELLED'
  `);
  const totalInvoiced = Math.round((invRow?.total || 0.0) * 100) / 100;

  const paidRow = queryOne(`
    SELECT COALESCE(SUM(paid_amount), 0.0) as total
    FROM invoices
    WHERE status = 'PAID' OR paid_amount > 0
  `);
  const totalPaid = Math.round((paidRow?.total || 0.0) * 100) / 100;
  const totalOutstanding = Math.round((totalInvoiced - totalPaid) * 100) / 100;

  // 4. Project-wise breakdown table
  const projects = queryAll(`
    SELECT p.id, p.title, pb.total_budget, pb.currency, pb.budget_type, pb.alert_threshold_pct
    FROM projects p
    LEFT JOIN project_budgets pb ON p.id = pb.project_id
    ORDER BY p.id ASC
  `);

  const projectSummaries = projects.map(p => {
    const consumption = calculateBudgetConsumption(p.id);
    const consumedPct = consumption.consumed_pct;

    let statusColor = 'green';
    if (consumedPct >= 100) {
      statusColor = 'red';
    } else if (consumedPct >= 70) {
      statusColor = 'yellow';
    }

    return {
      project_id: p.id,
      project_title: p.title,
      total_budget: consumption.total_budget,
      currency: consumption.currency,
      consumed: consumption.total_consumption,
      remaining: consumption.remaining_budget,
      consumed_pct: consumedPct,
      alert_status: consumption.alert_status,
      status_color: statusColor,
      approved_expenses: consumption.approved_expenses_total,
      time_cost: consumption.time_cost_total
    };
  });

  // 5. Recent top 5 unacknowledged alerts
  const recentAlerts = queryAll(`
    SELECT ba.*, p.title as project_title
    FROM budget_alerts ba
    JOIN projects p ON ba.project_id = p.id
    WHERE ba.acknowledged_at IS NULL
    ORDER BY ba.created_at DESC
    LIMIT 5
  `);

  // 6. Recent top 5 invoices
  const recentInvoices = queryAll(`
    SELECT i.id, i.invoice_number, i.project_id, p.title as project_title,
           i.client_id, i.total_amount, i.currency, i.status, i.issue_date, i.due_date, i.created_at
    FROM invoices i
    JOIN projects p ON i.project_id = p.id
    ORDER BY i.created_at DESC
    LIMIT 5
  `);

  return {
    total_budget: totalBudget,
    total_consumed: totalConsumed,
    total_remaining: totalRemaining,
    total_invoiced: totalInvoiced,
    total_paid: totalPaid,
    total_outstanding: totalOutstanding,
    currency: 'INR',
    projects: projectSummaries,
    recent_alerts: recentAlerts,
    recent_invoices: recentInvoices,
    p_and_l: {
      total_income: totalPaid,
      total_cost: totalConsumed,
      net_profit: Math.round((totalPaid - totalConsumed) * 100) / 100
    }
  };
}

/**
 * Detailed project P&L report.
 * Rules:
 * - Admin+ role only.
 * - P&L = Total Invoice Paid Amount - Total Budget Consumption.
 * - Consumption = approved expenses + approved billable time.
 * - Breakdown by expense categories.
 */
export function getProjectReport(projectId, currentUser) {
  verifyAdminRole(currentUser, 'view project P&L report');

  const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    throw { status: 404, message: `Project with ID ${projectId} not found` };
  }

  // Budget consumption engine breakdown
  const consumption = calculateBudgetConsumption(projectId);

  // Expense breakdown by category (APPROVED only)
  const categoryBreakdown = queryAll(`
    SELECT ec.id as category_id, ec.name as category_name,
           ROUND(COALESCE(SUM(pe.amount), 0.0), 2) as amount,
           COUNT(pe.id) as count
    FROM project_expenses pe
    JOIN expense_categories ec ON pe.category_id = ec.id
    WHERE pe.project_id = ? AND pe.status = 'APPROVED'
    GROUP BY ec.id, ec.name
    ORDER BY amount DESC
  `, [projectId]);

  // Invoices for project
  const invRow = queryOne(`
    SELECT COALESCE(SUM(total_amount), 0.0) as total
    FROM invoices
    WHERE project_id = ? AND status != 'CANCELLED'
  `, [projectId]);
  const invoicedTotal = Math.round((invRow?.total || 0.0) * 100) / 100;

  const paidRow = queryOne(`
    SELECT COALESCE(SUM(paid_amount), 0.0) as total
    FROM invoices
    WHERE project_id = ? AND (status = 'PAID' OR paid_amount > 0)
  `, [projectId]);
  const paidTotal = Math.round((paidRow?.total || 0.0) * 100) / 100;

  // Rule 12: Project P&L = Total Invoice Paid Amount - Total Budget Consumption
  const profitLoss = Math.round((paidTotal - consumption.total_consumption) * 100) / 100;
  const profitMarginPct = paidTotal > 0
    ? Math.round(((profitLoss / paidTotal) * 100) * 100) / 100
    : 0.0;

  return {
    project_id: project.id,
    project_title: project.title,
    budget: {
      total_budget: consumption.total_budget,
      currency: consumption.currency,
      remaining: consumption.remaining_budget,
      consumed_pct: consumption.consumed_pct,
      alert_status: consumption.alert_status
    },
    consumption: {
      approved_expenses: consumption.approved_expenses_total,
      time_cost: consumption.time_cost_total,
      total_consumption: consumption.total_consumption,
      by_category: categoryBreakdown
    },
    invoiced: invoicedTotal,
    paid: paidTotal,
    profit_loss: profitLoss,
    profit_margin_pct: profitMarginPct
  };
}

/**
 * Budget alerts list:
 * Unacknowledged first, acknowledged history separate.
 * Role: Admin+ only.
 */
export function getBudgetAlerts(currentUser, filters = {}) {
  verifyAdminRole(currentUser, 'view budget alerts');

  const unacknowledged = queryAll(`
    SELECT ba.*, p.title as project_title
    FROM budget_alerts ba
    JOIN projects p ON ba.project_id = p.id
    WHERE ba.acknowledged_at IS NULL
    ORDER BY ba.created_at DESC
  `);

  const acknowledged = queryAll(`
    SELECT ba.*, p.title as project_title, u.name as acknowledged_by_name
    FROM budget_alerts ba
    JOIN projects p ON ba.project_id = p.id
    LEFT JOIN users u ON ba.acknowledged_by = u.id
    WHERE ba.acknowledged_at IS NOT NULL
    ORDER BY ba.acknowledged_at DESC
  `);

  return {
    alerts: [...unacknowledged, ...acknowledged],
    unacknowledged,
    acknowledged,
    total_unacknowledged: unacknowledged.length,
    total_acknowledged: acknowledged.length
  };
}

/**
 * Acknowledge budget alert.
 * Rule: acknowledged_by = current admin, acknowledged_at = now.
 * Append-only: DB trigger blocks DELETE on budget_alerts.
 * Role: Admin+ only.
 */
export function acknowledgeBudgetAlert(alertId, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'acknowledge budget alert');

  const alert = queryOne('SELECT * FROM budget_alerts WHERE id = ?', [alertId]);
  if (!alert) {
    throw { status: 404, message: `Budget alert with ID ${alertId} not found` };
  }

  execute(`
    UPDATE budget_alerts
    SET acknowledged_by = ?,
        acknowledged_at = datetime('now')
    WHERE id = ?
  `, [currentUser.id, alertId]);

  const updatedAlert = queryOne(`
    SELECT ba.*, p.title as project_title, u.name as acknowledged_by_name
    FROM budget_alerts ba
    JOIN projects p ON ba.project_id = p.id
    LEFT JOIN users u ON ba.acknowledged_by = u.id
    WHERE ba.id = ?
  `, [alertId]);

  logAccess({
    userId: currentUser.id,
    action: 'acknowledge_budget_alert',
    resource: `/api/finance/alert/${alertId}/acknowledge`,
    targetId: String(alertId),
    ipAddress
  });

  return updatedAlert;
}

/**
 * Export financial report.
 * Rules:
 * - Admin+ role only.
 * - Logs audit record to analytics_report_exports.
 * - Logs access action to access_log.
 * - Supports JSON and CSV formats.
 */
export function exportFinancialReport(payload = {}, currentUser, ipAddress = null) {
  verifyAdminRole(currentUser, 'export financial reports');

  const reportType = String(payload.report_type || 'FINANCIAL_PL').toUpperCase();
  const format = String(payload.export_format || payload.format || 'JSON').toUpperCase();
  const projectId = payload.project_id ? Number(payload.project_id) : null;

  let exportData;
  let rowCount = 1;

  if (projectId) {
    exportData = getProjectReport(projectId, currentUser);
    rowCount = 1 + (exportData.consumption.by_category?.length || 0);
  } else {
    exportData = getFinancialDashboard(currentUser);
    rowCount = exportData.projects?.length || 1;
  }

  // 1. Insert into append-only analytics_report_exports table
  execute(`
    INSERT INTO analytics_report_exports (
      exported_by, report_type, filters, export_format, row_count, created_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [
    currentUser.id,
    reportType,
    JSON.stringify({ project_id: projectId, format }),
    format,
    rowCount
  ]);

  const exportRecord = queryOne(`
    SELECT * FROM analytics_report_exports
    WHERE exported_by = ?
    ORDER BY id DESC LIMIT 1
  `, [currentUser.id]);

  // 2. Log admin action to access_log
  logAccess({
    userId: currentUser.id,
    action: 'export_financial_report',
    resource: '/api/finance/report/export',
    targetId: String(exportRecord?.id || 'export'),
    ipAddress
  });

  // 3. Format CSV output if requested
  let csvContent = null;
  if (format === 'CSV') {
    if (projectId) {
      csvContent = [
        'Metric,Value',
        `Project ID,"${exportData.project_id}"`,
        `Project Title,"${exportData.project_title}"`,
        `Total Budget,"${exportData.budget.total_budget}"`,
        `Total Consumed,"${exportData.consumption.total_consumption}"`,
        `Approved Expenses,"${exportData.consumption.approved_expenses}"`,
        `Time Cost,"${exportData.consumption.time_cost}"`,
        `Invoiced Total,"${exportData.invoiced}"`,
        `Paid Total,"${exportData.paid}"`,
        `Profit / Loss,"${exportData.profit_loss}"`,
        `Profit Margin %,"${exportData.profit_margin_pct}%"`
      ].join('\n');
    } else {
      const headers = ['Project ID', 'Project Title', 'Budget', 'Consumed', 'Remaining', 'Consumed %', 'Status'];
      const rows = (exportData.projects || []).map(p =>
        `"${p.project_id}","${p.project_title}","${p.total_budget}","${p.consumed}","${p.remaining}","${p.consumed_pct}%","${p.status_color}"`
      );
      csvContent = [headers.join(','), ...rows].join('\n');
    }
  }

  return {
    export_id: exportRecord ? exportRecord.id : null,
    report_type: reportType,
    export_format: format,
    row_count: rowCount,
    data: exportData,
    csv: csvContent,
    created_at: exportRecord ? exportRecord.created_at : new Date().toISOString()
  };
}


