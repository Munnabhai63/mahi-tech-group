// scripts/post-deploy-verify.js
const BASE_URL = 'https://oviaxe.com';

async function verify() {
  console.log(`=== POST-DEPLOY SMOKE CHECK: ${BASE_URL} ===\n`);

  // 1. GET /api/health
  console.log('1. Checking GET /api/health...');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = await healthRes.json();
  console.log(`HTTP ${healthRes.status}:`, JSON.stringify(healthData, null, 2));
  if (healthRes.status !== 200 || healthData.status !== 'ok') {
    throw new Error('Health check failed');
  }

  // 2. POST /api/auth/login (admin@oviaxe.com)
  console.log('\n2. Logging in as admin@oviaxe.com...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@oviaxe.com',
      password: 'Password@2026!'
    })
  });
  const loginData = await loginRes.json();
  console.log(`HTTP ${loginRes.status}:`, {
    user: loginData.user,
    tokenPreview: loginData.token ? `${loginData.token.substring(0, 30)}...` : null
  });
  if (loginRes.status !== 200 || !loginData.token) {
    throw new Error('Login check failed');
  }
  const token = loginData.token;

  // 3. GET /api/projects
  console.log('\n3. Checking GET /api/projects...');
  const projRes = await fetch(`${BASE_URL}/api/projects`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const projData = await projRes.json();
  console.log(`HTTP ${projRes.status}: Total projects found:`, projData.length || projData.projects?.length || (Array.isArray(projData) ? projData.length : 1));
  console.log('Sample project:', JSON.stringify(Array.isArray(projData) ? projData[0] : (projData.projects ? projData.projects[0] : projData), null, 2));

  // 4. GET /api/users/me
  console.log('\n4. Checking GET /api/users/me...');
  const meRes = await fetch(`${BASE_URL}/api/users/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const meData = await meRes.json();
  console.log(`HTTP ${meRes.status}:`, {
    id: meData.user?.id,
    name: meData.user?.name,
    email: meData.user?.email,
    role: meData.user?.role,
    status: meData.user?.status,
    permissionsCount: meData.permissions?.length
  });
  if (meRes.status !== 200 || meData.user?.role !== 'admin') {
    throw new Error('User profile role check failed');
  }

  console.log('\n=== ALL POST-DEPLOY SMOKE CHECKS PASSED PERFECTLY ===');
}

verify().catch(err => {
  console.error('Smoke check error:', err);
  process.exit(1);
});
