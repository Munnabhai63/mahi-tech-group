import { DatabaseSync } from 'node:sqlite';

const dbPath = '/var/www/ovipay/data/ovipay.sqlite';
const db = new DatabaseSync(dbPath);

const merchantId = '00000000-0000-0000-0000-000000000001';
const upiId = 'muna937634@ybl';
const payeeName = 'Mahipal Choudhary';
const businessName = 'Mahipal Choudhary';

console.log('--- UPDATING MERCHANTS & PAYMENT RECEIVING ACCOUNTS ---');

// 1. Update merchant
db.prepare(`
  UPDATE merchants 
  SET business_name = ?, 
      branding = json_set(COALESCE(branding, '{}'), '$.appName', 'OviPay', '$.primaryColor', '#10b981'),
      updated_at = datetime('now')
  WHERE id = ?
`).run(businessName, merchantId);

// 2. Update receiving accounts: update existing account to real UPI
const existing = db.prepare('SELECT id FROM payment_receiving_accounts WHERE merchant_id = ?').all(merchantId);
console.log('Existing receiving accounts:', existing);

if (existing.length > 0) {
  db.prepare(`
    UPDATE payment_receiving_accounts 
    SET upi_id = ?, 
        payee_name = ?, 
        is_merchant_enabled = 1, 
        is_active = 1, 
        is_slot_busy = 0, 
        current_active_session_id = NULL,
        updated_at = datetime('now')
    WHERE merchant_id = ? AND id = ?
  `).run(upiId, payeeName, merchantId, existing[0].id);
} else {
  const newId = '00000000-0000-0000-0000-000000000002';
  db.prepare(`
    INSERT INTO payment_receiving_accounts (
      id, merchant_id, upi_id, payee_name, is_merchant_enabled, is_active, is_slot_busy, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, 1, 0, datetime('now'), datetime('now'))
  `).run(newId, merchantId, upiId, payeeName);
}

// 3. Reset any busy slots
db.prepare(`
  UPDATE payment_receiving_accounts
  SET is_slot_busy = 0, current_active_session_id = NULL
`).run();

console.log('--- VERIFICATION ---');
const updatedMerchant = db.prepare('SELECT id, business_name, branding FROM merchants WHERE id = ?').all(merchantId);
console.log('Merchant:', updatedMerchant);

const updatedAccounts = db.prepare('SELECT * FROM payment_receiving_accounts WHERE merchant_id = ?').all(merchantId);
console.log('Receiving Accounts:', updatedAccounts);
