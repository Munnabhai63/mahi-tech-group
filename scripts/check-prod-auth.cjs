const { execSync } = require('child_process');

// We will fetch the hashes from the VPS using ssh and sqlite3
const output = execSync('ssh -i C:\\Users\\munaf\\.ssh\\id_ed25519 -o StrictHostKeyChecking=no root@200.97.164.97 "sqlite3 /var/www/oviaxe.com/database.sqlite \\"SELECT email, password_hash FROM users\\""').toString();

const bcrypt = require('bcryptjs');

const candidates = [
  'AdminPassword@2026',
  'Mahi@Oviaxe#1738fe',
  'ResearcherPass123!',
  'DeveloperPass123!',
  'ProducerPass123!',
  'DesignerPass123!',
  'admin',
  'admin123',
  'password',
  'oviaxe@2026',
  'MahiTech@2026'
];

const lines = output.trim().split('\n');
for (const line of lines) {
  const [email, hash] = line.split('|');
  if (!email || !hash) continue;
  console.log(`Checking ${email}...`);
  for (const pass of candidates) {
    if (bcrypt.compareSync(pass, hash.trim())) {
      console.log(`  MATCH: ${email} -> ${pass}`);
      break;
    }
  }
}
