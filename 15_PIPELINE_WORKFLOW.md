# PRD 15 — 4-Role Project Pipeline Workflow
# Mahi Tech Group — Internal Platform

---

## 📋 Document Info

| Field | Value |
|-------|-------|
| PRD Number | 15 |
| Title | 4-Role Research→Design→Dev→Test Pipeline |
| Status | APPROVED FOR BUILD |
| Depends On | Steps 01–14 (all complete, commit 39afe3c) |
| New DB Tables | pipeline_deliverables, pipeline_checklist_points, pipeline_stage_handoffs, pipeline_addendum_requests |
| New Routes | /api/pipeline/* |
| Existing Routes Modified | PATCH /api/admin/projects/:id/final-review |

---

## 1. PURPOSE & GOAL

Every project that exists on the platform currently uses a flat
parallel fan-out (Step 04). Tasks are assigned but there is no
enforced staged quality gate between roles.

This PRD introduces a structured 4-stage sequential pipeline
PER DELIVERABLE inside each project:

  Research → Design → Dev → Test

Rules:
- Stages are sequential PER DELIVERABLE (not per whole project)
- Multiple deliverables in one project can run in parallel
- Each stage must be explicitly approved before next stage begins
- Checklist-based % tracking (no sliders, no arbitrary numbers)
- Any downstream role can request a point-level addendum
  from an upstream role WITHOUT reopening all approved work
- Tester can raise a bug-ticket to Developer for a specific point
- Admin gives final approval before project goes LIVE
- No stage can be skipped under any condition

---

## 2. DEFINITIONS

Deliverable:
  A named unit of work inside a project.
  Example: "User Authentication Module", "Landing Page Design"
  One project can have multiple deliverables.

Pipeline Stage:
  One of the 4 roles working on a deliverable in sequence.
  RESEARCH → DESIGN → DEV → TEST

Checklist Point:
  A single verifiable task within a stage.
  Example (Research stage): "Competitor analysis document uploaded"
  Each point has a weight (1–10). Points are approved one by one.

Stage % Completion:
  = (Sum of APPROVED points' weights) ÷ (Total points' weights) × 100
  Stage is 100% only when ALL points are APPROVED.
  100% required before handoff to next stage is allowed.

Stage Handoff:
  Formal transition from one stage to the next.
  Requires: current stage = 100%, explicit Lead/Admin approval.
  Creates an immutable snapshot of the stage's work.

Addendum Request:
  A downstream stage (e.g. Dev) requests a specific upstream
  stage (e.g. Research or Design) to add/fix ONE specific point.
  Does NOT reopen the entire upstream stage.
  Upstream adds the new point → approves it → handoff continues.

Bug Ticket:
  Raised by Test stage against a specific Dev checklist point.
  Forces that point back to IN_PROGRESS in Dev stage.
  All other approved Dev points remain untouched.

---

## 3. DATABASE SCHEMA

--- Table 1: pipeline_deliverables ---
CREATE TABLE IF NOT EXISTS pipeline_deliverables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  current_stage VARCHAR(20) NOT NULL DEFAULT 'RESEARCH',
  -- RESEARCH | DESIGN | DEV | TEST | COMPLETE | LIVE
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  -- ACTIVE | PAUSED | COMPLETE | CANCELLED
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

--- Table 2: pipeline_checklist_points ---
CREATE TABLE IF NOT EXISTS pipeline_checklist_points (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  stage VARCHAR(20) NOT NULL,
  -- RESEARCH | DESIGN | DEV | TEST
  point_title VARCHAR(300) NOT NULL,
  point_description TEXT,
  weight INTEGER NOT NULL DEFAULT 5 CHECK(weight >= 1 AND weight <= 10),
  status VARCHAR(20) NOT NULL DEFAULT 'UNCLAIMED',
  -- UNCLAIMED | CLAIMED | IN_PROGRESS | SUBMITTED | APPROVED | REVISION_NEEDED
  assigned_to TEXT,
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by TEXT,
  tool_link TEXT,
  -- Optional external tool URL attached to this point
  asset_url TEXT,
  -- Uploaded file/deliverable for this point
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

--- Table 3: pipeline_stage_handoffs ---
CREATE TABLE IF NOT EXISTS pipeline_stage_handoffs (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  from_stage VARCHAR(20) NOT NULL,
  to_stage VARCHAR(20) NOT NULL,
  stage_completion_pct DECIMAL(5,2) NOT NULL,
  -- Must be 100.00 at time of handoff
  handoff_notes TEXT,
  approved_by TEXT NOT NULL,
  -- Lead or Admin who approved this handoff
  snapshot_json TEXT,
  -- Immutable JSON snapshot of all approved points at handoff time
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

--- Append-only trigger for pipeline_stage_handoffs ---
CREATE TRIGGER IF NOT EXISTS prevent_handoff_update
BEFORE UPDATE ON pipeline_stage_handoffs
BEGIN
  SELECT RAISE(ABORT, 'pipeline_stage_handoffs is append-only. Updates forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS prevent_handoff_delete
BEFORE DELETE ON pipeline_stage_handoffs
BEGIN
  SELECT RAISE(ABORT, 'pipeline_stage_handoffs is append-only. Deletes forbidden.');
END;

--- Table 4: pipeline_addendum_requests ---
CREATE TABLE IF NOT EXISTS pipeline_addendum_requests (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  requesting_stage VARCHAR(20) NOT NULL,
  -- Stage making the request (e.g. DEV requesting from RESEARCH)
  target_stage VARCHAR(20) NOT NULL,
  -- Stage that must fulfill the request (e.g. RESEARCH)
  point_title VARCHAR(300) NOT NULL,
  -- The specific point being requested
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  -- OPEN | FULFILLED | REJECTED
  raised_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (raised_by) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

--- Bug ticket is stored as a pipeline_checklist_points entry ---
--- with status = REVISION_NEEDED and a new point in Dev stage  ---
--- linked via pipeline_addendum_requests with type = BUG_TICKET ---

--- Add type column to pipeline_addendum_requests ---
--- type: ADDENDUM | BUG_TICKET
ALTER TABLE pipeline_addendum_requests
ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'ADDENDUM';

---

## 4. PIPELINE STAGE RULES

STAGE ORDER (fixed, non-skippable):
  1. RESEARCH
  2. DESIGN
  3. DEV
  4. TEST
  5. COMPLETE (all 4 stages done)
  6. LIVE (Admin final approval given)

STAGE COMPLETION FORMULA:
  stage_pct = SUM(weight of APPROVED points) / SUM(weight of all points) × 100
  Rounded to 2 decimal places.
  Stage is "complete" only when stage_pct = 100.00

HANDOFF RULE:
  - Current stage must be 100.00% complete
  - Lead (project Lead role) OR Admin must explicitly approve handoff
  - On handoff approval → immutable snapshot stored in pipeline_stage_handoffs
  - Next stage unlocks and becomes active
  - Previous stage becomes READ-ONLY (no edits except via addendum)

ADDENDUM REQUEST RULE:
  - Any active stage can raise an addendum request against any
    already-completed upstream stage
  - Addendum adds ONE new checklist point to the upstream stage
  - Upstream member claims + completes that new point
  - New point approved → addendum marked FULFILLED
  - This does NOT reset the upstream stage % back to 0
  - The new approved point simply adds to the already-complete total
  - Downstream stage can proceed only after addendum is FULFILLED

BUG TICKET RULE:
  - Only TEST stage can raise bug tickets
  - Bug ticket targets a specific point in DEV stage
  - That specific DEV point status → REVISION_NEEDED
  - Dev member fixes → resubmits → point re-approved
  - All other approved Dev points remain untouched
  - Bug ticket stored as type=BUG_TICKET in pipeline_addendum_requests

ADMIN FINAL APPROVAL RULE:
  - After TEST stage reaches 100%, status = COMPLETE
  - Project does NOT go LIVE automatically
  - Admin must call PATCH /api/admin/projects/:id/pipeline/approve-live
  - Admin sees full pipeline summary before approving
  - On approval → deliverable status = LIVE, notification sent to all members

---

## 5. API ROUTES

All routes require valid JWT (requireAuth middleware).
RBAC enforced per action as specified.

--- Deliverable Management ---

POST   /api/pipeline/deliverables
  Body: { project_id, title, description }
  Auth: Lead or Admin only
  Action: Creates a new deliverable in RESEARCH stage
          Auto-creates default checklist template for RESEARCH stage
  Returns: deliverable object

GET    /api/pipeline/deliverables/:project_id
  Auth: Any project member
  Action: Lists all deliverables in a project with stage + % per stage
  Returns: array of deliverables with computed stage percentages

GET    /api/pipeline/deliverables/:id/detail
  Auth: Any project member
  Action: Full detail — all stages, all checklist points, all handoffs
  Returns: full pipeline tree for one deliverable

PATCH  /api/pipeline/deliverables/:id
  Body: { title, description, status }
  Auth: Lead or Admin only
  Action: Update deliverable metadata (not stage — stage auto-advances)

--- Checklist Point Management ---

POST   /api/pipeline/deliverables/:id/points
  Body: { stage, point_title, point_description, weight }
  Auth: Lead or Admin only
  Action: Add a checklist point to a specific stage of a deliverable
          Stage must be current active stage or OPEN via addendum
  Returns: new point object

PATCH  /api/pipeline/points/:id/claim
  Auth: Member whose role matches the stage
  Action: Claims a point (UNCLAIMED → CLAIMED)
          Only one person can claim a point at a time
  Returns: updated point

PATCH  /api/pipeline/points/:id/start
  Auth: Assigned member only
  Action: CLAIMED → IN_PROGRESS
  Returns: updated point

PATCH  /api/pipeline/points/:id/submit
  Body: { asset_url, tool_link, notes }
  Auth: Assigned member only
  Action: IN_PROGRESS → SUBMITTED
          Notifies Lead/Admin that point is ready for review
  Returns: updated point

PATCH  /api/pipeline/points/:id/approve
  Auth: Lead or Admin only
  Action: SUBMITTED → APPROVED
          Recalculates stage % after approval
          If stage % = 100, notifies Lead/Admin that handoff is possible
  Returns: updated point + new stage %

PATCH  /api/pipeline/points/:id/revision
  Body: { reason }
  Auth: Lead or Admin only
  Action: SUBMITTED → IN_PROGRESS (with revision note)
          Notifies assigned member
  Returns: updated point

--- Stage Handoff ---

POST   /api/pipeline/deliverables/:id/handoff
  Body: { from_stage, to_stage, handoff_notes }
  Auth: Lead or Admin only
  Validation: from_stage must be 100.00% complete
              to_stage must be the next logical stage
              from_stage must not already have a handoff recorded
  Action: Creates immutable handoff record with JSON snapshot
          Unlocks next stage
          Notifies members of next-stage role
          Logs in access_log
  Returns: handoff record

GET    /api/pipeline/deliverables/:id/handoffs
  Auth: Any project member
  Action: Lists all handoff records for a deliverable (immutable history)
  Returns: array of handoff records with snapshots

--- Addendum & Bug Ticket ---

POST   /api/pipeline/deliverables/:id/addendum
  Body: { requesting_stage, target_stage, point_title, reason, type }
  -- type: ADDENDUM or BUG_TICKET
  Auth: Member of requesting_stage role, or Lead/Admin
  Action: Creates addendum request
          If BUG_TICKET: target_stage must be DEV, requesting_stage must be TEST
          Notifies target_stage members and Lead/Admin
  Returns: addendum request object

PATCH  /api/pipeline/addendum/:id/fulfill
  Body: { point_id }
  -- point_id = the new checklist point created to fulfill this request
  Auth: Lead or Admin only
  Action: Links fulfilled addendum to its new approved point
          Status → FULFILLED
          Notifies requesting_stage members
  Returns: updated addendum

PATCH  /api/pipeline/addendum/:id/reject
  Body: { reason }
  Auth: Admin only
  Action: Status → REJECTED with reason
          Notifies raising member
  Returns: updated addendum

GET    /api/pipeline/deliverables/:id/addendums
  Auth: Any project member
  Action: Lists all addendum/bug-ticket requests for a deliverable
  Returns: array of addendum records

--- Admin Final Approval ---

GET    /api/admin/projects/:id/pipeline/summary
  Auth: Admin only
  Action: Shows full pipeline summary — all deliverables, all stages,
          all % completion, all handoffs, all addendums, all bug tickets
  Returns: complete pipeline audit object

PATCH  /api/admin/projects/:id/pipeline/approve-live
  Body: { approval_notes }
  Auth: Admin only
  Validation: ALL deliverables must be in COMPLETE status
              No open addendum requests
              No open bug tickets
  Action: All deliverables → LIVE status
          Project stage → LIVE
          Logs immutable entry in access_log
          Sends notification to all project members
  Returns: updated project

---

## 6. FRONTEND VIEWS REQUIRED

View 1: Pipeline Dashboard (per project)
  - List of all deliverables in this project
  - Each deliverable shows: current stage badge, % per stage
    (4 progress bars — Research/Design/Dev/Test)
  - "Add Deliverable" button (Lead/Admin only)
  - Click deliverable → opens Detail View

View 2: Deliverable Detail View
  - 4-column stage layout (Research | Design | Dev | Test)
  - Each column shows its checklist points with status badges:
    🔓 UNCLAIMED | 🔒 CLAIMED | ⚙️ IN_PROGRESS |
    📤 SUBMITTED | ✅ APPROVED | 🔄 REVISION_NEEDED
  - "Claim" button on unclaimed points (role-matched members only)
  - "Submit" button on IN_PROGRESS points (assigned member only)
  - "Approve" / "Request Revision" buttons (Lead/Admin only)
  - Stage % progress bar at top of each column
  - "Approve Handoff →" button appears only when stage = 100%
    (Lead/Admin only)
  - Addendum/Bug Ticket section at bottom of view

View 3: Addendum / Bug Ticket Panel
  - List of open/fulfilled/rejected addendums for this deliverable
  - "Raise Addendum" button (role-matched or Lead/Admin)
  - "Raise Bug Ticket" button (Test role members only)
  - Each item shows: type badge, from→to stage, status, reason

View 4: Admin Pipeline Approval Screen
  - Accessible from Admin Panel
  - Full summary of all deliverables and their pipeline status
  - "Approve Go-Live" button (only active when all deliverables COMPLETE
    and zero open addendums/bug tickets)
  - Approval notes field (required)

---

## 7. PERMISSION MATRIX

| Action | Researcher | Designer | Developer | Tester | Lead | Admin |
|--------|------------|----------|-----------|--------|------|-------|
| View pipeline | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Add deliverable | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Add checklist point | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Claim point (own stage) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Submit point | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve point | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Approve handoff | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Raise addendum | ✅* | ✅* | ✅* | ✅* | ✅ | ✅ |
| Raise bug ticket | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Fulfill addendum | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Reject addendum | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Approve Go-Live | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

* Only for their own active stage

---

## 8. BUSINESS RULES (NON-NEGOTIABLE)

R1. Stage order is FIXED: Research → Design → Dev → Test.
    No stage can be skipped. No stage can be reversed.
    The only way to go back is via addendum or bug ticket
    on a specific point — not a full stage reversal.

R2. Checklist % is ALWAYS point-weight-based.
    No sliders. No manual % entry. No arbitrary numbers.
    % = real math from real approved points only.

R3. Handoff snapshots are APPEND-ONLY.
    DB triggers prevent UPDATE and DELETE on pipeline_stage_handoffs.

R4. Admin final approval is MANDATORY.
    Project cannot reach LIVE status without explicit Admin action.
    Auto-live is permanently blocked.

R5. Bug tickets can ONLY be raised by Test stage members.
    Only Test → Dev direction. No other direction for bug tickets.

R6. Addendum does NOT reset stage %.
    It adds new work on top of already-approved work.
    The new point must reach APPROVED before downstream unblocks.

R7. A member can only claim a point in their role's stage.
    A developer cannot claim a Research point.
    Role matching is server-side enforced (RBAC).

R8. Every handoff, approval, addendum action is logged
    in access_log with user_id, action, resource, timestamp.

R9. Admin must NOT appear in the member-facing pipeline view
    as a "stage worker." Admin is oversight only.

R10. Performance data from pipeline (points claimed, approved,
     speed of completion) is NEVER visible to regular members.
     Visible only to Super Admin.

---

## 9. NOTIFICATIONS (WebSocket + DB)

These events trigger real-time WebSocket broadcasts
AND stored notifications in the notifications table:

- Point submitted → Lead/Admin notified
- Point approved → Assigned member notified
- Point sent to revision → Assigned member notified
- Stage reached 100% → Lead/Admin notified ("Handoff ready")
- Handoff approved → Next-stage role members notified
- Addendum request raised → Target-stage members + Lead/Admin notified
- Addendum fulfilled → Requesting-stage members notified
- Bug ticket raised → Dev-stage members + Lead/Admin notified
- All deliverables COMPLETE → Admin notified ("Go-Live approval needed")
- Go-Live approved → All project members notified

---

## 10. IMPLEMENTATION LAYERS

Build in this exact order. Do NOT move to next layer
until current layer is 100% done, tests pass with real
console output, and explicit GO-AHEAD is given.

Layer 1 — DB + Schema
  - Create 4 new tables with all triggers
  - Verify WAL mode active (already done in 39afe3c)
  - Confirm append-only triggers on handoffs table
  - Real console output: show all 4 tables exist in DB

Layer 2 — Core Service
  - Create src/services/pipelineService.js
  - Implement: createDeliverable, addChecklistPoint,
    claimPoint, startPoint, submitPoint, approvePoint,
    revisionPoint, computeStagePercent, approveHandoff,
    raiseAddendum, fulfillAddendum, rejectAddendum,
    adminApproveLive
  - All business rules R1–R10 enforced in service layer
  - Real unit test for each service function

Layer 3 — API Routes
  - Create src/routes/pipeline.routes.js
  - Wire all 17 routes listed in Section 5
  - RBAC guards per Section 7 permission matrix
  - All routes log to access_log
  - Real HTTP test for each route (real server, real DB calls)

Layer 4 — Frontend Views
  - Create 4 views listed in Section 6
  - Pipeline Dashboard (per project)
  - Deliverable Detail View (4-column layout)
  - Addendum/Bug Ticket Panel
  - Admin Pipeline Approval Screen
  - All views derive role from GET /api/users/me (server-verified)
  - No client-side role assumptions

Layer 5 — Notifications + WebSocket
  - Wire all 10 notification events from Section 9
  - Real-time WebSocket broadcast for each event
  - Stored notification in DB for each event
  - Real test: trigger each event, verify WS broadcast + DB record

Layer 6 — Integration + Full Regression
  - Connect pipeline to existing project flow:
    When project created via fanout → auto-create first deliverable
  - Connect Admin Go-Live to existing
    PATCH /api/admin/projects/:id/final-review flow
  - Run full npm test (must stay 13/13 PASS)
  - Run all 18 step scripts (must stay all PASS)
  - Zero new bugs introduced
  - Honest Section 7 Status Report required

---

## 11. TEST REQUIREMENTS

- All lifecycle/state-transition tests must use REAL sequences:
  real login, real API calls, real state changes
- No DB shortcuts or mocks for lifecycle tests
- Test must cover:
  ✅ Full happy path: point UNCLAIMED → APPROVED through all 4 stages
  ✅ Handoff blocked when stage < 100%
  ✅ Handoff succeeds when stage = 100%
  ✅ Addendum adds point without resetting upstream %
  ✅ Bug ticket forces specific Dev point to REVISION_NEEDED
  ✅ Admin Go-Live blocked when any deliverable not COMPLETE
  ✅ Admin Go-Live blocked when open addendums exist
  ✅ Admin Go-Live succeeds when all conditions met
  ✅ Role mismatch blocked (Dev cannot claim Research point)
  ✅ Append-only trigger prevents handoff UPDATE and DELETE
  ✅ access_log entry created for every action
  ✅ WebSocket notification fires for each of 10 events

---

## 12. FILES TO CREATE / MODIFY

New Files:
  src/services/pipelineService.js
  src/routes/pipeline.routes.js
  public/js/app/views/pipeline.js
  scripts/run-step15-pipeline-tests.js

Modified Files:
  src/app.js (register new pipeline routes)
  src/db/database.js (add 4 new table CREATE statements)
  src/services/fanoutService.js (auto-create first deliverable on project create)
  src/routes/admin.js (add pipeline summary + approve-live routes)
  public/js/app/views/projects.js (add pipeline tab to project view)
  public/js/app/views/admin.js (add pipeline approval section)
  docs/progress.md (update after completion)

---

## 13. DEFINITION OF DONE

PRD 15 is COMPLETE only when ALL of the following are true:
  ✅ All 4 DB tables created with triggers verified
  ✅ All 17 API routes working (real HTTP tests)
  ✅ All 4 frontend views rendering correctly
  ✅ All 10 notification events firing (WS + DB)
  ✅ All 12 test scenarios passing (real sequences)
  ✅ npm test 13/13 PASS
  ✅ All 18 step scripts PASS
  ✅ Zero regression on existing features
  ✅ Honest Section 7 Status Report submitted
  ✅ Admin Go-Live approval tested end-to-end
  ✅ Commit pushed to GitHub with descriptive message

---

*PRD 15 — Sealed for build. Next: PRD 16 after this is COMPLETE.*