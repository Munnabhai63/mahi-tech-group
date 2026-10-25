import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/home/user/mahi-tech-group-web/package.json');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = []; const errors = [];
async function go(page, route) { await page.goto(`${base}/app.html#${route}`, { waitUntil: 'networkidle' }); await page.waitForSelector('#main-content'); await page.waitForTimeout(45); }
async function login(page, role) { await go(page, '/login'); await page.locator(`[data-demo-role="${role}"]`).click(); await page.waitForTimeout(100); }
async function inspect(page, route, width, group) {
  await page.setViewportSize({ width, height: 900 }); await go(page, route);
  const value = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, h1: document.querySelector('h1')?.textContent?.trim() || '', renderError: document.body.innerText.includes('This screen could not be rendered'), main: !!document.querySelector('#main-content') }));
  results.push({ group, route, width, ...value });
  const captures = {
    '/admin': 'admin', '/app/dashboard': 'dashboard', '/app/projects/p-arogya': 'project', '/app/meetings/m-repair': 'meeting', '/app/coworking/p-arogya': 'canvas', '/superadmin/performance': 'performance', '/superadmin/support': 'support', '/superadmin/gateway': 'gateway', '/app/ideas/i-clinic': 'idea'
  };
  if (captures[route] && [360, 768, 1440].includes(width)) { await page.waitForTimeout(300); await page.screenshot({ path: `/home/user/mahi-app-qa/${captures[route]}-${width}.png`, fullPage: true }); }
}
const context = await browser.newContext(); const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await login(page, 'admin');
const routes = ['/admin','/admin/applications','/admin/members','/admin/ideas','/admin/projects','/admin/revenue','/admin/offboarding','/admin/config','/admin/meetings','/admin/audit','/superadmin','/superadmin/members','/superadmin/performance','/superadmin/support','/superadmin/ideas','/superadmin/disputes','/superadmin/gateway','/superadmin/governance','/superadmin/audit','/app/dashboard','/app/workspace','/app/tasks','/app/projects','/app/projects/p-arogya','/app/projects/p-repair','/app/ideas','/app/ideas/new','/app/ideas/i-clinic','/app/voting','/app/meetings','/app/meetings/m-repair','/app/meetings/m-qa','/app/coworking/p-arogya','/app/notifications','/app/support','/app/support/t-1042','/app/profile','/app/members/u-former','/app/wallet','/app/settings'];
for (const width of [360, 768, 1024, 1440]) for (const route of routes) await inspect(page, route, width, 'admin-route-matrix');
await page.setViewportSize({ width: 390, height: 844 }); await go(page, '/admin'); await page.locator('#open-sidebar').click(); const open = await page.locator('#app-sidebar').evaluate(element => element.classList.contains('is-open')); await page.locator('#close-sidebar').click(); const closed = await page.locator('#app-sidebar').evaluate(element => !element.classList.contains('is-open')); results.push({ group: 'mobile-navigation', pass: open && closed });
for (const route of ['/app/dashboard', '/app/projects/p-arogya', '/superadmin/performance']) {
  await go(page, route); for (const mode of ['loading', 'empty', 'error', 'normal']) { await page.locator('#preview-mode').selectOption(mode); await page.waitForTimeout(70); const text = await page.locator('#main-content').innerText(); const okay = mode === 'loading' ? await page.locator('[aria-busy=true]').count() : mode === 'error' ? text.includes('This view could not be loaded') : mode === 'empty' ? text.toLowerCase().includes('no ') : await page.locator('#preview-mode').inputValue() === 'normal'; results.push({ group: 'preview-states', route, mode, pass: Boolean(okay) }); }
}
await context.close();
for (const role of ['researcher', 'designer', 'developer', 'producer', 'admin']) {
  const roleContext = await browser.newContext(); const rolePage = await roleContext.newPage(); rolePage.on('pageerror', error => errors.push(`${role}:${error.message}`)); await login(rolePage, role);
  for (const width of [360, 1024, 1440]) for (const route of ['/app/dashboard', '/app/workspace']) await inspect(rolePage, route, width, `role-${role}`);
  await go(rolePage, '/admin'); results.push({ group: 'role-guard', role, pass: role === 'admin' ? rolePage.url().includes('/admin') : !rolePage.url().includes('/admin') });
  await roleContext.close();
}
const publicContext = await browser.newContext(); const publicPage = await publicContext.newPage(); publicPage.on('pageerror', error => errors.push(error.message));
for (const width of [360, 1024, 1440]) for (const route of ['/login','/role-selection','/signup','/application-status?status=pending','/about','/contact','/mentorship','/legal/terms','/legal/privacy']) await inspect(publicPage, route, width, 'public');
await publicContext.close();
const signContext = await browser.newContext(); const signPage = await signContext.newPage(); await go(signPage, '/sign/disputes/d-302?document=ag-302&signature=sig-302-front&token=local-demo-sig-302-front'); await signPage.locator('[data-sign-identity="u-dev-front"]').click(); await signPage.waitForTimeout(100);
for (const width of [360, 768, 1024, 1440]) { await signPage.setViewportSize({ width, height: 900 }); await signPage.waitForTimeout(60); const overflow = await signPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); results.push({ group: 'signing', width, overflow }); if ([360, 1440].includes(width)) await signPage.screenshot({ path: `/home/user/mahi-app-qa/signing-${width}.png`, fullPage: true }); }
await signContext.close();
const formerContext = await browser.newContext(); const formerPage = await formerContext.newPage(); await login(formerPage, 'former'); for (const width of [360, 1440]) await inspect(formerPage, '/app/former-member', width, 'former'); await go(formerPage, '/app/wallet'); results.push({ group: 'former-wallet', pass: await formerPage.locator('#request-withdrawal').isDisabled() }); await formerContext.close();
const overflow = results.filter(item => item.overflow > 1); const renderErrors = results.filter(item => item.renderError); const failed = results.filter(item => item.pass === false);
const report = { checks: results.length, overflow, renderErrors, failed, errors, results };
fs.writeFileSync('/home/user/mahi-app-qa/responsive-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checks: results.length, overflow: overflow.map(item => [item.group, item.route, item.width, item.overflow]), renderErrors: renderErrors.map(item => item.route), failed, errors }, null, 2));
await browser.close();
