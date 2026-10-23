import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, execRaw, queryAll, queryOne, execute } from './database.js';
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
