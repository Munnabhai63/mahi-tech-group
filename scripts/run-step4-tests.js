import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { getAvailableMember, triggerProjectFanout } from '../src/services/fanoutService.js';
import { evaluateVotingDecision } from '../src/services/votingService.js';

const TEST_PORT = 4996;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runStep4Tests() {
  console.log('\n===================================================================');
  console.log('       RUNNING COMPREHENSIVE E2E VERIFICATION SUITE — STEP 04');
  console.log('           RULE #1: TRUE PARALLEL FAN-OUT VERIFICATION');
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
    // TEST 1: Admin Login & System Setup
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Admin Login & Initial Environment Verification ---');
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
    results.push({ test: 'Admin Login & Environment Setup', status: 'PASS' });

    // Helper to generate a valid session token for any user ID
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

    // Helper to create & login team members
    async function createAndLoginMember(name, email, role, subRole = null) {
      const password = 'Password@2026!';
      const normalizedEmail = email.toLowerCase().trim();
      let user = queryOne('SELECT id, name, email, role, sub_role FROM users WHERE email = ?', [normalizedEmail]);
      if (!user) {
        await fetch(`${BASE_URL}/api/admin/members/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify({ name, email: normalizedEmail, role, sub_role: subRole, temporary_password: password })
        });
        user = queryOne('SELECT id, name, email, role, sub_role FROM users WHERE email = ?', [normalizedEmail]);
      }
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password })
      });
      const loginData = await loginRes.json();
      return { user, token: loginData.token };
    }

    // Ensure we have active members across all roles
    console.log('\n--- Bootstrapping Dedicated Team Members Across Roles ---');
    const researchMember = await createAndLoginMember('Dr. Elena Vance', 'elena.researcher@mahitechgroup.com', 'researcher');
    const backendMember = await createAndLoginMember('Marcus Chen', 'marcus.backend@mahitechgroup.com', 'developer', 'backend');
    const frontendMember = await createAndLoginMember('Aria Stark', 'aria.frontend@mahitechgroup.com', 'developer', 'frontend');
    const designerMember = await createAndLoginMember('Diya Designer', 'diya.designer@mahitechgroup.com', 'designer');
    const producerMember = await createAndLoginMember('David Kim', 'david.producer@mahitechgroup.com', 'producer');
    console.log('Team bootstrap complete: Researcher, Backend Dev, Frontend Dev, Designer, Producer.');

    // -----------------------------------------------------------------
    // TEST 2: CRITICAL TEST — Simultaneous 9-Task Creation on Idea Approval
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: True Parallelism — Single DB Query Proving Simultaneous Fan-Out ---');
    // Create and submit a fresh idea
    const draftRes = await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${researchMember.token}` },
      body: JSON.stringify({
        title: 'Project Quantum Leap - AI Edge Node',
        description: 'Decentralized AI inference edge cluster for enterprise telemetry.',
        attachment_url: 'https://cdn.mahitechgroup.com/specs/quantum-v1.pdf'
      })
    });
    const draftData = await draftRes.json();
    const ideaId = draftData.idea.id;

    // Ensure quota is available for test run
    execute('UPDATE users SET idea_quota_used = 0 WHERE id = ?', [researchMember.user.id]);

    const submitRes = await fetch(`${BASE_URL}/api/ideas/${ideaId}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${researchMember.token}` }
    });
    const submitData = await submitRes.json();
    if (submitRes.status !== 200) {
      throw new Error(`Failed to submit idea: ${JSON.stringify(submitData)}`);
    }
    console.log(`Idea submitted: "${draftData.idea.title}" (ID: ${ideaId}, status: ${submitData.idea.status})`);

    // Admin approves the idea via override/veto endpoint to trigger fan-out
    const approveRes = await fetch(`${BASE_URL}/api/admin/ideas/${ideaId}/override`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'APPROVED',
        reason: 'Supermajority voting consensus achieved in formal review meeting'
      })
    });
    const approveData = await approveRes.json();
    console.log(`Idea status updated to: ${approveData.idea.status}`);

    // SINGLE DATABASE QUERY RUN IMMEDIATELY AFTER APPROVAL
    const project = queryOne('SELECT * FROM projects WHERE idea_id = ?', [ideaId]);
    if (!project) throw new Error('Project was not created automatically on idea approval!');

    const tasks = queryAll(`
      SELECT id, task_name, task_type, depends_on_task_id, status, created_at, completed_at
      FROM project_tasks
      WHERE project_id = ?
      ORDER BY task_type ASC, task_name ASC
    `, [project.id]);

    console.log(`\n[SINGLE DB QUERY RESULT] Tasks created for Project "${project.title}" (ID: ${project.id}):`);
    console.table(tasks.map(t => ({
      task_name: t.task_name,
      type: t.task_type,
      status: t.status,
      depends_on: t.depends_on_task_id ? 'YES (Child)' : 'NONE (Initial)',
      created_at: t.created_at
    })));

    // Verify all 9 tasks exist
    if (tasks.length !== 9) throw new Error(`Expected exactly 9 tasks, got ${tasks.length}`);

    // Verify root task (Deep Research) exists with status TODO
    const initialTasks = tasks.filter(t => t.depends_on_task_id === null);
    console.log(`\nInitial Tasks Count (zero dependency root): ${initialTasks.length}`);
    if (initialTasks.length !== 1 || initialTasks[0].task_name !== 'Deep Research') {
      throw new Error(`Expected Deep Research as initial root task, got: ${JSON.stringify(initialTasks)}`);
    }

    // Verify all 9 tasks have exact identical millisecond timestamp
    const firstTs = tasks[0].created_at;
    const sameTimestamp = tasks.every(t => t.created_at === firstTs);
    console.log(`All 9 tasks have exact identical millisecond timestamp (${firstTs}): ${sameTimestamp}`);
    if (!sameTimestamp) throw new Error('Tasks timestamps differ!');

    // Verify 4 parallel tasks unlocked by Deep Research exist with status BLOCKED
    const parallel4 = tasks.filter(t => [
      'Backend Architecture Setup',
      'Frontend UI Scaffolding',
      'UI/UX Design',
      'Test Plan Preparation'
    ].includes(t.task_name));
    console.log(`Parallel Tasks Count (unlocked by Deep Research): ${parallel4.length}`);
    if (parallel4.length !== 4) throw new Error(`Expected exactly 4 parallel tasks, got ${parallel4.length}`);

    const allParallelBlocked = parallel4.every(t => t.status === 'BLOCKED' && t.depends_on_task_id === initialTasks[0].id);
    console.log(`All 4 parallel tasks have status = 'BLOCKED' on Deep Research: ${allParallelBlocked}`);
    if (!allParallelBlocked) throw new Error('Not all parallel tasks are BLOCKED on Deep Research!');

    // Verify revenue_clock_start is set and stage is RESEARCH_DEV_PARALLEL
    console.log(`Project revenue_clock_start: ${project.revenue_clock_start}`);
    console.log(`Project current_stage: ${project.current_stage}`);
    if (!project.revenue_clock_start) throw new Error('revenue_clock_start was not initialized!');
    if (project.current_stage !== 'RESEARCH_DEV_PARALLEL') throw new Error(`Wrong initial stage: ${project.current_stage}`);

    results.push({ test: 'True Parallelism & Simultaneous Fan-Out', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 3: Structural Prevention of Sequential Fallback — Blocked Task Rejection
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Structural Prevention of Sequential Fallback (Blocked Task Blocked) ---');
    const fullQaTask = tasks.find(t => t.task_name === 'Full QA Testing');
    console.log(`Attempting to start BLOCKED task "${fullQaTask.task_name}" (depends on Feature Logic Lock)...`);

    const blockedUpdateRes = await fetch(`${BASE_URL}/api/tasks/${fullQaTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(fullQaTask.assigned_to)}` },
      body: JSON.stringify({ status: 'IN_PROGRESS' })
    });
    const blockedUpdateData = await blockedUpdateRes.json();
    console.log(`Blocked Task Update HTTP Status: ${blockedUpdateRes.status}`);
    console.log(`Blocked Task Update Response:`, JSON.stringify(blockedUpdateData));

    if (blockedUpdateRes.status !== 400 || !blockedUpdateData.error.includes('BLOCKED')) {
      throw new Error('API failed to reject starting a BLOCKED task!');
    }
    results.push({ test: 'Structural Prevention of Sequential Fallback', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 4: Simultaneous Unblock on Research & Parent Completion
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Simultaneous Unblock on Research & Parent Completion ---');
    // First, complete Deep Research to trigger simultaneous unblock of the 4 parallel tracks!
    const researchTask = tasks.find(t => t.task_name === 'Deep Research');
    const completeResearchRes = await fetch(`${BASE_URL}/api/tasks/${researchTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(researchTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    const completeResearchData = await completeResearchRes.json();
    console.log(`Deep Research completed. Unblocked tasks (${completeResearchData.unblockedTasks.length}):`, completeResearchData.unblockedTasks.map(t => t.task_name));
    if (completeResearchData.unblockedTasks.length !== 4) {
      throw new Error(`Expected 4 tasks unblocked on research completion, got ${completeResearchData.unblockedTasks.length}`);
    }

    const backendArchTask = tasks.find(t => t.task_name === 'Backend Architecture Setup');
    const apiIntegrationTask = tasks.find(t => t.task_name === 'Frontend API Integration');

    console.log(`Parent Task: "${backendArchTask.task_name}" (current status: ${backendArchTask.status}, assigned: ${backendArchTask.assigned_to})`);
    console.log(`Child Task: "${apiIntegrationTask.task_name}" (current status: ${apiIntegrationTask.status})`);

    // Backend developer marks "Backend Architecture Setup" DONE
    const completeParentRes = await fetch(`${BASE_URL}/api/tasks/${backendArchTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(backendArchTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    const completeParentData = await completeParentRes.json();
    console.log(`Parent task status updated to: ${completeParentData.task.status}`);
    console.log(`Unblocked tasks reported by API:`, completeParentData.unblockedTasks);

    // Direct database query on child task
    const childInDb = queryOne('SELECT id, task_name, status FROM project_tasks WHERE id = ?', [apiIntegrationTask.id]);
    console.log(`Database query of child task immediately after parent completion:`, childInDb);

    if (childInDb.status !== 'TODO') {
      throw new Error(`Child task did not auto-unblock! Status is ${childInDb.status}`);
    }
    console.log(`Verification confirmed: "${childInDb.task_name}" automatically flipped from BLOCKED to TODO!`);
    results.push({ test: 'Parent Completion Auto-Unblock Trigger', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 5: Workload-Based Auto-Assignment Logic with 3 Candidate Users
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Workload-Based Assignment Logic with 3 Candidates (Tiebreaker Rule) ---');
    // Create 3 candidate developers with distinct workloads and ratings
    const candA = await createAndLoginMember('Dev Alice (High Load)', 'alice.dev@mahitechgroup.com', 'developer');
    const candB = await createAndLoginMember('Dev Bob (Low Rating)', 'bob.dev@mahitechgroup.com', 'developer');
    const candC = await createAndLoginMember('Dev Charlie (High Rating)', 'charlie.dev@mahitechgroup.com', 'developer');

    // Set ratings:
    // Alice: rating 4.9, but 2 active tasks
    // Bob: rating 4.2, 1 active task
    // Charlie: rating 4.8, 1 active task
    execute("UPDATE users SET rating_avg = 4.9 WHERE id = ?", [candA.user.id]);
    execute("UPDATE users SET rating_avg = 4.2 WHERE id = ?", [candB.user.id]);
    execute("UPDATE users SET rating_avg = 4.8 WHERE id = ?", [candC.user.id]);

    // Clean up any tasks previously assigned to these candidates from earlier standalone runs (exclude active project)
    execute("UPDATE project_tasks SET depends_on_task_id = NULL WHERE depends_on_task_id IN (SELECT id FROM project_tasks WHERE assigned_to IN (?, ?, ?) AND project_id != ?)", [candA.user.id, candB.user.id, candC.user.id, project.id]);
    execute("DELETE FROM project_tasks WHERE assigned_to IN (?, ?, ?) AND project_id != ?", [candA.user.id, candB.user.id, candC.user.id, project.id]);

    // Create separate project for workload candidate evaluation so we do not pollute the main project tasks
    const workloadProjectId = crypto.randomUUID();
    execute("INSERT INTO projects (id, idea_id, org_id, title, owner_id) VALUES (?, ?, 'DEFAULT_ORG', 'Workload Test Project', ?)",
      [workloadProjectId, project.idea_id, adminUser.id]);

    // Give Alice 2 active tasks (fake assigned tasks in project_tasks)
    execute("INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status) VALUES (?, ?, ?, 'Alice Task 1', 'backend', 'IN_PROGRESS')",
      [crypto.randomUUID(), workloadProjectId, candA.user.id]);
    execute("INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status) VALUES (?, ?, ?, 'Alice Task 2', 'backend', 'TODO')",
      [crypto.randomUUID(), workloadProjectId, candA.user.id]);

    // Give Bob 1 active task
    execute("INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status) VALUES (?, ?, ?, 'Bob Task 1', 'backend', 'IN_PROGRESS')",
      [crypto.randomUUID(), workloadProjectId, candB.user.id]);

    // Give Charlie 1 active task
    execute("INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status) VALUES (?, ?, ?, 'Charlie Task 1', 'backend', 'IN_PROGRESS')",
      [crypto.randomUUID(), workloadProjectId, candC.user.id]);

    const candidates = [candA.user.id, candB.user.id, candC.user.id];
    const candidateStats = queryAll(`
      SELECT u.id, u.name, u.rating_avg,
             (SELECT COUNT(*) FROM project_tasks pt WHERE pt.assigned_to = u.id AND pt.status != 'DONE') as active_tasks
      FROM users u
      WHERE u.id IN (?, ?, ?)
      ORDER BY active_tasks ASC, u.rating_avg DESC
    `, candidates);

    console.log('Candidate Pool for Auto-Assignment:');
    console.table(candidateStats);

    // Call workload-based selection for developer
    // Since only these 3 are under evaluation, let's query getAvailableMember excluding other devs
    const otherDevs = queryAll("SELECT id FROM users WHERE role = 'developer' AND id NOT IN (?, ?, ?)", candidates);
    const excludeIds = otherDevs.map(d => d.id);
    const selected = getAvailableMember('developer', null, excludeIds);

    console.log(`Workload selector picked: ${selected.name} (Active Tasks: ${selected.active_tasks_count}, Rating: ${selected.rating_avg})`);

    // Expected winner: Charlie (1 active task vs Alice's 2; rating 4.8 beats Bob's 4.2)
    if (selected.id !== candC.user.id) {
      throw new Error(`Expected Charlie to be selected, but got ${selected.name}`);
    }
    console.log(`Tiebreaker verification PASS: Charlie (1 task, 4.8 rating) correctly won over Bob (1 task, 4.2 rating) and Alice (2 tasks, 4.9 rating).`);
    results.push({ test: 'Workload-Based Assignment & Tiebreaker Rule', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 6: Admin Manual Reassignment Override
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Admin Manual Reassignment Override ---');
    console.log(`Reassigning "Test Plan Preparation" to Dev Charlie via Admin endpoint...`);
    const testPlanTask = tasks.find(t => t.task_name === 'Test Plan Preparation');

    const reassignRes = await fetch(`${BASE_URL}/api/admin/projects/${project.id}/reassign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        taskId: testPlanTask.id,
        newUserId: candC.user.id
      })
    });
    const reassignData = await reassignRes.json();
    console.log(`Admin reassign response status: ${reassignRes.status}`);
    console.log(`Reassigned task details:`, reassignData.task);

    if (reassignRes.status !== 200 || reassignData.task.assigned_to !== candC.user.id) {
      throw new Error('Admin task reassignment failed!');
    }

    // Verify project_members table has Charlie added
    const memberCharlie = queryOne('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, candC.user.id]);
    console.log(`Verified Charlie in project_members:`, memberCharlie);
    if (!memberCharlie) throw new Error('Reassigned user was not added to project_members!');

    results.push({ test: 'Admin Manual Reassignment Override', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 7: Project owner_id Immutability Enforcement
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Project owner_id Strict Immutability Enforcement ---');
    console.log(`Current Project owner_id: ${project.owner_id}`);
    console.log(`Attempting to alter owner_id to Admin ID (${adminUser.id})...`);

    const tamperRes = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        owner_id: adminUser.id,
        title: 'Tampered Project Title'
      })
    });
    const tamperData = await tamperRes.json();
    console.log(`Tamper attempt response status: ${tamperRes.status}`);
    console.log(`Tamper attempt response body:`, JSON.stringify(tamperData));

    if (tamperRes.status !== 403 || !tamperData.error.includes('strictly immutable')) {
      throw new Error('API failed to protect owner_id immutability!');
    }

    const checkDbProject = queryOne('SELECT owner_id FROM projects WHERE id = ?', [project.id]);
    console.log(`Database verification: owner_id remains locked at: ${checkDbProject.owner_id}`);
    if (checkDbProject.owner_id !== project.owner_id) {
      throw new Error('owner_id was modified in database!');
    }
    results.push({ test: 'Project owner_id Strict Immutability', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 8: Full Stage Progression Through All Gates & All 9 Tasks Verification
    // -----------------------------------------------------------------
    console.log('\n--- TEST 8: Stage Progression State Machine Through All Gates (All 9 Tasks) ---');
    console.log(`Current Stage: ${queryOne('SELECT current_stage FROM projects WHERE id = ?', [project.id]).current_stage}`);

    // (Note: Deep Research and Backend Architecture Setup were completed in Test 4)
    // Complete "Feature Logic Lock"
    const logicLockTask = tasks.find(t => t.task_name === 'Feature Logic Lock');
    await fetch(`${BASE_URL}/api/tasks/${logicLockTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(logicLockTask.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    console.log('Completed "Feature Logic Lock".');

    // VERIFICATION: Full QA Testing CANNOT unblock or start while Frontend, Design, or Test Plan Prep are incomplete!
    const qaTaskCheck = queryOne('SELECT status FROM project_tasks WHERE id = ?', [fullQaTask.id]);
    console.log(`Checking "Full QA Testing" status while Frontend, Design & Test Plan are still incomplete: ${qaTaskCheck.status}`);
    if (qaTaskCheck.status !== 'BLOCKED') {
      throw new Error(`Expected Full QA Testing to remain BLOCKED, but found: ${qaTaskCheck.status}`);
    }

    // Attempting to start Full QA Testing must be rejected with HTTP 400
    const prematureQaRes = await fetch(`${BASE_URL}/api/tasks/${fullQaTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(fullQaTask.assigned_to)}` },
      body: JSON.stringify({ status: 'IN_PROGRESS' })
    });
    const prematureQaData = await prematureQaRes.json();
    console.log(`Premature QA start rejection status: ${prematureQaRes.status}`);
    console.log(`Premature QA start rejection response:`, prematureQaData.error);
    if (prematureQaRes.status !== 400 || !prematureQaData.error.includes('BLOCKED until all prerequisite')) {
      throw new Error('API failed to block premature QA start!');
    }

    // VERIFICATION: Admin Final Review approval CANNOT be granted while other tracks are incomplete!
    const prematureAdminRes = await fetch(`${BASE_URL}/api/admin/projects/${project.id}/final-review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ approved: true, notes: 'Premature approval attempt' })
    });
    const prematureAdminData = await prematureAdminRes.json();
    console.log(`Premature Admin approval rejection status: ${prematureAdminRes.status}`);
    console.log(`Premature Admin approval rejection response:`, prematureAdminData.error);
    if (prematureAdminRes.status !== 400 || !prematureAdminData.error.includes('all 8 preceding tasks')) {
      throw new Error('API failed to reject premature Admin launch approval!');
    }

    // Now complete the remaining parallel dev, design, and test preparation tasks:
    // 1. Complete "Frontend UI Scaffolding"
    const frontendScaffoldTask = tasks.find(t => t.task_name === 'Frontend UI Scaffolding');
    const freshScaffold = queryOne('SELECT assigned_to FROM project_tasks WHERE id = ?', [frontendScaffoldTask.id]);
    const resScaffold = await fetch(`${BASE_URL}/api/tasks/${frontendScaffoldTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshScaffold.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    if (resScaffold.status !== 200) {
      throw new Error(`Failed to complete Frontend UI Scaffolding: ${await resScaffold.text()}`);
    }
    console.log('Completed "Frontend UI Scaffolding".');

    // 2. Complete "Frontend API Integration"
    const freshApi = queryOne('SELECT assigned_to FROM project_tasks WHERE id = ?', [apiIntegrationTask.id]);
    const resApi = await fetch(`${BASE_URL}/api/tasks/${apiIntegrationTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshApi.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    if (resApi.status !== 200) {
      throw new Error(`Failed to complete Frontend API Integration: ${await resApi.text()}`);
    }
    console.log('Completed "Frontend API Integration".');

    // 3. Complete "UI/UX Design" (New 9th Track)
    const designTask = tasks.find(t => t.task_name === 'UI/UX Design');
    const freshDesign = queryOne('SELECT assigned_to FROM project_tasks WHERE id = ?', [designTask.id]);
    const resDesign = await fetch(`${BASE_URL}/api/tasks/${designTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshDesign.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    if (resDesign.status !== 200) {
      throw new Error(`Failed to complete UI/UX Design: ${await resDesign.text()}`);
    }
    console.log('Completed "UI/UX Design" (9th Parallel Track).');

    // 4. Complete "Test Plan Preparation" -> This completes all 7 foundational prerequisites!
    const freshTestPlan = queryOne('SELECT assigned_to FROM project_tasks WHERE id = ?', [testPlanTask.id]);
    const compTestPrepRes = await fetch(`${BASE_URL}/api/tasks/${testPlanTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshTestPlan.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    if (compTestPrepRes.status !== 200) {
      throw new Error(`Failed to complete Test Plan Preparation: ${await compTestPrepRes.text()}`);
    }
    const compTestPrepData = await compTestPrepRes.json();
    console.log('Completed "Test Plan Preparation".');
    console.log('Unblocked tasks after all 7 foundational dev/design/prep tasks complete:', compTestPrepData.unblockedTasks);
    console.log('Stage after all 7 foundational tasks complete:', compTestPrepData.currentStage);

    if (compTestPrepData.currentStage !== 'TESTING') {
      throw new Error(`Expected stage 'TESTING', got '${compTestPrepData.currentStage}'`);
    }

    // Now "Full QA Testing" is unblocked to TODO -> Complete it!
    const freshQa = queryOne('SELECT assigned_to FROM project_tasks WHERE id = ?', [fullQaTask.id]);
    const compQaRes = await fetch(`${BASE_URL}/api/tasks/${fullQaTask.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForUser(freshQa.assigned_to)}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    if (compQaRes.status !== 200) {
      throw new Error(`Failed to complete Full QA Testing: ${await compQaRes.text()}`);
    }
    const compQaData = await compQaRes.json();
    console.log('Completed "Full QA Testing".');
    console.log('Unblocked tasks after QA complete:', compQaData.unblockedTasks);
    console.log('Stage after QA complete:', compQaData.currentStage);

    if (compQaData.currentStage !== 'ADMIN_REVIEW') {
      throw new Error(`Expected stage 'ADMIN_REVIEW', got '${compQaData.currentStage}'`);
    }

    // Admin Final Launch Review Approval -> stage=LIVE, status=LIVE
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

    // Direct Database Query: Verify status of ALL 9 tasks at the moment LIVE is reached
    const allFinalTasks = queryAll('SELECT id, task_name, task_type, status, completed_at FROM project_tasks WHERE project_id = ? ORDER BY task_type ASC, task_name ASC', [project.id]);
    console.log('\n[COMPLETE DATABASE PROOF: ALL 9 TASKS AT LIVE STAGE]');
    console.table(allFinalTasks.map(t => ({
      task_name: t.task_name,
      type: t.task_type,
      status: t.status,
      completed_at: t.completed_at
    })));

    const allNineDone = allFinalTasks.every(t => t.status === 'DONE');
    console.log(`All 9 tasks across all roles are strictly DONE: ${allNineDone}`);
    if (!allNineDone || allFinalTasks.length !== 9) {
      throw new Error('Not all 9 tasks reached DONE status at LIVE stage!');
    }

    results.push({ test: 'Stage Progression & All 9 Tasks Gating (Parallel -> Integration -> Testing -> Admin Review -> Live)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 9: PRD Section 5 Endpoint Coverage Verification
    // -----------------------------------------------------------------
    console.log('\n--- TEST 9: Comprehensive API Endpoint Verification (PRD Section 5) ---');

    // 1. GET /api/projects/:id (project detail + members + tasks)
    const detailRes = await fetch(`${BASE_URL}/api/projects/${project.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const detailData = await detailRes.json();
    console.log(`GET /api/projects/:id returned: Project Title="${detailData.project.title}", Members=${detailData.members.length}, Tasks=${detailData.tasks.length}`);
    if (detailRes.status !== 200 || !detailData.project || detailData.members.length === 0 || detailData.tasks.length === 0) {
      throw new Error('GET /api/projects/:id failed!');
    }

    // 2. GET /api/projects/my-tasks
    const myTasksRes = await fetch(`${BASE_URL}/api/projects/my-tasks`, {
      headers: { 'Authorization': `Bearer ${frontendMember.token}` }
    });
    const myTasksData = await myTasksRes.json();
    console.log(`GET /api/projects/my-tasks for Frontend Dev: Task Count = ${myTasksData.taskCount}`);
    if (myTasksRes.status !== 200 || !Array.isArray(myTasksData.tasks)) {
      throw new Error('GET /api/projects/my-tasks failed!');
    }

    // 3. GET /api/admin/projects/all
    const adminAllRes = await fetch(`${BASE_URL}/api/admin/projects/all`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const adminAllData = await adminAllRes.json();
    console.log(`GET /api/admin/projects/all returned: Total Projects = ${adminAllData.count}`);
    if (adminAllRes.status !== 200 || !Array.isArray(adminAllData.projects)) {
      throw new Error('GET /api/admin/projects/all failed!');
    }

    // 4. POST /api/projects/auto-create (internal trigger endpoint directly)
    // Create another approved idea
    const draft2Res = await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${researchMember.token}` },
      body: JSON.stringify({
        title: 'Project CyberSentry - Zero Trust Mesh',
        description: 'Microsegmentation fabric for internal service accounts.'
      })
    });
    const draft2Data = await draft2Res.json();
    const idea2Id = draft2Data.idea.id;
    // Set to APPROVED manually in DB to test the internal /auto-create endpoint
    execute("UPDATE ideas SET status = 'APPROVED' WHERE id = ?", [idea2Id]);

    const autoCreateRes = await fetch(`${BASE_URL}/api/projects/auto-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ idea_id: idea2Id })
    });
    const autoCreateData = await autoCreateRes.json();
    console.log(`POST /api/projects/auto-create response status: ${autoCreateRes.status}, message: "${autoCreateData.message}"`);
    if (autoCreateRes.status !== 201 || !autoCreateData.project) {
      throw new Error('POST /api/projects/auto-create endpoint failed!');
    }

    // 5. PATCH /api/admin/projects/:id/final-review with approved: false (rejection test)
    const rejectReviewRes = await fetch(`${BASE_URL}/api/admin/projects/${autoCreateData.project.id}/final-review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        approved: false,
        notes: 'Security penetration test discovered unpatched socket vulnerability.'
      })
    });
    const rejectReviewData = await rejectReviewRes.json();
    console.log(`Admin rejection review stage: ${rejectReviewData.stage}`);
    if (rejectReviewData.stage !== 'REJECTED_AT_REVIEW') {
      throw new Error(`Expected 'REJECTED_AT_REVIEW', got '${rejectReviewData.stage}'`);
    }

    results.push({ test: 'API Endpoints (PRD Section 5) Verification', status: 'PASS' });

    console.log('\n===================================================================');
    console.log('       ALL STEP 04 VERIFICATION TESTS PASSED SUCCESSFULLY!        ');
    console.log('===================================================================\n');
    console.table(results);

  } catch (err) {
    console.error('\n❌ STEP 04 VERIFICATION FAILURE:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runStep4Tests();
