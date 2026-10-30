const { queryOne, execute } = require('./src/db/database.js');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function seed() {
  const hash = await bcrypt.hash('Password@2026!', 10);
  
  const testUsers = [
    { name: 'Aarav Developer', email: 'developer@oviaxe.com', role: 'developer', sub_role: 'backend' },
    { name: 'Dr. Priya Research', email: 'researcher@oviaxe.com', role: 'researcher', sub_role: null },
    { name: 'Sameer Designer', email: 'designer@oviaxe.com', role: 'designer', sub_role: null },
    { name: 'Kavita Producer', email: 'producer@oviaxe.com', role: 'producer', sub_role: null }
  ];

  for (const u of testUsers) {
    const existing = queryOne('SELECT id FROM users WHERE email = ?', [u.email]);
    if (!existing) {
      execute(
        `INSERT INTO users (id, email, password_hash, name, role, sub_role, status, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
        [crypto.randomUUID(), u.email, hash, u.name, u.role, u.sub_role]
      );
      console.log(`Created local user: ${u.email} (${u.role})`);
    } else {
      execute('UPDATE users SET password_hash = ? WHERE email = ?', [hash, u.email]);
      console.log(`Updated local user password: ${u.email}`);
    }
  }
}

seed().catch(console.error);
