import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, execRaw, queryAll, queryOne } from './database.js';

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
