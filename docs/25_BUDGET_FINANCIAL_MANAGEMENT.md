# PRD 25 — Budget & Financial Management
**File:** docs/25_BUDGET_FINANCIAL_MANAGEMENT.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 16 (Point Pool), PRD 22 (Time Tracking), PRD 23 (Analytics), PRD 24 (Client Portal)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Harvest (Project budgets, expense tracking, invoice generation, budget burn rate)
- Wrike (Budget tracking — planned vs actual, resource cost, project profitability)
- ClickUp (Budget widget, cost per task, financial summary per project)
- Smartsheet (Budget management — line items, actuals vs planned, variance reporting)
- QuickBooks / FreshBooks (Invoice generation, expense categories, profit/loss reports)
- Jira + Tempo (Financial tracking — planned cost, logged cost via time entries, budget alerts)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's budget/financial flow — how project budgets are set, how expenses are logged, how invoices are generated, how budget burn rate is tracked, how profit/loss is calculated
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (Project → Budget → Expenses → Time Cost → Revenue → Profit/Loss)
4. Map every business rule (e.g., budget alert when 80% consumed, invoice generated only after client approval, expense must be approved before counted against budget)
5. Identify what we will NOT copy (visual design, branding, color scheme, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group complete Budget and Financial Management so Admin can set project budgets, track expenses, calculate time-based costs from time tracking data, generate invoices for clients, monitor budget burn rate, and view profit/loss per project — all built our own way with full audit trail.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Create Project Budget | ✅ | ✅ | ❌ |
| Edit Project Budget | ✅ | ✅ | ❌ |
| Log Expense | ✅ | ✅ | ✅ (own only) |
| Approve Expense | ✅ | ✅ | ❌ |
| Reject Expense | ✅ | ✅ | ❌ |
| Create Invoice | ✅ | ✅ | ❌ |
| Send Invoice to Client | ✅ | ✅ | ❌ |
| Mark Invoice as Paid | ✅ | ✅ | ❌ |
| View Financial Dashboard | ✅ | ✅ | ❌ |
| View own expense history | ✅ | ✅ | ✅ |
| View project P&L | ✅ | ✅ | ❌ |
| Export Financial Report | ✅ | ✅ | ❌ |
| Set expense categories | ✅ | ✅ | ❌ |
| View budget alerts | ✅ | ✅ | ❌ |

---

## 🗄️ Database Tables (New — 8 Tables)

### Table 1: project_budgets

CREATE TABLE project_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) UNIQUE,
  total_budget REAL NOT NULL DEFAULT 0.0,
  currency TEXT NOT NULL DEFAULT 'INR',
  budget_type TEXT NOT NULL DEFAULT 'FIXED',
  -- FIXED | TIME_AND_MATERIAL | RETAINER
  alert_threshold_pct REAL NOT NULL DEFAULT 80.0,
  start_date TEXT NOT NULL,
  end_date TEXT,
  -- NULL = ongoing project
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Rule: only one budget per project
-- Budget edits logged to budget_history

### Table 2: budget_history

CREATE TABLE budget_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  -- 'total_budget' | 'alert_threshold_pct' | 'budget_type' | etc.
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  -- mandatory reason for every budget change (min 10 chars)
  changed_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete

### Table 3: expense_categories

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
-- Pre-seeded categories:
-- SOFTWARE | HARDWARE | TRAVEL | MARKETING | CONTRACTOR | OFFICE | TRAINING | MISCELLANEOUS

### Table 4: project_expenses

CREATE TABLE project_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  expense_date TEXT NOT NULL,
  receipt_path TEXT,
  -- file path of uploaded receipt (optional)
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING | APPROVED | REJECTED
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  rejected_by INTEGER REFERENCES users(id),
  rejected_at TEXT,
  rejection_reason TEXT,
  is_billable INTEGER NOT NULL DEFAULT 0,
  -- 1 = billable to client, 0 = internal cost
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Only APPROVED expenses count toward budget consumption

### Table 5: expense_history

CREATE TABLE expense_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES project_expenses(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete

### Table 6: invoices

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  client_id INTEGER REFERENCES clients(id),
  -- NULL if invoice is internal (no client)
  invoice_number TEXT NOT NULL UNIQUE,
  -- auto-generated: MTG-INV-YYYY-NNNN
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  -- DRAFT | SENT | VIEWED | PAID | OVERDUE | CANCELLED
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0.0,
  tax_pct REAL NOT NULL DEFAULT 0.0,
  tax_amount REAL NOT NULL DEFAULT 0.0,
  -- calculated: subtotal x (tax_pct / 100)
  total_amount REAL NOT NULL DEFAULT 0.0,
  -- calculated: subtotal + tax_amount
  currency TEXT NOT NULL DEFAULT 'INR',
  notes TEXT,
  -- visible to client on invoice
  internal_notes TEXT,
  -- NEVER sent to client
  paid_amount REAL DEFAULT 0.0,
  paid_at TEXT,
  payment_reference TEXT,
  sent_at TEXT,
  viewed_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- invoice_number auto-generated in service: MTG-INV-{YEAR}-{4-digit-sequence}
-- internal_notes NEVER returned to client endpoints

### Table 7: invoice_line_items

CREATE TABLE invoice_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  line_type TEXT NOT NULL DEFAULT 'SERVICE',
  -- SERVICE | EXPENSE | TIME | MILESTONE | CUSTOM
  quantity REAL NOT NULL DEFAULT 1.0,
  unit_price REAL NOT NULL DEFAULT 0.0,
  amount REAL NOT NULL DEFAULT 0.0,
  -- calculated: quantity x unit_price (server-side only)
  source_type TEXT,
  -- TIME_ENTRY | EXPENSE | MILESTONE | NULL
  source_id INTEGER,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- Line items cannot be edited after invoice is SENT

### Table 8: budget_alerts

CREATE TABLE budget_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  alert_type TEXT NOT NULL,
  -- THRESHOLD_REACHED | BUDGET_EXCEEDED | INVOICE_OVERDUE | EXPENSE_SPIKE
  triggered_at_pct REAL,
  triggered_amount REAL,
  message TEXT NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: only acknowledged_by and acknowledged_at mutable (exception for ack fields)

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_budget_history_update
BEFORE UPDATE ON budget_history
BEGIN SELECT RAISE(ABORT, 'budget_history is append-only'); END;

CREATE TRIGGER prevent_budget_history_delete
BEFORE DELETE ON budget_history
BEGIN SELECT RAISE(ABORT, 'budget_history is append-only'); END;

CREATE TRIGGER prevent_expense_history_update
BEFORE UPDATE ON expense_history
BEGIN SELECT RAISE(ABORT, 'expense_history is append-only'); END;

CREATE TRIGGER prevent_expense_history_delete
BEFORE DELETE ON expense_history
BEGIN SELECT RAISE(ABORT, 'expense_history is append-only'); END;

CREATE TRIGGER prevent_invoice_line_item_update
BEFORE UPDATE ON invoice_line_items
BEGIN SELECT RAISE(ABORT, 'invoice_line_items is append-only'); END;

CREATE TRIGGER prevent_invoice_line_item_delete
BEFORE DELETE ON invoice_line_items
BEGIN SELECT RAISE(ABORT, 'invoice_line_items is append-only'); END;

CREATE TRIGGER prevent_budget_alert_delete
BEFORE DELETE ON budget_alerts
BEGIN SELECT RAISE(ABORT, 'budget_alerts is append-only'); END;

---

## 📊 Calculation Rules (Non-Negotiable)

1. Budget Consumption = SUM(APPROVED expenses) + SUM(billable time cost from time_entries)
   Time cost = (duration_minutes / 60) x billable_rate per entry
2. Budget Remaining = total_budget - Budget Consumption
3. Budget Consumed % = (Budget Consumption / total_budget) x 100
4. Alert auto-triggered when Budget Consumed % >= alert_threshold_pct
5. Alert auto-triggered when Budget Consumed % >= 100 (BUDGET_EXCEEDED)
6. Invoice subtotal = SUM(amount) of all invoice_line_items
7. Invoice tax_amount = subtotal x (tax_pct / 100) — rounded to 2 decimal places
8. Invoice total_amount = subtotal + tax_amount
9. Line item amount = quantity x unit_price — calculated server-side, never trusted from client
10. Invoice status auto-changes to OVERDUE if due_date passed and status is SENT or VIEWED
11. Invoice number format: MTG-INV-{YYYY}-{4-digit zero-padded sequence} e.g. MTG-INV-2025-0001
12. Project P&L = Total Invoice Paid Amount - Total Budget Consumption
13. All financial calculations server-side — client never sends calculated totals
14. Budget change always requires mandatory reason (min 10 chars) logged to budget_history

---

## 🔌 API Routes (24 Endpoints)

### Budget Routes

POST   /api/finance/budget/create
         body: { project_id, total_budget, currency, budget_type, alert_threshold_pct, start_date, end_date, notes }
         rule: one budget per project enforced
         role: Admin+

GET    /api/finance/budget/:projectId
         returns: budget detail + current consumption + remaining + consumed % + alert status
         role: Admin+

PATCH  /api/finance/budget/:projectId
         body: { total_budget, alert_threshold_pct, budget_type, end_date, notes, reason }
         rule: reason mandatory (min 10 chars); auto-logs to budget_history
         role: Admin+

GET    /api/finance/budget/:projectId/history
         returns: full budget_history for project
         role: Admin+

### Expense Routes

POST   /api/finance/expense/submit
         body: { project_id, category_id, title, description, amount, currency, expense_date, is_billable, receipt_path }
         role: All (own expense)

GET    /api/finance/expenses/project/:projectId
         query: ?status=&category_id=&from=&to=&submitted_by=
         returns: all expenses for project (with filters)
         role: Admin+

GET    /api/finance/expenses/my
         query: ?project_id=&status=
         returns: own expense history
         role: All

PATCH  /api/finance/expense/:expenseId/approve
         rule: status → APPROVED; logs to expense_history; triggers budget consumption recalculation; checks alert threshold
         role: Admin+

PATCH  /api/finance/expense/:expenseId/reject
         body: { rejection_reason }
         rule: status → REJECTED; rejection_reason mandatory (min 10 chars)
         role: Admin+

PATCH  /api/finance/expense/:expenseId
         body: { title, description, amount, expense_date, category_id }
         rule: only PENDING expenses editable; auto-logs to expense_history
         role: Owner (PENDING only) or Admin+

### Expense Category Routes

POST   /api/finance/category/create
         body: { name, description }
         role: Admin+

GET    /api/finance/categories
         returns: all active expense categories
         role: All

PATCH  /api/finance/category/:categoryId
         body: { name, description, is_active }
         role: Admin+

### Invoice Routes

POST   /api/finance/invoice/create
         body: { project_id, client_id, title, issue_date, due_date, tax_pct, notes, internal_notes }
         rule: invoice_number auto-generated; status = DRAFT
         role: Admin+

POST   /api/finance/invoice/:invoiceId/line-item/add
         body: { description, line_type, quantity, unit_price, source_type, source_id, position }
         rule: only DRAFT invoices can have line items added; amount calculated server-side
         role: Admin+

GET    /api/finance/invoices/project/:projectId
         returns: all invoices for project
         role: Admin+

GET    /api/finance/invoice/:invoiceId
         returns: invoice detail + line items (internal_notes excluded for client-facing version)
         role: Admin+

PATCH  /api/finance/invoice/:invoiceId/send
         rule: status → SENT; sent_at = now; sends notification to client (if client_id set)
         role: Admin+

PATCH  /api/finance/invoice/:invoiceId/mark-paid
         body: { paid_amount, payment_reference, paid_at }
         rule: status → PAID; logs to access_log
         role: Admin+

PATCH  /api/finance/invoice/:invoiceId/cancel
         rule: only DRAFT or SENT invoices cancellable; logs reason to access_log
         role: Admin+

### Financial Reports & Alerts Routes

GET    /api/finance/dashboard
         returns: company-wide financial summary — total budget across projects, total expenses, total invoiced, total paid, total outstanding
         role: Admin+

GET    /api/finance/report/project/:projectId
         returns: P&L for project — budget, consumption breakdown (expenses + time cost), invoiced, paid, profit/loss
         role: Admin+

GET    /api/finance/alerts
         returns: all unacknowledged budget_alerts
         role: Admin+

PATCH  /api/finance/alert/:alertId/acknowledge
         rule: acknowledged_by = current admin, acknowledged_at = now
         role: Admin+

---

## 🖥️ Frontend Views (5 HTML Views)

### View 1: Financial Dashboard (finance-dashboard.html)
- Company-wide summary cards at top:
  Total Budget | Total Consumed | Total Remaining | Total Invoiced | Total Paid | Total Outstanding
- Project-wise budget table:
  Project name | Budget | Consumed | Remaining | Consumed % | Status (color-coded progress bar)
  Green = less than 70% consumed, Yellow = 70-99%, Red = 100%+
- Recent alerts section (top 5 unacknowledged)
- Recent invoices section (top 5 by created_at)
- P&L summary chart: bar chart per project (income vs cost)
- Admin only view

### View 2: Project Budget & Expenses (project-budget.html)
- Budget summary: total budget, consumed, remaining, consumed % progress bar
- Budget type badge: FIXED | TIME_AND_MATERIAL | RETAINER
- "Edit Budget" button (Admin only) → form with mandatory reason field
- Budget history accordion (expand to see all past changes with reasons)
- Expense list with filters (status, category, date range, member)
- Each expense row: title, category, amount, submitted by, date, status badge
- "Approve" / "Reject" buttons per PENDING expense (Admin only)
- "Submit Expense" button (all members) → modal form
- Time cost breakdown: billable hours logged x rate = time cost (read-only, calculated)
- Admin only view (members see own expense tab only)

### View 3: My Expenses (my-expenses.html)
- "Submit New Expense" button → modal form:
  Project selector, category selector, title, description, amount, date, receipt upload, billable toggle
- List of own submitted expenses:
  Title | Project | Amount | Category | Status badge | Date
- Click expense → detail view (read-only if APPROVED/REJECTED; editable if PENDING)
- Status timeline: PENDING → APPROVED or REJECTED
- Rejection reason shown if REJECTED
- Available to all members (own data only)

### View 4: Invoice Manager (invoice-manager.html)
- Invoice list table: invoice number | project | client | total | status badge | issue date | due date | actions
- Status colors: grey=DRAFT, blue=SENT, purple=VIEWED, green=PAID, red=OVERDUE, black=CANCELLED
- "Create Invoice" button → multi-step form:
  Step 1: project, client, dates, tax %, notes, internal_notes
  Step 2: add line items (description, type, qty, unit price) — amount auto-calculated server-side
  Step 3: review totals and confirm
- Invoice detail view:
  Line items table with subtotal, tax, total
  "Send to Client" button (DRAFT only)
  "Mark as Paid" button (SENT/VIEWED only) → payment reference input
  "Cancel" button (DRAFT/SENT only)
  internal_notes visible to Admin only (never shown to client)
- Admin only view

### View 5: Budget Alerts & Reports (budget-alerts.html)
- Alerts list: all unacknowledged budget alerts
  Project name | alert type | triggered % | message | time triggered
  "Acknowledge" button per alert
- Acknowledged alerts section (collapsible history)
- P&L Report per project:
  Select project → shows full breakdown:
  Budget | Approved Expenses | Time Cost | Total Cost | Invoiced | Paid | Profit/Loss
  Cost breakdown pie chart: by expense category
  Income vs Cost bar chart
- "Export Report" button → downloads JSON/CSV
- Admin only view

---

## ⚙️ Business Rules (Non-Negotiable)

1. One budget per project — service rejects second budget creation for same project
2. Budget edit always requires reason (min 10 chars) — service rejects if missing
3. Budget consumption = APPROVED expenses only + APPROVED billable time entries — PENDING expenses never counted
4. Alert auto-triggered server-side on every expense approval and time entry approval
5. Alert triggered at alert_threshold_pct AND at 100% (two separate alerts)
6. Invoice number auto-generated server-side — client never sends invoice number
7. Line item amount = quantity x unit_price — server-side only, client-sent amount ignored
8. Invoice totals (subtotal, tax_amount, total_amount) calculated server-side on every line item add
9. Line items cannot be added or modified after invoice status is SENT — service blocks
10. internal_notes on invoices NEVER returned to any client-facing endpoint
11. Invoice OVERDUE status auto-set by cron job checking due_date daily
12. P&L = Total Paid Invoice Amount - (Total APPROVED Expenses + Total Billable Time Cost)
13. All financial data NEVER accessible to Member role except own expenses
14. Expense approval always logged in access_log with approver identity
15. Receipt file upload path stored in DB — actual file stored in server uploads/ folder
16. updated_at manually updated in service on every PATCH
17. Server-side RBAC — all role checks in financeService.js, never trust client-side role
18. All financial exports logged to analytics_report_exports table (audit trail)
19. Budget changes, invoice payments, expense approvals all logged to access_log
20. Currency stored with every financial record — no implicit currency assumption

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations + Seed
- Create 8 tables
- Create 7 triggers
- Seed default expense categories (8 categories)
- Verify all triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: Budget Service + API
- financeService.js (budget CRUD + history)
- Budget consumption calculation engine
- Alert generation on threshold breach
- Real HTTP tests including alert trigger
- Must pass before Layer 3 begins

### Layer 3: Expense Service + API
- Expense submit, approve, reject, edit
- Expense category CRUD
- Expense history logging
- Budget recalculation on expense approval
- Real HTTP tests
- Must pass before Layer 4 begins

### Layer 4: Invoice Service + API
- Invoice CRUD (create, add line items, send, mark paid, cancel)
- Invoice number auto-generation (MTG-INV-YYYY-NNNN)
- Server-side total calculation
- Overdue status cron job (daily check)
- Client notification on invoice send
- Real HTTP tests
- Must pass before Layer 5 begins

### Layer 5: Financial Report + Alert API
- Financial dashboard endpoint
- Project P&L report endpoint
- Alert acknowledge
- Export endpoint (logs to analytics_report_exports)
- Real HTTP tests
- Must pass before Layer 6 begins

### Layer 6: Frontend (5 Views)
- Financial Dashboard
- Project Budget & Expenses
- My Expenses
- Invoice Manager
- Budget Alerts & Reports
- All views functional before Layer 7

### Layer 7: Integration + Full Test Suite
- End-to-end: create budget → submit expenses → approve expense → verify budget consumption updates → trigger threshold alert → acknowledge → create invoice → add line items → verify server-side totals → send invoice → mark paid → verify P&L → export report → verify audit log
- Budget edit without reason blocked (real HTTP test)
- Invoice line item add after SENT blocked (real HTTP test)
- Member cannot see financial dashboard (RBAC real test)
- OVERDUE cron test (real date scenario)
- internal_notes stripped from client invoice response (real HTTP test)
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 26 begins

---

## 📊 Test Scripts

scripts/verify-prd25-layer1.js        (DB + triggers + seed)
scripts/verify-prd25-layer2.js        (Budget Service + API)
scripts/verify-prd25-layer3.js        (Expense Service + API)
scripts/verify-prd25-layer4.js        (Invoice Service + API)
scripts/verify-prd25-layer5.js        (Financial Reports + Alerts)
scripts/verify-prd25-layer6.js        (Frontend smoke)
scripts/verify-prd25-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [ ] 8 tables created and verified
- [ ] 7 triggers tested (append-only confirmed with real DB calls)
- [ ] 8 expense categories seeded correctly
- [ ] 24 API endpoints working with real HTTP calls
- [ ] Budget consumption calculation verified with real expense + time data
- [ ] Threshold alert auto-generated (real test at 80% and 100%)
- [ ] Invoice number auto-generated correctly (MTG-INV-YYYY-NNNN format)
- [ ] Invoice totals calculated server-side (real test — client-sent amount ignored)
- [ ] Line item add blocked after SENT status (real HTTP test)
- [ ] OVERDUE cron job tested (real date scenario)
- [ ] P&L calculation verified end-to-end
- [ ] Budget edit without reason blocked (real HTTP test)
- [ ] internal_notes stripped from client invoice response (real HTTP test)
- [ ] Member financial data access blocked (RBAC real test)
- [ ] Export audit logged to analytics_report_exports (real test)
- [ ] 5 frontend views functional
- [ ] All existing 469 tests still passing
- [ ] Reverse Engineering Report submitted and confirmed
- [ ] Honest Status Report submitted
- [ ] Admin GO-AHEAD received
- [ ] Committed to GitHub with message: feat(finance): PRD 25 complete

---

*PRD 25 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*