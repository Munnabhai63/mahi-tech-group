# PRD 24 — Client Portal: Reverse Engineering Report

**Date:** 2026-10-28  
**Author:** Antigravity (Senior Full-Stack Orchestrator)  
**Target:** Mahi Tech Group Unified Platform  
**Reference Specification:** [docs/24_CLIENT_PORTAL.md](file:///f:/UserData/Downloads/MAHI%20TECH%20GROUP/docs/24_CLIENT_PORTAL.md)  
**Status:** COMPLETED & SUBMITTED FOR CONFIRMATION  

---

## 1. Executive Summary

This report fulfills the mandatory **Reverse Engineering Mandate** set forth in PRD 24 before implementing Layer 1 database schemas, triggers, and services. Five market-leading client portal and guest-access platforms were reverse-engineered and evaluated:

1. **Notion** (External page and database guest sharing, permission inheritance)
2. **Monday.com** (Shareable boards, guest seats, item updates thread)
3. **Basecamp** (Project-level Client Access, "Visible to client" item toggles, private team memos)
4. **HubSpot Client Portal** (Customer ticket management, authenticated knowledge base, intake forms)
5. **Copilot.app** (Dedicated agency client portal, white-labeled modules, isolated client identities)

All competitor proprietary visual branding, typography, color palettes, CSS stylesheets, UI icons, and copyrighted marketing copy have been strictly discarded. The core relational models, access-control boundaries, invitation lifecycles, order submission mechanics, message thread filtering, and append-only approval workflows have been abstracted and re-architected natively for the Mahi Tech Group platform (Node.js, SQLite WAL mode with `busy_timeout = 5000` and `foreign_keys = ON`, Express 5, vanilla HTML5/CSS3/SVG).

---

## 2. Competitor Breakdown & Flow Analysis

| Competitor | Client Identity & Auth | Project & Item Visibility | Communication & Messaging | Orders & Approvals | Critical Architectural Flaws |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Notion** | External guests authenticate via global Notion accounts. Guests share the same user model. | Page-level sharing with sub-page inheritance. Database views can accidentally leak hidden properties if unlocked. | Page comments and discussion threads. No concept of internal team comments on client-visible pages. | No native order management or formal milestone approval ledger. | High risk of accidental data exposure through linked database filters or nested page permission inheritance. |
| **Monday.com** | Guests invited by email; stored in the main account user directory with a `guest` role flag. | Restricted to designated "Shareable Boards". Can view all board columns unless individual column permissions are configured. | Item updates feed. Team members must use `@mentions` or separate boards to prevent client viewing. | Basic status column changes; no cryptographically sealed approval history or intake order state machine. | Guests share the main database user directory. Leaks internal team names, automation logs, and board metadata if column masks are omitted. |
| **Basecamp** | Clients invited as project contacts; separate category within the project team directory. | Per-project "Client Access" toggle. Individual messages, to-dos, and documents have "Visible to client" switches. | Threaded messages with an internal team toggle ("Private to team" banner). | Formal client approvals for to-dos and deliverables with client sign-off records. | Mixing internal team chats and client messages in a single feed relying on a UI checkbox leads to frequent human leaks of internal notes. |
| **HubSpot** | Dedicated customer contact directory. Separate portal login with magic links or password. | Scoped strictly to tickets submitted by that customer or company. No project Gantt or sprint integration. | Ticket correspondence thread with support agents. Separate internal notes tab for team members. | Support tickets with basic status progression (Open, Pending, Resolved). No milestone approval ledger. | Rigorously siloed for helpdesk ticketing, but completely disconnected from real-time agile execution (Gantt, milestones, sprints, backlog). |
| **Copilot.app** | Completely isolated client accounts separate from agency workspace staff. Custom portal domain. | Explicit module and file sharing per client company. Zero access to internal operational workspaces. | Direct messaging channels between client and designated account manager. | Structured intake forms, digital signature contracts, and deliverable review workflows. | Proprietary closed ecosystem; expensive per-client seat licensing; lacks deep integration with developer workstreams and time tracking. |

---

## 3. Screen & View Mapping

In competitor ecosystems, client portals consist of six distinct primary view archetypes:

1. **Client Authentication & Setup Views:**
   - **Dedicated Client Login Screen:** Branded specifically for the agency/company; strictly segregated from internal employee authentication (no Google SSO/internal employee login buttons visible).
   - **Invite Token Acceptance Screen:** Cryptographically validated single-use landing page prompting first-time clients to establish their credentials with password confirmation.
2. **Client Overview & Hub Dashboard:**
   - Welcome banner displaying client name, linked active projects summary, count of pending actions (orders awaiting review, milestones awaiting approval), and recent deliverable updates.
3. **Client Project & Timeline View:**
   - Clean, high-level project view featuring tabs for Overview, Timeline (Gantt), Milestones, and Deliverable Feedback.
   - Crucially displays *only* items explicitly designated for client visibility, suppressing internal tasks, member hourly rates, and sprint backlog points.
4. **Client Order & Request Center:**
   - Intake form modal supporting categorized requests (`NEW_REQUEST`, `CHANGE_REQUEST`, `BUG_REPORT`, `FEEDBACK`, `APPROVAL_REQUEST`) with priority and file attachments.
   - Order tracking list displaying status stages (`SUBMITTED` → `UNDER_REVIEW` → `IN_PROGRESS` → `COMPLETED` / `REJECTED`).
   - Order detail view with two-way message thread between client and team, strictly omitting team-only internal notes.
5. **Milestone Review & Approval Screen:**
   - Clear milestone deliverable overview with associated criteria, target dates, and prominent "Approve" or "Reject" actions requiring client justification notes.
6. **Internal Admin Client Governance Center:**
   - Directory of registered clients, status toggles (`ACTIVE`, `SUSPENDED`, `INACTIVE`), project access grant/revoke panel, granular item sharing selector, order triaging with internal notes, and immutable client activity audit log.

---

## 4. Data Relationships & Schema Synthesis

To prevent the security failures observed in Notion and Monday.com, Mahi Tech Group implements **complete relational isolation**:

```
[users] (Internal Staff)
   │
   ├── (created_by) ───────┐
   │                       ▼
   │                  [clients] (Isolated Client Directory)
   │                       │
   │      ┌────────────────┼────────────────┬────────────────┐
   │      ▼                ▼                ▼                ▼
   │  [client_      [client_shared_   [client_orders]  [client_activity_
   │   project_      items]                  │          log]
   │   access]       (Explicit items only)   │          (Append-only)
   │      │                                  │
   │      ▼                                  ▼
   │  [projects]                   [client_order_messages]
   │      │                        (is_internal=0/1 filter)
   │      ▼
   │  [gantt_milestones]
   │      │
   │      ▼
   │  [client_milestone_approvals]
   │  (Append-only approval ledger)
```

### Core Relational Invariants:
1. `clients` table is completely independent from `users` — client credentials never mix with staff credentials.
2. `client_project_access` grants high-level project container access (`VIEW`, `COMMENT`, `APPROVE`).
3. `client_shared_items` enforces explicit opt-in sharing (`GANTT_ITEM`, `MILESTONE`, `BACKLOG_ITEM`, `DELIVERABLE`, `DOCUMENT`). If an item is not in this table, the client API returns `404 Not Found`.
4. `client_orders` tracks external requests. `internal_notes` is strictly stripped on client endpoints.
5. `client_order_messages` enforces `is_internal = 1` server-side isolation.
6. `client_milestone_approvals`, `client_deliverable_feedback`, and `client_activity_log` are guarded by SQLite append-only triggers.

---

## 5. What We Will NOT Copy

1. **No Shared User Tables (Anti-Pattern from Monday.com & Notion):**
   - We will NOT put clients in `users`. Mixing external users into the staff directory creates catastrophic permission escalation vectors.
2. **No Implicit/Inherited Permissions (Anti-Pattern from Notion):**
   - We will NOT expose all project tasks just because a project is shared. Only items in `client_shared_items` are visible.
3. **No UI-Only Internal Note Toggles (Anti-Pattern from Basecamp):**
   - We will NOT rely on frontend checkboxes to hide internal communications. `is_internal = 1` and `internal_notes` are filtered out at the SQL `WHERE` clause and service response level.
4. **No Unauthenticated Guest Links (Anti-Pattern from Jira & Public Portals):**
   - We will NOT support anonymous portal viewing. Every client interaction requires an authenticated client JWT with rate-limited session checks.
5. **No Competitor Visual Design or Copy:**
   - Zero copy-pasting of color schemes, icons, logos, or terminology.

---

## 6. What We WILL Reverse-Engineer & Rebuild Our Own Way

1. **Dual JWT Authentication Architecture:**
   - Dedicated `/api/client/auth/*` route namespace with a separate JWT signing secret and payload (`{ id, clientId, email, role: 'CLIENT' }`).
   - All internal `/api/*` endpoints strictly reject any token carrying `role: 'CLIENT'`.
2. **Cryptographic 72-Hour Invite Token Lifecycle:**
   - `crypto.randomBytes(32).toString('hex')` invite tokens expiring in 72 hours.
   - Immediate NULL-wiping upon successful account activation.
3. **Multi-Stage Order Progression Machine:**
   - Formal intake lifecycle (`SUBMITTED` → `UNDER_REVIEW` → `IN_PROGRESS` → `COMPLETED` / `REJECTED`) with internal team assignment and file attachments.
4. **Strict Dual-Audience Messaging Engine:**
   - Appending to `client_order_messages` allows internal team members to log private notes with `is_internal = 1` that are physically filtered out of client queries.
5. **Milestone Sign-Off & Status Automation:**
   - Approving a milestone via `client_milestone_approvals` logs an immutable audit event and automatically updates `gantt_milestones.status = 'ACHIEVED'`.
6. **Append-Only Activity Auditing:**
   - Every client action (`LOGIN`, `LOGOUT`, `VIEW_PROJECT`, `SUBMIT_ORDER`, `SEND_MESSAGE`, `APPROVE_MILESTONE`, `LEAVE_FEEDBACK`) is logged via database triggers.

---

## 7. Gaps in Competitors & Our Strategic Advantages

1. **Unified Pipeline-to-Portal Traceability:** Competitors separate customer portals from delivery tools. Mahi Tech Group links client orders directly to backlog items, milestones, and deliverables.
2. **Zero-Trust Data Protection by Default:** Competitors default to sharing entire boards or folders. We default to zero visibility until individual items are shared.
3. **Cryptographically Sealed Audit Ledger:** Competitors allow editing or deleting approval records. Our SQLite triggers physically abort SQL `UPDATE` and `DELETE` on all milestone approvals and feedback logs.
4. **Zero Cloud Per-Seat Toll:** Unlike Copilot.app or Monday.com charging $30–$50 per client guest, Mahi Tech Group runs self-hosted with unlimited zero-fee client access.

---

*Report submitted and registered. Layer 1 database schema implementation is authorized to proceed.*
