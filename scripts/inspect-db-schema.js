import { getDatabase } from '../src/db/database.js';
import fs from 'node:fs';

const db = getDatabase();

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log('TABLES COUNT:', tables.length);

const result = {
  tables: {},
  triggers: []
};

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  result.tables[t.name] = cols.map(c => ({
    name: c.name,
    type: c.type,
    notNull: !!c.notnull,
    defaultValue: c.dflt_value,
    pk: !!c.pk
  }));
}

const triggers = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
result.triggers = triggers;

fs.writeFileSync('scripts/db-schema-dump.json', JSON.stringify(result, null, 2));
console.log('Saved to scripts/db-schema-dump.json');
console.log('Table names:', Object.keys(result.tables));
console.log('Triggers count:', result.triggers.length);
