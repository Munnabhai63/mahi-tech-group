import { DatabaseSync } from 'node:sqlite';

const dbPath = '/var/www/ovipay/data/ovipay.sqlite';
const db = new DatabaseSync(dbPath);

const merchantId = '00000000-0000-0000-0000-000000000001';

db.prepare(`
  UPDATE merchants
  SET contact_email = 'support@oviaxe.com',
      contact_phone = '',
      branding = json_set(
        COALESCE(branding, '{}'),
        '$.appName', 'OviPay',
        '$.primaryColor', '#10b981',
        '$.supportEmails', json_array('support@oviaxe.com'),
        '$.supportMobiles', json_array()
      ),
      updated_at = datetime('now')
  WHERE id = ?
`).run(merchantId);

console.log('CLEANED_MERCHANT_CONTACTS_AND_BRANDING');
const m = db.prepare('SELECT id, business_name, contact_email, contact_phone, branding FROM merchants WHERE id = ?').all(merchantId);
console.log(m);
