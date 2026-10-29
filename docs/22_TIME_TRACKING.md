# PRD 22 — Time Tracking
**File:** docs/22_TIME_TRACKING.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 15 (Pipeline), PRD 18 (Sprint Planning), PRD 20 (Gantt), PRD 21 (Resource Workload)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Jira (Time tracking — log work on issue, time spent vs estimated, sprint time reports)
- ClickUp (Time tracking — timer, manual log, billable toggle, time reports per member/project)
- Toggl (Simple timer, project-based tracking, detailed reports, CSV export)
- Harvest (Time + expense tracking, invoice generation, client billing)
- Clockify (Free time tracker — timer, manual entry, approval workflow, team reports)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's time tracking flow — how timer starts/stops, how manual entries work, how time is linked to tasks/projects, how reports are generated
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (Member → Time Entry → Task → Project → Billable/Non-billable)
4. Map every business rule (e.g., overlapping time entries blocked, timer auto-stops at midnight, billable rate per member per project)
5. Identify what we will NOT copy (visual design, branding, color scheme, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group a complete Time Tracking system so every member can log time spent on tasks, Admin can see where team hours are going, billable vs non-billable hours are tracked separately, and time data feeds into revenue and workload calculations — built our own way.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Start/Stop Timer (own) | ✅ | ✅ | ✅ |
| Manual Time Entry (own) | ✅ | ✅ | ✅ |
| Edit own Time Entry | ✅ | ✅ | ✅ (within 24hrs only) |
| Delete own Time Entry | ✅ | ✅ | ❌ |
| Edit any member Time Entry | ✅ | ✅ | ❌ |
| Delete any Time Entry | ✅ | ✅ | ❌ |
| Approve Time Entries | ✅ | ✅ | ❌ |
| Set billable rate per member | ✅ | ✅ | ❌ |
| Set billable rate per project | ✅ | ✅ | ❌ |
| View full team time report | ✅ | ✅ | ❌ |
| View own time report | ✅ | ✅ | ✅ |
| Export time report | ✅ | ✅ | ❌ |
| View billable amounts | ✅ | ✅ | ❌ |

---

## 🗄️ Database Tables (New — 6 Tables)

### Table 1: time_entries

CREATE TABLE time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT DEFAULT 'MANUAL',
  -- TIMER | MANUAL
  source_ref_type TEXT,
  -- BACKLOG_ITEM | GANTT_ITEM | PIPELINE_POINT | NULL
  source_ref_id INTEGER,
  -- references actual item id in source table
  description TEXT,
  start_time TEXT NOT NULL,
  -- ISO datetime e.g. '2025-01-15T09:00:00'
  end_time TEXT,
  -- NULL = timer still running
  duration_minutes INTEGER,
  -- calculated: (end_time - start_time) in minutes; NULL if timer running
  is_billable INTEGER NOT NULL DEFAULT 0,
  -- 0 = non-billable, 1 = billable
  billable_rate REAL DEFAULT 0.0,
  -- rate at time of entry (snapshot, not live)
  billable_amount REAL DEFAULT 0.0,
  -- calculated: (duration_minutes / 60) × billable_rate
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING | APPROVED | REJECTED
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Rule: only ONE running timer per user at a time (end_time IS NULL)
-- Rule: overlapping time entries blocked at service level
-- Rule: member can edit own entry within 24hrs of creation only

### Table 2: time_entry_history

CREATE TABLE time_entry_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete

### Table 3: billable_rates

CREATE TABLE billable_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate_type TEXT NOT NULL,
  -- MEMBER_DEFAULT | PROJECT_OVERRIDE
  user_id INTEGER REFERENCES users(id),
  -- non-NULL for MEMBER_DEFAULT
  project_id INTEGER REFERENCES projects(id),
  -- non-NULL for PROJECT_OVERRIDE
  rate_per_hour REAL NOT NULL DEFAULT 0.0,
  currency TEXT NOT NULL DEFAULT 'INR',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  -- NULL = currently active rate
  set_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- To change rate: insert new row with new effective_from
-- PROJECT_OVERRIDE takes priority over MEMBER_DEFAULT

### Table 4: active_timers

CREATE TABLE active_timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  -- only one active timer per user
  time_entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- This table acts as a lock table — one row per user with running timer
-- Row inserted when timer starts, deleted when timer stops

### Table 5: time_approval_requests

CREATE TABLE time_approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT DEFAULT (datetime('now')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  decision TEXT,
  -- APPROVED | REJECTED
  decision_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete

### Table 6: time_report_snapshots

CREATE TABLE time_report_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  -- NULL = company-wide snapshot
  report_type TEXT NOT NULL,
  -- WEEKLY | MONTHLY | CUSTOM
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  -- JSON: { user_id, name, total_hrs, billable_hrs, non_billable_hrs, billable_amount }[]
  taken_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_time_history_update
BEFORE UPDATE ON time_entry_history
BEGIN SELECT RAISE(ABORT, 'time_entry_history is append-only'); END;

CREATE TRIGGER prevent_time_history_delete
BEFORE DELETE ON time_entry_history
BEGIN SELECT RAISE(ABORT, 'time_entry_history is append-only'); END;

CREATE TRIGGER prevent_billable_rate_update
BEFORE UPDATE ON billable_rates
BEGIN SELECT RAISE(ABORT, 'billable_rates is append-only'); END;

CREATE TRIGGER prevent_billable_rate_delete
BEFORE DELETE ON billable_rates
BEGIN SELECT RAISE(ABORT, 'billable_rates is append-only'); END;

CREATE TRIGGER prevent_approval_request_update
BEFORE UPDATE ON time_approval_requests
BEGIN SELECT RAISE(ABORT, 'time_approval_requests is append-only'); END;

CREATE TRIGGER prevent_approval_request_delete
BEFORE DELETE ON time_approval_requests
BEGIN SELECT RAISE(ABORT, 'time_approval_requests is append-only'); END;

CREATE TRIGGER prevent_time_report_snapshot_update
BEFORE UPDATE ON time_report_snapshots
BEGIN SELECT RAISE(ABORT, 'time_report_snapshots is append-only'); END;

CREATE TRIGGER prevent_time_report_snapshot_delete
BEFORE DELETE ON time_report_snapshots
BEGIN SELECT RAISE(ABORT, 'time_report_snapshots is append-only'); END;

---

## 📊 Calculation Rules (Non-Negotiable)

1. duration_minutes = ROUND((end_time - start_time) in seconds / 60)
2. billable_amount = (duration_minutes / 60) × billable_rate — calculated at entry close time, stored as snapshot
3. PROJECT_OVERRIDE rate takes priority over MEMBER_DEFAULT rate — always
4. If no rate set for member or project → billable_rate = 0, billable_amount = 0
5. Only ONE running timer per user at a time — service rejects second timer start
6. Overlapping entries blocked — new entry start_time cannot fall within any existing entry's start_time–end_time range for same user
7. Member can edit own entry within 24 hours of created_at only — service enforces, not just UI
8. Timer auto-closes at 23:59:59 of the started day — service cron job handles this
9. All edits auto-logged to time_entry_history
10. Approval workflow: PENDING → APPROVED or REJECTED by Admin
11. Rejected entries cannot be re-submitted — member must create new entry
12. All calculation server-side — client never sends duration or billable_amount

---

## 🔌 API Routes (20 Endpoints)

### Timer Routes

POST   /api/time/timer/start
         body: { project_id, source_ref_type, source_ref_id, description, is_billable }
         rule: blocks if user already has running timer
         role: All

POST   /api/time/timer/stop
         rule: closes active timer, calculates duration + billable_amount, creates time_entry
         role: All (own timer only)

GET    /api/time/timer/status
         returns: current running timer for logged-in user (or null)
         role: All

### Manual Entry Routes

POST   /api/time/entry/create
         body: { project_id, start_time, end_time, description, is_billable, source_ref_type, source_ref_id }
         rule: overlap check, duration calculated server-side
         role: All

PATCH  /api/time/entry/:entryId
         body: { description, start_time, end_time, is_billable }
         rule: member can edit own within 24hrs only; Admin anytime
         rule: auto-logs to time_entry_history
         role: Owner (24hr limit) or Admin+

DELETE /api/time/entry/:entryId
         rule: only Admin can delete; auto-logs deletion to time_entry_history
         role: Admin+

GET    /api/time/entries/my
         query: ?project_id=&from=&to=
         returns: own time entries with filters
         role: All

GET    /api/time/entries/project/:projectId
         query: ?user_id=&from=&to=&status=
         returns: all entries for project (with filters)
         role: Admin+

### Approval Routes

POST   /api/time/approval/request/:entryId
         rule: entry must be PENDING; creates time_approval_requests row
         role: Owner of entry

PATCH  /api/time/approval/:requestId/approve
         rule: status → APPROVED; logged in access_log
         role: Admin+

PATCH  /api/time/approval/:requestId/reject
         body: { decision_note }
         rule: status → REJECTED; rejection_reason stored on entry
         role: Admin+

GET    /api/time/approval/pending
         returns: all PENDING approval requests
         role: Admin+

### Billable Rate Routes

POST   /api/time/rate/set
         body: { rate_type, user_id, project_id, rate_per_hour, currency, effective_from }
         rule: append-only insert
         role: Admin+

GET    /api/time/rate/member/:userId
         returns: all rate history for member
         role: Admin+

GET    /api/time/rate/project/:projectId
         returns: all rate overrides for project
         role: Admin+

### Report Routes

GET    /api/time/report/team
         query: ?from=&to=&project_id=
         returns: per-member summary: total_hrs, billable_hrs, non_billable_hrs, billable_amount
         role: Admin+

GET    /api/time/report/my
         query: ?from=&to=&project_id=
         returns: own summary report
         role: All

POST   /api/time/report/snapshot
         body: { project_id, report_type, period_start, period_end }
         rule: takes snapshot of current report data
         role: Admin+

GET    /api/time/report/snapshots/:projectId
         returns: all report snapshots for project
         role: Admin+

GET    /api/time/report/export/:projectId
         query: ?from=&to=
         returns: JSON data for frontend CSV/PDF export
         role: Admin+

---

## 🖥️ Frontend Views (4 HTML Views)

### View 1: My Time Tracker (my-time-tracker.html)
- Top section: Active Timer widget
  - If timer running: show task name, project, elapsed time (live counter), Stop button
  - If no timer: Show "Start Timer" button → dropdown to select project + task + billable toggle
- Middle section: Today's time entries list
  - Each row: task description, project, start–end time, duration, billable badge, status badge
  - Edit button (within 24hrs), Submit for Approval button
- Bottom section: This week summary bar chart (hrs per day)
- Available to all members (own data only)

### View 2: Team Time Report (team-time-report.html)
- Date range picker (from / to)
- Project filter dropdown
- Table: Member | Total Hrs | Billable Hrs | Non-Billable Hrs | Billable Amount | Entries Count
- Click member row → drill into that member's entries for the period
- Summary totals row at bottom
- "Export" button → downloads JSON/CSV
- "Take Snapshot" button (Admin)
- Admin only view

### View 3: Time Approval Queue (time-approval-queue.html)
- List of all PENDING approval requests
- Each row: Member name | Project | Description | Duration | Billable | Submitted at
- "Approve" and "Reject" buttons per row
- Reject → modal with reason textarea (min 10 chars)
- Filter: PENDING | APPROVED | REJECTED
- Admin only view

### View 4: Billable Rates Management (billable-rates.html)
- Table: Member | Default Rate (₹/hr) | Currency | Effective From | Set By
- "Update Rate" button per member → opens form (inserts new row)
- Project Override section: Project | Member | Override Rate | Effective From
- "Add Project Override" button
- Rate history accordion per member (expand to see all past rates)
- Admin only view

---

## ⚙️ Business Rules (Non-Negotiable)

1. One running timer per user maximum — service rejects second start attempt
2. Overlapping manual entries blocked — service checks existing entries for same user
3. Member edit window = 24 hours from created_at — service enforces, not just UI
4. Timer auto-closes at 23:59:59 — server-side cron job (setInterval daily check)
5. billable_amount always calculated at entry close time — snapshot stored, never recalculated live
6. PROJECT_OVERRIDE rate always takes priority over MEMBER_DEFAULT
7. Rejected entries cannot be resubmitted — member creates fresh entry
8. Admin deletion always logged to time_entry_history with reason
9. Billable amounts and team reports NEVER accessible to Member role
10. Member sees only own entries and own report
11. Approval workflow mandatory for billable entries before they count toward billing
12. All rate changes append-only — no in-place editing of rates ever
13. updated_at manually updated in service on every PATCH
14. Server-side RBAC — all role checks in service layer, never trust client-side role
15. Timer elapsed time shown live on frontend via local JS clock — not via server polling

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations
- Create 6 tables
- Create 8 triggers
- Verify all triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: Timer Service + API (Start/Stop/Status)
- timeTrackingService.js
- Timer routes + controller
- One-timer-per-user lock via active_timers table
- Overlap check
- Real HTTP tests (including conflict scenarios)
- Must pass before Layer 3 begins

### Layer 3: Manual Entry + Billable Rate Service + API
- Manual entry CRUD
- Billable rate set + retrieval (project override priority logic)
- billable_amount calculation at entry close
- History logging on every change
- Real HTTP tests
- Must pass before Layer 4 begins

### Layer 4: Approval Workflow + Report API
- Approval request, approve, reject
- Team report endpoint (aggregated)
- My report endpoint
- Snapshot creation
- Export endpoint
- Real HTTP tests
- Must pass before Layer 5 begins

### Layer 5: Frontend (4 Views)
- My Time Tracker (with live timer counter)
- Team Time Report
- Time Approval Queue
- Billable Rates Management
- All views functional before Layer 6

### Layer 6: Integration + Full Test Suite
- End-to-end: start timer → stop → manual entry → submit approval → approve → verify billable_amount → take snapshot → export
- Overlap blocked test (real HTTP)
- 24hr edit window enforcement test (real HTTP with manipulated created_at)
- PROJECT_OVERRIDE rate priority test
- Timer auto-close cron test (real scenario)
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 23 begins

---

## 📊 Test Scripts

scripts/verify-prd22-layer1.js        (DB + triggers)
scripts/verify-prd22-layer2.js        (Timer API)
scripts/verify-prd22-layer3.js        (Manual Entry + Rates)
scripts/verify-prd22-layer4.js        (Approval + Reports)
scripts/verify-prd22-layer5.js        (Frontend smoke)
scripts/verify-prd22-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [x] 6 tables created and verified
- [x] 8 triggers tested (append-only confirmed with real DB calls)
- [x] 20 API endpoints working with real HTTP calls
- [x] One-timer-per-user lock tested (real conflict blocked)
- [x] Overlap check tested (real overlapping entry blocked)
- [x] 24hr edit window enforced (real HTTP test)
- [x] billable_amount snapshot calculation verified
- [x] PROJECT_OVERRIDE rate priority verified
- [x] Timer auto-close cron tested
- [x] Approval workflow end-to-end verified
- [x] 4 frontend views functional
- [x] Live timer counter working on My Time Tracker view
- [x] Member sees own data only (RBAC real test)
- [x] All existing 469 tests still passing
- [x] Reverse Engineering Report submitted and confirmed
- [x] Honest Status Report submitted
- [x] Admin GO-AHEAD received
- [x] Committed to GitHub with message: feat(time-tracking): PRD 22 complete

---

*PRD 22 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*