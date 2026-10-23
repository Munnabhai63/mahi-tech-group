/**
 * CLEANUP TEST DATA SCRIPT — MAHI TECH GROUP
 * Purges ephemeral test accounts, ideas, and tasks generated during test suites,
 * restoring the database to the clean, official 10-15 person core team roster.
 */

import { queryAll, queryOne, execute } from '../src/db/database.js';
import { runSeed } from '../src/db/seed.js';

export function cleanupTestData(verbose = true) {
  if (verbose) console.log('===================================================================');
  if (verbose) console.log('   MAHI TECH GROUP — TEST DATA PURGE & CLEAN ROSTER RESTORATION');
  if (verbose) console.log('===================================================================\n');

  // 1. Identify Test Users (timestamped test emails)
  const allUsers = queryAll('SELECT id, email, name, role, status FROM users');
  const testUserIds = allUsers
    .filter(u => 
      u.email.includes('.tester.') ||
      u.email.includes('applicant.') ||
      u.email.includes('candidate.') ||
      u.email.includes('withdraw.user.') ||
      u.email.includes('.dev.17') ||
      u.email.includes('.s7.17') ||
      u.email.includes('owner.17') ||
      u.email.includes('step09.') ||
      u.email.includes('peer.dev.') ||
      u.email.includes('former.member.') ||
      u.email.includes('direct.member.') ||
      u.email.includes('valid.dev.') ||
      u.email.includes('aarav.wallet.') ||
      u.email.includes('active.frozen.') ||
      u.email.includes('elena.double.') ||
      u.email.includes('vikram.codev.')
    )
    .map(u => u.id);

  if (verbose) console.log(`[CLEANUP] Found ${testUserIds.length} ephemeral test accounts out of ${allUsers.length} total users.`);

  if (testUserIds.length > 0) {
    // Delete dependent tables for test users
    for (const uId of testUserIds) {
      execute('DELETE FROM project_members WHERE user_id = ?', [uId]);
      execute('DELETE FROM project_tasks WHERE assigned_to = ?', [uId]);
      execute('DELETE FROM idea_votes WHERE user_id = ?', [uId]);
      execute('DELETE FROM user_ratings WHERE rater_id = ? OR rated_user_id = ?', [uId, uId]);
      execute('DELETE FROM wallet_settlements WHERE user_id = ? OR settled_by = ?', [uId, uId]);
      execute('DELETE FROM pending_settlements WHERE user_id = ? OR settled_by = ?', [uId, uId]);
      execute('DELETE FROM sessions WHERE user_id = ?', [uId]);
      execute('DELETE FROM notifications WHERE user_id = ?', [uId]);
      execute('DELETE FROM offboarding_checklist WHERE user_id = ?', [uId]);
      execute('DELETE FROM offboarding_records WHERE user_id = ?', [uId]);

      // Delete ideas owned by test user
      const ownedIdeas = queryAll('SELECT id FROM ideas WHERE owner_id = ?', [uId]);
      for (const idea of ownedIdeas) {
        execute('DELETE FROM review_meetings WHERE idea_id = ?', [idea.id]);
        const ownedProjects = queryAll('SELECT id FROM projects WHERE idea_id = ?', [idea.id]);
        for (const proj of ownedProjects) {
          execute('DELETE FROM project_tasks WHERE project_id = ?', [proj.id]);
          execute('DELETE FROM project_members WHERE project_id = ?', [proj.id]);
          execute('DELETE FROM projects WHERE id = ?', [proj.id]);
        }
        execute('DELETE FROM idea_attachments WHERE idea_id = ?', [idea.id]);
        execute('DELETE FROM ideas WHERE id = ?', [idea.id]);
      }

      // Finally delete the test user
      execute('DELETE FROM users WHERE id = ?', [uId]);
    }
    if (verbose) console.log(`[CLEANUP] Successfully purged ${testUserIds.length} test accounts.`);
  }

  // 2. Ensure default core personas exist
  runSeed();

  const remainingUsers = queryAll('SELECT id, name, email, role, status FROM users ORDER BY role, name');
  if (verbose) {
    console.log(`\n[CLEANUP COMPLETE] Retained Official Team Roster (${remainingUsers.length} active/official members):`);
    remainingUsers.forEach(u => console.log(`   - [${u.role.toUpperCase()}] ${u.name} <${u.email}> (${u.status})`));
    console.log('\n✓ Dev database is clean, consistent, and ready for manual browser testing.\n');
  }

  return remainingUsers;
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('cleanup-test-data.js')) {
  cleanupTestData(true);
}
