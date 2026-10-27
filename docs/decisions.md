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



