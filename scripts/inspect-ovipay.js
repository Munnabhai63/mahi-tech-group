import { DatabaseSync } from 'node:sqlite';

const dbPath = '/var/www/ovipay/data/ovipay.sqlite';
const db = new DatabaseSync(dbPath);

console.log('=== payment_receiving_accounts columns ===');
console.log(db.prepare("PRAGMA table_info(payment_receiving_accounts)").all());

console.log('=== payment_receiving_accounts rows ===');
console.log(JSON.stringify(db.prepare("SELECT * FROM payment_receiving_accounts").all(), null, 2));
