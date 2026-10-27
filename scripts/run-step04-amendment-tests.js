import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { DEV_AND_TEST_PREP_PREREQUISITES } from '../src/services/fanoutService.js';

const TEST_PORT = 4995;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runStep04AmendmentTests() {
  console.log('\n===================================================================');
  console.log('   STEP 04 AMENDMENT: UI/UX DESIGN AS 9TH PARALLEL TRACK VERIFICATION');
  console.log('   HONESTY PROTOCOL 00-4 & REVERSE-ENGINEERING PROTOCOL 00-2');
  console.log('===================================================================\n');

  // 1. Setup DB
  runMigration();
  await runSeed();

  // 2. Start Test Server
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`[TEST SERVER] Running on ${BASE_URL}\n`);

  const results = [];

  try {
    // -----------------------------------------------------------------
    // TEST 1: Admin Authentication & Token Helper
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Admin Authentication & System Verification ---');
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
    });
    const adminLoginData = await adminLoginRes.json();
    if (adminLoginRes.status !== 200) throw new Error('Admin login failed');
    const adminToken = adminLoginData.token;
    const adminUser = adminLoginData.user;
    console.log(`Admin authenticated: ${adminUser.email} (${adminUser.id})`);

    function getTokenForUser(userId) {
      if (!userId) return adminToken;
      const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
      if (!user) return adminToken;

      const sessionId = crypto.randomUUID();
      const token = jwt.sign({ sessionId, userId: user.id }, config.JWT_SECRET, { expiresIn: '1d' });
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      execute(
        'INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
        [sessionId, user.id, token, expiresAt]
      );
      return token;
    }

    async function createAndLoginMember(name, email, role, subRole = null) {
      const password = 'Password@2026!';
      const normalizedEmail = email.toLowerCase().trim();
      let user = queryOne('SELECT id, name, email, role, sub_role FROM users WHERE email = ?', [normalizedEmail]);
      if (!user) {
        const addRes = await fetch(`${BASE_URL}/api/admin/members/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify({ name, email: normalizedEmail, role, sub_role: subRole, temporary_password: password })
        });
        if (addRes.status !== 201) {
          throw new Error(`Failed to add member ${email}: ${await addRes.text()}`);
        }
        user = queryOne('SELECT id, name, email, role, sub_role FROM users WHERE email = ?', [normalizedEmail]);
      } else {
        const hash = await bcrypt.hash(password, 10);
        execute("UPDATE users SET password_hash = ?, status = 'active' WHERE id = ?", [hash, user.id]);
      }
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password })
      });
      const loginData = await loginRes.json();
      const token = loginData.token || getTokenForUser(user.id);
      return { user, token };
    }

    // -----------------------------------------------------------------
    // TEST 2: Schema CHECK Constraint & Designer Role Verification
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Role "designer" in users.role & project_members CHECK Constraint ---');
    const designerMember = await createAndLoginMember('Diya Designer', 'diya.designer@mahitechgroup.com', 'designer');
    console.log(`Designer created & logged in: ${designerMember.user.name} (${designerMember.user.email}, role: ${designerMember.user.role})`);
    
    // Verify attempt to insert an invalid role fails CHECK constraint
    let invalidRoleRejected = false;
    try {
      execute("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, 'Fake', 'fake@test.com', 'hash', 'invalid_role')", [crypto.randomUUID()]);
    } catch (e) {
      invalidRoleRejected = true;
      console.log(`DB CHECK constraint rejected invalid role: ${e.message}`);
    }
    if (!invalidRoleRejected) throw new Error('DB accepted invalid role! CHECK constraint failed.');
    results.push({ test: 'Designer Role in CHECK Constraint', status: 'PASS' });

    // Bootstrap team members across all 5 active operational roles
    const researchMember = await createAndLoginMember('Dr. Elena Vance', 'elena.researcher@mahitechgroup.com', 'researcher');
    const backendMember = await createAndLoginMember('Marcus Chen', 'marcus.backend@mahitechgroup.com', 'developer', 'backend');
    const frontendMember = await createAndLoginMember('Aria Stark', 'aria.frontend@mahitechgroup.com', 'developer', 'frontend');
    const producerMember = await createAndLoginMember('David Kim', 'david.producer@mahitechgroup.com', 'producer');

    // -----------------------------------------------------------------
    // TEST 3: Parallel Fanout Creation with 9 Tasks (Including UI/UX Design)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Parallel Fanout with 9 Tasks on Idea Approval ---');
    execute('UPDATE users SET idea_quota_used = 0 WHERE id = ?', [researchMember.user.id]);
    
    const draftRes = await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${researchMember.token}` },
      body: JSON.stringify({
        title: 'Project Apex - Autonomous Fleet Telemetry',
        description: 'Edge computing mesh for automotive sensor fusion and real-time inference.',
        attachment_url: 'https://cdn.mahitechgroup.com/specs/apex-v1.pdf'
      })
    });
    const draftData = await draftRes.json();
    const ideaId = draftData.idea.id;

    await fetch(`${BASE_URL}/api/ideas/${ideaId}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${researchMember.token}` }
    });

    // Admin approves the idea -> Triggers triggerProjectFanout
    const approveRes = await fetch(`${BASE_URL}/api/admin/ideas/${ideaId}/override`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'APPROVED',
        reason: 'Supermajority voting consensus achieved in formal review meeting'
      })
    });
    const approveData = await approveRes.json();
    console.log(`Idea "${draftData.idea.title}" approved: ${approveData.idea.status}`);

    const project = queryOne('SELECT * FROM projects WHERE idea_id = ?', [ideaId]);
    if (!project) throw new Error('Project was not created automatically on idea approval!');

    const tasks = queryAll(`
      SELECT pt.id, pt.task_name, pt.task_type, pt.depends_on_task_id, pt.status, pt.assigned_to, u.name as assigned_name, u.role as assigned_role, pt.created_at
      FROM project_tasks pt
      LEFT JOIN users u ON pt.assigned_to = u.id
      WHERE pt.project_id = ?
      ORDER BY pt.created_at ASC, pt.id ASC
    `, [project.id]);

    console.log(`\n[SINGLE DB QUERY] Total Tasks Created: ${tasks.length}`);
    console.table(tasks.map(t => ({
      name: t.task_name,
      type: t.task_type,
      status: t.status,
      assigned_to: `${t.assigned_name} (${t.assigned_role})`,
      depends_on: t.depends_on_task_id ? 'YES' : 'NONE'
    })));

    if (tasks.length !== 9) {
      throw new Error(`Expected exactly 9 tasks, got ${tasks.length}`);
    }

    // Verify "UI/UX Design" exists and is assigned to designer
    const designTask = tasks.find(t => t.task_name === 'UI/UX Design');
    if (!designTask) throw new Error('UI/UX Design task missing from project tasks!');
    if (designTask.task_type !== 'design') throw new Error(`UI/UX Design has wrong task_type: ${designTask.task_type}`);
    if (designTask.assigned_role !== 'designer') throw new Error(`UI/UX Design assigned to wrong role: ${designTask.assigned_role}`);
    console.log(`"UI/UX Design" task verified: type="${designTask.task_type}", assigned="${designTask.assigned_name}" (${designTask.assigned_role})`);

    // Verify initial states:
    // Deep Research is TODO (root)
    const researchTask = tasks.find(t => t.task_name === 'Deep Research');
    if (researchTask.status !== 'TODO') throw new Error(`Deep Research expected TODO, got ${researchTask.status}`);

    // The 4 parallel tasks unlocked by Deep Research are BLOCKED
    const parallel4 = tasks.filter(t => [
      'Backend Architecture Setup',
      'Frontend UI Scaffolding',
      'UI/UX Design',
      'Test Plan Preparation'
    ].includes(t.task_name));

    if (parallel4.length !== 4) throw new Error(`Expected 4 parallel tasks on research, got ${parallel4.length}`);
    const all4BlockedInitially = parallel4.every(t => t.status === 'BLOCKED' && t.depends_on_task_id === researchTask.id);
    if (!all4BlockedInitially) throw new Error('All 4 parallel tasks must be BLOCKED on Deep Research initially!');
    console.log(`All 4 parallel tasks initialized as BLOCKED on Deep Research: PASS`);

    results.push({ test: '9-Task Fanout Creation & Role Assignment', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 4: UNLOCK TIMING — SIMULTANEOUS 4-TASK UNLOCK ON RESEARCH COMPLETE
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: CRITICAL UNLOCK TIMING: Simultaneous 4-Task Unlock on Deep Research Complete ---');
    console.log(`Deep Research Task ID: ${researchTask.id} (Status: ${researchTask.status})`);
    console.log(`Marking "Deep Research" as DONE...`);

    const completeResearchRes = await fetch(`${BASE_URL}/api/tasks/${researchTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(researchTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    const completeResearchData = await completeResearchRes.json();
    console.log(`API Response Status: ${completeResearchRes.status}`);
    console.log(`Reported Unblocked Tasks count: ${completeResearchData.unblockedTasks.length}`);

    // Query DB immediately to inspect the 4 tasks
    const dbTasksAfterResearch = queryAll(`
      SELECT id, task_name, task_type, status, completed_at, created_at
      FROM project_tasks
      WHERE project_id = ? AND task_name IN (
        'Backend Architecture Setup',
        'Frontend UI Scaffolding',
        'UI/UX Design',
        'Test Plan Preparation'
      )
    `, [project.id]);

    console.log('\n[DATABASE PROOF: ALL 4 TASKS IMMEDIATELY AFTER RESEARCH COMPLETION]');
    console.table(dbTasksAfterResearch);

    const all4Unblocked = dbTasksAfterResearch.every(t => t.status === 'TODO');
    if (!all4Unblocked) {
      throw new Error(`Not all 4 parallel tasks unblocked to TODO! Current states: ${JSON.stringify(dbTasksAfterResearch)}`);
    }

    const unblockedNames = completeResearchData.unblockedTasks.map(t => t.task_name).sort();
    const expectedUnblocked = [
      'Backend Architecture Setup',
      'Frontend UI Scaffolding',
      'Test Plan Preparation',
      'UI/UX Design'
    ].sort();

    if (JSON.stringify(unblockedNames) !== JSON.stringify(expectedUnblocked)) {
      throw new Error(`Unblocked tasks mismatch: expected ${expectedUnblocked.join(', ')}, got ${unblockedNames.join(', ')}`);
    }

    console.log(`Simultaneity Evidence: All 4 tasks ("Backend Architecture Setup", "Frontend UI Scaffolding", "UI/UX Design", "Test Plan Preparation") flipped from BLOCKED to TODO in the EXACT SAME single transaction/call!`);
    results.push({ test: 'Simultaneous 4-Task Parallel Unlock', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 5: TRUE INDEPENDENCE — DESIGN DOES NOT BLOCK FRONTEND & VICE VERSA
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: True Parallelism — Designer Completes UI/UX Design with ZERO Cross-Blocking ---');
    const freshDesignTask = queryOne('SELECT * FROM project_tasks WHERE project_id = ? AND task_name = ?', [project.id, 'UI/UX Design']);
    const freshFrontendTask = queryOne('SELECT * FROM project_tasks WHERE project_id = ? AND task_name = ?', [project.id, 'Frontend UI Scaffolding']);
    const freshBackendTask = queryOne('SELECT * FROM project_tasks WHERE project_id = ? AND task_name = ?', [project.id, 'Backend Architecture Setup']);

    console.log(`Before: Designer Task "${freshDesignTask.task_name}" status: ${freshDesignTask.status}`);
    console.log(`Before: Developer Task "${freshFrontendTask.task_name}" status: ${freshFrontendTask.status}`);

    // Developer starts and completes Frontend UI Scaffolding WHILE UI/UX Design is still in TODO
    console.log(`Testing Developer ability to complete "Frontend UI Scaffolding" WITHOUT waiting for "UI/UX Design"...`);
    const devStartScaffoldRes = await fetch(`${BASE_URL}/api/tasks/${freshFrontendTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshFrontendTask.assigned_to)}` },
      body: JSON.stringify({ status: 'IN_PROGRESS' })
    });
    if (devStartScaffoldRes.status !== 200) {
      throw new Error(`Frontend UI Scaffolding was blocked by UI/UX Design! HTTP ${devStartScaffoldRes.status}: ${await devStartScaffoldRes.text()}`);
    }

    const devCompleteScaffoldRes = await fetch(`${BASE_URL}/api/tasks/${freshFrontendTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshFrontendTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    if (devCompleteScaffoldRes.status !== 200) {
      throw new Error(`Developer could not mark Frontend UI Scaffolding as DONE! HTTP ${devCompleteScaffoldRes.status}`);
    }
    console.log(`Confirmed: Developer marked "Frontend UI Scaffolding" as DONE with ZERO dependency on "UI/UX Design"!`);

    // Now Designer starts and completes UI/UX Design independently
    console.log(`Testing Designer ability to complete "UI/UX Design" independently...`);
    const designerStartRes = await fetch(`${BASE_URL}/api/tasks/${freshDesignTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshDesignTask.assigned_to)}` },
      body: JSON.stringify({ status: 'IN_PROGRESS' })
    });
    if (designerStartRes.status !== 200) {
      throw new Error(`Designer could not start UI/UX Design! HTTP ${designerStartRes.status}`);
    }

    const designerCompleteRes = await fetch(`${BASE_URL}/api/tasks/${freshDesignTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshDesignTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    if (designerCompleteRes.status !== 200) {
      throw new Error(`Designer could not mark UI/UX Design as DONE! HTTP ${designerCompleteRes.status}`);
    }
    console.log(`Confirmed: Designer marked "UI/UX Design" as DONE independently with ZERO cross-blocking!`);

    results.push({ test: 'Non-Blocking True Parallel Execution', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 6: Multi-Track Gating: Full QA Testing Blocked Until ALL 7 Foundational Tasks Done
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Multi-Track Gating: Full QA Testing Gate Enforcement ---');
    const fullQaTask = queryOne('SELECT * FROM project_tasks WHERE project_id = ? AND task_name = ?', [project.id, 'Full QA Testing']);
    console.log(`Initial "Full QA Testing" status: ${fullQaTask.status}`);

    // Backend dev completes "Backend Architecture Setup" -> unblocks "Frontend API Integration" and "Feature Logic Lock"
    const compBackendRes = await fetch(`${BASE_URL}/api/tasks/${freshBackendTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshBackendTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    console.log(`Backend Architecture Setup completed. Unblocked tasks:`, (await compBackendRes.json()).unblockedTasks.map(t => t.task_name));

    // Complete "Frontend API Integration" and "Feature Logic Lock"
    const apiTask = queryOne('SELECT * FROM project_tasks WHERE project_id = ? AND task_name = ?', [project.id, 'Frontend API Integration']);
    const logicTask = queryOne('SELECT * FROM project_tasks WHERE project_id = ? AND task_name = ?', [project.id, 'Feature Logic Lock']);
    const testPrepTask = queryOne('SELECT * FROM project_tasks WHERE project_id = ? AND task_name = ?', [project.id, 'Test Plan Preparation']);

    await fetch(`${BASE_URL}/api/tasks/${apiTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(apiTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    await fetch(`${BASE_URL}/api/tasks/${logicTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(logicTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });

    // Notice: "Test Plan Preparation" is STILL NOT DONE (in TODO)
    // Full QA Testing MUST remain BLOCKED!
    const qaBeforeTestPrep = queryOne('SELECT status FROM project_tasks WHERE id = ?', [fullQaTask.id]);
    console.log(`Full QA Testing status while Test Plan Prep is incomplete: ${qaBeforeTestPrep.status}`);
    if (qaBeforeTestPrep.status !== 'BLOCKED') {
      throw new Error(`Full QA Testing should be BLOCKED, but was: ${qaBeforeTestPrep.status}`);
    }

    // Attempting to start Full QA Testing prematurely must return 400
    const prematureQaRes = await fetch(`${BASE_URL}/api/tasks/${fullQaTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(fullQaTask.assigned_to)}` },
      body: JSON.stringify({ status: 'IN_PROGRESS' })
    });
    const prematureQaData = await prematureQaRes.json();
    console.log(`Premature QA start HTTP ${prematureQaRes.status}: "${prematureQaData.error}"`);
    if (prematureQaRes.status !== 400 || !prematureQaData.error.includes('BLOCKED until all prerequisite')) {
      throw new Error('API failed to reject premature QA start!');
    }

    // Now complete "Test Plan Preparation" -> All 7 foundational tasks are now DONE!
    const compTestPrepRes = await fetch(`${BASE_URL}/api/tasks/${testPrepTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(testPrepTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    const compTestPrepData = await compTestPrepRes.json();
    console.log(`Completed "Test Plan Preparation". Unblocked tasks:`, compTestPrepData.unblockedTasks.map(t => t.task_name));
    console.log(`Stage after all 7 foundational tasks complete: ${compTestPrepData.currentStage}`);

    const qaAfterTestPrep = queryOne('SELECT status FROM project_tasks WHERE id = ?', [fullQaTask.id]);
    console.log(`Full QA Testing status after all 7 tasks complete: ${qaAfterTestPrep.status}`);
    if (qaAfterTestPrep.status !== 'TODO') {
      throw new Error(`Full QA Testing should be TODO, but is: ${qaAfterTestPrep.status}`);
    }

    results.push({ test: 'All 7 Foundational Tasks Gating QA Testing', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 7: Full Stage Progression to LIVE with All 8 Non-Review Tasks Verified
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Admin Final Review & Full 9-Task LIVE Launch Gate ---');

    // Attempt premature Admin launch approval before QA Testing is DONE -> Must fail 400
    const prematureAdminRes = await fetch(`${BASE_URL}/api/admin/projects/${project.id}/final-review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ approved: true, notes: 'Premature approval before QA' })
    });
    const prematureAdminData = await prematureAdminRes.json();
    console.log(`Premature Admin Approval HTTP ${prematureAdminRes.status}: "${prematureAdminData.error}"`);
    if (prematureAdminRes.status !== 400 || !prematureAdminData.error.includes('all 8 preceding tasks')) {
      throw new Error('API failed to reject premature Admin launch approval before QA!');
    }

    // Producer completes "Full QA Testing"
    const compQaRes = await fetch(`${BASE_URL}/api/tasks/${fullQaTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(fullQaTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    const compQaData = await compQaRes.json();
    console.log(`Full QA Testing marked DONE. Current stage: ${compQaData.currentStage}`);
    if (compQaData.currentStage !== 'ADMIN_REVIEW') {
      throw new Error(`Expected stage 'ADMIN_REVIEW', got '${compQaData.currentStage}'`);
    }

    // Admin approves launch review
    const finalReviewRes = await fetch(`${BASE_URL}/api/admin/projects/${project.id}/final-review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        approved: true,
        notes: 'All 8 multi-disciplinary tasks (including UI/UX Design) complete. QA verified green. Production release approved.'
      })
    });
    const finalReviewData = await finalReviewRes.json();
    console.log(`Admin Final Review Status: ${finalReviewRes.status}`);
    console.log(`Stage after Admin Final Review approval: ${finalReviewData.stage}`);
    console.log(`Project status: ${finalReviewData.project.status}`);

    if (finalReviewData.stage !== 'LIVE' || finalReviewData.project.status !== 'LIVE') {
      throw new Error(`Expected stage and status 'LIVE', got stage: ${finalReviewData.stage}, status: ${finalReviewData.project.status}`);
    }

    // SINGLE DATABASE QUERY PROVING ALL 9 TASKS ARE AT STATUS 'DONE'
    const allFinalTasks = queryAll(`
      SELECT pt.id, pt.task_name, pt.task_type, pt.status, pt.completed_at, u.name as assigned_name, u.role as assigned_role
      FROM project_tasks pt
      LEFT JOIN users u ON pt.assigned_to = u.id
      WHERE pt.project_id = ?
      ORDER BY pt.task_type ASC, pt.task_name ASC
    `, [project.id]);

    console.log('\n[FINAL DATABASE EVIDENCE: ALL 9 TASKS IN LIVE PROJECT]');
    console.table(allFinalTasks.map(t => ({
      task_name: t.task_name,
      type: t.task_type,
      assigned: `${t.assigned_name} (${t.assigned_role})`,
      status: t.status,
      completed_at: t.completed_at
    })));

    const allNineDone = allFinalTasks.every(t => t.status === 'DONE');
    if (!allNineDone || allFinalTasks.length !== 9) {
      throw new Error(`Not all 9 tasks are DONE! Done count: ${allFinalTasks.filter(t => t.status === 'DONE').length}/9`);
    }
    console.log(`Verification confirmed: All 9 tasks across Researcher, Backend Dev, Frontend Dev, Designer, Producer, and Admin are 100% DONE!`);

    results.push({ test: 'Full 9-Task LIVE Launch Gate Enforcement', status: 'PASS' });

    console.log('\n===================================================================');
    console.log('   ALL STEP 04 AMENDMENT VERIFICATION TESTS PASSED SUCCESSFULLY!   ');
    console.log('===================================================================\n');
    console.table(results);

  } catch (err) {
    console.error('\n❌ STEP 04 AMENDMENT FAILURE:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runStep04AmendmentTests();
