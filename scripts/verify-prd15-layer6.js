/**
 * PRD 15 — Layer 6 Verification Suite: Integrations & Gating
 * 
 * Verifies:
 * INTEGRATION 1: Fanout -> Auto-Create First Deliverable
 *   - Project created via fanout has "Initial Project Deliverable" auto-created
 *   - current_stage = RESEARCH, status = ACTIVE
 *   - access_log recorded pipeline_auto_deliverable_created
 *   - Fanout failure safety (if deliverable creation fails, project remains created)
 * 
 * INTEGRATION 2: Pipeline Go-Live -> Project Final Review Gate
 *   - Project with active pipeline deliverables cannot pass final review (HTTP 400)
 *   - Deliverables moved to LIVE allow final review (HTTP 200)
 *   - Project with NO pipeline deliverables passes final review directly (HTTP 200)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { triggerProjectFanout } from '../src/services/fanoutService.js';
import * as pipelineService from '../src/services/pipelineService.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('  PRD 15 — LAYER 6 INTEGRATION & FINAL-REVIEW GATE VERIFICATION');
console.log('===================================================================');

runMigration();
await runSeed();

const app = createApp();
const server = http.createServer(app);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;

let passedCount = 0;
let totalCount = 0;

function assert(condition, message, actual = null) {
  totalCount++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${message} (Actual: ${JSON.stringify(actual)})`);
    server.close();
    process.exit(1);
  }
}

async function loginAdmin() {
  const pHash = await bcrypt.hash('AdminPassword@2026', config.BCRYPT_SALT_ROUNDS);
  execute('UPDATE users SET password_hash = ?, status = ? WHERE email = ?', [pHash, 'active', 'admin@mahitechgroup.com']);

  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
  });
  const data = await res.json();
  if (res.status !== 200 || !data.token) {
    throw new Error(`Admin login failed: ${JSON.stringify(data)}`);
  }
  return { token: data.token, user: data.user || queryOne("SELECT * FROM users WHERE email = 'admin@mahitechgroup.com'") };
}

try {
  const adminAuth = await loginAdmin();
  console.log(`Admin authenticated (${adminAuth.user.id}).`);

  // ===================================================================
  // INTEGRATION 1: Fanout -> Auto Deliverable
  // ===================================================================
  console.log('\n--- INTEGRATION 1: Fanout -> Auto-Create First Deliverable ---');

  // Create an approved idea to fan out
  const ideaId = crypto.randomUUID();
  execute(`
    INSERT INTO ideas (
      id, owner_id, title, description, status, green_percentage
    ) VALUES (
      ?, ?, 'AI Voice Studio Engine', 'Autonomous voiceover engine', 'APPROVED', 100.0
    )
  `, [ideaId, adminAuth.user.id]);

  // Trigger fanout via API
  const fanoutRes = await fetch(`${BASE_URL}/api/projects/auto-create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ idea_id: ideaId })
  });
  assert(fanoutRes.status === 201, 'POST /api/projects/auto-create returns 201');
  const fanoutData = await fanoutRes.json();
  const projectId = fanoutData.project.id;

  // 1. Verify project created in projects table
  const projInDb = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  assert(projInDb, 'Project exists in projects table', projInDb?.id);

  // 2. Verify pipeline_deliverables has exactly 1 record for this project with title "Initial Project Deliverable"
  const deliverables = queryAll('SELECT * FROM pipeline_deliverables WHERE project_id = ?', [projectId]);
  assert(deliverables.length === 1, 'pipeline_deliverables has exactly 1 record for project', deliverables.length);
  const firstDeliverable = deliverables[0];
  assert(firstDeliverable && firstDeliverable.title === 'Initial Project Deliverable', 'Deliverable title is "Initial Project Deliverable"', firstDeliverable?.title);

  // 3. Verify current_stage = RESEARCH
  assert(firstDeliverable && firstDeliverable.current_stage === 'RESEARCH', 'Deliverable current_stage is RESEARCH', firstDeliverable?.current_stage);

  // 4. Verify status = ACTIVE
  assert(firstDeliverable && firstDeliverable.status === 'ACTIVE', 'Deliverable status is ACTIVE', firstDeliverable?.status);

  // 5. Verify access_log has pipeline_auto_deliverable_created entry
  const autoLog = queryOne(`
    SELECT * FROM access_log
    WHERE action = 'pipeline_auto_deliverable_created' AND resource LIKE ?
    ORDER BY timestamp DESC LIMIT 1
  `, [`%${projectId}%`]);
  assert(autoLog, 'access_log has pipeline_auto_deliverable_created entry');
  console.log(`   📋 [AUDIT LOG]: user=${autoLog?.user_id} action=${autoLog?.action} resource="${autoLog?.resource}"`);

  // 6. Verify fanout failure safety: if deliverable creation throws, project still exists (no rollback)
  console.log('\n--- INTEGRATION 1: Failure Safety Test ---');
  const safetyIdeaId = crypto.randomUUID();
  execute(`
    INSERT INTO ideas (
      id, owner_id, title, description, status, green_percentage
    ) VALUES (
      ?, ?, 'Failure Safety Test Idea', 'Tests graceful error handling', 'APPROVED', 100.0
    )
  `, [safetyIdeaId, adminAuth.user.id]);

  // Temporarily install a trigger that causes INSERT on pipeline_deliverables to FAIL
  execute(`
    CREATE TRIGGER test_fail_deliverable BEFORE INSERT ON pipeline_deliverables
    BEGIN
      SELECT RAISE(FAIL, 'Simulated failure in pipeline deliverable creation');
    END;
  `);

  let safetyFanoutResult = null;
  try {
    safetyFanoutResult = triggerProjectFanout(safetyIdeaId, adminAuth.user.id);
  } finally {
    // Drop the trigger immediately
    execute('DROP TRIGGER IF EXISTS test_fail_deliverable');
  }

  assert(safetyFanoutResult && safetyFanoutResult.success === true, 'triggerProjectFanout returns success even when deliverable creation throws');
  const safetyProjInDb = queryOne('SELECT * FROM projects WHERE idea_id = ?', [safetyIdeaId]);
  assert(safetyProjInDb, 'Project still exists in DB despite deliverable creation error (no rollback)');
  const safetyTasksInDb = queryAll('SELECT * FROM project_tasks WHERE project_id = ?', [safetyProjInDb?.id]);
  assert(safetyTasksInDb.length === 9, 'All 9 project tasks still exist in DB', safetyTasksInDb.length);


  // ===================================================================
  // INTEGRATION 2: Pipeline Go-Live -> Project Final Review Gate
  // ===================================================================
  console.log('\n--- INTEGRATION 2: Pipeline Go-Live -> Project Final Review Gate ---');

  // Complete all 8 pre-review project tasks for projectId
  execute("UPDATE project_tasks SET status = 'DONE' WHERE project_id = ? AND task_type != 'review'", [projectId]);
  const tasksPending = queryAll("SELECT * FROM project_tasks WHERE project_id = ? AND task_type != 'review' AND status != 'DONE'", [projectId]);
  assert(tasksPending.length === 0, 'All 8 foundational tasks marked DONE');

  // Deliverable status is ACTIVE (not LIVE)
  // Attempt final-review approval
  const blockedReviewRes = await fetch(`${BASE_URL}/api/admin/projects/${projectId}/final-review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ approved: true, notes: 'Attempting premature launch with active pipeline' })
  });
  assert(blockedReviewRes.status === 400, 'Attempt final-review with active pipeline deliverable returns HTTP 400', blockedReviewRes.status);
  const blockedData = await blockedReviewRes.json();
  assert(
    blockedData.error === 'Pipeline deliverables must all reach LIVE status before final project review. Use Admin Pipeline Approval first.',
    'Returns exact pipeline gate error message',
    blockedData.error
  );
  console.log(`   📋 [BLOCKED GATE RESPONSE]: ${blockedData.error}`);

  // Now transition the deliverable through pipeline to COMPLETE and approve live
  // First, transition deliverable to COMPLETE
  execute("UPDATE pipeline_deliverables SET current_stage = 'COMPLETE', status = 'COMPLETE' WHERE id = ?", [firstDeliverable.id]);

  // Admin approves Go-Live via adminApproveLive API
  const approveLiveRes = await fetch(`${BASE_URL}/api/admin/projects/${projectId}/pipeline/approve-live`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ approval_notes: 'Pipeline tracks verified complete.' })
  });
  assert(approveLiveRes.status === 200, 'PATCH /api/admin/projects/:id/pipeline/approve-live returns 200', approveLiveRes.status);

  // Deliverable is now LIVE
  const updatedDeliv = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [firstDeliverable.id]);
  assert(updatedDeliv.status === 'LIVE', 'Deliverable status is now LIVE in DB');

  // Attempt PATCH /api/admin/projects/:id/final-review again
  const allowedReviewRes = await fetch(`${BASE_URL}/api/admin/projects/${projectId}/final-review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ approved: true, notes: 'Pipeline verified LIVE. Approving project launch.' })
  });
  assert(allowedReviewRes.status === 200, 'Attempt final-review after pipeline reaches LIVE returns HTTP 200', allowedReviewRes.status);
  const allowedData = await allowedReviewRes.json();
  assert(allowedData.stage === 'LIVE', 'Project current_stage successfully set to LIVE', allowedData.stage);
  assert(allowedData.project.status === 'LIVE', 'Project status successfully set to LIVE', allowedData.project.status);
  console.log(`   📋 [ALLOWED GATE RESPONSE]: stage=${allowedData.stage} status=${allowedData.project.status}`);

  // Test: Project with NO pipeline deliverables passes final review without gate
  console.log('\n--- INTEGRATION 2: Clean Project With No Pipeline Deliverables ---');
  const cleanIdeaId = crypto.randomUUID();
  execute(`
    INSERT INTO ideas (id, owner_id, title, description, status, green_percentage)
    VALUES (?, ?, 'Clean Idea', 'Clean idea desc', 'APPROVED', 100.0)
  `, [cleanIdeaId, adminAuth.user.id]);

  const cleanProjId = crypto.randomUUID();
  execute(`
    INSERT INTO projects (
      id, idea_id, org_id, title, owner_id, current_stage, status, created_at, updated_at
    ) VALUES (
      ?, ?, 'DEFAULT_ORG', 'Clean Project Without Pipeline', ?, 'ADMIN_REVIEW', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [cleanProjId, cleanIdeaId, adminAuth.user.id]);

  // Insert 8 DONE tasks + 1 review task in TODO
  const allPrereqTasks = [
    { name: 'Deep Research', type: 'research' },
    { name: 'Backend Architecture Setup', type: 'backend' },
    { name: 'Frontend UI Scaffolding', type: 'frontend' },
    { name: 'UI/UX Design', type: 'design' },
    { name: 'Test Plan Preparation', type: 'testing' },
    { name: 'Frontend API Integration', type: 'frontend' },
    { name: 'Feature Logic Lock', type: 'backend' },
    { name: 'Full QA Testing', type: 'testing' }
  ];
  for (const t of allPrereqTasks) {
    execute(`
      INSERT INTO project_tasks (id, project_id, task_name, task_type, status, created_at)
      VALUES (?, ?, ?, ?, 'DONE', CURRENT_TIMESTAMP)
    `, [crypto.randomUUID(), cleanProjId, t.name, t.type]);
  }
  execute(`
    INSERT INTO project_tasks (id, project_id, task_name, task_type, status, created_at)
    VALUES (?, ?, 'Admin Final Review', 'review', 'TODO', CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), cleanProjId]);

  // Attempt final review on clean project (no pipeline deliverables)
  const cleanReviewRes = await fetch(`${BASE_URL}/api/admin/projects/${cleanProjId}/final-review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ approved: true, notes: 'Direct review on project without pipeline deliverables' })
  });
  assert(cleanReviewRes.status === 200, 'Project without pipeline deliverables passes final review directly with HTTP 200');
  const cleanData = await cleanReviewRes.json();
  assert(cleanData.stage === 'LIVE', 'Clean project moves to LIVE stage');

  console.log('\n===================================================================');
  console.log(`  ALL LAYER 6 INTEGRATION & GATE CHECKS PASSED: ${passedCount} / ${totalCount}`);
  console.log('===================================================================');

} catch (err) {
  console.error('\n❌ VERIFICATION EXCEPTION:', err);
  process.exit(1);
} finally {
  try {
    const adminHash = await bcrypt.hash('AdminPassword@2026', config.BCRYPT_SALT_ROUNDS);
    execute('UPDATE users SET password_hash = ?, status = ? WHERE email = ?', [adminHash, 'active', 'admin@mahitechgroup.com']);
  } catch (e) {}
  server.close();
  process.exit(0);
}
