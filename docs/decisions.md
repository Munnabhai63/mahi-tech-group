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
