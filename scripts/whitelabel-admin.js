import fs from 'node:fs';

const filePath = '/var/www/ovipay/apps/merchant-admin/src/views/admin.html';
if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replaceAll('Merchant & Supervisor Hub - YOUPI PG', 'Merchant & Supervisor Hub - OviPay');
  content = content.replaceAll('🛡️ YOUPI PG', '⚡ OviPay');
  content = content.replaceAll('YOUPI PG', 'OviPay');
  content = content.replaceAll('YOUPI Pay', 'OviPay');
  content = content.replaceAll('YOUPI Store', 'OviPay Store');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('ADMIN_HTML_WHITELABELED_SUCCESSFULLY');
} else {
  console.log('ADMIN_HTML_NOT_FOUND');
}
