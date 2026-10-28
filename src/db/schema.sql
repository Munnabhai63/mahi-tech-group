-- ===================================================================
-- STEP 01: Core Tables and Production Indexes
-- ===================================================================

CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    name              VARCHAR(100) NOT NULL,
    email             VARCHAR(150) UNIQUE NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    phone_number      VARCHAR(30),
    role              VARCHAR(20) CHECK (role IN ('researcher','developer','producer','admin','designer')),
    sub_role          VARCHAR(20) CHECK (sub_role IN ('frontend','backend',NULL)),
    desired_role      VARCHAR(20) CHECK (desired_role IN ('researcher','developer','producer','designer')),
    desired_sub_role  VARCHAR(20) CHECK (desired_sub_role IN ('frontend','backend',NULL)),
    status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('active','inactive','suspended','pending','rejected')),
    rating_avg        DECIMAL(3,2) DEFAULT 0.0,
    idea_quota_used   INT DEFAULT 0,
    quota_reset_date  DATE,
    wallet_balance    DECIMAL(12,2) DEFAULT 0.0,
    wallet_frozen     BOOLEAN DEFAULT 0,
    profile_photo_url TEXT,
    avatar_url        TEXT,
    bio               TEXT,
    last_active_at    TIMESTAMP NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deactivated_at    TIMESTAMP NULL,
    approved_at       TIMESTAMP NULL,
    approved_by       TEXT REFERENCES users(id),
    rejected_at       TIMESTAMP NULL,
    rejected_by       TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           VARCHAR(500) NOT NULL,
    device_info     VARCHAR(255),
    ip_address      VARCHAR(45),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMP NOT NULL,
    is_revoked      BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roles_permissions (
    id              TEXT PRIMARY KEY,
    role            VARCHAR(20) NOT NULL,
    permission_key  VARCHAR(100) NOT NULL,
    allowed         BOOLEAN NOT NULL DEFAULT 0,
    UNIQUE(role, permission_key)
);

CREATE TABLE IF NOT EXISTS access_log (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id),
    target_id   TEXT,
    action      VARCHAR(100) NOT NULL,
    resource    VARCHAR(100),
    ip_address  VARCHAR(45),
    timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===================================================================
-- STEP 02: Idea + Quota Engine Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS ideas (
    id                  TEXT PRIMARY KEY,
    owner_id            TEXT NOT NULL REFERENCES users(id),
    title               VARCHAR(200) NOT NULL,
    description         TEXT NOT NULL,
    attachment_url      TEXT,
    status              VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                        ('DRAFT','PENDING_REVIEW','REVISE','APPROVED',
                         'REJECTED','ARCHIVED','killed','KILLED','archived')),
    submitted_at        TIMESTAMP,
    voting_deadline     TIMESTAMP,
    green_percentage    DECIMAL(5,2) DEFAULT 0.0,
    killed_reason       TEXT NULL,
    killed_at           TIMESTAMP NULL,
    killed_by           TEXT NULL REFERENCES users(id),
    pre_kill_status     TEXT NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idea_quota_log (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    idea_id         TEXT REFERENCES ideas(id),
    cycle_start     DATE NOT NULL,
    cycle_end       DATE NOT NULL,
    used_count      INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_config (
    key             VARCHAR(50) PRIMARY KEY,
    value           VARCHAR(100) NOT NULL,
    updated_by      TEXT REFERENCES users(id),
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===================================================================
-- STEP 03: Voting Gate Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS votes (
    id                  TEXT PRIMARY KEY,
    idea_id             TEXT NOT NULL REFERENCES ideas(id),
    voter_id            TEXT NOT NULL REFERENCES users(id),
    score_feasibility   INT CHECK (score_feasibility BETWEEN 0 AND 10),
    score_market        INT CHECK (score_market BETWEEN 0 AND 10),
    score_capacity      INT CHECK (score_capacity BETWEEN 0 AND 10),
    vote_color          VARCHAR(10) NOT NULL CHECK (vote_color IN ('green','red')),
    comment             TEXT,
    voted_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(idea_id, voter_id)
);

CREATE TABLE IF NOT EXISTS review_meetings (
    id                  TEXT PRIMARY KEY,
    idea_id             TEXT NOT NULL REFERENCES ideas(id),
    scheduled_at        TIMESTAMP NOT NULL,
    voting_window_end   TIMESTAMP NOT NULL,
    status              VARCHAR(20) DEFAULT 'SCHEDULED' CHECK (status IN
                        ('SCHEDULED','ONGOING','COMPLETED','EXTENDED')),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===================================================================
-- STEP 04: Parallel Fan-Out Engine Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS projects (
    id                  TEXT PRIMARY KEY,
    idea_id             TEXT NOT NULL REFERENCES ideas(id),
    org_id              TEXT NOT NULL DEFAULT 'DEFAULT_ORG',
    title               VARCHAR(200) NOT NULL,
    owner_id            TEXT NOT NULL REFERENCES users(id),
    revenue_clock_start TIMESTAMP,
    current_stage       VARCHAR(30) DEFAULT 'RESEARCH_DEV_PARALLEL' CHECK (current_stage IN
                        ('RESEARCH_DEV_PARALLEL','INTEGRATION','TESTING',
                         'ADMIN_REVIEW','LIVE','REJECTED_AT_REVIEW')),
    status              VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN
                        ('ACTIVE','PAUSED','LIVE','ARCHIVED')),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_members (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id                 TEXT NOT NULL REFERENCES users(id),
    role_in_project         VARCHAR(30) NOT NULL CHECK (role_in_project IN
                            ('researcher','frontend_dev','backend_dev',
                             'producer','admin_reviewer','designer')),
    task_status             VARCHAR(20) DEFAULT 'ASSIGNED' CHECK (task_status IN
                            ('ASSIGNED','IN_PROGRESS','BLOCKED_ON_DEPENDENCY',
                             'SUBMITTED','APPROVED')),
    contribution_weight     DECIMAL(5,2) DEFAULT 0.0,
    joined_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    removed_at              TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS project_tasks (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assigned_to         TEXT REFERENCES users(id),
    task_name           VARCHAR(150) NOT NULL,
    task_type           VARCHAR(30) CHECK (task_type IN
                        ('research','backend','frontend','testing','review','design')),
    depends_on_task_id  TEXT REFERENCES project_tasks(id) NULL,
    status              VARCHAR(20) DEFAULT 'TODO' CHECK (status IN
                        ('TODO','BLOCKED','IN_PROGRESS','DONE','cancelled','completed')),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at        TIMESTAMP NULL
);

-- ===================================================================
-- Production Indexes (Step 01, Step 02, Step 03, Step 04 + Step 13 Checklist)
-- ===================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_is_revoked ON sessions(is_revoked);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_permissions_role_key ON roles_permissions(role, permission_key);

CREATE INDEX IF NOT EXISTS idx_access_log_user_id ON access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_access_log_timestamp ON access_log(timestamp);

CREATE INDEX IF NOT EXISTS idx_ideas_owner_id ON ideas(owner_id);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at);

CREATE INDEX IF NOT EXISTS idx_idea_quota_log_user_id ON idea_quota_log(user_id);
CREATE INDEX IF NOT EXISTS idx_idea_quota_log_cycle ON idea_quota_log(user_id, cycle_start, cycle_end);

CREATE INDEX IF NOT EXISTS idx_votes_idea_id ON votes(idea_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter_id ON votes(voter_id);
CREATE INDEX IF NOT EXISTS idx_votes_color ON votes(vote_color);

CREATE INDEX IF NOT EXISTS idx_review_meetings_idea_id ON review_meetings(idea_id);
CREATE INDEX IF NOT EXISTS idx_review_meetings_status ON review_meetings(status);
CREATE INDEX IF NOT EXISTS idx_review_meetings_window_end ON review_meetings(voting_window_end);

CREATE INDEX IF NOT EXISTS idx_projects_idea_id ON projects(idea_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(current_stage);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);

CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned_to ON project_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_project_tasks_depends_on ON project_tasks(depends_on_task_id);

-- ===================================================================
-- STEP 05: Admin Offboarding Kill-Switch Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS offboarding (
    id                      TEXT PRIMARY KEY,
    user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    initiated_by            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason                  TEXT,
    initiated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at            TIMESTAMP,
    revoked_services_json   TEXT,
    wallet_frozen_amount    DECIMAL(12,2) DEFAULT 0.0,
    status                  VARCHAR(20) DEFAULT 'IN_PROGRESS' CHECK (status IN
                            ('IN_PROGRESS','COMPLETED','FAILED'))
);

CREATE TABLE IF NOT EXISTS assets (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    type                VARCHAR(30) CHECK (type IN
                        ('code_repo','pdf_doc','design_file','domain',
                         'app_listing','other')),
    url                 TEXT NOT NULL,
    owner_entity        VARCHAR(20) NOT NULL DEFAULT 'ORG' CHECK (owner_entity = 'ORG'),
    uploaded_by         TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_offboarding_user_id ON offboarding(user_id);
CREATE INDEX IF NOT EXISTS idx_offboarding_initiated_by ON offboarding(initiated_by);
CREATE INDEX IF NOT EXISTS idx_offboarding_status ON offboarding(status);

CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_uploaded_by ON assets(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);

-- ===================================================================
-- STEP 06: Revenue Split Engine Tables & Immutable Ledger
-- ===================================================================

CREATE TABLE IF NOT EXISTS revenue_events (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    amount          DECIMAL(12,2) NOT NULL CHECK (amount != 0),
    source          VARCHAR(100),
    entered_by      TEXT REFERENCES users(id) ON DELETE RESTRICT,
    event_date      DATE NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS revenue_splits (
    id                  TEXT PRIMARY KEY,
    revenue_event_id    TEXT NOT NULL REFERENCES revenue_events(id) ON DELETE RESTRICT,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount              DECIMAL(12,2) NOT NULL,
    rule_applied        VARCHAR(30) NOT NULL CHECK (rule_applied IN ('OWNER_50_TEAM_50','TEAM_100')),
    split_type          VARCHAR(30) DEFAULT 'TEAM_CONTRIBUTOR' CHECK (split_type IN ('OWNER_ROYALTY','TEAM_CONTRIBUTOR')),
    is_blocked          INTEGER NOT NULL DEFAULT 0,
    block_reason        TEXT,
    unblocked_by        TEXT REFERENCES users(id),
    unblocked_at        TIMESTAMP,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount              DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    status              VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','PAID')),
    requested_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_by         TEXT REFERENCES users(id) ON DELETE RESTRICT,
    approved_at         TIMESTAMP,
    paid_at             TIMESTAMP,
    gateway_txn_id      VARCHAR(150),
    rejection_reason    TEXT
);

CREATE TABLE IF NOT EXISTS pending_settlements (
    id                  TEXT PRIMARY KEY,
    revenue_split_id    TEXT NOT NULL REFERENCES revenue_splits(id) ON DELETE RESTRICT,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount              DECIMAL(12,2) NOT NULL,
    status              VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','SETTLED','FORFEITED')),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    settled_by          TEXT REFERENCES users(id) ON DELETE RESTRICT,
    settled_at          TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revenue_events_project_id ON revenue_events(project_id);
CREATE INDEX IF NOT EXISTS idx_revenue_events_event_date ON revenue_events(event_date);

CREATE INDEX IF NOT EXISTS idx_revenue_splits_event_id ON revenue_splits(revenue_event_id);
CREATE INDEX IF NOT EXISTS idx_revenue_splits_user_id ON revenue_splits(user_id);
CREATE INDEX IF NOT EXISTS idx_revenue_splits_rule ON revenue_splits(rule_applied);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_requested_at ON withdrawals(requested_at);

CREATE INDEX IF NOT EXISTS idx_pending_settlements_user_id ON pending_settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_settlements_status ON pending_settlements(status);

-- ===================================================================
-- Immutable Ledger Triggers: Prevent UPDATE and DELETE on historical records
-- ===================================================================

CREATE TRIGGER IF NOT EXISTS prevent_revenue_events_update
BEFORE UPDATE ON revenue_events
BEGIN
    SELECT RAISE(FAIL, 'Immutable ledger: UPDATE not allowed on revenue_events');
END;

CREATE TRIGGER IF NOT EXISTS prevent_revenue_events_delete
BEFORE DELETE ON revenue_events
BEGIN
    SELECT RAISE(FAIL, 'Immutable ledger: DELETE not allowed on revenue_events');
END;

CREATE TRIGGER IF NOT EXISTS prevent_revenue_splits_update
BEFORE UPDATE ON revenue_splits
WHEN (
    OLD.id != NEW.id OR
    OLD.revenue_event_id != NEW.revenue_event_id OR
    OLD.user_id != NEW.user_id OR
    OLD.amount != NEW.amount OR
    OLD.rule_applied != NEW.rule_applied OR
    OLD.split_type != NEW.split_type OR
    OLD.created_at != NEW.created_at
)
BEGIN
    SELECT RAISE(FAIL, 'Immutable ledger: UPDATE not allowed on revenue_splits');
END;

CREATE TRIGGER IF NOT EXISTS prevent_revenue_splits_delete
BEFORE DELETE ON revenue_splits
BEGIN
    SELECT RAISE(FAIL, 'Immutable ledger: DELETE not allowed on revenue_splits');
END;

CREATE TRIGGER IF NOT EXISTS prevent_withdrawals_delete
BEFORE DELETE ON withdrawals
BEGIN
    SELECT RAISE(FAIL, 'Immutable ledger: DELETE not allowed on withdrawals');
END;

-- ===================================================================
-- STEP 07: Notifications & Center Dashboard Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    event_type      VARCHAR(50) NOT NULL,
    message         TEXT NOT NULL,
    link            TEXT,
    read_status     INTEGER DEFAULT 0 CHECK (read_status IN (0, 1)),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- ===================================================================
-- STEP 10: Admin Control Panel & Immutability Enforcement
-- ===================================================================

CREATE TABLE IF NOT EXISTS wallet_settlements (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount          DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    status          VARCHAR(20) DEFAULT 'SETTLED' CHECK (status IN ('SETTLED','FORFEITED')),
    settled_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    settlement_type VARCHAR(50) DEFAULT 'MANUAL_DISBURSEMENT',
    notes           TEXT,
    settled_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallet_settlements_user_id ON wallet_settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_settlements_settled_at ON wallet_settlements(settled_at);

CREATE TRIGGER IF NOT EXISTS prevent_access_log_delete
BEFORE DELETE ON access_log
BEGIN
    SELECT RAISE(FAIL, 'Immutable log: DELETE not allowed on access_log');
END;

CREATE TRIGGER IF NOT EXISTS prevent_access_log_update
BEFORE UPDATE ON access_log
BEGIN
    SELECT RAISE(FAIL, 'Immutable log: UPDATE not allowed on access_log');
END;

-- ===================================================================
-- STEP 11: Co-working Canvas & Collaboration Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS coworking_rooms (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    room_type           VARCHAR(20) DEFAULT 'custom' CHECK (room_type IN ('embedded','custom')),
    status              VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','archived')),
    external_board_url  TEXT,
    canvas_state_json   TEXT DEFAULT '{"objects":{},"tombstones":{},"metadata":{"version":1,"archived":false}}',
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_participants (
    id              TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL REFERENCES coworking_rooms(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at         TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_coworking_rooms_project_id ON coworking_rooms(project_id);
CREATE INDEX IF NOT EXISTS idx_coworking_rooms_status ON coworking_rooms(status);
CREATE INDEX IF NOT EXISTS idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user_id ON room_participants(user_id);

-- ===================================================================
-- STEP 12: Meeting Integration & AI Governance Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS meetings (
    id                  TEXT PRIMARY KEY,
    title               VARCHAR(200) NOT NULL,
    meeting_type        VARCHAR(30) NOT NULL CHECK (meeting_type IN ('ad_hoc', 'idea_review')),
    linked_idea_id      TEXT REFERENCES ideas(id) ON DELETE SET NULL,
    linked_project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
    hosted_by           TEXT NOT NULL REFERENCES users(id),
    jitsi_room_name     VARCHAR(150) UNIQUE NOT NULL,
    jitsi_password      VARCHAR(100),
    recording_enabled   BOOLEAN DEFAULT 0,
    recording_file_path TEXT,
    scheduled_at        TIMESTAMP,
    started_at          TIMESTAMP,
    ended_at            TIMESTAMP,
    status              VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','ENDED','CANCELLED')),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meeting_attendance (
    id              TEXT PRIMARY KEY,
    meeting_id      TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id),
    joined_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at         TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meeting_notes (
    id              TEXT PRIMARY KEY,
    meeting_id      TEXT UNIQUE NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    transcript_raw  TEXT NOT NULL,
    notes_hindi     TEXT NOT NULL,
    notes_english   TEXT NOT NULL,
    ai_model_used   VARCHAR(100) NOT NULL,
    generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_by    TEXT REFERENCES users(id),
    confirmed_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_hosted_by ON meetings(hosted_by);
CREATE INDEX IF NOT EXISTS idx_meetings_linked_idea ON meetings(linked_idea_id);
CREATE INDEX IF NOT EXISTS idx_meetings_linked_project ON meetings(linked_project_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_meeting_id ON meeting_attendance(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_user_id ON meeting_attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting_id ON meeting_notes(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_confirmed_at ON meeting_notes(confirmed_at);

-- Trigger 1: Unconditionally prevent DELETE on meeting_attendance
CREATE TRIGGER IF NOT EXISTS prevent_meeting_attendance_delete
BEFORE DELETE ON meeting_attendance
BEGIN
    SELECT RAISE(FAIL, 'Immutable log: DELETE not allowed on meeting_attendance');
END;

-- Trigger 2: Enforce append-only attendance: block changes to meeting_id, user_id, joined_at; permit setting left_at once when OLD.left_at IS NULL
CREATE TRIGGER IF NOT EXISTS enforce_meeting_attendance_append_only
BEFORE UPDATE ON meeting_attendance
BEGIN
    SELECT CASE
        WHEN NEW.meeting_id != OLD.meeting_id OR NEW.user_id != OLD.user_id OR NEW.joined_at != OLD.joined_at THEN
            RAISE(FAIL, 'Immutable: meeting_id/user_id/joined_at cannot be changed')
        WHEN OLD.left_at IS NOT NULL THEN
            RAISE(FAIL, 'Immutable log: Departure already recorded and locked')
        ELSE NULL
    END;
END;

-- ===================================================================
-- STEP 14 LAYER 3: Support Ticket System Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS support_tickets (
    id            TEXT PRIMARY KEY,
    ticket_number TEXT UNIQUE NOT NULL,
    reporter_id   TEXT NOT NULL REFERENCES users(id),
    assigned_to   TEXT REFERENCES users(id),
    category      TEXT NOT NULL CHECK (category IN ('bug','feature_request','access_issue','billing','other')),
    priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
    subject       TEXT NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    created_at    TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (reporter_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id          TEXT PRIMARY KEY,
    ticket_id   TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_id   TEXT NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    is_internal INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_reporter_id ON support_tickets(reporter_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number ON support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);

-- ===================================================================
-- STEP 14 LAYER 4: Dispute Resolution & Liability Waiver Systems
-- ===================================================================

-- STATUS FSM (Layer 4 extended): open → under_review → negotiation
--   → pending_signatures → settled/resolved → closed
-- Forward-only enforced in disputeService.js updateDisputeStatus()
CREATE TABLE IF NOT EXISTS disputes (
    id                  TEXT PRIMARY KEY,
    dispute_number      VARCHAR(20) UNIQUE NOT NULL,
    dispute_type        VARCHAR(50) NOT NULL CHECK (dispute_type IN (
                          'financial_settlement','ip_ownership',
                          'contribution_disagreement',
                          'offboarding_settlement',
                          'formal_complaint','legal_matter','other')),
    raised_by           TEXT NOT NULL REFERENCES users(id),
    against_party       TEXT NULL REFERENCES users(id),
    against_party_ext   TEXT NULL,
    linked_ticket_id    TEXT NULL REFERENCES support_tickets(id),
    linked_project_id   TEXT NULL REFERENCES projects(id),
    description         TEXT NOT NULL,
    status              VARCHAR(30) NOT NULL DEFAULT 'open'
                        CHECK (status IN (
                          'open','under_review','negotiation',
                          'pending_signatures','settled',
                          'resolved','closed','escalated_legal')),
    resolution_notes    TEXT NULL,
    settlement_amount   DECIMAL(12,2) NULL,
    settlement_currency VARCHAR(10) DEFAULT 'INR',
    created_at          TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    updated_at          TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    closed_at           TIMESTAMP NULL,
    closed_by           TEXT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS dispute_parties (
    id          TEXT PRIMARY KEY,
    dispute_id  TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    user_id     TEXT NULL REFERENCES users(id),
    party_name  TEXT NOT NULL,
    party_type  VARCHAR(30) CHECK (party_type IN (
                  'complainant','respondent','witness','admin')),
    added_at    TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispute_agreements (
    id             TEXT PRIMARY KEY,
    dispute_id     TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    agreement_text TEXT NOT NULL,
    created_by     TEXT NOT NULL REFERENCES users(id),
    created_at     TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    version        INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dispute_signatures (
    id              TEXT PRIMARY KEY,
    agreement_id    TEXT NOT NULL REFERENCES dispute_agreements(id) ON DELETE CASCADE,
    signed_by       TEXT NOT NULL REFERENCES users(id),
    signed_at       TIMESTAMP NULL,
    signature_token TEXT NOT NULL,
    ip_address      TEXT NULL,
    agreed          BOOLEAN NULL,
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','signed','declined','expired')),
    expires_at      TIMESTAMP NULL
);

CREATE TRIGGER IF NOT EXISTS prevent_dispute_signature_delete
BEFORE DELETE ON dispute_signatures
BEGIN
    SELECT RAISE(FAIL, 'dispute_signatures are append-only: DELETE forbidden');
END;

CREATE TRIGGER IF NOT EXISTS prevent_dispute_signature_update
BEFORE UPDATE ON dispute_signatures
WHEN OLD.signed_at IS NOT NULL
BEGIN
    SELECT RAISE(FAIL, 'dispute_signatures are append-only: signed records cannot be updated');
END;

CREATE TABLE IF NOT EXISTS liability_waivers (
    id           TEXT PRIMARY KEY,
    dispute_id   TEXT NULL REFERENCES disputes(id),
    project_id   TEXT NULL REFERENCES projects(id),
    waiver_text  TEXT NOT NULL,
    waiver_type  VARCHAR(50) CHECK (waiver_type IN (
                   'full_release','partial_release',
                   'nda_extension','ip_assignment',
                   'financial_final_settlement')),
    scope        VARCHAR(30) DEFAULT 'global' CHECK (scope IN ('global','project','individual')),
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS waiver_signatures (
    id              TEXT PRIMARY KEY,
    waiver_id       TEXT NOT NULL REFERENCES liability_waivers(id) ON DELETE CASCADE,
    signed_by       TEXT NOT NULL REFERENCES users(id),
    signed_at       TIMESTAMP NULL,
    signature_token TEXT NOT NULL,
    ip_address      TEXT NULL,
    agreed          BOOLEAN NULL,
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','signed','declined','expired')),
    expires_at      TIMESTAMP NULL
);

CREATE TRIGGER IF NOT EXISTS prevent_waiver_signature_delete
BEFORE DELETE ON waiver_signatures
BEGIN
    SELECT RAISE(FAIL, 'waiver_signatures are append-only: DELETE forbidden');
END;

CREATE TRIGGER IF NOT EXISTS prevent_waiver_signature_update
BEFORE UPDATE ON waiver_signatures
WHEN OLD.status = 'signed'
BEGIN
    SELECT RAISE(FAIL, 'waiver_signatures are append-only: signed records cannot be updated');
END;

CREATE INDEX IF NOT EXISTS idx_disputes_number ON disputes(dispute_number);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON disputes(raised_by);
CREATE INDEX IF NOT EXISTS idx_dispute_parties_dispute_id ON dispute_parties(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_agreements_dispute_id ON dispute_agreements(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_signatures_token ON dispute_signatures(signature_token);
CREATE INDEX IF NOT EXISTS idx_liability_waivers_dispute_id ON liability_waivers(dispute_id);
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_token ON waiver_signatures(signature_token);

-- ===================================================================
-- STEP 14 LAYER 5: Payment Gateway Config & User Data Governance
-- ===================================================================

CREATE TABLE IF NOT EXISTS payment_gateway_config (
    id                          TEXT PRIMARY KEY,
    mode                        TEXT NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox','live')),
    gateway_name                TEXT NOT NULL DEFAULT 'SIMULATED_GATEWAY_STUB',
    api_key_encrypted           TEXT NULL,
    webhook_secret_encrypted    TEXT NULL,
    auto_approve_below          INTEGER NOT NULL DEFAULT 0,
    created_at                  TIMESTAMP NOT NULL DEFAULT (datetime('now')),
    updated_at                  TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_data_governance (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id),
    action        TEXT NOT NULL CHECK (action IN (
                    'consent_given','consent_revoked',
                    'data_export_requested','data_export_delivered',
                    'data_deletion_requested','data_deletion_reviewed',
                    'right_to_restrict','restriction_lifted')),
    requested_by  TEXT NOT NULL REFERENCES users(id),
    notes         TEXT NULL,
    reverted      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS prevent_governance_delete
BEFORE DELETE ON user_data_governance
BEGIN
    SELECT RAISE(ABORT, 'user_data_governance is append-only. Deletion is permanently forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS prevent_governance_update
BEFORE UPDATE ON user_data_governance
BEGIN
    SELECT RAISE(ABORT, 'user_data_governance is append-only. Updates are permanently forbidden.');
END;

CREATE INDEX IF NOT EXISTS idx_governance_user_id ON user_data_governance(user_id);
CREATE INDEX IF NOT EXISTS idx_governance_created_at ON user_data_governance(created_at);

-- ===================================================================
-- STEP 15: 4-Role Project Pipeline Workflow Tables & Triggers
-- ===================================================================

CREATE TABLE IF NOT EXISTS pipeline_deliverables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  current_stage VARCHAR(20) NOT NULL DEFAULT 'RESEARCH',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pipeline_checklist_points (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  stage VARCHAR(20) NOT NULL,
  point_title VARCHAR(300) NOT NULL,
  point_description TEXT,
  weight INTEGER NOT NULL DEFAULT 5 CHECK(weight >= 1 AND weight <= 10),
  status VARCHAR(20) NOT NULL DEFAULT 'UNCLAIMED',
  assigned_to TEXT,
  claim_locked_by TEXT REFERENCES users(id),
  claim_locked_at TIMESTAMP,
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by TEXT,
  tool_link TEXT,
  asset_url TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (claim_locked_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pipeline_stage_handoffs (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  from_stage VARCHAR(20) NOT NULL,
  to_stage VARCHAR(20) NOT NULL,
  stage_completion_pct DECIMAL(5,2) NOT NULL,
  handoff_notes TEXT,
  approved_by TEXT NOT NULL,
  snapshot_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TRIGGER IF NOT EXISTS prevent_handoff_update
BEFORE UPDATE ON pipeline_stage_handoffs
BEGIN
  SELECT RAISE(ABORT, 'pipeline_stage_handoffs is append-only. Updates forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS prevent_handoff_delete
BEFORE DELETE ON pipeline_stage_handoffs
BEGIN
  SELECT RAISE(ABORT, 'pipeline_stage_handoffs is append-only. Deletes forbidden.');
END;

CREATE TABLE IF NOT EXISTS pipeline_addendum_requests (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  requesting_stage VARCHAR(20) NOT NULL,
  target_stage VARCHAR(20) NOT NULL,
  point_title VARCHAR(300) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  raised_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMP,
  type VARCHAR(20) NOT NULL DEFAULT 'ADDENDUM',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (raised_by) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_deliverables_project_id ON pipeline_deliverables(project_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_deliverables_stage ON pipeline_deliverables(current_stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_deliverables_status ON pipeline_deliverables(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_checklist_points_deliv ON pipeline_checklist_points(deliverable_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_checklist_points_stage ON pipeline_checklist_points(stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_checklist_points_status ON pipeline_checklist_points(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_checklist_points_assigned ON pipeline_checklist_points(assigned_to);
CREATE INDEX IF NOT EXISTS idx_pipeline_handoffs_deliv ON pipeline_stage_handoffs(deliverable_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_addendum_deliv ON pipeline_addendum_requests(deliverable_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_addendum_status ON pipeline_addendum_requests(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_addendum_type ON pipeline_addendum_requests(type);

-- Performance Optimization Composite Indexes
CREATE INDEX IF NOT EXISTS idx_ideas_status_owner
  ON ideas(status, owner_id);

CREATE INDEX IF NOT EXISTS idx_projects_status_owner
  ON projects(status, owner_id);

CREATE INDEX IF NOT EXISTS idx_project_tasks_composite
  ON project_tasks(project_id, assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read_status);

CREATE INDEX IF NOT EXISTS idx_access_log_user_action
  ON access_log(user_id, action);

CREATE INDEX IF NOT EXISTS idx_pipeline_points_composite
  ON pipeline_checklist_points(deliverable_id, stage, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_deliverables_proj
  ON pipeline_deliverables(project_id, status);

-- ===================================================================
-- STEP 16: Dynamic Point-Pool, Multi-Member & Participation % Tables
-- ===================================================================

CREATE TABLE IF NOT EXISTS point_pool_claims (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  deliverable_id TEXT NOT NULL,
  stage VARCHAR(20) NOT NULL,
  claimed_by TEXT NOT NULL,
  claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP,
  release_reason VARCHAR(50),
  released_by TEXT,
  FOREIGN KEY (point_id) REFERENCES pipeline_checklist_points(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (claimed_by) REFERENCES users(id)
);

CREATE TRIGGER IF NOT EXISTS prevent_claim_delete
BEFORE DELETE ON point_pool_claims
BEGIN
  SELECT RAISE(ABORT, 'point_pool_claims is append-only. Deletes forbidden.');
END;

CREATE TABLE IF NOT EXISTS participation_thresholds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  threshold_pct DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  abandonment_days INTEGER NOT NULL DEFAULT 7,
  set_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (set_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS point_tool_links (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  tool_url TEXT NOT NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (point_id) REFERENCES pipeline_checklist_points(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (added_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_point_pool_claims_point_id ON point_pool_claims(point_id);
CREATE INDEX IF NOT EXISTS idx_point_pool_claims_project_id ON point_pool_claims(project_id);
CREATE INDEX IF NOT EXISTS idx_point_pool_claims_claimed_by ON point_pool_claims(claimed_by);
CREATE INDEX IF NOT EXISTS idx_point_pool_claims_stage ON point_pool_claims(stage);

CREATE INDEX IF NOT EXISTS idx_participation_thresholds_project_id ON participation_thresholds(project_id);

CREATE INDEX IF NOT EXISTS idx_point_tool_links_point_id ON point_tool_links(point_id);
CREATE INDEX IF NOT EXISTS idx_point_tool_links_project_id ON point_tool_links(project_id);

-- ===================================================================
-- PRD 17: GitHub Automation Architecture (Batch 1)
-- ===================================================================

CREATE TABLE IF NOT EXISTS user_github_links (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL UNIQUE,
  github_username TEXT NOT NULL,
  github_node_id  TEXT NOT NULL,
  linked_at       TEXT NOT NULL DEFAULT (datetime('now')),
  linked_by       TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_github_links_user_id
  ON user_github_links(user_id);

CREATE TABLE IF NOT EXISTS project_github_repos (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id      TEXT NOT NULL UNIQUE,
  github_repo_id  INTEGER,
  repo_name       TEXT NOT NULL,
  repo_full_name  TEXT NOT NULL,
  repo_url        TEXT NOT NULL,
  default_branch  TEXT NOT NULL DEFAULT 'main',
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK(status IN ('PENDING','ACTIVE','ARCHIVED','FAILED')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_project_github_repos_project_id
  ON project_github_repos(project_id);
CREATE INDEX IF NOT EXISTS idx_project_github_repos_status
  ON project_github_repos(status);

CREATE TABLE IF NOT EXISTS project_github_memberships (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id      TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  github_username TEXT NOT NULL,
  role            TEXT NOT NULL
                    CHECK(role IN ('researcher','designer',
                                   'developer','tester','lead','admin')),
  team_slug       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK(status IN ('ACTIVE','REMOVED')),
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at      TEXT,
  removed_reason  TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id)    REFERENCES users(id),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_proj_gh_memberships_project_id
  ON project_github_memberships(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_gh_memberships_user_id
  ON project_github_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_proj_gh_memberships_status
  ON project_github_memberships(status, project_id);

CREATE TABLE IF NOT EXISTS github_webhook_log (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  delivery_id     TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  action          TEXT,
  repo_full_name  TEXT,
  sender_login    TEXT,
  payload         TEXT NOT NULL,
  signature_valid INTEGER NOT NULL DEFAULT 0
                    CHECK(signature_valid IN (0,1)),
  processed       INTEGER NOT NULL DEFAULT 0
                    CHECK(processed IN (0,1)),
  error_message   TEXT,
  received_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gh_webhook_log_event_type
  ON github_webhook_log(event_type);
CREATE INDEX IF NOT EXISTS idx_gh_webhook_log_received_at
  ON github_webhook_log(received_at);
CREATE INDEX IF NOT EXISTS idx_gh_webhook_log_processed
  ON github_webhook_log(processed);

CREATE TRIGGER IF NOT EXISTS prevent_webhook_log_update
BEFORE UPDATE ON github_webhook_log
WHEN OLD.delivery_id != NEW.delivery_id
  OR OLD.event_type != NEW.event_type
  OR OLD.payload != NEW.payload
  OR OLD.signature_valid != NEW.signature_valid
  OR OLD.received_at != NEW.received_at
BEGIN
  SELECT RAISE(ABORT, 'github_webhook_log is append-only: only processed and error_message fields are mutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_webhook_log_delete
BEFORE DELETE ON github_webhook_log
BEGIN
  SELECT RAISE(ABORT, 'github_webhook_log rows cannot be deleted');
END;

-- ============================================================
-- PRD 18: Sprint Planning, Backlog Management & Velocity Tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS sprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  start_date TEXT,
  end_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backlog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  sprint_id INTEGER REFERENCES sprints(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'STORY',
  priority TEXT DEFAULT 'MEDIUM',
  story_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'TODO',
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprint_velocity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprint_id INTEGER NOT NULL REFERENCES sprints(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  total_points_committed INTEGER DEFAULT 0,
  total_points_completed INTEGER DEFAULT 0,
  completion_rate REAL DEFAULT 0.0,
  logged_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backlog_item_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES backlog_items(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprint_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprint_id INTEGER NOT NULL REFERENCES sprints(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT DEFAULT (datetime('now')),
  UNIQUE(sprint_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sprints_project_id ON sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status);
CREATE INDEX IF NOT EXISTS idx_backlog_items_project_id ON backlog_items(project_id);
CREATE INDEX IF NOT EXISTS idx_backlog_items_sprint_id ON backlog_items(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sprint_velocity_sprint ON sprint_velocity_log(sprint_id);
CREATE INDEX IF NOT EXISTS idx_backlog_history_item ON backlog_item_history(item_id);
CREATE INDEX IF NOT EXISTS idx_sprint_members_sprint ON sprint_members(sprint_id);

CREATE TRIGGER IF NOT EXISTS prevent_velocity_log_update
BEFORE UPDATE ON sprint_velocity_log
BEGIN SELECT RAISE(ABORT, 'sprint_velocity_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_velocity_log_delete
BEFORE DELETE ON sprint_velocity_log
BEGIN SELECT RAISE(ABORT, 'sprint_velocity_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_item_history_update
BEFORE UPDATE ON backlog_item_history
BEGIN SELECT RAISE(ABORT, 'backlog_item_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_item_history_delete
BEFORE DELETE ON backlog_item_history
BEGIN SELECT RAISE(ABORT, 'backlog_item_history is append-only'); END;

-- ============================================================
-- PRD 19: OKR System (Objectives & Key Results)
-- ============================================================

CREATE TABLE IF NOT EXISTS okr_objectives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT NOT NULL DEFAULT 'TEAM',
  -- COMPANY | TEAM | INDIVIDUAL
  owner_id INTEGER NOT NULL REFERENCES users(id),
  parent_objective_id INTEGER REFERENCES okr_objectives(id),
  -- NULL = top-level objective, non-NULL = aligned to parent
  project_id INTEGER REFERENCES projects(id),
  -- NULL = company-level, non-NULL = project/team level
  cycle TEXT NOT NULL,
  -- e.g. 'Q1-2025', 'Q2-2025', 'H1-2025', 'FY-2025'
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  -- DRAFT | ACTIVE | COMPLETED | CANCELLED | ARCHIVED
  progress_pct REAL DEFAULT 0.0,
  -- auto-calculated from Key Results (0.00 to 100.00)
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS okr_key_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'PERCENTAGE',
  -- PERCENTAGE | NUMBER | BOOLEAN | MILESTONE
  target_value REAL NOT NULL DEFAULT 100,
  -- for PERCENTAGE: 100, for NUMBER: custom, for BOOLEAN: 1, for MILESTONE: milestone count
  current_value REAL NOT NULL DEFAULT 0,
  unit TEXT,
  -- e.g. '%', 'users', 'revenue', 'tasks'
  progress_pct REAL DEFAULT 0.0,
  -- auto-calculated: current_value ÷ target_value × 100, capped at 100
  status TEXT NOT NULL DEFAULT 'ON_TRACK',
  -- ON_TRACK | AT_RISK | OFF_TRACK | COMPLETED
  assigned_to INTEGER REFERENCES users(id),
  due_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS okr_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_result_id INTEGER NOT NULL REFERENCES okr_key_results(id),
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  previous_value REAL NOT NULL DEFAULT 0,
  new_value REAL NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'MEDIUM',
  -- HIGH | MEDIUM | LOW
  note TEXT,
  -- optional comment from member about this check-in
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS okr_alignment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  parent_objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  linked_by INTEGER NOT NULL REFERENCES users(id),
  linked_at TEXT DEFAULT (datetime('now')),
  UNIQUE(child_objective_id, parent_objective_id)
);

CREATE TABLE IF NOT EXISTS okr_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  -- 'OBJECTIVE' | 'KEY_RESULT'
  entity_id INTEGER NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_okr_objectives_level ON okr_objectives(level);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_cycle ON okr_objectives(cycle);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_project ON okr_objectives(project_id);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_owner ON okr_objectives(owner_id);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_parent ON okr_objectives(parent_objective_id);
CREATE INDEX IF NOT EXISTS idx_okr_key_results_obj ON okr_key_results(objective_id);
CREATE INDEX IF NOT EXISTS idx_okr_key_results_assigned ON okr_key_results(assigned_to);
CREATE INDEX IF NOT EXISTS idx_okr_checkins_kr ON okr_checkins(key_result_id);
CREATE INDEX IF NOT EXISTS idx_okr_alignment_child ON okr_alignment_links(child_objective_id);
CREATE INDEX IF NOT EXISTS idx_okr_alignment_parent ON okr_alignment_links(parent_objective_id);
CREATE INDEX IF NOT EXISTS idx_okr_history_entity ON okr_history(entity_type, entity_id);

CREATE TRIGGER IF NOT EXISTS prevent_okr_checkin_update
BEFORE UPDATE ON okr_checkins
BEGIN SELECT RAISE(ABORT, 'okr_checkins is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_checkin_delete
BEFORE DELETE ON okr_checkins
BEGIN SELECT RAISE(ABORT, 'okr_checkins is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_alignment_update
BEFORE UPDATE ON okr_alignment_links
BEGIN SELECT RAISE(ABORT, 'okr_alignment_links is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_alignment_delete
BEFORE DELETE ON okr_alignment_links
BEGIN SELECT RAISE(ABORT, 'okr_alignment_links is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_history_update
BEFORE UPDATE ON okr_history
BEGIN SELECT RAISE(ABORT, 'okr_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_history_delete
BEFORE DELETE ON okr_history
BEGIN SELECT RAISE(ABORT, 'okr_history is append-only'); END;

-- ===================================================================
-- PRD 20: Gantt Chart & Timeline View
-- ===================================================================

CREATE TABLE IF NOT EXISTS gantt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  sprint_id INTEGER REFERENCES sprints(id),
  backlog_item_id INTEGER REFERENCES backlog_items(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'TASK',
  assigned_to INTEGER REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  progress_pct REAL DEFAULT 0.0,
  color TEXT DEFAULT '#4A90E2',
  parent_item_id INTEGER REFERENCES gantt_items(id),
  position INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gantt_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  predecessor_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  successor_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  dependency_type TEXT NOT NULL DEFAULT 'FINISH_TO_START',
  lag_days INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(predecessor_item_id, successor_item_id)
);

CREATE TABLE IF NOT EXISTS gantt_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  gantt_item_id INTEGER REFERENCES gantt_items(id),
  title TEXT NOT NULL,
  milestone_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  achieved_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gantt_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  gantt_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  baseline_start_date TEXT NOT NULL,
  baseline_end_date TEXT NOT NULL,
  snapshot_taken_by INTEGER NOT NULL REFERENCES users(id),
  snapshot_taken_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gantt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gantt_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gantt_items_project ON gantt_items(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_items_sprint ON gantt_items(sprint_id);
CREATE INDEX IF NOT EXISTS idx_gantt_items_backlog ON gantt_items(backlog_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_items_assigned ON gantt_items(assigned_to);
CREATE INDEX IF NOT EXISTS idx_gantt_items_parent ON gantt_items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_dependencies_project ON gantt_dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_dependencies_pred ON gantt_dependencies(predecessor_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_dependencies_succ ON gantt_dependencies(successor_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_milestones_project ON gantt_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_milestones_item ON gantt_milestones(gantt_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_baselines_project ON gantt_baselines(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_baselines_item ON gantt_baselines(gantt_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_history_item ON gantt_history(gantt_item_id);

CREATE TRIGGER IF NOT EXISTS prevent_gantt_dependency_update
BEFORE UPDATE ON gantt_dependencies
BEGIN SELECT RAISE(ABORT, 'gantt_dependencies is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_dependency_delete
BEFORE DELETE ON gantt_dependencies
BEGIN SELECT RAISE(ABORT, 'gantt_dependencies is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_baseline_update
BEFORE UPDATE ON gantt_baselines
BEGIN SELECT RAISE(ABORT, 'gantt_baselines is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_baseline_delete
BEFORE DELETE ON gantt_baselines
BEGIN SELECT RAISE(ABORT, 'gantt_baselines is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_history_update
BEFORE UPDATE ON gantt_history
BEGIN SELECT RAISE(ABORT, 'gantt_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_history_delete
BEFORE DELETE ON gantt_history
BEGIN SELECT RAISE(ABORT, 'gantt_history is append-only'); END;

-- ===================================================================
-- PRD 21: Resource Workload Dashboard Tables & Triggers
-- ===================================================================

CREATE TABLE IF NOT EXISTS member_capacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  weekly_capacity_hrs REAL NOT NULL DEFAULT 40.0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  set_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  availability_type TEXT NOT NULL DEFAULT 'LEAVE',
  available_hrs REAL DEFAULT 0.0,
  reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS workload_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT NOT NULL DEFAULT 'BACKLOG_ITEM',
  source_id INTEGER,
  title TEXT NOT NULL,
  estimated_hrs REAL NOT NULL DEFAULT 0.0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workload_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  snapshot_date TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  taken_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workload_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  alert_type TEXT NOT NULL,
  week_start_date TEXT NOT NULL,
  assigned_hrs REAL NOT NULL,
  capacity_hrs REAL NOT NULL,
  utilization_pct REAL NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_member_capacity_user ON member_capacity(user_id);
CREATE INDEX IF NOT EXISTS idx_member_capacity_effective ON member_capacity(effective_from);
CREATE INDEX IF NOT EXISTS idx_member_availability_user ON member_availability(user_id);
CREATE INDEX IF NOT EXISTS idx_member_availability_date ON member_availability(date);
CREATE INDEX IF NOT EXISTS idx_workload_assignments_user ON workload_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_workload_assignments_project ON workload_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_workload_assignments_status ON workload_assignments(status);
CREATE INDEX IF NOT EXISTS idx_workload_assignments_dates ON workload_assignments(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_workload_snapshots_project ON workload_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_workload_alerts_user ON workload_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_workload_alerts_week ON workload_alerts(week_start_date);

CREATE TRIGGER IF NOT EXISTS prevent_capacity_update
BEFORE UPDATE ON member_capacity
BEGIN SELECT RAISE(ABORT, 'member_capacity is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_capacity_delete
BEFORE DELETE ON member_capacity
BEGIN SELECT RAISE(ABORT, 'member_capacity is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_workload_snapshot_update
BEFORE UPDATE ON workload_snapshots
BEGIN SELECT RAISE(ABORT, 'workload_snapshots is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_workload_snapshot_delete
BEFORE DELETE ON workload_snapshots
BEGIN SELECT RAISE(ABORT, 'workload_snapshots is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_workload_alert_delete
BEFORE DELETE ON workload_alerts
BEGIN SELECT RAISE(ABORT, 'workload_alerts is append-only'); END;

-- PRD 22: Time Tracking Tables & Triggers
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT DEFAULT 'MANUAL',
  source_ref_type TEXT,
  source_ref_id INTEGER,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_minutes INTEGER,
  is_billable INTEGER NOT NULL DEFAULT 0,
  billable_rate REAL DEFAULT 0.0,
  billable_amount REAL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_entry_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billable_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate_type TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id),
  rate_per_hour REAL NOT NULL DEFAULT 0.0,
  currency TEXT NOT NULL DEFAULT 'INR',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  set_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS active_timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  time_entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT DEFAULT (datetime('now')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  decision TEXT,
  decision_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_report_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  report_type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  taken_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_status ON time_entries(status);
CREATE INDEX IF NOT EXISTS idx_time_entries_start_time ON time_entries(start_time);
CREATE INDEX IF NOT EXISTS idx_time_entries_source_ref ON time_entries(source_ref_type, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_time_entry_history_entry ON time_entry_history(entry_id);
CREATE INDEX IF NOT EXISTS idx_billable_rates_user ON billable_rates(user_id);
CREATE INDEX IF NOT EXISTS idx_billable_rates_project ON billable_rates(project_id);
CREATE INDEX IF NOT EXISTS idx_billable_rates_effective ON billable_rates(effective_from);
CREATE INDEX IF NOT EXISTS idx_active_timers_user ON active_timers(user_id);
CREATE INDEX IF NOT EXISTS idx_time_approval_requests_entry ON time_approval_requests(entry_id);
CREATE INDEX IF NOT EXISTS idx_time_approval_requests_status ON time_approval_requests(decision);
CREATE INDEX IF NOT EXISTS idx_time_report_snapshots_project ON time_report_snapshots(project_id);

CREATE TRIGGER IF NOT EXISTS prevent_time_history_update
BEFORE UPDATE ON time_entry_history
BEGIN SELECT RAISE(ABORT, 'time_entry_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_time_history_delete
BEFORE DELETE ON time_entry_history
BEGIN SELECT RAISE(ABORT, 'time_entry_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_billable_rate_update
BEFORE UPDATE ON billable_rates
BEGIN SELECT RAISE(ABORT, 'billable_rates is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_billable_rate_delete
BEFORE DELETE ON billable_rates
BEGIN SELECT RAISE(ABORT, 'billable_rates is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_approval_request_update
BEFORE UPDATE ON time_approval_requests
BEGIN SELECT RAISE(ABORT, 'time_approval_requests is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_approval_request_delete
BEFORE DELETE ON time_approval_requests
BEGIN SELECT RAISE(ABORT, 'time_approval_requests is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_time_report_snapshot_update
BEFORE UPDATE ON time_report_snapshots
BEGIN SELECT RAISE(ABORT, 'time_report_snapshots is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_time_report_snapshot_delete
BEFORE DELETE ON time_report_snapshots
BEGIN SELECT RAISE(ABORT, 'time_report_snapshots is append-only'); END;

