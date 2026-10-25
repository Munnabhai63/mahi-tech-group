import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/home/user/mahi-tech-group-web/package.json');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4000';
const output = '/home/user/mahi-delivery-audit';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];
const tokenNames = ['--ink', '--paper', '--ivory', '--cobalt', '--lime', '--font-body', '--font-display', '--font-serif'];
const unsupported = /MAHI SKILLS|learning track|mentorship request|career guidance|mahiverse/i;

async function tokens(page) {
  return page.evaluate((names) => Object.fromEntries(names.map(name => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()])), tokenNames);
}

for (const width of [1440, 390]) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(300, innerHeight * .7)) {
      scrollTo({ top: y, behavior: 'instant' });
      await sleep(80);
    }
    scrollTo({ top: 0, behavior: 'instant' });
    await sleep(900);
  });
  const homepage = await page.evaluate(() => ({
    brands: [...document.querySelectorAll('.brand__type')].map(el => el.textContent.trim().replace(/\s+/g, ' ')),
    sections: [...document.querySelectorAll('main > section')].map(el => el.id || el.className),
    capabilities: [...document.querySelectorAll('.track-row__main h3')].map(el => el.textContent.trim()),
    trackColors: [...document.querySelectorAll('.track-row')].map(el => getComputedStyle(el).backgroundColor),
    bodyFont: getComputedStyle(document.body).fontFamily,
    bodyColor: getComputedStyle(document.body).color,
    unsupportedCopy: /MAHI SKILLS|learning track|mentorship request|career guidance|mahiverse/i.test(document.body.innerText),
    overflow: document.documentElement.scrollWidth - innerWidth
  }));
  homepage.tokens = await tokens(page);
  for (const [name, selector] of [['hero', '.studio-hero'], ['platform', '#platform'], ['collaboration', '#collaboration'], ['delivery', '#about'], ['faq', '#faq'], ['cta', '.final-cta']]) {
    await page.locator(selector).screenshot({ path: `${output}/homepage-${name}-${width}.png`, animations: 'disabled' });
  }
  results.push({ width, homepage });

  await page.goto(`${base}/app.html#/login`, { waitUntil: 'networkidle' });
  await page.locator('[data-demo-role="admin"]').click();
  await page.waitForSelector('.admin-hero');
  await page.waitForTimeout(350);
  const application = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent.trim(),
    brand: document.querySelector('.sidebar__brand')?.textContent.trim().replace(/\s+/g, ' '),
    bodyFont: getComputedStyle(document.body).fontFamily,
    bodyColor: getComputedStyle(document.body).color,
    shell: !!document.querySelector('.app-shell'),
    sidebar: !!document.querySelector('.sidebar__nav'),
    cards: document.querySelectorAll('.card').length,
    unsupportedCopy: /MAHI SKILLS|learning track|mentorship request|career guidance|mahiverse/i.test(document.body.innerText),
    overflow: document.documentElement.scrollWidth - innerWidth
  }));
  application.tokens = await tokens(page);
  await page.screenshot({ path: `${output}/application-admin-${width}.png`, fullPage: true, animations: 'disabled' });
  results[results.length - 1].application = application;
  await page.close();
}
fs.writeFileSync(`${output}/visual-audit.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
await browser.close();
