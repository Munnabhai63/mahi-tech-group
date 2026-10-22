-- ===================================================================
-- STEP 01: Core Tables and Production Indexes
-- ===================================================================

CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    name              VARCHAR(100) NOT NULL,
    email             VARCHAR(150) UNIQUE NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    role              VARCHAR(20) NOT NULL CHECK (role IN ('researcher','developer','producer','admin')),
    sub_role          VARCHAR(20) CHECK (sub_role IN ('frontend','backend',NULL)),
    status            VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    rating_avg        DECIMAL(3,2) DEFAULT 0.0,
    idea_quota_used   INT DEFAULT 0,
    quota_reset_date  DATE,
    wallet_balance    DECIMAL(12,2) DEFAULT 0.0,
    profile_photo_url TEXT,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deactivated_at    TIMESTAMP NULL
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
-- Production Indexes (Step 01, Step 02, Step 03 + Step 13 Checklist)
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
