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
    action      VARCHAR(100) NOT NULL,
    resource    VARCHAR(100),
    ip_address  VARCHAR(45),
    timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                         'REJECTED','ARCHIVED')),
    submitted_at        TIMESTAMP,
    voting_deadline     TIMESTAMP,
    green_percentage    DECIMAL(5,2) DEFAULT 0.0,
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
                        ('TODO','BLOCKED','IN_PROGRESS','DONE')),
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


