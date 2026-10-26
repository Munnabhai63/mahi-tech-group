import fs from 'node:fs';

const headerPath = '/var/www/ovipay/apps/checkout-portal/src/views/partials/header.html';
if (fs.existsSync(headerPath)) {
  let content = fs.readFileSync(headerPath, 'utf8');
  content = content.replaceAll('YouPI PG Verified Business', 'OviPay Verified Business');
  fs.writeFileSync(headerPath, content, 'utf8');
  console.log('PATCHED_HEADER');
}

const splashPath = '/var/www/ovipay/apps/checkout-portal/src/views/partials/splash.html';
if (fs.existsSync(splashPath)) {
  let content = fs.readFileSync(splashPath, 'utf8');
  content = content.replaceAll('YouPI\n          PG', 'OviPay');
  content = content.replaceAll('YouPI PG', 'OviPay');
  fs.writeFileSync(splashPath, content, 'utf8');
  console.log('PATCHED_SPLASH');
}

const checkoutPath = '/var/www/ovipay/apps/checkout-portal/src/views/checkout.html';
if (fs.existsSync(checkoutPath)) {
  let content = fs.readFileSync(checkoutPath, 'utf8');
  content = content.replaceAll('YouPI PG Verified Business', 'OviPay Verified Business');
  fs.writeFileSync(checkoutPath, content, 'utf8');
  console.log('PATCHED_CHECKOUT');
}
