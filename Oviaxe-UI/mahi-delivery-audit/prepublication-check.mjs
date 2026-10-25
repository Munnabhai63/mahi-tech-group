import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/home/user/mahi-tech-group-web/package.json');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const checks = [];
const errors = [];
const badResponses = [];
const externalRequests = [];
const apiCalls = [];
const check = (name, pass, details = null) => checks.push({ name, pass: Boolean(pass), details });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()} ${request.failure()?.errorText}`));
page.on('request', request => {
  if (request.url().includes('/api/')) apiCalls.push(request.url());
  if (!request.url().startsWith(base) && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) externalRequests.push(request.url());
});
page.on('response', response => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); });

let response = await page.goto(`${base}/`, { waitUntil: 'networkidle' });
check('Homepage entry returns 200', response?.status() === 200);
const home = await page.evaluate(() => ({
  title: document.title,
  fragments: [...new Set([...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(href => href.length > 1))].map(href => ({ href, exists: !!document.querySelector(href) })),
  appRoutes: [...new Set([...document.querySelectorAll('a[href^="/app.html#"]')].map(a => a.getAttribute('href').split('#')[1]))],
  emptyLinks: [...document.querySelectorAll('a')].filter(a => !a.getAttribute('href') || a.getAttribute('href') === '#').length,
  hero: document.querySelector('.studio-hero__media img')?.getAttribute('src'),
  favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
  externalActions: [...document.querySelectorAll('a')].map(a => a.getAttribute('href')).filter(href => /^(?:mailto|tel|https?):/i.test(href || ''))
}));
check('Homepage fragment links all resolve', home.fragments.every(item => item.exists), home.fragments);
check('Homepage has no empty or external contact links', home.emptyLinks === 0 && home.externalActions.length === 0, home);
check('Homepage uses the selected studio hero', home.hero === '/assets/images/mahi-hero-studio.webp', home.hero);
for (const href of ['#platform', '#collaboration', '#about', '#faq']) {
  await page.locator(`.desktop-nav a[href="${href}"]`).click();
  check(`Homepage navigation reaches ${href}`, await page.evaluate(() => location.hash) === href);
}
for (const path of ['/', '/app.html', '/assets/brand/favicon.svg', '/assets/images/mahi-hero-studio.webp', '/assets/images/mahi-mentorship.webp', '/css/application.css', '/js/app/index.js']) {
  const result = await context.request.get(`${base}${path}`);
  check(`Entry/asset responds 200: ${path}`, result.status() === 200, result.status());
}
const expectedRoutes = new Set(['/role-selection', '/login', '/signup', '/contact']);
check('Homepage exposes only expected application access routes', home.appRoutes.every(route => expectedRoutes.has(route)), home.appRoutes);
for (const route of home.appRoutes) {
  await page.goto(`${base}/app.html#${route}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#main-content');
  check(`Homepage application link renders ${route}`, !(await page.locator('body').innerText()).includes('This screen could not be rendered') && (await page.locator('#main-content').innerText()).includes('MAHI TECH GROUP'));
}
await page.goto(`${base}/app.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('#main-content');
check('Bare application entry renders a public access route', !(await page.locator('body').innerText()).includes('This screen could not be rendered') && /#\/(?:login|role-selection)/.test(page.url()), page.url());
await page.goto(`${base}/app.html#/login`, { waitUntil: 'networkidle' });
check('Application entry renders login', await page.locator('#login-form').count() === 1);
check('Application favicon path is corrected', await page.locator('link[rel="icon"]').getAttribute('href') === '/assets/brand/favicon.svg');
await page.locator('[data-demo-role="admin"]').click();
await page.waitForSelector('.admin-hero');
check('Application demo entry renders Admin dashboard', (await page.locator('h1').textContent()).includes('Operational control'));
await page.locator('.sidebar__nav a[href="#/admin/applications"]').click();
await page.waitForTimeout(120);
check('Admin sidebar navigation opens applications', page.url().includes('#/admin/applications') && !(await page.locator('body').innerText()).includes('This screen could not be rendered'));
await page.locator('.sidebar__nav a[href="#/admin"]').click();
await page.waitForSelector('.admin-hero');
await page.locator('.sidebar__nav a[href="#/app/dashboard"]').click();
await page.waitForTimeout(120);
check('Admin-to-member area navigation renders dashboard', page.url().includes('#/app/dashboard') && await page.locator('.app-shell').count() === 1 && !(await page.locator('body').innerText()).includes('This screen could not be rendered'));
await page.locator('.sidebar__nav a[href="#/app/projects"]').click();
await page.waitForTimeout(120);
check('Member sidebar navigation renders projects', page.url().includes('#/app/projects') && !(await page.locator('body').innerText()).includes('This screen could not be rendered'));
await page.locator('.sidebar__home').click();
await page.waitForLoadState('networkidle');
check('Application homepage link returns to public homepage', page.url() === `${base}/` && await page.locator('.studio-hero').count() === 1);
check('No browser errors', errors.length === 0, errors);
check('No failed HTTP responses', badResponses.length === 0, badResponses);
check('No external runtime requests', externalRequests.length === 0, externalRequests);
check('No backend API calls', apiCalls.length === 0, apiCalls);
const failed = checks.filter(item => !item.pass);
const report = { checks, errors, badResponses, externalRequests, apiCalls };
fs.writeFileSync('/home/user/mahi-delivery-audit/prepublication-results.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checks: checks.length, passed: checks.length - failed.length, failed, errors, badResponses, externalRequests, apiCalls }, null, 2));
await browser.close();
if (failed.length || errors.length || badResponses.length || externalRequests.length || apiCalls.length) process.exitCode = 1;
