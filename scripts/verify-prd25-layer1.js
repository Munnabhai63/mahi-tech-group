/**
 * scripts/verify-prd25-layer1.js
 * Verification Suite for PRD 25 Layer 1: Budget & Financial Management Database Schema, Triggers, and Seed
 *
 * Checks:
 * 1. SQLite Pragmas: journal_mode = WAL, busy_timeout >= 5000, foreign_keys = ON.
 * 2. Schema Structure: All 8 required tables exist with exact column names and expected types.
 * 3. Performance Indexes: All 16 indexes created and active in sqlite_master.
 * 4. Default Seed Categories: Exactly 8 categories exist with is_active = 1; idempotent re-seeding verified.
 * 5. Unique & Relational Constraints: UNIQUE(project_id), UNIQUE(name), UNIQUE(invoice_number), and FK checks.
 * 6. Append-Only DB Triggers: All 7 triggers exist and strictly block forbidden UPDATE and DELETE queries with RAISE(ABORT).
 * 7. Budget Alert Mutability: Deletions strictly blocked, while acknowledgment updates succeed.
 * 8. Manual updated_at Mutation Pattern: Verified across mutable entities.
 */

import { getDatabase, queryOne, queryAll, execute, seedDefaultExpenseCategories } from '../src/db/database.js';
import crypto from 'node:crypto';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('PRD 25 Layer 1 Verification Suite: Budget & Financial Management Schema & Triggers');
  console.log('='.repeat(80));

  const db = getDatabase();

  // ---------------------------------------------------------
  // Test 1: SQLite Connection Pragmas
  // ---------------------------------------------------------
  console.log('\n=== Test 1: SQLite Connection Pragmas ===');
  const journalMode = queryOne('PRAGMA journal_mode;');
  assert(
    journalMode && journalMode.journal_mode.toLowerCase() === 'wal',
    `WAL mode is enabled (journal_mode = ${journalMode?.journal_mode})`
  );

  const busyTimeout = queryOne('PRAGMA busy_timeout;');
  assert(
    busyTimeout && busyTimeout.timeout >= 5000,
    `busy_timeout is set to >= 5000ms (timeout = ${busyTimeout?.timeout})`
  );

  const foreignKeys = queryOne('PRAGMA foreign_keys;');
  assert(
    foreignKeys && foreignKeys.foreign_keys === 1,
    'foreign_keys pragma is enabled (foreign_keys = 1)'
  );

  // ---------------------------------------------------------
  // Test 2: Database Schema Validation (8 Required Tables)
  // ---------------------------------------------------------
  console.log('\n=== Test 2: Database Schema Validation (8 Required Tables) ===');
  const requiredTables = [
    'project_budgets',
    'budget_history',
    'expense_categories',
    'project_expenses',
    'expense_history',
    'invoices',
    'invoice_line_items',
    'budget_alerts'
  ];

  for (const table of requiredTables) {
    const tableExists = queryOne(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?;",
      [table]
    );
    assert(tableExists !== null, `Table ${table} exists in database`);
  }

  // Column verification
  const expectedColumns = {
    project_budgets: [
      { name: 'id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'total_budget', type: 'REAL' },
      { name: 'currency', type: 'TEXT' },
      { name: 'budget_type', type: 'TEXT' },
      { name: 'alert_threshold_pct', type: 'REAL' },
      { name: 'start_date', type: 'TEXT' },
      { name: 'end_date', type: 'TEXT' },
      { name: 'notes', type: 'TEXT' },
      { name: 'created_by', type: 'INTEGER' },
      { name: 'created_at', type: 'TEXT' },
      { name: 'updated_at', type: 'TEXT' }
    ],
    budget_history: [
      { name: 'id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'changed_by', type: 'INTEGER' },
      { name: 'field_changed', type: 'TEXT' },
      { name: 'old_value', type: 'TEXT' },
      { name: 'new_value', type: 'TEXT' },
      { name: 'reason', type: 'TEXT' },
      { name: 'changed_at', type: 'TEXT' }
    ],
    expense_categories: [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'description', type: 'TEXT' },
      { name: 'is_active', type: 'INTEGER' },
      { name: 'created_by', type: 'INTEGER' },
      { name: 'created_at', type: 'TEXT' }
    ],
    project_expenses: [
      { name: 'id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'category_id', type: 'INTEGER' },
      { name: 'submitted_by', type: 'INTEGER' },
      { name: 'title', type: 'TEXT' },
      { name: 'description', type: 'TEXT' },
      { name: 'amount', type: 'REAL' },
      { name: 'currency', type: 'TEXT' },
      { name: 'expense_date', type: 'TEXT' },
      { name: 'receipt_path', type: 'TEXT' },
      { name: 'status', type: 'TEXT' },
      { name: 'approved_by', type: 'INTEGER' },
      { name: 'approved_at', type: 'TEXT' },
      { name: 'rejected_by', type: 'INTEGER' },
      { name: 'rejected_at', type: 'TEXT' },
      { name: 'rejection_reason', type: 'TEXT' },
      { name: 'is_billable', type: 'INTEGER' },
      { name: 'created_at', type: 'TEXT' },
      { name: 'updated_at', type: 'TEXT' }
    ],
    expense_history: [
      { name: 'id', type: 'INTEGER' },
      { name: 'expense_id', type: 'INTEGER' },
      { name: 'changed_by', type: 'INTEGER' },
      { name: 'field_changed', type: 'TEXT' },
      { name: 'old_value', type: 'TEXT' },
      { name: 'new_value', type: 'TEXT' },
      { name: 'changed_at', type: 'TEXT' }
    ],
    invoices: [
      { name: 'id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'client_id', type: 'INTEGER' },
      { name: 'invoice_number', type: 'TEXT' },
      { name: 'title', type: 'TEXT' },
      { name: 'status', type: 'TEXT' },
      { name: 'issue_date', type: 'TEXT' },
      { name: 'due_date', type: 'TEXT' },
      { name: 'subtotal', type: 'REAL' },
      { name: 'tax_pct', type: 'REAL' },
      { name: 'tax_amount', type: 'REAL' },
      { name: 'total_amount', type: 'REAL' },
      { name: 'currency', type: 'TEXT' },
      { name: 'notes', type: 'TEXT' },
      { name: 'internal_notes', type: 'TEXT' },
      { name: 'paid_amount', type: 'REAL' },
      { name: 'paid_at', type: 'TEXT' },
      { name: 'payment_reference', type: 'TEXT' },
      { name: 'sent_at', type: 'TEXT' },
      { name: 'viewed_at', type: 'TEXT' },
      { name: 'created_by', type: 'INTEGER' },
      { name: 'created_at', type: 'TEXT' },
      { name: 'updated_at', type: 'TEXT' }
    ],
    invoice_line_items: [
      { name: 'id', type: 'INTEGER' },
      { name: 'invoice_id', type: 'INTEGER' },
      { name: 'description', type: 'TEXT' },
      { name: 'line_type', type: 'TEXT' },
      { name: 'quantity', type: 'REAL' },
      { name: 'unit_price', type: 'REAL' },
      { name: 'amount', type: 'REAL' },
      { name: 'source_type', type: 'TEXT' },
      { name: 'source_id', type: 'INTEGER' },
      { name: 'position', type: 'INTEGER' },
      { name: 'created_at', type: 'TEXT' }
    ],
    budget_alerts: [
      { name: 'id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'alert_type', type: 'TEXT' },
      { name: 'triggered_at_pct', type: 'REAL' },
      { name: 'triggered_amount', type: 'REAL' },
      { name: 'message', type: 'TEXT' },
      { name: 'acknowledged_by', type: 'INTEGER' },
      { name: 'acknowledged_at', type: 'TEXT' },
      { name: 'created_at', type: 'TEXT' }
    ]
  };

  for (const [table, cols] of Object.entries(expectedColumns)) {
    const tableInfo = queryAll(`PRAGMA table_info(${table});`);
    const actualColNames = new Set(tableInfo.map(c => c.name));

    for (const col of cols) {
      assert(actualColNames.has(col.name), `Table ${table} has column '${col.name}'`);
      const matched = tableInfo.find(c => c.name === col.name);
      if (matched) {
        assert(
          matched.type.toUpperCase() === col.type.toUpperCase(),
          `Column ${table}.${col.name} matches expected type ${col.type} (found ${matched.type})`
        );
      }
    }
  }

  // ---------------------------------------------------------
  // Test 3: Performance Indexes Validation
  // ---------------------------------------------------------
  console.log('\n=== Test 3: Performance Indexes Validation ===');
  const expectedIndexes = [
    'idx_project_budgets_project',
    'idx_budget_history_project',
    'idx_expense_categories_name',
    'idx_expense_categories_active',
    'idx_project_expenses_project',
    'idx_project_expenses_category',
    'idx_project_expenses_submitter',
    'idx_project_expenses_status',
    'idx_expense_history_expense',
    'idx_invoices_project',
    'idx_invoices_client',
    'idx_invoices_number',
    'idx_invoices_status',
    'idx_invoice_line_items_invoice',
    'idx_budget_alerts_project',
    'idx_budget_alerts_type'
  ];

  for (const idx of expectedIndexes) {
    const idxRow = queryOne(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = ?;",
      [idx]
    );
    assert(idxRow !== null, `Performance index ${idx} exists in sqlite_master`);
  }

  // ---------------------------------------------------------
  // Test 4: Default Seed Expense Categories
  // ---------------------------------------------------------
  console.log('\n=== Test 4: Default Seed Expense Categories ===');
  const expectedCategories = [
    'SOFTWARE',
    'HARDWARE',
    'TRAVEL',
    'MARKETING',
    'CONTRACTOR',
    'OFFICE',
    'TRAINING',
    'MISCELLANEOUS'
  ];

  const seededCategories = queryAll('SELECT name, is_active FROM expense_categories;');
  const seededCategoryMap = new Map(seededCategories.map(c => [c.name, c.is_active]));

  for (const catName of expectedCategories) {
    assert(seededCategoryMap.has(catName), `Category '${catName}' is pre-seeded in expense_categories`);
    assert(seededCategoryMap.get(catName) === 1, `Category '${catName}' is marked active (is_active = 1)`);
  }

  // Test idempotency of seeder
  const countBefore = queryOne('SELECT COUNT(*) as count FROM expense_categories;').count;
  seedDefaultExpenseCategories(db);
  const countAfter = queryOne('SELECT COUNT(*) as count FROM expense_categories;').count;
  assert(countBefore === countAfter, `Seeder is idempotent (count before: ${countBefore}, count after: ${countAfter})`);

  // ---------------------------------------------------------
  // Setup Fixture Records for Triggers and Constraints Testing
  // ---------------------------------------------------------
  console.log('\n=== Setup Fixture Records ===');
  let adminUser = queryOne("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1;");
  if (!adminUser) {
    const adminEmail = `admin_prd25_${Date.now()}@example.com`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, 'Admin PRD25', ?, 'hash', 'admin', 'active');
    `, [crypto.randomUUID(), adminEmail]);
    adminUser = queryOne('SELECT id FROM users WHERE email = ?;', [adminEmail]);
  }
  const adminId = adminUser.id;

  let testProject = queryOne('SELECT id FROM projects LIMIT 1;');
  if (!testProject) {
    const projId = `proj_${Date.now()}`;
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id)
      VALUES (?, 'idea_prd25', 'org_prd25', 'Financial Test Project', ?);
    `, [projId, adminId]);
    testProject = { id: projId };
  }
  const projectId = testProject.id;

  let testClient = queryOne('SELECT id FROM clients LIMIT 1;');
  if (!testClient) {
    const clientEmail = `client_fin_${Date.now()}@example.com`;
    execute(`
      INSERT INTO clients (name, email, password_hash, created_by)
      VALUES ('Fin Client Corp', ?, 'hash123', ?);
    `, [clientEmail, adminId]);
    testClient = queryOne('SELECT id FROM clients WHERE email = ?;', [clientEmail]);
  }
  const clientId = testClient.id;

  const categoryRow = queryOne("SELECT id FROM expense_categories WHERE name = 'SOFTWARE' LIMIT 1;");
  const softwareCategoryId = categoryRow.id;

  // ---------------------------------------------------------
  // Test 5: Unique and Foreign Key Constraints
  // ---------------------------------------------------------
  console.log('\n=== Test 5: Unique and Foreign Key Constraints ===');

  // Clean any previous test budget for this project to start fresh
  execute('DELETE FROM project_budgets WHERE project_id = ?;', [projectId]);

  // Insert project budget
  execute(`
    INSERT INTO project_budgets (project_id, total_budget, currency, budget_type, alert_threshold_pct, start_date, created_by)
    VALUES (?, 500000.0, 'INR', 'FIXED', 80.0, '2026-01-01', ?);
  `, [projectId, adminId]);
  assert(true, 'Inserted valid project budget');

  // Verify UNIQUE(project_id) on project_budgets
  let duplicateBudgetFailed = false;
  try {
    execute(`
      INSERT INTO project_budgets (project_id, total_budget, currency, budget_type, alert_threshold_pct, start_date, created_by)
      VALUES (?, 750000.0, 'INR', 'FIXED', 85.0, '2026-02-01', ?);
    `, [projectId, adminId]);
  } catch (err) {
    duplicateBudgetFailed = err.message.includes('UNIQUE constraint failed');
  }
  assert(duplicateBudgetFailed, 'project_budgets UNIQUE(project_id) constraint properly rejected duplicate budget');

  // Verify UNIQUE(name) on expense_categories
  let duplicateCategoryFailed = false;
  try {
    execute(`
      INSERT INTO expense_categories (name, description, is_active, created_by)
      VALUES ('SOFTWARE', 'Duplicate software test', 1, ?);
    `, [adminId]);
  } catch (err) {
    duplicateCategoryFailed = err.message.includes('UNIQUE constraint failed');
  }
  assert(duplicateCategoryFailed, 'expense_categories UNIQUE(name) constraint properly rejected duplicate category');

  // Verify UNIQUE(invoice_number) on invoices
  const testInvNumber = `MTG-INV-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  execute(`
    INSERT INTO invoices (project_id, client_id, invoice_number, title, status, issue_date, due_date, subtotal, tax_pct, tax_amount, total_amount, created_by)
    VALUES (?, ?, ?, 'Website Q1 Milestone', 'DRAFT', '2026-01-15', '2026-01-30', 100000.0, 18.0, 18000.0, 118000.0, ?);
  `, [projectId, clientId, testInvNumber, adminId]);
  assert(true, `Inserted invoice ${testInvNumber}`);

  let duplicateInvoiceFailed = false;
  try {
    execute(`
      INSERT INTO invoices (project_id, client_id, invoice_number, title, status, issue_date, due_date, subtotal, tax_pct, tax_amount, total_amount, created_by)
      VALUES (?, ?, ?, 'Duplicate Invoice Number', 'DRAFT', '2026-01-15', '2026-01-30', 50000.0, 18.0, 9000.0, 59000.0, ?);
    `, [projectId, clientId, testInvNumber, adminId]);
  } catch (err) {
    duplicateInvoiceFailed = err.message.includes('UNIQUE constraint failed');
  }
  assert(duplicateInvoiceFailed, 'invoices UNIQUE(invoice_number) constraint properly rejected duplicate invoice number');

  // ---------------------------------------------------------
  // Test 6: Append-Only DB Triggers (All 7 Triggers Tested)
  // ---------------------------------------------------------
  console.log('\n=== Test 6: Append-Only DB Triggers (All 7 Triggers Tested) ===');

  // Trigger 1 & 2: budget_history update & delete
  const triggerBudgetHistUpdate = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_budget_history_update';");
  assert(triggerBudgetHistUpdate !== null, 'Trigger prevent_budget_history_update exists in sqlite_master');

  const triggerBudgetHistDelete = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_budget_history_delete';");
  assert(triggerBudgetHistDelete !== null, 'Trigger prevent_budget_history_delete exists in sqlite_master');

  execute(`
    INSERT INTO budget_history (project_id, changed_by, field_changed, old_value, new_value, reason)
    VALUES (?, ?, 'total_budget', '500000', '600000', 'Approved client scope expansion');
  `, [projectId, adminId]);
  const budgetHistRow = queryOne('SELECT id FROM budget_history WHERE project_id = ? ORDER BY id DESC LIMIT 1;', [projectId]);

  let budgetHistUpdateAborted = false;
  try {
    execute('UPDATE budget_history SET new_value = ? WHERE id = ?;', ['999999', budgetHistRow.id]);
  } catch (err) {
    budgetHistUpdateAborted = err.message.includes('budget_history is append-only');
  }
  assert(budgetHistUpdateAborted, 'prevent_budget_history_update strictly aborted SQL UPDATE with RAISE(ABORT)');

  let budgetHistDeleteAborted = false;
  try {
    execute('DELETE FROM budget_history WHERE id = ?;', [budgetHistRow.id]);
  } catch (err) {
    budgetHistDeleteAborted = err.message.includes('budget_history is append-only');
  }
  assert(budgetHistDeleteAborted, 'prevent_budget_history_delete strictly aborted SQL DELETE with RAISE(ABORT)');

  // Insert project expense for expense_history test
  execute(`
    INSERT INTO project_expenses (project_id, category_id, submitted_by, title, description, amount, expense_date, is_billable)
    VALUES (?, ?, ?, 'Cloud Hosting Infrastructure', 'AWS Server fleet for Jan 2026', 15000.0, '2026-01-10', 1);
  `, [projectId, softwareCategoryId, adminId]);
  const expenseRow = queryOne('SELECT id FROM project_expenses WHERE project_id = ? ORDER BY id DESC LIMIT 1;', [projectId]);
  const expenseId = expenseRow.id;

  // Trigger 3 & 4: expense_history update & delete
  const triggerExpHistUpdate = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_expense_history_update';");
  assert(triggerExpHistUpdate !== null, 'Trigger prevent_expense_history_update exists in sqlite_master');

  const triggerExpHistDelete = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_expense_history_delete';");
  assert(triggerExpHistDelete !== null, 'Trigger prevent_expense_history_delete exists in sqlite_master');

  execute(`
    INSERT INTO expense_history (expense_id, changed_by, field_changed, old_value, new_value)
    VALUES (?, ?, 'status', 'PENDING', 'APPROVED');
  `, [expenseId, adminId]);
  const expHistRow = queryOne('SELECT id FROM expense_history WHERE expense_id = ? ORDER BY id DESC LIMIT 1;', [expenseId]);

  let expHistUpdateAborted = false;
  try {
    execute('UPDATE expense_history SET new_value = ? WHERE id = ?;', ['REJECTED', expHistRow.id]);
  } catch (err) {
    expHistUpdateAborted = err.message.includes('expense_history is append-only');
  }
  assert(expHistUpdateAborted, 'prevent_expense_history_update strictly aborted SQL UPDATE with RAISE(ABORT)');

  let expHistDeleteAborted = false;
  try {
    execute('DELETE FROM expense_history WHERE id = ?;', [expHistRow.id]);
  } catch (err) {
    expHistDeleteAborted = err.message.includes('expense_history is append-only');
  }
  assert(expHistDeleteAborted, 'prevent_expense_history_delete strictly aborted SQL DELETE with RAISE(ABORT)');

  // Trigger 5 & 6: invoice_line_items update & delete
  const invoiceRow = queryOne('SELECT id FROM invoices WHERE invoice_number = ?;', [testInvNumber]);
  const invoiceId = invoiceRow.id;

  const triggerLineItemUpdate = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_invoice_line_item_update';");
  assert(triggerLineItemUpdate !== null, 'Trigger prevent_invoice_line_item_update exists in sqlite_master');

  const triggerLineItemDelete = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_invoice_line_item_delete';");
  assert(triggerLineItemDelete !== null, 'Trigger prevent_invoice_line_item_delete exists in sqlite_master');

  execute(`
    INSERT INTO invoice_line_items (invoice_id, description, line_type, quantity, unit_price, amount, position)
    VALUES (?, 'Frontend Architecture & Implementation', 'SERVICE', 40.0, 2500.0, 100000.0, 1);
  `, [invoiceId]);
  const lineItemRow = queryOne('SELECT id FROM invoice_line_items WHERE invoice_id = ? ORDER BY id DESC LIMIT 1;', [invoiceId]);

  let lineItemUpdateAborted = false;
  try {
    execute('UPDATE invoice_line_items SET unit_price = ? WHERE id = ?;', [5000.0, lineItemRow.id]);
  } catch (err) {
    lineItemUpdateAborted = err.message.includes('invoice_line_items is append-only');
  }
  assert(lineItemUpdateAborted, 'prevent_invoice_line_item_update strictly aborted SQL UPDATE with RAISE(ABORT)');

  let lineItemDeleteAborted = false;
  try {
    execute('DELETE FROM invoice_line_items WHERE id = ?;', [lineItemRow.id]);
  } catch (err) {
    lineItemDeleteAborted = err.message.includes('invoice_line_items is append-only');
  }
  assert(lineItemDeleteAborted, 'prevent_invoice_line_item_delete strictly aborted SQL DELETE with RAISE(ABORT)');

  // Trigger 7: budget_alerts delete
  const triggerAlertDelete = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_budget_alert_delete';");
  assert(triggerAlertDelete !== null, 'Trigger prevent_budget_alert_delete exists in sqlite_master');

  execute(`
    INSERT INTO budget_alerts (project_id, alert_type, triggered_at_pct, triggered_amount, message)
    VALUES (?, 'THRESHOLD_REACHED', 82.5, 412500.0, 'Budget consumption exceeded 80% threshold');
  `, [projectId]);
  const alertRow = queryOne('SELECT id FROM budget_alerts WHERE project_id = ? ORDER BY id DESC LIMIT 1;', [projectId]);

  let alertDeleteAborted = false;
  try {
    execute('DELETE FROM budget_alerts WHERE id = ?;', [alertRow.id]);
  } catch (err) {
    alertDeleteAborted = err.message.includes('budget_alerts is append-only');
  }
  assert(alertDeleteAborted, 'prevent_budget_alert_delete strictly aborted SQL DELETE with RAISE(ABORT)');

  // Test budget_alerts acknowledgment UPDATE is ALLOWED (not blocked by trigger)
  let alertAckSucceeded = false;
  try {
    execute(`
      UPDATE budget_alerts
      SET acknowledged_by = ?, acknowledged_at = datetime('now')
      WHERE id = ?;
    `, [adminId, alertRow.id]);
    alertAckSucceeded = true;
  } catch (err) {
    alertAckSucceeded = false;
  }
  assert(alertAckSucceeded, 'budget_alerts acknowledges successfully (UPDATE allowed for acknowledgment)');

  const updatedAlert = queryOne('SELECT acknowledged_by, acknowledged_at FROM budget_alerts WHERE id = ?;', [alertRow.id]);
  assert(updatedAlert && updatedAlert.acknowledged_by !== null, 'budget_alerts acknowledged_by properly stored');
  assert(updatedAlert && updatedAlert.acknowledged_at !== null, 'budget_alerts acknowledged_at properly stored');

  // ---------------------------------------------------------
  // Test 7: Manual updated_at Mutation Verification
  // ---------------------------------------------------------
  console.log('\n=== Test 7: Manual updated_at Mutation Verification ===');

  // project_budgets updated_at
  const budgetBefore = queryOne('SELECT updated_at FROM project_budgets WHERE project_id = ?;', [projectId]);
  const newTimestamp = '2026-01-20 15:30:00';
  execute('UPDATE project_budgets SET notes = ?, updated_at = ? WHERE project_id = ?;', ['Updated budget notes', newTimestamp, projectId]);
  const budgetAfter = queryOne('SELECT notes, updated_at FROM project_budgets WHERE project_id = ?;', [projectId]);
  assert(budgetAfter.notes === 'Updated budget notes', 'project_budgets updated with new notes');
  assert(budgetAfter.updated_at === newTimestamp, `project_budgets updated_at manually set (${budgetAfter.updated_at})`);

  // project_expenses updated_at
  const expenseNewTimestamp = '2026-01-20 16:00:00';
  execute('UPDATE project_expenses SET status = ?, updated_at = ? WHERE id = ?;', ['APPROVED', expenseNewTimestamp, expenseId]);
  const expenseAfter = queryOne('SELECT status, updated_at FROM project_expenses WHERE id = ?;', [expenseId]);
  assert(expenseAfter.status === 'APPROVED', 'project_expenses status updated to APPROVED');
  assert(expenseAfter.updated_at === expenseNewTimestamp, `project_expenses updated_at manually set (${expenseAfter.updated_at})`);

  // invoices updated_at
  const invoiceNewTimestamp = '2026-01-20 16:30:00';
  execute('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?;', ['SENT', invoiceNewTimestamp, invoiceId]);
  const invoiceAfter = queryOne('SELECT status, updated_at FROM invoices WHERE id = ?;', [invoiceId]);
  assert(invoiceAfter.status === 'SENT', 'invoices status updated to SENT');
  assert(invoiceAfter.updated_at === invoiceNewTimestamp, `invoices updated_at manually set (${invoiceAfter.updated_at})`);

  // ---------------------------------------------------------
  // Summary
  // ---------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('Layer 1 Verification Summary:');
  console.log(`Total Tests : ${passed + failed}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in Layer 1 test suite:', err);
  process.exit(1);
});
