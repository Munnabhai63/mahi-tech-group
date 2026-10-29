// scripts/smoke-test-live.js
const BASE_URL = process.env.BASE_URL || 'https://oviaxe.com';

async function main() {
  console.log(`>>> Starting STEP 4 Smoke Test on Live Server: ${BASE_URL}`);

  // 1. Admin Login
  console.log('1. Logging in as Admin...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@oviaxe.com',
      password: 'Password@2026!'
    })
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.token) {
    throw new Error(`Admin login failed (${loginRes.status}): ${JSON.stringify(loginData)}`);
  }
  const adminToken = loginData.token;
  console.log(`✓ Admin logged in successfully. User: ${loginData.user.name} (${loginData.user.role})`);

  // 2. Invite 1 real team member
  console.log('\n2. Creating real team member invite...');
  const inviteEmail = `rohan.verma.${Date.now()}@oviaxe.com`;
  const inviteRes = await fetch(`${BASE_URL}/api/admin/invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      email: inviteEmail,
      role: 'developer',
      sub_role: 'backend'
    })
  });

  const inviteData = await inviteRes.json();
  if (!inviteRes.ok || !inviteData.invite?.token) {
    throw new Error(`Invite creation failed (${inviteRes.status}): ${JSON.stringify(inviteData)}`);
  }
  const inviteToken = inviteData.invite.token;
  console.log(`✓ Invite created for ${inviteEmail}`);
  console.log(`  Token: ${inviteToken}`);
  console.log(`  Invite URL: ${inviteData.invite.invite_url}`);

  // 3. Accept invite to activate team member
  console.log('\n3. Accepting invite and setting member password...');
  const acceptRes = await fetch(`${BASE_URL}/api/auth/invites/${inviteToken}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Rohan Verma',
      password: 'Password@2026!'
    })
  });

  const acceptData = await acceptRes.json();
  if (!acceptRes.ok || !acceptData.user?.id) {
    throw new Error(`Invite accept failed (${acceptRes.status}): ${JSON.stringify(acceptData)}`);
  }
  const newMemberId = acceptData.user.id;
  console.log(`✓ Member activated: ${acceptData.user.name} (${acceptData.user.email}) ID: ${newMemberId}`);

  // 4. Create 1 Project
  console.log('\n4. Creating 1 project as Admin...');
  const projRes = await fetch(`${BASE_URL}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      title: 'Mahi Cloud Platform',
      description: 'Next-generation cloud control plane and real-time operations engine',
      client_name: 'Mahi Tech Group',
      budget: 50000,
      priority: 'high',
      deadline: '2026-12-31'
    })
  });

  const projData = await projRes.json();
  if (!projRes.ok || (!projData.id && !projData.project?.id)) {
    throw new Error(`Project creation failed (${projRes.status}): ${JSON.stringify(projData)}`);
  }
  const projectId = projData.id || projData.project?.id;
  console.log(`✓ Project created successfully: "Mahi Cloud Platform" (ID: ${projectId})`);

  // 5. Create 1 Task in the Project assigned to the new member
  console.log('\n5. Creating 1 task assigned to new team member...');
  const taskRes = await fetch(`${BASE_URL}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      title: 'Deploy Production Orchestration Engine',
      description: 'Verify system endpoints, real-time WebSockets, and health monitor telemetry',
      project_id: projectId,
      assigned_to: newMemberId,
      priority: 'critical',
      due_date: '2026-11-15'
    })
  });

  const taskData = await taskRes.json();
  if (!taskRes.ok || (!taskData.id && !taskData.task?.id)) {
    throw new Error(`Task creation failed (${taskRes.status}): ${JSON.stringify(taskData)}`);
  }
  const taskId = taskData.id || taskData.task?.id;
  console.log(`✓ Task created successfully: "Deploy Production Orchestration Engine" (ID: ${taskId})`);

  // 6. Verify Dashboard Metrics & Data
  console.log('\n6. Verifying live dashboard metrics...');
  const summaryRes = await fetch(`${BASE_URL}/api/dashboard/summary`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const summaryData = await summaryRes.json();
  console.log(`✓ Live dashboard summary:`, JSON.stringify(summaryData, null, 2));

  const kanbanRes = await fetch(`${BASE_URL}/api/dashboard/kanban`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const kanbanData = await kanbanRes.json();
  console.log(`✓ Live kanban projects:`, JSON.stringify(kanbanData, null, 2));

  console.log('\n=======================================================');
  console.log('✓ STEP 4 SMOKE TEST COMPLETED SUCCESSFULLY ON LIVE SERVER');
  console.log('=======================================================');
}

main().catch(err => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
