import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/home/user/mahi-tech-group-web/package.json');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = []; const failed = []; const results = [];
page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message, stack: error.stack }));
page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text(), url: page.url() }); });
page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure()?.errorText }));
await page.goto(`${base}/app.html#/login`, { waitUntil: 'networkidle' });
await page.locator('[data-demo-role="admin"]').click();
await page.waitForSelector('.admin-hero');
const routes = [
  '/admin','/admin/applications','/admin/members','/admin/ideas','/admin/projects','/admin/revenue','/admin/offboarding','/admin/config','/admin/meetings','/admin/audit',
  '/superadmin','/superadmin/members','/superadmin/performance','/superadmin/support','/superadmin/ideas','/superadmin/disputes','/superadmin/gateway','/superadmin/governance','/superadmin/audit',
  '/app/dashboard','/app/workspace','/app/tasks','/app/projects','/app/projects/p-arogya','/app/projects/p-repair','/app/ideas','/app/ideas/new','/app/ideas/i-clinic','/app/voting','/app/meetings','/app/meetings/m-repair','/app/meetings/m-qa','/app/coworking/p-arogya','/app/notifications','/app/support','/app/support/t-1001','/app/profile','/app/members/u-former','/app/wallet','/app/settings',
  '/sign/disputes/d-302?document=ag-302&signature=sig-302-front&token=local-demo-sig-302-front'
];
for (const route of routes) {
  const beforeErrors = errors.length;
  await page.goto(`${base}/app.html#${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(100);
  const data = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent?.trim() || '',
    text: document.body.innerText.slice(0, 500),
    main: !!document.querySelector('#main-content'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    renderError: document.body.innerText.includes('This screen could not be rendered'),
    dialogs: document.querySelectorAll('dialog[open]').length,
  }));
  results.push({ route, ...data, newErrors: errors.slice(beforeErrors) });
  if (route === '/admin') await page.screenshot({ path: '/home/user/mahi-app-qa/admin-dashboard-initial.png', fullPage: true });
  if (route === '/superadmin/performance') await page.screenshot({ path: '/home/user/mahi-app-qa/performance-initial.png', fullPage: true });
  if (route === '/app/coworking/p-arogya') await page.screenshot({ path: '/home/user/mahi-app-qa/coworking-initial.png', fullPage: true });
}
fs.writeFileSync('/home/user/mahi-app-qa/smoke-results.json', JSON.stringify({ results, errors, failed }, null, 2));
console.log(JSON.stringify({ routes: results.length, renderErrors: results.filter(r => r.renderError).map(r => r.route), overflow: results.filter(r => r.overflow > 1).map(r => [r.route, r.overflow]), errors, failed }, null, 2));
await browser.close();
