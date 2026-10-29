# PRD 16 — Dynamic Point-Pool + Multi-Member + Participation %

### Overview
PRD 16 expands the 4-stage pipeline architecture to natively support multiple concurrent contributors per role per project. It introduces a decentralized point-pool claim and lock mechanism, real-time stage and overall participation percentage tracking based on approved point weights, server-enforced participation threshold gates that block payouts for low contributors when a project goes live while preserving attribution, an audit-trailed administrative unblock workflow, and custom tool link management.

---

### New DB Tables

- **`pipeline_checklist_points`** (modified):
  - Added `claim_locked_by TEXT REFERENCES users(id)` to track the current assignee holding the lock.
  - Added `claim_locked_at TIMESTAMP` to establish the claim timestamp for abandonment calculations.
- **`point_pool_claims`** (new table, append-only):
  - Schema: `id TEXT PRIMARY KEY, point_id TEXT NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL, claimed_at TIMESTAMP, released_at TIMESTAMP, released_by TEXT, release_reason TEXT, created_at TIMESTAMP`.
  - Composite indexes on `(point_id)`, `(project_id)`, `(user_id)`, and `(claimed_at)`.
  - Protected by trigger `prevent_claim_delete` so claims history can never be deleted or purged.
- **`participation_thresholds`** (new table):
  - Schema: `id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, threshold_pct REAL NOT NULL DEFAULT 20.00, abandonment_days INTEGER NOT NULL DEFAULT 7, created_at TIMESTAMP, updated_at TIMESTAMP`.
  - Automatically created per project with sensible defaults (20.00% threshold, 7 days abandonment).
  - Frozen permanently against updates once project status transitions to `LIVE`.
- **`point_tool_links`** (new table):
  - Schema: `id TEXT PRIMARY KEY, point_id TEXT NOT NULL REFERENCES pipeline_checklist_points(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tool_name TEXT NOT NULL, tool_url TEXT NOT NULL, created_at TIMESTAMP, deleted_at TIMESTAMP`.
  - Enforces soft delete via `deleted_at`; queries filter `WHERE deleted_at IS NULL`.
- **`revenue_splits`** (modified):
  - Added `is_blocked INTEGER NOT NULL DEFAULT 0` to flag payouts withheld due to low participation.
  - Added `block_reason TEXT` documenting why revenue was blocked.
  - Added `unblocked_by TEXT REFERENCES users(id)` and `unblocked_at TIMESTAMP` for administrative audits.

---

### New DB Triggers

- **`prevent_claim_delete`**:
  - Attached to `point_pool_claims` table `BEFORE DELETE`.
  - Emits `RAISE(FAIL, 'Immutable ledger: DELETE not allowed on point_pool_claims')` to guarantee an inviolable audit record of all claims and releases.
- **`prevent_revenue_splits_update`** (updated):
  - Attached to `revenue_splits` table `BEFORE UPDATE`.
  - Keeps core financial fields strictly immutable (`amount`, `user_id`, `revenue_event_id`, `rule_applied`) while permitting server-side updates exclusively to participation gate fields (`is_blocked`, `block_reason`, `unblocked_by`, `unblocked_at`).

---

### New API Routes (13 total under `/api/pointpool`)

All routes mounted under `/api/pointpool` in `src/routes/pointPool.routes.js`:

| # | HTTP Method | Path | Auth & Role Requirements | Purpose |
|---|-------------|------|--------------------------|---------|
| 1 | `GET` | `/projects/:projectId/participation/me` | Authenticated Project Member | Fetches self stage & overall %, threshold, eligibility & atRisk status; triggers warning notification evaluation |
| 2 | `GET` | `/projects/:projectId/participation` | Authenticated Project Member | Returns participation array; Admins/Leads see all members, regular members see only self |
| 3 | `GET` | `/projects/:projectId/revenue-blocks` | Authenticated Admin | Lists all blocked revenue splits for the project with member and event details |
| 4 | `PATCH` | `/revenue-splits/:splitId/unblock` | Authenticated Admin | Unblocks revenue split; requires documented `reason` with ≥ 10 characters |
| 5 | `GET` | `/projects/:projectId/abandoned` | Authenticated Lead or Admin | Lists claimed points inactive past `abandonment_days` or released points awaiting reassignment |
| 6 | `GET` | `/projects/:projectId/pool` | Authenticated Project Member | Returns 4-stage point pool (`RESEARCH`, `DESIGN`, `DEV`, `TEST`) and participation summary |
| 7 | `GET` | `/projects/:projectId/threshold` | Authenticated Admin | Retrieves project participation threshold % and abandonment days |
| 8 | `PATCH` | `/projects/:projectId/threshold` | Authenticated Admin | Updates threshold % (0–100) and abandonment days (1–30); blocked if project is `LIVE` |
| 9 | `POST` | `/points/:id/tools` | Authenticated Project Member | Attaches a tool link (`tool_name`, `tool_url` starting with http/https) to a point |
| 10 | `GET` | `/points/:id/tools` | Authenticated Project Member | Retrieves active (non-deleted) tool links attached to a checklist point |
| 11 | `DELETE` | `/tools/:toolId` | Authenticated Tool Owner, Lead, or Admin | Soft-deletes a tool link by setting `deleted_at = CURRENT_TIMESTAMP` |
| 12 | `PATCH` | `/points/:id/claim` | Authenticated Project Member | Claims and locks a point; enforces role matching and prevents duplicate claims (409) |
| 13 | `PATCH` | `/points/:id/release` | Authenticated Lead or Admin | Releases a point back to UNCLAIMED; requires documented `reason` |

---

### New Frontend Views (4)

1. **Point Pool Board** (`public/point-pool-board.html`, `public/js/point-pool-board.js`):
   - 4-column responsive Kanban board (`RESEARCH`, `DESIGN`, `DEV`, `TEST`).
   - Cards display stage, title, point weight badge, assignee status, and embedded tool links.
   - Real-time role check on "Claim Point" buttons (disables mismatched roles).
   - Project Lead / Admin "Release Point" modal prompting for release justification.
   - Collapsible "Abandoned Points" drawer displaying dormant claims.

2. **Participation Dashboard** (`public/participation-dashboard.html`, `public/js/participation-dashboard.js`):
   - Top metrics overview highlighting "My Overall Participation %" and project threshold indicator.
   - Comprehensive multi-member participation breakdown table with dynamic status badges:
     - `ELIGIBLE` (Green): Overall participation ≥ threshold.
     - `AT RISK` (Amber): Within 10% of falling below threshold.
     - `REVENUE BLOCKED` (Red): Participation < threshold when project approved Live.
   - Admin-only Revenue Block Resolution panel allowing one-click unblocking with mandatory ≥ 10-char reason.

3. **Tool Links Panel** (`public/js/tool-links-panel.js`):
   - Inline component dynamically rendered inside checklist point cards.
   - "Connect your own tool" suggestion pills for Notion, GitHub, Figma, Jira, and Trello.
   - Quick-add form with protocol validation (`http://` or `https://`).
   - Active link listing with open-in-new-tab actions and soft-delete controls for owners/admins.

4. **Admin Threshold Settings** (`public/admin-threshold.html`, `public/js/admin-threshold.js`):
   - Project selector dropdown loading real projects.
   - Threshold % input (0.00% to 100.00%) and Abandonment Window input (1 to 30 days).
   - Real-time Live Project freeze banner disabling modifications once a project is approved Live.

---

### WebSocket Events (5)

All events emitted to specific user channels via `pushToUser` and persisted to the `notifications` table:

1. **`pointpool_point_claimed`**:
   - Trigger: Member successfully claims a checklist point.
   - Recipients: Project Lead, Admin, and other members of the same stage.
   - Payload: `{ type: 'pointpool_point_claimed', pointId, projectId, userId, username, stage, title, weight }`.

2. **`pointpool_point_released`**:
   - Trigger: Project Lead or Admin releases a point back to the pool.
   - Recipients: Original claimer and members of that stage.
   - Payload: `{ type: 'pointpool_point_released', pointId, projectId, releasedBy, originalClaimerId, reason }`.

3. **`pointpool_participation_warning`**:
   - Trigger: Member's participation drops or is computed below `threshold + 10%`.
   - Deduplication: Server checks for existing unread (`read_status = 0`) warning notification for `(user_id, project_id)` before inserting/emitting.
   - Recipients: At-risk member and Admin.
   - Payload: `{ type: 'pointpool_participation_warning', projectId, userId, currentPct, thresholdPct }`.

4. **`pointpool_revenue_blocked`**:
   - Trigger: `applyParticipationBlocks` executes when project transitions to `LIVE` and member participation < threshold.
   - Recipients: Blocked member and Admin.
   - Payload: `{ type: 'pointpool_revenue_blocked', projectId, userId, currentPct, thresholdPct, splitId }`.

5. **`pointpool_revenue_unblocked`**:
   - Trigger: Admin unblocks a revenue split with documented reason.
   - Recipients: Unblocked member.
   - Payload: `{ type: 'pointpool_revenue_unblocked', projectId, splitId, unblockedBy, reason }`.

---

### Business Rules (verbatim — non-negotiable)

- **Participation % Formula**:
  - Stage Participation:
    $$\text{member\_participation\_pct} = \frac{\sum(\text{APPROVED point weights claimed by member in stage})}{\sum(\text{ALL APPROVED point weights in stage})} \times 100$$
  - Overall Project Participation:
    $$\text{overall\_participation\_pct} = \frac{\sum(\text{APPROVED point weights claimed by member across all stages})}{\sum(\text{ALL APPROVED point weights in project across all stages})} \times 100$$
- **Default Threshold**:
  - `threshold_pct = 20.00%`, `abandonment_days = 7 days`.
- **Threshold Frozen After Project Goes LIVE**:
  - Once `projects.status = 'LIVE'`, `PATCH /api/pointpool/projects/:projectId/threshold` is strictly rejected with `HTTP 400` ("Cannot set threshold: project is already LIVE and threshold is frozen").
- **Block Affects Money Only — Never Attribution/Credit**:
  - When `is_blocked = 1`, payouts are withheld and withdrawals blocked in `payoutService.js`, but project member listings, task credits, and delivery history remain 100% visible and credited to the member.
- **Admin Can Override Block With ≥ 10 Char Documented Reason**:
  - Unblocking a revenue split requires `reason.trim().length >= 10`. The action records `unblocked_by`, `unblocked_at`, and notifies the recipient.
- **`auto_approve_below` Always = 0 (Hard-Blocked)**:
  - No automated bypass or auto-approval allows payouts below the threshold without manual administrative review and documented override.
- **Tool Integration: "Connect Your Own Tool" Only**:
  - Third-party tool suggestions (Notion, GitHub, Figma, Jira, Trello) are suggestion hints only. Platform never auto-connects or assumes credentials; links are user-provided URLs stored cleanly as pointers.

---

### Test Coverage

| Test Suite | File | Checks / Assertions | Result |
|------------|------|---------------------|--------|
| PRD 16 Layer 1 | `scripts/run-prd16-layer1-tests.js` | 48 checks | **48 / 48 PASS** |
| PRD 16 Layer 2 | `scripts/run-prd16-layer2-tests.js` | 62 checks | **62 / 62 PASS** |
| PRD 16 Layer 3 | `scripts/verify-prd16-layer3.js` | 29 checks | **29 / 29 PASS** |
| PRD 16 Layer 4 | `scripts/verify-prd16-layer4.js` | 30 checks | **30 / 30 PASS** |
| PRD 16 Layer 5 | `scripts/verify-prd16-layer5.js` | 29 checks | **29 / 29 PASS** |
| Core Regression | `npm test` | 13 test suites | **13 / 13 PASS** |
| Pipeline Step 15 | `scripts/run-step15-pipeline-tests.js` | 67 checks | **67 / 67 PASS** |
| PRD 16 Layer 6 (Integration) | `scripts/verify-prd16-layer6-integration.js` | 34 checks | **34 / 34 PASS** |
| **Total** | **All 8 Test Suites Combined** | **312 assertions** | **312 / 312 PASS (100%)** |

---

### Decisions Log Reference
Referenced in [docs/decisions.md](file:///F:/UserData/Downloads/MAHI%20TECH%20GROUP/docs/decisions.md):
- **Decision 9: PRD 16 Route Order Strictness & Server-Side RBAC Enforcement**:
  - Strict declaration of static Express sub-paths before parameterized paths in `src/routes/pointPool.routes.js`.
  - Member authorization and role matching derived strictly from database-backed session tokens (`req.user.id`), rejecting client-supplied role trust.
  - Server-side data isolation in `GET /participation` ensuring non-admin members receive only their own participation metrics.

---

### Commit Hash
Commit: `e8a7c6e` (`e8a7c6e3fc7e1d51aeb16576fa968f921473aeeb`)
*(Sealed permanently upon Git checkpoint commit)*
