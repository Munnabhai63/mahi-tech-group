# Progress Log — MAHI TECH GROUP & OVIPAY

## Completed Milestones
- **Layer 1 to 14 Core Platform**: Database, Auth, Idea Engine, Voting Gate, Fanout, Killswitch, Revenue Split, Dashboards, Coworking Canvas, Meeting WebSockets, Superadmin Panel.
- **Remote VPS Server PM2 Patch**: Fixed `src/server.js` startup detection under PM2 cluster/fork mode.
- **OviPay (YouPI-PG 0% Fee UPI Gateway)**:
  - Whitelabeled YouPI to OviPay.
  - Subdomain DNS configured: `ovipay.oviaxe.com` -> `200.97.164.97`.
  - Production deployment to `/var/www/ovipay` with SQLite isolated database.
  - 3 Dedicated PM2 microservices online: `ovipay-api` (:6100), `ovipay-checkout` (:7000), `ovipay-admin` (:6001).
  - Nginx reverse proxy configured and active on port 80 & 443.
  - Valid Let's Encrypt SSL certificate acquired and verified (expires 2027-01-24).
  - Production payment generation and checkout portal verified live: `https://ovipay.oviaxe.com`.

- **OviPay Real Merchant UPI Setup**:
  - Configured Merchant & Payee: `Mahipal Choudhary`.
  - Registered Production UPI VPA: `muna937634@ybl` across SQLite database (`merchants` & `payment_receiving_accounts`).
  - Cleaned all view partials (`header.html`, `splash.html`, `checkout.html`) to ensure 100% clean OviPay branding without dummy text or fake contacts.
  - Set production support contacts to `support@oviaxe.com`.
  - Verified canonical NPCI UPI QR generation with dynamic INR pricing (`&cu=INR`).

- **1-Click Seamless Direct UPI Payment & Intent Launcher**:
  - Completely bypassed forced WhatsApp OTP / phone number login gate (`preGatewayAuthView`) for instant frictionless guest checkout.
  - Added 1-Click Universal UPI launch button (`openUpiApp('any')`) opening native Android/iOS UPI app chooser (`upi://pay?...`).
  - Added dedicated 1-tap app buttons with native Android package intents:
    - **PhonePe**: `intent://pay?...#Intent;scheme=upi;package=com.phonepe.app;end`
    - **Google Pay**: `intent://pay?...#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`
    - **Paytm**: `intent://pay?...#Intent;scheme=upi;package=net.one97.paytm;end`
    - **CRED**: `intent://pay?...#Intent;scheme=upi;package=com.dreamplug.androidapp;end`
    - **BHIM UPI**: `intent://pay?...#Intent;scheme=upi;package=in.org.npci.upiapp;end`
  - Fixed false-positive `DUPLICATE_SESSION_DETECTED` (409) device-binding error so customers can freely open payment links on their mobile phone or any browser.
  - Verified live checkout session on production: `https://ovipay.oviaxe.com/checkout/92592123-2d8e-4031-93ac-c5cf67139e99`.

- **UPI Server Health & QR First Layout Hardening**:
  - Eliminated false-alarm red downtime warning ("UPI Server Facing Issues - pay by cash instead") by correcting default fallback in `apps/payment-api/src/routes/checkout.routes.js` and `apps/checkout-portal/src/server.js` from RED/ISSUES to GREEN/WORKING ("Server Is Working").
  - Repositioned the dynamic UPI QR Code to the very TOP of the desktop payment workspace (`viewUpiContent`) so desktop users immediately see the large scannable QR without scrolling.
  - Hardened 1-Click UPI app icons with explicit inline styles (`width: 22px !important; height: 22px !important;`) and embedded CSS rules so browser caching of `checkout.css` cannot cause oversized 96px image tiles.
  - Added cache-busting timestamp (`?v={{BUILD_TIME}}`) to stylesheet link in `checkout.html`.
  - Restarted PM2 services `ovipay-api` and `ovipay-checkout` on VPS `200.97.164.97`.

- **Oviaxe Editorial Studio UI & Unified Application Shell (100% As-Is)**:
  - Preserved existing `public/index.html` (4 Corner Panels) safely at `public/legacy-dashboard.html`.
  - Extracted and integrated all 35 files from `origin/Oviaxe-UI` directly into `public/` and `docs/` with zero manual redesign.
  - Verified 100% cryptographic SHA-256 match for all 24 HTML, CSS, and JS files against the author's release manifest (`runtime-release.sha256`).
  - Extracted and configured local Latin `.woff2` web fonts (`Bricolage Grotesque`, `Instrument Serif`, `Manrope`) and studio webp graphics.
  - 0% backend changes made: `src/` routes, database, and business logic remain 100% untouched.
  - All 13 test suites (`npm test`) executed and passed cleanly (100% PASS).
  - Headless browser verification via Microsoft Edge engine confirmed clean visual rendering for both the homepage (`/`) and the unified application shell (`/app.html`).
  - Tuned `.footer__wordmark` responsive font clamp from 14.2vw to 10.2vw across `homepage-studio.css` and `site.css` so the 15-character title 'MAHI TECH GROUP' fits cleanly within the container on all viewports (from 360px up to 1920px) without any letter clipping.

- **Full Frontend Live API Wiring & WebSocket Integration**:
  - Built `public/js/app/api.js`: Unified API client managing auth tokens, Bearer headers, automatic error formatting, and session invalidation.
  - Built `public/js/app/ws.js`: Real-time WebSocket client with multiplexing, ping/pong heartbeat, exponential reconnect, and fallback polling.
  - Wired all 10 frontend view modules (`admin.js`, `disputes.js`, `ideas.js`, `meetings.js`, `member.js`, `projects.js`, `public.js`, `signing.js`, `superadmin.js`, `shell.js`) and store methods to live backend routes with robust local fallback.
  - Aligned signup password validation in `public/signup.html` to minimum 8 characters to match backend security schema.
  - Verified 100% of 62 local ES module imports resolve cleanly with zero broken paths (`scripts/verify-imports.cjs`).
  - Executed 48-test comprehensive smoke test suite across local (`http://localhost:4000`) and production (`https://oviaxe.com`): 48/48 PASS (100%).
  - Executed automated headless browser verification in Microsoft Edge via Playwright (`scripts/verify-browser-ui.cjs`): 0 console errors, 0 network errors, and captured verified screenshot `scripts/browser-verified-workspace.png`.
  - All 13 core platform test suites (`npm test`) executed and passed cleanly (13/13 PASS).

- **Final Integration Hardening & Decision Ledger (B.1–B.7)**:
  - Restored single-flight token refresh queue in `public/js/app/api.js` (`POST /api/auth/refresh`), eliminating infinite refresh loops.
  - Eliminated mock fallback on production code path in `store.js`, `views/member.js`, and `views/admin.js`, enforcing strict database-grounded values.
  - Fixed manual logout in `store.js` and `shell.js`: sent `Authorization: Bearer <token>` to revoke server session prior to storage clearance, and excluded `/auth/logout` from the 401 interceptor.
  - Retained `src/server.js` PM2 environment detection per user decision.
  - Recorded complete architectural decisions B.1–B.7 in `docs/decisions.md`.

- **Oviaxe-Updated-UI-1 Integration & Blank Workspace Fix**:
  - Integrated all modules from `Oviaxe-Updated-UI-1`: `ai.js`, `notifications.js`, `project-work.js`, and `views/ai-center.js`.
  - Added AI Settings tab and Broadcast Notification modal to Admin Panel (`views/admin.js`) with live backend persistence.
  - Eliminated dummy role selector buttons and mock-role switches (`[data-demo-role]`, `<div class="demo-box">`) in `views/public.js`.
  - Re-routed landing page CTAs from legacy `#/role-selection` to `#/login` across `public/index.html` and `public/js/data/site.js`.
  - Resolved fatal blank screen bug (`TypeError: Cannot read properties of null (reading 'status')`):
    - Added immediate top-level redirection from `/role-selection` to `#/login` in `public/js/app/index.js`.
    - Added null-safety defensive guards in `public/js/app/shell.js` across `shellHTML()`, `navigation()`, `countFor()`, `openAccountDrawer()`, and `searchItems()`.
  - Merged and reconciled diverged remote history into `master` using clean `ours` strategy and successfully pushed commit `84a2f7f` to GitHub repository `Munnabhai63/mahi-tech-group`.
  - All 13 backend test suites (`npm test`) pass cleanly (100% PASS).
  - All 20 frontend JavaScript files compile cleanly (`node --check`).

- **100% Oviaxe UI Login Section & Role Selection Restoration**:
  - Restored the 100% original Oviaxe UI login form layout in `public/js/app/views/public.js`:
    - Email address input with placeholder `you@example.com`
    - Password input with placeholder `At least 8 characters` and SVG eye toggle
    - `Remember this demo` checkbox and `Recovery options` self-service dialog
    - Submit button: `Continue to role selection ↗` (supporting both real credential authentication and demo preview)
    - Restored the dedicated 1-click `.demo-box` ("Enter with a demo identity — No password needed") with all 6 role buttons: `Researcher`, `UI/UX Designer`, `Developer`, `Producer / Tester`, `Admin`, and `Former member`.
  - Restored full interactive `renderRoleSelection()` in `views/public.js` and enabled `/role-selection` routing in `index.js` with zero blank screen errors.
  - Hardened `store.js` (`state.data` initialization, `loginAs`, and `loginFormer`) ensuring `currentUser()` is always non-null.
  - Verified live in browser:
    - Login view: `login_page_view_1793064689963.png`
    - Developer workspace: `dashboard_page_view_1793064709028.png`
    - Role selection screen: `role_selection_screen_1793064761032.png`
  - All 13 test suites pass cleanly (`npm test`: 13/13).
  - All 20 frontend JavaScript files syntax checked clean (`node --check`).

- **Core Platform Hardening & Bug Fixes 1, 2, 3A-3J (100% Pass & Zero Regression)**:
  - **Bug Fix 1 (Critical Voting Boundary)**: Corrected threshold evaluation logic in `src/services/votingService.js` to use safe rounded floating-point comparison with inclusive boundary (`safeGreen >= safeThreshold`). Verified with `scripts/verify-bug1-boundary.js` returning `APPROVED` for exactly 70.00% green votes.
  - **Bug Fix 2 (SQLite WAL Mode & Concurrency)**: Enabled `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;` on connection startup in `src/db/database.js` with `[DB] WAL mode enabled` logging, resolving database lock contentions under concurrent operations.
  - **Bug Fix 3 (10 Test Harness Scripts 3A-3J)**:
    - `3A (run-step7-tests.js)`: Aligned static asset assertions to `legacy-dashboard.html` for 4-corner workspace. (PASS)
    - `3B (run-step08-tests.js)`: Added 1500ms pacing delay to avoid rate limiting 429s; recognized design tasks in parallel pipeline. (PASS)
    - `3C (run-step08-revision-tests.js)`: Hardened task-assignee authorization and Kanban verification. (PASS)
    - `3D (run-step08-followup-tests.js)`: Fixed unquoted SQL literal (`status = 'active'`) and added login pacing delay. (PASS)
    - `3E (run-step12-meeting-tests.js)`: Filtered persistent notification lookups by meeting title to prevent cross-run collisions. (PASS - 16/16)
    - `3F (run-step13-final-qa-tests.js)`: Aligned DOM assertions to `legacy-dashboard.html` for desktop/mobile viewport tests. (PASS - 82/82)
    - `3G (run-step3-tests.js)`: Added explicit quorum resets ensuring clean evaluation of 70% boundary. (PASS - 12/12)
    - `3H (run-step4-tests.js)`: Supported password update fallback for existing test accounts. (PASS - 9/9)
    - `3I (run-step04-amendment-tests.js)`: Aligned user setup with bcrypt updates. (PASS - 6/6)
    - `3J (run-step14-superadmin-tests.js)`: Verified full 6-layer Superadmin lifecycle under WAL mode without locks. (PASS - 45/45, 265/265 assertions)
  - **Regression Verification**: Official test suite `npm test` executed and verified: 13/13 PASS (100%), confirming zero regressions across all core subsystems.

- **PRD 16 Layer 1: Dynamic Point-Pool & Multi-Member Participation Schema (100% COMPLETE)**:
  - Added `claim_locked_by` and `claim_locked_at` to `pipeline_checklist_points`.
  - Created `point_pool_claims` table with append-only delete trigger (`prevent_claim_delete`) and 4 composite indexes.
  - Created `participation_thresholds` table with `UNIQUE(project_id)`, default `threshold_pct = 20.00`, and default `abandonment_days = 7`.
  - Created `point_tool_links` table with `deleted_at` column for soft deletes and 2 indexes.
  - Added `is_blocked`, `block_reason`, `unblocked_by`, and `unblocked_at` to `revenue_splits`.
  - Updated `prevent_revenue_splits_update` trigger to permit participation gate updates while keeping financial records strictly immutable.
  - Verified with `scripts/verify-prd16-layer1.js` (48/48 checks pass).
  - All test suites verified clean: `npm test` (13/13 PASS), Step 6 tests (7/7 PASS), PRD 15 tests (67/67 PASS).

- **PRD 16 Layer 2: Core Services Implementation (100% COMPLETE)**:
  - Created `src/services/pointPoolService.js` implementing all 13 core functions in exact specified order: `claimPoint`, `releasePoint`, `getPointPool`, `getAbandonedPoints`, `computeParticipationPct`, `computeOverallParticipationPct`, `applyParticipationBlocks`, `unblockRevenueSplit`, `setThreshold`, `getThreshold`, `addToolLink`, `getToolLinks`, `deleteToolLink`.
  - Updated `src/services/pipelineService.js`:
    - `claimPoint()` now sets `claim_locked_by`, `claim_locked_at`, and creates `point_pool_claims` record without duplicating validation.
    - `approvePoint()` now calls `computeParticipationPct()`, checks at-risk zone (`overallPct < threshold + 10%`), sends warning notifications, and returns `{ updatedPoint, stagePercent, participationUpdate }`.
    - `adminApproveLive()` calls `applyParticipationBlocks(projectId)` and returns `{ project, blockedMembers }`.
  - Updated `src/services/payoutService.js`:
    - Added participation gate check in `requestWithdrawal()` returning 400 with descriptive error if revenue splits are blocked.
    - Added payout calculation functions `getEligiblePayoutSplits()` and `calculateEligiblePayout()` with `WHERE is_blocked = 0` filter.
  - Implemented unit test suite in `scripts/verify-prd16-layer2.js` covering all 26 test scenarios with real DB calls: 62/62 checks passed.
  - Full regression test run:
    - `node scripts/verify-prd16-layer2.js` -> 62/62 PASS
    - `npm test` -> 13/13 PASS
    - `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS
    - `node scripts/run-step6-tests.js` -> 7/7 PASS

- **PRD 16 Layer 3: API Routes Implementation (100% COMPLETE)**:
  - Created `src/routes/pointPool.routes.js` with all 13 routes wired strictly as thin controllers to `pointPoolService.js`:
    - Point Pool Management (4 routes): `GET /projects/:projectId/pool`, `PATCH /points/:id/claim`, `PATCH /points/:id/release`, `GET /projects/:projectId/abandoned`.
    - Participation Tracking (2 routes): `GET /projects/:projectId/participation`, `GET /projects/:projectId/participation/me`.
    - Participation Threshold (2 routes): `GET /projects/:projectId/threshold`, `PATCH /projects/:projectId/threshold`.
    - Revenue Block / Unblock (2 routes): `GET /projects/:projectId/revenue-blocks`, `PATCH /revenue-splits/:splitId/unblock`.
    - Tool Links (3 routes): `POST /points/:id/tools`, `GET /points/:id/tools`, `DELETE /points/:id/tools/:toolId` (and `/tools/:toolId`).
  - Registered router in `src/app.js` under prefix `/api/pointpool`.
  - Enforced strict static-before-parameterized route ordering and server-side RBAC (JWT lookup, zero body role trust, project membership check).
  - Implemented end-to-end integration test suite `scripts/verify-prd16-layer3.js` testing 29 HTTP route scenarios with real tokens and real HTTP requests: 29/29 PASS.
  - **PRD 16 Layer 4: Frontend Views Implementation (100% COMPLETE)**:
  - Created 4 dedicated frontend views + JS controllers:
    - `public/point-pool-board.html` & `public/js/point-pool-board.js`: Per-project, 4-stage Kanban-style point pool board with role-verified claiming, in-place card updates, Lead/Admin release modals, and collapsible abandoned points section.
    - `public/participation-dashboard.html` & `public/js/participation-dashboard.js`: Participation % dashboard with "My Participation" shortcut card, live threshold bar, per-member metrics table with AT-RISK and REVENUE BLOCKED badges, and Admin-only revenue block unblocking panel with client/server 10-char reason enforcement.
    - `public/js/tool-links-panel.js`: Reusable inline tool links component embedded into point cards with protocol validation, display-only quick suggestions (Notion, GitHub, Figma, Jira, Trello), connect form, and owner/Lead soft-delete.
    - `public/admin-threshold.html` & `public/js/admin-threshold.js`: Admin-only threshold settings page with project selector, threshold % (0-100) and abandonment days (1-30) configuration, and LIVE project frozen indicator.
  - Wired navigation integration:
    - Added "Point Pool" and "Participation %" tabs and embedded iframes in `public/js/app/views/projects.js`.
    - Added "Participation Thresholds" sidebar item in `public/admin.html` for Admin users.
  - Implemented end-to-end integration test suite `scripts/verify-prd16-layer4.js` with 30 assertions across static serving, API frontend flow, tool links, revenue blocks, and participation % display: 30/30 PASS.
  - Full 6-suite regression verification:
    - `node scripts/run-prd16-layer1-tests.js` -> 48/48 PASS
    - `node scripts/run-prd16-layer2-tests.js` -> 62/62 PASS
    - `node scripts/verify-prd16-layer3.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer4.js` -> 30/30 PASS
    - `npm test` -> 13/13 PASS
    - `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS

- **PRD 16 Layer 5: WebSocket + DB Notifications (100% COMPLETE)**:
  - Implemented all 5 real-time WebSocket + DB notification events in `src/services/pointPoolService.js`:
    - Event 1: `pointpool_point_claimed` — triggered on `claimPoint`, notifies Project Lead, Admin, and same-stage members.
    - Event 2: `pointpool_point_released` — triggered on `releasePoint`, notifies original claimer and same-stage members with release reason.
    - Event 3: `pointpool_participation_warning` — triggered on `computeOverallParticipationPct` / `checkAndSendParticipationWarning` when overall % < threshold, with unread deduplication (`read_status = 0`), notifies member and Admin.
    - Event 4: `pointpool_revenue_blocked` — triggered on `applyParticipationBlocks` when revenue split is blocked, notifies blocked member and Admin.
    - Event 5: `pointpool_revenue_unblocked` — triggered on `unblockRevenueSplit`, notifies unblocked member with Admin's reason.
  - Implemented `sendPointPoolNotification` helper ensuring persistent `notifications` table inserts (parameterized queries) and targeted WebSocket pushes via `pushToUser` (zero global broadcast leakage).
  - Created test suite `scripts/verify-prd16-layer5.js` with 29 assertions across all 5 event groups testing real HTTP requests, real DB inserts, and live WebSocket message delivery: 29/29 PASS.
  - Full 7-suite regression verification:
    - `node scripts/run-prd16-layer1-tests.js` -> 48/48 PASS
    - `node scripts/run-prd16-layer2-tests.js` -> 62/62 PASS
    - `node scripts/verify-prd16-layer3.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer4.js` -> 30/30 PASS
    - `node scripts/verify-prd16-layer5.js` -> 29/29 PASS
    - `npm test` -> 13/13 PASS
    - `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS

- **PRD 16 Layer 6: Full Integration + Regression + Git Commit (100% COMPLETE — PRD 16 PERMANENTLY SEALED)**:
  - Created end-to-end integration test suite `scripts/verify-prd16-layer6-integration.js` covering a complete real-world lifecycle across all 5 layers:
    - Phase A (Setup): Real admin & 4 member registrations (researcher, designer, developer, tester), project auto-creation, project member assignments, deliverable creation, and 4 weighted checklist points across all 4 stages.
    - Phase B (Point Pool Flow): Researcher claims point (CLAIMED + claim_locked_by), role mismatch 403 / 409 rejection, designer claims design point, lead releases with documented reason (UNCLAIMED), GET /abandoned returns released point, researcher re-claims (new append-only claim row).
    - Phase C (Tool Links Flow): Researcher adds tool link (Notion URL, 201), GET /tools returns active link, non-owner delete rejected (403), owner soft delete verified (200, deleted_at set), GET /tools returns 0 active tools.
    - Phase D (Participation % Flow): Pipeline approval of research point, researcher GET /participation/me shows >0%, Admin sees all members, designer (0 approved points) sees only self with 0.00%.
    - Phase E (Threshold + Block Flow): Admin sets threshold = 30%, abandonment_days = 5, applyParticipationBlocks blocks designer (is_blocked = 1) while researcher is unblocked, Admin unblocks designer with ≥10 char reason, GET /revenue-blocks returns 0 blocked splits.
    - Phase F (Notification Verification): Verified DB notification rows and correct links for all 5 events (claimed, released, warning, blocked, unblocked) with read_status = 0.
    - Phase G (Threshold Freeze Test): Project status transitioned to LIVE, PATCH /threshold rejected with 400 (frozen).
    - Phase H (Final Pool State): All 4 stages present in /pool, researcher has highest %, /abandoned is empty.
  - Integration suite passed: **34/34 assertions PASS**.
  - Generated full documentation in `docs/16_POINT_POOL_PARTICIPATION.md`.
  - Full 8-suite regression pass across entire platform:
    - `node scripts/run-prd16-layer1-tests.js` -> 48/48 PASS
    - `node scripts/run-prd16-layer2-tests.js` -> 62/62 PASS
    - `node scripts/verify-prd16-layer3.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer4.js` -> 30/30 PASS
    - `node scripts/verify-prd16-layer5.js` -> 29/29 PASS
    - `npm test` -> 13/13 PASS
    - `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS
    - `node scripts/verify-prd16-layer6-integration.js` -> 34/34 PASS
    - **Total Passing Tests**: **312 / 312 tests passing (100%)**.
  - **PRD 16 Status**: PERMANENTLY SEALED.

- **PRD 17 Batch 1: Database Schema + GitHub App Configuration (100% COMPLETE)**:
  - Added 4 new tables for GitHub automation in `src/db/schema.sql`, `database/schema.sql`, and `src/db/database.js`:
    - `user_github_links`: maps platform user to GitHub username with index on `user_id`.
    - `project_github_repos`: tracks project GitHub repos with status CHECK (`PENDING`, `ACTIVE`, `ARCHIVED`, `FAILED`) and indexes on `project_id` and `status`.
    - `project_github_memberships`: per-member GitHub team membership with role CHECK (`researcher`, `designer`, `developer`, `tester`, `lead`, `admin`), status CHECK (`ACTIVE`, `REMOVED`), `UNIQUE(project_id, user_id)`, and 3 indexes.
    - `github_webhook_log`: immutable append-only webhook event log with 3 indexes and 2 triggers (`prevent_webhook_log_update`, `prevent_webhook_log_delete`).
  - Created and executed migration script `scripts/migrate-prd17-batch1.js` with WAL mode, 5000ms busy_timeout, schema creation, and webhook log trigger sanity check.
  - Updated `.env.example` with GitHub App configuration keys (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_ORG_NAME`, `GITHUB_APP_INSTALLATION_ID`).
  - Updated `.gitignore` to strictly exclude `certs/` and `*.pem` files.
  - Implemented config loader `src/config/github.config.js` reading process.env, loading private key via `fs.readFileSync`, performing fail-fast validations on load, and exporting frozen config without leaking secrets.
  - Created test suite `scripts/verify-prd17-batch1.js` with 20 real DB and config assertions: **20 / 20 PASS**.
  - Verified full 9-suite regression pass:
    - `node scripts/run-prd16-layer1-tests.js` -> 48/48 PASS
    - `node scripts/run-prd16-layer2-tests.js` -> 62/62 PASS
    - `node scripts/verify-prd16-layer3.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer4.js` -> 30/30 PASS
    - `node scripts/verify-prd16-layer5.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer6-integration.js` -> 34/34 PASS
    - `npm test` -> 13/13 PASS
    - `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS
    - `node scripts/verify-prd17-batch1.js` -> 20/20 PASS
    - **Total Passing Tests**: **332 / 332 tests passing (100%)**.

- **PRD 17 Batch 2: Core GitHub Automation Service (100% COMPLETE)**:
  - Installed dependencies: `@octokit/rest` (v22.0.1) and `jsonwebtoken` (v9.0.3).
  - Built core GitHub automation service in `src/services/githubAutomation.service.js`:
    - `generateJWT()`: Generates short-lived RS256 JWT using private key from config, 60s clock skew buffer, 10m expiry, iss = appId. Never logs private key or JWT.
    - `getInstallationToken()`: Exchanges JWT for short-lived Installation Access Token, caches in-memory with expiration date, auto-refreshes when <= 60s remaining.
    - `getAuthedOctokit()`: Returns authenticated Octokit instance using cached installation token.
    - `createProjectRepo(projectId, projectName)`: Sanitizes project name to `mahi-${slug}`, max 50 chars, creates private repo with auto_init, inserts into `project_github_repos` with status `ACTIVE` or `FAILED`.
    - `createGitFlowBranches(repoFullName)`: Sequential branch setup: `develop` from `main`, then `feature/research`, `feature/design`, `feature/dev`, `feature/test` from `develop`; catches 422 warning without throwing.
    - `createProjectTeams(projectId, repoFullName)`: Creates 6 per-role teams (`researcher`, `designer`, `developer`, `tester`, `lead`, `admin`), binds fine-grained permissions (`push`, `maintain`, `admin`).
    - `setBranchProtection(repoFullName)`: Configures branch protection rules on `main` and `develop`.
    - `addMemberToTeam(projectId, userId, role)`: Verifies user GitHub link, adds user to org team, inserts `project_github_memberships`, logs `GITHUB_MEMBER_ADDED` in `access_log`.
    - `removeMemberFromTeam(projectId, userId, reason)`: Removes user from team, updates `project_github_memberships` status to `REMOVED` with reason and timestamp, preserves permanent attribution, logs `GITHUB_MEMBER_REMOVED` in `access_log`.
    - `linkUserGitHub(userId, githubUsername, githubNodeId, linkedBy)`: Verifies user, prevents duplicate links, records in `user_github_links`, logs `GITHUB_ACCOUNT_LINKED` in `access_log`.
    - `archiveProjectRepo(projectId)`: Calls GitHub API to archive repo, updates `project_github_repos` to `ARCHIVED`, logs `GITHUB_REPO_ARCHIVED` in `access_log`.
    - `setupProjectGitHub(projectId, projectName)`: Master orchestrator executing repo, branch, team, and protection setup sequentially, updates `status = 'FAILED'` on error.
  - Implemented unit & integration test suite `scripts/verify-prd17-batch2.js` with 26 assertions across all 8 required groups plus orchestrator integration tests: **26 / 26 PASS**.
  - Verified full 10-suite regression pass:
    - `node scripts/run-prd16-layer1-tests.js` -> 48/48 PASS
    - `node scripts/run-prd16-layer2-tests.js` -> 62/62 PASS
    - `node scripts/verify-prd16-layer3.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer4.js` -> 30/30 PASS
    - `node scripts/verify-prd16-layer5.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer6-integration.js` -> 34/34 PASS
    - `npm test` -> 13/13 PASS
    - `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS
    - `node scripts/verify-prd17-batch1.js` -> 20/20 PASS
    - `node scripts/verify-prd17-batch2.js` -> 26/26 PASS
    - **Total Passing Tests**: **358 / 358 tests passing (100%)**.

- **PRD 17 Batch 3: Webhook Receiver + Signature Verification + Sync (100% COMPLETE)**:
  - Created webhook HMAC-SHA256 signature middleware in `src/middleware/githubWebhookVerify.js`:
    - Uses Node.js built-in `crypto.timingSafeEqual` with buffer length guard against timing attacks.
    - Validates `X-Hub-Signature-256` header against raw request buffer (never parsed JSON).
    - Rejects invalid/missing signatures with HTTP 401 and logs audit entry into `github_webhook_log` (`signature_valid = 0`).
  - Implemented webhook routing in `src/routes/githubWebhook.routes.js`:
    - Mounted at `/api/github` using `express.raw({ type: 'application/json' })` strictly BEFORE global `express.json()`.
    - Implemented idempotent delivery logging in `github_webhook_log` with UNIQUE constraint on `delivery_id` (gracefully returning HTTP 200 `{ status: 'duplicate', skipped: true }`).
    - Immediate non-blocking HTTP 200 acknowledgement (`{ status: 'received' }`) with asynchronous processing via `setImmediate`.
  - Implemented webhook event processor in `src/services/githubWebhookProcessor.js`:
    - `push`: Dispatches `github_push` platform notifications to Project Lead and Admins.
    - `pull_request`: Dispatches `github_pr_opened`, `github_pr_closed`, and `github_pr_merged` notifications to Project Lead and Admins.
    - `member`: Logs audit entry (`GITHUB_WEBHOOK_MEMBER_ADDED`) on addition; executes team offboarding via `removeMemberFromTeam(projectId, userId, 'Removed via GitHub webhook')` on removal.
    - `repository`: Marks repo `ARCHIVED` on archive action; marks repo `FAILED` and dispatches alerts on delete action.
    - Updates `github_webhook_log.processed = 1` or captures `error_message`.
  - Updated SQLite trigger via `scripts/migrate-prd17-batch3.js`:
    - Updated `prevent_webhook_log_update` trigger to permit updates ONLY to `processed` and `error_message` while strictly blocking mutations to immutable fields (`delivery_id`, `event_type`, `payload`, `signature_valid`, `received_at`).
    - Documented Decision 11 in `docs/decisions.md`.
  - Created test suite `scripts/verify-prd17-batch3.js` with 25 assertions across 6 groups: **25 / 25 PASS**.
  - Verified full 11-suite regression pass:
    - `node scripts/run-prd16-layer1-tests.js` -> 48/48 PASS
    - `node scripts/run-prd16-layer2-tests.js` -> 62/62 PASS
    - `node scripts/verify-prd16-layer3.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer4.js` -> 30/30 PASS
    - `node scripts/verify-prd16-layer5.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer6-integration.js` -> 34/34 PASS
    - `npm test` -> 13/13 PASS
    - `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS
    - `node scripts/verify-prd17-batch1.js` -> 20/20 PASS
    - `node scripts/verify-prd17-batch2.js` -> 26/26 PASS
    - `node scripts/verify-prd17-batch3.js` -> 25/25 PASS
    - **Total Passing Tests**: **383 / 383 tests passing (100%)**.

- **PRD 17 Batch 4: Frontend — GitHub Settings Panel & Backend API (100% COMPLETE)**:
  - Created backend API router in `src/routes/githubSettings.routes.js` mounted at `/api/github/settings` with 9 endpoints:
    - `POST /link-account`: Allows authenticated users to link their GitHub username & Node ID.
    - `GET /my-link`: Returns user's linked GitHub account details or `{ linked: false }`.
    - `POST /admin/link-member`: Admin-only linking on behalf of team members.
    - `GET /projects/:projectId/repo`: Returns project repository metadata, status, default branch, and timestamps.
    - `GET /projects/:projectId/members`: Admin-only view of project GitHub team memberships and attribution history.
    - `POST /projects/:projectId/members/:userId/add`: Adds member to GitHub role sub-team (`researcher`, `designer`, `developer`, `tester`, `lead`).
    - `DELETE /projects/:projectId/members/:userId`: Soft-removes member with >= 10-char reason; permanently retains row for attribution.
    - `GET /webhook-log`: Admin-only paginated audit log with filtering by event type; strictly suppresses sensitive `payload` column.
    - `POST /projects/:projectId/setup`: Admin-only orchestrator setting up repo, GitFlow branches, sub-teams, and branch protection.
    - Static sub-paths strictly ordered before parameterized routes.
  - Mounted router in `src/app.js` using standard `express.json()` parser while constraining `express.raw()` specifically to `/api/github/webhook`.
  - Built 4 platform UI views:
    - View 1 (`public/github-link.html`, `public/js/github-link.js`): Self-linking card with green connected badge, Node ID help tooltip, and Admin linking panel for members.
    - View 2 (`public/github-repo-panel.html`, `public/js/github-repo-panel.js`): Repo status card (ACTIVE / ARCHIVED / FAILED), GitFlow branch architecture display, "Open on GitHub" (`target="_blank" rel="noopener noreferrer"`), and Admin repo provisioning modal with loading spinner.
    - View 3 (`public/github-members.html`, `public/js/github-members.js`): Admin-only team membership table with active/removed badges, inline Add Member form (excluding admin role), and Remove Member modal with >= 10-char validation preserving attribution.
    - View 4 (`public/github-webhook-log.html`, `public/js/github-webhook-log.js`): Admin-only audit log with live 30s polling, delivery deduplication, event filters, and signature validity badges.
  - Navigation integrations:
    - Added "GitHub Account" link to profile header and account drawer in `public/profile.html` and `public/js/app/shell.js`.
    - Added "GitHub" tab embedding `/github-repo-panel.html?projectId=${project.id}` in `public/js/app/views/projects.js`.
    - Added "GitHub Teams" (`/github-members.html`) and "Webhook Log" (`/github-webhook-log.html`) to Admin sidebar in `public/admin.html` and `public/js/app/shell.js`.
  - Created test suite `scripts/verify-prd17-batch4.js` with 32 assertions across 6 groups: **32 / 32 PASS**.
  - Verified full 12-suite regression pass (415 / 415 assertions passing cleanly):
    - `node scripts/run-prd16-layer1-tests.js` -> 48/48 PASS
    - `node scripts/run-prd16-layer2-tests.js` -> 62/62 PASS
    - `node scripts/verify-prd16-layer3.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer4.js` -> 30/30 PASS
    - `node scripts/verify-prd16-layer5.js` -> 29/29 PASS
    - `node scripts/verify-prd16-layer6-integration.js` -> 34/34 PASS
    - `npm test` -> 13/13 PASS
    - `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS
    - `node scripts/verify-prd17-batch1.js` -> 20/20 PASS
    - `node scripts/verify-prd17-batch2.js` -> 26/26 PASS
    - `node scripts/verify-prd17-batch3.js` -> 25/25 PASS
    - `node scripts/verify-prd17-batch4.js` -> 32/32 PASS
    - **Total Passing Tests**: **415 / 415 tests passing (100%)**.

- **PRD 17 Batch 5: Full Integration + Documentation + Platform Seal (100% COMPLETE)**:
  - Created end-to-end integration test suite `scripts/verify-prd17-batch5-integration.js` covering complete usage lifecycle across Phases A–H:
    - Phase A: Pre-Flight Setup (Admin, 4 Members registered/approved/logged in, project auto-created, 4 members assigned).
    - Phase B: GitHub Account Linking (4 members + Admin self-link, duplicate link rejected with 409, non-existent user link rejected with 404).
    - Phase C: Project GitHub Setup (Admin setup returns 200 ACTIVE, duplicate setup returns 400, non-admin rejected with 403).
    - Phase D: Team Membership Management (Admin adds researcher 200, duplicate add 409, all 4 roles active, soft removal with >=10 char reason preserves attribution, member list returns 1 REMOVED + 3 ACTIVE).
    - Phase E: Webhook Ingestion (Push event 200 received + processed=1, PR opened event 200 + notification created, invalid signature 401 logged, duplicate delivery 200 skipped: true idempotency).
    - Phase F: Webhook Log Audit (Admin GET 200 total>0, sensitive payload strictly excluded, eventType filter verified, non-admin 403).
    - Phase G: Repo Status Verification (Member GET 200 status=ACTIVE, unauthenticated GET 401).
    - Phase H: Cross-System Consistency (5 user_github_links, 4 project_github_memberships, access_log audit trail, archiveProjectRepo transitions to ARCHIVED).
  - Integration suite result: **54 / 54 PASS (100%)**.
  - Executed full 13-suite regression verification: **469 / 469 assertions passing (100%)**:
    1. `node scripts/run-prd16-layer1-tests.js` -> 48/48 PASS
    2. `node scripts/run-prd16-layer2-tests.js` -> 62/62 PASS
    3. `node scripts/verify-prd16-layer3.js` -> 29/29 PASS
    4. `node scripts/verify-prd16-layer4.js` -> 30/30 PASS
    5. `node scripts/verify-prd16-layer5.js` -> 29/29 PASS
    6. `node scripts/verify-prd16-layer6-integration.js` -> 34/34 PASS
    7. `npm test` -> 13/13 PASS
    8. `node scripts/run-step15-pipeline-tests.js` -> 67/67 PASS
    9. `node scripts/verify-prd17-batch1.js` -> 20/20 PASS
    10. `node scripts/verify-prd17-batch2.js` -> 26/26 PASS
    11. `node scripts/verify-prd17-batch3.js` -> 25/25 PASS
    12. `node scripts/verify-prd17-batch4.js` -> 32/32 PASS
    13. `node scripts/verify-prd17-batch5-integration.js` -> 54/54 PASS
  - Authored comprehensive architecture documentation in `docs/17_GITHUB_AUTOMATION.md`.

---

## Platform Build: 100% COMPLETE

| Phase            | PRD/Step | Status  | Commit     |
|------------------|----------|---------|------------|
| Core (01-14)     | Steps    | SEALED  | multiple   |
| 4-Role Pipeline  | PRD 15   | SEALED  | 5bf0a3a    |
| Point-Pool       | PRD 16   | SEALED  | e8a7c6e    |
| GitHub Automation| PRD 17   | SEALED  | 6558f93    |

### System Totals & Metrics
- **Total DB Tables**: 43 core tables (39 from PRDs 15+16 + 4 from PRD 17; 46 active in SQLite)
- **Total DB Triggers**: 19 core triggers (20 active in SQLite)
- **Total Test Assertions**: 469 passing assertions across 13 test suites (100% PASS)
- **Total Backend Service Files**: 25 files:
  1. `aiNotesService.js`
  2. `assetService.js`
  3. `auditService.js`
  4. `coworkingService.js`
  5. `dashboardService.js`
  6. `disputeService.js`
  7. `emailService.js`
  8. `fanoutService.js`
  9. `gatewayService.js`
  10. `githubAutomation.service.js`
  11. `githubWebhookProcessor.js`
  12. `governanceService.js`
  13. `meetingService.js`
  14. `notificationService.js`
  15. `offboardingService.js`
  16. `payoutService.js`
  17. `pipelineService.js`
  18. `pointPoolService.js`
  19. `quotaService.js`
  20. `revenueService.js`
  21. `signService.js`
  22. `superadminService.js`
  23. `ticketService.js`
  24. `votingService.js`
  25. `wsService.js`
- **Total Frontend Views**: 15 HTML view files in `public/`:
  1. `admin-threshold.html`
  2. `admin.html`
  3. `app.html`
  4. `github-link.html`
  5. `github-members.html`
  6. `github-repo-panel.html`
  7. `github-webhook-log.html`
  8. `index.html`
  9. `legacy-dashboard.html`
  10. `participation-dashboard.html`
  11. `point-pool-board.html`
  12. `profile.html`
  13. `sign.html`
  14. `signup.html`
  15. `superadmin.html`
  *(plus 10 modular views in `public/js/app/views/`: `admin.js`, `ai-center.js`, `disputes.js`, `ideas.js`, `meetings.js`, `member.js`, `projects.js`, `public.js`, `signing.js`, `superadmin.js`)*
- **PRD 19 OKR System — Layers 1, 2, 3 & 4 (100% COMPLETE & VERIFIED)**:
  - **Layer 1 (Database & Triggers)**: 5 tables (`okr_objectives`, `okr_key_results`, `okr_checkins`, `okr_alignment_links`, `okr_history`), 11 composite indexes, and 6 append-only SQLite triggers (`prevent_okr_checkin_update`, `prevent_okr_checkin_delete`, `prevent_okr_alignment_update`, `prevent_okr_alignment_delete`, `prevent_okr_history_update`, `prevent_okr_history_delete`). Verified with `scripts/verify-prd19-layer1.js` (29/29 PASS).
  - **Layer 2 (Objective Service & APIs)**: Full Objective CRUD, alignment tree building, privacy isolation (Rule 8), archived read-only enforcement (Rule 7), and change logging in `okr_history` (Rule 10). Verified with `scripts/verify-prd19-layer2.js` (31/31 PASS).
  - **Layer 3 (Key Result Service & Circular Chain Detection)**: 4 KR types (`PERCENTAGE`, `NUMBER`, `BOOLEAN`, `MILESTONE`), KR CRUD APIs, target validation (Rule 4: `target_value > 0`), and BFS-based graph traversal detecting and preventing multi-hop circular alignments (`wouldCreateCycle`: A -> B -> C -> A blocked with HTTP 400). Verified with `scripts/verify-prd19-layer3.js` (25/25 PASS).
  - **Layer 4 (Check-in Service & Bottom-Up Hierarchy Propagation)**:
    - Built `submitCheckin`: writes immutable check-in row to `okr_checkins`, updates `okr_key_results` `current_value` & `progress_pct`, auto-updates KR status (`COMPLETED` at $\ge 100\%$, `OFF_TRACK` if $< 30\%$ with due date $\le 7$ days, `AT_RISK` on LOW confidence).
    - Built `recalculateObjectiveHierarchy`: server-side bottom-up recalculation computing Objective `progress_pct` (average of KRs, or 50/50 weighted average of own KRs and aligned child objectives), auto-propagating up parent chains (Leaf Individual -> Mid Team -> Root Company).
    - Enforced Rule 5: BOOLEAN KR accepts only 0 or 1 as `new_value`.
    - Auto-transitions objective status to `COMPLETED` when overall `progress_pct` reaches 100.00%.
  - **Layer 5 (Frontend 4 Views Implementation — 100% COMPLETE & VERIFIED)**:
    - **View 1: OKR Dashboard (`public/okr-dashboard.html`)**: Dark-themed responsive dashboard with company health dial, KPI cards (Company, Team, My Individual), active cycle filter, dynamic card rendering, drilldown links to detail views, and new objective creation modal.
    - **View 2: Objective Detail (`public/okr-objective-detail.html`)**: Complete objective overview, server-calculated progress bar, Key Results listing with status badges and current/target indicators, "Add Key Result" modal (supporting PERCENTAGE, NUMBER, BOOLEAN, MILESTONE), alignment hierarchy tree (parent + child goals), and append-only change audit history table.
    - **View 3: Check-in Modal (`#checkinModal` inside `okr-objective-detail.html`)**: Interactive modal component with value input, 0/1 toggle support for BOOLEAN, confidence selector (HIGH, MEDIUM, LOW), optional note textarea, immediate on-screen progress recalculation hook, and past check-in history table from `GET /api/okr/checkins/:krId`.
    - **View 4: OKR Alignment Tree (`public/okr-alignment.html`)**: Full cascading visual tree hierarchy (Company -> Team -> Individual) with expandable/collapsible nodes, color-coded borders (green $\ge 70\%$, yellow $40-69\%$, red $< 40\%$), owner avatar with initials, search filter, and Admin/Producer access guard.
  - **Layer 6 (Full End-to-End Integration & System Verification — 100% COMPLETE & VERIFIED)**:
    - Authored comprehensive integration test suite `scripts/verify-prd19-integration.js`.
    - Executed 10-phase verification: real login authentication, real 3-tier objective creation (Company -> Team -> Individual), all 4 KR types (`PERCENTAGE`, `BOOLEAN`, `MILESTONE`, `NUMBER`), real check-in submissions, multi-tier bottom-up rollup verified with direct SQLite DB `SELECT` queries on every tier, 100% completion auto-status transitions to `COMPLETED`, visual alignment tree traversal, circular alignment detection (`A -> B -> C -> A` blocked with HTTP 400), security scan confirming zero hardcoded credentials in public HTML views, and complete Definition of Done checklist run.
    - Integration suite result: **69 / 69 PASS (100%)**.
    - Cumulative PRD 19 verification across all 6 layers: **263 / 263 PASS (100%)**.
    - Total platform regression verification: **all 469 existing tests passing cleanly (100%)**. Total platform assertions: **732 / 732 PASS**.
- **PRD 20 Gantt Chart & Timeline View — Reverse Engineering & Layer 1 (100% COMPLETE & VERIFIED)**:
  - **Reverse Engineering Mandate**: Produced exhaustive Reverse Engineering Report (`docs/prd20_reverse_engineering_report.md`) dissecting 5 market competitors (Monday.com, Asana, ClickUp, Jira, Smartsheet). Discarded all competitor visual branding/copy while synthesizing underlying graph models (DAG), dependency logic (FS, SS, FF, SF + lag), CPM critical path calculation, and append-only baseline snapshots.
  - **Layer 1 Database & Triggers**:
    - Created 5 core relational tables in `src/db/schema.sql`, `src/db/database.js` (`GANTT_SCHEMA_SQL`), and `src/db/migrate.js`: `gantt_items`, `gantt_dependencies`, `gantt_milestones`, `gantt_baselines`, `gantt_history`.
    - Added 13 composite and foreign key indexes for ultra-fast timeline queries.
    - Added 6 append-only SQLite DB triggers enforcing strict immutability:
      - `prevent_gantt_dependency_update`
      - `prevent_gantt_dependency_delete`
      - `prevent_gantt_baseline_update`
      - `prevent_gantt_baseline_delete`
      - `prevent_gantt_history_update`
      - `prevent_gantt_history_delete`
    - Idempotent migration execution verified: all tables and triggers active in SQLite WAL mode.
    - Authored dedicated test suite `scripts/verify-prd20-layer1.js` verifying schema columns, trigger abort operations, unique constraints, and mutable milestones: **42 / 42 PASS (100%)**.
    - Full regression run confirmed: **13/13 test suites PASS (100%)** and **PRD 19 integration 69/69 PASS (100%)**. Total platform verified assertions: **774 / 774 PASS**.
  - **Layer 2 (Gantt Items, Dependencies with DAG Cycle Detection, Progress & Milestones — 100% COMPLETE & VERIFIED)**:
    - **Service & API Implementation (`src/services/ganttService.js`, `src/routes/gantt.routes.js`, `src/app.js`)**:
      - `POST /api/gantt/item/create`: Full item creation with Rule 1 (`end_date >= start_date`) and Rule 2 (`MILESTONE` type enforces `start_date === end_date`). Admin+ role enforced.
      - `GET /api/gantt/project/:projectId` & `GET /api/gantt/item/:itemId`: Full timeline rollup with item details, assignee metadata, active dependencies, milestones, and baselines.
      - `PATCH /api/gantt/item/:itemId`: General updates with Rule 4 predecessor date extension conflict detection (generates warning alerts without destructive auto-shifts). Assignees restricted to progress percentage.
      - `PATCH /api/gantt/item/:itemId/progress`: Progress updates (0–100%) with 100% auto-transitioning status to `COMPLETED`. Auto-logged to append-only `gantt_history`.
      - `DELETE /api/gantt/item/:itemId`: Item deletion protected: blocked if other active items depend on it.
      - `POST /api/gantt/dependency/add`: Directed dependency creation supporting `FINISH_TO_START`, `START_TO_START`, `FINISH_TO_FINISH`, `START_TO_FINISH` with `lag_days`. Enforces BFS DAG cycle detection (`wouldCreateGanttCycle`), strictly blocking circular chains (e.g. $A \to B \to C \to A$) with HTTP 400.
      - `DELETE /api/gantt/dependency/:dependencyId`: Soft reversal audit removal preserving append-only trigger integrity while excluding reversed links from active queries.
      - `POST /api/gantt/milestone/create`, `PATCH /api/gantt/milestone/:id/achieve`, `GET /api/gantt/milestones/:projectId`: Milestone creation and achievement progression (auto-completes linked timeline items).
      - `GET /api/gantt/history/:itemId`: Full chronological audit trail endpoint (Admin+).
    - **Verification**: Authored `scripts/verify-prd20-layer2.js` performing 41 real HTTP test assertions: **41 / 41 PASS (100%)**.
    - **Total Active Platform Test Assertions Passing**: **815 / 815 PASS (100%)**.
  - **Layer 3 (Baseline Snapshots, Schedule Slip Analysis, Critical Path Method (CPM) & Export Bundle — 100% COMPLETE & VERIFIED)**:
    - **Baseline Snapshot Engine (`POST /api/gantt/baseline/snapshot`)**:
      - Server-side append-only snapshot capture taking point-in-time state of all current item dates for a project into `gantt_baselines`.
      - Protected by SQLite triggers `prevent_gantt_baseline_update` and `prevent_gantt_baseline_delete` guaranteeing immutable audit history.
      - Auto-logs snapshot creation events to `gantt_history`. Admin+ role enforced.
    - **Planned vs Actual Schedule Slip Analysis (`GET /api/gantt/baselines/:projectId`)**:
      - Computes server-side schedule slip: `slip_days = Math.round((current_end_date - baseline_end_date) / 86400000)` and `start_slip_days`.
      - Identifies status flags (`is_delayed`, `is_ahead`, `is_on_track`) and groups multi-version snapshots for historical variance analysis.
    - **Critical Path Method (CPM) Engine (`GET /api/gantt/criticalpath/:projectId`)**:
      - 100% server-side mathematical computation using Topological Sort (Kahn's algorithm) and Longest-Path Slack analysis — zero external libraries, zero client-side calculation.
      - **Forward Pass**: Traverses directed acyclic graph (DAG) in topological order, computing Earliest Start ($ES$) and Earliest Finish ($EF$) across all dependency types (`FINISH_TO_START`, `START_TO_START`, `FINISH_TO_FINISH`, `START_TO_FINISH`) and positive/negative `lag_days`. Computes overall project makespan duration $T$.
      - **Backward Pass**: Traverses in reverse topological order, computing Latest Finish ($LF$) and Latest Start ($LS$).
      - **Slack / Float Analysis**: Total Float $\text{slack} = LS - ES = LF - EF$.
      - **Critical Path Flagging**: Automatically flags critical path items ($\text{slack} = 0$), extracts `critical_path_item_ids`, and projects ISO calendar earliest/latest start and finish dates.
    - **Gantt Export Bundle (`GET /api/gantt/export/:projectId`)**:
      - Assembles full JSON data package formatted for browser-rendered PNG/PDF exports (project metadata, items, active dependencies, milestones, baselines, and CPM analysis).
    - **Verification**: Authored `scripts/verify-prd20-layer3.js` testing 22 rigorous assertions covering RBAC, trigger aborts, schedule slip calculations, 4-task CPM network verification, milestone lag expansion, and export bundling: **22 / 22 PASS (100%)**.
  - **Layer 4 (Milestone CRUD Lifecycle, Baseline Snapshotting & Critical Path API Verification — 100% COMPLETE & VERIFIED)**:
    - **Milestone Full CRUD & Status Progression Engine**:
      - `POST /api/gantt/milestone/create`: Project milestone creation with optional link to timeline items. Admin+ role enforced.
      - `PATCH /api/gantt/milestone/:id`: Full edit capability (title, date, linked item, status) with validation.
      - `PATCH /api/gantt/milestone/:id/achieve`: Transitions status to `ACHIEVED`, sets `achieved_at = now`, and auto-completes linked timeline items (`progress_pct = 100.0`, `status = 'COMPLETED'`) with `gantt_history` audit logging.
      - `DELETE /api/gantt/milestone/:id`: Clean milestone deletion (Admin+).
      - `GET /api/gantt/milestones/:projectId`: Returns all milestones, automatically auto-marking overdue pending milestones as `MISSED` when `milestone_date < today`.
    - **Baseline Snapshot & Variance Verification**:
      - Snapshot capture (`POST /api/gantt/baseline/snapshot`) with append-only trigger immutability verified against direct SQL UPDATE and DELETE attacks.
      - Schedule slip computation (`GET /api/gantt/baselines/:projectId`) verified with positive delays, ahead-of-schedule completions, and on-track items.
    - **CPM Network Validation**:
      - Multi-task network verification demonstrating zero-slack critical chain identification ($ES, EF, LS, LF, \text{slack} = 0, \text{is\_critical} = \text{true}$) and non-critical parallel branches with positive total float ($\text{slack} = 15$).
    - **Export Payload Completeness**:
      - Confirmed `GET /api/gantt/export/:projectId` provides complete data structures for frontend timeline rendering.
    - **Verification**: Authored `scripts/verify-prd20-layer4.js` executing 21 test assertions: **21 / 21 PASS (100%)**.
    - **Full Regression Verification**:
      - `node scripts/verify-prd20-layer4.js` -> 21/21 PASS
      - `node scripts/verify-prd20-layer3.js` -> 22/22 PASS
      - `node scripts/verify-prd20-layer2.js` -> 41/41 PASS
      - `node scripts/verify-prd20-layer1.js` -> 42/42 PASS
      - `node scripts/verify-prd19-integration.js` -> 69/69 PASS
      - `npm test` -> 13/13 test suites PASS
      - **Total Platform Assertions Passing**: **858 / 858 PASS (100%)**.
  - **Layer 5 (Frontend 4 Views: Gantt Main, Detail Sidebar Drawer, Milestone Timeline & Planned vs Actual — 100% COMPLETE & VERIFIED)**:
    - **View 1: Gantt Chart Main (`public/gantt-chart.html`)**:
      - Timeline split view: sticky task list table (Name, Assignee, Progress %) + scalable timeline grid with dynamic dates.
      - 4-level zoom controls: Day, Week, Month, Quarter.
      - SVG dependency line overlay (`<svg id="depSvgCanvas">`) with directional arrowheads (`#arrowhead`, `#arrowhead-critical`) rendering dependency connections without client computation bugs.
      - Today line marker (`#todayLine`, `.today-line.today-marker`) highlighting the current day in red.
      - Interactive bar resize handles (`.resize-handle.resize-left` and `.resize-right`) on task bars.
      - Critical Path toggle: highlights critical path tasks and dependencies in bold crimson (`#ff3366` / `#ef4444`).
      - JSON Export trigger downloading the complete project timeline dataset.
    - **View 2: Gantt Item Detail Sidebar (`#itemDetailDrawer` in `public/gantt-chart.html`)**:
      - Inline drawer sliding in from the right upon clicking any task bar or table row.
      - Item title, type badge, start date, and end date inputs (Admin-guarded).
      - Interactive progress % slider updating task progress in real time.
      - Dual Predecessors and Successors dependency management with 1-click unlink and add dependency modal.
      - Chronological field change audit history log fetched from `GET /api/gantt/history/:itemId`.
      - Delete task action with dependency protection feedback.
    - **View 3: Milestone Timeline (`public/milestone-timeline.html`)**:
      - Vertical chronological milestone track connected by a continuous gradient spine line.
      - Color-coded status badges: Green (`ACHIEVED`), Yellow (`PENDING`), Red (`MISSED`).
      - "Mark as Achieved" button (Admin only) calling `PATCH /api/gantt/milestone/:id/achieve` and auto-completing linked tasks.
      - Linked Gantt task box showing linked task name, status, and progress bar.
      - Interactive Add and Edit milestone modals.
      - Status filter buttons (`All`, `Pending`, `Achieved`, `Missed`) and title search input.
    - **View 4: Planned vs Actual Baseline Variance (`public/gantt-baseline.html`)**:
      - Dual horizontal bars per task: planned baseline bar (grey `#64748b` dashed) vs current actual/projected bar (colored with progress fill).
      - Visual schedule slip indicators: pills highlighting delay (`+Nd Late`, red), on-track (`On Track`, green), and ahead (`-Nd Ahead`, blue).
      - Snapshot selector dropdown populating distinct snapshots from `GET /api/gantt/baselines/:projectId`.
      - "Take Baseline Snapshot" button capturing new immutable snapshots.
      - Comprehensive breakdown table: Item Name, Type, Planned Start, Actual Start, Planned End, Actual End, Status, Progress, Slip (Days), and Variance Verdict.
      - Variance summary KPI metrics: Items Compared, On Schedule, Delayed, Ahead, and Average Schedule Slip.
    - **Security & RBAC Client Integrity**:
      - Zero hardcoded tokens, passwords, or credentials across all 3 HTML files.
      - Dynamic token retrieval from `localStorage.getItem('token')` or URL query fallback.
      - Comprehensive `escapeHTML()` sanitization on user input mitigating XSS vulnerabilities.
    - **Verification**:
      - `node scripts/verify-prd20-layer5.js`: **27 / 27 PASS (100%)**.
    - **Full Platform Regression Verification**:
      - `node scripts/verify-prd20-layer5.js` -> 27/27 PASS
      - `node scripts/verify-prd20-layer4.js` -> 21/21 PASS
      - `node scripts/verify-prd20-layer3.js` -> 22/22 PASS
      - `node scripts/verify-prd20-layer2.js` -> 41/41 PASS
      - `node scripts/verify-prd20-layer1.js` -> 42/42 PASS
      - `node scripts/verify-prd19-integration.js` -> 69/69 PASS
      - `npm test` -> 13/13 test suites PASS
      - **Total Platform Assertions Passing**: **885 / 885 PASS (100%)**.

  - **Layer 6 (Full End-to-End Integration Suite & PRD 20 Sealed — 100% COMPLETE & VERIFIED)**:
    - Authored comprehensive E2E integration test suite `scripts/verify-prd20-integration.js` covering 10 distinct phases and 96 assertions:
      - **Phase 1: Real User Authentication & RBAC Personas**: Verified real JWT tokens for Admin and Developer Alice, confirmed persistent sessions and roles in SQLite.
      - **Phase 2: Real Gantt Items Creation & Constraints Validation**: Created 5 timeline items across types (`TASK`, `MILESTONE`), verified database rows with direct SELECT queries, tested rejection of invalid dates (`end_date < start_date`, `MILESTONE start_date != end_date`), and enforced RBAC.
      - **Phase 3: Progress Updates, Auto-Completion & Audit History Log**: Verified progress update to 50% and 100% via HTTP 200, auto-transition to `COMPLETED` status in DB, confirmed audit history rows logged in `gantt_history`, and tested trigger protection (`prevent_gantt_history_update` and `delete`).
      - **Phase 4: Real DAG Dependency Creation & Relationship Graph**: Created 3 linear `FINISH_TO_START` dependencies, verified rows in `gantt_dependencies`, and verified dependent task deletion protection rule.
      - **Phase 5: Circular Dependency Detection (Real Blocked Attempt)**: Attempted circular dependency (Item 5 -> Item 1) and self-loop (Item 2 -> Item 2), verified HTTP 400 rejection with 'Circular dependency detected', confirmed via direct DB SELECT that invalid link was never saved.
      - **Phase 6: Critical Path Method (CPM) Server-Side Calculation**: Verified makespan duration of 24 days, confirmed zero-slack critical tasks (Items 1, 2, 3, 5) with `is_critical = true`, and verified non-critical branch (Item 4) with 19 days slack.
      - **Phase 7: Baseline Snapshotting & Planned vs Actual Schedule Slip Analysis**: Captured baseline snapshot of 5 items, verified trigger immutability, applied schedule shifts, and validated exact mathematical days slip: Item 2 delayed (+4d), Item 4 ahead (-2d), Item 1 on track (0d).
      - **Phase 8: Milestone Lifecycle Management (PENDING -> ACHIEVED -> MISSED)**: Created Milestone A (future date, `PENDING`) and Milestone B (past date, auto-transitioned to `MISSED`), marked Milestone A `ACHIEVED` via Admin PATCH, verified `achieved_at` in DB, and enforced RBAC.
      - **Phase 9: Frontend Views & Static Asset Security Audit**: Audited all 3 HTML files for zero hardcoded credentials, dynamic localStorage token retrieval, XSS escaping, and verified HTTP 200 static serving.
      - **Phase 10: Complete PRD 20 Definition of Done Checklist**: Verified 5 tables in `sqlite_master`, 6 append-only triggers, all 17 Gantt API routes, CPM calculations, baseline analysis, and server-side RBAC.
    - Integration suite passed: **96 / 96 assertions PASS (100%)**.
    - **Total Active Platform Test Assertions Passing**: **981 / 981 PASS (100%)** with zero regressions.
    - **PRD 20 Status**: 100% COMPLETE AND PERMANENTLY SEALED.

- **PRD 21: Resource Workload & Capacity Management Dashboard**:
  - **Layer 1 (Database + Migrations — 100% COMPLETE & VERIFIED)**:
    - 5 SQLite Tables created: `member_capacity`, `member_availability`, `workload_assignments`, `workload_snapshots`, `workload_alerts`.
    - 5 Append-only / Mutation-blocking Triggers created and tested: `prevent_member_capacity_update`, `prevent_member_capacity_delete`, `prevent_workload_snapshot_update`, `prevent_workload_snapshot_delete`, `prevent_workload_alert_delete`.
    - 11 Performance composite indexes added.
    - Verification: `scripts/verify-prd21-layer1.js` -> **42 / 42 PASS (100%)**.
  - **Layer 2 (Capacity + Availability Service + Server-Side Math — 100% COMPLETE & VERIFIED)**:
    - Implemented capacity management (append-only), availability management (LEAVE, HOLIDAY, PARTIAL, TRAINING).
    - Server-side utilization formula `(allocated_hours / available_hours) * 100`.
    - Automated overload (>100%) and underload (<30%) alert generation engine.
    - Verification: `scripts/verify-prd21-layer2.js` -> **34 / 34 PASS (100%)**.
  - **Layer 3 (Assignment Service, Proration & Team Aggregation — 100% COMPLETE & VERIFIED)**:
    - Assignment CRUD in `workload_assignments` supporting BACKLOG, GANTT, PIPELINE, MANUAL sources.
    - Multi-week proration engine splitting hours proportionally across overlapping calendar weeks: `(overlap_days / total_days) * estimated_hrs`.
    - Team-wide utilization aggregation (`GET /api/workload/team/:projectId`).
    - Verification: `scripts/verify-prd21-layer3.js` -> **32 / 32 PASS (100%)**.
  - **Layer 4 (Heatmap, Snapshots & Advisory Rebalance Engine — 100% COMPLETE & VERIFIED)**:
    - 8-Week rolling heatmap grid (`GET /api/workload/heatmap/:projectId`).
    - Workload snapshot API (`POST/GET /api/workload/snapshot`) storing frozen point-in-time JSON.
    - Advisory rebalance suggestions engine (`GET /api/workload/rebalance/:projectId`).
    - Personal 5-week member forecast (`GET /api/workload/dashboard/member/:userId`) and timeline JSON export.
    - Verification: `scripts/verify-prd21-layer4.js` -> **28 / 28 PASS (100%)**.
  - **Layer 6 (Full End-to-End Integration Suite & PRD 21 Sealed — 100% COMPLETE & VERIFIED)**:
    - Authored comprehensive E2E integration test suite `scripts/verify-prd21-integration.js` covering 11 phases and 86 assertions:
      - **Phase 1: Real User Authentication & RBAC Personas**: Verified real JWT sessions for Admin and Member personas, confirmed persistent database sessions in SQLite and profile retrieval.
      - **Phase 2: Real Capacity Setting & Append-Only Verification**: Admin set capacity (40 hrs -> 36 hrs), verified append-only history via direct SELECT, and confirmed SQLite triggers (`prevent_capacity_update`, `prevent_capacity_delete`) strictly block mutations.
      - **Phase 3: Real Availability Submission & Approval Workflow**: Member submitted planned LEAVE for 2 future days (`approved_by IS NULL`), self-approval rejected (`HTTP 403`), Admin approved both (`HTTP 200`), verified `approved_by` and deduction calculation in DB (36.0 - 14.4 = 21.6 available hours).
      - **Phase 4: Real Workload Assignments Across All 4 Sources & Sync Hook**: Created assignments across `BACKLOG_ITEM`, `GANTT_ITEM`, `PIPELINE_POINT`, `MANUAL`, confirmed all 4 source types present via direct SELECT, verified `syncAssignmentFromSource` creates new and subsequent sync idempotently updates existing record, and verified member workload privacy isolation (`HTTP 403`).
      - **Phase 5: Real Multi-Week Proration Math Verification**: Verified 10-day 40-hour task split into Week 1 (28.00 hrs) and Week 2 (12.00 hrs) server-side, confirmed Week 3 is 0.00 hrs, and verified conservation of hours (28 + 12 = 40.00 hrs).
      - **Phase 6: Real 8-Week Rolling Heatmap Grid Matrix**: Verified 8 rolling week headers, confirmed member grid rows with 8 cells each, validated status categories (`UNDERLOADED`, `OPTIMAL`, `NEAR_CAPACITY`, `OVERLOADED`), and enforced RBAC (`HTTP 403` for non-admin).
      - **Phase 7: Real Overload and Underload Auto-Alert Generation**: Verified overload alert auto-creation in `workload_alerts` for >100% utilization, verified underload alert generation for 12.5% utilization, and confirmed Admin acknowledgment workflow with direct DB timestamp verification.
      - **Phase 8: Real Advisory Rebalance Suggestions Engine**: Verified rebalance engine identifies overloaded members and pairs tasks to underloaded target members; confirmed DB assignment was NOT mutated by advisory engine; verified Admin manual reassignment via `PATCH /api/workload/assignment/:id`.
      - **Phase 9: Real Workload Snapshots & Immutability Triggers**: Admin created point-in-time snapshot, verified frozen JSON in `workload_snapshots`, confirmed triggers (`prevent_workload_snapshot_update`, `prevent_workload_snapshot_delete`) block tampering, and verified snapshot listing.
      - **Phase 10: Real Frontend HTML Security Audit**: Audited all 4 views (`workload-dashboard.html`, `workload-heatmap.html`, `my-workload.html`, `capacity-planning.html`) confirming zero hardcoded credentials, dynamic localStorage token retrieval, `escapeHTML` XSS protection, and live static HTTP 200 serving.
      - **Phase 11: Complete PRD 21 Definition of Done Checklist**: Verified 5 tables in `sqlite_master`, 5 triggers in `sqlite_master`, 16 API endpoints, server-side utilization math, proration, overload/underload alerts, sync hook, snapshot freeze, 4 views, heatmap matrix, and member RBAC isolation.
    - Integration suite passed: **86 / 86 assertions PASS (100%)**.
    - **Total PRD 21 Test Suite Assertions Passing**: **332 / 332 PASS (100%)** across Layers 1 to 6.
    - **Total Platform Test Suite Assertions Passing**: **1,067 / 1,067 PASS (100%)** with zero regressions.
    - **PRD 21 Status**: 100% COMPLETE AND PERMANENTLY SEALED.

- **PRD 22: Time Tracking & Timesheet Management System**:
  - **Layer 1 (Database, Schema & Immutability Triggers — 100% COMPLETE & VERIFIED)**:
    - 6 SQLite Tables created: `time_entries`, `time_entry_history`, `billable_rates`, `active_timers`, `time_approval_requests`, `time_report_snapshots`.
    - 8 Append-only / Immutability Triggers created and verified in `sqlite_master`:
      - `prevent_time_history_update`, `prevent_time_history_delete`
      - `prevent_billable_rate_update`, `prevent_billable_rate_delete`
      - `prevent_approval_request_update`, `prevent_approval_request_delete`
      - `prevent_time_report_snapshot_update`, `prevent_time_report_snapshot_delete`
    - 13 Performance & Integrity Composite Indexes created:
      - `idx_time_entries_user`, `idx_time_entries_project`, `idx_time_entries_status`, `idx_time_entries_start_time`, `idx_time_entries_source_ref`
      - `idx_time_entry_history_entry`
      - `idx_billable_rates_user`, `idx_billable_rates_project`, `idx_billable_rates_effective`
      - `idx_active_timers_user`
      - `idx_time_approval_requests_entry`, `idx_time_approval_requests_status`
      - `idx_time_report_snapshots_project`
    - Connection Pragmas verified: `PRAGMA journal_mode = WAL;`, `PRAGMA busy_timeout = 5000;`, `PRAGMA foreign_keys = ON;`.
    - Single active timer lock enforcement verified via `active_timers (user_id UNIQUE)`.
    - Verification test suite: `scripts/verify-prd22-layer1.js` -> **100 / 100 assertions PASS (100%)**.
  - **Layer 2 (Timer Service, Lock Engine & Billable Rate Resolution — 100% COMPLETE & VERIFIED)**:
    - Authored `src/services/timeTrackingService.js`:
      - `startTimer`: Enforces single active timer rule via `active_timers` lock + service guard, snapshots billable rate at start time, checks time overlap, logs audit row to `time_entry_history`.
      - `stopTimer`: Calculates duration in minutes `ROUND((end_time - start_time) / 60000)`, calculates snapshot billable amount `(duration / 60) * billable_rate`, releases lock from `active_timers` (DELETE permitted), manually updates `updated_at`, logs audit changes to `time_entry_history`.
      - `getTimerStatus`: Returns live active timer with numeric `elapsed_seconds` counter; enforces user privacy (Member B sees `active: false`).
      - `resolveBillableRate`: Implements full 4-tier priority hierarchy (`(user, project) > (project default) > (member default) > 0.0 INR`) with temporal validity bounds (`effective_from`, `effective_to`).
      - `checkTimeOverlap`: Evaluates overlapping intervals for closed and running entries.
      - `canEditTimeEntry`: Enforces 24-hour edit window for manual entries and locks timer-stopped entries immediately for non-admins.
      - `autoCloseDanglingTimers`: Cron helper closing unstopped timers at 23:59:59 of their start day.
    - Authored `src/routes/time.routes.js` and mounted at `/api/time` in `src/app.js`:
      - `POST /api/time/timer/start`
      - `POST /api/time/timer/stop`
      - `GET /api/time/timer/status`
      - `POST /api/time/rate/set`
      - `GET /api/time/rate/member/:userId`
      - `GET /api/time/rate/project/:projectId`
      - `GET /api/time/entry/:entryId`
    - Comprehensive Verification: `scripts/verify-prd22-layer2.js` -> **59 / 59 PASS (100%)**.
  - **Layer 3 (Manual Entry, Edit Window & Soft-Delete Service + API — 100% COMPLETE & VERIFIED)**:
    - Authored `src/services/timeTrackingService.js` Layer 3 implementation:
      - `createManualEntry`: Validates `end_time >= start_time`, validates `source_ref_type` (`BACKLOG_ITEM`, `GANTT_ITEM`, `PIPELINE_POINT`, `NULL`), calculates server-side duration `ROUND((end - start) / 60)`, detects overlapping intervals returning `409 Conflict`, snapshots billable rate and amount, sets initial status to `PENDING`, writes `MANUAL_CREATED` audit row to `time_entry_history`, manually sets `updated_at`.
      - `updateTimeEntry`: Enforces strict 24-hour edit window for `MANUAL` entries (`<= 86400 seconds`), immediately locks `TIMER`-stopped entries for regular members (`403 Forbidden`), allows Admin override anytime, logs field-level audit rows to `time_entry_history` for every modified field (`description`, `start_time`, `end_time`, `duration_minutes`, `is_billable`, `billable_amount`), recalculates `billable_amount` using snapshotted rate, enforces overlap detection, manually updates `updated_at`.
      - `deleteTimeEntry`: Strictly Admin-only (`403 Forbidden` for members), executes soft delete (`status = 'DELETED'`), writes full audit trail (`field_changed = 'status', new_value = 'DELETED'` and `field_changed = 'deletion_reason', new_value = reason`), maintains 100% referential integrity with `PRAGMA foreign_keys = ON;` without hard deletes.
      - `getMyTimeEntries`: Retrieves entries for authenticated user, filters by `project_id`, `from`, `to`, `status`, joins `projects.title`, and excludes `DELETED` entries by default.
      - `getProjectTimeEntries`: Admin-only endpoint returning all project entries with `users.name` and `projects.title`, supports `user_id`, `from`, `to`, `status` filters, excludes `DELETED` entries by default.
    - Authored `src/routes/time.routes.js` Layer 3 routes:
      - `POST /api/time/entry/create`
      - `PATCH /api/time/entry/:entryId`
      - `DELETE /api/time/entry/:entryId`
      - `GET /api/time/entries/my`
      - `GET /api/time/entries/project/:projectId`
    - Comprehensive Verification: `scripts/verify-prd22-layer3.js` -> **56 / 56 PASS (100%)**.
  - **Layer 4 (Approval Workflow & Report Engine Service + API — 100% COMPLETE & VERIFIED)**:
    - Authored `src/services/timeTrackingService.js` Layer 4 implementation:
      - `requestApproval`: Validates entry ownership (`403` on cross-member attempt), validates `status === 'PENDING'`, blocks active running timers (`end_time IS NULL`), blocks already approved/rejected entries (`400`), prevents duplicate pending requests (`409 Conflict`), inserts into append-only `time_approval_requests`, appends `APPROVAL_REQUESTED` audit row to `time_entry_history`.
      - `approveTimeEntry`: Strictly Admin-only (`403 Forbidden` for members), updates `time_entries` status to `'APPROVED'`, records `approved_by` and `approved_at`, manually sets `updated_at`, logs audit row to `time_entry_history`, logs `TIME_ENTRY_APPROVED` event to `access_log`.
      - `rejectTimeEntry`: Strictly Admin-only, requires `decision_note` (min 10 characters), updates `time_entries` status to `'REJECTED'`, records `rejection_reason`, manually sets `updated_at`, blocks future resubmissions (`400 Bad Request`), logs audit rows to `time_entry_history`, logs `TIME_ENTRY_REJECTED` event to `access_log`.
      - `getPendingApprovals`: Admin-only queue retrieving all pending approval requests joined with `time_entries`, `users.name`, `users.email`, and `projects.title`. Automatically excludes approved/rejected/deleted records.
      - `getTeamTimeReport`: Admin-only aggregated report calculating per-member `total_hrs`, `billable_hrs`, `non_billable_hrs`, `billable_amount`, and `entries_count` along with overall summary totals. Excludes soft-deleted entries. Supports `project_id`, `from`, `to` filters.
      - `getMyTimeReport`: Authenticated member summary report strictly scoped to `currentUser.id` with breakdown by project. Excludes soft-deleted entries.
      - `createReportSnapshot`: Admin-only point-in-time report snapshot freezing team report JSON into append-only `time_report_snapshots`. Validates `report_type` (`WEEKLY`, `MONTHLY`, `CUSTOM`) and temporal bounds.
      - `getReportSnapshots`: Admin-only retrieval of report snapshots supporting string and numeric `project_id` matching.
      - `exportTimeReportData`: Admin-only export returning standard RFC 4180 CSV with headers (`text/csv`) and dual-mode JSON support (`?format=json`). Records `TIME_REPORT_EXPORT` audit event in `access_log`.
    - Authored `src/routes/time.routes.js` Layer 4 routes:
      - `POST /api/time/approval/request/:entryId`
      - `PATCH /api/time/approval/:requestId/approve`
      - `PATCH /api/time/approval/:requestId/reject`
      - `GET /api/time/approval/pending`
      - `GET /api/time/report/team`
      - `GET /api/time/report/my`
      - `POST /api/time/report/snapshot`
      - `GET /api/time/report/snapshots/:projectId`
      - `GET /api/time/report/export/:projectId`
    - Comprehensive Verification: `scripts/verify-prd22-layer4.js` -> **85 / 85 PASS (100%)**.
    - Total PRD 22 verified assertions: **300 / 300 PASS (100%)** across Layers 1, 2, 3 & 4.
    - Full Platform Regression: `npm test` -> **13 / 13 test suites PASS (100%)**.
  - **Layer 5 (Frontend Views: 4 HTML Views — 100% COMPLETE & VERIFIED)**:
    - Authored all 4 frontend HTML views in `public/`:
      - `public/my-time-tracker.html` (46.86 KB): Personal active stopwatch timer with client-side clock (no server polling), today's entries table with duration/billable/status badges, manual entry modal, 24hr edit validation, "Submit for Approval" action, and weekly hours summary bar chart.
      - `public/team-time-report.html` (41.47 KB): Admin-only team financial report, date range picker & project filter, 5 top-level KPI summary cards, member workload & revenue table with clickable drill-down modal, CSV/JSON report exports, and append-only point-in-time snapshot freezer with JSON inspector.
      - `public/time-approval-queue.html` (29.86 KB): Admin-only approval queue, pending/approved/rejected filter tabs, project filter, one-click entry approval, and rejection modal with $\ge 10$-character note validation and character counter.
      - `public/billable-rates.html` (33.40 KB): Admin-only rate governance, policy banner, member default rates table, project-specific overrides table, member rate history accordions, and rate setter modal inserting into append-only `billable_rates`.
    - Applied mandatory security standards across all views: zero hardcoded credentials/tokens, dynamic token acquisition from `localStorage`, strict XSS protection via `escapeHTML()`, server-verified role checks via `GET /api/users/me`, and zero external broken CDN dependencies.
    - Comprehensive Verification: `scripts/verify-prd22-layer5.js` -> **163 / 163 PASS (100%)**.
    - All 4 views verified served live with HTTP 200 OK and `Content-Type: text/html`.
    - Total PRD 22 verified assertions: **463 / 463 PASS (100%)** across Layers 1, 2, 3, 4 & 5.
    - Full Platform Regression: `npm test` -> **13 / 13 test suites PASS (100%)**.
  - **Layer 6 (Full End-to-End Integration Suite & Hardening — 100% COMPLETE & VERIFIED)**:
    - Authored and executed `scripts/verify-prd22-integration.js` covering the exact 15-step sequence with real HTTP + direct DB SELECT at every step (zero mocks):
      1. Real login: Admin + 2 Member personas (Alice & Bob) authenticated via `POST /api/auth/login`, verified via `GET /api/users/me` and direct DB `users` query.
      2. Billable rate set: `POST /api/time/rate/set` -> stored in append-only `billable_rates` table, verified via direct DB SELECT.
      3. Timer start: `POST /api/time/timer/start` -> lock stored in `active_timers`, verified via direct DB SELECT.
      4. Concurrent timer block: Second timer start for same user rejected with `409 Conflict`.
      5. Timer stop: `POST /api/time/timer/stop` -> server computes duration and billable amount, releases `active_timers` lock, appends 5 audit rows to `time_entry_history`.
      6. Manual entry: `POST /api/time/entry/create` -> overlap detected returning `409 Conflict`, invalid `source_ref_type` rejected returning `400 Bad Request`, valid entry snapshots rate into `time_entries`.
      7. Rate snapshot immutability: New rate registered via `POST /api/time/rate/set` -> prior entry's snapshotted rate remains strictly unchanged in DB.
      8. 24hr edit window: Fresh manual entry edited by member (`200 OK`), member edit on timer-stopped entry rejected (`403 Forbidden`), stale manual entry edit rejected (`403 Forbidden`), Admin overrides both (`200 OK`), all field edits audited in `time_entry_history`.
      9. Soft delete: Admin soft-deletes entry (`status = 'DELETED'`), verified row preserved in DB, referential integrity intact (`PRAGMA foreign_keys = 1`), excluded from `GET /api/time/entries/my`.
      10. Approval workflow: Member submits own entry (`201 Created`), duplicate submission returns `409 Conflict`, cross-member submission returns `403 Forbidden`, Admin rejection with short note (<10 chars) returns `400 Bad Request`, valid rejection (`200 OK`) blocks resubmission (`400 Bad Request`), Admin approval (`200 OK`) updates status and logs `TIME_ENTRY_APPROVED` to `access_log`.
      11. Team report aggregate: Member access blocked (`403 Forbidden`), Admin access succeeds (`200 OK`), mathematical validation of billable/non-billable hours and amounts, verified `DELETED` entries excluded.
      12. Report snapshot: Admin freezes team report via `POST /api/time/report/snapshot`, stored in append-only `time_report_snapshots`, `prevent_time_report_snapshot_update` trigger blocks UPDATE, `prevent_time_report_snapshot_delete` trigger blocks DELETE.
      13. CSV export: `GET /api/time/report/export/:projectId` returns `Content-Type: text/csv` with RFC 4180 headers, records `TIME_REPORT_EXPORT` with project target in `access_log`.
      14. Frontend security audit: Audited all 4 HTML views (`my-time-tracker.html`, `team-time-report.html`, `time-approval-queue.html`, `billable-rates.html`) confirming zero hardcoded credentials, dynamic localStorage token usage, universal `escapeHTML()` sanitization, and server-side role verification.
      15. Dangling timer auto-close cron: Verified unstopped active timer from previous day is auto-closed at 23:59:59 with accurate computed duration and `active_timers` lock cleanly removed.
    - Comprehensive Verification: `scripts/verify-prd22-integration.js` -> **88 / 88 PASS (100%)**.
    - Full PRD 22 Platform Totals: **551 / 551 PASS (100%)** across Layers 1, 2, 3, 4, 5 & 6.
    - Full Platform Regression: `npm test` -> **13 / 13 test suites PASS (100%)**.
    - Definition of Done: All 17 items in `docs/22_TIME_TRACKING.md` verified and marked `[x]`.

- **PRD 23 — Analytics & KPI Dashboard**:
  - **Reverse Engineering Report**:
    - Conducted comprehensive analysis of competitors: Google Looker Studio, Mixpanel, Looker, Tableau, Amplitude, Monday.com, ClickUp, and Jira.
    - Mapped screens, data relationships, business rules, what NOT to copy, what logic/flow to adopt, and strategic differentiators.
  - **Layer 1 (Database, Schema & Immutability Triggers — 100% COMPLETE & VERIFIED)**:
    - Authored and migrated 6 core SQLite tables in `src/db/schema.sql`, `src/db/database.js`, and `src/db/migrate.js`:
      - `kpi_definitions`: Central registry for custom and seeded KPIs across 8 data sources.
      - `kpi_snapshots`: Append-only periodic time-series snapshot values with calculation metadata.
      - `analytics_dashboards`: Role-aware dashboards (`PERSONAL`, `TEAM`, `COMPANY`) with layout JSON.
      - `dashboard_widgets`: 12-column grid widgets (`NUMBER_CARD`, `BAR_CHART`, `LINE_CHART`, `PIE_CHART`, `PROGRESS_BAR`, `TABLE`, `HEATMAP`, `BURNDOWN`, `VELOCITY`).
      - `kpi_alerts`: Threshold breach alert log with mutable acknowledgment fields (`acknowledged_by`, `acknowledged_at`).
      - `analytics_report_exports`: Append-only export audit records.
    - Added 11 performance and foreign key indexes in SQLite.
    - Created 5 append-only SQLite triggers:
      - `prevent_kpi_snapshot_update` & `prevent_kpi_snapshot_delete`
      - `prevent_kpi_alert_delete`
      - `prevent_analytics_export_update` & `prevent_analytics_export_delete`
    - Seeded 10 built-in KPI definitions automatically and idempotently via `seedBuiltInKpis()`: Sprint Velocity, Sprint Completion Rate, OKR Progress (Company Level), Team Utilization, Billable Hours This Month, Pipeline Completion Rate, GitHub PR Merge Rate, Revenue This Month, Active Backlog Items, and Overloaded Members.
    - Verified strict database pragmas: `journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`.
    - Comprehensive Verification: `scripts/verify-prd23-layer1.js` -> **175 / 175 PASS (100%)**.
    - Core Platform Regression: `npm test` -> **13 / 13 test suites PASS (100%)**.
  - **Layer 2 (KPI Calculation Engine, Snapshots, Alerts & REST API)**:
    - Implemented safe KPI Calculation Engine in `src/services/analyticsService.js` (`calculateKpiValue`):
      - Server-side parsing of `calculation_query` JSON into parameterized SQLite queries — never executes client or arbitrary SQL strings.
      - Supported and validated aggregation types: `SUM`, `COUNT`, `AVERAGE`, `PERCENTAGE`, `LATEST`, and `RATIO`.
      - Whitelist of 18 permitted platform tables.
      - Graceful fallback for empty/inactive external integrations (GitHub PR Merge Rate returns `0.0` without crashing or throwing).
      - Dedicated calculation handlers for all 10 built-in platform KPIs with live SQL joins.
    - Implemented Append-Only Snapshot Engine (`refreshKpi`):
      - Inserts new row into `kpi_snapshots` on every refresh run.
      - Append-only immutability enforced by SQLite DB trigger.
    - Implemented Alert Auto-Generation & Deduplication (`checkAndGenerateKpiAlert`):
      - Compares computed values against `alert_threshold_low` and `alert_threshold_high`.
      - Auto-inserts into `kpi_alerts` (`BELOW_THRESHOLD` or `ABOVE_THRESHOLD`).
      - Deduplication check prevents duplicate spam alerts when an unacknowledged alert already exists for the same KPI.
    - Implemented Seeded KPI Protection & Deletion Governance (`deleteKpiDefinition`):
      - Deleting seeded built-in KPIs (`is_built_in = 1` or IDs 1-10) rejected with `400 Bad Request` ("Seeded built-in KPIs cannot be deleted. You can only deactivate them via PATCH with is_active = 0.").
      - Non-seeded custom KPIs with snapshots soft-deleted (`is_active = 0`) to preserve foreign-key integrity with append-only tables; unsnapshotted custom KPIs cleanly hard-deleted.
    - Enforced minimum `refresh_interval_minutes >= 15` (sub-15 rejected with `400 Bad Request`).
    - Maintained manual `updated_at = datetime('now')` on all mutations and recorded audit events in `access_log`.
    - Implemented Background Cron Refresh Engine (`refreshDueKpis`).
    - Mounted 6 KPI REST API endpoints on `/api/analytics` via `src/routes/analytics.routes.js`:
      - `POST /api/analytics/kpi/create` (Admin+)
      - `GET /api/analytics/kpis` (Admin+)
      - `GET /api/analytics/kpi/:kpiId` (Admin+)
      - `PATCH /api/analytics/kpi/:kpiId` (Admin+)
      - `DELETE /api/analytics/kpi/:kpiId` (Admin+)
      - `POST /api/analytics/kpi/:kpiId/refresh` (Admin+)
    - Comprehensive Verification: `scripts/verify-prd23-layer2.js` -> **110 / 110 PASS (100%)**.
    - Core Platform Regression: `npm test` -> **13 / 13 test suites PASS (100%)**.
  - **Layer 3 (Dashboard & 12-Column Grid Widget Engine)**:
    - Implemented Dashboard Service in `src/services/analyticsService.js`:
      - Strict 3-tier scope rules: `PERSONAL` (owner-only create/edit/delete; member can NEVER see another member's personal dashboard), `TEAM` (Admin creates/edits/deletes; member view-only), `COMPANY` (Admin-only create/edit/delete/view).
      - Sole COMPANY dashboard deletion defense: blocks deleting COMPANY dashboard if count <= 1 (`400 Bad Request`).
      - Validated JSON layout storing and parsing.
      - Default dashboard toggle management (`is_default`).
    - Implemented 12-Column Responsive Grid Widget Service:
      - Validated widget types: `NUMBER_CARD`, `BAR_CHART`, `LINE_CHART`, `PIE_CHART`, `PROGRESS_BAR`, `TABLE`, `HEATMAP`, `BURNDOWN`, `VELOCITY`.
      - Strict 12-column row boundary enforcement: `position_x + width <= 12`, `position_x >= 0`, `1 <= width <= 12`, `height >= 1`.
      - FK validation against `kpi_definitions` (`404 Not Found` if missing).
      - Pre-computed snapshot engine: widgets fetch latest snapshot directly from `kpi_snapshots` using `ORDER BY snapshotted_at DESC, id DESC LIMIT 1` (never recalculates live on widget render).
      - Trend Sparkline: fetches last 30 snapshots using `ORDER BY snapshotted_at DESC, id DESC LIMIT 30`.
      - Server-Side Privacy Redaction: `sanitizeCalculationMetadataForMember()` removes raw individual member contribution data (`members`, `memberResults`, `individual_contributions`) for non-admin viewers.
    - Audit Trail & Mutation Maintenance:
      - All dashboard and widget mutations manually set `updated_at = datetime('now')`.
      - Parent dashboard `updated_at` updated when child widgets are added, modified, or deleted.
      - Full audit events recorded in `access_log` (`DASHBOARD_CREATED`, `DASHBOARD_UPDATED`, `DASHBOARD_DELETED`, `WIDGET_CREATED`, `WIDGET_UPDATED`, `WIDGET_DELETED`).
    - Mounted 8 Dashboard and Widget REST API endpoints via `src/routes/analytics.routes.js`:
      - `POST /api/analytics/dashboard/create`
      - `GET /api/analytics/dashboards`
      - `GET /api/analytics/dashboard/:dashboardId`
      - `PATCH /api/analytics/dashboard/:dashboardId`
      - `DELETE /api/analytics/dashboard/:dashboardId`
      - `POST /api/analytics/widget/create`
      - `PATCH /api/analytics/widget/:widgetId`
      - `DELETE /api/analytics/widget/:widgetId`
    - Comprehensive Verification: `scripts/verify-prd23-layer3.js` -> **111 / 111 PASS (100%)**.
    - Core Platform Regression: `npm test` -> **13 / 13 test suites PASS (100%)**.
  - **Layer 4 (Report Analytics, Export Engine, Alert Governance & Snapshot History — 100% COMPLETE & VERIFIED)**:
    - Implemented Alert Governance & Acknowledgment:
      - `PATCH /api/analytics/alert/:alertId/acknowledge`: Admin-only (`403 Forbidden` for members), sets `acknowledged_by = admin.id`, `acknowledged_at = datetime('now')`, `updated_at = datetime('now')`.
      - Already acknowledged alert returns `400 Bad Request`.
      - Trigger `prevent_kpi_alert_delete` blocks SQL DELETE with RAISE(ABORT).
      - Audit row written to `access_log` (`KPI_ALERT_ACKNOWLEDGED`).
    - Implemented Scoped Alert Listing:
      - `GET /api/analytics/alerts`: Admin sees all system alerts; regular members only see alerts for KPIs on their accessible dashboards (`PERSONAL` owned or `TEAM`); COMPANY scope alerts strictly hidden from members.
    - Implemented Report Analytics Endpoints (Admin-only):
      - `GET /api/analytics/report/sprint/:projectId` & `/api/analytics/report/sprint`: Average velocity, velocity trend, sprint comparison, backlog health.
      - `GET /api/analytics/report/okr`: Company & team progress %, status breakdown, objectives list.
      - `GET /api/analytics/report/time`: Total hours, billable hours, billable amounts, project/member breakdown, excludes soft-deleted entries (`status != 'DELETED'`).
      - `GET /api/analytics/report/workload`: Average utilization, overloaded member count, utilization distribution.
      - `GET /api/analytics/summary/company`: Executive cards for all 10 built-in KPIs with target comparisons, trend arrows (`UP`, `DOWN`, `FLAT`), and status indicators.
    - Implemented Report Export Engine & Immutability:
      - `POST /api/analytics/report/export`, `GET /api/analytics/report/export`, `GET /api/analytics/report/export/:projectId`: Admin-only (`403 Forbidden` for members).
      - Dual-mode format support: `?format=csv` or `export_format: 'CSV'` returns RFC 4180 CSV (`text/csv`) with headers; default returns JSON.
      - Inserts append-only record into `analytics_report_exports`.
      - Verified triggers `prevent_analytics_export_update` and `prevent_analytics_export_delete` strictly block UPDATE/DELETE with RAISE(ABORT).
      - Audits export event in `access_log` (`ANALYTICS_REPORT_EXPORT`) with `target_id`.
    - Implemented KPI Snapshot History:
      - `GET /api/analytics/kpi/:kpiId/snapshots`: Admin-only (`403 Forbidden` for members), paginated historical snapshots with `limit`, `offset`, and `total_count`.
    - Implemented Built-in Seeded KPI Deactivation:
      - Deactivation via `PATCH /api/analytics/kpi/:kpiId` with `is_active=0` succeeds, while hard `DELETE` remains blocked with `400 Bad Request`.
    - Maintained manual `updated_at = datetime('now')` and audit logging across all endpoints.
    - Mounted 9 Layer 4 routes in `src/routes/analytics.routes.js`.
    - Comprehensive Verification: `scripts/verify-prd23-layer4.js` -> **100 / 100 PASS (100%)**.
    - Full Regression Pass:
      - `scripts/verify-prd23-layer1.js` -> **175 / 175 PASS (100%)**
      - `scripts/verify-prd23-layer2.js` -> **110 / 110 PASS (100%)**
      - `scripts/verify-prd23-layer3.js` -> **111 / 111 PASS (100%)**
      - `scripts/verify-prd23-layer4.js` -> **100 / 100 PASS (100%)**
      - `npm test` -> **13 / 13 test suites PASS (100%)**
  - **Layer 5 (Frontend Views & Security Hardening — 100% COMPLETE & VERIFIED)**:
    - Authored 5 dedicated, high-aesthetic HTML views in `public/`:
      - `public/kpi-overview.html` (26.3 KB): Company KPI Overview, status badges (green/yellow/red), trend arrows (↑, ↓, →), 30-snapshot drill-down modal, alert counter, Refresh All, and CSV export.
      - `public/dashboard-builder.html` (32.3 KB): 12-column responsive CSS grid, 8-widget library sidebar, drag-drop card placement, config modal, scope selector (`PERSONAL`, `TEAM`, `COMPANY`), and layout persistence.
      - `public/sprint-analytics.html` (22.6 KB): Committed vs completed dual-bar velocity chart (SVG), circular completion rate gauge (SVG), sprint history table, project selector, and CSV export.
      - `public/team-analytics.html` (21.1 KB): Member contribution and capacity matrix, billable vs non-billable time allocation bar, top contributors leaderboard, CSV export, and strict member privacy redaction.
      - `public/kpi-alerts.html` (20.9 KB): Centralized incident queue, single-click disable-guarded alert acknowledgment, ALL/UNACKNOWLEDGED/ACKNOWLEDGED filter tabs, and 30-day alert frequency bar chart (SVG).
    - Verified strict security and architecture rules:
      - Zero hardcoded credentials (no passwords, tokens, or plaintext secrets).
      - Universal `escapeHTML()` sanitization across all 5 files.
      - Dynamic token retrieval via `localStorage.getItem('token')`.
      - Mandatory server-side role verification via `GET /api/users/me` on startup.
      - Zero external CDN script dependencies (100% offline-safe native JS & SVG).
      - Real HTTP serving: all 5 views return HTTP 200 OK with `Content-Type: text/html`.
    - Comprehensive Verification: `scripts/verify-prd23-layer5.js` -> **82 / 82 PASS (100%)**.
    - Full Regression Pass:
      - `scripts/verify-prd23-layer1.js` -> **175 / 175 PASS (100%)**
      - `scripts/verify-prd23-layer2.js` -> **110 / 110 PASS (100%)**
      - `scripts/verify-prd23-layer3.js` -> **111 / 111 PASS (100%)**
      - `scripts/verify-prd23-layer4.js` -> **100 / 100 PASS (100%)**
      - `scripts/verify-prd23-layer5.js` -> **82 / 82 PASS (100%)**
      - `npm test` -> **13 / 13 test suites PASS (100%)**
    - Layer 6 (Full End-to-End Integration Suite & PRD 23 Sealed — 100% COMPLETE & VERIFIED):
      - Authored and executed `scripts/verify-prd23-integration.js` covering the exact 18-step integration sequence with real HTTP + direct DB SELECT at every step (zero mocks):
        1. Real login: Admin + 2 Member personas (Alice & Bob) authenticated via `GET /api/users/me` and confirmed in DB.
        2. KPI calculation engine: refreshed all 10 built-in KPIs, verified snapshot row created for each via direct DB SELECT with numeric values.
        3. GitHub KPI fallback: verified empty `github_webhook_log` returns value = 0.0 with zero crashes.
        4. Alert auto-generation: created custom KPI with low threshold, refreshed, verified alert row in `kpi_alerts` via direct DB SELECT with correct `alert_type`.
        5. Alert deduplication: second refresh verified exactly 1 unacknowledged alert row (no duplicate spam).
        6. Alert scope: Member retrieved alerts; company-scope alerts strictly absent from member response.
        7. Alert acknowledgment: Member attempt blocked (`403 Forbidden`); Admin acknowledged (`200 OK`); direct DB SELECT verified `acknowledged_by` and `acknowledged_at`; duplicate acknowledgment blocked (`400 Bad Request`).
        8. Dashboard PERSONAL scope: Member created personal dashboard; Member 2 view blocked (`403 Forbidden`); Member team creation blocked (`403 Forbidden`); Admin created TEAM and COMPANY dashboards.
        9. Widget grid: valid widget (`pos_x=8 + width=4 = 12`) passed; overflow widget (`pos_x=9 + width=4 = 13`) blocked (`400 Bad Request`); invalid `widget_type` blocked (`400 Bad Request`); nonexistent `kpi_id` blocked (`404 Not Found`).
        10. Pre-computed snapshot fetch: `GET /api/analytics/dashboard/:id` widget `latest_snapshot` value matched direct DB SELECT from `kpi_snapshots`.
        11. Privacy redaction: Member fetch stripped `members`/`memberResults`/`individual_contributions` from `calculation_metadata`; Admin fetch preserved them; both verified against direct DB SELECT.
        12. Sole COMPANY dashboard protection: deleting sole COMPANY dashboard blocked (`400 Bad Request`); creating second and deleting second succeeded (`200 OK`).
        13. Sprint analytics report: `GET /api/analytics/report/sprint` verified numeric `summary.average_velocity` and presence of `sprint_comparison` array.
        14. Report export: JSON export (`200 OK`, `analytics_report_exports` row created); CSV export (`text/csv` with RFC 4180 headers); triggers `prevent_analytics_export_update` and `prevent_analytics_export_delete` blocked UPDATE and DELETE; `access_log` audited `ANALYTICS_REPORT_EXPORT`.
        15. Company KPI summary cards: `GET /api/analytics/summary/company` returned all 10 KPI cards with valid `trend_arrow` (`UP`/`DOWN`/`FLAT`) and valid `status` (`ON_TRACK`/`AT_RISK`/`CRITICAL`).
        16. Frontend 5-file security audit: zero hardcoded credentials, universal `escapeHTML()`, dynamic `localStorage` token, server role verification, and all 5 files served with HTTP 200 OK.
        17. Seeded KPI deactivation: `PATCH /api/analytics/kpi/:id` with `is_active=0` succeeded (`200 OK`); `DELETE` blocked (`400 Bad Request`); reactivated with `is_active=1` (`200 OK`).
        18. Trend sparkline with 30+ snapshots: ran multiple refreshes to generate 30+ snapshots; `GET /api/analytics/dashboard/:id` returned `trend_snapshots` array length >= 30, verifying LIMIT 30 query.
      - Comprehensive Verification: `scripts/verify-prd23-integration.js` -> **197 / 197 PASS (100%)**.
      - Full Platform Regression Pass:
        - `scripts/verify-prd23-layer1.js` -> **175 / 175 PASS (100%)**
        - `scripts/verify-prd23-layer2.js` -> **110 / 110 PASS (100%)**
        - `scripts/verify-prd23-layer3.js` -> **111 / 111 PASS (100%)**
        - `scripts/verify-prd23-layer4.js` -> **100 / 100 PASS (100%)**
        - `scripts/verify-prd23-layer5.js` -> **82 / 82 PASS (100%)**
        - `scripts/verify-prd23-integration.js` -> **197 / 197 PASS (100%)**
        - `npm test` -> **13 / 13 test suites PASS (100%)**
      - Total PRD 23 Assertions Passing: **775 / 775 PASS (100%)**.
      - Definition of Done: All 20 items in `docs/23_ANALYTICS_KPI_DASHBOARD.md` verified and marked `[x]`.
      - **PRD 23 Status**: 100% COMPLETE AND PERMANENTLY SEALED.

- **PRD 24 — Client Portal**:
  - **Reverse Engineering Mandate (100% COMPLETE)**:
    - Authored comprehensive Reverse Engineering Report (`docs/prd24_reverse_engineering_report.md`) dissecting 5 market leaders: Notion, Monday.com, Basecamp, HubSpot, and Copilot.app.
    - Synthesized access-control models, client identity isolation, explicit item sharing patterns, threaded order communication, and append-only milestone approval workflows.
    - Discarded all competitor visual branding, styling, copy, and structural vulnerabilities.
  - **Layer 1 (Database, Schema & Immutability Triggers — 100% COMPLETE & VERIFIED)**:
    - Created 8 new relational tables in `src/db/schema.sql`, `src/db/database.js` (`CLIENT_PORTAL_SCHEMA_SQL`), and `src/db/migrate.js`:
      - `clients`: Isolated external client directory (separate from `users`).
      - `client_project_access`: Project container authorization with `access_level` (`VIEW`, `COMMENT`, `APPROVE`).
      - `client_shared_items`: Explicit opt-in sharing registry (`GANTT_ITEM`, `MILESTONE`, `BACKLOG_ITEM`, `DELIVERABLE`, `DOCUMENT`).
      - `client_orders`: Client intake request pipeline with `internal_notes` field.
      - `client_order_messages`: Threaded messages with `is_internal` flag.
      - `client_milestone_approvals`: Client milestone sign-off ledger with `decision`, `decision_note`, and `decided_at`.
      - `client_deliverable_feedback`: 5-star rating and feedback repository.
      - `client_activity_log`: Immutable client activity audit trail.
    - Created 18 performance and integrity indexes in SQLite.
    - Created 8 append-only SQLite DB triggers enforcing strict immutability:
      - `prevent_client_order_message_update` & `prevent_client_order_message_delete`
      - `prevent_client_milestone_approval_update` & `prevent_client_milestone_approval_delete`
      - `prevent_client_feedback_update` & `prevent_client_feedback_delete`
      - `prevent_client_activity_log_update` & `prevent_client_activity_log_delete`
    - Verified strict database pragmas: `journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`.
    - Comprehensive Verification: `scripts/verify-prd24-layer1.js` -> **216 / 216 PASS (100%)**.
    - Core Platform Regression: `npm test` -> **13 / 13 test suites PASS (100%)**.
  - **Layer 2 (Client Auth System & Security Isolation — 100% COMPLETE & VERIFIED)**:
    - Dedicated Client Auth Namespace: `/api/client/auth/*` (`accept-invite`, `login`, `logout`, `me`) mounted via `src/routes/client.routes.js`.
    - Dedicated Admin Client Management API: `POST /api/admin/clients/invite`, `POST /api/admin/clients/create`, `POST /api/admin/clients/:clientId/invite/resend`, `PATCH /api/admin/clients/:clientId/status` in `src/routes/admin.js`.
    - Business Service Engine: `src/services/clientAuthService.js` handling client invite creation, 32-byte cryptographic token generation, 72-hour server-side expiration checks, bcrypt password hashing, one-time token nullification, login, logout, profile fetching, and append-only activity logging.
    - Dedicated Client JWT Signing Secret: `process.env.CLIENT_JWT_SECRET` / `config.CLIENT_JWT_SECRET` with strictly mandated payload `{ clientId, email, role: 'CLIENT' }`.
    - Bi-Directional Token Isolation:
      - Internal endpoints (`src/middleware/auth.js`) strictly reject any token where `role === 'CLIENT'` (`403 Forbidden`).
      - Client portal endpoints (`src/middleware/clientAuth.js`) strictly reject internal user tokens (`401 Unauthorized`).
    - Sliding Window Rate Limiting: `clientLoginLimiter` middleware enforcing max 5 failed login attempts per 15 min per IP, returning `429 Too Many Requests` on subsequent attempts until lockout window expires or login succeeds.
    - Client Status Lifecycle & Suspensions: `INVITED` -> `ACTIVE` (on accept) -> `SUSPENDED` (admin action). Suspended client login blocked with `403 Forbidden`.
    - Activity Logging: Every auth event (`LOGIN`, `LOGOUT`, `FAILED_LOGIN`, `INVITE_ACCEPTED`) recorded in `client_activity_log` with IP address and user agent.
    - Comprehensive Verification: `scripts/verify-prd24-layer2.js` -> **74 / 74 PASS (100%)**.
    - Full Regression Passes:
      - `scripts/verify-prd24-layer1.js` -> **216 / 216 PASS (100%)**
      - `scripts/verify-prd24-layer2.js` -> **74 / 74 PASS (100%)**
      - `scripts/verify-prd23-integration.js` -> **197 / 197 PASS (100%)**
      - `npm test` -> **13 / 13 test suites PASS (100%)**
  - **Layer 3 (Admin Client Management API & Access Governance — 100% COMPLETE & VERIFIED)**:
    - Mandatory Fix Applied: Removed predictable fallback signing secret in `src/config.js`; throws error in production and issues warning in development.
    - Admin Client Operations Engine: Built `src/services/clientService.js` with 13 comprehensive functions:
      - `listClients`: Enriches client listing with `active_projects_count`.
      - `getClientDetail`: Full client profile, project access history, shared items, and activity trail.
      - `updateClient`: Updates client contact info/status with manual SQLite `updated_at`.
      - `grantProjectAccess`: Inserts/reactivates project containers (`UNIQUE(client_id, project_id)`).
      - `revokeProjectAccess`: Soft revocation (`is_active = 0, revoked_by, revoked_at`) — zero hard deletes.
      - `shareItem`: Explicit opt-in sharing with existence checks (Business Rule 15).
      - `unshareItem`: Soft unshare (`is_active = 0, unshared_by, unshared_at`) — zero hard deletes.
      - `getClientActivityLog`: Returns client activity stream.
      - `getAdminOrders`: Fetches orders with `internal_notes` visible to admin personas.
      - `updateOrderStatus`: Updates order progress and team assignment with manual `updated_at`.
      - `addOrderMessage`: Appends internal (`is_internal = 1`) or external (`is_internal = 0`) messages, backed by append-only triggers.
      - `requestMilestoneApproval`: Initiates milestone sign-off requests in `client_milestone_approvals`.
      - `getMilestoneApprovals`: Returns pending and historical milestone approval requests.
    - Admin Routes: Built `src/routes/adminClients.routes.js` with 15 endpoints mounted via `src/routes/admin.js` requiring internal JWT and `requireAdmin` role check (403 for members).
    - Access Logging: Every admin mutation and query logged to `access_log` via `logAccess`.
    - Comprehensive Verification: `scripts/verify-prd24-layer3.js` -> **121 / 121 PASS (100%)**.
    - Full Regression Passes:
      - `scripts/verify-prd24-layer1.js` -> **216 / 216 PASS (100%)**
      - `scripts/verify-prd24-layer2.js` -> **74 / 74 PASS (100%)**
      - `scripts/verify-prd24-layer3.js` -> **121 / 121 PASS (100%)**
      - `scripts/verify-prd23-integration.js` -> **197 / 197 PASS (100%)**
      - `npm test` -> **13 / 13 test suites PASS (100%)**
    - Client Logout Token Blacklist Note: Per specification in `docs/24_CLIENT_PORTAL.md`, client JWT tokens are stateless without a `client_sessions` table. Client logout logs `LOGOUT` to `client_activity_log`. Immediate revocation of client access is enforced server-side via `clients.status === 'ACTIVE'` check on every request in `authenticateClientToken`.
  - **Layer 4 (Client-Facing API & Read Engine — 100% COMPLETE & VERIFIED)**:
    - Service Engine: Built `src/services/clientFacingService.js` with 10 client-facing functions implementing zero-trust isolation:
      - `getClientProjects`: Returns projects with active access (`cpa.is_active = 1 AND cpa.client_id = client.id`), excluding internal team metadata.
      - `getClientProjectOverview`: Enforces active project access; queries shared milestones, gantt items, and backlog items joined strictly with `client_shared_items`. Completely omits unshared items.
      - `getClientProjectTimeline`: Returns only shared gantt items for the granted project.
      - `getClientProjectMilestones`: Returns only shared milestones with approval status (`cma.decision`, `cma.decision_note`, `cma.requested_at`, `cma.decided_at`).
      - `submitClientOrder`: Validates title/description, checks project access if provided, inserts into `client_orders`, and strips `internal_notes`.
      - `getClientOrders`: Queries client's own orders, omitting `internal_notes` from SQL query and stripping defensively before returning.
      - `getClientOrderDetail`: Enforces client ownership (403 if belonging to another client), strips `internal_notes`, and fetches messages with mandatory `WHERE order_id = ? AND is_internal = 0` filter.
      - `addClientOrderMessage`: Enforces order ownership, inserts message with `sender_type = 'CLIENT'`, `is_internal = 0`, updates order `updated_at`, and logs activity.
      - `decideMilestoneApproval`: Validates decision (`APPROVED` | `REJECTED`), checks client ownership, blocks re-deciding, updates approval record, and on approval updates `gantt_milestones (status = 'ACHIEVED', achieved_at = datetime('now'), updated_at = datetime('now'))`.
      - `submitClientFeedback`: Enforces active project access, runs pre-insert check against `client_shared_items` (403 if unshared), validates rating (1-5), inserts into `client_deliverable_feedback`, and logs activity.
    - Route Architecture: Updated `src/routes/client.routes.js` to mount all 10 client-facing endpoints guarded with `clientAuthMiddleware`. Static and named routes ordered before parameterized routes.
    - Mandatory Security Invariants Verified:
      - Invariant 1 (Client JWT only, internal tokens receive 401): VERIFIED
      - Invariant 2 (`is_internal = 1` messages never returned, SQL filter mandatory): VERIFIED
      - Invariant 3 (`internal_notes` stripped from client order responses): VERIFIED
      - Invariant 4 (`client_shared_items` zero-trust access gate): VERIFIED
      - Invariant 5 (Client project access check, 403 on ungranted projects): VERIFIED
      - Invariant 6 (Pre-insert check for deliverable feedback, 403 on unshared items): VERIFIED
      - Invariant 7 (Client milestone approval restricted to owner & pending): VERIFIED
      - Invariant 8 (All client actions logged to `client_activity_log`): VERIFIED
      - Invariant 9 (`updated_at` manually updated on SQLite row mutations): VERIFIED
      - Invariant 10 (Route ordering: static before parameterized routes): VERIFIED
    - Comprehensive Verification: `scripts/verify-prd24-layer4.js` -> **111 / 111 PASS (100%)**.
    - Full Regression Passes:
      - `scripts/verify-prd24-layer1.js` -> **216 / 216 PASS (100%)**
      - `scripts/verify-prd24-layer2.js` -> **74 / 74 PASS (100%)**
      - `scripts/verify-prd24-layer3.js` -> **121 / 121 PASS (100%)**
      - `scripts/verify-prd24-layer4.js` -> **111 / 111 PASS (100%)**
      - `scripts/verify-prd23-integration.js` -> **197 / 197 PASS (100%)**
      - `npm test` -> **13 / 13 test suites PASS (100%)**
    - Layer 5 Status: 100% COMPLETE & VERIFIED.
  - **Layer 5 (Client Portal Frontend Views — 100% COMPLETE & VERIFIED)**:
    - 6 Production Frontend HTML Views Created in `public/`:
      - `public/client-login.html`: Dedicated client login with rate limiting & 429 lockout handling. Stores `clientToken` exclusively; redirects authenticated clients to `client-dashboard.html`.
      - `public/client-invite.html`: Cryptographic invite token validation on page load via `GET /api/client/auth/validate-invite?token=...`, $\ge 8$ char password confirmation, activates account via `POST /api/client/auth/accept-invite`.
      - `public/client-dashboard.html`: Dark glassmorphism dashboard displaying active project count, pending order count, milestone approvals needed count, recent activity feed, quick action links, and server-verified profile guard (`GET /api/client/auth/me`).
      - `public/client-project.html`: Client project workspace featuring Project Selector dropdown, and 4 modular tabs:
        - Timeline: Shared Gantt tasks list with status pills, dates, and progress bars.
        - Milestones: Shared milestones with target dates and interactive "Review & Sign Off" approval modal.
        - My Orders: Project-specific orders with instant request submission modal.
        - Deliverables & Feedback: Shared deliverables gallery with interactive 1-5 star rating and feedback review modal.
      - `public/client-orders.html`: Client Order Management Center with order list, interactive filter tabs (`ALL`, `ACTIVE`, `COMPLETED`), "Submit New Request" modal, status stepper, and sanitized message thread with client reply box. Strictly zero internal notes rendered.
      - `public/admin-client-management.html`: Internal admin management view with client directory table, "Create Client" invite generator with copyable link, Client Detail modal (project access grant/revoke, deliverable share/unshare, activity audit log, invite resend), and Admin Order Management table with `internal_notes` and `is_internal` message toggle.
    - 10 Mandatory Frontend Security Rules Verified:
      - Rule 1 (Zero Hardcoded Credentials): VERIFIED across all 6 views.
      - Rule 2 (`clientToken` Storage Separation): VERIFIED (`clientToken` used; never mixed with internal user `token`).
      - Rule 3 (`clientUser` Sanitization): VERIFIED (never contains password hash, `internal_notes`, or `is_internal`).
      - Rule 4 (Client JWT in Authorization Header): VERIFIED for all client API calls.
      - Rule 5 (No Internal Endpoints Called by Client Pages): VERIFIED (zero `/api/admin/*` or `/api/superadmin/*` calls).
      - Rule 6 (`is_internal` Never Rendered): VERIFIED (never in DOM or JS variables on client pages).
      - Rule 7 (Zero Team/Revenue/Performance Data Rendered): VERIFIED.
      - Rule 8 (Admin Elements Absent from Client Interface): VERIFIED.
      - Rule 9 (Client-Side Validation UX with Server Source of Truth): VERIFIED.
      - Rule 10 (Server-Verified Navigation from `GET /api/client/auth/me`): VERIFIED.
    - Comprehensive Verification: `scripts/verify-prd24-layer5.js` -> **101 / 101 PASS (100%)**.
    - Full Platform Regression Passes:
      - `scripts/verify-prd24-layer1.js` -> **216 / 216 PASS (100%)**
      - `scripts/verify-prd24-layer2.js` -> **74 / 74 PASS (100%)**
      - `scripts/verify-prd24-layer3.js` -> **121 / 121 PASS (100%)**
      - `scripts/verify-prd24-layer4.js` -> **111 / 111 PASS (100%)**
      - `scripts/verify-prd24-layer5.js` -> **101 / 101 PASS (100%)**
      - `scripts/verify-prd23-integration.js` -> **197 / 197 PASS (100%)**
      - `npm test` -> **13 / 13 test suites PASS (100%)**
    - Layer 6 Status: Strictly HALTED pending explicit user GO-AHEAD.

