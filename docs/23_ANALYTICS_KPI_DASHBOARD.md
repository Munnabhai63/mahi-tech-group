# PRD 23 — Analytics & KPI Dashboard
**File:** docs/23_ANALYTICS_KPI_DASHBOARD.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 15 (Pipeline), PRD 16 (Point Pool), PRD 18 (Sprint Planning), PRD 19 (OKR), PRD 20 (Gantt), PRD 21 (Resource Workload), PRD 22 (Time Tracking)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Monday.com (Dashboard widgets — chart widget, number widget, battery widget, custom KPIs)
- ClickUp (Dashboards — custom widgets, goal progress, sprint velocity, time tracked)
- Jira (Insights — issue statistics, sprint burndown, velocity, cumulative flow diagram)
- Notion (Database views — gallery, table, chart, linked databases as widgets)
- Google Looker Studio (Custom KPI cards, blended data sources, drill-down charts)
- Datadog / Mixpanel (for internal analytics UX patterns — funnel, retention, cohort)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's analytics/dashboard flow — how widgets are created, how data sources are connected, how KPIs are defined and tracked, how drill-down works
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (KPI Definition → Data Source → Calculation → Widget → Dashboard)
4. Map every business rule (e.g., KPI threshold triggers alert, widget auto-refreshes every X minutes, dashboard is role-scoped)
5. Identify what we will NOT copy (visual design, branding, color scheme, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group a powerful Analytics and KPI Dashboard where Admin can define custom KPIs, track them in real time from all platform data sources (sprints, OKRs, time tracking, workload, pipeline, revenue), build custom dashboards with drag-drop widgets, set thresholds and alerts, and export reports — built our own way without copying any competitor.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Create KPI Definition | ✅ | ✅ | ❌ |
| Edit KPI Definition | ✅ | ✅ | ❌ |
| Delete KPI Definition | ✅ | ✅ | ❌ |
| Create Dashboard | ✅ | ✅ | ✅ (own only) |
| Edit own Dashboard | ✅ | ✅ | ✅ |
| Delete own Dashboard | ✅ | ✅ | ✅ |
| Add Widget to Dashboard | ✅ | ✅ | ✅ (own dashboard) |
| View company-wide Dashboard | ✅ | ✅ | ❌ |
| View team Dashboard | ✅ | ✅ | ✅ |
| View own Dashboard | ✅ | ✅ | ✅ |
| Set KPI Alert Thresholds | ✅ | ✅ | ❌ |
| Export Analytics Report | ✅ | ✅ | ❌ |
| View raw analytics data | ✅ | ✅ | ❌ |

---

## 🗄️ Database Tables (New — 6 Tables)

### Table 1: kpi_definitions

CREATE TABLE kpi_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  data_source TEXT NOT NULL,
  -- SPRINT | OKR | TIME_TRACKING | WORKLOAD | PIPELINE | REVENUE | GITHUB | CUSTOM
  metric_type TEXT NOT NULL,
  -- COUNT | SUM | AVERAGE | PERCENTAGE | RATIO
  calculation_query TEXT NOT NULL,
  -- SQL-like query definition stored as JSON describing the aggregation
  -- e.g. { table: 'time_entries', field: 'duration_minutes', filter: { is_billable: 1 }, agg: 'SUM' }
  unit TEXT,
  -- 'hrs', '%', 'count', '₹', 'pts', etc.
  target_value REAL,
  -- optional: what the KPI should ideally be
  alert_threshold_low REAL,
  -- alert if value drops below this
  alert_threshold_high REAL,
  -- alert if value exceeds this
  refresh_interval_minutes INTEGER DEFAULT 60,
  -- how often this KPI is recalculated (minimum 15 minutes)
  is_active INTEGER DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 2: kpi_snapshots

CREATE TABLE kpi_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_id INTEGER NOT NULL REFERENCES kpi_definitions(id),
  value REAL NOT NULL,
  -- calculated value at snapshot time
  period_label TEXT,
  -- e.g. 'Week 12', 'Q1-2025', '2025-03-15'
  snapshotted_at TEXT DEFAULT (datetime('now')),
  calculation_metadata TEXT
  -- JSON: details of how value was calculated (for audit/debug)
);
-- Append-only: DB trigger prevents update/delete
-- One row inserted per refresh_interval for each active KPI

### Table 3: analytics_dashboards

CREATE TABLE analytics_dashboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL DEFAULT 'PERSONAL',
  -- PERSONAL | TEAM | COMPANY
  is_default INTEGER DEFAULT 0,
  -- 1 = shown as homepage dashboard for owner
  layout TEXT,
  -- JSON: widget positions and sizes on the grid
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 4: dashboard_widgets

CREATE TABLE dashboard_widgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER NOT NULL REFERENCES analytics_dashboards(id),
  kpi_id INTEGER REFERENCES kpi_definitions(id),
  -- NULL if widget is a static/custom type
  widget_type TEXT NOT NULL,
  -- NUMBER_CARD | BAR_CHART | LINE_CHART | PIE_CHART | PROGRESS_BAR | TABLE | HEATMAP | BURNDOWN | VELOCITY
  title TEXT NOT NULL,
  config TEXT,
  -- JSON: widget-specific config (colors, date range, filters, groupBy)
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  width INTEGER DEFAULT 2,
  height INTEGER DEFAULT 2,
  -- grid units (e.g. 12-column grid)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 5: kpi_alerts

CREATE TABLE kpi_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_id INTEGER NOT NULL REFERENCES kpi_definitions(id),
  alert_type TEXT NOT NULL,
  -- BELOW_THRESHOLD | ABOVE_THRESHOLD | TARGET_REACHED | NO_DATA
  triggered_value REAL NOT NULL,
  threshold_value REAL NOT NULL,
  message TEXT NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: only acknowledged_by and acknowledged_at mutable (exception for ack fields)

### Table 6: analytics_report_exports

CREATE TABLE analytics_report_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exported_by INTEGER NOT NULL REFERENCES users(id),
  report_type TEXT NOT NULL,
  -- KPI_SUMMARY | SPRINT_ANALYTICS | OKR_PROGRESS | TIME_SUMMARY | WORKLOAD_SUMMARY | CUSTOM
  filters TEXT,
  -- JSON: date range, project, members etc.
  export_format TEXT NOT NULL DEFAULT 'JSON',
  -- JSON | CSV
  row_count INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- Audit log of every export action

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_kpi_snapshot_update
BEFORE UPDATE ON kpi_snapshots
BEGIN SELECT RAISE(ABORT, 'kpi_snapshots is append-only'); END;

CREATE TRIGGER prevent_kpi_snapshot_delete
BEFORE DELETE ON kpi_snapshots
BEGIN SELECT RAISE(ABORT, 'kpi_snapshots is append-only'); END;

CREATE TRIGGER prevent_kpi_alert_delete
BEFORE DELETE ON kpi_alerts
BEGIN SELECT RAISE(ABORT, 'kpi_alerts is append-only'); END;

CREATE TRIGGER prevent_analytics_export_update
BEFORE UPDATE ON analytics_report_exports
BEGIN SELECT RAISE(ABORT, 'analytics_report_exports is append-only'); END;

CREATE TRIGGER prevent_analytics_export_delete
BEFORE DELETE ON analytics_report_exports
BEGIN SELECT RAISE(ABORT, 'analytics_report_exports is append-only'); END;

---

## 📊 Built-in KPI Definitions (Pre-seeded on first run)

These are seeded automatically — Admin can edit thresholds but not delete:

KPI 01: Sprint Velocity
  source: SPRINT | metric: AVERAGE | unit: pts
  = average completed story points per sprint (last 5 sprints)

KPI 02: Sprint Completion Rate
  source: SPRINT | metric: PERCENTAGE | unit: %
  = completed points ÷ committed points × 100 (current sprint)

KPI 03: OKR Progress (Company Level)
  source: OKR | metric: AVERAGE | unit: %
  = average progress_pct of all COMPANY level active objectives

KPI 04: Team Utilization
  source: WORKLOAD | metric: AVERAGE | unit: %
  = average utilization_pct across all active members this week

KPI 05: Billable Hours This Month
  source: TIME_TRACKING | metric: SUM | unit: hrs
  = SUM(duration_minutes) where is_billable=1 and APPROVED / 60

KPI 06: Pipeline Completion Rate
  source: PIPELINE | metric: PERCENTAGE | unit: %
  = approved checklist points ÷ total checklist points × 100

KPI 07: GitHub PR Merge Rate
  source: GITHUB | metric: PERCENTAGE | unit: %
  = merged PRs ÷ total PRs opened this month × 100

KPI 08: Revenue This Month
  source: REVENUE | metric: SUM | unit: ₹
  = SUM(payout amounts) for current month

KPI 09: Active Backlog Items
  source: SPRINT | metric: COUNT | unit: count
  = COUNT of backlog_items where sprint_id IS NULL and status != DONE

KPI 10: Overloaded Members
  source: WORKLOAD | metric: COUNT | unit: count
  = COUNT of members with utilization > 100% this week

---

## 🔌 API Routes (22 Endpoints)

### KPI Definition Routes

POST   /api/analytics/kpi/create
         body: { name, description, data_source, metric_type, calculation_query, unit, target_value, alert_threshold_low, alert_threshold_high, refresh_interval_minutes }
         role: Admin+

GET    /api/analytics/kpis
         returns: all active KPI definitions with latest snapshot value
         role: Admin+

GET    /api/analytics/kpi/:kpiId
         returns: KPI definition + last 30 snapshots (for trend chart)
         role: Admin+

PATCH  /api/analytics/kpi/:kpiId
         body: any editable field
         role: Admin+

DELETE /api/analytics/kpi/:kpiId
         rule: only non-seeded KPIs deletable; seeded KPIs can only be deactivated
         role: Admin+

POST   /api/analytics/kpi/:kpiId/refresh
         rule: forces immediate recalculation and snapshot insert
         role: Admin+

### Dashboard Routes

POST   /api/analytics/dashboard/create
         body: { name, description, scope, is_default }
         role: All

GET    /api/analytics/dashboards
         returns: all dashboards visible to current user (own + team + company by role)
         role: All

GET    /api/analytics/dashboard/:dashboardId
         returns: dashboard + all widgets with latest KPI values
         role: All (scoped by role)

PATCH  /api/analytics/dashboard/:dashboardId
         body: { name, description, layout }
         role: Owner or Admin+

DELETE /api/analytics/dashboard/:dashboardId
         rule: cannot delete COMPANY scope dashboard if it is the only one
         role: Owner or Admin+

### Widget Routes

POST   /api/analytics/widget/create
         body: { dashboard_id, kpi_id, widget_type, title, config, position_x, position_y, width, height }
         role: Dashboard owner or Admin+

PATCH  /api/analytics/widget/:widgetId
         body: { title, config, position_x, position_y, width, height }
         role: Dashboard owner or Admin+

DELETE /api/analytics/widget/:widgetId
         role: Dashboard owner or Admin+

### KPI Alert Routes

GET    /api/analytics/alerts
         returns: all unacknowledged KPI alerts
         role: Admin+

PATCH  /api/analytics/alert/:alertId/acknowledge
         rule: acknowledged_by = current admin, acknowledged_at = now
         role: Admin+

### Report & Export Routes

GET    /api/analytics/report/sprint/:projectId
         returns: sprint analytics — velocity trend, completion rates, burndown data
         role: Admin+

GET    /api/analytics/report/okr
         returns: OKR progress summary — company/team/individual breakdown
         role: Admin+

GET    /api/analytics/report/time
         query: ?from=&to=&project_id=&user_id=
         returns: time tracking summary — billable vs non-billable, per member
         role: Admin+

GET    /api/analytics/report/workload
         returns: workload summary — utilization per member, overloaded count, underloaded count
         role: Admin+

POST   /api/analytics/report/export
         body: { report_type, filters, export_format }
         rule: logs to analytics_report_exports; returns JSON/CSV data
         role: Admin+

GET    /api/analytics/summary/company
         returns: company-wide KPI summary card data (all 10 built-in KPIs latest values)
         role: Admin+

---

## 🖥️ Frontend Views (5 HTML Views)

### View 1: Company KPI Overview (kpi-overview.html)
- Grid of KPI cards (one per active KPI definition)
- Each card: KPI name, current value, unit, target value, trend arrow (up/down vs last period)
- Color coded: green = above target, yellow = near threshold, red = below threshold or above high threshold
- Click card → opens KPI detail drill-down (last 30 snapshots as line chart)
- "Refresh All" button (Admin only)
- Alert badge count at top-right
- Admin only view

### View 2: Custom Dashboard Builder (dashboard-builder.html)
- 12-column drag-drop grid
- Left sidebar: widget library (NUMBER_CARD, BAR_CHART, LINE_CHART, PIE_CHART, PROGRESS_BAR, TABLE, VELOCITY, BURNDOWN)
- Drag widget from sidebar → drop onto grid → configure widget modal opens
  - Select KPI, set title, set date range filter, set colors
- Resize widget by dragging corners
- Save layout button → saves position JSON to analytics_dashboards.layout
- Dashboard scope selector: PERSONAL | TEAM | COMPANY (Admin only for TEAM/COMPANY)
- Available to all roles (own dashboards)

### View 3: Sprint Analytics (sprint-analytics.html)
- Velocity chart: bar chart last 10 sprints (committed vs completed)
- Burndown chart: current sprint (remaining points per day)
- Completion rate gauge: current sprint % complete
- Backlog health: count of items by type (STORY/BUG/TASK/EPIC) and priority
- Sprint comparison table: sprint name | start | end | committed | completed | rate %
- Admin + Member view (member sees own project sprints)

### View 4: Team Performance Analytics (team-analytics.html)
- Member contribution table: member name | pipeline points | sprint points completed | time logged | OKR progress
- Utilization trend: line chart per member over last 8 weeks
- Time distribution: pie chart billable vs non-billable hours (team total)
- Top contributors this month: ranked list by contribution points
- Admin only view

### View 5: KPI Alert Center (kpi-alerts.html)
- List of all KPI alerts (unacknowledged + recent acknowledged)
- Each alert: KPI name | alert type | triggered value | threshold | time triggered
- "Acknowledge" button per unacknowledged alert
- Filter: ALL | UNACKNOWLEDGED | ACKNOWLEDGED
- Alert history chart: alerts per KPI over last 30 days (bar chart)
- Admin only view

---

## ⚙️ Business Rules (Non-Negotiable)

1. KPI refresh_interval_minutes minimum = 15 — service rejects lower values
2. All KPI values calculated server-side from live DB data — client never sends calculated values
3. Seeded KPIs (01–10) cannot be deleted — only deactivated (is_active = 0)
4. KPI snapshots are append-only — never edited or deleted
5. Alert auto-generated server-side on every KPI refresh if value crosses threshold
6. Dashboard COMPANY scope can only be created/edited by Admin+
7. Member can only see own PERSONAL dashboards + TEAM dashboards + company summary (no raw KPI data)
8. Raw analytics data (per-member performance breakdown) NEVER returned to Member role
9. Export always logged to analytics_report_exports (audit trail)
10. Widget config stored as JSON — never parse client-sent SQL or raw queries server-side (security: calculation_query is a structured JSON spec, not raw SQL)
11. All edits to KPI definitions auto-logged to access_log
12. updated_at manually updated in service on every PATCH
13. Server-side RBAC — all role checks in analyticsService.js, never trust client-side role
14. KPI refresh cron runs every 15 minutes — checks each KPI's refresh_interval and snapshots if due
15. AI may SUGGEST KPI definitions but never auto-create or auto-publish — Admin must explicitly confirm

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations + Seed
- Create 6 tables
- Create 5 triggers
- Seed 10 built-in KPI definitions
- Verify triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: KPI Engine (Calculation + Snapshot + Refresh + Alerts)
- analyticsService.js
- KPI calculation engine (reads from all source tables based on calculation_query JSON spec)
- Snapshot insert on refresh
- Alert generation on threshold breach
- Cron scheduler (15-min interval)
- Real HTTP tests including forced refresh and alert trigger
- Must pass before Layer 3 begins

### Layer 3: Dashboard + Widget Service + API
- Dashboard CRUD
- Widget CRUD
- Layout save/load
- Real HTTP tests
- Must pass before Layer 4 begins

### Layer 4: Report + Export + Alert Acknowledge API
- All report endpoints (sprint, OKR, time, workload)
- Export endpoint + audit log
- Alert acknowledge
- Company summary endpoint
- Real HTTP tests
- Must pass before Layer 5 begins

### Layer 5: Frontend (5 Views)
- Company KPI Overview
- Custom Dashboard Builder (drag-drop grid)
- Sprint Analytics
- Team Performance Analytics
- KPI Alert Center
- All views functional before Layer 6

### Layer 6: Integration + Full Test Suite
- End-to-end: create KPI → force refresh → verify snapshot → breach threshold → verify alert → acknowledge → build dashboard → add widget → verify widget shows correct value → export report → verify audit log
- Seeded KPI delete blocked test (real HTTP)
- Member cannot see team raw data (RBAC real test)
- Cron refresh test (real interval fire)
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 24 begins

---

## 📊 Test Scripts

scripts/verify-prd23-layer1.js        (DB + triggers + seed)
scripts/verify-prd23-layer2.js        (KPI Engine + Snapshots + Alerts)
scripts/verify-prd23-layer3.js        (Dashboard + Widget API)
scripts/verify-prd23-layer4.js        (Reports + Export + Alert Acknowledge)
scripts/verify-prd23-layer5.js        (Frontend smoke)
scripts/verify-prd23-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [ ] 6 tables created and verified
- [ ] 5 triggers tested (append-only confirmed with real DB calls)
- [ ] 10 built-in KPIs seeded correctly
- [ ] 22 API endpoints working with real HTTP calls
- [ ] KPI calculation engine verified for all 10 built-in KPIs with real data
- [ ] Snapshot append-only confirmed (real UPDATE/DELETE attempt blocked)
- [ ] Alert auto-generated on threshold breach (real test)
- [ ] Cron refresh tested (real interval fire)
- [ ] Dashboard drag-drop layout save/load working
- [ ] 5 frontend views functional
- [ ] Member RBAC enforced (raw data hidden, real role-switch test)
- [ ] Export audit logged (real test)
- [ ] Seeded KPI delete blocked (real HTTP test)
- [ ] All existing 469 tests still passing
- [ ] Reverse Engineering Report submitted and confirmed
- [ ] Honest Status Report submitted
- [ ] Admin GO-AHEAD received
- [ ] Committed to GitHub with message: feat(analytics): PRD 23 complete

---

*PRD 23 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*