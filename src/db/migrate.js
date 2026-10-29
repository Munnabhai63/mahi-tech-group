import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, execRaw, queryAll, queryOne, execute, ANALYTICS_SCHEMA_SQL, seedBuiltInKpis, CLIENT_PORTAL_SCHEMA_SQL, BUDGET_FINANCIAL_SCHEMA_SQL, seedDefaultExpenseCategories, AUTOMATION_SCHEMA_SQL, seedBuiltInAutomationTemplates } from './database.js';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigration() {
  console.log('>>> Running Database Migration...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  execRaw(schemaSql);

  // Check if wallet_frozen column exists on users table (for existing DB instances)
  const userColumns = queryAll('PRAGMA table_info(users);');
  const hasWalletFrozen = userColumns.some(c => c.name === 'wallet_frozen');
  if (!hasWalletFrozen) {
    execRaw('ALTER TABLE users ADD COLUMN wallet_frozen BOOLEAN DEFAULT 0;');
    console.log('>>> Added wallet_frozen column to users table.');
  }

  const hasBio = userColumns.some(c => c.name === 'bio');
  if (!hasBio) {
    execRaw('ALTER TABLE users ADD COLUMN bio TEXT;');
    console.log('>>> Added bio column to users table.');
  }

  // Step 14 Layer 1: last_active_at and avatar_url on users table
  const hasLastActiveAt = userColumns.some(c => c.name === 'last_active_at');
  if (!hasLastActiveAt) {
    execRaw('ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP NULL;');
    console.log('>>> Added last_active_at column to users table.');
  }

  const hasAvatarUrl = userColumns.some(c => c.name === 'avatar_url');
  if (!hasAvatarUrl) {
    execRaw('ALTER TABLE users ADD COLUMN avatar_url TEXT NULL;');
    console.log('>>> Added avatar_url column to users table.');
  }

  // Step 14 Layer 2: target_id and created_at on access_log table
  const accessLogCols = queryAll('PRAGMA table_info(access_log);');
  const hasTargetId = accessLogCols.some(c => c.name === 'target_id');
  if (!hasTargetId) {
    execRaw('ALTER TABLE access_log ADD COLUMN target_id TEXT REFERENCES users(id);');
    console.log('>>> Added target_id column to access_log table.');
  }
  const hasCreatedAt = accessLogCols.some(c => c.name === 'created_at');
  if (!hasCreatedAt) {
    execRaw('ALTER TABLE access_log ADD COLUMN created_at TIMESTAMP;');
    console.log('>>> Added created_at column to access_log table.');
  }

  // Step 14 Layer 3: Support tickets and ticket messages
  execRaw(`
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
  `);

  // Step 14 Layer 4: Link support ticket to dispute
  const ticketCols = queryAll('PRAGMA table_info(support_tickets);');
  if (!ticketCols.some(c => c.name === 'dispute_id')) {
    execRaw('ALTER TABLE support_tickets ADD COLUMN dispute_id TEXT REFERENCES disputes(id);');
    console.log('>>> Added dispute_id column to support_tickets table.');
  }

  // Step 14 Layer 3: Ideas Kill Switch columns
  const ideaCols = queryAll('PRAGMA table_info(ideas);');
  if (!ideaCols.some(c => c.name === 'killed_reason')) {
    execRaw('ALTER TABLE ideas ADD COLUMN killed_reason TEXT NULL;');
  }
  if (!ideaCols.some(c => c.name === 'killed_at')) {
    execRaw('ALTER TABLE ideas ADD COLUMN killed_at TIMESTAMP NULL;');
  }
  if (!ideaCols.some(c => c.name === 'killed_by')) {
    execRaw('ALTER TABLE ideas ADD COLUMN killed_by TEXT NULL REFERENCES users(id);');
  }
  if (!ideaCols.some(c => c.name === 'pre_kill_status')) {
    execRaw('ALTER TABLE ideas ADD COLUMN pre_kill_status TEXT NULL;');
  }

  // Update ideas status CHECK constraint to allow 'killed'
  const ideasSql = queryOne("SELECT sql FROM sqlite_master WHERE type='table' AND name='ideas'")?.sql || '';
  if (ideasSql && !ideasSql.includes("'killed'")) {
    console.log('>>> Migrating ideas table to allow killed status in CHECK constraint...');
    execRaw(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE ideas_dg_tmp (
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
      INSERT INTO ideas_dg_tmp SELECT id, owner_id, title, description, attachment_url, status, submitted_at, voting_deadline, green_percentage, killed_reason, killed_at, killed_by, pre_kill_status, created_at, updated_at FROM ideas;
      DROP TABLE ideas;
      ALTER TABLE ideas_dg_tmp RENAME TO ideas;
      CREATE INDEX IF NOT EXISTS idx_ideas_owner_id ON ideas(owner_id);
      CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
      CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
    console.log('>>> Successfully updated ideas table CHECK constraint.');
  }

  // Update project_tasks status CHECK constraint to allow 'cancelled'
  const ptSql = queryOne("SELECT sql FROM sqlite_master WHERE type='table' AND name='project_tasks'")?.sql || '';
  if (ptSql && !ptSql.includes("'cancelled'")) {
    console.log('>>> Migrating project_tasks table to allow cancelled status in CHECK constraint...');
    execRaw(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE project_tasks_dg_tmp (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        idea_id             TEXT REFERENCES ideas(id),
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
      INSERT INTO project_tasks_dg_tmp (id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at, completed_at)
        SELECT id, project_id, assigned_to, task_name, task_type, depends_on_task_id, status, created_at, completed_at FROM project_tasks;
      DROP TABLE project_tasks;
      ALTER TABLE project_tasks_dg_tmp RENAME TO project_tasks;
      UPDATE project_tasks SET idea_id = (SELECT idea_id FROM projects WHERE projects.id = project_tasks.project_id);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
    console.log('>>> Successfully updated project_tasks table CHECK constraint.');
  }

  // Check if access_log target_id has a foreign key to users
  const accessLogFks = queryAll("PRAGMA foreign_key_list(access_log)");
  const hasTargetIdFk = accessLogFks.some(fk => fk.from === 'target_id');
  if (hasTargetIdFk) {
    console.log('>>> Migrating access_log table to remove foreign key on target_id (supports tickets, ideas, disputes)...');
    execRaw(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE access_log_dg_tmp (
        id          TEXT PRIMARY KEY,
        user_id     TEXT REFERENCES users(id),
        target_id   TEXT,
        action      VARCHAR(100) NOT NULL,
        resource    VARCHAR(100),
        ip_address  VARCHAR(45),
        timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO access_log_dg_tmp (id, user_id, target_id, action, resource, ip_address, timestamp, created_at)
        SELECT id, user_id, target_id, action, resource, ip_address, timestamp, created_at FROM access_log;
      DROP TABLE access_log;
      ALTER TABLE access_log_dg_tmp RENAME TO access_log;
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
    console.log('>>> Successfully updated access_log table.');
  }

  // 1. Check if users table role CHECK constraint includes 'designer'
  const usersSql = queryOne("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")?.sql || '';
  if (usersSql && !usersSql.includes("'designer'")) {
    console.log('>>> Migrating users table to add designer role to CHECK constraint...');
    execRaw(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE users_dg_tmp (
        id                TEXT PRIMARY KEY,
        name              VARCHAR(100) NOT NULL,
        email             VARCHAR(150) UNIQUE NOT NULL,
        password_hash     VARCHAR(255) NOT NULL,
        role              VARCHAR(20) NOT NULL CHECK (role IN ('researcher','developer','producer','admin','designer')),
        sub_role          VARCHAR(20) CHECK (sub_role IN ('frontend','backend',NULL)),
        status            VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
        rating_avg        DECIMAL(3,2) DEFAULT 0.0,
        idea_quota_used   INT DEFAULT 0,
        quota_reset_date  DATE,
        wallet_balance    DECIMAL(12,2) DEFAULT 0.0,
        wallet_frozen     BOOLEAN DEFAULT 0,
        profile_photo_url TEXT,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deactivated_at    TIMESTAMP NULL
      );
      INSERT INTO users_dg_tmp SELECT id, name, email, password_hash, role, sub_role, status, rating_avg, idea_quota_used, quota_reset_date, wallet_balance, wallet_frozen, profile_photo_url, created_at, updated_at, deactivated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_dg_tmp RENAME TO users;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
    console.log('>>> Successfully updated users table CHECK constraint.');
  }

  // 1b. Check if users table includes 'pending' status and 'desired_role'
  const currentUsersSql = queryOne("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")?.sql || '';
  if (currentUsersSql && (!currentUsersSql.includes("'pending'") || !currentUsersSql.includes('desired_role'))) {
    console.log('>>> Migrating users table to add pending/rejected status and desired_role...');
    execRaw(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE users_dg_tmp (
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
      INSERT INTO users_dg_tmp (id, name, email, password_hash, role, sub_role, status, rating_avg, idea_quota_used, quota_reset_date, wallet_balance, wallet_frozen, profile_photo_url, created_at, updated_at, deactivated_at)
        SELECT id, name, email, password_hash, role, sub_role, status, rating_avg, idea_quota_used, quota_reset_date, wallet_balance, wallet_frozen, profile_photo_url, created_at, updated_at, deactivated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_dg_tmp RENAME TO users;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
    console.log('>>> Successfully updated users table schema for pending approval gate.');
  }

  // 2. Check if project_members table role_in_project CHECK constraint includes 'designer'
  const membersSql = queryOne("SELECT sql FROM sqlite_master WHERE type='table' AND name='project_members'")?.sql || '';
  if (membersSql && !membersSql.includes("'designer'")) {
    console.log('>>> Migrating project_members table to add designer to CHECK constraint...');
    execRaw(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE project_members_dg_tmp (
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
      INSERT INTO project_members_dg_tmp SELECT * FROM project_members;
      DROP TABLE project_members;
      ALTER TABLE project_members_dg_tmp RENAME TO project_members;
      CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
    console.log('>>> Successfully updated project_members table CHECK constraint.');
  }

  // 3. Check if project_tasks table task_type CHECK constraint includes 'design'
  const tasksSql = queryOne("SELECT sql FROM sqlite_master WHERE type='table' AND name='project_tasks'")?.sql || '';
  if (tasksSql && !tasksSql.includes("'design'")) {
    console.log('>>> Migrating project_tasks table to add design to task_type CHECK constraint...');
    execRaw(`
      PRAGMA foreign_keys=OFF;
      BEGIN TRANSACTION;
      CREATE TABLE project_tasks_dg_tmp (
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
      INSERT INTO project_tasks_dg_tmp SELECT * FROM project_tasks;
      DROP TABLE project_tasks;
      ALTER TABLE project_tasks_dg_tmp RENAME TO project_tasks;
      CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned_to ON project_tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_project_tasks_depends_on ON project_tasks(depends_on_task_id);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
    console.log('>>> Successfully updated project_tasks table CHECK constraint.');
  }

  // 4. Ensure Step 11 Co-working Rooms & Participants exist and backfill existing projects
  execRaw(`
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
  `);

  // Backfill any projects that don't have a room yet
  const projectsWithoutRoom = queryAll(`
    SELECT p.id, p.current_stage, p.status FROM projects p
    LEFT JOIN coworking_rooms cr ON p.id = cr.project_id
    WHERE cr.id IS NULL
  `);
  if (projectsWithoutRoom.length > 0) {
    for (const p of projectsWithoutRoom) {
      const isArchived = (p.current_stage === 'LIVE' || p.status === 'LIVE');
      const rId = crypto.randomUUID();
      const initState = JSON.stringify({
        objects: {},
        tombstones: {},
        metadata: { version: 1, archived: isArchived }
      });
      execute(`
        INSERT OR IGNORE INTO coworking_rooms (id, project_id, room_type, status, canvas_state_json, created_at, last_active_at)
        VALUES (?, ?, 'custom', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [rId, p.id, isArchived ? 'archived' : 'active', initState]);
    }
    console.log(`>>> Backfilled coworking rooms for ${projectsWithoutRoom.length} existing projects.`);
  }

  // 5. Ensure Step 12 Meeting Integration tables and triggers exist
  execRaw(`
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

    CREATE TRIGGER IF NOT EXISTS prevent_meeting_attendance_delete
    BEFORE DELETE ON meeting_attendance
    BEGIN
        SELECT RAISE(FAIL, 'Immutable log: DELETE not allowed on meeting_attendance');
    END;

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
  `);

  // Ensure default jitsi_domain config exists
  const jitsiDomainCfg = queryOne("SELECT value FROM system_config WHERE key = 'jitsi_domain'");
  if (!jitsiDomainCfg) {
    execute("INSERT OR IGNORE INTO system_config (key, value, updated_at) VALUES ('jitsi_domain', 'meet.jit.si', CURRENT_TIMESTAMP)");
    console.log('>>> Seeded default jitsi_domain in system_config.');
  }

  // Step 14 Layer 2: Default performance weights
  const defaultPerfWeights = [
    { key: 'performance_weight_task', value: '0.30' },
    { key: 'performance_weight_idea', value: '0.25' },
    { key: 'performance_weight_voting', value: '0.20' },
    { key: 'performance_weight_meeting', value: '0.15' },
    { key: 'performance_weight_revenue', value: '0.10' }
  ];
  for (const pw of defaultPerfWeights) {
    const exists = queryOne('SELECT value FROM system_config WHERE key = ?', [pw.key]);
    if (!exists) {
      execute("INSERT OR IGNORE INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", [pw.key, pw.value]);
    }
  }

  // Step 14 Layer 5: Payment gateway config default row
  const gwConfig = queryOne('SELECT id FROM payment_gateway_config LIMIT 1');
  if (!gwConfig) {
    execute(`
      INSERT INTO payment_gateway_config (
        id, mode, gateway_name, api_key_encrypted, webhook_secret_encrypted, auto_approve_below, created_at, updated_at
      ) VALUES (?, 'sandbox', 'SIMULATED_GATEWAY_STUB', NULL, NULL, 0, datetime('now'), datetime('now'))
    `, [crypto.randomUUID()]);
    console.log('>>> Seeded default payment_gateway_config row.');
  }

  // Step 15: 4-Role Project Pipeline Workflow Tables & Triggers
  execRaw(`
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
  `);

  // Ensure type column on pipeline_addendum_requests if it pre-existed
  const addendumCols = queryAll("PRAGMA table_info(pipeline_addendum_requests);");
  if (addendumCols.length > 0 && !addendumCols.some(c => c.name === 'type')) {
    execRaw("ALTER TABLE pipeline_addendum_requests ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'ADDENDUM';");
    console.log('>>> Added type column to pipeline_addendum_requests table.');
  }

  // ===================================================================
  // STEP 16: PRD 16 Point-Pool, Participation % and Tool Links Migration
  // ===================================================================
  const pointCols = queryAll("PRAGMA table_info(pipeline_checklist_points);");
  if (pointCols.length > 0 && !pointCols.some(c => c.name === 'claim_locked_by')) {
    execRaw("ALTER TABLE pipeline_checklist_points ADD COLUMN claim_locked_by TEXT REFERENCES users(id);");
    console.log('>>> Added claim_locked_by column to pipeline_checklist_points table.');
  }
  if (pointCols.length > 0 && !pointCols.some(c => c.name === 'claim_locked_at')) {
    execRaw("ALTER TABLE pipeline_checklist_points ADD COLUMN claim_locked_at TIMESTAMP;");
    console.log('>>> Added claim_locked_at column to pipeline_checklist_points table.');
  }

  execRaw(`
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
  `);

  const revSplitCols = queryAll("PRAGMA table_info(revenue_splits);");
  if (revSplitCols.length > 0 && !revSplitCols.some(c => c.name === 'is_blocked')) {
    execRaw("ALTER TABLE revenue_splits ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;");
    console.log('>>> Added is_blocked column to revenue_splits table.');
  }
  if (revSplitCols.length > 0 && !revSplitCols.some(c => c.name === 'block_reason')) {
    execRaw("ALTER TABLE revenue_splits ADD COLUMN block_reason TEXT;");
    console.log('>>> Added block_reason column to revenue_splits table.');
  }
  if (revSplitCols.length > 0 && !revSplitCols.some(c => c.name === 'unblocked_by')) {
    execRaw("ALTER TABLE revenue_splits ADD COLUMN unblocked_by TEXT REFERENCES users(id);");
    console.log('>>> Added unblocked_by column to revenue_splits table.');
  }
  if (revSplitCols.length > 0 && !revSplitCols.some(c => c.name === 'unblocked_at')) {
    execRaw("ALTER TABLE revenue_splits ADD COLUMN unblocked_at TIMESTAMP;");
    console.log('>>> Added unblocked_at column to revenue_splits table.');
  }

  // Update trigger on revenue_splits to allow participation gate updates while keeping financial records immutable
  execRaw(`
    DROP TRIGGER IF EXISTS prevent_revenue_splits_update;
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
  `);

  // ============================================================
  // PRD 18: Sprint Planning, Backlog Management & Velocity Tracking
  // ============================================================
  execRaw(`
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
  `);

  // PRD 19: OKR System (Objectives & Key Results)
  execRaw(`
    CREATE TABLE IF NOT EXISTS okr_objectives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      level TEXT NOT NULL DEFAULT 'TEAM',
      owner_id INTEGER NOT NULL REFERENCES users(id),
      parent_objective_id INTEGER REFERENCES okr_objectives(id),
      project_id INTEGER REFERENCES projects(id),
      cycle TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      progress_pct REAL DEFAULT 0.0,
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
      target_value REAL NOT NULL DEFAULT 100,
      current_value REAL NOT NULL DEFAULT 0,
      unit TEXT,
      progress_pct REAL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'ON_TRACK',
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
      note TEXT,
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
  `);

  // PRD 20 Layer 1: Gantt Chart & Timeline View
  execRaw(`
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
  `);

  // ===================================================================
  // STEP 22: PRD 22 Time Tracking Tables, Triggers & Indexes Migration
  // ===================================================================
  execRaw(`
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
  `);

  // PRD 23: Analytics & KPI Dashboard
  execRaw(ANALYTICS_SCHEMA_SQL);
  const kpiCols = queryAll("PRAGMA table_info(kpi_definitions);");
  if (!kpiCols.some(c => c.name === 'is_built_in')) {
    execRaw("ALTER TABLE kpi_definitions ADD COLUMN is_built_in INTEGER DEFAULT 0;");
  }
  execRaw("UPDATE kpi_definitions SET is_built_in = 1 WHERE id <= 10;");
  seedBuiltInKpis(getDatabase());

  // PRD 24: Client Portal
  execRaw(CLIENT_PORTAL_SCHEMA_SQL);

  // PRD 25: Budget & Financial Management
  execRaw(BUDGET_FINANCIAL_SCHEMA_SQL);
  seedDefaultExpenseCategories(getDatabase());

  // PRD 26: Workflow Automation Engine
  execRaw(AUTOMATION_SCHEMA_SQL);
  seedBuiltInAutomationTemplates(getDatabase());

  // Verification of tables
  const tables = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  console.log('>>> Migration executed successfully.');
  console.log('>>> Verified Tables in Database:', tables.map(t => t.name).join(', '));

  // Verification of indexes
  const indexes = queryAll("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  console.log('>>> Verified Indexes in Database:', indexes.map(i => i.name).join(', '));

  return { tables, indexes };
}

// When run directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runMigration();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}
