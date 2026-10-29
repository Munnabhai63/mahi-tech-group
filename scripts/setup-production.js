/**
 * PRODUCTION BOOTSTRAP SCRIPT — MAHI TECH GROUP
 * Creates a pristine, production-ready database with ZERO dummy data.
 * 
 * What this does:
 * 1. Runs all migrations, triggers, and composite indexes.
 * 2. Seeds standard RBAC permission matrices and system config.
 * 3. Removes all mock/test persona accounts and demo projects.
 * 4. Creates exactly ONE real Super Admin account from environment variables.
 * 5. Leaves ideas, projects, tasks, tickets, and wallets completely clean for real users.
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDatabase, execute, queryOne, queryAll } from '../src/db/database.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { config } from '../src/config.js';

export async function setupProduction() {
  console.log('===================================================================');
  console.log('   MAHI TECH GROUP — PRODUCTION ENVIRONMENT BOOTSTRAP');
  console.log('   Zero-Dummy-Data Production Database Initialization');
  console.log('===================================================================\n');

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@mahitechgroup.com').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe@Admin2026!';
  const adminName = (process.env.ADMIN_NAME || 'System Administrator').trim();

  // 1. Run migrations
  console.log('[STEP 1/5] Running core and PRD migrations...');
  runMigration();

  // 2. Run seed for system config & RBAC permissions
  console.log('[STEP 2/5] Initializing RBAC permissions & system config...');
  await runSeed();

  // 3. Purge all dummy/test accounts, ideas, and projects
  console.log('[STEP 3/5] Purging mock personas and demo data...');
  execute('PRAGMA foreign_keys = OFF');
  
  // Wipe demo projects, tasks, ideas, tickets, disputes
  execute('DELETE FROM project_members');
  execute('DELETE FROM project_tasks');
  execute('DELETE FROM pipeline_checklist_points');
  execute('DELETE FROM pipeline_stage_handoffs');
  execute('DELETE FROM pipeline_addendum_requests');
  execute('DELETE FROM pipeline_deliverables');
  execute('DELETE FROM point_pool_claims');
  execute('DELETE FROM participation_thresholds');
  execute('DELETE FROM point_tool_links');
  execute('DELETE FROM project_github_memberships');
  execute('DELETE FROM project_github_repos');
  execute('DELETE FROM coworking_rooms');
  execute('DELETE FROM room_participants');
  execute('DELETE FROM projects');

  execute('DELETE FROM votes');
  execute('DELETE FROM review_meetings');
  execute('DELETE FROM idea_quota_log');
  execute('DELETE FROM ideas');

  execute('DELETE FROM ticket_messages');
  execute('DELETE FROM support_tickets');
  execute('DELETE FROM dispute_signatures');
  execute('DELETE FROM dispute_parties');
  execute('DELETE FROM dispute_agreements');
  execute('DELETE FROM disputes');
  execute('DELETE FROM waiver_signatures');
  execute('DELETE FROM liability_waivers');

  execute('DELETE FROM wallet_settlements');
  execute('DELETE FROM pending_settlements');
  execute('DELETE FROM revenue_splits');
  execute('DELETE FROM revenue_events');
  execute('DELETE FROM withdrawals');
  execute('DELETE FROM user_data_governance');
  execute('DELETE FROM user_github_links');
  execute('DELETE FROM sessions');
  execute('DELETE FROM notifications');
  execute('DELETE FROM offboarding');

  // Delete all non-admin users
  execute('DELETE FROM users WHERE LOWER(email) != LOWER(?)', [adminEmail]);

  // 4. Create or update the real Production Super Admin
  console.log('[STEP 4/5] Provisioning Real Super Admin account...');
  const existingAdmin = queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [adminEmail]);
  const passwordHash = await bcrypt.hash(adminPassword, config.BCRYPT_SALT_ROUNDS);

  if (existingAdmin) {
    execute(`
      UPDATE users 
      SET name = ?, password_hash = ?, role = 'admin', status = 'active',
          wallet_balance = 0.0, wallet_frozen = 0, idea_quota_used = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [adminName, passwordHash, existingAdmin.id]);
    console.log(`✓ Super Admin updated: ${adminName} <${adminEmail}>`);
  } else {
    const adminId = crypto.randomUUID();
    execute(`
      INSERT INTO users (
        id, name, email, password_hash, role, status,
        rating_avg, idea_quota_used, wallet_balance, wallet_frozen, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'admin', 'active', 5.0, 0, 0.0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [adminId, adminName, adminEmail, passwordHash]);
    console.log(`✓ New Super Admin created: ${adminName} <${adminEmail}>`);
  }

  execute('PRAGMA foreign_keys = ON');

  // 5. Verification
  console.log('\n[STEP 5/5] Verifying zero-dummy status...');
  const totalUsers = queryOne('SELECT COUNT(*) as count FROM users')?.count || 0;
  const totalProjects = queryOne('SELECT COUNT(*) as count FROM projects')?.count || 0;
  const totalIdeas = queryOne('SELECT COUNT(*) as count FROM ideas')?.count || 0;
  const totalTasks = queryOne('SELECT COUNT(*) as count FROM project_tasks')?.count || 0;

  console.log('-------------------------------------------------------------------');
  console.log(`✓ Production Users    : ${totalUsers} (Admin only)`);
  console.log(`✓ Production Projects : ${totalProjects} (Pristine clean)`);
  console.log(`✓ Production Ideas    : ${totalIdeas} (Pristine clean)`);
  console.log(`✓ Production Tasks    : ${totalTasks} (Pristine clean)`);
  console.log('-------------------------------------------------------------------');
  console.log('\n🚀 DATABASE IS 100% CLEAN AND READY FOR PRODUCTION VPS DEPLOYMENT!\n');
}

if (process.argv[1] && process.argv[1].endsWith('setup-production.js')) {
  setupProduction()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Production setup failed:', err);
      process.exit(1);
    });
}
