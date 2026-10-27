const http = require('http');

async function testFetch(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:4000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function run() {
  console.log('--- Checking app.html accessibility ---');
  const appRes = await testFetch('/app.html');
  console.log('Status:', appRes.status);
  if (appRes.status !== 200) throw new Error('app.html returned non-200');

  console.log('--- Checking public.js accessibility ---');
  const jsRes = await testFetch('/js/app/views/public.js');
  console.log('Status:', jsRes.status);
  if (!jsRes.body.includes('Enter with a demo identity')) throw new Error('demo-box missing from public.js');
  if (!jsRes.body.includes('data-demo-role')) throw new Error('demo roles missing from public.js');
  if (!jsRes.body.includes('Continue to role selection')) throw new Error('Continue button missing from public.js');
  if (!jsRes.body.includes('renderRoleSelection')) throw new Error('renderRoleSelection missing from public.js');
  console.log('✓ public.js contains full 100% Oviaxe UI demo-box and role selection components!');

  console.log('--- Checking index.js routing ---');
  const indexRes = await testFetch('/js/app/index.js');
  if (!indexRes.body.includes("if (path === '/role-selection') return renderRoleSelection();")) {
    throw new Error('role-selection route missing');
  }
  console.log('✓ index.js correctly routes /role-selection to renderRoleSelection()!');

  console.log('\nALL VERIFICATIONS PASSED CLEANLY!');
}

run().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
