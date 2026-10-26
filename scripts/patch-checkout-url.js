import fs from 'node:fs';

const p = '/var/www/ovipay/apps/payment-api/src/routes/payments.routes.js';
let c = fs.readFileSync(p, 'utf8');

const regex = /function resolveCheckoutBaseUrl\(merchant\) \{[\s\S]*?return ctx\.checkoutBaseUrl \|\| 'http:\/\/localhost:7000';\s*\}/;

const newFn = `function resolveCheckoutBaseUrl(merchant) {
    if (ctx.checkoutBaseUrl && !ctx.checkoutBaseUrl.includes('localhost')) {
      return ctx.checkoutBaseUrl;
    }
    if (merchant?.branding) {
      try {
        const urls = resolveRuntimeUrls(merchant.branding);
        if (urls && urls.checkoutUrl && !urls.checkoutUrl.includes('localhost')) return urls.checkoutUrl;
      } catch {}
    }
    return ctx.checkoutBaseUrl || 'http://localhost:7000';
  }`;

if (regex.test(c)) {
  fs.writeFileSync(p, c.replace(regex, newFn), 'utf8');
  console.log('PATCHED_SUCCESSFULLY');
} else {
  console.log('REGEX_NOT_MATCHED');
}
