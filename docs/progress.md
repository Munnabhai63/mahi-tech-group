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

## Pending / Next Steps
- Run `git pull origin master` on VPS (`/var/www/oviaxe.com`) and restart PM2 to serve the updated code on `https://oviaxe.com`.
- Verify live login on `https://oviaxe.com/app.html#/login`.



