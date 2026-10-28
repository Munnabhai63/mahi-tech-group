# PRD 24 — Client Portal
**File:** docs/24_CLIENT_PORTAL.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 15 (Pipeline), PRD 18 (Sprint Planning), PRD 20 (Gantt), PRD 22 (Time Tracking), PRD 23 (Analytics)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Monday.com (Guest access, client portal — shared boards, view-only or comment-only access)
- ClickUp (Guest seats, client view — specific list/project shared externally)
- Basecamp (Client portal — dedicated client-facing area, message board, file sharing, approvals)
- Notion (Share page with external guests — view/comment/edit permissions)
- Jira (External service desk — customer portal for ticket submission and status tracking)
- Freshdesk / Zendesk (Customer portal — ticket submission, status tracking, KB access)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's client portal flow — how external users are invited, what they can see, how they submit requests, how approvals work, how progress is shared
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (Client → Portal → Project → Shared Items → Feedback/Approval)
4. Map every business rule (e.g., client cannot see internal team comments, client approval required before milestone closes, client invite link expires after X days)
5. Identify what we will NOT copy (visual design, branding, color scheme, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group a secure Client Portal where external clients can be invited to view project progress, submit orders/requests, approve milestones, give feedback on deliverables, and communicate with the team — all without ever seeing internal team data, member performance, or financial information. Built our own way.

---

## 👥 Roles & Permissions

### Internal Roles
| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Create Client account | ✅ | ✅ | ❌ |
| Invite Client to Project | ✅ | ✅ | ❌ |
| Revoke Client access | ✅ | ✅ | ❌ |
| Share specific items with Client | ✅ | ✅ | ❌ |
| View Client activity log | ✅ | ✅ | ❌ |
| Reply to Client messages | ✅ | ✅ | ✅ |
| Approve Client order/request | ✅ | ✅ | ❌ |
| View all Client portals | ✅ | ✅ | ❌ |

### Client Role (External — separate from internal roles)
| Action | Client |
|--------|--------|
| View shared project progress | ✅ |
| View shared Gantt/Timeline | ✅ |
| View shared milestones | ✅ |
| Submit new order/request | ✅ |
| View own order/request status | ✅ |
| Approve or reject milestone | ✅ |
| Leave feedback on deliverable | ✅ |
| Send message to team | ✅ |
| View internal team data | ❌ NEVER |
| View member performance | ❌ NEVER |
| View financial/revenue data | ❌ NEVER |
| View internal comments (is_internal=1) | ❌ NEVER |
| Access any internal API route | ❌ NEVER |

---

## 🗄️ Database Tables (New — 8 Tables)

### Table 1: clients

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  company_name TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  -- clients have their own login, separate from users table
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  -- ACTIVE | SUSPENDED | INACTIVE
  invite_token TEXT,
  -- cryptographically random 32-byte token for first-time login setup
  invite_token_expires_at TEXT,
  invite_accepted_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- invite_token: 32 bytes minimum, cryptographically random (crypto.randomBytes)
-- invite_token expires in 72 hours
-- After invite accepted: invite_token set to NULL

### Table 2: client_project_access

CREATE TABLE client_project_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  access_level TEXT NOT NULL DEFAULT 'VIEW',
  -- VIEW | COMMENT | APPROVE
  granted_by INTEGER NOT NULL REFERENCES users(id),
  granted_at TEXT DEFAULT (datetime('now')),
  revoked_by INTEGER REFERENCES users(id),
  revoked_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(client_id, project_id)
);
-- is_active = 0 means revoked but record kept for audit
-- Append-only style: revocation = update is_active + revoked_by + revoked_at (exception)

### Table 3: client_shared_items

CREATE TABLE client_shared_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  item_type TEXT NOT NULL,
  -- GANTT_ITEM | MILESTONE | BACKLOG_ITEM | DELIVERABLE | DOCUMENT
  item_id INTEGER NOT NULL,
  -- references actual item id in source table
  shared_by INTEGER NOT NULL REFERENCES users(id),
  shared_at TEXT DEFAULT (datetime('now')),
  unshared_by INTEGER REFERENCES users(id),
  unshared_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
-- Only explicitly shared items are visible to client — nothing else

### Table 4: client_orders

CREATE TABLE client_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER REFERENCES projects(id),
  -- NULL if order is not yet linked to a project
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'NEW_REQUEST',
  -- NEW_REQUEST | CHANGE_REQUEST | BUG_REPORT | FEEDBACK | APPROVAL_REQUEST
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  -- LOW | MEDIUM | HIGH | URGENT
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  -- SUBMITTED | UNDER_REVIEW | IN_PROGRESS | AWAITING_CLIENT | COMPLETED | CANCELLED | REJECTED
  attachments TEXT,
  -- JSON: array of file paths/names
  assigned_to INTEGER REFERENCES users(id),
  -- internal team member handling this order
  due_date TEXT,
  internal_notes TEXT,
  -- NEVER returned to client API responses
  rejection_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- internal_notes NEVER returned to any client-facing endpoint

### Table 5: client_order_messages

CREATE TABLE client_order_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES client_orders(id),
  sender_type TEXT NOT NULL,
  -- CLIENT | TEAM
  sender_client_id INTEGER REFERENCES clients(id),
  sender_user_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  -- 1 = internal team message, NEVER returned to client
  attachments TEXT,
  -- JSON: array of file paths/names
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- is_internal=1 messages NEVER returned to client endpoints (CRITICAL security rule)

### Table 6: client_milestone_approvals

CREATE TABLE client_milestone_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  milestone_id INTEGER NOT NULL REFERENCES gantt_milestones(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  -- internal admin who requested client approval
  requested_at TEXT DEFAULT (datetime('now')),
  decision TEXT,
  -- APPROVED | REJECTED | NULL (pending)
  decision_note TEXT,
  -- client's feedback/reason
  decided_at TEXT,
  UNIQUE(client_id, milestone_id)
);
-- Append-only: DB trigger prevents update/delete

### Table 7: client_deliverable_feedback

CREATE TABLE client_deliverable_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  item_type TEXT NOT NULL,
  -- GANTT_ITEM | BACKLOG_ITEM | DOCUMENT
  item_id INTEGER NOT NULL,
  rating INTEGER,
  -- 1–5 stars; NULL if no rating given
  feedback_text TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  -- SUBMITTED | ACKNOWLEDGED | RESOLVED
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete

### Table 8: client_activity_log

CREATE TABLE client_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  action TEXT NOT NULL,
  -- LOGIN | LOGOUT | VIEW_PROJECT | SUBMIT_ORDER | SEND_MESSAGE |
  -- APPROVE_MILESTONE | REJECT_MILESTONE | LEAVE_FEEDBACK | DOWNLOAD_FILE
  item_type TEXT,
  item_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- Every client action logged automatically

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_client_order_message_update
BEFORE UPDATE ON client_order_messages
BEGIN SELECT RAISE(ABORT, 'client_order_messages is append-only'); END;

CREATE TRIGGER prevent_client_order_message_delete
BEFORE DELETE ON client_order_messages
BEGIN SELECT RAISE(ABORT, 'client_order_messages is append-only'); END;

CREATE TRIGGER prevent_client_milestone_approval_update
BEFORE UPDATE ON client_milestone_approvals
BEGIN SELECT RAISE(ABORT, 'client_milestone_approvals is append-only'); END;

CREATE TRIGGER prevent_client_milestone_approval_delete
BEFORE DELETE ON client_milestone_approvals
BEGIN SELECT RAISE(ABORT, 'client_milestone_approvals is append-only'); END;

CREATE TRIGGER prevent_client_feedback_update
BEFORE UPDATE ON client_deliverable_feedback
BEGIN SELECT RAISE(ABORT, 'client_deliverable_feedback is append-only'); END;

CREATE TRIGGER prevent_client_feedback_delete
BEFORE DELETE ON client_deliverable_feedback
BEGIN SELECT RAISE(ABORT, 'client_deliverable_feedback is append-only'); END;

CREATE TRIGGER prevent_client_activity_log_update
BEFORE UPDATE ON client_activity_log
BEGIN SELECT RAISE(ABORT, 'client_activity_log is append-only'); END;

CREATE TRIGGER prevent_client_activity_log_delete
BEFORE DELETE ON client_activity_log
BEGIN SELECT RAISE(ABORT, 'client_activity_log is append-only'); END;

---

## 🔐 Security Rules (CRITICAL — Non-Negotiable)

1. Client authentication is COMPLETELY SEPARATE from internal user authentication
   - Clients use /api/client/auth/* routes only
   - Clients get their own JWT with role='CLIENT' embedded
   - Client JWT never grants access to any /api/* internal route
2. All client-facing routes under /api/client/* namespace only
3. Internal routes under /api/* must reject any JWT with role='CLIENT'
4. is_internal=1 messages NEVER returned to any client endpoint — server-side filter mandatory
5. internal_notes field on client_orders NEVER returned to any client endpoint
6. Client can ONLY see items explicitly listed in client_shared_items — no bulk project data access
7. Member performance data, revenue data, financial data — NEVER accessible to client
8. invite_token: crypto.randomBytes(32).toString('hex') — minimum 32 bytes
9. invite_token expires in 72 hours — service rejects expired tokens
10. After invite accepted: invite_token set NULL immediately
11. Client password stored as bcrypt hash — never plaintext
12. Every client action logged to client_activity_log automatically (middleware)
13. Client IP address logged on every request
14. Rate limiting on client auth endpoints: max 5 failed login attempts → account temporarily locked 15 minutes
15. No anonymous/guest access to any client portal page — login required always

---

## 🔌 API Routes (28 Endpoints)

### Client Auth Routes (/api/client/auth/*)

POST   /api/client/auth/accept-invite
         body: { invite_token, new_password }
         rule: validates token, sets password_hash, clears token, logs activity
         role: Public (invite token required)

POST   /api/client/auth/login
         body: { email, password }
         rule: rate limited; returns client JWT on success; logs LOGIN activity
         role: Public

POST   /api/client/auth/logout
         rule: logs LOGOUT activity
         role: Client JWT required

GET    /api/client/auth/me
         returns: client profile (no internal data)
         role: Client JWT required

### Internal Admin — Client Management Routes (/api/admin/clients/*)

POST   /api/admin/clients/create
         body: { name, email, company_name, phone }
         rule: creates client account + generates invite_token + sends invite email
         role: Admin+

GET    /api/admin/clients
         returns: all clients with status, project access count
         role: Admin+

GET    /api/admin/clients/:clientId
         returns: client detail + project access list + activity log
         role: Admin+

PATCH  /api/admin/clients/:clientId
         body: { name, company_name, phone, status }
         role: Admin+

POST   /api/admin/clients/:clientId/invite/resend
         rule: generates new invite_token (72hr expiry), sends new invite email
         role: Admin+

POST   /api/admin/clients/:clientId/access/grant
         body: { project_id, access_level }
         role: Admin+

PATCH  /api/admin/clients/:clientId/access/revoke
         body: { project_id }
         rule: sets is_active=0, logs in access_log
         role: Admin+

POST   /api/admin/clients/:clientId/share/item
         body: { project_id, item_type, item_id }
         role: Admin+

PATCH  /api/admin/clients/:clientId/share/item/:shareId/unshare
         rule: sets is_active=0
         role: Admin+

GET    /api/admin/clients/:clientId/activity
         returns: full client_activity_log for this client
         role: Admin+

GET    /api/admin/orders
         query: ?client_id=&project_id=&status=
         returns: all client orders (with internal_notes visible to Admin)
         role: Admin+

PATCH  /api/admin/orders/:orderId/status
         body: { status, internal_notes, assigned_to }
         role: Admin+

POST   /api/admin/orders/:orderId/message
         body: { message, is_internal }
         rule: is_internal=1 messages never sent to client
         role: Admin+ or assigned Member

POST   /api/admin/milestone/request-approval
         body: { client_id, project_id, milestone_id }
         rule: creates client_milestone_approvals row; notifies client
         role: Admin+

GET    /api/admin/milestone/approvals
         returns: all pending milestone approval requests
         role: Admin+

### Client-Facing Routes (/api/client/*)
-- All require Client JWT

GET    /api/client/projects
         returns: all projects client has active access to (no internal data)
         role: Client

GET    /api/client/project/:projectId/overview
         returns: project name, description, shared milestones, shared gantt items, shared backlog items
         rule: ONLY items in client_shared_items returned
         role: Client

GET    /api/client/project/:projectId/timeline
         returns: shared gantt items only (no internal items)
         role: Client

GET    /api/client/project/:projectId/milestones
         returns: shared milestones + approval status
         role: Client

POST   /api/client/orders/submit
         body: { project_id, title, description, order_type, priority, attachments }
         role: Client

GET    /api/client/orders
         returns: own orders (no internal_notes field ever)
         role: Client

GET    /api/client/orders/:orderId
         returns: order detail + messages (is_internal=0 only)
         role: Client (own orders only)

POST   /api/client/orders/:orderId/message
         body: { message, attachments }
         rule: sender_type=CLIENT; is_internal always 0 for client messages
         role: Client (own order only)

PATCH  /api/client/milestone/approval/:approvalId
         body: { decision, decision_note }
         rule: decision = APPROVED or REJECTED; logs to client_activity_log
         role: Client (own approval requests only)

POST   /api/client/feedback/submit
         body: { project_id, item_type, item_id, rating, feedback_text }
         rule: item must be in client_shared_items for this client
         role: Client

---

## 🖥️ Frontend Views (6 HTML Views)

### View 1: Client Login Page (client-login.html)
- Completely separate login page from internal login
- Email + password fields
- "First time? Accept your invite" link → redirects to invite acceptance page
- Rate limit warning shown after 3 failed attempts
- No internal branding visible — only Mahi Tech Group company branding
- Public page (no auth required)

### View 2: Client Invite Acceptance Page (client-invite.html)
- Token validated on page load (expired = error shown)
- Set new password form (min 8 chars, confirm password)
- Submit → account activated → redirect to client dashboard
- Public page (invite token required)

### View 3: Client Dashboard (client-dashboard.html)
- Welcome message: "Hello [Client Name], here's your project overview"
- Cards: active projects count, pending orders count, pending milestone approvals count
- Recent activity feed: last 10 actions (order updates, messages, milestone requests)
- Quick links: My Orders | Project Timeline | Pending Approvals
- Client JWT authenticated

### View 4: Client Project View (client-project.html)
- Project name + description
- Tabs: Timeline | Milestones | My Orders | Feedback
- Timeline tab: shared Gantt items only (read-only view)
- Milestones tab: shared milestones with PENDING/ACHIEVED/MISSED badge + Approve/Reject button for pending approvals
- My Orders tab: list of own submitted orders with status badges
- Feedback tab: list of shared deliverables with "Leave Feedback" button
- Client JWT authenticated

### View 5: Client Order Center (client-orders.html)
- "Submit New Request" button → form modal
  - Order type selector, title, description, priority, file attachment
- List of all own orders:
  - Each row: title, type, status badge, submitted date, assigned team member name (no other member data)
- Click order → order detail view:
  - Status timeline (SUBMITTED → UNDER_REVIEW → IN_PROGRESS → COMPLETED)
  - Message thread (client messages + team replies, internal messages NEVER shown)
  - Reply box at bottom
- Client JWT authenticated

### View 6: Admin Client Management (admin-client-management.html)
- Table: client name | company | email | status | projects linked | last active | actions
- "Create Client" button → form modal (name, email, company, phone)
- Click client row → client detail:
  - Profile info + edit
  - Project access list: project name | access level | granted date | Revoke button
  - "Grant Access" button → project picker + access level selector
  - Shared items list: item type | item title | shared date | Unshare button
  - "Share Item" button → type picker + item picker
  - Activity log: chronological list of all client actions
  - "Resend Invite" button (if not yet accepted)
- Admin order management:
  - All orders table with internal_notes visible
  - Status update dropdown per order
  - Message thread with is_internal toggle for internal notes
- Admin JWT authenticated

---

## ⚙️ Business Rules (Non-Negotiable)

1. Client authentication is FULLY SEPARATE from internal user system — different JWT secret, different routes, different middleware
2. Client JWT with role=CLIENT must be rejected by ALL internal /api/* routes
3. is_internal=1 messages NEVER returned to client — server-side WHERE clause mandatory, not just UI hide
4. internal_notes on client_orders NEVER included in any client API response — field stripped in service layer
5. Client sees ONLY items explicitly in client_shared_items — no implicit access
6. invite_token minimum 32 bytes, cryptographically random, expires 72 hours
7. After invite accepted: invite_token immediately set to NULL
8. Rate limit: 5 failed login attempts → 15 minute lockout (tracked in memory or DB)
9. Every client action automatically logged to client_activity_log via middleware
10. Client cannot see: member names beyond assigned handler, performance data, revenue data, financial data, internal comments, team structure
11. Milestone approval by client auto-updates gantt_milestones.status if APPROVED
12. Client order messages are append-only — neither client nor team can edit or delete sent messages
13. Client feedback is append-only — cannot be edited after submission
14. Client access revocation takes effect immediately — revoked client JWT rejected on next request (JWT expiry check + is_active check on each request)
15. Admin cannot share an item type that does not exist in client_shared_items source tables
16. updated_at manually updated in service on every PATCH
17. Server-side RBAC for all internal routes — never trust client-side role
18. No hardcoded credentials anywhere in client-facing JS

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations
- Create 8 tables
- Create 8 triggers
- Verify all triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: Client Auth System (Completely Separate)
- clientAuthService.js
- Invite token generation + acceptance
- Client login + JWT issuance (separate secret)
- Client JWT middleware (rejects on internal routes)
- Rate limiting implementation
- Activity log middleware
- Real HTTP tests (login, invite acceptance, rate limit)
- Must pass before Layer 3 begins

### Layer 3: Admin Client Management API
- clientService.js (create, grant access, share items, revoke)
- Admin order management routes
- Milestone approval request routes
- Real HTTP tests
- Must pass before Layer 4 begins

### Layer 4: Client-Facing API
- All /api/client/* routes
- is_internal filter enforced in every message endpoint (real test)
- internal_notes stripped in every order endpoint (real test)
- client_shared_items gate enforced (real test — unshared item access blocked)
- Milestone approval endpoint
- Feedback submission endpoint
- Real HTTP tests
- Must pass before Layer 5 begins

### Layer 5: Frontend (6 Views)
- Client Login Page
- Client Invite Acceptance Page
- Client Dashboard
- Client Project View
- Client Order Center
- Admin Client Management
- All views functional before Layer 6

### Layer 6: Integration + Full Test Suite
- End-to-end: create client → generate invite → accept invite → login → view shared project → submit order → team replies → client replies → team sends internal message (verify client cannot see it) → request milestone approval → client approves → verify milestone status updated → leave feedback → admin views activity log
- Client JWT rejected on internal route (real HTTP test)
- Unshared item access blocked (real HTTP test)
- is_internal message hidden from client (real HTTP test)
- internal_notes stripped from client order response (real HTTP test)
- Rate limit lockout test (real 5 failed attempts)
- invite_token expiry test (real expired token rejected)
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 25 begins

---

## 📊 Test Scripts

scripts/verify-prd24-layer1.js        (DB + triggers)
scripts/verify-prd24-layer2.js        (Client Auth System)
scripts/verify-prd24-layer3.js        (Admin Client Management API)
scripts/verify-prd24-layer4.js        (Client-Facing API + Security Gates)
scripts/verify-prd24-layer5.js        (Frontend smoke)
scripts/verify-prd24-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [ ] 8 tables created and verified
- [ ] 8 triggers tested (append-only confirmed with real DB calls)
- [ ] 28 API endpoints working with real HTTP calls
- [ ] Client JWT rejected on internal routes (real HTTP test)
- [ ] is_internal=1 messages hidden from client (real HTTP test — not just UI)
- [ ] internal_notes stripped from client order responses (real HTTP test)
- [ ] Unshared item access blocked (real HTTP test)
- [ ] Rate limit lockout tested (real 5 failed attempts)
- [ ] invite_token expiry tested (real expired token rejected)
- [ ] Milestone approval updates gantt_milestones.status (real test)
- [ ] Client feedback append-only confirmed (real UPDATE/DELETE attempt blocked)
- [ ] 6 frontend views functional
- [ ] Client portal completely visually separate from internal dashboard
- [ ] All existing 469 tests still passing
- [ ] Reverse Engineering Report submitted and confirmed
- [ ] Honest Status Report submitted
- [ ] Admin GO-AHEAD received
- [ ] Committed to GitHub with message: feat(client-portal): PRD 24 complete

---

*PRD 24 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*