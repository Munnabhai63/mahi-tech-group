import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire('/home/user/mahi-tech-group-web/package.json');
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const base = 'http://127.0.0.1:4000';
const output = '/home/user/mahi-tech-design-qa';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const responsive = [];
const checks = [];
const accessibility = [];
const errors = [];
const externalRequests = [];
const check = (name, pass, details = null) => checks.push({ name, pass: Boolean(pass), details });

async function settleReveals(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    document.documentElement.style.scrollBehavior = 'auto';
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(300, window.innerHeight * 0.65)) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await sleep(90);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(1000);
  });
}

async function scan(page, name) {
  await page.waitForTimeout(500);
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = report.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary, html: n.html.slice(0, 300) }))
  }));
  accessibility.push({ name, violations });
}

for (const width of [360, 390, 768, 1024, 1440, 1920]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ width, type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ width, type: 'console', message: message.text() }); });
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) externalRequests.push({ width, url: request.url() }); });
  const response = await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await settleReveals(page);
  const metrics = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const keyText = [...document.querySelectorAll('.studio-hero__title-line, .track-row__main h3, .mentorship__heading h2, .faq-question, .final-cta h2, .footer__wordmark, .brand__type')]
      .filter(visible)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 100), left: Math.round(rect.left), right: Math.round(rect.right) };
      })
      .filter(item => item.left < -1 || item.right > window.innerWidth + 1);
    return {
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      title: document.querySelector('h1')?.getAttribute('aria-label') || document.querySelector('h1')?.textContent.trim(),
      brand: document.querySelector('.brand__type')?.textContent.trim(),
      capabilities: document.querySelectorAll('[data-track]').length,
      faqs: document.querySelectorAll('.faq-item').length,
      imagesLoaded: [...document.images].every(image => image.complete && image.naturalWidth > 0),
      missingTargets: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(href => href.length > 1 && !document.querySelector(href)),
      emptyLinks: [...document.querySelectorAll('a')].filter(a => !a.getAttribute('href') || a.getAttribute('href') === '#').length,
      visibleReveals: document.querySelectorAll('[data-reveal].is-visible').length,
      totalReveals: document.querySelectorAll('[data-reveal]').length,
      smallButtons: [...document.querySelectorAll('button')].filter(visible).map(button => {
        const rect = button.getBoundingClientRect();
        return { label: button.getAttribute('aria-label') || button.textContent.trim().slice(0, 50), width: Math.round(rect.width), height: Math.round(rect.height) };
      }).filter(rect => rect.width < 24 || rect.height < 24),
      textOutOfBounds: keyText,
      unsupportedCopy: /MAHI SKILLS|learning track|mentorship request|career guidance|mahiverse/i.test(document.body.innerText),
      externalContactActions: document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]').length,
      workspaceLinks: [...document.querySelectorAll('[data-contact-link="workspace"]')].every(a => a.getAttribute('href') === '/app.html#/role-selection')
    };
  });
  const result = { width, status: response?.status(), ...metrics };
  responsive.push(result);
  check(`homepage ${width}px has no horizontal overflow`, metrics.documentWidth <= width && metrics.bodyWidth <= width, metrics);
  check(`homepage ${width}px content and assets`, result.status === 200 && metrics.capabilities === 4 && metrics.faqs === 5 && metrics.imagesLoaded && !metrics.missingTargets.length && !metrics.emptyLinks && !metrics.unsupportedCopy && !metrics.externalContactActions && metrics.workspaceLinks, result);
  check(`homepage ${width}px reveals complete`, metrics.visibleReveals === metrics.totalReveals, { visible: metrics.visibleReveals, total: metrics.totalReveals });
  check(`homepage ${width}px key text stays in bounds`, !metrics.textOutOfBounds.length, metrics.textOutOfBounds);
  check(`homepage ${width}px buttons meet 24px minimum`, !metrics.smallButtons.length, metrics.smallButtons);
  await page.screenshot({ path: `${output}/homepage-${width}.png`, fullPage: true, animations: 'disabled' });
  await context.close();
}

const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const desktop = await desktopContext.newPage();
desktop.on('pageerror', error => errors.push({ type: 'interaction-pageerror', message: error.message }));
await desktop.goto(`${base}/`, { waitUntil: 'networkidle' });
await desktop.locator('.desktop-nav a[href="#platform"]').click();
check('desktop Platform navigation updates hash', await desktop.evaluate(() => location.hash === '#platform'));
const firstCard = desktop.locator('[data-track="ideas-voting"]');
await firstCard.click();
check('capability dialog opens with evidenced workflow', await desktop.locator('#course-dialog').evaluate(dialog => dialog.open) && await desktop.locator('#course-dialog-title').textContent() === 'Ideas & Voting' && await desktop.locator('#course-dialog-modules li').count() === 4);
check('capability dialog CTA enters workspace', (await desktop.locator('#course-dialog-contact').getAttribute('href')) === '/app.html#/role-selection');
await scan(desktop, 'homepage desktop capability dialog');
await desktop.keyboard.press('Escape');
check('capability dialog closes and restores focus', !(await desktop.locator('#course-dialog').evaluate(dialog => dialog.open)) && await firstCard.evaluate(element => element === document.activeElement));
await desktop.locator('[data-track-footer="project-delivery"]').click();
check('footer capability opens matching dialog', await desktop.locator('#course-dialog-title').textContent() === 'Project Delivery');
await desktop.locator('[data-dialog-close]').click();
await desktop.locator('#faq-question-1').click();
check('FAQ behaves as single-open accordion', (await desktop.locator('#faq-question-1').getAttribute('aria-expanded')) === 'true' && (await desktop.locator('#faq-question-0').getAttribute('aria-expanded')) === 'false' && await desktop.locator('#faq-answer-0').evaluate(element => element.inert));
await settleReveals(desktop);
await scan(desktop, 'homepage desktop page');
await desktopContext.close();

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mobile = await mobileContext.newPage();
mobile.on('pageerror', error => errors.push({ type: 'mobile-pageerror', message: error.message }));
await mobile.goto(`${base}/`, { waitUntil: 'networkidle' });
await mobile.locator('[data-menu-toggle]').click();
check('mobile menu opens with correct state and focus', (await mobile.locator('[data-menu-toggle]').getAttribute('aria-expanded')) === 'true' && (await mobile.locator('[data-mobile-nav]').getAttribute('aria-hidden')) === 'false' && await mobile.locator('main').evaluate(element => element.inert) && (await mobile.evaluate(() => document.activeElement?.textContent || '')).includes('Platform'));
await scan(mobile, 'homepage mobile menu');
await mobile.keyboard.press('Escape');
check('mobile Escape closes menu and restores focus', (await mobile.locator('[data-menu-toggle]').getAttribute('aria-expanded')) === 'false' && !(await mobile.locator('main').evaluate(element => element.inert)) && await mobile.locator('[data-menu-toggle]').evaluate(element => element === document.activeElement));
await mobile.locator('[data-menu-toggle]').click();
await mobile.locator('[data-mobile-nav] a[href="#collaboration"]').click();
check('mobile navigation link closes menu and reaches section', (await mobile.locator('[data-menu-toggle]').getAttribute('aria-expanded')) === 'false' && await mobile.evaluate(() => location.hash === '#collaboration'));
await settleReveals(mobile);
await scan(mobile, 'homepage mobile page');
await mobile.locator('[data-track="ideas-voting"]').click();
await scan(mobile, 'homepage mobile capability dialog');
await mobile.keyboard.press('Escape');
await mobileContext.close();

const reducedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const reduced = await reducedContext.newPage();
await reduced.goto(`${base}/`, { waitUntil: 'networkidle' });
await reduced.waitForTimeout(100);
check('reduced motion reveals all content without scrolling', await reduced.locator('[data-reveal]:not(.is-visible)').count() === 0);
await reduced.evaluate(() => window.scrollTo(0, 500));
await reduced.waitForTimeout(100);
check('reduced motion disables hero parallax', !(await reduced.locator('.studio-hero__visual').evaluate(element => element.style.getPropertyValue('--hero-parallax'))));
await reducedContext.close();

check('no browser runtime errors', errors.length === 0, errors);
check('no external runtime requests', externalRequests.length === 0, externalRequests);
check('all Axe scans are clean', accessibility.every(result => result.violations.length === 0), accessibility.filter(result => result.violations.length));
const report = { responsive, checks, accessibility, errors, externalRequests };
fs.writeFileSync(`${output}/homepage-results.json`, JSON.stringify(report, null, 2));
const failed = checks.filter(result => !result.pass);
console.log(JSON.stringify({ responsiveChecks: responsive.length, checks: checks.length, passed: checks.length - failed.length, failed, axeScans: accessibility.length, axeViolations: accessibility.reduce((sum, result) => sum + result.violations.length, 0), errors, externalRequests }, null, 2));
await browser.close();
if (failed.length || accessibility.some(result => result.violations.length)) process.exitCode = 1;
