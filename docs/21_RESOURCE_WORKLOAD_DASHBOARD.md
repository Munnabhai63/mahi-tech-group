# PRD 21 — Resource Workload Dashboard
**File:** docs/21_RESOURCE_WORKLOAD_DASHBOARD.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 15 (Pipeline), PRD 18 (Sprint Planning), PRD 19 (OKR), PRD 20 (Gantt)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Monday.com (Workload view — capacity per person, color-coded overload)
- Wrike (Resource management — capacity planning, workload heatmap)
- Asana (Workload view — tasks per person per week, capacity limit setting)
- ClickUp (Workload view — points/hours per member per sprint)
- Teamwork (Resource scheduling, availability, utilization %)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's workload/resource flow — how tasks are assigned to members, how capacity is calculated, how overload is detected and shown
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (Member → Assigned Tasks → Capacity → Utilization %)
4. Map every business rule (e.g., if member has 40hrs/week capacity and assigned tasks total 50hrs → overloaded; color changes red)
5. Identify what we will NOT copy (visual design, branding, color scheme, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group a complete Resource Workload Dashboard so Admin can see how much work each team member is carrying at any given time, identify overloaded or underloaded members, plan capacity before assigning new work, and balance the team's workload intelligently — built our own way.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Set member capacity (hrs/week) | ✅ | ✅ | ❌ |
| View full team workload dashboard | ✅ | ✅ | ❌ |
| View own workload only | ✅ | ✅ | ✅ |
| Set member availability (leave/off days) | ✅ | ✅ | ❌ |
| Mark own availability | ✅ | ✅ | ✅ |
| View workload heatmap | ✅ | ✅ | ❌ |
| Reassign task from overloaded member | ✅ | ✅ | ❌ |
| Export workload report | ✅ | ✅ | ❌ |

---

## 🗄️ Database Tables (New — 5 Tables)

### Table 1: member_capacity

CREATE TABLE member_capacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  weekly_capacity_hrs REAL NOT NULL DEFAULT 40.0,
  -- total available hours per week for this member
  effective_from TEXT NOT NULL,
  -- date from which this capacity setting applies
  effective_to TEXT,
  -- NULL = current/active setting
  set_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- To change capacity: insert new row with new effective_from
-- Latest row where effective_to IS NULL = current capacity

### Table 2: member_availability

CREATE TABLE member_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  -- specific date of unavailability
  availability_type TEXT NOT NULL DEFAULT 'LEAVE',
  -- LEAVE | HOLIDAY | PARTIAL | TRAINING
  available_hrs REAL DEFAULT 0.0,
  -- 0 = fully unavailable; partial day = hours available
  reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

### Table 3: workload_assignments

CREATE TABLE workload_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT NOT NULL DEFAULT 'BACKLOG_ITEM',
  -- BACKLOG_ITEM | GANTT_ITEM | PIPELINE_POINT | MANUAL
  source_id INTEGER,
  -- references the actual item id in source table
  title TEXT NOT NULL,
  estimated_hrs REAL NOT NULL DEFAULT 0.0,
  -- estimated hours to complete this assignment
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  -- ACTIVE | COMPLETED | CANCELLED
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- This table aggregates assignments from all sources into one place
-- Service syncs from backlog_items/gantt_items when assigned_to changes

### Table 4: workload_snapshots

CREATE TABLE workload_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  snapshot_date TEXT NOT NULL,
  -- date this snapshot was taken
  snapshot_data TEXT NOT NULL,
  -- JSON: { user_id, name, capacity_hrs, assigned_hrs, utilization_pct, status }[]
  taken_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- Admin can take manual snapshots for reporting/comparison

### Table 5: workload_alerts

CREATE TABLE workload_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  alert_type TEXT NOT NULL,
  -- OVERLOADED | UNDERLOADED | CAPACITY_BREACH | AVAILABILITY_CONFLICT
  week_start_date TEXT NOT NULL,
  assigned_hrs REAL NOT NULL,
  capacity_hrs REAL NOT NULL,
  utilization_pct REAL NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: only acknowledged_by and acknowledged_at are mutable (exception to append-only for ack fields)

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_capacity_update
BEFORE UPDATE ON member_capacity
BEGIN SELECT RAISE(ABORT, 'member_capacity is append-only'); END;

CREATE TRIGGER prevent_capacity_delete
BEFORE DELETE ON member_capacity
BEGIN SELECT RAISE(ABORT, 'member_capacity is append-only'); END;

CREATE TRIGGER prevent_workload_snapshot_update
BEFORE UPDATE ON workload_snapshots
BEGIN SELECT RAISE(ABORT, 'workload_snapshots is append-only'); END;

CREATE TRIGGER prevent_workload_snapshot_delete
BEFORE DELETE ON workload_snapshots
BEGIN SELECT RAISE(ABORT, 'workload_snapshots is append-only'); END;

CREATE TRIGGER prevent_workload_alert_delete
BEFORE DELETE ON workload_alerts
BEGIN SELECT RAISE(ABORT, 'workload_alerts is append-only'); END;

---

## 📊 Utilization Calculation Rules (Non-Negotiable)

1. Weekly available hours = weekly_capacity_hrs MINUS hours lost to member_availability entries in that week
2. Assigned hours for week = SUM(estimated_hrs) of all ACTIVE workload_assignments where date range overlaps with that week, prorated by overlap days
3. Utilization % = (assigned_hrs ÷ available_hrs) × 100
4. Status thresholds:
   - utilization < 50% → UNDERLOADED (blue)
   - utilization 50–85% → OPTIMAL (green)
   - utilization 86–100% → NEAR_CAPACITY (yellow)
   - utilization > 100% → OVERLOADED (red)
5. Alert auto-created when utilization > 100% (OVERLOADED) or < 30% (UNDERLOADED) for any member in any week
6. All calculation happens server-side in workloadService.js — client never sends utilization values
7. Proration formula: if assignment spans 10 days and overlaps 3 days with target week → contributes (3/10) × estimated_hrs to that week

---

## 🔌 API Routes (16 Endpoints)

### Capacity Routes

POST   /api/workload/capacity/set
         body: { user_id, weekly_capacity_hrs, effective_from }
         rule: inserts new row (append-only); previous row not touched
         role: Admin+

GET    /api/workload/capacity/:userId
         returns: current capacity + history of all capacity settings
         role: Admin+ or own

### Availability Routes

POST   /api/workload/availability/set
         body: { user_id, date, availability_type, available_hrs, reason }
         role: Admin+ or own (own dates only, future dates only)

GET    /api/workload/availability/:userId
         returns: all availability entries for member
         role: Admin+ or own

PATCH  /api/workload/availability/:availabilityId/approve
         rule: approved_by = current admin, logged in access_log
         role: Admin+

### Workload Assignment Routes

POST   /api/workload/assignment/create
         body: { user_id, project_id, source_type, source_id, title, estimated_hrs, start_date, end_date }
         role: Admin+

GET    /api/workload/assignments/:userId
         returns: all ACTIVE assignments for member (with date ranges, hours)
         role: Admin+ or own

PATCH  /api/workload/assignment/:assignmentId
         body: { estimated_hrs, start_date, end_date, status }
         role: Admin+

### Dashboard & Analytics Routes

GET    /api/workload/dashboard
         returns: all members with current week utilization, status, assigned hrs, capacity hrs
         role: Admin+

GET    /api/workload/dashboard/member/:userId
         returns: own workload — current week + next 4 weeks breakdown
         role: Admin+ or own

GET    /api/workload/heatmap/:projectId
         returns: member × week grid with utilization % for each cell (next 8 weeks)
         role: Admin+

GET    /api/workload/alerts
         returns: all unacknowledged workload alerts
         role: Admin+

PATCH  /api/workload/alert/:alertId/acknowledge
         rule: acknowledged_by = current admin, acknowledged_at = now
         role: Admin+

### Snapshot & Export Routes

POST   /api/workload/snapshot
         body: { project_id }
         rule: takes snapshot of current workload state for all members
         role: Admin+

GET    /api/workload/snapshots/:projectId
         returns: all snapshots for project
         role: Admin+

GET    /api/workload/export/:projectId
         returns: JSON workload data for current week + next 4 weeks (for frontend export)
         role: Admin+

---

## 🖥️ Frontend Views (4 HTML Views)

### View 1: Team Workload Dashboard (workload-dashboard.html)
- One row per team member
- Columns: Member Name | This Week Assigned Hrs | Capacity Hrs | Utilization % | Status Badge | Actions
- Status Badge color: blue=UNDERLOADED, green=OPTIMAL, yellow=NEAR_CAPACITY, red=OVERLOADED
- "Reassign" button on OVERLOADED rows (Admin only) → opens reassign modal
- Week selector (prev/next week navigation)
- Summary stats at top: total members, overloaded count, optimal count, underloaded count
- Admin only view

### View 2: Workload Heatmap (workload-heatmap.html)
- Grid: rows = team members, columns = weeks (next 8 weeks)
- Each cell = utilization % with color coding
- Hover on cell → tooltip showing assigned tasks for that member that week
- Click cell → drill into member week detail
- Admin only view

### View 3: My Workload (my-workload.html)
- Member's own view
- This week: list of all assigned tasks with estimated hours
- Progress bar: my assigned hrs vs my capacity this week
- Next 4 weeks: week-by-week bar chart of upcoming load
- "Mark Availability" button → date picker to mark leave/partial day
- Available to all members (own data only)

### View 4: Capacity Planning (capacity-planning.html)
- Set capacity per member (Admin only)
- Table: member name | current capacity (hrs/week) | effective from | set by
- "Update Capacity" button per row → opens form
- Availability calendar per member: leave days shown as blocked dates
- Alert history: list of past OVERLOADED/UNDERLOADED alerts per member
- Admin only view

---

## ⚙️ Business Rules (Non-Negotiable)

1. Capacity is append-only — to change capacity, always insert new row with new effective_from
2. Utilization always calculated server-side — client never sends utilization values
3. Proration of estimated_hrs mandatory when assignment spans multiple weeks
4. Alert auto-generated server-side when utilization > 100% or < 30% — checked on every assignment create/update
5. Member can only mark own availability for future dates — past dates blocked at service level
6. Admin can mark availability for any member for any date
7. Availability approval required if availability_type = LEAVE (Admin must approve)
8. workload_assignments synced automatically when backlog_items or gantt_items assigned_to changes (service hook)
9. Snapshot data stored as JSON — never recalculated from snapshot (point-in-time freeze)
10. Performance data NEVER returned to Member-role API responses
11. Member sees ONLY own workload — team dashboard completely hidden from member role
12. updated_at manually updated in service on every PATCH
13. Server-side RBAC — all role checks in service layer, never trust client-side role
14. No hardcoded capacity defaults in frontend — always fetch from API

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations
- Create 5 tables
- Create 5 triggers
- Verify all triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: Capacity + Availability Service + API
- workloadService.js (capacity CRUD, availability CRUD, approval)
- Routes + controller
- Append-only capacity confirmed via real test
- Real HTTP tests
- Must pass before Layer 3 begins

### Layer 3: Assignment Service + Utilization Calculation
- Assignment CRUD in workloadService.js
- Utilization calculation engine (proration + weekly breakdown)
- Alert auto-generation on overload/underload
- Sync hooks from backlog_items and gantt_items
- Real HTTP tests with real utilization scenarios
- Must pass before Layer 4 begins

### Layer 4: Dashboard + Heatmap + Snapshot API
- Team dashboard endpoint
- Heatmap data endpoint (8-week grid)
- Snapshot creation
- Alert acknowledge
- Export endpoint
- Real HTTP tests
- Must pass before Layer 5 begins

### Layer 5: Frontend (4 Views)
- Team Workload Dashboard
- Workload Heatmap
- My Workload (member view)
- Capacity Planning
- All views functional before Layer 6

### Layer 6: Integration + Full Test Suite
- End-to-end: set capacity → assign tasks → check utilization → trigger overload alert → acknowledge → take snapshot → verify heatmap data
- Proration test with real multi-week assignment
- Sync hook test: assign backlog item → verify workload_assignments auto-created
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 22 begins

---

## 📊 Test Scripts

scripts/verify-prd21-layer1.js        (DB + triggers)
scripts/verify-prd21-layer2.js        (Capacity + Availability API)
scripts/verify-prd21-layer3.js        (Assignment + Utilization Calculation)
scripts/verify-prd21-layer4.js        (Dashboard + Heatmap + Snapshot)
scripts/verify-prd21-layer5.js        (Frontend smoke)
scripts/verify-prd21-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [ ] 5 tables created and verified
- [ ] 5 triggers tested (append-only confirmed with real DB calls)
- [ ] 16 API endpoints working with real HTTP calls
- [ ] Utilization calculation verified with real proration test
- [ ] Overload alert auto-generated (real test)
- [ ] Underload alert auto-generated (real test)
- [ ] Sync hook verified: backlog item assign → workload_assignments auto-created
- [ ] Snapshot frozen correctly (JSON point-in-time)
- [ ] 4 frontend views functional
- [ ] Heatmap renders correctly with color coding
- [ ] Member sees own workload only (RBAC real test)
- [ ] All existing 469 tests still passing
- [ ] Reverse Engineering Report submitted and confirmed
- [ ] Honest Status Report submitted
- [ ] Admin GO-AHEAD received
- [ ] Committed to GitHub with message: feat(workload): PRD 21 complete

---

*PRD 21 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*