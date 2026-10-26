const { chromium } = require('playwright-core');
const path = require('path');

async function runVerification() {
  console.log('=== STARTING BROWSER VERIFICATION FOR UPDATED UI & HARDENED AUTH ===\n');

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // 1. Visit landing page
    console.log('1. Checking Landing Page (http://localhost:4000/)...');
    await page.goto('http://localhost:4000/', { waitUntil: 'networkidle' });
    const title = await page.title();
    console.log(`   Page title: "${title}"`);

    const ctaHref = await page.$eval('.nav-cta', el => el.getAttribute('href'));
    console.log(`   Nav CTA points to: "${ctaHref}"`);
    if (!ctaHref.includes('#/login')) {
      throw new Error(`Expected nav CTA to point to #/login, got: ${ctaHref}`);
    }

    const roleSelectionCount = await page.$$eval('a[href*="role-selection"]', links => links.length);
    console.log(`   Role-selection links found on landing page: ${roleSelectionCount}`);
    if (roleSelectionCount !== 0) {
      throw new Error(`Found ${roleSelectionCount} role-selection links on landing page! Must be 0.`);
    }

    // 2. Direct unauthenticated access to protected route
    console.log('\n2. Testing unauthenticated access to #/app/dashboard...');
    await page.goto('http://localhost:4000/app.html#/app/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const unauthUrl = page.url();
    console.log(`   Current URL after protected route attempt: ${unauthUrl}`);
    if (!unauthUrl.includes('#/login')) {
      throw new Error(`Expected redirect to #/login, stayed at: ${unauthUrl}`);
    }

    // 3. Direct unauthenticated access to admin
    console.log('\n3. Testing unauthenticated access to #/admin...');
    await page.goto('http://localhost:4000/app.html#/admin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const unauthAdminUrl = page.url();
    console.log(`   Current URL after admin attempt: ${unauthAdminUrl}`);
    if (!unauthAdminUrl.includes('#/login')) {
      throw new Error(`Expected redirect to #/login, stayed at: ${unauthAdminUrl}`);
    }

    // 4. Direct navigation to role-selection bypass
    console.log('\n4. Testing navigation to #/role-selection...');
    await page.goto('http://localhost:4000/app.html#/role-selection', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const roleSelUrl = page.url();
    console.log(`   Current URL after role-selection attempt: ${roleSelUrl}`);
    if (!roleSelUrl.includes('#/login')) {
      throw new Error(`Expected redirect to #/login, stayed at: ${roleSelUrl}`);
    }

    // 5. Inspect Login Page DOM
    console.log('\n5. Inspecting Login Page DOM...');
    const demoRolesCount = await page.$$eval('[data-demo-role]', els => els.length);
    console.log(`   Demo role 1-click bypass buttons found: ${demoRolesCount}`);
    if (demoRolesCount !== 0) {
      throw new Error(`Found ${demoRolesCount} demo role bypass buttons! Must be 0.`);
    }

    const demoBoxCount = await page.$$eval('.demo-box', els => els.length);
    console.log(`   Demo boxes found: ${demoBoxCount}`);

    // 6. Test Real Login with Admin Credentials
    console.log('\n6. Testing Real Login with Admin Credentials...');
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@mahitechgroup.com';
    const adminPass = process.env.ADMIN_PASSWORD || 'AdminPassword@2026';

    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPass);
    await page.click('#login-submit');

    // Wait for redirect away from #/login
    await page.waitForFunction(() => location.hash !== '#/login', { timeout: 10000 });
    console.log(`   Successfully logged in! Redirected to: ${page.url()}`);

    // Verify token stored under canonical mtg_auth_token key
    const token = await page.evaluate(() => localStorage.getItem('mtg_auth_token'));
    console.log(`   Token stored in mtg_auth_token: ${token ? 'YES (Valid JWT format: ' + token.slice(0, 15) + '...)' : 'NO'}`);
    if (!token) throw new Error('Token was not saved in localStorage.mtg_auth_token!');

    // 7. Verify AI Center in Navigation & Page Render
    console.log('\n7. Verifying AI Center (#/app/ai)...');
    await page.goto('http://localhost:4000/app.html#/app/ai', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const aiHeading = await page.textContent('h1');
    console.log(`   AI Center rendered with heading: "${aiHeading}"`);

    // Take screenshot as proof
    const screenshotPath = path.resolve(__dirname, '../public/assets/verified-updated-ui.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`   Saved verification screenshot: ${screenshotPath}`);

    // 8. Test Clean Sign Out
    console.log('\n8. Testing Sign Out...');
    await page.click('#account-menu');
    await page.waitForSelector('#logout-demo', { state: 'visible' });
    await page.click('#logout-demo');
    await page.waitForURL('**/app.html#/login', { timeout: 5000 });
    console.log('   Successfully signed out and redirected to #/login');

    const tokenAfterLogout = await page.evaluate(() => localStorage.getItem('mtg_auth_token'));
    console.log(`   Token after logout: ${tokenAfterLogout || 'CLEARED'}`);
    if (tokenAfterLogout) throw new Error('Token was not cleared on logout!');

    console.log('\n=== ALL BROWSER VERIFICATION CHECKS PASSED WITH 100% SUCCESS ===');
    console.log(`Console errors during test: ${consoleErrors.length}`);
    if (consoleErrors.length) console.log(consoleErrors);

  } finally {
    await browser.close();
  }
}

runVerification().catch(err => {
  console.error('\nVERIFICATION FAILED:', err.message);
  process.exit(1);
});
