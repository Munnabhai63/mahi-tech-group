const { chromium } = require('playwright-core');

async function runMemberDashboardPass() {
  console.log('=== STEP 1: DIRECT HTTP CALL TO GET /api/banners/active WITH MEMBER TOKEN ===');
  
  // 1. Login via backend API as researcher member
  const loginRes = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'researcher@mahitechgroup.com',
      password: 'ResearcherPass123!'
    })
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.token) {
    throw new Error(`Member login failed: ${loginRes.status} ${JSON.stringify(loginData)}`);
  }

  const memberToken = loginData.token;
  console.log(`Member authenticated successfully as: ${loginData.user.email} (Role: ${loginData.user.role})`);

  // 2. Call GET /api/banners/active
  const bannerRes = await fetch('http://localhost:4000/api/banners/active', {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${memberToken}`
    }
  });

  const bannerStatus = bannerRes.status;
  const bannerBody = await bannerRes.text();
  console.log(`\nHTTP STATUS: ${bannerStatus}`);
  console.log(`HTTP RESPONSE BODY:\n${bannerBody}\n`);

  console.log('=== STEP 2: BROWSER PASS ON #/app/dashboard (MEMBER) WITH NETWORK CAPTURE ===');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const networkResponses = [];
  const networkErrors = [];
  let bannersResponse = null;

  page.on('response', async resp => {
    const url = resp.url();
    const status = resp.status();
    if (url.includes('/api/')) {
      networkResponses.push({ status, url });
      if (url.includes('banners/active')) {
        bannersResponse = { status, url };
      }
      if (status >= 400) {
        networkErrors.push({ status, url });
      }
    }
  });

  // Navigate to login
  await page.goto('http://localhost:4000/app.html#/login', { waitUntil: 'networkidle' });

  // Fill member credentials
  await page.fill('#login-email', 'researcher@mahitechgroup.com');
  await page.fill('#login-password', 'ResearcherPass123!');
  await page.click('#login-submit');

  // Wait for dashboard to mount and load network data
  await page.waitForURL('**/app.html#/app/dashboard', { timeout: 10000 });
  await page.waitForTimeout(3000);

  console.log('Final URL:', page.url());
  console.log('Banners call captured:', bannersResponse);
  console.log(`Total API calls made on dashboard: ${networkResponses.length}`);
  console.log(`Total 4xx/5xx network errors on dashboard: ${networkErrors.length}`);

  if (networkErrors.length > 0) {
    console.error('Errors encountered:', networkErrors);
  }

  // Save screenshot of member dashboard
  await page.screenshot({ path: 'scripts/member-dashboard-verified.png', fullPage: true });
  console.log('Saved screenshot to scripts/member-dashboard-verified.png');

  await browser.close();

  if (bannerStatus === 200 && bannersResponse?.status === 200 && networkErrors.length === 0) {
    console.log('\n>>> MEMBER DASHBOARD & BANNERS PASS: 100% SUCCESS <<<');
    process.exit(0);
  } else {
    console.error('\n>>> MEMBER DASHBOARD PASS FAILED <<<');
    process.exit(1);
  }
}

runMemberDashboardPass().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
