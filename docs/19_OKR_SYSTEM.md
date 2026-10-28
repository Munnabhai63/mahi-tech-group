# PRD 19 — OKR System (Objectives & Key Results)
**File:** docs/19_OKR_SYSTEM.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 15 (Pipeline), PRD 16 (Point Pool), PRD 18 (Sprint Planning)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Google (internal OKR system — C-suite to IC level alignment, quarterly cadence, public OKR culture)
- ClickUp (Goals + Targets + Progress rollup)
- Asana (Goals, sub-goals, portfolio alignment)
- Notion (OKR templates, linked databases)
- Microsoft Viva Goals (OKR tracking, check-ins, alignment tree)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's OKR flow — how Objective is created, how Key Results are linked, how progress rolls up automatically
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (Objective → Key Results → Check-ins → Progress %)
4. Map every business rule (e.g., KR progress = average of all sub-KR progress, Objective status auto-updates when KRs hit 100%)
5. Identify what we will NOT copy (visual design, branding, color, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group a full OKR (Objectives and Key Results) system — aligned from company level down to individual member level — so the team always knows what they are working toward and how progress is tracked. Similar to how Google, Microsoft, and Meta use OKRs internally, but built our own way.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Create Company-level Objective | ✅ | ✅ | ❌ |
| Create Team-level Objective | ✅ | ✅ | ❌ |
| Create Individual Objective | ✅ | ✅ | ✅ (own only) |
| Edit Objective | ✅ | ✅ | ✅ (own only) |
| Delete Objective | ✅ | ✅ | ❌ |
| Add Key Result to any Objective | ✅ | ✅ | ✅ (own only) |
| Edit Key Result | ✅ | ✅ | ✅ (own only) |
| Delete Key Result | ✅ | ✅ | ❌ |
| Submit Check-in (progress update) | ✅ | ✅ | ✅ |
| View all OKRs | ✅ | ✅ | ✅ |
| View member-level OKRs | ✅ | ✅ | ❌ (own only) |
| Archive Objective | ✅ | ✅ | ❌ |

---

## 🗄️ Database Tables (New — 5 Tables)

### Table 1: okr_objectives

CREATE TABLE okr_objectives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT NOT NULL DEFAULT 'TEAM',
  -- COMPANY | TEAM | INDIVIDUAL
  owner_id INTEGER NOT NULL REFERENCES users(id),
  parent_objective_id INTEGER REFERENCES okr_objectives(id),
  -- NULL = top-level objective, non-NULL = aligned to parent
  project_id INTEGER REFERENCES projects(id),
  -- NULL = company-level, non-NULL = project/team level
  cycle TEXT NOT NULL,
  -- e.g. 'Q1-2025', 'Q2-2025', 'H1-2025', 'FY-2025'
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  -- DRAFT | ACTIVE | COMPLETED | CANCELLED | ARCHIVED
  progress_pct REAL DEFAULT 0.0,
  -- auto-calculated from Key Results (0.00 to 100.00)
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 2: okr_key_results

CREATE TABLE okr_key_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'PERCENTAGE',
  -- PERCENTAGE | NUMBER | BOOLEAN | MILESTONE
  target_value REAL NOT NULL DEFAULT 100,
  -- for PERCENTAGE: 100, for NUMBER: custom, for BOOLEAN: 1, for MILESTONE: milestone count
  current_value REAL NOT NULL DEFAULT 0,
  unit TEXT,
  -- e.g. '%', 'users', 'revenue', 'tasks'
  progress_pct REAL DEFAULT 0.0,
  -- auto-calculated: current_value ÷ target_value × 100, capped at 100
  status TEXT NOT NULL DEFAULT 'ON_TRACK',
  -- ON_TRACK | AT_RISK | OFF_TRACK | COMPLETED
  assigned_to INTEGER REFERENCES users(id),
  due_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 3: okr_checkins

CREATE TABLE okr_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_result_id INTEGER NOT NULL REFERENCES okr_key_results(id),
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  previous_value REAL NOT NULL DEFAULT 0,
  new_value REAL NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'MEDIUM',
  -- HIGH | MEDIUM | LOW
  note TEXT,
  -- optional comment from member about this check-in
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- Every check-in updates okr_key_results.current_value and recalculates progress_pct

### Table 4: okr_alignment_links

CREATE TABLE okr_alignment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  parent_objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  linked_by INTEGER NOT NULL REFERENCES users(id),
  linked_at TEXT DEFAULT (datetime('now')),
  UNIQUE(child_objective_id, parent_objective_id)
);
-- Append-only: DB trigger prevents update/delete
-- Used to build alignment tree (Individual → Team → Company)

### Table 5: okr_history

CREATE TABLE okr_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  -- 'OBJECTIVE' | 'KEY_RESULT'
  entity_id INTEGER NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_okr_checkin_update
BEFORE UPDATE ON okr_checkins
BEGIN SELECT RAISE(ABORT, 'okr_checkins is append-only'); END;

CREATE TRIGGER prevent_okr_checkin_delete
BEFORE DELETE ON okr_checkins
BEGIN SELECT RAISE(ABORT, 'okr_checkins is append-only'); END;

CREATE TRIGGER prevent_okr_alignment_update
BEFORE UPDATE ON okr_alignment_links
BEGIN SELECT RAISE(ABORT, 'okr_alignment_links is append-only'); END;

CREATE TRIGGER prevent_okr_alignment_delete
BEFORE DELETE ON okr_alignment_links
BEGIN SELECT RAISE(ABORT, 'okr_alignment_links is append-only'); END;

CREATE TRIGGER prevent_okr_history_update
BEFORE UPDATE ON okr_history
BEGIN SELECT RAISE(ABORT, 'okr_history is append-only'); END;

CREATE TRIGGER prevent_okr_history_delete
BEFORE DELETE ON okr_history
BEGIN SELECT RAISE(ABORT, 'okr_history is append-only'); END;

---

## 🔌 API Routes (18 Endpoints)

### Objective Routes

POST   /api/okr/objective/create
         body: { title, description, level, project_id, cycle, parent_objective_id }
         role: Admin+ for COMPANY/TEAM level; Member for own INDIVIDUAL

GET    /api/okr/objectives
         returns: all objectives (filtered by level, cycle, project_id via query params)
         role: All

GET    /api/okr/objective/:objectiveId
         returns: objective detail + all key results + progress_pct
         role: All

PATCH  /api/okr/objective/:objectiveId
         body: any editable field
         rule: auto-logs to okr_history
         role: Admin+ or owner (own INDIVIDUAL only)

PATCH  /api/okr/objective/:objectiveId/archive
         rule: status → ARCHIVED, all KRs frozen
         role: Admin+

DELETE /api/okr/objective/:objectiveId
         rule: only DRAFT status deletable
         role: Admin+

GET    /api/okr/objective/:objectiveId/tree
         returns: full alignment tree (parent chain + child objectives)
         role: All

### Key Result Routes

POST   /api/okr/kr/create
         body: { objective_id, title, type, target_value, unit, assigned_to, due_date }
         role: Admin+ or objective owner

GET    /api/okr/kr/:krId
         returns: KR detail + all check-ins
         role: All

PATCH  /api/okr/kr/:krId
         body: any editable field
         rule: auto-logs to okr_history
         role: Admin+ or KR assignee

DELETE /api/okr/kr/:krId
         rule: only if parent objective is DRAFT
         role: Admin+

### Check-in Routes

POST   /api/okr/checkin/submit
         body: { key_result_id, new_value, confidence, note }
         rule: updates KR current_value, recalculates KR progress_pct,
               recalculates parent Objective progress_pct automatically
         role: KR assignee or Admin+

GET    /api/okr/checkins/:krId
         returns: all check-ins for a Key Result (chronological)
         role: All

### Progress & Reporting Routes

GET    /api/okr/dashboard
         returns: company OKRs + team OKRs + my OKRs + overall progress summary
         role: All (filtered by role)

GET    /api/okr/cycle/:cycle
         returns: all objectives for given cycle (e.g. Q1-2025)
         role: All

GET    /api/okr/alignment
         returns: full company-wide alignment tree for current cycle
         role: Admin+

GET    /api/okr/member/:userId
         returns: all individual OKRs for a specific member
         role: Admin+ or own

GET    /api/okr/history/:entityType/:entityId
         returns: full change history for objective or KR
         role: Admin+

---

## 📊 Progress Calculation Rules (Non-Negotiable)

1. KR progress_pct = (current_value ÷ target_value) × 100 — capped at 100.00
2. BOOLEAN type: current_value = 0 → 0%, current_value = 1 → 100%
3. Objective progress_pct = average of all its Key Result progress_pct values
4. If Objective has child Objectives (via alignment_links), its progress = weighted average of own KRs + child objective progress
5. All recalculation happens server-side in okrService.js — never trust client-sent progress values
6. Every check-in submission triggers full recalculation chain bottom-up
7. KR status auto-updates: progress ≥ 100 → COMPLETED; progress < 30 and due_date within 7 days → OFF_TRACK; else ON_TRACK or AT_RISK (based on confidence field)

---

## 🖥️ Frontend Views (4 HTML Views)

### View 1: OKR Dashboard (okr-dashboard.html)
- Three sections: Company OKRs | Team OKRs | My OKRs
- Each Objective shown as card: title, cycle, progress bar (%), status badge
- Click Objective → drill into KRs
- Filter by cycle (Q1/Q2/H1/FY dropdown)
- Overall company health score shown at top (average of all COMPANY level objective progress)

### View 2: Objective Detail (okr-objective-detail.html)
- Objective title, description, owner, cycle, level badge
- Progress bar (auto-calculated %)
- List of all Key Results: title, type, current/target, progress bar, status badge
- "Add Key Result" button (Admin/owner only)
- "Submit Check-in" button per KR (assignee/Admin)
- Alignment tree: shows parent objective + child objectives
- History log at bottom (field changes)

### View 3: Check-in Modal (inline component in objective detail)
- Input: New Value (number/toggle for BOOLEAN)
- Confidence selector: HIGH | MEDIUM | LOW
- Note textarea (optional)
- Submit → immediately updates progress on screen
- Shows previous check-ins list below form

### View 4: OKR Alignment Tree (okr-alignment.html)
- Visual tree: Company Objectives at top → Team → Individual
- Each node: objective title + progress % + owner avatar
- Expandable/collapsible nodes
- Color coded: green (≥70%), yellow (40–69%), red (<40%)
- Admin only view

---

## ⚙️ Business Rules (Non-Negotiable)

1. Only ONE ACTIVE cycle can be the "current" cycle per company at a time — Admin sets current cycle in settings
2. Progress always calculated server-side — client never sends progress_pct directly
3. Check-ins are append-only — no editing or deleting past check-ins ever
4. KR target_value must be > 0 always — service-level enforce
5. BOOLEAN KR accepts only 0 or 1 as new_value — service rejects anything else
6. Objective cannot be deleted if it has any Key Results — must delete KRs first or archive Objective
7. Archived Objectives are read-only — no new KRs, no new check-ins
8. Member can only see own INDIVIDUAL objectives — Team and Company objectives visible to all
9. Performance data NEVER returned to Member-role API responses
10. All field changes auto-logged to okr_history
11. updated_at manually updated in service on every PATCH
12. Server-side RBAC — all role checks in service layer, never trust client-side role
13. AI may SUGGEST OKR templates but never auto-create or auto-publish OKRs — Admin must explicitly confirm

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations
- Create 5 tables
- Create 6 triggers
- Verify all triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: Objective Service + API
- okrService.js (objective CRUD + archive + tree)
- Objective routes + controller
- Alignment link creation
- Real HTTP tests
- Must pass before Layer 3 begins

### Layer 3: Key Result Service + API
- KR CRUD in okrService.js
- KR routes + controller
- History logging on every change
- Real HTTP tests
- Must pass before Layer 4 begins

### Layer 4: Check-in Service + Progress Recalculation
- Check-in submit in okrService.js
- Full bottom-up recalculation chain (KR → Objective → parent Objective)
- Auto KR status update logic
- Real HTTP tests with real value changes
- Must pass before Layer 5 begins

### Layer 5: Frontend (4 Views)
- OKR Dashboard
- Objective Detail + Check-in Modal
- Alignment Tree
- All views functional before Layer 6

### Layer 6: Integration + Full Test Suite
- End-to-end: create company OKR → add KRs → submit check-ins → verify progress rollup → verify alignment tree
- BOOLEAN KR test
- MILESTONE KR test
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 20 begins

---

## 📊 Test Scripts

scripts/verify-prd19-layer1.js        (DB + triggers)
scripts/verify-prd19-layer2.js        (Objective API)
scripts/verify-prd19-layer3.js        (Key Result API)
scripts/verify-prd19-layer4.js        (Check-in + Progress recalculation)
scripts/verify-prd19-layer5.js        (Frontend smoke)
scripts/verify-prd19-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [x] 5 tables created and verified
- [x] 6 triggers tested (append-only confirmed with real DB calls)
- [x] 18 API endpoints working with real HTTP calls
- [x] Progress recalculation chain verified end-to-end (real test)
- [x] BOOLEAN and MILESTONE KR types tested
- [x] Check-in append-only confirmed (real UPDATE/DELETE attempt blocked)
- [x] 4 frontend views functional
- [x] Alignment tree renders correctly
- [x] RBAC enforced server-side (real role-switch test)
- [x] All existing 469 tests still passing
- [x] Reverse Engineering Report submitted and confirmed
- [x] Honest Status Report submitted
- [ ] Admin GO-AHEAD received
- [ ] Committed to GitHub with message: feat(okr): PRD 19 complete

---

*PRD 19 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*