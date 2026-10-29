const BASE_URL = 'https://oviaxe.com';

async function run() {
  console.log('=== RUNNING LIVE SMOKE CHECKS ON https://oviaxe.com ===\n');

  // 1. GET /api/health
  console.log('--- Check 1: GET /api/health ---');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthBody = await healthRes.json();
  console.log(`Status: ${healthRes.status}`);
  console.log('Response:', JSON.stringify(healthBody));

  // 2. POST /api/auth/login
  console.log('\n--- Check 2: POST /api/auth/login ---');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@oviaxe.com',
      password: 'Password@2026!'
    })
  });
  const loginBody = await loginRes.json();
  console.log(`Status: ${loginRes.status}`);
  console.log('Response token received:', !!loginBody.token, loginBody.token ? `${loginBody.token.slice(0, 25)}...` : 'None');
  console.log('User:', loginBody.user?.email, `Role: ${loginBody.user?.role}`);

  const token = loginBody.token;

  // 3. GET /api/sprints
  console.log('\n--- Check 3: GET /api/sprints (plural alias) ---');
  const sprintsRes = await fetch(`${BASE_URL}/api/sprints`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const sprintsBody = await sprintsRes.json();
  console.log(`Status: ${sprintsRes.status}`);
  console.log('Response item count/structure:', Array.isArray(sprintsBody) ? `${sprintsBody.length} items` : JSON.stringify(sprintsBody).slice(0, 100));

  // 4. GET /api/okrs
  console.log('\n--- Check 4: GET /api/okrs ---');
  const okrsRes = await fetch(`${BASE_URL}/api/okrs`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const okrsBody = await okrsRes.json();
  console.log(`Status: ${okrsRes.status}`);
  console.log('Response:', JSON.stringify(okrsBody).slice(0, 150));

  // 5. GET /api/clients
  console.log('\n--- Check 5: GET /api/clients ---');
  const clientsRes = await fetch(`${BASE_URL}/api/clients`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const clientsBody = await clientsRes.json();
  console.log(`Status: ${clientsRes.status}`);
  console.log('Response:', JSON.stringify(clientsBody).slice(0, 150));

  // 6. Create an invite token to test invite flow
  console.log('\n--- Generating invite token for invite flow test ---');
  const testInviteEmail = `verify.invite.${Date.now()}@oviaxe.com`;
  const inviteRes = await fetch(`${BASE_URL}/api/admin/invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      email: testInviteEmail,
      role: 'developer',
      sub_role: 'backend'
    })
  });
  const inviteBody = await inviteRes.json();
  console.log(`Invite creation status: ${inviteRes.status}`);
  console.log(`Invite token:`, inviteBody.invite?.token || inviteBody.token);
  console.log(`Invite URL:`, inviteBody.invite?.invite_url || `${BASE_URL}/#/invite/${inviteBody.token}`);
}

run().catch(err => {
  console.error('Smoke check error:', err);
  process.exit(1);
});
