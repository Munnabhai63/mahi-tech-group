import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { queryOne, execute, queryAll } from './database.js';
import { config } from '../config.js';

export const PERMISSION_MATRIX = [
  { key: 'idea.submit', researcher: 1, developer: 1, producer: 1, admin: 1, designer: 1 },
  { key: 'idea.vote', researcher: 1, developer: 1, producer: 1, admin: 1, designer: 1 },
  { key: 'project.view_own', researcher: 1, developer: 1, producer: 1, admin: 1, designer: 1 },
  { key: 'project.view_all', researcher: 0, developer: 0, producer: 0, admin: 1, designer: 0 },
  { key: 'project.launch_approve', researcher: 0, developer: 0, producer: 0, admin: 1, designer: 0 },
  { key: 'member.add', researcher: 0, developer: 0, producer: 0, admin: 1, designer: 0 },
  { key: 'member.remove', researcher: 0, developer: 0, producer: 0, admin: 1, designer: 0 },
  { key: 'application.review', researcher: 0, developer: 0, producer: 0, admin: 1, designer: 0 },
  { key: 'payout.approve', researcher: 0, developer: 0, producer: 0, admin: 1, designer: 0 },
  { key: 'revenue.manual_entry', researcher: 0, developer: 0, producer: 0, admin: 1, designer: 0 },
  { key: 'asset.export_download', researcher: 0, developer: 0, producer: 0, admin: 1, designer: 0 },
  { key: 'meeting.host', researcher: 1, developer: 1, producer: 1, admin: 1, designer: 1 },
  { key: 'coworking.join', researcher: 1, developer: 1, producer: 1, admin: 1, designer: 1 }
];

export const ROLES = ['researcher', 'developer', 'producer', 'admin', 'designer'];

export async function runSeed() {
  console.log('>>> Running Database Seeding...');

  // 1. Seed roles_permissions (all 13 keys across all 5 roles = 65 entries)
  let permissionsInserted = 0;
  for (const item of PERMISSION_MATRIX) {
    for (const role of ROLES) {
      const allowed = item[role];
      const existing = queryOne(
        'SELECT id FROM roles_permissions WHERE role = ? AND permission_key = ?',
        [role, item.key]
      );
      if (!existing) {
        const id = crypto.randomUUID();
        execute(
          'INSERT INTO roles_permissions (id, role, permission_key, allowed) VALUES (?, ?, ?, ?)',
          [id, role, item.key, allowed]
        );
        permissionsInserted++;
      } else {
        // Update if already exists to ensure matrix consistency
        execute(
          'UPDATE roles_permissions SET allowed = ? WHERE role = ? AND permission_key = ?',
          [allowed, role, item.key]
        );
      }
    }
  }
  console.log(`>>> Seeded/Verified RBAC permissions: 48 entries (${permissionsInserted} newly inserted).`);

  // 2. Seed Default Admin User (The initial system owner)
  const adminEmail = 'admin@mahitechgroup.com';
  const existingAdmin = queryOne('SELECT id, email FROM users WHERE email = ?', [adminEmail]);

  if (!existingAdmin) {
    const adminId = crypto.randomUUID();
    const plainPassword = 'AdminPassword@2026';
    const passwordHash = await bcrypt.hash(plainPassword, config.BCRYPT_SALT_ROUNDS);

    execute(`
      INSERT INTO users (
        id, name, email, password_hash, role, sub_role, status,
        rating_avg, idea_quota_used, quota_reset_date, wallet_balance,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      adminId,
      'System Admin',
      adminEmail,
      passwordHash,
      'admin',
      null,
      'active',
      5.0,
      0,
      null,
      0.0
    ]);
    console.log(`>>> Seeded Default Admin User: ${adminEmail} (Role: admin, Status: active)`);
  } else {
    console.log(`>>> Default Admin User already exists: ${adminEmail}`);
  }

  // 2b. Seed Default Role Demo Users (Researcher, Developer, Producer, Designer)
  const defaultRoleUsers = [
    { name: 'Dr. Priya Sharma', email: 'researcher@mahitechgroup.com', pass: 'ResearcherPass123!', role: 'researcher', subRole: null },
    { name: 'Arjun Dev', email: 'developer@mahitechgroup.com', pass: 'DeveloperPass123!', role: 'developer', subRole: 'frontend' },
    { name: 'Sameer Tester', email: 'producer@mahitechgroup.com', pass: 'ProducerPass123!', role: 'producer', subRole: null },
    { name: 'Diya Designer', email: 'designer@mahitechgroup.com', pass: 'DesignerPass123!', role: 'designer', subRole: null }
  ];

  for (const ru of defaultRoleUsers) {
    const existing = queryOne('SELECT id FROM users WHERE email = ?', [ru.email]);
    if (!existing) {
      const uId = crypto.randomUUID();
      const pHash = await bcrypt.hash(ru.pass, config.BCRYPT_SALT_ROUNDS);
      execute(`
        INSERT INTO users (
          id, name, email, password_hash, role, sub_role, status,
          rating_avg, idea_quota_used, quota_reset_date, wallet_balance,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 5.0, 0, null, 1500.0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [uId, ru.name, ru.email, pHash, ru.role, ru.subRole]);
      console.log(`>>> Seeded Default Role User: ${ru.email} (${ru.role})`);
    }
  }

  // 3. Seed Default System Config (Step 02 & Step 03)
  const defaultConfigs = [
    { key: 'idea_quota_limit', value: '2' },
    { key: 'idea_quota_window_days', value: '7' },
    { key: 'vote_approval_threshold', value: '70' },
    { key: 'vote_quorum_percentage', value: '70' },
    { key: 'voting_window_hours', value: '48' }
  ];

  for (const cfg of defaultConfigs) {
    const existingCfg = queryOne('SELECT key FROM system_config WHERE key = ?', [cfg.key]);
    if (!existingCfg) {
      execute(
        'INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [cfg.key, cfg.value]
      );
      console.log(`>>> Seeded System Config: ${cfg.key} = ${cfg.value}`);
    } else {
      console.log(`>>> System Config exists: ${cfg.key}`);
    }
  }

  const roleCount = queryAll('SELECT role, COUNT(*) as cnt FROM roles_permissions GROUP BY role;');
  console.log('>>> Roles Permissions Distribution:', roleCount);
  const userCount = queryOne('SELECT COUNT(*) as cnt FROM users;');
  console.log('>>> Total Users in DB:', userCount.cnt);
  const configs = queryAll('SELECT key, value FROM system_config;');
  console.log('>>> System Config Entries:', configs);
}

// When run directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSeed().then(() => {
    console.log('>>> Seeding complete.');
    process.exit(0);
  }).catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
}
