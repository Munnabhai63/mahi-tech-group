const { chromium } = require('playwright-core');

async function test401Flow() {
  console.log('Launching browser to test 401 -> Refresh -> Clean Redirect flow...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const networkLog = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/api/')) {
      networkLog.push({ method: req.method(), url, time: Date.now() });
      console.log(`[HTTP REQ] ${req.method()} ${url}`);
    }
  });

  page.on('response', resp => {
    const url = resp.url();
    if (url.includes('/api/')) {
      console.log(`[HTTP RESP] ${resp.status()} ${url}`);
    }
  });

  page.on('console', msg => {
    console.log(`[BROWSER CONSOLE ${msg.type()}]`, msg.text());
  });

  // 1. First navigate to app to allow localStorage access
  await page.goto('http://localhost:4000/app.html#/login', { waitUntil: 'networkidle' });

  // 2. Inject an invalid / expired JWT token into localStorage
  await page.evaluate(() => {
    // Malformed/expired JWT
    const expiredJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIwN2Q4MjQyMC0wMjA3LTQ5MmEtOWRjMS1lNThhZjNiNGRhMzYiLCJyb2xlIjoicmVzZWFyY2hlciIsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjoxNjAwMDAwMTAwfQ.invalidSignatureSample';
    localStorage.setItem('mtg_auth_token', expiredJwt);
    localStorage.setItem('mtg-frontend-session-v1', JSON.stringify({
      userId: '07d82420-0207-492a-9dc1-e58af3b4da36',
      role: 'researcher',
      token: expiredJwt,
      user: { id: '07d82420-0207-492a-9dc1-e58af3b4da36', name: 'Dr. Priya Patel', email: 'researcher@mahitechgroup.com', role: 'researcher' }
    }));
  });

  // Clear network log before navigating to protected page
  networkLog.length = 0;

  console.log('\n--- NAVIGATING TO PROTECTED ROUTE: #/app/dashboard WITH INVALID TOKEN ---');
  await page.goto('http://localhost:4000/app.html#/app/dashboard');
  await page.reload({ waitUntil: 'networkidle' });

  // Wait for network activity to settle
  await page.waitForTimeout(4000);

  const finalUrl = page.url();
  console.log('\n--- FINAL RESULT ---');
  console.log('Final Page URL:', finalUrl);

  const refreshCalls = networkLog.filter(req => req.url.includes('/api/auth/refresh'));
  console.log('Total /api/auth/refresh calls made:', refreshCalls.length);

  const tokenAfter = await page.evaluate(() => localStorage.getItem('mtg_auth_token'));
  console.log('localStorage token after flow:', tokenAfter);

  await browser.close();

  const passSingleRefresh = refreshCalls.length === 1;
  const passRedirect = finalUrl.includes('#/login?session=expired');
  const passClearedToken = tokenAfter === null;

  console.log('\n--- VERIFICATION CHECKS ---');
  console.log('1. Exactly ONE refresh attempt:', passSingleRefresh ? 'PASS' : 'FAIL');
  console.log('2. Clean redirect to #/login?session=expired:', passRedirect ? 'PASS' : 'FAIL');
  console.log('3. Token cleared from localStorage:', passClearedToken ? 'PASS' : 'FAIL');
  console.log('4. No request loop:', networkLog.length < 15 ? 'PASS' : 'FAIL');

  if (passSingleRefresh && passRedirect && passClearedToken) {
    console.log('\n>>> EMPIRICAL 401 REFRESH/REDIRECT TEST PASSED 100% CLEANLY <<<');
    process.exit(0);
  } else {
    console.error('\n>>> 401 VERIFICATION CHECKS FAILED <<<');
    process.exit(1);
  }
}

test401Flow().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
