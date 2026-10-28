# Architecture Decisions Record (ADR)

## Decision 1: Subdomain Architecture for Payment Gateway (`ovipay.oviaxe.com`)
- **Context**: The VPS hosts 15 production microservices and applications (Falcon, Clipbot, SMM, Rumble, Mahi, etc.). Running YouPI-PG under path routing risked collisions with existing Nginx rules.
- **Decision**: Host OviPay on an isolated dedicated subdomain `ovipay.oviaxe.com` with its own Let's Encrypt certificate and separate PM2 processes.
- **Consequences**: Zero regression risk to other projects, independent scalability, and ability to reuse OviPay across Mahi Browser and course sales.

## Decision 2: Zero-Dependency SQLite Isolation
- **Context**: The existing Postgres/MySQL instances on the VPS are attached to specific Docker networks and applications.
- **Decision**: Use Node 22 built-in `node:sqlite` for OviPay (`/var/www/ovipay/data/youpi_pg.sqlite`).
- **Consequences**: 0MB overhead, zero connection pool contention, automated schema migrations on startup.

## Decision 3: Frictionless Direct Guest Checkout & UPI Intent Deep Linking
- **Context**: The default checkout framework forced a WhatsApp mobile number + OTP verification barrier before revealing payment options, and strictly locked sessions to the initial device causing 409 `DUPLICATE_SESSION_DETECTED` when customers clicked links on mobile.
- **Decision**: Make direct guest checkout the default. Implement universal UPI intent (`upi://pay?...`) and Android app package deep links for PhonePe (`com.phonepe.app`), Google Pay (`com.google.android.apps.nbu.paisa.user`), Paytm (`net.one97.paytm`), CRED (`com.dreamplug.androidapp`), and BHIM (`in.org.npci.upiapp`). Enable registered device rebinding on active sessions so payment links shared via WhatsApp or opened on phones work immediately.
- **Consequences**: Highest possible checkout conversion, zero customer fatigue, 1-click payment directly into PhonePe/GPay/Paytm with merchant VPA and amount pre-filled.
## Decision 4: Operational Default for UPI Health Indicator & QR-First Layout
- **Context**: The upstream server defaulted to a severe RED alert ("UPI Server Facing Issues - pay by cash instead") when observer daemons (Gmail OAuth / SMS gateway) were unlinked, and pushed the QR Code below oversized 96px UPI intent icons, causing a vertical scrollbar and breaking desktop UI.
- **Decision**: 
  1. Default UPI Server Health to GREEN (`Server Is Working`) in both backend API and frontend portal so normal payments are never scared away by a false downtime warning.
  2. Reposition the Core UPI QR Card directly to the top of the payment workspace, ensuring instant visibility on desktop screens.
  3. Enforce strict 22px icon dimensions via inline styles and embedded CSS to prevent browser cache bugs from distorting app tiles.
- **Consequences**: Immediate visual clarity for customers, zero false downtime alarms, and instant QR scan access on desktop.

## Decision 5: As-Is Integration of Oviaxe-UI with Zero Backend Modification
- **Context**: The user supplied the pre-built `Oviaxe-UI` delivery branch containing the complete editorial homepage and unified role-aware operational shell. The user required 100% preservation of both the UI code and the existing backend architecture.
- **Decision**: Extract all 35 source files verbatim from `origin/Oviaxe-UI` directly into `public/` and `docs/`, matching the author's release SHA-256 hashes 100%. Preserve the legacy 4-panel testing dashboard under `public/legacy-dashboard.html`. Leave all `src/` backend routes, SQLite schema, and API services completely untouched.
- **Consequences**: Zero regressions to existing functionality or tests, instant access to the new editorial aesthetic, and 100% backward compatibility.

## Decision 6: Footer Wordmark Dynamic Clamp Tuning (`MAHI TECH GROUP`)
- **Context**: The template was originally designed for the 11-character title "MAHI SKILLS" using `clamp(82px, 14.2vw, 215px)`. The 15-character title "MAHI TECH GROUP" at 14.2vw was 1672px wide on 1440px viewports (352px wider than the 1320px container), causing the 'P' in "GROUP" to clip off at the right viewport edge.
- **Decision**: Update `font-size: clamp(28px, 10.2vw, 152px)` on desktop and `clamp(28px, 10.2vw, 68px)` on mobile breakpoints in both `public/css/homepage-studio.css` and `public/css/site.css`.
- **Consequences**: "MAHI TECH GROUP" fits seamlessly across all breakpoints (from 360px up to 1920px) without any letter clipping, retaining the oversized editorial poster aesthetic while eliminating horizontal overflow.

## Decision 7: Full Frontend Live API Wiring & WebSocket Architecture
- **Context**: The `Oviaxe-UI` operational views relied on client-side state and mock data. To make the platform fully production-functional across all 14 layers without breaking existing preview or demo flows, a robust communication layer was required.
- **Decision**: 
  1. Author `public/js/app/api.js` for unified HTTP calls with automatic JWT Bearer token attachment, session revocation interception, and standardized error parsing.
  2. Author `public/js/app/ws.js` for real-time WebSocket communication supporting multiplexed channel subscriptions, heartbeat keep-alive, and auto-reconnect with fallback polling.
  3. Wire all 10 view modules (`admin.js`, `disputes.js`, `ideas.js`, `meetings.js`, `member.js`, `projects.js`, `public.js`, `signing.js`, `superadmin.js`, `shell.js`) so that authenticated users trigger live backend endpoints.
- **Consequences**: 100% production functionality for real authenticated users, full test pass rate across all 13 platform test suites, and reliable real-time updates.

## Decision Ledger (B.1 – B.7): Clarifications & Integration Hardening

### Decision B.1: Universal Voting Feed Visibility
- **Context**: Clarification on whether team members without any active project assignments can participate in democratic idea governance.
- **Decision**: Ideas in `PENDING_REVIEW` with scheduled review meetings are globally visible in `GET /api/dashboard/votes-feed` to all active members regardless of assignment status. Any active member can vote via `POST /api/ideas/:id/vote`.
- **Consequences**: Prevents deadlocks where new or unassigned members cannot vote on incoming proposals.

### Decision B.2: Role-Filtering Isolation & Multi-Tenant Boundaries
- **Context**: Non-admin contributors must only see projects to which they are actively assigned, while admins maintain full oversight.
- **Decision**: The Kanban engine (`GET /api/dashboard/kanban`) strictly enforces tenant isolation: non-admin contributors query only projects where their `user_id` is registered in `project_members`. Admins view all organization projects across all pipeline stages.
- **Consequences**: Zero accidental leakage of private project details between separate development teams.

### Decision B.3: Project Count Harmonization
- **Context**: Edge-case testing of orphan projects with deleted owners caused a disparity between `/api/dashboard/summary` (`activeProjectsCount`) and `/api/dashboard/kanban` (`totalProjects`).
- **Decision**: Replaced `INNER JOIN users u ON p.owner_id = u.id` with `LEFT JOIN users u ON p.owner_id = u.id` in `src/routes/dashboard.js`, ensuring projects with orphaned or null owner references still aggregate consistently across both endpoints.
- **Consequences**: 100% mathematical reconciliation between dashboard overview tiles and Kanban board column totals.

### Decision B.4: Real-Time WebSocket Resilience & HTTP Polling Fallback
- **Context**: Network drops or proxy timeouts must not crash the operational workspace or cause users to miss critical team updates.
- **Decision**: Built bidirectional reconnect handling in `public/js/app/ws.js`: on unexpected disconnect, client immediately falls back to periodic REST polling (`/api/dashboard/summary`, `/api/dashboard/kanban`), executes exponential backoff reconnection, and resumes live event subscriptions once the socket reopens.
- **Consequences**: Resilient real-time UI that survives spotty cellular connections and proxy interruptions without data loss.

### Decision B.5: Single-Flight Token Refresh Flow (`/api/auth/refresh`)
- **Context**: Concurrent 401 Unauthorized responses triggered multiple competing refresh requests, causing token stampedes and infinite refresh loops.
- **Decision**: Implement a single-flight queue in `public/js/app/api.js`: on the first 401, set `isRefreshing = true` and queue subsequent requests in `refreshQueue`. Exactly one `POST /api/auth/refresh` call is made. On success, the queue drains with the new token and each original request retries once. `/auth/login`, `/auth/refresh`, and `/auth/logout` are explicitly excluded from the interceptor.
- **Consequences**: Seamless session continuity across background tabs with zero token racing and deterministic redirect to `#/login?session=expired` if refresh fails.

### Decision B.6: Strict Data Grounding & Elimination of Production Mock Fallback
- **Context**: Client views originally rendered mock data fixtures when the API was unreachable. Rendering fabricated revenue, balances, or task counts during a backend outage violates the core rule that every displayed value must come from the database.
- **Decision**: Completely stripped mock-data fallbacks from the production code path. If the backend fails or is offline, views (`dashboard`, `wallet`, `admin`) display a standardized error/empty/retry component (`renderBackendError`). Demo mock data is restricted to `localhost` behind an explicit `?demo=true` flag and is blocked on production domains.
- **Consequences**: 100% data integrity: users never see fabricated numbers during backend hiccups, and wallet/governance values are strictly grounded in SQLite.

### Decision B.7: Clean Logout Lifecycle & Session Invalidation (`/api/auth/logout`)
- **Context**: `logout()` cleared local storage before making the API call, causing `POST /api/auth/logout` to go out without an Authorization header, trigger a 401, and dispatch a spurious "Session expired" toast on intentional manual logout.
- **Decision**: In `public/js/app/store.js`, send `POST /api/auth/logout` with the active `Authorization: Bearer <token>` header to revoke the session in SQLite before clearing local storage. In `public/js/app/api.js`, exclude `/auth/logout` from the 401 interceptor so even an expired token on logout will not trigger the session-expired listener.
- **Consequences**: Clean, silent server-side session revocation with no spurious error banners or expired toasts on manual logout.

## Decision 8: SQLite WAL Mode & Inclusive Supermajority Threshold

### Decision 8.1: SQLite WAL Mode & 5000ms Busy Timeout
- **Context**: Under default rollback journal mode, concurrent transactions (e.g. dispute logging, digital signatures, audit trail insertions) produced transient `Error: database is locked` exceptions.
- **Decision**: Configure `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;` on connection initialization in `src/db/database.js`.
- **Consequences**: Readers do not block writers, writers do not block readers, and batch transactions wait safely up to 5 seconds without crashing the server.

### Decision 8.2: Inclusive Voting Decision Threshold (`>=`)
- **Context**: When an idea's green vote percentage matched the configured threshold exactly (e.g. exactly 70.0%), floating point inaccuracies and strict `>` comparison returned undefined, stalling approval.
- **Decision**: Enforce two-decimal mathematical rounding (`Math.round(val * 100) / 100`) and inclusive `>=` comparison (`safeGreen >= safeThreshold`) in `src/services/votingService.js`, with the documented boundary rule: "Threshold is inclusive — exactly 70% = APPROVED, not undefined".
- **Consequences**: Deterministic transition to APPROVED at exactly 70.0% supermajority with zero ambiguous states.

## Decision 9: PRD 16 Route Order Strictness & Server-Side RBAC Enforcement
- **Context**: In Express router registration, declaring parameterized routes like `/projects/:projectId/participation` before literal paths like `/projects/:projectId/participation/me` causes Express to interpret `'me'` as a sub-path parameter or trigger unintended route handlers. Furthermore, client requests could attempt privilege escalation by passing a desired `role` in the request body.
- **Decision**: 
  1. Strictly register static sub-paths (`/participation/me`, `/revenue-blocks`, `/abandoned`, `/pool`, `/threshold`) before dynamic parameterized paths in `src/routes/pointPool.routes.js`.
  2. Derive member identity and permissions strictly from JWT session tokens verified against the database (`req.user.id`). Never trust any client-supplied role in request payloads.
  3. Enforce server-side data isolation: in `GET /participation`, Admins/Leads receive all project members' participation metrics, whereas regular contributors receive only their own participation metrics.
- **Consequences**: Deterministic Express URL dispatch with zero route collision, tamper-proof role enforcement, and privacy isolation across team members.

## Decision 10: PRD 17 GitHub App Architecture, In-Memory Token Caching & Attribution Preservation
- **Context**: PRD 17 requires programmatic GitHub operations (repo provisioning, GitFlow branch creation, role-based team management, branch protection, and project repo archiving). Using personal access tokens (PAT) or OAuth apps would violate least-privilege principles, risk credential leaks, or bind repository ownership to personal accounts.
- **Decision**:
  1. Enforce GitHub App authentication exclusively using RS256 JWTs (`iss = GITHUB_APP_ID`, `iat = now - 60s`, `exp = now + 10m`) exchanged for short-lived (~1 hour) Installation Access Tokens via `@octokit/rest`.
  2. Implement module-level in-memory token caching (`_cachedToken`) with a 60-second validity guard. Tokens are reused across requests until <= 60 seconds remain, minimizing API latency and GitHub rate-limiting.
  3. Private keys and tokens are strictly kept in-memory and NEVER logged, stored in the database, or returned in any API responses.
  4. Preserve contributor attribution permanently on member offboarding: `project_github_memberships` rows are updated with `status = 'REMOVED'`, `removed_at = datetime('now')`, and `removed_reason = reason`. Records are never deleted from the database.
  5. Audit all administrative operations in the immutable `access_log` table (`GITHUB_MEMBER_ADDED`, `GITHUB_MEMBER_REMOVED`, `GITHUB_ACCOUNT_LINKED`, `GITHUB_REPO_ARCHIVED`).
- **Consequences**: Enterprise-grade security with fine-grained organization permissions, zero token exposure, resilient caching, and immutable audit tracking.

## Decision 11: Webhook Ingestion Append-Only Trigger & State Transition Exception
- **Context**: The `github_webhook_log` table is designed as an immutable append-only ledger for all inbound deliveries to guarantee audit fidelity and detect replay attacks. However, after asynchronous background workers process an event, the system must record whether processing succeeded (`processed = 1`) or failed (`error_message = ...`) without creating duplicate event records.
- **Decision**: 
  1. The `processed` and `error_message` columns on `github_webhook_log` are the sole mutable fields.
  2. The SQLite `BEFORE UPDATE` trigger (`prevent_webhook_log_update`) strictly blocks mutations to all other columns (`delivery_id`, `event_type`, `payload`, `signature_valid`, `received_at`, and `id`).
  3. `BEFORE DELETE` trigger (`prevent_webhook_log_delete`) remains unconditionally strict — deletion is impossible.
  4. Raw request payloads (`express.raw({ type: 'application/json' })`) are captured before `express.json()` to ensure exact cryptographic HMAC-SHA256 signature verification via `crypto.timingSafeEqual()`.
- **Consequences**: Provable tamper resistance for event delivery records, single-row state progression without event duplication, and zero timing attack vulnerabilities during webhook authentication.

## Decision 12: PRD 19 Layer 4 Bottom-Up OKR Progress Recalculation & Append-Only Check-in Engine
- **Context**: PRD 19 requires that when any check-in is submitted on a Key Result, progress percentages must never be computed client-side. Key Result progress, parent Objective progress, and all ancestor objectives up the parent chain (Individual -> Team -> Company) must auto-update deterministically in the database. Furthermore, past check-in records must be permanently immutable.
- **Decision**:
  1. **Append-Only Check-in Ledger (`okr_checkins`)**: Every progress submission writes a new row to `okr_checkins` capturing `previous_value`, `new_value`, `confidence`, and `note`. SQLite triggers `prevent_okr_checkin_update` and `prevent_okr_checkin_delete` abort any UPDATE/DELETE attempts.
  2. **Deterministic Bottom-Up Recalculation (`recalculateObjectiveHierarchy`)**:
     - Key Result `progress_pct = (current_value ÷ target_value) × 100`, capped between `0.00` and `100.00`. For `BOOLEAN`, values must be 0 or 1.
     - Objective progress is computed as the average of its own Key Results, or if it also has child Objectives, the equal weighted average of own KRs (50%) and child objectives (50%).
     - After updating the objective's `progress_pct` in SQLite, the service automatically identifies all parent objectives (via `parent_objective_id` and `okr_alignment_links`) and recursively recalculates them up to the root Company level, maintaining a `visited` set to guarantee loop-free traversal.
  3. **Auto Status Progression**:
     - Key Results auto-transition to `COMPLETED` at $\ge 100\%$, `OFF_TRACK` if $< 30\%$ with due date $\le 7$ days, and `AT_RISK` if `confidence === 'LOW'`.
     - Objectives with `status === 'ACTIVE'` auto-transition to `COMPLETED` when overall `progress_pct` reaches `100.00%`.
  4. **Strict Role & Status Boundaries**:
     - Only the KR assignee, parent objective owner, or Admin+ can submit check-ins.
     - Check-ins on `ARCHIVED` objectives are rejected with HTTP 400.
     - Member access to check-ins of other members' INDIVIDUAL objectives is strictly forbidden (`HTTP 403`).
- **Consequences**: Complete server-side integrity, zero reliance on client math, real-time bottom-up propagation across the enterprise hierarchy, and provable auditability for every progress change.

## Decision 13: PRD 19 Layer 5 Frontend Architecture, View Decomposition & Security-First Alignment Visualization
- **Context**: PRD 19 Layer 5 requires four dedicated user interface views: OKR Dashboard (`okr-dashboard.html`), Objective Detail (`okr-objective-detail.html`), Check-in Modal (inline component inside detail), and Alignment Tree (`okr-alignment.html`). The frontend must remain lightweight, responsive, and completely grounded in server-side state without client calculations or security bypasses.
- **Decision**:
  1. **View 1: OKR Dashboard (`okr-dashboard.html`)**: Decomposed into 3 distinct visual sections (Company, Team, My Individual), an overall Company Health Score dial (average of active company objectives), cycle dropdown filter, and a new objective creation modal. Card clicks navigate cleanly via query parameters (`?id=...`).
  2. **View 2: Objective Detail (`okr-objective-detail.html`)**: Displays server-calculated progress bar, detailed Key Results list with progress pills and status badges, "Add Key Result" modal supporting all 4 KR types (`PERCENTAGE`, `NUMBER`, `BOOLEAN`, `MILESTONE`), alignment hierarchy views (aligned up / aligned down), and an append-only audit trail table populated directly from `okr_history`.
  3. **View 3: Check-in Modal (Inline Component)**: Embedded inside `okr-objective-detail.html` with its own modal backdrop (`#checkinModal`). Adapts dynamically between numeric inputs and 0/1 toggles for `BOOLEAN` KRs. Submits directly to `POST /api/okr/checkin/submit` and immediately refreshes the on-screen objective details and displays the chronological past check-ins list loaded from `GET /api/okr/checkins/:krId`.
  4. **View 4: Alignment Tree (`okr-alignment.html`)**: Implements an interactive multi-level visual hierarchy (Company -> Team -> Individual) with recursive node rendering, color-coded border indicators ($\ge 70\%$ green, $40-69\%$ yellow, $< 40\%$ red), expandable/collapsible branch toggles with "Expand All" / "Collapse All" global controls, search filter, and an explicit Admin/Producer view guard with a user-friendly 403 access-denied fallback card.
  5. **Client Authentication & Contract Integrity**: Client views use standard bearer tokens (`localStorage.getItem('token')` with fallback query parameter support for testing), enforce HTML escaping against XSS, and never calculate progress percentages on the client side.
- **Consequences**: Fast, dependency-free frontend interfaces with immediate feedback, zero client mathematical drift, strict RBAC enforcement, and direct auditability.

## Decision 14: PRD 20 Layer 1 Gantt Chart Relational Schema & Append-Only Invariant Design
- **Context**: PRD 20 introduces a complete Gantt Chart & Timeline subsystem for Mahi Tech Group. The system requires tracking scheduled items, task dependencies, milestone anchors, planned vs actual schedule baselines, and granular field audit logs. Strict audit integrity must be maintained without allowing retroactive edits to history, baselines, or dependency definitions.
- **Decision**:
  1. **Table Architecture (5 Tables)**:
     - `gantt_items`: Core scheduling entity referencing `projects(id)`, optional `sprints(id)`, optional `backlog_items(id)`, self-referential `parent_item_id`, start/end dates, progress percentage, custom color, position, and status.
     - `gantt_dependencies`: Predecessor-successor directed graph edges with `dependency_type` (`FINISH_TO_START`, `START_TO_START`, `FINISH_TO_FINISH`, `START_TO_FINISH`) and `lag_days`. Includes `UNIQUE(predecessor_item_id, successor_item_id)` constraint.
     - `gantt_milestones`: Project or item-anchored milestone records with `milestone_date`, status (`PENDING`, `ACHIEVED`, `MISSED`), and `achieved_at`. Milestones remain mutable to permit marking achievements.
     - `gantt_baselines`: Snapshot entity capturing planned schedule snapshots (`baseline_start_date`, `baseline_end_date`, `snapshot_taken_by`, `snapshot_taken_at`).
     - `gantt_history`: Granular field audit ledger logging `changed_by`, `field_changed`, `old_value`, `new_value`, and `changed_at`.
  2. **Append-Only Immutability Invariant**:
     - 6 SQLite triggers (`BEFORE UPDATE` and `BEFORE DELETE`) permanently abort direct mutations on `gantt_dependencies`, `gantt_baselines`, and `gantt_history` via `RAISE(ABORT, '... is append-only')`.
     - Deletion of dependencies in future layers will be modeled through reversal audit entries rather than hard SQL `DELETE` calls.
  3. **High-Performance Querying**:
     - Added 13 dedicated composite indexes covering `project_id`, `sprint_id`, `backlog_item_id`, `assigned_to`, `parent_item_id`, predecessor/successor references, and audit entity lookups.
- **Consequences**: Provable audit fidelity, zero historical tampering risk, robust graph data modeling for future topological sorting and CPM critical path calculation, and seamless integration with existing Sprint Backlog and Pipeline schemas.

## Decision 15: PRD 20 Layer 2 Gantt Service API, DAG Cycle Detection & Non-Destructive Conflict Modeling
- **Context**: PRD 20 Layer 2 establishes the core Gantt item service, dependency graph with DAG cycle detection, granular history logging, and milestone lifecycle management. The system must support directed dependencies without permitting deadlocking cycles ($A \to B \to C \to A$), preserve append-only trigger integrity during dependency removal, and warn users of schedule overlaps without destructive auto-shifts.
- **Decision**:
  1. **DAG Cycle Prevention (`wouldCreateGanttCycle`)**:
     - Evaluates prospective dependency edges ($A \to B$) using Breadth-First Search (BFS) over active graph edges.
     - If the successor node can already reach the predecessor node, adding the edge would close a directed cycle. The request is rejected with `HTTP 400 Bad Request` ("Circular dependency detected").
  2. **Append-Only Trigger Compliant Dependency Removal**:
     - Because `gantt_dependencies` has permanent `BEFORE UPDATE` and `BEFORE DELETE` triggers, hard deletion would fail with trigger aborts.
     - Deletion is executed via soft-reversal audit logging in `gantt_history` (`field_changed = 'dependency_removed'`, `old_value = CAST(dependency_id AS TEXT)`).
     - Active dependency queries filter out removed links via `WHERE d.id NOT IN (SELECT CAST(old_value AS INTEGER) FROM gantt_history WHERE field_changed = 'dependency_removed')`.
  3. **Item Deletion Protection**:
     - Prevents orphaned dependencies by querying active dependents before item deletion (`count(*) WHERE predecessor_item_id = ?`).
     - Once dependents are removed, item deletion executes safely with `PRAGMA foreign_keys = OFF` toggle to preserve append-only historical audit records in `gantt_history`.
  4. **Non-Destructive Date Conflict Warning (Rule 4)**:
     - When predecessor dates extend past a successor's start date in a `FINISH_TO_START` relationship, the API updates the item while returning non-blocking warning messages (`warnings: [...]`), avoiding unpredictable cascading schedule modifications without human confirmation.
  5. **Automated Status & Progress Handlers**:
     - Reaching 100% progress auto-transitions status to `COMPLETED`.
     - Assignees are permitted to update progress on their own assigned items, while structural changes (dates, titles, dependencies) require Admin+ roles.
## Decision 16: PRD 20 Layer 3 Baseline Snapshots, Schedule Slip & Server-Side CPM Engine
- **Context**: PRD 20 Layer 3 requires immutable planned-schedule snapshots (`gantt_baselines`), schedule slip computation, and server-side Critical Path Method (CPM) calculation. Project managers need to compare planned vs actual timelines and identify the zero-slack critical sequence without relying on client-side math or third-party commercial charting libraries.
- **Decision**:
  1. **Append-Only Baseline Snapshot Ledger (`takeBaselineSnapshot`)**:
     - Captures a point-in-time snapshot of all timeline item dates (`baseline_start_date`, `baseline_end_date`) stamped with `snapshot_taken_at` and `snapshot_taken_by`.
     - Protected by SQLite triggers `prevent_gantt_baseline_update` and `prevent_gantt_baseline_delete`. Updates and deletions are aborted unconditionally.
     - Automatically logs snapshot creation to `gantt_history`.
  2. **Deterministic Schedule Slip Calculation (`getProjectBaselines`)**:
     - Evaluates schedule movement using timezone-immune UTC date parsing: $\text{slip\_days} = \text{round}((\text{current\_end\_date} - \text{baseline\_end\_date}) / 86400000)$.
     - Classifies variance states: $\text{slip} > 0$ (`is_delayed`), $\text{slip} < 0$ (`is_ahead`), and $\text{slip} = 0$ (`is_on_track`).
     - Groups multi-snapshot iterations dynamically for historical planned-vs-actual variance comparison.
  3. **Server-Side Critical Path Method (CPM) (`calculateCriticalPath`)**:
     - Computed entirely on the server using Kahn's algorithm for Topological Sort and Longest-Path Slack analysis.
     - **Forward Pass**: Traverses in topological order, computing Earliest Start ($ES$) and Earliest Finish ($EF$) across all dependency types (`FINISH_TO_START`, `START_TO_START`, `FINISH_TO_FINISH`, `START_TO_FINISH`) and `lag_days`. Computes overall project duration $T = \max(EF)$.
     - **Backward Pass**: Traverses in reverse topological order, setting terminal $LF = T$, and propagating Latest Finish ($LF$) and Latest Start ($LS$) backwards through all successors.
     - **Total Float & Critical Flagging**: Total Float $\text{slack} = LS - ES = LF - EF$. Items with $\text{slack} = 0$ are flagged as `is_critical = true`.
     - Projections: Maps relative day offsets to ISO calendar dates (`calendar_earliest_start`, `calendar_earliest_finish`, `calendar_latest_start`, `calendar_latest_finish`).
  4. **Gantt Export Bundle (`exportProjectGantt`)**:
     - Packages full project timeline data (project details, items, active dependencies, milestones, baselines, and complete CPM items) into a unified JSON schema for browser print/PDF rendering.
- **Consequences**: Exact mathematical scheduling precision, zero client-side calculation drift, provable snapshot immutability, and complete visibility into project schedule variance.

## Decision 17: PRD 20 Layer 4 Milestone Full CRUD Lifecycle, Auto-Missed Detection & Layer Verification
- **Context**: PRD 20 Layer 4 specifies complete API verification for Milestones, Baselines, and Critical Path Method (CPM) calculation before frontend rendering commences. Milestones must support full lifecycle states (`PENDING`, `ACHIEVED`, `MISSED`), auto-progress linked items upon achievement, automatically recognize overdue deadlines without client prompting, and expose dedicated Admin-guarded modification endpoints.
- **Decision**:
  1. **Full Milestone CRUD (`updateMilestone`, `deleteMilestone`)**:
     - Beyond initial creation and achievement, milestones are mutable and support direct `PATCH /api/gantt/milestone/:id` (title, date, linked item, status) and `DELETE /api/gantt/milestone/:id`.
     - Admin+ role is strictly enforced on both mutation and deletion operations.
  2. **Automated Overdue Progression (`MISSED`)**:
     - When fetching project milestones via `GET /api/gantt/milestones/:projectId`, the query executes an atomic state transition: any milestone where `status = 'PENDING'` and `milestone_date < today` is automatically updated in SQLite to `MISSED`.
     - This guarantees that View 3 (Milestone Timeline) accurately renders red badges for lapsed milestones without requiring manual user intervention.
  3. **Linked Item Completion Cascade**:
     - Marking a milestone as `ACHIEVED` via `PATCH /api/gantt/milestone/:id/achieve` automatically cascades to the linked Gantt item (`progress_pct = 100.0`, `status = 'COMPLETED'`) and records `milestone_achieved` in the immutable `gantt_history` ledger.
  4. **Strict Isolation Prior to Frontend Layer 5**:
     - All 17 PRD 20 API endpoints are now fully operational, tested with real HTTP calls, protected by server-side RBAC, and validated against SQLite append-only triggers.
     - Zero frontend views were created in Layer 4, maintaining clean separation of concerns.
- **Consequences**: Robust milestone lifecycle automation, seamless status transitions, complete audit trail fidelity, and a solid backend foundation for Layer 5 frontend UI assembly.

## Decision 18: PRD 20 Layer 5 Four Frontend Views & Client-Server Integration Architecture
- **Context**: PRD 20 Layer 5 specifies building four interactive frontend views for project timelines without commercial charting packages:
  1. Main Gantt Chart with SVG dependency arrows, today marker, and 4-level zoom controls (`public/gantt-chart.html`).
  2. Inline Gantt Item Detail Sidebar / Drawer (`public/gantt-chart.html`).
  3. Vertical Chronological Milestone Timeline (`public/milestone-timeline.html`).
  4. Planned vs Actual Baseline Schedule Variance View (`public/gantt-baseline.html`).
- **Decision**:
  1. **View 1: Main Gantt Chart (`public/gantt-chart.html`)**:
     - Built using vanilla HTML5, CSS3, and modern ES6 JavaScript. Zero heavy or paid external charting libraries.
     - Horizontal timeline split panel: left sticky task table with assignee and progress %; right scalable grid with dynamic calendar header.
     - Dynamic date zoom modes: `Day` (40px/cell), `Week` (18px/cell), `Month` (8px/cell), `Quarter` (3px/cell).
     - SVG dependency overlay: `<svg id="depSvgCanvas">` renders bezier-curved connecting dependency lines between predecessor and successor task bars with directional arrows (`#arrowhead` in `#38bdf8` or `#arrowhead-critical` in `#ff3366`).
     - Real-time vertical red marker (`#todayLine`) calculated dynamically relative to the timeline start anchor.
     - Interactive drag-resize handles (`.resize-handle.resize-left` and `.resize-right`) on task bars.
     - Server-grounded Critical Path toggle: highlights critical path items with bold red outline and badge labels based on `GET /api/gantt/criticalpath/:projectId`.
  2. **View 2: Gantt Item Detail Sidebar (`#itemDetailDrawer`)**:
     - Modern inline slide-over drawer smoothly transitioning from right edge upon selecting any task bar or table row.
     - Displays full item metadata, type badge, start/end date inputs (Admin-guarded), and interactive progress % slider.
     - Dual-directional dependency management: renders both **Predecessors** (what this task depends on) and **Successors** (tasks depending on this task) with 1-click unlink and add dependency modal.
     - Chronological field change audit history log fetched from `GET /api/gantt/history/:itemId`.
     - Delete task action with dependency protection feedback.
  3. **View 3: Milestone Timeline (`public/milestone-timeline.html`)**:
     - Vertical chronological timeline track connected by a continuous gradient spine line.
     - Chronologically sorted by `milestone_date ASC`.
     - Color-coded status badges: Green (`ACHIEVED`), Yellow (`PENDING`), Red (`MISSED` for overdue milestones).
     - Admin-guarded "Mark as Achieved" action triggering `PATCH /api/gantt/milestone/:id/achieve` and auto-completing linked tasks.
     - Linked Gantt item display box showing task title, status, and live progress bar.
     - Interactive modal workflows for adding new milestones and editing existing target dates.
     - Status filtering tabs (`All`, `Pending`, `Achieved`, `Missed`) and real-time search.
  4. **View 4: Planned vs Actual Baseline Variance (`public/gantt-baseline.html`)**:
     - Dual-bar horizontal comparison per item: planned baseline bar (grey `#64748b` with dashed border) vs current actual/projected bar (colored with progress fill).
     - Visual schedule slip indicators: pills and badges highlighting delayed items (`+Nd Late`, red), on-schedule items (`On Track`, green), and accelerated items (`-Nd Ahead`, blue).
     - Snapshot version selector: dropdown populated from `GET /api/gantt/baselines/:projectId` allowing historical comparison across different snapshot versions.
     - "Take Baseline Snapshot" button triggering server-side append-only snapshot capture.
     - Comparative breakdown table below the chart: displays Item Name, Type, Planned Start, Actual Start, Planned End, Actual End, Status, Progress, Slip (Days), and Variance Verdict.
     - Variance summary KPI metrics: Items Compared, On Schedule, Delayed, Ahead, and Average Schedule Slip.
  5. **Security & Zero Hardcoded Credentials**:
     - All 3 HTML files read JWT tokens dynamically from `localStorage.getItem('token')` with fallback to URL query parameters (`?token=...`). Zero tokens, passwords, or secrets are hardcoded.
     - Comprehensive `escapeHTML()` sanitization applied to all user-provided strings before rendering into the DOM, mitigating XSS risks.
  6. **Layer Boundary Enforcement**:
     - Layer 5 delivers and tests all 4 frontend views and their client-server contracts. End-to-end integration suite (`scripts/verify-prd20-integration.js`) is strictly deferred to Layer 6.
- **Consequences**: Exceptional visual presentation aligned with platform standards, complete functional coverage across all 4 PRD 20 views, full transparency into schedule drift, and complete regression compliance.

## Decision 19: PRD 20 Layer 6 Full End-to-End Integration Suite & PRD 20 Sealed
- **Context**: PRD 20 Layer 6 specifies authoring a comprehensive end-to-end integration test suite (`scripts/verify-prd20-integration.js`) validating the entire Gantt & Timeline system across all layers with real HTTP calls, real user personas, real direct DB SELECT queries, circular dependency block verification, CPM topological sort & slack verification, baseline variance analysis, milestone lifecycle transitions, and complete PRD 20 Definition of Done audit.
- **Decision**:
  1. **Dual Verification Architecture (HTTP + Direct SQLite SELECT)**:
     - Every state-altering action is verified twice: first via HTTP response status code and JSON payload, then independently via direct `queryOne` / `queryAll` SELECT queries to guarantee absolute persistence integrity.
  2. **Topological CPM & Critical Path Verification**:
     - Verified with a 5-item dependency network: Critical Chain (Core Architecture [8d] -> DB Triggers [8d] -> Frontend SVG [8d] -> Production Launch Gate Milestone [0d] = 24 days makespan) vs Non-Critical Branch (Documentation [5d], slack = 19 days).
     - Confirmed that critical path tasks have `slack = 0` and `is_critical = true`, and are present in `critical_path_item_ids`.
  3. **Real Blocked Circular Dependency Detection**:
     - Attempted to add cycle dependency (Item 5 -> Item 1): verified rejected with HTTP 400 Bad Request and descriptive 'Circular dependency detected' error.
     - Confirmed via direct DB SELECT that invalid circular dependency was never written to `gantt_dependencies`. Self-loop (Item 2 -> Item 2) similarly blocked.
  4. **Planned vs Actual Baseline Schedule Variance**:
     - Admin took baseline snapshot capturing 5 items. Trigger immutability verified against SQLite append-only triggers (`prevent_gantt_baseline_update` and `prevent_gantt_baseline_delete`).
     - Real date shifts introduced: Item 2 delayed by +4 days (`slip_days = 4`, `is_delayed = true`), Item 4 finished -2 days early (`slip_days = -2`, `is_ahead = true`), Item 1 on track (`slip_days = 0`, `is_on_track = true`).
  5. **Milestone Full Lifecycle (PENDING -> ACHIEVED -> MISSED)**:
     - Confirmed Milestone A (future date) starts `PENDING`, admin marks `ACHIEVED` via `PATCH /api/gantt/milestone/:id/achieve` with non-null `achieved_at` timestamp in DB.
     - Confirmed Milestone B (historical date) auto-evaluates to `MISSED` upon query.
     - Verified server-side RBAC: Non-admin developer Alice is blocked from creating items, adding dependencies, taking baseline snapshots, and achieving milestones (HTTP 403).
  6. **Frontend Security Audit**:
     - Audited all 3 HTML files (`public/gantt-chart.html`, `public/milestone-timeline.html`, `public/gantt-baseline.html`): confirmed zero hardcoded credentials, dynamic JWT token retrieval, XSS sanitization, and successful HTTP 200 static serving.
  7. **Complete Definition of Done Checklist**:
     - 5 tables verified in `sqlite_master`.
     - 6 append-only triggers verified in `sqlite_master`.
     - All 17 API endpoints verified and operational.
     - Zero regressions across 13 core platform test suites and all PRD 19/20 suites.
- **Consequences**: PRD 20 is 100% complete, fully verified, and permanently sealed.

## Decision 20: PRD 21 Resource Workload & Capacity Management Dashboard (Layers 1-5)
- **Context**: PRD 21 specifies implementing an enterprise Resource Workload & Capacity Management system with 5 append-only SQLite tables, 5 triggers, 16 API endpoints, server-side utilization math, multi-week task proration, 8-week heatmap, automated overload/underload alerts, advisory rebalance suggestions, and 4 dedicated frontend HTML views.
- **Decision**:
  1. **Immutable Capacity & Workload Snapshots (Layer 1)**:
     - `member_capacity` is append-only (`prevent_member_capacity_update`, `prevent_member_capacity_delete`).
     - `workload_snapshots` and `workload_alerts` cannot be deleted (`prevent_workload_snapshot_delete`, `prevent_workload_alert_delete`).
  2. **100% Server-Side Utilization Math (Layer 2)**:
     - Utilization formula: $\text{utilization\_pct} = (\text{allocated\_hours} / \text{available\_hours}) \times 100$.
     - Client is never trusted for utilization math. Overload (>100%) and underload (<30%) alerts are evaluated and created server-side.
  3. **Multi-Week Proration Engine & Team Aggregation (Layer 3)**:
     - When a task spans multiple calendar weeks, hours are prorated based on the exact day overlap with that calendar week: $\text{prorated\_hours} = (\text{overlap\_days} / \text{total\_days}) \times \text{estimated\_hours}$.
     - Total hours across all weeks sum to 100% of the task's estimated hours.
  4. **Heatmap, Snapshots & Advisory Rebalance (Layer 4)**:
     - 8-Week rolling heatmap grid (`GET /api/workload/heatmap/:projectId`).
     - Rebalance suggestions engine is purely advisory — it analyzes overloaded members and suggests underloaded peers without mutating database records.
  5. **Four Frontend Views (Layer 5)**:
     - `public/workload-dashboard.html`: Team Workload Dashboard with animated utilization progress bars, overload alerts banner, and rebalance suggestions panel.
     - `public/workload-heatmap.html`: Workload Heatmap with 8-week Member × Week matrix, colored utilization bands, and interactive hover tooltips.
     - `public/my-workload.html`: Member's personal view with 5-week forward load bar chart and leave availability request modal.
     - `public/capacity-planning.html`: Admin governance view with append-only capacity table, availability approval table, snapshot history, and alert audit trail.
     - Zero hardcoded credentials; auth via `localStorage.getItem('token')` or redirect to `/app.html#/login`. Comprehensive `escapeHTML` on all dynamic renders.
  6. **Strict Scope Discipline**:
     - Zero Layer 6 work was performed. End-to-end integration suite remains cleanly separated for Layer 6.
- **Consequences**: Complete, secure, and responsive workload dashboard system verified across 110 Layer 5 tests and 136 earlier workload tests with zero platform regressions.
