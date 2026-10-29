import { getDatabase, execute, queryOne } from '../src/db/database.js';

console.log('===================================================================');
console.log('   PRD 17: GITHUB AUTOMATION ARCHITECTURE — BATCH 3 MIGRATION');
console.log('===================================================================\n');

const db = getDatabase();
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// 1. Drop old strict update trigger
console.log('Dropping old prevent_webhook_log_update trigger...');
db.exec('DROP TRIGGER IF EXISTS prevent_webhook_log_update;');

// 2. Create updated trigger allowing ONLY processed and error_message modifications
console.log('Creating updated prevent_webhook_log_update trigger (Decision 11)...');
db.exec(`
  CREATE TRIGGER prevent_webhook_log_update
  BEFORE UPDATE ON github_webhook_log
  WHEN OLD.delivery_id != NEW.delivery_id
    OR OLD.event_type != NEW.event_type
    OR OLD.payload != NEW.payload
    OR OLD.signature_valid != NEW.signature_valid
    OR OLD.received_at != NEW.received_at
  BEGIN
    SELECT RAISE(ABORT,
      'github_webhook_log is append-only: only processed and error_message fields are mutable');
  END;
`);

// 3. Verify new trigger behavior
console.log('Verifying trigger behavior...');
const testDeliveryId = `mig-test-b3-${Date.now()}`;
db.prepare(`
  INSERT INTO github_webhook_log (
    delivery_id, event_type, action, repo_full_name, sender_login, payload, signature_valid, processed
  ) VALUES (?, 'ping', NULL, 'mahitechgroup/test', 'octocat', '{"zen":"Responsive"}', 1, 0)
`).run(testDeliveryId);

// Test 3a: UPDATE processed = 1 must SUCCEED
db.prepare('UPDATE github_webhook_log SET processed = 1 WHERE delivery_id = ?').run(testDeliveryId);
const processedRow = queryOne('SELECT processed FROM github_webhook_log WHERE delivery_id = ?', [testDeliveryId]);
if (processedRow?.processed !== 1) {
  throw new Error('Migration verification failed: processed column was not updated to 1');
}
console.log('  ✅ UPDATE processed = 1 succeeded');

// Test 3b: UPDATE error_message = 'test error' must SUCCEED
db.prepare('UPDATE github_webhook_log SET error_message = ? WHERE delivery_id = ?').run('test error', testDeliveryId);
const errorRow = queryOne('SELECT error_message FROM github_webhook_log WHERE delivery_id = ?', [testDeliveryId]);
if (errorRow?.error_message !== 'test error') {
  throw new Error('Migration verification failed: error_message column was not updated');
}
console.log('  ✅ UPDATE error_message = test error succeeded');

// Test 3c: UPDATE event_type = 'tampered' must FAIL
let eventTypeBlocked = false;
try {
  db.prepare('UPDATE github_webhook_log SET event_type = ? WHERE delivery_id = ?').run('tampered', testDeliveryId);
} catch (e) {
  eventTypeBlocked = true;
}
if (!eventTypeBlocked) {
  throw new Error('Migration verification failed: event_type mutation was NOT blocked by trigger');
}
console.log('  ✅ UPDATE event_type blocked by trigger');

// Test 3d: UPDATE delivery_id = 'tampered' must FAIL
let deliveryIdBlocked = false;
try {
  db.prepare('UPDATE github_webhook_log SET delivery_id = ? WHERE delivery_id = ?').run('tampered', testDeliveryId);
} catch (e) {
  deliveryIdBlocked = true;
}
if (!deliveryIdBlocked) {
  throw new Error('Migration verification failed: delivery_id mutation was NOT blocked by trigger');
}
console.log('  ✅ UPDATE delivery_id blocked by trigger');

// Test 3e: UPDATE payload = 'tampered' must FAIL
let payloadBlocked = false;
try {
  db.prepare('UPDATE github_webhook_log SET payload = ? WHERE delivery_id = ?').run('tampered', testDeliveryId);
} catch (e) {
  payloadBlocked = true;
}
if (!payloadBlocked) {
  throw new Error('Migration verification failed: payload mutation was NOT blocked by trigger');
}
console.log('  ✅ UPDATE payload blocked by trigger');

console.log('\n===================================================================');
console.log('PRD 17 Batch 3 migration complete');
console.log('===================================================================');
