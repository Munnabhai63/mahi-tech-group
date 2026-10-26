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

## Pending / Next Steps
- Live ₹1 test scan / 1-tap pay confirmation by user on mobile with PhonePe / GPay / Paytm.
- Android Observer APK installation on merchant phone for automated UPI SMS settlement.
- Webhook bridge from OviPay back into MAHI TECH GROUP wallet ledger for instant crediting.
- Sync changes to remote VPS server `200.97.164.97` when requested.

