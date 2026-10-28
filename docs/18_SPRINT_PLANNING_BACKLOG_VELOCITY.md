# PRD 18 — Sprint Planning, Backlog Management, Story Points & Velocity Tracking
**File:** docs/18_SPRINT_PLANNING_BACKLOG_VELOCITY.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 15 (Pipeline), PRD 16 (Point Pool), PRD 17 (GitHub)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report covering:

**Competitors to Reverse Engineer:**
- Jira (Sprint Board, Backlog Grooming, Story Points, Velocity Chart, Release Tracking)
- Linear (Cycle planning, keyboard-first UX, auto-progress from GitHub)
- ClickUp (Sprint widget, goals linked to tasks, custom fields)
- GitHub Projects (iteration fields, roadmap view)

**Report Must Include (per competitor):**
1. What UI screens exist (list every screen/view)
2. What data flows happen (user action → API → DB → response)
3. What business rules are enforced (e.g., sprint cannot start without owner, velocity = completed points ÷ sprint days)
4. What we will NOT copy (visual design, branding, exact wording)
5. What logic/flow we WILL reverse-engineer and re-implement our own way

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group the ability to plan work in time-boxed Sprints, manage a prioritized Backlog, assign Story Points to tasks, and track team Velocity over time — similar to Jira/Linear but built our own way.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Create Sprint | ✅ | ✅ | ❌ |
| Edit Sprint dates/name | ✅ | ✅ | ❌ |
| Delete Sprint (only if DRAFT) | ✅ | ✅ | ❌ |
| Start Sprint | ✅ | ✅ | ❌ |
| Complete Sprint | ✅ | ✅ | ❌ |
| Add item to Backlog | ✅ | ✅ | ✅ |
| Edit own Backlog item | ✅ | ✅ | ✅ |
| Assign Story Points | ✅ | ✅ | ✅ |
| Move item Sprint↔Backlog | ✅ | ✅ | ❌ |
| View Velocity Chart | ✅ | ✅ | ✅ |
| View all Sprints | ✅ | ✅ | ✅ |

---

## 🗄️ Database Tables (New — 5 Tables)

### Table 1: sprints

CREATE TABLE sprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  start_date TEXT,
  end_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- status values: DRAFT | ACTIVE | COMPLETED | CANCELLED
-- Rule: Only ONE sprint per project can be ACTIVE at a time (enforced in service)

### Table 2: backlog_items

CREATE TABLE backlog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  sprint_id INTEGER REFERENCES sprints(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'STORY',
  priority TEXT DEFAULT 'MEDIUM',
  story_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'TODO',
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- type values: STORY | BUG | TASK | EPIC
-- priority values: LOW | MEDIUM | HIGH | CRITICAL
-- status values: TODO | IN_PROGRESS | IN_REVIEW | DONE
-- sprint_id NULL = item is in backlog, not assigned to any sprint

### Table 3: sprint_velocity_log

CREATE TABLE sprint_velocity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprint_id INTEGER NOT NULL REFERENCES sprints(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  total_points_committed INTEGER DEFAULT 0,
  total_points_completed INTEGER DEFAULT 0,
  completion_rate REAL DEFAULT 0.0,
  logged_at TEXT DEFAULT (datetime('now'))
);
-- total_points_committed = story points at sprint START
-- total_points_completed = story points of DONE items at sprint END
-- completion_rate = completed ÷ committed × 100
-- Append-only: one row inserted when sprint status → COMPLETED
-- DB Trigger: prevent_velocity_log_update, prevent_velocity_log_delete

### Table 4: backlog_item_history

CREATE TABLE backlog_item_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES backlog_items(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);
-- field_changed values: 'status' | 'sprint_id' | 'story_points' | 'assigned_to' | etc.
-- Append-only: DB trigger prevents update/delete

### Table 5: sprint_members

CREATE TABLE sprint_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprint_id INTEGER NOT NULL REFERENCES sprints(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT DEFAULT (datetime('now')),
  UNIQUE(sprint_id, user_id)
);

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_velocity_log_update
BEFORE UPDATE ON sprint_velocity_log
BEGIN SELECT RAISE(ABORT, 'sprint_velocity_log is append-only'); END;

CREATE TRIGGER prevent_velocity_log_delete
BEFORE DELETE ON sprint_velocity_log
BEGIN SELECT RAISE(ABORT, 'sprint_velocity_log is append-only'); END;

CREATE TRIGGER prevent_item_history_update
BEFORE UPDATE ON backlog_item_history
BEGIN SELECT RAISE(ABORT, 'backlog_item_history is append-only'); END;

CREATE TRIGGER prevent_item_history_delete
BEFORE DELETE ON backlog_item_history
BEGIN SELECT RAISE(ABORT, 'backlog_item_history is append-only'); END;

---

## 🔌 API Routes (15 Endpoints)

### Sprint Routes

POST   /api/sprint/create
         body: { project_id, name, goal, start_date, end_date }
         role: Admin+

GET    /api/sprint/project/:projectId
         returns: all sprints for project (with item count, point totals)
         role: All

GET    /api/sprint/:sprintId
         returns: sprint detail + all items in sprint
         role: All

PATCH  /api/sprint/:sprintId/start
         rule: project must have no other ACTIVE sprint
         role: Admin+

PATCH  /api/sprint/:sprintId/complete
         rule: logs velocity automatically on completion
         role: Admin+

DELETE /api/sprint/:sprintId
         rule: only DRAFT sprints deletable
         role: Admin+

### Backlog Routes

POST   /api/backlog/item/create
         body: { project_id, title, description, type, priority, story_points, assigned_to }
         role: All

GET    /api/backlog/project/:projectId
         returns: all items where sprint_id IS NULL (pure backlog)
         role: All

PATCH  /api/backlog/item/:itemId
         body: any editable field
         rule: auto-logs to backlog_item_history
         role: Owner or Admin+

PATCH  /api/backlog/item/:itemId/move
         body: { sprint_id }
         rule: null = move back to backlog
         role: Admin+

PATCH  /api/backlog/item/:itemId/status
         body: { status }
         rule: auto-logs to backlog_item_history
         role: Assigned member or Admin+

PATCH  /api/backlog/item/:itemId/reorder
         body: { position }
         role: Admin+

DELETE /api/backlog/item/:itemId
         rule: only TODO items deletable, must not be in ACTIVE sprint
         role: Admin+

### Velocity Routes

GET    /api/sprint/velocity/:projectId
         returns: all velocity_log rows for project (for chart rendering)
         role: All

GET    /api/sprint/:sprintId/burndown
         returns: day-by-day remaining points for active sprint
         rule: calculated from item status change history (derived, not stored)
         role: All

---

## 🖥️ Frontend Views (4 HTML Views)

### View 1: Sprint Board (sprint-board.html)
- Active sprint ka Kanban view
- Columns: TODO | IN_PROGRESS | IN_REVIEW | DONE
- Each card shows: title, type badge, priority, story points, assignee
- Drag-drop between columns (status update via API)
- "Complete Sprint" button (Admin only, top-right)

### View 2: Backlog (backlog.html)
- List of all unassigned backlog items
- Filter by: type, priority, assignee
- Drag-drop to reorder (position update via API)
- "Move to Sprint" dropdown (Admin only, per item)
- "Add Item" button → inline form
- Story point input per item

### View 3: Sprint List (sprint-list.html)
- All sprints for a project (DRAFT/ACTIVE/COMPLETED/CANCELLED)
- Each sprint row: name, dates, committed points, completed points, %
- "Start Sprint" / "Create Sprint" buttons
- Click sprint → goes to Sprint Board

### View 4: Velocity Chart (velocity-chart.html)
- Bar chart: X = sprint name, Y = story points
- Two bars per sprint: Committed (grey) vs Completed (green)
- Average velocity line shown
- Table below chart: sprint-by-sprint breakdown
- Chart rendered via Chart.js — no external paid library

---

## ⚙️ Business Rules (Non-Negotiable)

1. One Active Sprint Per Project — service-level enforce, not just UI
2. Velocity Auto-Log — when sprint → COMPLETED, service automatically inserts into sprint_velocity_log (committed vs done points)
3. Story Points — integer only, 0–999 range, default 0
4. Burndown — calculated from backlog_item_history timestamps, NOT stored separately (derived data)
5. Item in ACTIVE sprint — cannot be deleted, only status-changed
6. Sprint DELETE — only DRAFT status allowed; ACTIVE/COMPLETED = blocked
7. All field changes — auto-logged to backlog_item_history
8. updated_at — manually updated in service on every PATCH
9. Admin moving items in someone else's ACTIVE sprint must log reason (min 10 chars) in access_log
10. Performance data — NEVER returned to Member-role API responses
11. Server-side RBAC — all role checks in service layer, never trust client-side role

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations
- Create 5 tables
- Create 4 triggers
- Verify triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: Sprint Service + API (Sprint CRUD + Start/Complete)
- sprintService.js
- Sprint routes + controller
- Velocity log on complete
- Real HTTP tests
- Must pass before Layer 3 begins

### Layer 3: Backlog Service + API (Item CRUD + Move + Reorder)
- backlogService.js
- Backlog routes + controller
- History logging on every change
- Real HTTP tests
- Must pass before Layer 4 begins

### Layer 4: Velocity + Burndown API
- Velocity log GET
- Burndown calculation (derived from history)
- Real HTTP tests
- Must pass before Layer 5 begins

### Layer 5: Frontend (4 Views)
- Sprint Board (Kanban + drag-drop)
- Backlog (list + move to sprint)
- Sprint List
- Velocity Chart (Chart.js)
- All views functional before Layer 6

### Layer 6: Integration + Full Test Suite
- End-to-end: create sprint → add items → start → update statuses → complete → verify velocity log
- Burndown chart test with real history data
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 19 begins

---

## 📊 Test Scripts

scripts/verify-prd18-layer1.js        (DB + triggers)
scripts/verify-prd18-layer2.js        (Sprint API)
scripts/verify-prd18-layer3.js        (Backlog API)
scripts/verify-prd18-layer4.js        (Velocity + Burndown)
scripts/verify-prd18-layer5.js        (Frontend smoke)
scripts/verify-prd18-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [x] 5 tables created and verified
- [x] 4 triggers tested (append-only confirmed with real DB calls)
- [x] 15 API endpoints working with real HTTP calls
- [x] Velocity auto-logged on sprint completion (real test)
- [x] Burndown derived correctly from history (real test)
- [x] 4 frontend views functional
- [x] Drag-drop working (Sprint Board + Backlog)
- [x] RBAC enforced server-side (real role-switch test)
- [x] All existing 469 tests still passing
- [x] Reverse Engineering Report submitted and confirmed
- [x] Honest Status Report submitted
- [ ] Admin GO-AHEAD received
- [ ] Committed to GitHub with message: feat(sprint): PRD 18 complete

---

*PRD 18 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*