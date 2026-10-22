-- Step 01 Core Tables and Production Indexes

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

-- Production Indexes (Step 13 Checklist)
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
