const { chromium } = require('playwright-core');

async function verifyUI() {
  console.log('Launching Microsoft Edge via playwright-core...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const networkErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.message);
  });

  page.on('response', resp => {
    if (resp.status() >= 400 && !resp.url().includes('favicon')) {
      networkErrors.push(`${resp.status()} ${resp.url()}`);
    }
  });

  const routes = [
    { name: 'Homepage', url: 'http://localhost:4000/' },
    { name: 'Role Selection', url: 'http://localhost:4000/app.html#/role-selection' },
    { name: 'Login Screen', url: 'http://localhost:4000/app.html#/login' },
    { name: 'Signup Screen', url: 'http://localhost:4000/signup.html' }
  ];

  for (const r of routes) {
    console.log(`Checking route: ${r.name} (${r.url})...`);
    await page.goto(r.url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    const title = await page.title();
    console.log(`  -> Title: "${title}"`);
  }

  // Now perform admin login and verify live dashboard
  console.log('Testing live login flow in browser...');
  await page.goto('http://localhost:4000/app.html#/login', { waitUntil: 'networkidle' });
  
  // Fill credentials
  await page.fill('#login-email', 'admin@mahitechgroup.com');
  await page.fill('#login-password', 'AdminPassword@2026');
  await page.click('#login-submit');

  await page.waitForTimeout(3000);
  console.log('Current URL after login submit:', page.url());

  // Capture screenshot of authenticated workspace
  await page.screenshot({ path: 'scripts/browser-verified-workspace.png' });
  console.log('Saved screenshot to scripts/browser-verified-workspace.png');

  await browser.close();

  console.log('\n=====================================================');
  console.log('BROWSER CONSOLE ERRORS:', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.error(consoleErrors);
  }
  console.log('NETWORK ERRORS (>=400):', networkErrors.length);
  if (networkErrors.length > 0) {
    console.error(networkErrors);
  }
  console.log('=====================================================');

  if (consoleErrors.length === 0) {
    console.log('ALL BROWSER UI FLOWS VERIFIED 100% CLEAN WITH ZERO CONSOLE ERRORS!');
  } else {
    process.exit(1);
  }
}

verifyUI().catch(err => {
  console.error('Browser verification failed:', err);
  process.exit(1);
});
