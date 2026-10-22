import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';

const TEST_PORT = 4995;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runGapDemonstration() {
  console.log('\n===================================================================');
  console.log('       RUNNING GAP DEMONSTRATION TEST (USER QUESTION 3)');
  console.log('  Testing whether project reaches LIVE without completing Frontend/QA Prep');
  console.log('===================================================================\n');

  runMigration();
  await runSeed();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));

  try {
    // 1. Admin login
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
    });
    const adminData = await adminLoginRes.json();
    const adminToken = adminData.token;
    const adminUser = adminData.user;

    function getTokenForUser(userId) {
      if (!userId) return adminToken;
      const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) return adminToken;
      const sessionId = crypto.randomUUID();
      const token = jwt.sign({ sessionId, userId: user.id }, config.JWT_SECRET, { expiresIn: '1d' });
      execute(
        'INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
        [sessionId, user.id, token, new Date(Date.now() + 86400000).toISOString()]
      );
      return token;
    }

    // 2. Create fresh idea & approve to trigger fanout
    const researcher = queryOne("SELECT * FROM users WHERE role = 'researcher' AND status = 'active' LIMIT 1");
    execute('UPDATE users SET idea_quota_used = 0 WHERE id = ?', [researcher.id]);

    const draftRes = await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(researcher.id)}` },
      body: JSON.stringify({
        title: 'Gap Test Project - Incomplete Tracks',
        description: 'Demonstrating whether project reaches LIVE with incomplete frontend/testing tracks.'
      })
    });
    const draftData = await draftRes.json();
    const ideaId = draftData.idea.id;

    await fetch(`${BASE_URL}/api/ideas/${ideaId}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getTokenForUser(researcher.id)}` }
    });

    // Admin approves idea -> auto-triggers project fanout
    await fetch(`${BASE_URL}/api/admin/ideas/${ideaId}/override`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ decision: 'APPROVED', reason: 'Testing gap detection' })
    });

    const project = queryOne('SELECT * FROM projects WHERE idea_id = ?', [ideaId]);
    console.log(`Created Project: "${project.title}" (ID: ${project.id})`);

    let tasks = queryAll('SELECT id, task_name, task_type, status FROM project_tasks WHERE project_id = ?', [project.id]);
    console.log('\nInitial Task Statuses:');
    console.table(tasks);

    // 3. Complete ONLY the single chain: Deep Research -> Feature Logic Lock -> Full QA Testing -> Admin Final Review
    const researchTask = tasks.find(t => t.task_name === 'Deep Research');
    console.log(`\nCompleting ONLY: "${researchTask.task_name}"...`);
    await fetch(`${BASE_URL}/api/tasks/${researchTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'DONE' })
    });

    const logicLockTask = tasks.find(t => t.task_name === 'Feature Logic Lock');
    console.log(`Completing ONLY: "${logicLockTask.task_name}"...`);
    await fetch(`${BASE_URL}/api/tasks/${logicLockTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'DONE' })
    });

    const qaTask = tasks.find(t => t.task_name === 'Full QA Testing');
    console.log(`Completing ONLY: "${qaTask.task_name}"...`);
    await fetch(`${BASE_URL}/api/tasks/${qaTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'DONE' })
    });

    // 4. Admin Final Review
    console.log(`\nAdmin performing Final Review APPROVAL...`);
    const finalReviewRes = await fetch(`${BASE_URL}/api/admin/projects/${project.id}/final-review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ approved: true, notes: 'Attempting approval while 3 tasks are untouched' })
    });
    const finalReviewData = await finalReviewRes.json();

    const finalProject = queryOne('SELECT current_stage, status FROM projects WHERE id = ?', [project.id]);
    const finalTasks = queryAll('SELECT task_name, task_type, status FROM project_tasks WHERE project_id = ?', [project.id]);

    console.log(`\n--- GAP DEMONSTRATION RESULT ---`);
    console.log(`Project Final Stage: ${finalProject.current_stage}`);
    console.log(`Project Final Status: ${finalProject.status}`);
    console.log('\nFinal State of All 8 Tasks:');
    console.table(finalTasks);

    const untouched = finalTasks.filter(t => t.status !== 'DONE');
    console.log(`\nUntouched/Incomplete Tasks (${untouched.length}):`);
    console.table(untouched);

    if (finalProject.current_stage === 'LIVE' && untouched.length > 0) {
      console.log('\n❌ GAP CONFIRMED: The project reached LIVE stage even though 4 tasks were NEVER marked DONE!');
    } else {
      console.log('\n✅ NO GAP: The system prevented the project from reaching LIVE.');
    }

  } catch (err) {
    console.error('Error during gap test:', err);
  } finally {
    server.close();
  }
}

runGapDemonstration();
