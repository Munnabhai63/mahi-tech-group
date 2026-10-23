FILE NAME: 14_SUPER_ADMIN_PANEL.md
SAVE LOCATION: Project root folder
(same folder as 00_1_MASTER_INDEX_README.md)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
14_SUPER_ADMIN_PANEL.md
MAHI TECH GROUP — SUPER ADMIN PANEL
Build Order: Step 14 (Final Extension Module)
Depends On: Steps 01 to 13 (All Approved)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


════════════════════════════════════════════════════════
STEP 1 OF 6 — FOUNDATION & ACCESS CONTROL
Folder: src/routes/superadmin.js
        src/services/superadminService.js
        public/superadmin.html
        public/js/superadmin.js
        public/css/superadmin.css
════════════════════════════════════════════════════════

WHAT TO BUILD IN STEP 1:
─────────────────────────

1A. Backend Route Foundation
  - Create src/routes/superadmin.js
  - Mount at /api/superadmin/* in src/app.js
  - Every single route in this file requires TWO middleware:
      authenticate (valid JWT)
      requireRole('admin') (role must be exactly 'admin')
  - Any non-admin hitting any /api/superadmin/* route
    must receive HTTP 403 immediately — no data, no error details
  - Admin cannot self-block, self-dispute, or self-demote
    (enforce: if req.user.id === target userId → HTTP 400)

1B. Frontend Page Foundation
  - Create public/superadmin.html (standalone page, NOT inside index.html)
  - On page load, first JS line:
      const user = JSON.parse(localStorage.getItem('user') || '{}')
      if (user.role !== 'admin') {
        alert('Access Denied — Insufficient Privileges')
        window.location.href = '/'
      }
  - 8-section sidebar navigation:
      1. Command Center (Overview)
      2. Full Member Directory
      3. Performance Intelligence
      4. Support Ticket Inbox
      5. Dispute Resolution Center
      6. Payment Gateway Control
      7. Full Data Governance
      8. Unified Audit Stream
  - Sidebar accent color: Deep Indigo #4338ca
    (distinct from Step 10 Admin Panel red #ef4444 —
     signals elevated privilege zone)
  - Reuse ToastManager from dashboard.js
  - Reuse formatINR() from dashboard.js

1C. Database — Two New Columns on Users Table
  - Run these migrations in src/db/migrate.js:
      ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP NULL;
      ALTER TABLE users ADD COLUMN avatar_url TEXT NULL;
  - Update authenticate middleware in src/middleware/auth.js:
      On every successful authenticated request,
      UPDATE users SET last_active_at = CURRENT_TIMESTAMP
      WHERE id = req.user.id

1D. Command Center API (Overview Dashboard)
  Endpoint: GET /api/superadmin/overview
  Returns one JSON object with these real-time counts:
    total_active_members   — COUNT users WHERE status='active'
    pending_applications   — COUNT users WHERE status='pending'
    open_tickets           — COUNT support_tickets WHERE status='open'
    active_projects        — COUNT projects WHERE status NOT IN ('LIVE','CANCELLED')
    revenue_this_month     — SUM revenue_events.amount WHERE month = current month
    pending_payouts        — COUNT withdrawals WHERE status='pending'
    pending_payouts_total  — SUM withdrawals.amount WHERE status='pending'
    open_disputes          — COUNT disputes WHERE status != 'closed'
    db_total_users         — COUNT all users (any status)

1E. Step 1 Tests (scripts/run-step14-superadmin-tests.js)
  TEST 01: Non-admin (researcher/designer/developer/producer)
           cannot access GET /api/superadmin/overview → HTTP 403
  TEST 02: Headless Playwright browser test:
           Load superadmin.html as non-admin user →
           alert 'Access Denied' fires → redirect to / verified
  TEST 03: Admin successfully gets overview JSON →
           all 9 fields present, all are numbers
  TEST 04: last_active_at updates on authenticated API call →
           verify timestamp changes after request

NON-NEGOTIABLES FOR STEP 1:
  No /api/superadmin/* route works without admin JWT — zero exceptions
  superadmin.html redirect must be verified by real Playwright test
  last_active_at migration must not break any existing Step 01-13 tests


════════════════════════════════════════════════════════
STEP 2 OF 6 — FULL MEMBER DIRECTORY &
              PERFORMANCE INTELLIGENCE
Folder: src/routes/superadmin.js (extend)
        src/services/superadminService.js (extend)
        public/js/superadmin.js (Section 2 + 3 controllers)
════════════════════════════════════════════════════════

WHAT TO BUILD IN STEP 2:
─────────────────────────

2A. Full Member Directory API
  GET /api/superadmin/members
    Returns ALL users (any status: active, inactive, pending,
    rejected, suspended) with these fields per user:
      id, name, email, phone_number, role, sub_role,
      desired_role, status, created_at, last_active_at,
      avatar_url, bio, wallet_frozen,
      ideas_count (COUNT from ideas WHERE submitter_id),
      projects_count (COUNT from project_members WHERE user_id),
      total_earnings (SUM from revenue_splits WHERE user_id),
      meetings_attended (COUNT from meeting_attendance WHERE user_id)
    Supports query params: ?status=&role=&search=&sort_by=&order=
    Search matches: name LIKE, email LIKE, phone_number LIKE

  GET /api/superadmin/members/:id
    Returns single user with ALL fields above PLUS:
      full idea history (id, title, status, created_at)
      full project history (project title, role_in_project,
                            tasks_assigned, tasks_completed)
      full earnings ledger (every revenue_splits row)
      full attendance history (every meeting_attendance row)
      full access_log entries for this user (last 100)

  GET /api/superadmin/members/export
    Returns CSV of all members with all directory fields
    Logs action='superadmin_member_export' in access_log

2B. Performance Intelligence API (STEALTH — zero trace for members)
  GET /api/superadmin/performance
    Returns performance summary for ALL active members
    Per member:
      ideas_submitted, ideas_approved, ideas_rejected,
      idea_approval_rate (percentage),
      tasks_assigned, tasks_completed, tasks_overdue,
      task_completion_rate (percentage),
      avg_task_completion_days,
      voting_participation_rate (votes cast / total votable ideas),
      meeting_attendance_rate (attended / total meetings),
      coworking_sessions_count,
      revenue_generated (SUM from ideas they own),
      revenue_earned (SUM from revenue_splits),
      composite_score (see formula below)

    Composite Score Formula (default weights, Admin-configurable):
      task_completion_rate × 0.30
      + idea_approval_rate × 0.25
      + voting_participation_rate × 0.20
      + meeting_attendance_rate × 0.15
      + (revenue_earned / max_team_revenue) × 0.10
      = composite_score (0.00 to 1.00, display as percentage)

  GET /api/superadmin/performance/:userId
    Same as above but single user, with month-by-month breakdown:
      Per month: tasks_completed, ideas_submitted, votes_cast
      Trend: 'improving' | 'declining' | 'stable'
      (compare last 3 months average vs previous 3 months)

  GET /api/superadmin/performance/leaderboard
    All active members sorted by composite_score descending
    Returns rank, name, role, composite_score, trend arrow

  GET /api/superadmin/performance/config
  PATCH /api/superadmin/performance/config
    Admin can edit composite score weight percentages
    Stored in system_config as performance_weight_* keys
    Weights must sum to exactly 1.00 — validation enforced
    Non-retroactive: existing scores recalculated on next fetch

  STEALTH GUARANTEE:
    No endpoint here writes any flag visible to the member
    Admin viewing performance is logged in access_log with
    action='superadmin_perf_view' — this entry is ONLY visible
    in the Unified Audit Stream (Section 8), never to the member
    Members have zero way to know Admin viewed their data

2C. Frontend — Section 2 (Member Directory)
  - Searchable table with all directory columns
  - Click any row → right-side drawer slides open
  - Drawer shows: all profile fields + 4 tabs:
      Tab 1: Ideas History
      Tab 2: Projects & Tasks
      Tab 3: Earnings Ledger
      Tab 4: Access History (last 100 access_log entries)
  - Quick action buttons in drawer:
      "Edit Role" → calls Step 10 PATCH /api/admin/members/:id
      "Initiate Block" → opens Section 7 block flow
      "Open Dispute" → opens Section 5 dispute form
      "Send Notification" → POST /api/notifications/direct (Admin→member)
  - Export CSV button → GET /api/superadmin/members/export

2D. Frontend — Section 3 (Performance Intelligence)
  - Leaderboard table: rank, name, role, score (%), trend arrow
  - Click any member → individual performance breakdown
  - Month-by-month bar chart (CSS-only or lightweight Chart.js)
  - Activity heatmap (GitHub-style, CSS grid — no external library)
  - Weight config panel: Admin adjusts 5 weight sliders, must total 100%

2E. Step 2 Tests (add to run-step14-superadmin-tests.js)
  TEST 05: Member directory returns all users with correct field set
  TEST 06: Search by email returns correct single member
  TEST 07: Performance endpoint returns composite_score between 0 and 1
  TEST 08: Performance view by Admin creates access_log entry
           action='superadmin_perf_view' — confirmed in DB
  TEST 09: Member has NO way to see that access_log entry
           (GET /api/users/:id/profile for that member returns
            no perf_view field — confirmed)
  TEST 10: Weight config PATCH with weights not summing to 1.00
           returns HTTP 400 validation error
  TEST 11: Export CSV endpoint returns Content-Type text/csv
           and logs to access_log

NON-NEGOTIABLES FOR STEP 2:
  Performance data is NEVER exposed via any member-accessible endpoint
  last_active_at must populate correctly from Step 1C middleware
  Composite score weights must always sum to exactly 1.00


════════════════════════════════════════════════════════
STEP 3 OF 6 — SUPPORT TICKET INBOX
Folder: src/routes/superadmin.js (extend)
        src/services/ticketService.js (NEW)
        src/db/schema.sql (new tables)
        public/js/superadmin.js (Section 4 controller)
════════════════════════════════════════════════════════

WHAT TO BUILD IN STEP 3:
─────────────────────────

3A. Database — New Tables

  CREATE TABLE support_tickets (
    id            TEXT PRIMARY KEY,
    ticket_number VARCHAR(20) UNIQUE NOT NULL,
    submitted_by  TEXT NOT NULL REFERENCES users(id),
    category      VARCHAR(50) NOT NULL CHECK (category IN (
                    'personal_query','business_query',
                    'payment_dispute','project_concern',
                    'technical_issue','offboarding_query',
                    'legal_matter','other')),
    priority      VARCHAR(20) NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','critical')),
    subject       VARCHAR(300) NOT NULL,
    description   TEXT NOT NULL,
    attachments   TEXT NULL,
    status        VARCHAR(30) NOT NULL DEFAULT 'open'
                  CHECK (status IN (
                    'open','in_progress','awaiting_member',
                    'resolved','closed','escalated')),
    assigned_to   TEXT NULL REFERENCES users(id),
    resolved_at   TIMESTAMP NULL,
    closed_at     TIMESTAMP NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE ticket_messages (
    id          TEXT PRIMARY KEY,
    ticket_id   TEXT NOT NULL REFERENCES support_tickets(id),
    sender_id   TEXT NOT NULL REFERENCES users(id),
    message     TEXT NOT NULL,
    attachments TEXT NULL,
    is_internal BOOLEAN DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  Ticket number format: TKT-0001, TKT-0002 (auto-increment sequential)
  is_internal = 1 means Admin-only note — NEVER returned to members

3B. Ticket API Endpoints

  POST /api/superadmin/tickets
    WHO: Any authenticated active member
    Creates ticket with status='open', auto-assigns ticket_number
    Validates: category, priority, subject (required), description (required)
    On create: Admin receives WebSocket notification (meeting:scheduled pattern)
               + DB notification inserted for Admin

  GET /api/superadmin/tickets
    WHO: Admin only
    Returns ALL tickets with filters:
      ?status=&category=&priority=&submitted_by=&date_from=&date_to=
    Includes: submitter name, days_open (calculated), message_count
    Highlight: tickets older than 48 hours without Admin response
               flagged with overdue: true in response

  GET /api/superadmin/tickets/my
    WHO: Any authenticated member
    Returns ONLY that member's own tickets
    Includes message thread (excluding is_internal=1 messages)

  GET /api/superadmin/tickets/:id
    WHO: Admin (full thread including internal notes)
         Ticket owner (thread excluding is_internal=1 messages)
         Other members: HTTP 403

  POST /api/superadmin/tickets/:id/messages
    WHO: Admin or ticket owner only
    Adds message to thread
    is_internal always forced to 0 for non-admins
    On Admin reply: member gets WebSocket + DB notification

  POST /api/superadmin/tickets/:id/internal-note
    WHO: Admin only
    Inserts ticket_messages row with is_internal=1
    Never returned to members under any circumstances

  PATCH /api/superadmin/tickets/:id/status
    WHO: Admin only
    Valid transitions:
      open → in_progress → awaiting_member → resolved → closed
      any → escalated
    On resolved: member gets notification
    On closed: member gets notification

  PATCH /api/superadmin/tickets/:id/priority
    WHO: Admin only
    Updates priority (low/normal/high/critical)

  PATCH /api/superadmin/tickets/:id/link-dispute
    WHO: Admin only
    Links ticket to a dispute record (dispute_id stored on ticket)

3C. Frontend — Section 4 (Ticket Inbox)
  - Inbox table: Ticket#, Submitter, Category, Subject,
                  Priority (color-coded), Status, Days Open
  - Color coding: Critical=red, High=orange, Normal=yellow, Low=green
  - Overdue badge (>48h): orange flash indicator
  - Click ticket → threaded message view opens
  - Admin sees all messages including internal notes
    (internal notes shown with lock icon, grey background)
  - Reply box: Admin can toggle "Internal Note" mode
  - Status dropdown in ticket header for quick transitions
  - "Link to Dispute" button

  Member-side:
  - "Support" button in main dashboard (bottom of sidebar)
  - Opens ticket submission form: Category, Subject, Description
  - "My Tickets" view: shows own tickets + thread (no internal notes)

3D. Step 3 Tests (add to run-step14-superadmin-tests.js)
  TEST 12: Member submits ticket → DB row created with status='open',
           ticket_number assigned (TKT-format), Admin notified in DB
  TEST 13: Admin replies to ticket → member gets notification,
           reply visible in GET /api/superadmin/tickets/my thread
  TEST 14: Admin adds internal note (is_internal=1) →
           member's GET /api/superadmin/tickets/my does NOT
           include that message — confirmed by message count
  TEST 15: Non-owner member cannot GET another member's ticket → HTTP 403
  TEST 16: Ticket > 48h without response → overdue:true in Admin list
  TEST 17: Status transition open→resolved → member notified

NON-NEGOTIABLES FOR STEP 3:
  is_internal=1 messages NEVER returned to members — zero exceptions
  Ticket numbers must be sequential and unique (TKT-0001 format)
  Members can only see their OWN tickets — HTTP 403 for others


════════════════════════════════════════════════════════
STEP 4 OF 6 — DISPUTE RESOLUTION CENTER
Folder: src/routes/superadmin.js (extend)
        src/services/disputeService.js (NEW)
        src/db/schema.sql (new tables)
        public/js/superadmin.js (Section 5 controller)
════════════════════════════════════════════════════════

WHAT TO BUILD IN STEP 4:
─────────────────────────

4A. Database — New Tables

  CREATE TABLE disputes (
    id                TEXT PRIMARY KEY,
    dispute_number    VARCHAR(20) UNIQUE NOT NULL,
    dispute_type      VARCHAR(50) NOT NULL CHECK (dispute_type IN (
                        'financial_settlement','ip_ownership',
                        'contribution_disagreement',
                        'offboarding_settlement',
                        'formal_complaint','legal_matter','other')),
    raised_by         TEXT NOT NULL REFERENCES users(id),
    against_party     TEXT NULL REFERENCES users(id),
    against_party_ext TEXT NULL,
    linked_ticket_id  TEXT NULL REFERENCES support_tickets(id),
    linked_project_id TEXT NULL REFERENCES projects(id),
    description       TEXT NOT NULL,
    status            VARCHAR(30) NOT NULL DEFAULT 'open'
                      CHECK (status IN (
                        'open','under_review','negotiation',
                        'pending_signatures','settled',
                        'closed','escalated_legal')),
    resolution_notes  TEXT NULL,
    settlement_amount DECIMAL(12,2) NULL,
    settlement_currency VARCHAR(10) DEFAULT 'INR',
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at         TIMESTAMP NULL,
    closed_by         TEXT NULL REFERENCES users(id)
  );

  CREATE TABLE dispute_parties (
    id          TEXT PRIMARY KEY,
    dispute_id  TEXT NOT NULL REFERENCES disputes(id),
    user_id     TEXT NULL REFERENCES users(id),
    party_name  TEXT NOT NULL,
    party_type  VARCHAR(30) CHECK (party_type IN (
                  'complainant','respondent','witness','admin')),
    added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE dispute_agreements (
    id             TEXT PRIMARY KEY,
    dispute_id     TEXT NOT NULL REFERENCES disputes(id),
    agreement_text TEXT NOT NULL,
    created_by     TEXT NOT NULL REFERENCES users(id),
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    version        INTEGER DEFAULT 1
  );

  CREATE TABLE dispute_signatures (
    id              TEXT PRIMARY KEY,
    agreement_id    TEXT NOT NULL REFERENCES dispute_agreements(id),
    signed_by       TEXT NOT NULL REFERENCES users(id),
    signed_at       TIMESTAMP NULL,
    signature_token TEXT NOT NULL,
    ip_address      TEXT NULL,
    agreed          BOOLEAN NOT NULL
  );
  -- APPEND-ONLY TRIGGER: prevent_dispute_signature_delete
  -- Blocks DELETE on dispute_signatures unconditionally

  CREATE TABLE liability_waivers (
    id           TEXT PRIMARY KEY,
    dispute_id   TEXT NOT NULL REFERENCES disputes(id),
    waiver_text  TEXT NOT NULL,
    waiver_type  VARCHAR(50) CHECK (waiver_type IN (
                   'full_release','partial_release',
                   'nda_extension','ip_assignment',
                   'financial_final_settlement')),
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE waiver_signatures (
    id              TEXT PRIMARY KEY,
    waiver_id       TEXT NOT NULL REFERENCES liability_waivers(id),
    signed_by       TEXT NOT NULL REFERENCES users(id),
    signed_at       TIMESTAMP NULL,
    signature_token TEXT NULL,
    status          VARCHAR(20) DEFAULT 'pending'
                    CHECK (status IN ('pending','signed','declined','expired'))
  );
  -- APPEND-ONLY TRIGGER: prevent_waiver_signature_delete
  -- Blocks DELETE on waiver_signatures unconditionally

  Dispute number format: DSP-0001, DSP-0002 (sequential)
  signature_token: crypto.randomBytes(32).toString('hex') per party per doc

4B. Dispute Lifecycle (status flow — enforce server-side):
  open
  → under_review  (Admin starts investigating)
  → negotiation   (Admin drafting terms)
  → pending_signatures  (agreement/waiver sent to parties)
  → settled       (all parties signed + financial action if needed)
  → closed        (formally closed, audit trail locked)

  Any status → escalated_legal (Admin escalates outside system)

4C. Dispute API Endpoints

  POST /api/superadmin/disputes
    WHO: Admin only
    Creates dispute with status='open', auto-assigns dispute_number

  GET /api/superadmin/disputes
    WHO: Admin only
    All disputes with filters: ?status=&dispute_type=&date_from=

  GET /api/superadmin/disputes/:id
    WHO: Admin only — full dispute detail + parties + agreements + sigs

  PATCH /api/superadmin/disputes/:id/status
    WHO: Admin only — enforce valid lifecycle transitions

  POST /api/superadmin/disputes/:id/parties
    WHO: Admin only — add party (user_id or external name)

  POST /api/superadmin/disputes/:id/agreement
    WHO: Admin only
    Creates dispute_agreements row (rich text content)
    Generates unique signature_token for each party in dispute_parties
    Creates pending dispute_signatures rows for each required party
    Sends notification to each party: "Agreement ready for your review"
    Transitions dispute to status='pending_signatures'

  POST /api/superadmin/disputes/:id/waiver
    WHO: Admin only
    Creates liability_waivers row
    Creates waiver_signatures rows (pending) for required parties
    Sends notification to each party: "Waiver ready for your review"

  GET /api/superadmin/disputes/:id/sign/:token
    WHO: The party whose token this is (verified by token match in DB)
    Returns agreement/waiver text for review
    If token not found or already used → HTTP 404/400

  POST /api/superadmin/disputes/:id/sign
    WHO: The party whose token this is
    Body: { token, agreed: true/false }
    If agreed=true:
      Updates dispute_signatures: signed_at=NOW(), ip_address=req.ip,
      agreed=true
    If agreed=false:
      Records disagreement, notifies Admin
      Dispute moves back to 'negotiation' status
    If ALL required parties signed:
      Dispute auto-transitions to 'settled'
      Admin notified: "All parties have signed"
    All writes append-only — no UPDATE allowed after signing

  GET /api/superadmin/disputes/:id/signatures
    WHO: Admin only
    Returns signing status per party: signed/pending/declined

  POST /api/superadmin/disputes/:id/settle
    WHO: Admin only
    Handles financial settlement execution (if needed):
      body.action = 'wallet_credit' → creates revenue_events entry
      body.action = 'wallet_debit'  → creates deduction entry
      body.action = 'external'      → records external payment note
    Requires Admin confirmation (frontend confirm dialog required)
    Updates settlement_amount on dispute record
    All actions logged in access_log

4D. Frontend — Section 5 (Dispute Resolution Center)
  - Disputes list table: DSP#, Type, Raised By, Against,
                          Status, Days Open, Settlement Amount
  - Click dispute → full detail view:
      Parties panel (list all parties with their signing status)
      Agreement editor (rich textarea for Admin to draft text)
      "Send for Signatures" button
      Waiver section (type selector + text + "Send Waiver" button)
      Signing dashboard: per-party status (signed/pending/declined)
        with timestamp and IP when signed
      Settlement execution panel (shows only after all signed):
        Amount field + action type dropdown + Confirm button
  - Member signing page (accessible via notification link):
      Shows agreement/waiver text
      "I Agree" (green) and "I Decline" (red) buttons
      Confirmation dialog before submit

4E. Step 4 Tests (add to run-step14-superadmin-tests.js)
  TEST 18: Admin opens dispute DSP-0001 →
           DB row created with correct dispute_number format
  TEST 19: Admin adds party, drafts agreement →
           dispute_signatures rows created for each party (pending)
           + notifications sent to parties
  TEST 20: Party signs with valid token →
           dispute_signatures.signed_at populated + agreed=1
  TEST 21: After all parties sign → dispute status = 'settled'
  TEST 22: Attempt to DELETE from dispute_signatures →
           SQLite trigger RAISE(FAIL) — append-only enforced
  TEST 23: Attempt to DELETE from waiver_signatures →
           SQLite trigger RAISE(FAIL) — append-only enforced
  TEST 24: Party uses invalid/already-used token →
           HTTP 404 returned
  TEST 25: Financial settlement POST /settle with wallet_credit →
           revenue_events row created + access_log entry

NON-NEGOTIABLES FOR STEP 4:
  dispute_signatures and waiver_signatures are APPEND-ONLY
  Signature tokens are cryptographically random (32 bytes)
  IP address logged on every signature
  Financial settlement always requires explicit Admin confirmation
  AI must NEVER auto-execute settlement — human confirm mandatory


════════════════════════════════════════════════════════
STEP 5 OF 6 — PAYMENT GATEWAY CONTROL &
              FULL DATA GOVERNANCE
Folder: src/routes/superadmin.js (extend)
        src/services/gatewayService.js (NEW)
        src/services/governanceService.js (NEW)
        src/db/schema.sql (new tables)
        public/js/superadmin.js (Section 6 + 7 controllers)
════════════════════════════════════════════════════════

WHAT TO BUILD IN STEP 5:
─────────────────────────

5A. Database — New Tables

  CREATE TABLE payment_gateway_config (
    id                  TEXT PRIMARY KEY,
    gateway_name        VARCHAR(50) NOT NULL DEFAULT 'SIMULATED_GATEWAY_STUB',
    is_live_mode        BOOLEAN DEFAULT 0,
    api_key_ref         TEXT NULL,
    webhook_secret_ref  TEXT NULL,
    payout_currency     VARCHAR(10) DEFAULT 'INR',
    min_payout_amount   DECIMAL(10,2) DEFAULT 100.00,
    max_payout_amount   DECIMAL(12,2) DEFAULT 500000.00,
    payout_cooldown_days INTEGER DEFAULT 7,
    auto_approve_below  DECIMAL(10,2) DEFAULT 0,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by          TEXT REFERENCES users(id)
  );
  -- Seed one row on migrate with all defaults
  -- auto_approve_below DEFAULT IS ALWAYS 0 — NON-NEGOTIABLE
  -- Automatic payouts without Admin approval are FOREVER FORBIDDEN

  CREATE TABLE user_data_governance (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    action_type  VARCHAR(100) NOT NULL,
    applied      BOOLEAN DEFAULT 1,
    applied_by   TEXT NOT NULL REFERENCES users(id),
    applied_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reverted     BOOLEAN DEFAULT 0,
    reverted_by  TEXT NULL REFERENCES users(id),
    reverted_at  TIMESTAMP NULL,
    notes        TEXT NULL
  );
  -- APPEND-ONLY TRIGGER: prevent_governance_delete
  -- Blocks DELETE unconditionally
  -- APPEND-ONLY TRIGGER: prevent_governance_update
  -- Blocks UPDATE on applied_at, user_id, action_type, applied_by
  -- (New row must be inserted for each revert — never update old row)

  Valid action_type values (enforce as CHECK or in service layer):
    'hide_ideas'
    'anonymize_ideas'
    'remove_project_assignments'
    'freeze_revenue'
    'archive_canvas_contributions'
    'block_meeting_notes_access'
    'super_block_applied'
    'wallet_frozen'
    'super_block_reversed'

5B. Payment Gateway Control API

  GET /api/superadmin/gateway/config
    WHO: Admin only
    Returns current payment_gateway_config row
    NEVER returns raw API key values — only api_key_ref (env var name)

  PATCH /api/superadmin/gateway/config
    WHO: Admin only
    Can update: gateway_name, is_live_mode, payout_currency,
                min_payout_amount, max_payout_amount,
                payout_cooldown_days
    CANNOT update: auto_approve_below to anything > 0
      (validation: if body.auto_approve_below > 0 → HTTP 400
       message: 'Auto-approval is permanently disabled by policy')
    Logs every config change in access_log with before/after values

  GET /api/superadmin/gateway/payouts/pending
    WHO: Admin only
    Returns all withdrawals WHERE status='pending' with:
      user name, role, requested amount, wallet balance,
      date requested, payout_cooldown_eligible (boolean),
      revenue ledger summary for that user

  POST /api/superadmin/gateway/payouts/:id/approve
    WHO: Admin only
    Requires confirmation (frontend must show confirm dialog)
    Updates withdrawal status → 'approved' then 'paid'
    Uses same race-condition-safe pattern from Step 06
    Logs in access_log with action='payout_approved'

  POST /api/superadmin/gateway/payouts/:id/reject
    WHO: Admin only
    Body must include: { reason: string } (mandatory, min 10 chars)
    Updates withdrawal status → 'rejected'
    Member notified with rejection reason
    Logs in access_log with action='payout_rejected'

  GET /api/superadmin/gateway/ledger
    WHO: Admin only
    Full revenue_events + revenue_splits read-only view
    Supports filters: ?user_id=&project_id=&date_from=&date_to=
    Returns append-only records (no ability to edit)

  GET /api/superadmin/gateway/ledger/export
    WHO: Admin only
    Returns full ledger as CSV
    Logs export in access_log

5C. Full Data Governance API

  GET /api/superadmin/governance/:userId
    WHO: Admin only
    Returns current governance state for user:
      List of all user_data_governance rows for this user
      Summary: which actions are currently applied (applied=1, reverted=0)

  POST /api/superadmin/governance/:userId/block
    WHO: Admin only
    Body: { actions: ['hide_ideas', 'freeze_revenue', ...], notes: string }
    Executes in this ORDER (all atomic, rollback if any fail):
      1. disconnectUserSockets(userId) — WS close 4001
      2. Invalidate all active sessions for userId
      3. Update users.status (Admin chooses 'suspended' or 'inactive')
      4. users.wallet_frozen = 1
      5. If user in active meeting: record left_at in meeting_attendance
      6. Cancel all pending withdrawal requests for userId
      7. For each action in body.actions:
           Execute the specific governance action (hide ideas, etc.)
           Insert row in user_data_governance (action_type, applied=1)
      8. Log 'super_block_applied' in access_log
    Returns: summary of all actions taken

    Admin CANNOT block themselves (req.user.id === userId → HTTP 400)

  POST /api/superadmin/governance/:userId/unblock
    WHO: Admin only
    Body: { actions: ['hide_ideas', 'freeze_revenue', ...] }
    For each action listed:
      Reverse the specific governance action
      Insert NEW row in user_data_governance with reverted=1
      (never UPDATE the original applied row — append-only)
    Can also restore account status if Admin chooses
    Logs 'super_block_reversed' in access_log

  GET /api/superadmin/governance/:userId/export
    WHO: Admin only
    Generates a data export ZIP for the user containing:
      profile_info.json (all users fields)
      ideas.json (all ideas submitted)
      tasks.json (all tasks assigned/completed)
      earnings.csv (full revenue_splits)
      attendance.csv (full meeting_attendance)
      audit_log.json (all access_log entries for this user)
    Returns ZIP file (Content-Type: application/zip)
    Logs 'data_export_generated' in access_log

  GET /api/superadmin/governance/:userId/history
    WHO: Admin only
    Returns all user_data_governance rows for this user
    (full audit trail of every governance action and revert)

5D. Frontend — Section 6 (Payment Gateway Control)
  - Config panel: editable fields for gateway settings
    auto_approve_below is DISPLAY-ONLY greyed out at 0
    (with tooltip: "Auto-approval permanently disabled by policy")
  - Pending payouts table: member name, amount, days waiting,
    wallet balance, Approve/Reject buttons
  - Approve: confirm dialog → execute
  - Reject: modal with mandatory reason text field
  - Ledger view: read-only table with filters + export button

5E. Frontend — Section 7 (Full Data Governance)
  - Search member → see current governance state
  - "Initiate Block" button → opens checklist modal:
      ☐ Disconnect active sessions immediately
      ☐ Hide all idea submissions from team feed
      ☐ Anonymize name on submitted ideas
      ☐ Remove from all active project assignments
      ☐ Freeze all earned but unpaid revenue
      ☐ Archive co-working canvas contributions
      ☐ Block access to meeting notes
    Admin ticks desired boxes → confirmation dialog → execute
  - After block: shows current governance state per category
  - "Reverse" button per category → unblock that specific action
  - "Export User Data" button → triggers ZIP download

5F. Step 5 Tests (add to run-step14-superadmin-tests.js)
  TEST 26: Gateway config PATCH with auto_approve_below > 0
           returns HTTP 400 (auto-approval forbidden)
  TEST 27: Payout approve → status becomes 'paid',
           access_log entry created with action='payout_approved'
  TEST 28: Payout reject without reason field →
           HTTP 400 validation error
  TEST 29: Super block → WS disconnected (4001) +
           user_data_governance rows created for each action +
           access_log entry 'super_block_applied'
  TEST 30: Attempt DELETE on user_data_governance →
           SQLite trigger RAISE(FAIL) — append-only enforced
  TEST 31: Unblock one specific action →
           NEW row inserted with reverted=1 (old row untouched)
  TEST 32: Data export → ZIP file returned (Content-Type verified)
           + access_log entry 'data_export_generated'
  TEST 33: Admin cannot block themselves (HTTP 400)

NON-NEGOTIABLES FOR STEP 5:
  auto_approve_below can NEVER be set > 0 — hard block in backend
  user_data_governance is APPEND-ONLY — no exceptions
  Super block must disconnect WebSocket in real-time (4001)
  Data export must be logged every single time


════════════════════════════════════════════════════════
STEP 6 OF 6 — UNIFIED AUDIT STREAM,
              FULL QA & REGRESSION
Folder: src/routes/superadmin.js (extend)
        public/js/superadmin.js (Section 8 controller)
        scripts/run-step14-superadmin-tests.js (complete)
════════════════════════════════════════════════════════

WHAT TO BUILD IN STEP 6:
─────────────────────────

6A. Unified Audit Stream API

  GET /api/superadmin/audit-stream
    WHO: Admin only
    Single consolidated query across:
      - access_log (Steps 01-13 existing + Step 14 new entries)
      - user_data_governance (governance actions + reverts)
      - dispute actions (created, signed, settled, escalated)
      - ticket status transitions (open, resolved, closed)
      - payment actions (payout approved/rejected, config changed)
    Returns unified timeline sorted by timestamp DESC
    Each entry has:
      timestamp, actor_id, actor_name, actor_role,
      action_type, target_id, target_name,
      module (step01 through step14),
      severity ('info' | 'warning' | 'critical'),
      details (JSON with before/after values where applicable)

    Critical severity actions (shown in red):
      super_block_applied, payout_approved, payout_rejected,
      dispute_settled, waiver_signed, gateway_config_changed,
      offboarding_killswitch, data_export_generated

    Supports filters:
      ?actor_id=&action_type=&module=&severity=
      &date_from=&date_to=&page=&limit=
    Default: limit=50, page=1

  GET /api/superadmin/audit-stream/export
    WHO: Admin only
    Returns full filtered audit stream as CSV
    Logs this export itself in access_log

6B. Frontend — Section 8 (Unified Audit Stream)
  - Timeline table: Timestamp, Actor, Action, Target,
                    Module badge, Severity badge
  - Critical rows: red background highlight
  - Warning rows: amber background highlight
  - Filter panel: dropdowns for module, severity, actor search,
                  date range picker
  - Pagination (50 per page, load more button)
  - Export CSV button

6C. Final Integration Checks Before Test Suite

  Before writing tests, verify these integrations are working:

  CHECK 1: superadmin.html sidebar links all activate correct sections
  CHECK 2: All /api/superadmin/* routes return HTTP 403 for non-admin
           for every single endpoint (not just a sample)
  CHECK 3: Every admin action in Steps 1-6 creates an access_log entry
           (verify by checking access_log after each test action)
  CHECK 4: Member-side features (ticket submit, dispute sign) work
           from a non-admin authenticated session correctly
  CHECK 5: All new SQLite triggers exist in sqlite_master:
           prevent_dispute_signature_delete
           prevent_waiver_signature_delete
           prevent_governance_delete
           prevent_governance_update
  CHECK 6: All 5 new tables exist:
           support_tickets, ticket_messages, disputes,
           dispute_parties, dispute_agreements,
           dispute_signatures, liability_waivers,
           waiver_signatures, payment_gateway_config,
           user_data_governance

6D. Complete Test Suite (scripts/run-step14-superadmin-tests.js)

  Run all 33 tests from Steps 1-5 PLUS these final tests:

  TEST 34: Audit stream GET returns entries from MULTIPLE modules
           in one unified response (verify module field has
           at least 3 distinct values after running prior tests)
  TEST 35: Audit stream filter by severity='critical' returns
           only critical entries
  TEST 36: Audit stream export → CSV Content-Type verified
           + export itself logged in access_log
  TEST 37: All 6 integration checks above pass (run as assertions)
  TEST 38: Verify ALL new SQLite triggers exist:
           SELECT name FROM sqlite_master WHERE type='trigger'
           AND name IN (list of 4 trigger names)
           → must return exactly 4 rows
  TEST 39: Full regression suite — ALL prior steps pass
           zero-breakage after Step 14:
             npm test (13/13)
             Step 01 Amendment (8/8)
             Step 08 Revision (5/5)
             Step 09 Profile (8/8)
             Step 10 Admin (16/16)
             Step 11 Coworking (15/15)
             Step 12 Meetings (16/16)
             Step 13 Final QA (82/82)
           Show real console output for all suites

6E. Section 7 Status Report (required on delivery)
  For every component built across all 6 steps:
    Status Tag / What was built / Evidence / Confidence level
  Use tags: [TESTED AND VERIFIED] / [IMPLEMENTED, UNTESTED] /
            [CONFIRMED WORKING — TESTED WITH REAL CALLS]

6F. Delivery Requirements
  1. Reverse-Engineering Report FIRST (before code):
     Competitors to analyze:
       Zendesk — ticket inbox workflow logic
       Jira Service Management — priority/SLA logic
       Intercom — threaded support messaging
       Lattice — stealth performance monitoring
       DocuSign/HelloSign — e-signature signing flow
       Rippling/BambooHR — HR data governance patterns
       Stripe Dashboard — payment config interface
     Per 00_2: borrowed / rejected / 100% original breakdown

  2. Honest Scope Report BEFORE implementation
     (Section 7 format, per 00_4)

  3. Implement all 6 steps completely

  4. Run scripts/run-step14-superadmin-tests.js
     All 39 tests must pass
     Show full real console output

  5. Run full regression suite — show console output

  6. Git commit with clean working tree
     Submit commit hash

  7. Section 7 Status Report on all components

GLOBAL NON-NEGOTIABLES FOR ALL 6 STEPS:
  Admin cannot self-block, self-dispute, or self-demote (HTTP 400)
  Auto-payout without Admin approval: FOREVER FORBIDDEN
  AI must NEVER auto-execute block/unblock/settle/payout
  All append-only tables protected by SQLite triggers
  is_internal=1 ticket messages: NEVER visible to members
  Performance data: NEVER accessible by members (stealth)
  Signature tokens: cryptographically random, 32 bytes minimum
  Every admin action in superadmin panel: logged in access_log
  Data export: logged every single time
  Full regression (Steps 01-13): zero-breakage after Step 14
  Apply 100% effort A-to-Z, read all files before writing code
  Submit honest status tags — no overclaiming

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
END OF 14_SUPER_ADMIN_PANEL.md
Version 1.0 — Ready for Antigravity Implementation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━