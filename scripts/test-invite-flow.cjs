const { chromium } = require('playwright');

async function testInvite() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  const token = 'a74c70385f85a928efc4e192521d2a9267f6e6e9f7ac9e1b1caea97e5add9e82';
  const targetUrl = `https://oviaxe.com/#/invite/${token}`;
  console.log('Navigating to:', targetUrl);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const finalUrl = page.url();
  console.log('Final Page URL:', finalUrl);
  console.log('Redirected to login?:', finalUrl.includes('/login'));

  const text = await page.evaluate(() => document.body.innerText);
  console.log('\nPage content text snippet:\n' + text.trim().slice(0, 400));

  await browser.close();
}

testInvite().catch(console.error);
