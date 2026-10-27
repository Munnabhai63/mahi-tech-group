const db = require('../src/db/database');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log('=== DATABASE TABLES (' + tables.length + ') ===');
tables.forEach(t => {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\nTable: ${t.name} (${cols.length} cols)`);
  cols.forEach(c => {
    console.log(`  - ${c.name}: ${c.type} ${c.notnull ? 'NOT NULL' : ''} ${c.dflt_value !== null ? `DEFAULT ${c.dflt_value}` : ''} ${c.pk ? 'PK' : ''}`.trim());
  });
});

const triggers = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
console.log('\n=== DATABASE TRIGGERS (' + triggers.length + ') ===');
triggers.forEach(tr => {
  console.log(`\nTrigger: ${tr.name} on ${tr.tbl_name}\n${tr.sql}`);
});
