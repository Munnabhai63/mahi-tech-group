import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, execRaw, queryAll } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigration() {
  console.log('>>> Running Database Migration...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  execRaw(schemaSql);

  // Check if wallet_frozen column exists on users table (for existing DB instances)
  const userColumns = queryAll('PRAGMA table_info(users);');
  const hasWalletFrozen = userColumns.some(c => c.name === 'wallet_frozen');
  if (!hasWalletFrozen) {
    execRaw('ALTER TABLE users ADD COLUMN wallet_frozen BOOLEAN DEFAULT 0;');
    console.log('>>> Added wallet_frozen column to users table.');
  }

  // Verification of tables
  const tables = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  console.log('>>> Migration executed successfully.');
  console.log('>>> Verified Tables in Database:', tables.map(t => t.name).join(', '));

  // Verification of indexes
  const indexes = queryAll("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  console.log('>>> Verified Indexes in Database:', indexes.map(i => i.name).join(', '));

  return { tables, indexes };
}

// When run directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runMigration();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}
