const { chromium } = require('playwright-core');
const http = require('http');

async function getMemberToken() {
  const payload = JSON.stringify({
    email: 'researcher@mahitechgroup.com',
    password: 'ResearcherPass123!'
  });

  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function verifyLogout() {
  console.log('1. Authenticating test member via POST /api/auth/login...');
  const loginResult = await getMemberToken();
  const token = loginResult.token;
  const user = loginResult.user;
  console.log(`   Authenticated user: ${user.name} (${user.role}), Token: ${token.slice(0, 20)}...`);

  console.log('2. Launching browser...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--no-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  const authRequests = [];
  const toastMessages = [];

  page.on('request', req => {
    const url = req.url();
    if (url.includes('/api/auth/')) {
      authRequests.push({
        method: req.method(),
        url: url,
        headers: req.headers(),
        time: Date.now()
      });
    }
  });

  page.on('response', res => {
    const url = res.url();
    if (url.includes('/api/auth/')) {
      const matching = authRequests.find(r => r.url === url && !r.status);
      if (matching) {
        matching.status = res.status();
      }
    }
  });

  // Seed session
  console.log('3. Seeding authenticated token into localStorage...');
  await page.goto('http://localhost:4000/robots.txt');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('mtg_auth_token', token);
    localStorage.setItem('mtg_token', token);
    localStorage.setItem('mtg-frontend-session-v1', JSON.stringify({
      userId: user.id,
      role: user.role,
      subRole: user.sub_role || null,
      elevated: user.role === 'admin',
      demo: false,
      token: token,
      user: user,
      loginAt: new Date().toISOString()
    }));
  }, { token, user });

  console.log('4. Navigating to dashboard: http://localhost:4000/app.html#/app/dashboard ...');
  await page.goto('http://localhost:4000/app.html#/app/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Clear initial login auth requests so we focus on logout
  const initialAuthCalls = [...authRequests];
  authRequests.length = 0;

  console.log('5. Opening account menu (#account-menu)...');
  await page.waitForSelector('#account-menu');
  await page.click('#account-menu');
  await page.waitForTimeout(600);

  console.log('6. Clicking Sign out button (#logout-demo)...');
  await page.waitForSelector('#logout-demo');
  await page.click('#logout-demo');

  // Wait for redirect to #/login
  await page.waitForURL(/#\/login/);
  await page.waitForTimeout(1500);

  // Check current URL hash
  const currentHash = await page.evaluate(() => window.location.hash);
  console.log(`7. Final URL Hash: "${currentHash}"`);

  // Check toasts
  const toasts = await page.evaluate(() => {
    const elements = document.querySelectorAll('.toast, [role="alert"], .notice');
    return Array.from(elements).map(el => el.innerText.trim()).filter(Boolean);
  });
  console.log('8. Visible Toasts/Notices:', toasts);

  // Check token in localStorage
  const remainingToken = await page.evaluate(() => localStorage.getItem('mtg_auth_token'));
  console.log(`9. Remaining localStorage Token: ${remainingToken}`);

  console.log('10. Logout Network Trace:');
  authRequests.forEach((req, idx) => {
    const hasAuth = Boolean(req.headers['authorization']);
    const authHeader = req.headers['authorization'] ? `${req.headers['authorization'].slice(0, 25)}...` : 'NONE';
    console.log(`   [${idx + 1}] ${req.method} ${req.url} -> Status: ${req.status} | Authorization: ${authHeader} (Present: ${hasAuth})`);
  });

  // Verify assertions
  const logoutCalls = authRequests.filter(r => r.url.includes('/api/auth/logout'));
  const refreshCalls = authRequests.filter(r => r.url.includes('/api/auth/refresh'));
  const hasExpiredParam = currentHash.includes('session=expired');
  const hasExpiredToast = toasts.some(t => t.toLowerCase().includes('expired'));

  console.log('\n--- VERIFICATION CHECKS ---');
  console.log(`Check 1: Exactly one POST /api/auth/logout sent: ${logoutCalls.length === 1 ? 'PASS' : 'FAIL'} (Count: ${logoutCalls.length})`);
  const logoutReq = logoutCalls[0];
  const hasAuthHeader = logoutReq && logoutReq.headers['authorization'] && logoutReq.headers['authorization'].startsWith('Bearer ');
  console.log(`Check 2: Authorization header present on logout request: ${hasAuthHeader ? 'PASS' : 'FAIL'}`);
  console.log(`Check 3: Logout response status 200 OK: ${logoutReq?.status === 200 ? 'PASS' : 'FAIL'} (Status: ${logoutReq?.status})`);
  console.log(`Check 4: NO refresh calls triggered during logout: ${refreshCalls.length === 0 ? 'PASS' : 'FAIL'} (Count: ${refreshCalls.length})`);
  console.log(`Check 5: NO session=expired param in URL hash: ${!hasExpiredParam ? 'PASS' : 'FAIL'} (Hash: "${currentHash}")`);
  console.log(`Check 6: NO "Session expired" toast shown: ${!hasExpiredToast ? 'PASS' : 'FAIL'} (Toasts: ${JSON.stringify(toasts)})`);
  console.log(`Check 7: Token cleared from localStorage: ${remainingToken === null ? 'PASS' : 'FAIL'}`);

  await page.screenshot({ path: 'scripts/clean-logout-verified.png' });
  console.log('11. Screenshot captured: scripts/clean-logout-verified.png');

  await browser.close();

  const allPassed = logoutCalls.length === 1 &&
    hasAuthHeader &&
    logoutReq?.status === 200 &&
    refreshCalls.length === 0 &&
    !hasExpiredParam &&
    !hasExpiredToast &&
    remainingToken === null;

  if (allPassed) {
    console.log('\n>>> LOGOUT INTEGRATION TEST: ALL CHECKS PASSED EMPIRICALLY! <<<');
    process.exit(0);
  } else {
    console.error('\n>>> LOGOUT INTEGRATION TEST: FAILED! <<<');
    process.exit(1);
  }
}

verifyLogout().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
