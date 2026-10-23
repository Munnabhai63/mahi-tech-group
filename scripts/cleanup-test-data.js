/**
 * CLEANUP TEST DATA SCRIPT — MAHI TECH GROUP
 * Restores the development database strictly to the canonical 10-15 person team roster:
 * - 1 System Admin
 * - 3 Researchers (Dr. Priya Sharma, Dr. Elena Vance, Arjun Sen)
 * - 4 Active Developers (Arjun Dev [FE], Kavita Nair [BE], Marcus Chen [BE], Aria Stark [FE])
 * - 1 Inactive/Former Developer (Riya Sharma)
 * - 2 Producers (Sameer Tester, David Kim)
 * - 2 UI/UX Designers (Diya Designer, Maya Designer)
 * Total: Exactly 13 members (12 active + 1 inactive former member).
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { queryAll, queryOne, execute } from '../src/db/database.js';
import { runSeed } from '../src/db/seed.js';
import { config } from '../src/config.js';

export const CANONICAL_TEAM = [
  { name: 'System Admin', email: 'admin@mahitechgroup.com', pass: 'AdminPassword@2026', role: 'admin', sub_role: null, status: 'active', rating: 5.0, balance: 0.0, frozen: 0 },
  { name: 'Dr. Priya Sharma', email: 'researcher@mahitechgroup.com', pass: 'ResearcherPass123!', role: 'researcher', sub_role: null, status: 'active', rating: 5.0, balance: 1500.0, frozen: 0 },
  { name: 'Dr. Elena Vance', email: 'elena.researcher@mahitechgroup.com', pass: 'ElenaPass123!', role: 'researcher', sub_role: null, status: 'active', rating: 4.9, balance: 2800.0, frozen: 0 },
  { name: 'Arjun Sen', email: 'researcher.arjun@mahitechgroup.com', pass: 'ArjunPass123!', role: 'researcher', sub_role: null, status: 'active', rating: 4.8, balance: 1750.0, frozen: 0 },
  { name: 'Arjun Dev', email: 'developer@mahitechgroup.com', pass: 'DeveloperPass123!', role: 'developer', sub_role: 'frontend', status: 'active', rating: 4.9, balance: 2200.0, frozen: 0 },
  { name: 'Kavita Nair', email: 'kavita.dev@mahitechgroup.com', pass: 'KavitaPass123!', role: 'developer', sub_role: 'backend', status: 'active', rating: 4.9, balance: 3100.0, frozen: 0 },
  { name: 'Marcus Chen', email: 'marcus.backend@mahitechgroup.com', pass: 'MarcusPass123!', role: 'developer', sub_role: 'backend', status: 'active', rating: 4.8, balance: 1950.0, frozen: 0 },
  { name: 'Aria Stark', email: 'aria.frontend@mahitechgroup.com', pass: 'AriaPass123!', role: 'developer', sub_role: 'frontend', status: 'active', rating: 4.9, balance: 2100.0, frozen: 0 },
  { name: 'Sameer Tester', email: 'producer@mahitechgroup.com', pass: 'ProducerPass123!', role: 'producer', sub_role: null, status: 'active', rating: 4.8, balance: 1800.0, frozen: 0 },
  { name: 'David Kim', email: 'david.producer@mahitechgroup.com', pass: 'DavidPass123!', role: 'producer', sub_role: null, status: 'active', rating: 4.7, balance: 1600.0, frozen: 0 },
  { name: 'Diya Designer', email: 'designer@mahitechgroup.com', pass: 'DesignerPass123!', role: 'designer', sub_role: null, status: 'active', rating: 5.0, balance: 2500.0, frozen: 0 },
  { name: 'Maya Designer', email: 'designer.beta@mahitechgroup.com', pass: 'MayaPass123!', role: 'designer', sub_role: null, status: 'active', rating: 4.8, balance: 1400.0, frozen: 0 },
  { name: 'Riya Sharma', email: 'dev.riya@mahitechgroup.com', pass: 'RiyaPass123!', role: 'developer', sub_role: 'frontend', status: 'inactive', rating: 4.5, balance: 0.0, frozen: 1 }
];

export async function cleanupTestData(verbose = true) {
  if (verbose) {
    console.log('===================================================================');
    console.log('   MAHI TECH GROUP — ROSTER PURGE & CANONICAL TEAM RESTORATION');
    console.log('===================================================================\n');
  }

  const canonicalEmails = new Set(CANONICAL_TEAM.map(m => m.email.toLowerCase()));

  // Temporarily disable foreign keys to allow purging ephemeral test records
  execute('PRAGMA foreign_keys = OFF');
  const allUsers = queryAll('SELECT id, email, name, role, status FROM users');
  const testUsers = allUsers.filter(u => !canonicalEmails.has(u.email.toLowerCase()));

  if (verbose) {
    console.log(`[CLEANUP] Total users in DB before purge: ${allUsers.length}`);
    console.log(`[CLEANUP] Found ${testUsers.length} non-canonical / stale test accounts.`);
  }

  if (testUsers.length > 0) {
    for (const tu of testUsers) {
      execute('DELETE FROM project_members WHERE user_id = ?', [tu.id]);
      execute('DELETE FROM project_tasks WHERE assigned_to = ?', [tu.id]);
      execute('DELETE FROM votes WHERE voter_id = ?', [tu.id]);
      execute('DELETE FROM wallet_settlements WHERE user_id = ? OR settled_by = ?', [tu.id, tu.id]);
      execute('DELETE FROM pending_settlements WHERE user_id = ? OR settled_by = ?', [tu.id, tu.id]);
      execute('DELETE FROM sessions WHERE user_id = ?', [tu.id]);
      execute('DELETE FROM notifications WHERE user_id = ?', [tu.id]);
      execute('DELETE FROM offboarding WHERE user_id = ? OR initiated_by = ?', [tu.id, tu.id]);
      execute('DELETE FROM idea_quota_log WHERE user_id = ?', [tu.id]);

      // Delete ideas & dependent projects owned by test user
      const ownedIdeas = queryAll('SELECT id FROM ideas WHERE owner_id = ?', [tu.id]);
      for (const idea of ownedIdeas) {
        execute('DELETE FROM review_meetings WHERE idea_id = ?', [idea.id]);
        const ownedProjects = queryAll('SELECT id FROM projects WHERE idea_id = ?', [idea.id]);
        for (const proj of ownedProjects) {
          execute('DELETE FROM project_tasks WHERE project_id = ?', [proj.id]);
          execute('DELETE FROM project_members WHERE project_id = ?', [proj.id]);
          execute('DELETE FROM projects WHERE id = ?', [proj.id]);
        }
        execute('DELETE FROM ideas WHERE id = ?', [idea.id]);
      }

      execute('DELETE FROM users WHERE id = ?', [tu.id]);
    }
    if (verbose) console.log(`[CLEANUP] Purged ${testUsers.length} ephemeral test accounts.`);
  }

  // 2. Ensure each canonical team member exists and is properly populated
  for (const cm of CANONICAL_TEAM) {
    const existing = queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [cm.email]);
    if (!existing) {
      const uId = crypto.randomUUID();
      const pHash = await bcrypt.hash(cm.pass, config.BCRYPT_SALT_ROUNDS);
      execute(`
        INSERT INTO users (
          id, name, email, password_hash, role, sub_role, status,
          rating_avg, idea_quota_used, quota_reset_date, wallet_balance, wallet_frozen,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, null, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [uId, cm.name, cm.email, pHash, cm.role, cm.sub_role, cm.status, cm.rating, cm.balance, cm.frozen]);
    } else {
      execute(`
        UPDATE users
        SET name = ?, role = ?, sub_role = ?, status = ?, rating_avg = ?, wallet_balance = ?, wallet_frozen = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [cm.name, cm.role, cm.sub_role, cm.status, cm.rating, cm.balance, cm.frozen, existing.id]);
    }
  }

  // Run seed to ensure system config and permissions are fully verified
  await runSeed();

  const finalUsers = queryAll('SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at ASC');
  if (verbose) {
    console.log(`\n[CLEANUP COMPLETE] Final Official Roster (${finalUsers.length} members):`);
    finalUsers.forEach(u => console.log(`   - [${u.role.toUpperCase()}] ${u.name} <${u.email}> (${u.status})`));
    console.log('\n✓ Database successfully restored to the canonical 10-15 member team.');
  }

  // Restore foreign keys enforcement
  execute('PRAGMA foreign_keys = ON');

  return finalUsers;
}

if (process.argv[1] && process.argv[1].endsWith('cleanup-test-data.js')) {
  cleanupTestData(true).catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
}
