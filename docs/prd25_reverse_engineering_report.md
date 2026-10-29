# PRD 25 — Budget & Financial Management: Reverse Engineering Report

**Date:** 2026-10-29  
**Author:** Antigravity (Senior Full-Stack Orchestrator)  
**Target:** Mahi Tech Group Unified Platform  
**Reference Specification:** [docs/25_BUDGET_FINANCIAL_MANAGEMENT.md](file:///f:/UserData/Downloads/MAHI%20TECH%20GROUP/docs/25_BUDGET_FINANCIAL_MANAGEMENT.md)  
**Status:** COMPLETED & SUBMITTED FOR CONFIRMATION (Layer 1 code strictly paused pending approval)

---

## 1. Executive Summary

This report fulfills the mandatory **Reverse Engineering Mandate** established in `docs/25_BUDGET_FINANCIAL_MANAGEMENT.md` prior to authoring any Layer 1 database schemas, triggers, or services. Six industry-leading financial, budgeting, and project invoicing platforms were reverse-engineered and evaluated:

1. **Harvest** (Project budgets, fee vs hour tracking, budget burn rate, automated invoicing)
2. **Wrike** (Planned vs actual financial tracking, resource labor costing, project profitability)
3. **ClickUp** (Budget widgets, task-level cost tracking, rollup financial cards)
4. **Smartsheet** (Financial line-item variance tracking, category cost rollups, threshold workflows)
5. **QuickBooks / FreshBooks** (Project billing angle, invoice state machines, tax logic, overdue management)
6. **Jira + Tempo** (Timesheet-derived labor costs, role-based billable rate cards, budget burn tracking)

In accordance with the Reverse Engineering Mandate:
- **Zero competitor visual branding, styling, color palettes, UI layouts, or marketing copy will be copied.** The Mahi Tech Group dark glassmorphism aesthetic (`#0f172a`, `#1e293b`, `#38bdf8`, `#10b981`, `#f59e0b`, `#ef4444`) is strictly maintained.
- **Only underlying business flows, relational data structures, calculation formulas, state transitions, and security isolation rules have been abstracted.**
- All financial calculations are enforced **strictly server-side** with database-level append-only triggers in SQLite WAL mode.

---

## 2. Competitor Breakdown & Flow Analysis

### 2.1. Harvest (Project Budgets & Burn Rate)
- **Key Flows Studied:**
  - Setting project budgets by total fees or total hours, with fixed-fee vs time-and-materials vs monthly retainer modalities.
  - Automatic budget consumption calculated by multiplying tracked employee hours by user/task billable rates plus billable expenses.
  - Dynamic budget burn rate visualization showing consumed percentage, remaining funds, and projected overruns.
  - Automated threshold alerts (e.g. at 80% and 100% consumption).
  - One-click invoice generation aggregating unbilled project hours and expenses into draft invoices.
- **Components/Logic We Can Reverse-Engineer:**
  - Budget consumption formula: `Budget_Consumed = SUM(APPROVED_expenses) + SUM((duration_minutes / 60) * billable_rate)`.
  - State machine separation: only `APPROVED` expenses decrement remaining budget; unapproved or rejected expenses are excluded.
  - Multi-tier alert thresholds: early warning trigger (`alert_threshold_pct`, default 80%) and overrun trigger (`100%`).
- **What We Must NOT Copy:**
  - Harvest's bright orange branding, proprietary timesheet grid UI, third-party payment gateway redirects (Stripe/PayPal hosted modals), Harvest-specific invoice PDF templating engine.
- **Unique Insight (What We Do Better):**
  - Harvest allows project managers to silently modify project budgets without requiring an audit reason or maintaining an append-only revision ledger. In Mahi Tech Group, any budget modification requires a mandatory justification (`reason`, min 10 chars) and is permanently preserved in an append-only `budget_history` table backed by SQLite triggers blocking `UPDATE` and `DELETE`.

---

### 2.2. Wrike (Planned vs Actual & Profitability)
- **Key Flows Studied:**
  - Planned budget allocation vs actual cost tracking across project lifecycles.
  - Labor cost derivation based on individual resource billing rates and hourly costs.
  - Real-time variance calculation: `Variance = Planned_Budget - Actual_Cost`.
  - Project Profit & Loss (P&L) reporting: `Gross Revenue (Invoiced/Paid) - Actual Costs = Gross Profit Margin`.
  - Color-coded financial health indicators (Green: <70%, Amber: 70–99%, Red: ≥100%).
- **Components/Logic We Can Reverse-Engineer:**
  - Three-band financial health indicator thresholds (<70%, 70-99%, 100%+).
  - Explicit project-level P&L formula: `Project_P&L = Total_Paid_Invoices - (Total_Approved_Expenses + Total_Labor_Cost)`.
  - Read-only calculated time cost breakdown linked directly to underlying timesheet entries.
- **What We Must NOT Copy:**
  - Wrike's complex enterprise table spreadsheets, multi-level WBS cost-code hierarchies, custom formula builder syntax, proprietary Wrike blue/green styling.
- **Unique Insight (What We Do Better):**
  - Wrike calculates costs asynchronously through periodic batch re-computations or manual closeouts, leading to stale budget figures. Mahi Tech Group couples expense approvals and timer stops directly to atomic real-time budget re-calculation and instant alert evaluations.

---

### 2.3. ClickUp (Budget Widgets & Rollups)
- **Key Flows Studied:**
  - Executive financial dashboard summary cards: Total Budget, Total Spent, Remaining Budget, Overdue Invoices.
  - Task-level cost tracking rolling up into parent list/project summaries.
  - Budget visual battery indicators and category spend pie charts.
  - Line-item source tracking linking costs back to originating tasks or deliverables.
- **Components/Logic We Can Reverse-Engineer:**
  - Company-wide executive summary card rollup architecture:
    - `Total Budget` across active projects.
    - `Total Consumed` (Approved Expenses + Time Cost).
    - `Total Remaining` (`Total Budget - Total Consumed`).
    - `Total Invoiced`, `Total Paid`, and `Total Outstanding`.
  - Explicit line-item source tracking (`source_type: 'TIME_ENTRY' | 'EXPENSE' | 'MILESTONE' | NULL`, `source_id: INTEGER`).
- **What We Must NOT Copy:**
  - ClickUp's arbitrary client-side formula fields (which fail silently with `#VALUE!` or circular dependencies), deeply nested Workspace/Space/Folder/List hierarchy, cluttered widget customization menus.
- **Unique Insight (What We Do Better):**
  - ClickUp custom fields lack relational database integrity and can be edited or deleted by anyone with list permissions, with zero approval gates. Mahi Tech Group enforces strict database foreign keys (`REFERENCES projects(id)`, `REFERENCES clients(id)`) and rigorous RBAC where regular members can only submit their own expenses and cannot view company-wide financial dashboards or project budgets.

---

### 2.4. Smartsheet (Category Allocations & Variance Reporting)
- **Key Flows Studied:**
  - Structured expense categorization (Software, Hardware, Contractors, Travel, Marketing, etc.).
  - Cell-based financial variance reporting comparing initial baseline budgets against current actuals.
  - Automated conditional notification rules when variance becomes negative or exceeds variance thresholds.
  - Exportable financial audit logs for executive review.
- **Components/Logic We Can Reverse-Engineer:**
  - Pre-seeded, standardized expense categories (`SOFTWARE`, `HARDWARE`, `TRAVEL`, `MARKETING`, `CONTRACTOR`, `OFFICE`, `TRAINING`, `MISCELLANEOUS`) with active/inactive management.
  - Dual-tier alert triggers: `THRESHOLD_REACHED` and `BUDGET_EXCEEDED`, stored in an append-only `budget_alerts` table with explicit admin acknowledgment tracking (`acknowledged_by`, `acknowledged_at`).
  - Formal audit logging of every financial report export to `analytics_report_exports`.
- **What We Must NOT Copy:**
  - Smartsheet's spreadsheet grid UX, manual cell formula typing (`=SUMIFS(...)`), manual baseline cell-linking, lack of formal database schemas.
- **Unique Insight (What We Do Better):**
  - Smartsheet allows users to accidentally overwrite past rows and formulas without transactional integrity. Mahi Tech Group utilizes SQLite triggers to enforce true append-only tables for `budget_history`, `expense_history`, `invoice_line_items`, and `budget_alerts`, guaranteeing zero data tampering.

---

### 2.5. QuickBooks / FreshBooks (Project Billing Angle & Invoice Lifecycles)
- **Key Flows Studied:**
  - Formal sequential invoice state machine:
    `DRAFT` → `SENT` → `VIEWED` → `PAID` / `OVERDUE` / `CANCELLED`.
  - Sequential, human-readable invoice numbering sequences (e.g. `INV-2025-0001`).
  - Line-item arithmetic: `Amount = Quantity x Unit_Price`, `Subtotal = SUM(Amount)`, `Tax = Subtotal x (Tax_Pct / 100)`, `Total = Subtotal + Tax`.
  - Automatic overdue detection based on `due_date < current_date` for unpaid invoices.
  - Payment recording with payment reference, amount paid, and timestamp.
  - Clear segregation between client-visible invoice notes and internal accountant notes.
- **Components/Logic We Can Reverse-Engineer:**
  - The complete 6-stage Invoice State Machine (`DRAFT`, `SENT`, `VIEWED`, `PAID`, `OVERDUE`, `CANCELLED`).
  - Invoice immutability guard: once an invoice transitions to `SENT`, line items are strictly locked and cannot be added, edited, or deleted.
  - Server-side calculation of all financial fields: `quantity * unit_price`, `subtotal`, `tax_amount`, and `total_amount` are computed on the backend and never trusted from client payloads.
  - Auto-generated sequential invoice numbering: `MTG-INV-{YYYY}-{4-digit-sequence}`.
  - Daily automated check (cron job) updating `SENT`/`VIEWED` invoices to `OVERDUE` when `due_date < now`.
  - Strict confidentiality barrier: `internal_notes` are stored exclusively for internal admins and are stripped from any client-facing responses.
- **What We Must NOT Copy:**
  - Complex double-entry accounting overhead (General Ledger, Chart of Accounts, Bank Feed reconciliation, Tax Return schedules, GAAP depreciation schedules), FreshBooks green/white visual branding, proprietary payment merchant rails.
- **Unique Insight (What We Do Better):**
  - QuickBooks and FreshBooks treat projects as secondary tags on invoices, completely decoupled from project management, Gantt charts, and sprint deliverables. In Mahi Tech Group, invoices link directly to PRD 24 Clients (`client_id`) and PRD 20 Gantt Milestones/Deliverables, allowing clients to review deliverables, approve milestones, and view invoices within a single cohesive client portal.

---

### 2.6. Jira + Tempo (Timesheet-Derived Labor Costs)
- **Key Flows Studied:**
  - Aggregating individual developer time tracking logs into monetary project labor costs.
  - Applying role-based or user-specific billable rates to logged hours.
  - Distinguishing between billable hours (client-facing cost) and non-billable hours (internal overhead).
  - Tracking account-level budget burn based on hours logged.
- **Components/Logic We Can Reverse-Engineer:**
  - Direct integration with PRD 22 Time Tracking: querying approved billable `time_entries` and multiplying `(duration_minutes / 60) * billable_rate` to calculate real labor costs.
  - Read-only presentation of time costs on the project budget view, ensuring users cannot tamper with calculated figures.
- **What We Must NOT Copy:**
  - Tempo's complex multi-tier rate matrix (overtime multipliers, weekend rates, holiday pay tables), heavy Atlassian Jira plugin architecture, slow REST API batch synchronization.
- **Unique Insight (What We Do Better):**
  - Jira + Tempo store rates and timesheets across fragmented cloud services that frequently desynchronize. In Mahi Tech Group, `time_entries`, `billable_rates`, `project_budgets`, `project_expenses`, and `invoices` reside in the same transactional SQLite database, enabling instantaneous, atomic queries with zero API rate limits or network latency.

---

## 3. Screen & View Architecture Mapping

To satisfy the operational workflows without copying competitor layouts, PRD 25 specifies 5 focused views:

| View Name | Primary Purpose | Key Components | Role Access |
| :--- | :--- | :--- | :--- |
| **`finance-dashboard.html`** | Executive financial health overview | 6 company-wide KPI summary cards, project budget progress table (color-coded bands), recent alerts panel, recent invoices list, project P&L comparative bar chart. | Admin+ only |
| **`project-budget.html`** | Project-specific budget & expense hub | Budget summary header, budget type badge (`FIXED`, `TIME_AND_MATERIAL`, `RETAINER`), "Edit Budget" modal with mandatory reason, expandable budget history log, expense list with category/status filters, expense approval buttons, read-only time cost breakdown. | Admin+ (full view) |
| **`my-expenses.html`** | Member expense submission & tracking | "Submit New Expense" modal (project, category, amount, receipt upload, billable toggle), personal expense history table, status badges (`PENDING`, `APPROVED`, `REJECTED`), rejection reason modal. | All Members (own data only) |
| **`invoice-manager.html`** | Client billing & invoice lifecycle management | Invoice list table, multi-step invoice creation wizard (details → line items → preview), line item builder with server-side calculation, "Send to Client", "Mark as Paid", "Cancel" actions, internal notes admin panel. | Admin+ only |
| **`budget-alerts.html`** | Alert resolution & financial reporting | Active unacknowledged alerts table with "Acknowledge" button, acknowledged alerts history, project P&L deep-dive report, expense category spend pie chart, income vs cost chart, JSON/CSV report export button. | Admin+ only |

---

## 4. Data Flow & Entity-Relationship Architecture

```
                       [projects] (Core Project Hub)
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
[project_budgets]   [project_expenses]    [invoices] (Client Billing)
  (1:1 per project)   (Category-tagged)       │  (Linked to client_id)
       │                   │                   │
       ▼                   ▼                   ▼
[budget_history]    [expense_history]     [invoice_line_items]
 (Append-only)       (Append-only)         (Append-only, immutable once SENT)
       │                   │                   │
       └─────────┬─────────┴───────────────────┘
                 ▼
          [budget_alerts] (Threshold breached & Overdue triggers)
                 ▼
      [analytics_report_exports] & [access_log] (Full Audit Trail)
```

### Relational Invariants:
1. **One Budget Per Project**: Enforced by SQLite `UNIQUE(project_id)` constraint on `project_budgets` and service-level duplicate rejection (`409 Conflict`).
2. **Mandatory Budget Change Reason**: Any update to `project_budgets` requires a mandatory explanation (`reason` string with length $\ge 10$), immediately recorded in `budget_history`.
3. **Expense Approval Gate**: Only expenses with `status = 'APPROVED'` are included in budget consumption calculations. `PENDING` or `REJECTED` expenses never burn budget.
4. **Trigger-Enforced Immutability**:
   - `budget_history`: `UPDATE` and `DELETE` strictly aborted.
   - `expense_history`: `UPDATE` and `DELETE` strictly aborted.
   - `invoice_line_items`: `UPDATE` and `DELETE` strictly aborted.
   - `budget_alerts`: `DELETE` strictly aborted; `UPDATE` allowed only on `acknowledged_by` and `acknowledged_at`.
5. **Invoice Line Items Lock**: Once invoice status transitions to `SENT`, the service rejects any attempt to add or alter line items.
6. **Zero Client Leaks**: `internal_notes` on invoices are never serialized to client endpoints.

---

## 5. Synthesis: What PRD 25 Adopts, Avoids, and MTG Unique Value

### 5.1. What PRD 25 Adopts (Pure Logic & Flows)
- **Unified Budget Consumption Engine**:
  $$\text{Budget Consumption} = \sum \text{Approved Expenses} + \sum \left( \frac{\text{Duration (min)}}{60} \times \text{Billable Rate} \right)$$
- **Variance & P&L Derivation**:
  $$\text{Remaining Budget} = \text{Total Budget} - \text{Budget Consumption}$$
  $$\text{Budget Consumed \%} = \left( \frac{\text{Budget Consumption}}{\text{Total Budget}} \right) \times 100$$
  $$\text{Project P\&L} = \text{Total Paid Invoices} - \text{Budget Consumption}$$
- **Automated Dual-Tier Alert Triggers**: Server-side auto-generation of alerts when `Consumed % >= alert_threshold_pct` (default 80%) and `Consumed % >= 100%` (`BUDGET_EXCEEDED`).
- **Sequential Invoice Lifecycle**: Explicit state progression (`DRAFT` → `SENT` → `VIEWED` → `PAID` / `OVERDUE` / `CANCELLED`) with auto-generated format `MTG-INV-YYYY-NNNN`.
- **Scheduled Overdue Transition**: Background cron job scanning invoices daily to auto-transition expired `SENT`/`VIEWED` invoices to `OVERDUE`.

### 5.2. What PRD 25 Strictly Avoids
- **No Competitor Brand Copy, Colors, or Icons**: Zero orange (Harvest), green (FreshBooks), or blue (Wrike). Clean Mahi Tech Group dark glassmorphism styling only.
- **No Client-Side Financial Calculation Trust**: Total amounts, tax amounts, line item amounts, and consumption metrics are strictly computed on the backend; client-supplied calculated amounts are ignored.
- **No Silent Financial Edits**: No silent budget inflation, no unlogged expense modifications, and no untracked status overrides.
- **No Bloated General Ledger Complexity**: Avoids unnecessary double-entry accounting schemes (no depreciation schedules, no chart-of-accounts balance sheets) focusing entirely on high-velocity project budgeting, expense governance, and client invoicing.

### 5.3. Genuinely Unique to Mahi Tech Group
1. **Full-Stack SQLite Append-Only Security**: Triggers at the database level physically prevent tampering with historical budget changes, expense histories, and invoice line items.
2. **Deep Cross-Subsystem Integration**:
   - Integrates natively with **PRD 22** (`time_entries` and `billable_rates`) for instantaneous, real-time labor cost tracking without API polling.
   - Integrates with **PRD 24** (`clients` and Client Portal) to allow seamless client invoice delivery while maintaining a zero-trust confidentiality barrier on `internal_notes`.
   - Integrates with **PRD 20** (`gantt_milestones`) allowing invoices to bill against achieved milestones directly.
3. **Audited Financial Governance**: Every financial export is recorded in `analytics_report_exports`, and all administrative financial mutations (approvals, budget changes, invoice payments) are recorded in `access_log`.

---

## 6. Implementation Readiness Confirmation

This Reverse Engineering Report satisfies all conditions outlined in Section 1 and Section 2 of `docs/25_BUDGET_FINANCIAL_MANAGEMENT.md`.

- **Current Repository Status**: Pristine on branch `develop`. All 13 core test suites, PRD 23 integration tests, and PRD 24 integration tests pass at 100%.
- **Layer 1 Code**: **Not yet started.** Zero source files in `src/` have been modified.
- **Next Action**: Awaiting user review and explicit **GO-AHEAD** to initiate Layer 1 (Database Tables, Triggers, and Default Expense Categories Seed).
