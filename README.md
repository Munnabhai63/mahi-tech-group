# MAHI TECH GROUP

> **Enterprise-Grade Decentralized Team Orchestration & Innovation Execution Platform**

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/Munnabhai63/mahi-tech-group)
[![Tests](https://img.shields.io/badge/tests-265%2F265%20passing-success.svg)](https://github.com/Munnabhai63/mahi-tech-group)
[![Node.js](https://img.shields.io/badge/Node.js-v24%20(ESM)-blue.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/SQLite-native%20DatabaseSync-informational.svg)](https://sqlite.org/)
[![Security](https://img.shields.io/badge/security-AES--256--GCM-red.svg)](https://github.com/Munnabhai63/mahi-tech-group)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

---

## 📌 Overview

**MAHI TECH GROUP** is a full-stack, enterprise-grade decentralized team orchestration and project execution platform. Engineered with a zero-trust operational security model, it empowers multidisciplinary product teams to ideate, vote, execute, collaborate, and distribute revenue autonomously with cryptographic integrity.

- **Democratic Governance**: Supermajority quadratic voting mechanisms with dynamic quorum auto-extension, idea quotas, and executive veto gates.
- **9-Track Autonomous Fan-Out**: Approved ideas automatically generate parallel work streams with strict dependency enforcement and workload balancing across engineering, design, research, and production tracks.
- **Immutable Revenue Ledger**: Automated profit-sharing engine based on verifiable contribution points, bounded by a strict 5-month operational window with manual withdrawal verification.
- **Real-Time Collaboration**: Distributed low-latency co-working whiteboard canvas (Last-Write-Wins attribution) alongside encrypted Jitsi video conferencing with AI meeting summarization.
- **Super Admin Governance**: Deep executive telemetry, stealth performance intelligence, SLA-driven support ticketing, tamper-proof SQLite triggers, and cryptographically signed digital dispute settlements.

---

## 🚀 Key Features

| Feature Area | Description |
| :--- | :--- |
| **Strict Role-Based Access Control (RBAC)** | Granular permissions across 5 roles: `Admin`, `Researcher`, `UI/UX Designer`, `Developer`, and `Producer` with cryptographic JWT session validation and revocation. |
| **Idea Quota & Democratic Voting** | Fixed monthly ideation quotas, quadratic supermajority voting, anti-deadlock quorum extensions, and executive veto capability. |
| **9-Track Parallel Project Fan-Out** | Instant automated fan-out upon proposal approval into 9 parallel tracks (Research, Architecture, UI/UX, Frontend, Backend, QA, DevOps, Security, Production). |
| **Administrative Offboarding Kill-Switch** | 7-step fail-safe termination sequence: immediate session revocation, active task reassignment, organizational asset reclamation, and wallet freeze. |
| **Automated Revenue Split Engine** | 5-month boundary profit allocation based on contribution points with an immutable financial ledger and dual-admin withdrawal verification. |
| **Real-Time Co-Working Canvas** | Interactive multi-room vector canvas powered by WebSockets, conflict-free Last-Write-Wins (LWW) element resolution, and snapshot persistence. |
| **Encrypted Meeting & AI Governance** | End-to-end encrypted Jitsi video integration, tamper-proof attendance triggers, and AI-powered meeting notes summarization. |
| **Executive Super Admin Panel** | Command center featuring stealth member performance analytics, threaded support ticketing, and comprehensive audit stream filters. |
| **Digital Dispute Signing Ceremony** | Legally binding digital dispute settlements and liability waivers authenticated via 32-byte cryptographic tokens. |
| **AES-256-GCM Payment Gateway Security** | Encrypted payment gateway API credentials at rest with 96-bit random IVs and 128-bit authentication tags, preventing secret exposure. |
| **Tamper-Proof Append-Only Triggers** | 7 active SQLite database-level triggers enforcing permanent immutability on audit logs, waivers, dispute signatures, and data governance records. |

---

## 🛠️ Technology Stack

- **Runtime Environment**: Node.js v24.19.0 (Native ECMAScript Modules `type: module`)
- **Backend Framework**: Express 5.3.0
- **Database Engine**: Native SQLite (`node:sqlite` DatabaseSync) with Write-Ahead Logging (WAL) and 35 relational tables
- **Real-Time Engine**: WebSocket (`ws` v8.22.0)
- **Security & Cryptography**: Node.js `node:crypto` (AES-256-GCM, SHA-256, PBKDF2), `bcryptjs` (salt rounds: 12), and `jsonwebtoken`
- **Frontend Architecture**: Modern Semantic HTML5, Vanilla CSS3 (Custom design system, CSS Grid/Flexbox), Vanilla JS (Zero runtime bloat)
- **Video Conferencing**: Jitsi Meet IFrame API integration
- **File & Media Handling**: Multer v2.5.0 with strict MIME-type validation
- **Testing & QA Harness**: Custom automated Node.js ESM test runners + Playwright cross-browser multi-viewport testing (Google Chrome, Microsoft Edge, Mozilla Firefox)

---

## 💻 Installation & Quick Start

### Prerequisites
- Node.js >= 20.0.0 (Node.js 22 or 24 recommended)
- npm >= 9.0.0
- Git

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Munnabhai63/mahi-tech-group.git
cd mahi-tech-group
npm install
```

### 2. Run Database Migrations & Seeds
Initialize the SQLite schema (35 tables and 7 immutable triggers) and populate default roles:
```bash
npm run migrate
npm run seed
```

### 3. Start Development Server
```bash
npm start
```
The server will start on `http://127.0.0.1:4000` with WebSocket support enabled.

### 4. Run Automated Test Suites
Run the core regression test suite:
```bash
npm test
```
Run the comprehensive Super Admin & End-to-End integration suite:
```bash
node scripts/run-step14-superadmin-tests.js
```
Run cross-browser UI/UX audits:
```bash
node scripts/run-step13-final-qa-tests.js
```

---

## 🖥️ Screen & Module Directory

| # | Screen / Module | Endpoint / Path | Description |
| :--- | :--- | :--- | :--- |
| 1 | **Center Dashboard** | [`public/index.html`](public/index.html) | Live voting feed, Kanban execution board, idea submission modal, and persistent real-time toast notifications. |
| 2 | **4-Corner Role Dashboards** | Integrated in `/` | Context-aware dedicated operational views for Researcher, UI/UX Designer, Developer, and Producer roles. |
| 3 | **Co-Working Canvas** | [`public/canvas.html`](public/canvas.html) | Multi-user collaborative whiteboard canvas with shape tools, freehand drawing, real-time sync, and snapshot export. |
| 4 | **Encrypted Video Meetings** | [`public/meetings.html`](public/meetings.html) | Jitsi video conference rooms with real-time attendee tracking and AI meeting transcript record keeping. |
| 5 | **User Profile & Wallet** | [`public/profile.html`](public/profile.html) | Privacy-gated earnings telemetry, contribution scoring, active project history, and credential updating. |
| 6 | **Admin Control Panel** | [`public/admin.html`](public/admin.html) | 8-module administrative suite: member directory, task reassignment, idea management, withdrawal disbursals, and audit log analysis. |
| 7 | **Super Admin Executive Panel** | [`public/superadmin.html`](public/superadmin.html) | High-privilege command center: stealth analytics, support tickets, disputes, payment gateways, and system integrity audits. |
| 8 | **Digital Signing Ceremony** | [`public/sign.html`](public/sign.html) | Cryptographic signature execution gateway for disputes and liability waivers using single-use 32-byte tokens. |

---

## 🔒 Security & Database Immutability Model

### 1. Zero Plaintext Secrets Policy
- Payment gateway API secrets and webhook keys are encrypted at rest using **AES-256-GCM** with unique 96-bit random IVs and 128-bit authentication tags.
- Client-side code and logs contain strictly **0 plaintext passwords or secret tokens**.

### 2. SQLite Database-Level Immutable Triggers
The platform enforces append-only immutability at the SQLite database layer. Any direct `UPDATE` or `DELETE` query targeting these records is aborted by the engine:
- `prevent_dispute_signature_delete`: Protects digital dispute signatures from deletion.
- `prevent_dispute_signature_update`: Protects digital dispute signatures from tampering.
- `prevent_waiver_signature_delete`: Prevents deletion of signed liability waivers.
- `prevent_waiver_signature_update`: Prevents alteration of signed liability waivers.
- `prevent_governance_delete`: Guarantees member consent and restriction history cannot be erased.
- `prevent_governance_update`: Guarantees compliance records cannot be modified.
- `prevent_meeting_attendance_delete`: Ensures meeting attendance logs remain permanent.

---

## 📚 Documentation Index

Complete specifications and development roadmaps are documented in the repository:

- [Master System Completion Report (`COMPLETION_REPORT.md`)](COMPLETION_REPORT.md) — Comprehensive verification audit and step history.
- [Master Index & Governance Protocol (`00_1_MASTER_INDEX_README.md`)](00_1_MASTER_INDEX_README.md) — Architecture index and reading order.
- [Reverse Engineering Enforcement (`00_2_REVERSE_ENGINEERING_ENFORCEMENT_PROTOCOL.md`)](00_2_REVERSE_ENGINEERING_ENFORCEMENT_PROTOCOL.md) — Originality and design guidelines.
- [AI Integration Master Module (`00_3_AI_INTEGRATION_MASTER_MODULE.md`)](00_3_AI_INTEGRATION_MASTER_MODULE.md) — AI advisory guardrails ("AI Suggests. Human Decides.").
- [Database & Auth Backbone (`01_DATABASE_AUTH_BACKBONE.md`)](01_DATABASE_AUTH_BACKBONE.md) — RBAC and session lifecycle specifications.
- [Idea Quota Engine (`02_IDEA_QUOTA_ENGINE.md`)](02_IDEA_QUOTA_ENGINE.md) — Monthly quota and deduction logic.
- [Voting Gate & Quorum (`03_VOTING_GATE.md`)](03_VOTING_GATE.md) — Quadratic supermajority voting model.
- [Parallel Fan-Out Engine (`04_PARALLEL_FANOUT.md`)](04_PARALLEL_FANOUT.md) — 9-track task dependency graph.
- [Offboarding Kill-Switch (`05_OFFBOARDING_KILLSWITCH.md`)](05_OFFBOARDING_KILLSWITCH.md) — 7-step administrative deactivation sequence.
- [Revenue Split Engine (`06_REVENUE_SPLIT_ENGINE.md`)](06_REVENUE_SPLIT_ENGINE.md) — Contribution-weighted financial accounting.
- [Super Admin Panel (`14_SUPER_ADMIN_PANEL.md`)](14_SUPER_ADMIN_PANEL.md) — Executive governance and compliance specifications.

---

## 📄 License

ISC License © 2026 MAHI TECH GROUP.
