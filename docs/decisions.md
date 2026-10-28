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

## Decision 21: PRD 21 Layer 6 Full End-to-End Integration Suite & PRD 21 Sealed
- **Context**: PRD 21 Layer 6 mandates a comprehensive end-to-end integration test suite (`scripts/verify-prd21-integration.js`) evaluating the entire Resource Workload & Capacity Management Dashboard system across all layers. The suite requires real HTTP calls, real user personas (Admin and Member), direct SQLite SELECT queries, trigger immutability enforcement, real proration and availability deduction math, live 8-week heatmap matrix verification, auto-alert workflow, advisory rebalance immutability confirmation, and full audit of the PRD 21 Definition of Done checklist.
- **Decision**:
  1. **Dual Verification Architecture (Real HTTP + Direct SQLite SELECT)**:
     - Every capacity change, leave approval, assignment creation, alert acknowledgment, and snapshot capture is validated via HTTP 200/201 response and independently corroborated with direct SQLite `queryOne` / `queryAll` assertions.
  2. **Append-Only Immutability & Trigger Verification**:
     - Tested triggers `prevent_capacity_update`, `prevent_capacity_delete`, `prevent_workload_snapshot_update`, `prevent_workload_snapshot_delete`, and `prevent_workload_alert_delete`. Confirmed database aborts any direct UPDATE or DELETE operations.
  3. **Multi-Week Proration & Conservation of Hours**:
     - Verified multi-week assignment spanning 10 calendar days with 40 estimated hours. Proved server-side calculation: Week 1 gets 28.00 hrs (7/10 days), Week 2 gets 12.00 hrs (3/10 days), Week 3 gets 0.00 hrs. Sum equals 40.00 hrs with 100% mathematical conservation.
  4. **8-Week Rolling Heatmap Matrix & Status Thresholds**:
     - Verified `GET /api/workload/heatmap/:projectId` yields 8 rolling calendar week headers and member grid rows with 8 cells each.
     - Confirmed status bands: `UNDERLOADED` (<30%), `OPTIMAL` (30-85%), `NEAR_CAPACITY` (85-100%), and `OVERLOADED` (>100%).
  5. **Advisory Rebalance Engine (Zero Database Mutation)**:
     - Proved that `GET /api/workload/rebalance/:projectId` is strictly advisory. Identified overloaded member and suggested underloaded target peers with simulated post-rebalance utilization impact.
     - Confirmed via direct SQLite SELECT that the original task assignment was NOT mutated by the suggestion query. Verified admin applies reassignments explicitly via `PATCH /api/workload/assignment/:id`.
  6. **Frontend Security & Credential Hygiene**:
     - Audited all 4 HTML files (`workload-dashboard.html`, `workload-heatmap.html`, `my-workload.html`, `capacity-planning.html`): confirmed zero hardcoded credentials or passwords, dynamic token retrieval from `localStorage`, and `escapeHTML()` XSS protection across all dynamic templates.
  7. **Complete PRD 21 Definition of Done Verdict**:
     - All 5 tables verified in `sqlite_master`.
     - All 5 append-only triggers verified in `sqlite_master`.
     - All 16 workload API endpoints operational.
     - Zero regressions across 13 core platform test suites and all PRD 19, 20, 21 suites.
- **Consequences**: PRD 21 (Resource Workload & Capacity Management Dashboard) is 100% complete, fully verified, and permanently sealed.

## Decision 22: PRD 22 Layer 1 Database Schema, Immutability Triggers & Active Timer Lock Table
- **Context**: PRD 22 mandates a production-grade Time Tracking & Timesheet Management System. Layer 1 requires 6 new tables, 13 performance and integrity indexes, 8 append-only triggers, strict WAL mode with `busy_timeout=5000`, single active timer concurrency locking, and zero mock shortcuts.
- **Decision**:
  1. **Dual Schema Migration Architecture**:
     - Embedded `TIME_TRACKING_SCHEMA_SQL` in `src/db/database.js` ensuring fresh databases automatically initialize all 6 tables, 13 indexes, and 8 triggers upon `getDatabase()` invocation.
     - Synchronized `src/db/schema.sql` with canonical PRD 22 DDL definitions.
     - Added Step 22 incremental migration block to `src/db/migrate.js` for existing environments.
  2. **6 Production Tables**:
     - `time_entries`: Core work log supporting both TIMER and MANUAL source types, polymorphic source references (`BACKLOG_ITEM`, `GANTT_ITEM`, `PIPELINE_POINT`), billable snapshot rates/amounts, and approval states (`PENDING`, `APPROVED`, `REJECTED`).
     - `time_entry_history`: Immutable audit trail tracking every modification to time entries (`old_value`, `new_value`, `field_changed`, `changed_by`).
     - `billable_rates`: Append-only billing rates supporting `MEMBER_DEFAULT` and `PROJECT_OVERRIDE` hierarchies with temporal validity (`effective_from`, `effective_to`).
     - `active_timers`: Dedicated concurrency lock table with `user_id INTEGER NOT NULL UNIQUE` enforcing at the SQLite schema level that a user can never run more than one active timer concurrently.
     - `time_approval_requests`: Append-only timesheet approval audit records.
     - `time_report_snapshots`: Append-only frozen JSON report snapshots for audit and archival.
  3. **8 Immutability Triggers**:
     - Authored and verified triggers blocking UPDATE and DELETE on `time_entry_history`, `billable_rates`, `time_approval_requests`, and `time_report_snapshots`.
  4. **Active Timer Concurrency Architecture**:
     - While `time_entries` tracks the time record with `end_time IS NULL`, the `active_timers` table acts as a transactional lock with a UNIQUE constraint on `user_id`. Attempting to start a second timer triggers an instant SQLite UNIQUE constraint violation, preventing race conditions.
- **Consequences**: Rock-solid relational foundation for time tracking, verified by 100/100 passing tests in `scripts/verify-prd22-layer1.js` with zero regressions.

## Decision 23: PRD 22 Layer 2 Timer Service, Concurrency Locking & Priority Rate Resolution Hierarchy
- **Context**: PRD 22 Layer 2 mandates the complete Timer Service, API endpoints (`/api/time/timer/start`, `/api/time/timer/stop`, `/api/time/timer/status`), strict single active timer concurrency locking, overlap detection, point-in-time billable rate snapshotting, 24-hour manual edit window rules, and dangling timer auto-closure.
- **Decision**:
  1. **Dual-Layer Concurrency Locking (Code + Database Engine)**:
     - Implemented `active_timers` table as a high-performance transactional lock table.
     - Application service performs an upfront check for active locks returning clean `409 Conflict` ("User already has an active running timer").
     - Simultaneously, `active_timers (user_id INTEGER NOT NULL UNIQUE)` protects against race conditions at the SQLite engine level.
  2. **Point-in-Time Billable Rate Resolution Hierarchy**:
     - Resolution strictly follows PRD 22 priority order:
       1. `PROJECT_OVERRIDE` for `(user_id, project_id)`
       2. `PROJECT_OVERRIDE` project-wide default (`user_id IS NULL`)
       3. `MEMBER_DEFAULT` for `user_id`
       4. Fallback `0.0 INR`
     - Evaluates temporal bounds (`effective_from <= targetDate` and `effective_to IS NULL OR >= targetDate`).
     - Snapshots rate and amount permanently at entry creation and close time, preventing future rate changes from mutating past records.
  3. **Timer Stop & Server-Side Math Precision**:
     - Duration calculated server-side: `ROUND((end_time - start_time) / 60000)`.
     - Billable amount calculated: `(duration_minutes / 60) * billable_rate`.
     - Active timer lock deleted upon stop (`DELETE` explicitly permitted on `active_timers`).
     - Manually sets `updated_at` on every SQLite `UPDATE` to `time_entries`.
  4. **Append-Only Immutability & Audit Logging**:
     - All status changes and column modifications (`end_time`, `duration_minutes`, `billable_amount`) write immutable change entries to `time_entry_history`.
  5. **Dangling Timer Auto-Close Cron**:
     - Implemented `autoCloseDanglingTimers()` auto-closing any active timer that ran past 23:59:59 of its starting day, writing 23:59:59 as `end_time` and clearing the lock.
- **Consequences**: Production-ready, mathematically rigorous timer tracking architecture verified by 59/59 passing tests in `scripts/verify-prd22-layer2.js` and 100/100 Layer 1 tests with zero platform regressions.

## Decision 24: PRD 22 Layer 3 Manual Time Entry, 24-Hour Edit Window & Mandatory Soft-Delete Architecture
- **Context**: PRD 22 Layer 3 mandates manual time entry creation (`POST /api/time/entry/create`), time entry updates (`PATCH /api/time/entry/:entryId`), deletion (`DELETE /api/time/entry/:entryId`), personal query filtering (`GET /api/time/entries/my`), and project-wide query filtering (`GET /api/time/entries/project/:projectId`). A key architectural challenge arose with DELETE: `time_entry_history.entry_id` maintains an explicit FOREIGN KEY to `time_entries(id)` and is guarded by an append-only trigger (`prevent_time_history_delete`). Hard deleting from `time_entries` would either violate foreign key constraints under `PRAGMA foreign_keys = ON;` or break relational audit integrity.
- **Decision**:
  1. **Mandatory Soft-Delete Implementation**:
     - Deletion is strictly Admin-only (`isAdmin(currentUser)`), rejecting non-admin attempts with `403 Forbidden`.
     - Deletion performs a soft delete by updating `status = 'DELETED'` and manually updating `updated_at = datetime('now')`.
     - Zero hard deletes are performed on `time_entries`, preserving 100% referential integrity with `time_entry_history`.
     - `PRAGMA foreign_keys = OFF` is strictly avoided across the entire service.
     - Full audit trail is written to `time_entry_history` before status update: `field_changed = 'status', new_value = 'DELETED'` and `field_changed = 'deletion_reason', new_value = reason`.
  2. **Soft-Deleted Row Filtering by Default**:
     - `getMyTimeEntries` and `getProjectTimeEntries` exclude rows with `status = 'DELETED'` by default (`WHERE te.status != 'DELETED'`), maintaining clean user dashboards while retaining immutable historical records in SQLite.
     - `checkTimeOverlap` ignores soft-deleted entries (`status != 'DELETED'`), allowing users to log valid entries over intervals where a mistaken entry was deleted.
  3. **Strict 24-Hour Window & Source-Type Immutability**:
     - `canEditTimeEntry()` restricts member modifications to `MANUAL` entries created within 86,400 seconds (`(Date.now() - new Date(entry.created_at).getTime()) / 1000 <= 86400`). Entries older than 24 hours are locked (`403 Forbidden`).
     - `TIMER`-stopped entries are locked immediately for regular members (`403 Forbidden`).
     - Admins retain unrestricted override privileges to update or delete any entry regardless of age or source type.
  4. **Field-Level Audit Trail & Point-in-Time Billing Snapshotting**:
     - Every modified field (`description`, `start_time`, `end_time`, `duration_minutes`, `is_billable`, `billable_amount`) appends an individual record to `time_entry_history` with exact `old_value` and `new_value`.
     - Billable rate resolved at `start_time` remains permanently snapshotted; duration changes recalculate `billable_amount` using the snapshotted rate.
- **Consequences**: Flawless referential integrity, comprehensive field auditability, and robust RBAC verified by 56/56 passing tests in `scripts/verify-prd22-layer3.js` and zero platform regressions.

## Decision 25: PRD 22 Layer 4 Approval Workflow, Team/My Report Engine & Append-Only Snapshotting
- **Context**: PRD 22 Layer 4 mandates the Approval Workflow (`POST /api/time/approval/request/:entryId`, `PATCH /api/time/approval/:requestId/approve`, `PATCH /api/time/approval/:requestId/reject`, `GET /api/time/approval/pending`), Team & My Report Engine (`GET /api/time/report/team`, `GET /api/time/report/my`), Point-in-time Report Snapshots (`POST /api/time/report/snapshot`, `GET /api/time/report/snapshots/:projectId`), and CSV/JSON Export (`GET /api/time/report/export/:projectId`). Crucially, `time_approval_requests` and `time_report_snapshots` are strictly append-only tables guarded by SQLite triggers (`prevent_approval_request_update`, `prevent_approval_request_delete`, `prevent_time_report_snapshot_update`, `prevent_time_report_snapshot_delete`).
- **Decision**:
  1. **Approval Workflow Architecture (Append-Only Request Insertion + State Updates on `time_entries`)**:
     - Member submits an entry for approval via `requestApproval`: validates ownership (`403` for cross-member), ensures `status === 'PENDING'`, blocks active running timers (`end_time IS NULL`), and checks against duplicate pending requests (`409 Conflict`). Inserts append-only row into `time_approval_requests` and logs `APPROVAL_REQUESTED` to `time_entry_history`.
     - Admin approval via `approveTimeEntry`: strictly Admin-only (`403` for members). Updates `time_entries` status to `'APPROVED'`, sets `approved_by` and `approved_at`, manually updates `updated_at`. Logs audit change in `time_entry_history` and `access_log` (`TIME_ENTRY_APPROVED`). Because `time_approval_requests` is append-only, zero SQL `UPDATE` is attempted on `time_approval_requests`.
     - Admin rejection via `rejectTimeEntry`: requires `decision_note` (minimum 10 characters per PRD spec). Sets `status = 'REJECTED'` and `rejection_reason` on `time_entries`. Logs audit change in `time_entry_history` and `access_log` (`TIME_ENTRY_REJECTED`). Per Rule 11, rejected entries can never be resubmitted (`400 Bad Request`).
     - Pending Approvals Queue (`getPendingApprovals`): Admin-only query joining `time_approval_requests`, `time_entries`, `users`, and `projects`. Filters `te.status = 'PENDING'` and `te.status != 'DELETED'`. Approving or rejecting an entry immediately removes it from the pending queue.
  2. **Team & My Time Report Engine**:
     - `getTeamTimeReport`: Admin-only (`403` for members). Aggregates per member: `total_hrs`, `billable_hrs`, `non_billable_hrs`, `billable_amount`, and `entries_count`. Generates comprehensive summary totals. Excludes `status = 'DELETED'` rows. Supports `project_id`, `from`, `to` filters.
     - `getMyTimeReport`: Authenticated user query scoped strictly to `te.user_id = currentUser.id`. Returns aggregated totals and project-by-project breakdown (`by_project`). Excludes `DELETED` rows.
  3. **Point-in-Time Snapshot Freezing**:
     - `createReportSnapshot`: Admin-only. Validates `report_type` (`WEEKLY`, `MONTHLY`, `CUSTOM`) and temporal bounds. Computes team report and freezes data as verified JSON string in `snapshot_data` column of `time_report_snapshots`. Append-only triggers prevent any future tampering.
     - `getReportSnapshots`: Admin-only query retrieving historical snapshot logs with JSON parsing. Supports string and numeric `project_id` matching.
  4. **Report Export with Access Log Auditing**:
     - `exportTimeReportData`: Admin-only. Audits export request in `access_log` (`TIME_REPORT_EXPORT`). Generates RFC 4180 compliant CSV stream with headers (`text/csv`) and proper escaping of commas, quotes, and newlines. Supports dual-mode JSON output via `?format=json`.
- **Consequences**: Flawlessly verified by 85/85 passing tests in `scripts/verify-prd22-layer4.js`, 300/300 total PRD 22 assertions, and 13/13 passing platform test suites with zero regressions.

## Decision 26: PRD 22 Layer 5 Frontend Views Architecture & Security Hardening
- **Context**: PRD 22 Layer 5 requires building four dedicated frontend HTML views in `public/`:
  1. `public/my-time-tracker.html` (Personal stopwatch timer, today's entries, manual entry modal, 24hr edit validation, weekly hours summary bar chart).
  2. `public/team-time-report.html` (Admin-only team financial report, member drill-downs, CSV/JSON exports, immutable point-in-time snapshot freezer).
  3. `public/time-approval-queue.html` (Admin-only approval queue, 1-click approve, reject modal with 10-char note validation).
  4. `public/billable-rates.html` (Admin-only billable rates governance, member default rates, project overrides, member rate history accordions).
- **Decision**:
  1. **Zero External CDN Dependencies & Offline Robustness**:
     - Built with vanilla HTML5, CSS3, and ES6 JavaScript using the established dark aesthetic design tokens (`#090d16`, `#0f172a`, `#1e293b`, accents `#38bdf8`, `#10b981`, `#f59e0b`, `#ef4444`).
     - Weekly chart is rendered using responsive CSS flex bars, eliminating external charting dependencies.
  2. **Strict Security & XSS Sanitization**:
     - Mandatory `escapeHTML()` sanitization implemented and applied across every dynamic data interpolation in all 4 views.
     - Zero hardcoded credentials, secrets, tokens, or plaintext passwords in any script.
     - Dynamic token acquisition via `urlParams.get('token') || localStorage.getItem('token')`.
     - Server-side RBAC verification via `GET /api/users/me` on initial page load; admin-only views (`team-time-report.html`, `time-approval-queue.html`, `billable-rates.html`) display access-denied state if non-admin user attempts access.
  3. **Local Stopwatch Engine without Server Polling**:
     - Active timer widget calculates elapsed duration client-side via `setInterval` from `timer.start_time`, completely eliminating server polling load while maintaining millisecond precision.
  4. **Approval & Rejection UX Guardrails**:
     - Rejection modal enforces a live character counter requiring $\ge 10$ characters before the rejection button is enabled.
- **Consequences**: Verified by 163/163 passing tests in `scripts/verify-prd22-layer5.js`, zero security warnings, and full regression pass across all 13 core test suites.

## Decision 27: PRD 22 Layer 6 Full End-to-End Integration Suite & System Hardening
- **Context**: PRD 22 Layer 6 mandates a comprehensive end-to-end integration test suite verifying the complete time tracking and billing lifecycle across 15 exact steps: real authentication for Admin and 2 Member personas, append-only billable rates, live timer lock and concurrency conflict blocking, server-computed duration and billable amount, manual time entry with mandatory interval overlap checks, rate snapshot immutability, 24-hour edit window with source-type locks, soft delete with foreign key referential integrity preservation, approval workflow (submit, duplicate conflict block, rejection with note validation, resubmission block, approval with access log), team report aggregation excluding soft-deleted records, report snapshot with trigger-blocked mutation, RFC 4180 CSV export with access log audit, frontend 4-view security audit (XSS, zero credentials, server role verification), and dangling timer auto-close cron.
- **Decision**:
  1. **Strict Zero-Mock Testing Harness (`scripts/verify-prd22-integration.js`)**:
     - Built an ephemeral Express HTTP test server listening on a dynamic loopback port backed by the real SQLite database (`PRAGMA foreign_keys = ON;`, WAL mode, `busy_timeout = 5000`).
     - Every step validates both the HTTP response and executes direct SQLite `SELECT` queries to verify database state, foreign key relationships, and append-only trigger invariants.
  2. **Service Parameter Flexibility**:
     - Hardened `setBillableRate`, `startTimer`, `createManualEntry`, and `updateTimeEntry` to accept aliases (`hourly_rate` / `rate_per_hour` and `task_description` / `description`) seamlessly.
     - Ensured `startTimer` returns both `time_entry` and `timer` structures for client backward compatibility.
  3. **Complete 15-Step Sequence Verification**:
     - Verified all 88 assertions across the 15 steps with 100% pass rate.
     - Confirmed all 6 PRD 22 database tables, 8 append-only SQLite triggers, 21 HTTP endpoints, and 4 frontend views meet every single item on the Definition of Done checklist.
- **Consequences**: PRD 22 is 100% complete, fully verified end-to-end with 551 total passing PRD 22 assertions (100 in Layer 1, 59 in Layer 2, 56 in Layer 3, 85 in Layer 4, 163 in Layer 5, 88 in Layer 6) and 13/13 core platform test suites passing with zero regressions.

## Decision 23-A: PRD 23 Layer 1 Database Schema, Immutability Triggers & Seed Engine
- **Context**: PRD 23 mandates the Analytics & KPI Dashboard system with support for custom KPI definitions across 8 platform data sources (Sprint, OKR, Time Tracking, Workload, Pipeline, Revenue, GitHub, Custom), periodic immutable snapshots, personal/team/company dashboards with customizable widget layouts, automated KPI threshold alerting, and audit-logged report exports.
- **Decision**:
  1. **6 Core Tables Implemented in SQLite (`PRAGMA foreign_keys = ON;`, `journal_mode = WAL`, `busy_timeout = 5000`)**:
     - `kpi_definitions`: Core KPI registry storing name, data source, metric type, structured JSON `calculation_query`, unit, target, alert thresholds, and refresh interval ($\ge 15$ mins).
     - `kpi_snapshots`: Append-only periodic time-series records of calculated KPI values and metadata.
     - `analytics_dashboards`: Dashboard definitions scoped by `PERSONAL`, `TEAM`, or `COMPANY` with JSON layout configurations.
     - `dashboard_widgets`: Individual configurable cards and charts linked to dashboards and optional KPIs with 12-column grid placement coordinates.
     - `kpi_alerts`: Threshold breach event records with mutable acknowledgment fields (`acknowledged_by`, `acknowledged_at`).
     - `analytics_report_exports`: Append-only audit records of generated analytics exports (JSON/CSV).
  2. **5 Append-Only Immutability Triggers**:
     - `prevent_kpi_snapshot_update` & `prevent_kpi_snapshot_delete` block modification or deletion of historical KPI snapshot records.
     - `prevent_kpi_alert_delete` blocks deletion of alert records while preserving acknowledgment updates.
     - `prevent_analytics_export_update` & `prevent_analytics_export_delete` block tampering with the export audit trail.
  3. **10 Built-In Seeded KPI Definitions**:
     - Seeded 10 platform KPIs automatically via `seedBuiltInKpis()`: Sprint Velocity, Sprint Completion Rate, OKR Progress (Company Level), Team Utilization, Billable Hours This Month, Pipeline Completion Rate, GitHub PR Merge Rate, Revenue This Month, Active Backlog Items, and Overloaded Members.
     - Idempotent execution ensuring seeded definitions cannot be duplicated.
- **Consequences**: Verified by 175/175 passing tests in `scripts/verify-prd23-layer1.js` and 13/13 passing core platform test suites.

## Decision 23-B: PRD 23 Layer 2 KPI Engine, Snapshots, Alert Automation & Route Governance
- **Context**: PRD 23 Layer 2 specifies the KPI calculation engine, append-only snapshot engine, threshold-breach alert auto-generation, seed KPI protection, background cron refresh, and 6 KPI REST endpoints (`POST /api/analytics/kpi/create`, `GET /api/analytics/kpis`, `GET /api/analytics/kpi/:kpiId`, `PATCH /api/analytics/kpi/:kpiId`, `DELETE /api/analytics/kpi/:kpiId`, `POST /api/analytics/kpi/:kpiId/refresh`).
- **Decision**:
  1. **Safe Server-Side KPI Calculation Engine (`calculateKpiValue`)**:
     - Strict whitelist of 18 allowed system tables (`time_entries`, `sprints`, `backlog_items`, `sprint_velocity_log`, `okr_objectives`, `okr_key_results`, `workload_snapshots`, `workload_assignments`, `workload_alerts`, `member_capacity`, `pipeline_deliverables`, `pipeline_checklist_points`, `github_webhook_log`, `revenue_events`, `revenue_splits`, `ideas`, `votes`, `users`).
     - Parses `calculation_query` JSON specifications into parameterized SQLite queries — never concatenates or executes arbitrary SQL from client or database.
     - Supports validated aggregation types: `SUM`, `COUNT`, `AVERAGE`, `PERCENTAGE`, `LATEST`, and `RATIO`.
     - Graceful fallback for empty or inactive external integrations (e.g. GitHub returns `0.0` without throwing or crashing).
     - Dedicated calculation handlers for all 10 built-in KPIs with real SQL joins across sprints, velocity logs, OKRs, workload calculations, billable time entries, pipeline checklists, and revenue transactions.
  2. **Append-Only Snapshot Engine (`refreshKpi`)**:
     - Every refresh execution computes the metric server-side and executes an append-only `INSERT INTO kpi_snapshots (kpi_id, value, period_label, calculation_metadata, snapshotted_at)`.
     - Never updates an existing snapshot (enforced by DB trigger `prevent_kpi_snapshot_update`).
  3. **Alert Auto-Generation & Deduplication (`checkAndGenerateKpiAlert`)**:
     - Compares snapshot value against `alert_threshold_low` and `alert_threshold_high`.
     - Generates `BELOW_THRESHOLD` or `ABOVE_THRESHOLD` alerts when limits are breached.
     - Implements deduplication check (`WHERE kpi_id = ? AND alert_type = ? AND acknowledged_at IS NULL LIMIT 1`) to prevent duplicate spam alert creation while an unacknowledged alert is open.
  4. **Seeded KPI Protection & Delete Integrity (`deleteKpiDefinition`)**:
     - Blocks deletion of seeded built-in KPIs (`is_built_in = 1` or IDs 1-10) with `400 Bad Request` ("Seeded built-in KPIs cannot be deleted. You can only deactivate them via PATCH with is_active = 0.").
     - For non-seeded custom KPIs: if append-only snapshots or alerts exist, performs a soft-delete (`UPDATE kpi_definitions SET is_active = 0, updated_at = datetime('now')`) to preserve foreign-key integrity without violating SQLite append-only triggers. If no child records exist, hard deletes cleanly.
  5. **Validation & Refresh Constraints**:
     - Rejects `refresh_interval_minutes < 15` with `400 Bad Request` ("Minimum refresh interval is 15 minutes").
     - Rejects missing names, invalid data sources, or unsupported agg types with `400 Bad Request`.
     - Maintains `updated_at = datetime('now')` manually on all row modifications and writes audit entries to `access_log`.
  6. **Background Cron Refresh Engine (`refreshDueKpis`)**:
     - Scans active KPIs where `(julianday('now') - julianday(last_snapshot_at)) * 1440 >= refresh_interval_minutes`.
     - Iteratively recalibrates values and records snapshots with full error handling and execution summaries.
  7. **API Route Mounting & Admin+ RBAC**:
     - Mounted on `/api/analytics` via `src/routes/analytics.routes.js`.
     - KPI endpoints strictly enforce Admin+ authorization (`requireAdmin`), blocking unprivileged members with `403 Forbidden` and unauthenticated callers with `401 Unauthorized`.
- **Consequences**: Layer 2 verified with 110/110 passing assertions in `scripts/verify-prd23-layer2.js`, Layer 1 maintains 175/175 passing tests, and core platform `npm test` suite passes 13/13 cleanly.

## Decision 23-C: PRD 23 Layer 3 Dashboard Governance, 12-Column Grid Widget Engine & Privacy Redaction
- **Context**: PRD 23 Layer 3 specifies the Dashboard & Widget management system (`analytics_dashboards`, `dashboard_widgets`). It requires strict role-based dashboard visibility and access control across three tiers (`PERSONAL`, `TEAM`, `COMPANY`), an enterprise 12-column responsive grid layout validation system for dashboard widgets, strict FK enforcement linking widgets to `kpi_definitions`, pre-computed snapshot querying (`ORDER BY snapshotted_at DESC, id DESC LIMIT 1`) with 30-snapshot sparkline trends, server-side data privacy sanitization preventing non-admin members from ever viewing raw individual contribution breakdowns, and protection preventing the deletion of the sole company-wide overview dashboard.
- **Decision**:
  1. **Strict 3-Tier Dashboard Scope Governance**:
     - `PERSONAL`: Any authenticated user can create. Only the owner can view, edit, or delete; all other members receive `403 Forbidden`. Crucially, members can NEVER see or list another member's PERSONAL dashboard (`WHERE d.scope = 'TEAM' OR (d.scope = 'PERSONAL' AND d.owner_id = ?)`).
     - `TEAM`: Created exclusively by Admin+ (`403 Forbidden` if member attempts creation). Visible to all authenticated team members (`GET /api/analytics/dashboards` & `GET /api/analytics/dashboard/:dashboardId`). Modifications and deletions are strictly Admin-only (`403 Forbidden` for regular members).
     - `COMPANY`: Created, edited, deleted, and viewed exclusively by Admin+ (`403 Forbidden` for members on all operations). Completely hidden from non-admin dashboard listings.
     - Sole Company Dashboard Defense: Attempting to delete a COMPANY dashboard when it is the only one in the system is rejected with `400 Bad Request` ("Cannot delete COMPANY scope dashboard as it is the only company dashboard").
  2. **12-Column Grid Widget Engine (`dashboard_widgets`)**:
     - Strict 12-column grid placement boundaries: requires `position_x >= 0`, `position_y >= 0`, `1 <= width <= 12`, `height >= 1`, and `position_x + width <= 12`. Any coordinate exceeding 12 columns per row is rejected server-side with `400 Bad Request`.
     - Validated widget types: Strictly restricted to `NUMBER_CARD`, `BAR_CHART`, `LINE_CHART`, `PIE_CHART`, `PROGRESS_BAR`, `TABLE`, `HEATMAP`, `BURNDOWN`, `VELOCITY` (`400 Bad Request` for invalid types).
     - FK Integrity: If `kpi_id` is supplied, existence is verified against `kpi_definitions` (`404 Not Found` if referenced KPI does not exist).
     - Widget mutations (`createWidget`, `updateWidget`, `deleteWidget`) enforce ownership/admin permissions matching parent dashboard rules.
  3. **Pre-computed Snapshot Engine & Trend Sparkline**:
     - Widget data fetch never recalculates KPI metrics on the fly, eliminating computational overhead and preserving sub-millisecond response latencies.
     - Pulls latest pre-computed snapshot directly from `kpi_snapshots` using `ORDER BY snapshotted_at DESC, id DESC LIMIT 1`.
     - Fetches 30-point historical sparkline trend using `ORDER BY snapshotted_at DESC, id DESC LIMIT 30`.
  4. **Server-Side Member Privacy Sanitization (`sanitizeCalculationMetadataForMember`)**:
     - Mandatory server-side redaction strips sensitive individual member performance metrics (`members`, `memberResults`, `individual_contributions`, `member_breakdown`, `user_id`, `users`) from `calculation_metadata` whenever the viewer is not an Admin or SuperAdmin.
  5. **Audit Logging & Manual `updated_at` Maintenance**:
     - All mutations (`DASHBOARD_CREATED`, `DASHBOARD_UPDATED`, `DASHBOARD_DELETED`, `WIDGET_CREATED`, `WIDGET_UPDATED`, `WIDGET_DELETED`) write audit rows to `access_log`.
     - `updated_at = datetime('now')` is updated manually in every service function that modifies a row.
  6. **REST Endpoints Mounted on `/api/analytics`**:
     - `POST /api/analytics/dashboard/create`
     - `GET /api/analytics/dashboards`
     - `GET /api/analytics/dashboard/:dashboardId`
     - `PATCH /api/analytics/dashboard/:dashboardId`
     - `DELETE /api/analytics/dashboard/:dashboardId`
     - `POST /api/analytics/widget/create`
     - `PATCH /api/analytics/widget/:widgetId`
     - `DELETE /api/analytics/widget/:widgetId`
- **Consequences**: Verified by 111/111 passing tests in `scripts/verify-prd23-layer3.js`, 175/175 Layer 1 tests, 110/110 Layer 2 tests, and 13/13 core platform test suites passing with zero regressions.

## Decision 23-D: PRD 23 Layer 4 Report Analytics, Export Engine, Alert Governance & Snapshot History API
- **Context**: PRD 23 Layer 4 mandates the Report Analytics endpoints (`/api/analytics/report/sprint`, `/api/analytics/report/okr`, `/api/analytics/report/time`, `/api/analytics/report/workload`, `/api/analytics/summary/company`), the dual-mode RFC 4180 Report Export Engine (`/api/analytics/report/export`), Alert Governance and Acknowledgment (`PATCH /api/analytics/alert/:alertId/acknowledge`, `GET /api/analytics/alerts`), KPI Snapshot History (`GET /api/analytics/kpi/:kpiId/snapshots`), and Seeded Built-in KPI Deactivation via `PATCH /api/analytics/kpi/:kpiId` with `is_active=0`.
- **Decision**:
  1. **Strict Alert Acknowledgment Workflow & Trigger Invariant Enforcement**:
     - `acknowledgeKpiAlert`: Admin-only (`requireAdmin` / `403 Forbidden` for non-admin members).
     - Updates `acknowledged_by = admin.id`, `acknowledged_at = datetime('now')`, and `updated_at = datetime('now')` on `kpi_alerts`.
     - Validates that already-acknowledged alerts return `400 Bad Request` ("Alert is already acknowledged").
     - Missing alerts return `404 Not Found`.
     - Tested and verified that SQLite trigger `prevent_kpi_alert_delete` blocks all SQL `DELETE` attempts with `RAISE(ABORT)` while acknowledgment `UPDATE` is permitted.
     - Logs `KPI_ALERT_ACKNOWLEDGED` to `access_log`.
  2. **Scoped Alert Listing Governance (`getKpiAlerts`)**:
     - Admin sees all system alerts across all scopes.
     - Regular members only receive alerts for KPIs that are placed on dashboards accessible to them: specifically, widgets on their own `PERSONAL` dashboards or accessible `TEAM` dashboards (`WHERE w.kpi_id IS NOT NULL AND (d.scope = 'TEAM' OR (d.scope = 'PERSONAL' AND d.owner_id = ?))`).
     - Company-scope KPI alerts are strictly hidden and redacted from non-admin members.
  3. **Report Analytics Endpoints (Admin-Only)**:
     - `getSprintAnalyticsReport`: Calculates average velocity, sprint comparison metrics, velocity trends across past sprints, and backlog health.
     - `getOkrProgressReport`: Aggregates company-wide and team-level key result progress with status distributions.
     - `getTimeAnalyticsReport`: Aggregates total hours, billable hours, billable amounts, project breakdowns, and member allocations while strictly excluding soft-deleted time entries (`status != 'DELETED'`).
     - `getWorkloadAnalyticsReport`: Computes member utilization, overloaded member counts, and allocation status categories based on active capacity and time logs.
     - `getCompanyKpiSummary`: Assembles executive summary cards for all 10 built-in KPIs with target comparisons, trend arrows (`UP`, `DOWN`, `FLAT`), and status indicators (`ON_TRACK`, `AT_RISK`, `CRITICAL`).
  4. **Dual-Mode Report Export Engine & Immutability (`exportAnalyticsReport`)**:
     - Admin-only (`403 Forbidden` for regular members).
     - Dual-mode format support: `?format=csv` or `export_format: 'CSV'` generates compliant RFC 4180 CSV with headers, proper quoting, and newline escaping (`text/csv`); default or `JSON` format returns JSON payload.
     - Inserts an append-only audit record into `analytics_report_exports`.
     - Verified that SQLite triggers `prevent_analytics_export_update` and `prevent_analytics_export_delete` strictly block all `UPDATE` and `DELETE` queries on the export table with `RAISE(ABORT)`.
     - Logs `ANALYTICS_REPORT_EXPORT` with `target_id` to `access_log`.
  5. **KPI Snapshot History API (`getKpiSnapshots`)**:
     - Admin-only (`403 Forbidden` for regular members).
     - Returns paginated snapshots (`limit`, `offset`, `total_count`) for the requested KPI definition.
  6. **Seeded Built-In KPI Deactivation (`updateKpiDefinition`)**:
     - Deactivation via `PATCH /api/analytics/kpi/:kpiId` with `is_active=0` succeeds cleanly on built-in seeded KPIs (IDs 1-10 or `is_built_in=1`), whereas direct `DELETE` remains blocked with `400 Bad Request`.
- **Consequences**: Flawlessly verified with 100/100 passing assertions in `scripts/verify-prd23-layer4.js`, full regression pass on Layer 1 (175/175), Layer 2 (110/110), Layer 3 (111/111), and 13/13 core platform test suites passing cleanly.

## Decision 23-E: PRD 23 Layer 5 Frontend Views Architecture & Security Hardening
- **Context**: PRD 23 Layer 5 mandates the implementation of five specialized frontend HTML views in `public/`:
  1. `public/kpi-overview.html` (Company KPI Overview: executive cards for 10 built-in KPIs, status color coding, trend arrows, 30-snapshot drill-down modal, alert counter, Refresh All, and CSV export).
  2. `public/dashboard-builder.html` (Custom Dashboard Builder: 12-column responsive CSS grid, 8-item drag-drop widget library, layout persistence, and 3-tier scope governance).
  3. `public/sprint-analytics.html` (Sprint Velocity & Burndown: committed vs completed dual-bar velocity charts, circular completion gauge, sprint comparison table, and CSV export).
  4. `public/team-analytics.html` (Team Performance & Workload: member contribution matrix, billable vs non-billable time distribution, top contributors leaderboard, and CSV export with member privacy safeguards).
  5. `public/kpi-alerts.html` (KPI Alert Center: incident queue, ALL/UNACKNOWLEDGED/ACKNOWLEDGED filter tabs, single-click disable-guarded alert acknowledgment, and 30-day alert frequency bar chart).
- **Decision**:
  1. **Strict Offline Safety & Zero External CDN Dependencies**:
     - Engineered entirely with native HTML5, CSS3, and ES6 JavaScript.
     - Sparklines, line charts, velocity bars, circular completion gauges, and alert distribution histograms are generated via dynamic inline SVGs without relying on any external CDN libraries.
  2. **End-to-End Security & XSS Sanitization**:
     - Universal `escapeHTML()` sanitization implemented in all 5 views and applied across every dynamic string interpolation.
     - Zero hardcoded credentials, secrets, tokens, or plaintext passwords in any script.
     - Dynamic token acquisition via `urlParams.get('token') || localStorage.getItem('token')`.
     - Server-side RBAC verification via `GET /api/users/me` on initial page load; admin-only views (`kpi-overview.html`, `team-analytics.html`, `kpi-alerts.html`) strictly display access-denied state if accessed by unprivileged members.
  3. **Specific UI Rules Compliance**:
     - KPI status badges follow explicit color codes (`ON_TRACK` = green, `AT_RISK` = yellow, `CRITICAL` = red).
     - Trend arrows adhere to specification: `UP` = ↑ green, `DOWN` = ↓ red, `FLAT` = → grey.
     - Dashboard builder visually respects 12-column layout via CSS Grid (`grid-template-columns: repeat(12, 1fr)`).
     - Alert acknowledgment button is disabled immediately upon clicking to prevent double-click requests and 400 Bad Request responses.
     - Sparklines exclusively consume pre-computed `trend_snapshots` from the API, eliminating client-side recalculation overhead.
     - CSV export buttons trigger RFC 4180 file downloads via `Blob` and `Content-Disposition`.
- **Consequences**: Flawlessly verified with 82/82 passing assertions in `scripts/verify-prd23-layer5.js`, 100% HTTP 200 serving verification from an active Express server, and full platform regression passing 13/13 test suites cleanly.

## Decision 23-F: PRD 23 Layer 6 Full End-to-End Integration Suite & Definition of Done
- **Context**: PRD 23 Layer 6 mandates a comprehensive end-to-end integration test suite verifying the complete Analytics & KPI Dashboard system across 18 sequential steps: real authentication for Admin and 2 Member personas, KPI calculation engine refreshing all 10 built-in KPIs with direct SQLite snapshot verification, graceful fallback for inactive GitHub webhook integrations without crashing, alert auto-generation on low-threshold breaches with direct SQLite verification, alert deduplication preventing duplicate unacknowledged alerts on second refresh, alert scope isolation preventing non-admin members from viewing company-scope alerts, alert acknowledgment governance (member 403, admin 200 with DB timestamp audit, re-acknowledge 400), dashboard personal scope isolation (cross-member 403, member team creation 403, admin creates team/company), 12-column widget grid boundary validation (overflow 400, invalid type 400, missing KPI 404), pre-computed snapshot fetching without live recalculation, server-side privacy redaction stripping member breakdown data for regular members while preserving for admin, sole company dashboard protection (delete sole 400, create second and delete second 200), sprint analytics report aggregation with numeric average velocity and comparison array, dual-mode report export (JSON 200 with audit row, CSV text/csv RFC 4180 with headers, append-only triggers blocking UPDATE and DELETE, access_log verification), company KPI summary cards with trend arrows and status classifications, frontend 5-file security audit (zero hardcoded credentials, universal escapeHTML, dynamic localStorage token, server role verification, HTTP 200 static serving), seeded KPI deactivation (is_active=0 200, delete blocked 400, reactivate 200), and 30+ snapshot trend sparkline generation with LIMIT 30 verification.
- **Decision**:
  1. **Dual Verification Architecture (Real HTTP + Direct SQLite SELECT)**:
     - Authored `scripts/verify-prd23-integration.js` using an ephemeral Express server listening on dynamic loopback ports with zero mock shortcuts.
     - Every step verifies HTTP response codes/payloads and corroborates results with direct SQLite `queryOne` / `queryAll` queries.
  2. **Append-Only Immutability & Trigger Verification**:
     - Verified triggers `prevent_kpi_snapshot_update`, `prevent_kpi_snapshot_delete`, `prevent_kpi_alert_delete`, `prevent_analytics_export_update`, and `prevent_analytics_export_delete` directly in SQLite.
  3. **18-Step Sequence & Definition of Done Checklist**:
     - All 18 steps executed and passed with 197 / 197 assertions passing (100%).
     - All 20 items in the PRD 23 Definition of Done checklist verified and marked `[x]`.
- **Consequences**: PRD 23 (Analytics & KPI Dashboard) is 100% complete, fully verified end-to-end, and permanently sealed.

## Decision 24-A: PRD 24 Layer 1 Database Schema, Triggers & Client Isolation Architecture
- **Context**: PRD 24 mandates the Client Portal for Mahi Tech Group. Non-negotiable security rules require that client users are never stored in the main `users` table, client sessions and tokens are strictly segregated from internal users, client access is restricted exclusively to explicitly shared items, internal comments and notes are never returned, and append-only ledgers are enforced at the SQLite engine level.
- **Decision**:
  1. **Strict Client Identity & Data Segregation**:
     - Client users reside in a dedicated `clients` table (`name`, `email`, `company_name`, `phone`, `password_hash`, `status`, `invite_token`, `invite_token_expires_at`, `invite_accepted_at`, `created_by`).
     - Access containers managed via `client_project_access` (`UNIQUE(client_id, project_id)`).
     - Fine-grained explicit asset access managed via `client_shared_items` (`GANTT_ITEM`, `MILESTONE`, `BACKLOG_ITEM`, `DELIVERABLE`, `DOCUMENT`).
  2. **8 Production SQLite Tables**:
     - `clients`: Isolated external client directory.
     - `client_project_access`: Project container authorization with `access_level` (`VIEW`, `COMMENT`, `APPROVE`).
     - `client_shared_items`: Explicit opt-in sharing registry.
     - `client_orders`: Client intake request pipeline with `internal_notes` column.
     - `client_order_messages`: Threaded messages with `is_internal` flag.
     - `client_milestone_approvals`: Sign-off ledger with `decision`, `decision_note`, and `decided_at`.
     - `client_deliverable_feedback`: 5-star rating and feedback repository.
     - `client_activity_log`: Immutable client audit log.
  3. **8 Append-Only Immutability Triggers**:
     - `prevent_client_order_message_update` & `prevent_client_order_message_delete`: Block modifying or deleting message history.
     - `prevent_client_milestone_approval_update` (aborts once decided via `WHEN (OLD.decision IS NOT NULL)`) & `prevent_client_milestone_approval_delete`: Protect milestone approvals from tampering.
     - `prevent_client_feedback_update` & `prevent_client_feedback_delete`: Ensure feedback entries cannot be altered after submission.
     - `prevent_client_activity_log_update` & `prevent_client_activity_log_delete`: Guarantee audit trail immutability.
  4. **Performance & Integrity Indexes**:
     - 18 composite and single-column indexes created across all 8 client portal tables.
  5. **Pragmas & Zero Mocks**:
     - Verified `PRAGMA journal_mode = WAL;`, `PRAGMA busy_timeout = 5000;`, and `PRAGMA foreign_keys = ON;`.
- **Consequences**: Layer 1 verified with 216/216 passing assertions in `scripts/verify-prd24-layer1.js` with zero regressions on core platform test suites.

## Decision 24-B: PRD 24 Layer 2 Client Auth System & Bi-Directional Security Isolation Architecture
- **Context**: PRD 24 Layer 2 specifies implementing a completely isolated Client Authentication System. Strict rules dictate: client users are never mixed with internal user records or sessions; client JWT tokens use a dedicated secret (`CLIENT_JWT_SECRET`); bi-directional token isolation prevents client tokens from accessing internal `/api/*` endpoints and internal user tokens from accessing `/api/client/*` endpoints; invite tokens must be cryptographically random (minimum 32 bytes) with 72-hour server-side expiration and one-time use; rate limiting must enforce 5 attempts per 15 minutes per IP with 429 lockout; and all auth events must be logged to the append-only `client_activity_log`.
- **Decision**:
  1. **Complete Namespace & Service Segregation**:
     - Client routes mounted under `/api/client/auth/*` (`accept-invite`, `login`, `logout`, `me`) in `src/routes/client.routes.js`.
     - Admin invitation endpoints mounted under `POST /api/admin/clients/invite` and `POST /api/admin/clients/create` (Admin role strictly enforced; members receive 403 Forbidden).
     - Business logic encapsulated in `src/services/clientAuthService.js`.
  2. **Dedicated Client JWT & Session Isolation**:
     - Client JWT signed using dedicated secret `config.CLIENT_JWT_SECRET` (`process.env.CLIENT_JWT_SECRET`).
     - Payload strictly contains `{ clientId, email, role: 'CLIENT' }`.
     - Completely decoupled from internal user `sessions` table.
  3. **Bi-Directional Security Isolation Guards**:
     - **Guard 1 (Internal Endpoints)**: `src/middleware/auth.js` inspects all incoming tokens and rejects any token where `role === 'CLIENT'` with `403 Forbidden: Client tokens are not permitted on internal endpoints`.
     - **Guard 2 (Client Endpoints)**: `src/middleware/clientAuth.js` verifies tokens against `CLIENT_JWT_SECRET` and rejects internal user tokens with `401 Unauthorized: Internal user tokens are not permitted on client routes`.
  4. **Cryptographic Invitation Lifecycle & Expiration**:
     - Generated with `crypto.randomBytes(32).toString('hex')` (64 hex characters / 32 bytes).
     - Server-side expiration enforced at 72 hours (`invite_token_expires_at`). Expired tokens return `400 Bad Request`.
     - Initial unmatchable bcrypt placeholder hash prevents premature login while in `INVITED` state (attempting login returns `400 Bad Request`).
     - Upon acceptance (`POST /api/client/auth/accept-invite`), `password_hash` is updated to bcrypt hash (>=8 chars), `invite_token` is nulled (`NULL`), `invite_accepted_at` is set, and status becomes `ACTIVE`.
     - One-time use enforced: re-using the accepted token is rejected with `400 Bad Request`.
     - Admin can resend invite via `POST /api/admin/clients/:clientId/invite/resend`, generating a fresh 32-byte token with renewed 72h expiry.
  5. **Rate Limiting Protection (Sliding Window)**:
     - `clientLoginLimiter` middleware tracks failed attempts per IP address over a 15-minute sliding window.
     - Max 5 failed attempts allowed; 6th attempt returns `429 Too Many Requests: Too many failed login attempts. Account temporarily locked for 15 minutes.`
     - Successful login automatically resets the IP counter.
  6. **Account Status Lifecycle & Suspension**:
     - `INVITED` -> `ACTIVE` (on accept) -> `SUSPENDED` (admin action).
     - Admin updates client status via `PATCH /api/admin/clients/:clientId/status`.
     - Suspended client login returns `403 Forbidden: Account has been suspended. Please contact administrator.`
     - Active client tokens for suspended clients are rejected with `403 Forbidden` on every authenticated request.
  7. **Append-Only Client Activity Logging**:
     - Every auth event (`LOGIN`, `LOGOUT`, `FAILED_LOGIN`, `INVITE_ACCEPTED`) recorded in `client_activity_log` with client ID, IP address, and user agent.
     - Protected by DB triggers `prevent_client_activity_log_update` and `prevent_client_activity_log_delete`.
- **Consequences**: Layer 2 verified with 74/74 passing assertions in `scripts/verify-prd24-layer2.js`, 216/216 passing in Layer 1 verification, and 100% platform regression across all 13 core test suites and PRD 23 integration suite.

## Decision 24-C: PRD 24 Layer 3 Admin Client Management API & Access Governance Architecture
- **Context**: PRD 24 Layer 3 requires full Admin Client Management capabilities across 15 endpoints. Non-negotiable rules require: (1) All admin client management routes require internal JWT with `requireAdmin` role check (members receive 403 Forbidden); (2) Project access grant inserts into `client_project_access` with UNIQUE constraint; (3) Project access revocation is soft (`UPDATE is_active = 0, revoked_by, revoked_at`) — never hard delete; (4) Shared item registration is explicit opt-in only (`INSERT INTO client_shared_items`) with item existence validation across supported tables; (5) Shared item unsharing is soft (`UPDATE is_active = 0, unshared_by, unshared_at`) — never hard delete; (6) Every admin action is recorded in `access_log`; (7) Order management and team/internal messaging adhere strictly to DB append-only triggers and RBAC filters; (8) Predictable fallback signing secrets are strictly eliminated.
- **Decision**:
  1. **Config Hardening (CLIENT_JWT_SECRET)**:
     - Updated `src/config.js` to eliminate predictable fallback strings in production (`process.env.CLIENT_JWT_SECRET || (isProduction ? throw Error : devFallback)`), with explicit warnings emitted in non-production environments when unset.
  2. **Admin Client Management Service (`src/services/clientService.js`)**:
     - `listClients`: Enriches client listing with `active_projects_count` via `LEFT JOIN client_project_access`.
     - `getClientDetail`: Returns full client profile, active and past project access, active and past shared items, and recent activity log entries.
     - `updateClient`: Updates client contact and status with manual `updated_at` timestamps in SQLite.
     - `grantProjectAccess`: Validates project existence, verifies `access_level` (`VIEW`, `COMMENT`, `APPROVE`), and inserts or reactivates access rows with `granted_by` audit fields.
     - `revokeProjectAccess`: Implements soft revocation setting `is_active = 0`, `revoked_by = admin.id`, and `revoked_at = datetime('now')`. Re-granting cleanly reactivates the record without violating `UNIQUE(client_id, project_id)`.
     - `shareItem`: Implements explicit opt-in sharing (Business Rule 15) by verifying that the referenced item exists in its respective table (`gantt_items`, `gantt_milestones`, `roadmap_items`, `sprints`, `tasks`, `release_notes`) and project scope before insertion.
     - `unshareItem`: Implements soft unshare (`is_active = 0`, `unshared_by = admin.id`, `unshared_at = datetime('now')`).
     - `getClientActivityLog`: Returns client event stream for audit inspection.
     - `getAdminOrders`: Allows admins to view orders with `internal_notes` visible, filterable by `client_id` and `status`.
     - `updateOrderStatus`: Updates order status and assigned team members, logging to `client_activity_log`.
     - `addOrderMessage`: Allows team members and admins to append messages to client orders (`is_internal = 1` for internal team notes, `is_internal = 0` for client-visible communication), protected by append-only triggers.
     - `requestMilestoneApproval`: Initiates milestone sign-off requests in `client_milestone_approvals`.
     - `getMilestoneApprovals`: Returns pending and historical milestone approval requests.
  3. **Route Mounting & RBAC (`src/routes/adminClients.routes.js`)**:
     - Mounted via `src/routes/admin.js`.
     - All routes enforce internal authentication (`authenticate`) and require administrator privilege (`requireAdmin`).
     - Members attempting to access any admin client management endpoint receive `403 Forbidden`.
     - Client JWT tokens attempting to access admin endpoints are blocked by `authenticate` guard (`role === 'CLIENT'` rejected).
  4. **Dual Audit Logging**:
     - Every admin action is captured in `access_log` via `logAccess`.
     - Relevant client lifecycle mutations are captured in `client_activity_log` via `logClientActivity`.
- **Consequences**: Layer 3 verified with 121/121 passing assertions in `scripts/verify-prd24-layer3.js`. Complete regression safety maintained: Layer 1 (216/216), Layer 2 (74/74), PRD 23 Integration (197/197), and core platform test suite (13/13).

## Decision 24-D: PRD 24 Layer 4 Client-Facing API, Read Engine & Zero-Trust Access Isolation
- **Context**: PRD 24 Layer 4 mandates the Client-Facing API & Read Engine across all 10 client endpoints (`/api/client/*`). Strict security invariants dictate: (1) All routes enforce `clientAuthMiddleware` (CLIENT JWT only; internal JWTs and unauthenticated callers receive 401); (2) `is_internal = 1` messages MUST NEVER be returned (SQL `WHERE is_internal = 0` mandatory); (3) `internal_notes` field MUST be stripped at service layer before serialization; (4) Zero-trust `client_shared_items` (only `is_active = 1` items accessible); (5) Client can only access projects where `client_project_access.is_active = 1` (any other project -> 403); (6) Deliverable feedback requires mandatory pre-insert check against `client_shared_items` (403 if unshared); (7) Milestone approvals can only be decided once by authenticated client owner (403 on other clients, 400 on already decided); (8) All actions log to `client_activity_log`; (9) `updated_at` manually updated on SQLite mutations; (10) Static/named routes ordered before parameterized routes.
- **Decision**:
  1. **Client-Facing Service Engine (`src/services/clientFacingService.js`)**:
     - `getClientProjects`: Returns projects with active access (`cpa.is_active = 1 AND cpa.client_id = client.id`), excluding internal team metadata.
     - `getClientProjectOverview`: Enforces active project check; queries shared milestones, gantt items, and backlog items joined strictly with `client_shared_items`. Completely omits unshared items.
     - `getClientProjectTimeline`: Returns only shared gantt items for the granted project.
     - `getClientProjectMilestones`: Returns only shared milestones with approval status (`cma.decision`, `cma.decision_note`, `cma.requested_at`, `cma.decided_at`).
     - `submitClientOrder`: Validates title/description, checks project access if provided, inserts into `client_orders`, and strips `internal_notes`.
     - `getClientOrders`: Queries client's own orders, omitting `internal_notes` from SQL query and stripping defensively before returning.
     - `getClientOrderDetail`: Enforces client ownership (403 if belonging to another client), strips `internal_notes`, and fetches messages with mandatory `WHERE order_id = ? AND is_internal = 0` filter.
     - `addClientOrderMessage`: Enforces order ownership, inserts message with `sender_type = 'CLIENT'`, `is_internal = 0`, updates order `updated_at`, and logs activity.
     - `decideMilestoneApproval`: Validates decision (`APPROVED` | `REJECTED`), checks client ownership, blocks re-deciding, updates approval record, and on approval updates `gantt_milestones (status = 'ACHIEVED', achieved_at = datetime('now'), updated_at = datetime('now'))`.
     - `submitClientFeedback`: Enforces active project access, runs pre-insert check against `client_shared_items` (403 if unshared), validates rating (1-5), inserts into `client_deliverable_feedback`, and logs activity.
  2. **Route Architecture & Ordering (`src/routes/client.routes.js`)**:
     - Mounted via `/api/client` in `src/app.js`.
     - Static routes (`/orders/submit`, `/orders`, `/projects`, `/feedback/submit`) mounted before parameterized routes (`/orders/:orderId`, `/project/:projectId/...`).
     - All routes guarded by `clientAuthMiddleware`.
  3. **Append-Only & Immutability Verification**:
     - Tested DB triggers on `client_order_messages`, `client_milestone_approvals`, and `client_deliverable_feedback` confirming UPDATE and DELETE attempts are strictly aborted by SQLite.
- **Consequences**: Layer 4 verified with 111/111 passing assertions in `scripts/verify-prd24-layer4.js`. Zero regressions across Layer 1 (216/216), Layer 2 (74/74), Layer 3 (121/121), PRD 23 Integration (197/197), and core platform suite (13/13).
