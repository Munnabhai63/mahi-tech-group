# PRD 20 — Gantt Chart & Timeline View
**File:** docs/20_GANTT_CHART_TIMELINE.md
**Status:** COMPLETE & SEALED
**Depends On:** PRD 15 (Pipeline), PRD 18 (Sprint Planning), PRD 19 (OKR System)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Monday.com (Timeline view, drag-resize bars, dependencies, critical path)
- Asana (Timeline, task dependencies, milestones, portfolio timeline)
- ClickUp (Gantt chart, dependency arrows, baseline comparison)
- Jira (Roadmap view, epic timeline, sprint timeline)
- Smartsheet (Classic Gantt, predecessor dependencies, % complete bar)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's Gantt/Timeline flow — how tasks are placed on timeline, how dependencies are drawn, how drag-resize updates dates
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (Task → Start/End Date → Dependencies → Critical Path)
4. Map every business rule (e.g., if Task B depends on Task A, Task B start date cannot be before Task A end date)
5. Identify what we will NOT copy (visual design, branding, color scheme, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group a full Gantt Chart and Timeline view so the team can visually plan project tasks, set start/end dates, define task dependencies, track progress on a timeline, and identify bottlenecks — built our own way without copying any competitor.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Create Timeline Item | ✅ | ✅ | ❌ |
| Edit Timeline Item (dates, title) | ✅ | ✅ | ❌ |
| Delete Timeline Item | ✅ | ✅ | ❌ |
| Add Dependency between Items | ✅ | ✅ | ❌ |
| Remove Dependency | ✅ | ✅ | ❌ |
| Update Progress % on own item | ✅ | ✅ | ✅ (assigned only) |
| Add Milestone | ✅ | ✅ | ❌ |
| View Gantt Chart | ✅ | ✅ | ✅ |
| View Critical Path | ✅ | ✅ | ✅ |
| Export Gantt (PNG/PDF) | ✅ | ✅ | ✅ |

---

## 🗄️ Database Tables (New — 5 Tables)

### Table 1: gantt_items

CREATE TABLE gantt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  sprint_id INTEGER REFERENCES sprints(id),
  -- optional: link to sprint if item belongs to a sprint
  backlog_item_id INTEGER REFERENCES backlog_items(id),
  -- optional: link to backlog item if this gantt item represents one
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'TASK',
  -- TASK | MILESTONE | PHASE | EPIC
  assigned_to INTEGER REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  progress_pct REAL DEFAULT 0.0,
  -- 0.00 to 100.00, manually updated by assignee or Admin
  color TEXT DEFAULT '#4A90E2',
  -- custom color per item for visual grouping
  parent_item_id INTEGER REFERENCES gantt_items(id),
  -- NULL = top-level, non-NULL = sub-task under parent
  position INTEGER DEFAULT 0,
  -- vertical ordering in chart
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  -- NOT_STARTED | IN_PROGRESS | COMPLETED | BLOCKED | CANCELLED
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Rule: end_date must always be >= start_date (service-level enforce)
-- Rule: MILESTONE type must have start_date = end_date (single day)

### Table 2: gantt_dependencies

CREATE TABLE gantt_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  predecessor_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  successor_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  dependency_type TEXT NOT NULL DEFAULT 'FINISH_TO_START',
  -- FINISH_TO_START | START_TO_START | FINISH_TO_FINISH | START_TO_FINISH
  lag_days INTEGER DEFAULT 0,
  -- buffer days between predecessor end and successor start
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(predecessor_item_id, successor_item_id)
);
-- Append-only: DB trigger prevents update/delete
-- Rule: circular dependencies blocked at service level

### Table 3: gantt_milestones

CREATE TABLE gantt_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  gantt_item_id INTEGER REFERENCES gantt_items(id),
  -- optional: linked to a gantt_item of type MILESTONE
  title TEXT NOT NULL,
  milestone_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING | ACHIEVED | MISSED
  achieved_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 4: gantt_baselines

CREATE TABLE gantt_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  gantt_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  baseline_start_date TEXT NOT NULL,
  baseline_end_date TEXT NOT NULL,
  snapshot_taken_by INTEGER NOT NULL REFERENCES users(id),
  snapshot_taken_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- Baseline = snapshot of planned dates at a point in time
-- Used to compare planned vs actual on chart

### Table 5: gantt_history

CREATE TABLE gantt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gantt_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  -- 'start_date' | 'end_date' | 'progress_pct' | 'status' | 'assigned_to' | etc.
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_gantt_dependency_update
BEFORE UPDATE ON gantt_dependencies
BEGIN SELECT RAISE(ABORT, 'gantt_dependencies is append-only'); END;

CREATE TRIGGER prevent_gantt_dependency_delete
BEFORE DELETE ON gantt_dependencies
BEGIN SELECT RAISE(ABORT, 'gantt_dependencies is append-only'); END;

CREATE TRIGGER prevent_gantt_baseline_update
BEFORE UPDATE ON gantt_baselines
BEGIN SELECT RAISE(ABORT, 'gantt_baselines is append-only'); END;

CREATE TRIGGER prevent_gantt_baseline_delete
BEFORE DELETE ON gantt_baselines
BEGIN SELECT RAISE(ABORT, 'gantt_baselines is append-only'); END;

CREATE TRIGGER prevent_gantt_history_update
BEFORE UPDATE ON gantt_history
BEGIN SELECT RAISE(ABORT, 'gantt_history is append-only'); END;

CREATE TRIGGER prevent_gantt_history_delete
BEFORE DELETE ON gantt_history
BEGIN SELECT RAISE(ABORT, 'gantt_history is append-only'); END;

---

## 🔌 API Routes (17 Endpoints)

### Gantt Item Routes

POST   /api/gantt/item/create
         body: { project_id, title, type, start_date, end_date, assigned_to, color, parent_item_id, sprint_id, backlog_item_id }
         rule: end_date >= start_date enforced; MILESTONE start_date must equal end_date
         role: Admin+

GET    /api/gantt/project/:projectId
         returns: all gantt items for project (with dependencies, milestones, baselines)
         role: All

GET    /api/gantt/item/:itemId
         returns: item detail + dependencies + history
         role: All

PATCH  /api/gantt/item/:itemId
         body: any editable field (dates, title, progress_pct, status, color)
         rule: auto-logs to gantt_history; dependency violation check on date change
         role: Admin+ or assignee (progress_pct only for assignee)

PATCH  /api/gantt/item/:itemId/progress
         body: { progress_pct }
         rule: 0–100 only; auto-updates status if 100 → COMPLETED
         role: Assignee or Admin+

DELETE /api/gantt/item/:itemId
         rule: cannot delete if other items depend on this item
         role: Admin+

### Dependency Routes

POST   /api/gantt/dependency/add
         body: { project_id, predecessor_item_id, successor_item_id, dependency_type, lag_days }
         rule: circular dependency check before insert
         role: Admin+

GET    /api/gantt/dependencies/:projectId
         returns: all dependencies for project
         role: All

DELETE /api/gantt/dependency/:dependencyId
         rule: soft-remove only — insert a reversal record (keep audit trail)
         role: Admin+

### Milestone Routes

POST   /api/gantt/milestone/create
         body: { project_id, title, milestone_date, gantt_item_id }
         role: Admin+

PATCH  /api/gantt/milestone/:milestoneId/achieve
         rule: status → ACHIEVED, achieved_at = now
         role: Admin+

GET    /api/gantt/milestones/:projectId
         returns: all milestones for project
         role: All

### Baseline Routes

POST   /api/gantt/baseline/snapshot
         body: { project_id }
         rule: takes snapshot of ALL current gantt item dates for project
         role: Admin+

GET    /api/gantt/baselines/:projectId
         returns: all baseline snapshots for project (for planned vs actual view)
         role: All

### Critical Path & Export Routes

GET    /api/gantt/criticalpath/:projectId
         returns: list of gantt item IDs that form the critical path
         rule: calculated server-side using longest path algorithm (no external lib)
         role: All

GET    /api/gantt/history/:itemId
         returns: full change history for a gantt item
         role: Admin+

GET    /api/gantt/export/:projectId
         returns: JSON data formatted for frontend chart export (PNG/PDF via browser print)
         role: All

---

## 🖥️ Frontend Views (4 HTML Views)

### View 1: Gantt Chart Main View (gantt-chart.html)
- Horizontal timeline chart (X axis = dates, Y axis = task rows)
- Each item shown as colored bar spanning start to end date
- Bar width = duration, bar fill = progress_pct (darker fill inside bar)
- Dependency arrows drawn between bars (SVG lines)
- Milestone shown as diamond shape on date
- Today line shown as vertical red line
- Zoom controls: Day | Week | Month | Quarter
- Drag bar to change dates (Admin only)
- Resize bar ends to change start/end (Admin only)
- Click bar → opens item detail sidebar
- Critical path items highlighted in red outline

### View 2: Gantt Item Detail Sidebar (inline component in gantt-chart.html)
- Item title, type, status badge, assigned member
- Start date / End date inputs (Admin only)
- Progress % slider (assignee or Admin)
- Dependencies list (what this item depends on + what depends on this)
- Add dependency button (Admin only)
- History log (field changes)
- Link to backlog item / sprint (if connected)

### View 3: Milestone Timeline (milestone-timeline.html)
- Vertical list of all milestones for project
- Each milestone: date, title, status badge (PENDING/ACHIEVED/MISSED)
- Color coded: green = ACHIEVED, yellow = PENDING, red = MISSED
- "Mark as Achieved" button (Admin only)
- Sorted by milestone_date ascending

### View 4: Planned vs Actual View (gantt-baseline.html)
- Two bars per item: baseline (grey, planned) + current (colored, actual)
- Shows schedule slip visually (how far current dates have moved from baseline)
- Snapshot selector: pick which baseline to compare against
- Table below chart: item name | planned start | actual start | planned end | actual end | slip (days)

---

## ⚙️ Business Rules (Non-Negotiable)

1. end_date must always be >= start_date — service rejects invalid dates
2. MILESTONE type must have start_date = end_date (single point in time)
3. Circular dependency check mandatory before any dependency insert — service-level, not just UI
4. If Task B depends on Task A (FINISH_TO_START), and Task A end_date changes, service must warn about potential successor date conflict (warning only, not auto-update)
5. Progress 0–100 only — service rejects values outside range
6. progress_pct = 100 automatically sets status = COMPLETED
7. Critical path calculated server-side using longest path algorithm — no paid external library
8. Baseline snapshots are append-only — cannot be edited or deleted
9. Dependencies are append-only — deletion must insert a reversal/cancellation record
10. All field changes auto-logged to gantt_history
11. updated_at manually updated in service on every PATCH
12. Performance data NEVER returned to Member-role API responses
13. Server-side RBAC — all role checks in service layer, never trust client-side role
14. Export = JSON data sent to frontend, frontend renders PNG/PDF via browser — no server-side PDF generation required

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations
- Create 5 tables
- Create 6 triggers
- Verify all triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: Gantt Item Service + API (CRUD + Progress)
- ganttService.js
- Item routes + controller
- History logging on every change
- Real HTTP tests
- Must pass before Layer 3 begins

### Layer 3: Dependency + Circular Check Service + API
- Dependency CRUD in ganttService.js
- Circular dependency detection algorithm (real test with circular case)
- Real HTTP tests
- Must pass before Layer 4 begins

### Layer 4: Milestone + Baseline + Critical Path API
- Milestone CRUD
- Baseline snapshot
- Critical path calculation (longest path algorithm)
- Real HTTP tests
- Must pass before Layer 5 begins

### Layer 5: Frontend (4 Views)
- Gantt Chart Main (bars, arrows, today line, zoom)
- Item Detail Sidebar
- Milestone Timeline
- Planned vs Actual (baseline comparison)
- All views functional before Layer 6

### Layer 6: Integration + Full Test Suite
- End-to-end: create items → add dependencies → update progress → take baseline → change dates → compare planned vs actual → verify critical path
- Circular dependency blocked test (real HTTP)
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 21 begins

---

## 📊 Test Scripts

scripts/verify-prd20-layer1.js        (DB + triggers)
scripts/verify-prd20-layer2.js        (Gantt Item API)
scripts/verify-prd20-layer3.js        (Dependency + Circular Check)
scripts/verify-prd20-layer4.js        (Milestone + Baseline + Critical Path)
scripts/verify-prd20-layer5.js        (Frontend smoke)
scripts/verify-prd20-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [x] 5 tables created and verified
- [x] 6 triggers tested (append-only confirmed with real DB calls)
- [x] 17 API endpoints working with real HTTP calls
- [x] Circular dependency detection tested (real blocked attempt)
- [x] Critical path calculation verified with real data
- [x] Baseline snapshot and planned vs actual comparison working
- [x] 4 frontend views functional
- [x] Drag-resize bars working on Gantt chart
- [x] Dependency arrows rendering correctly (SVG)
- [x] RBAC enforced server-side (real role-switch test)
- [x] All existing 469 tests still passing
- [x] Reverse Engineering Report submitted and confirmed
- [x] Honest Status Report submitted
- [x] Admin GO-AHEAD received
- [x] Committed to GitHub with message: feat(gantt): PRD 20 complete

---

*PRD 20 — 100% COMPLETE AND PERMANENTLY SEALED (Commit ffb8a44).*