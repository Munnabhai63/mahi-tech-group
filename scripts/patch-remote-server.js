import fs from 'fs';

const filePath = '/var/www/oviaxe.com/src/server.js';
let content = fs.readFileSync(filePath, 'utf8');

const oldCheck = `if (process.argv[1] && process.argv[1].endsWith('server.js')) {`;
const newCheck = `if ((process.argv[1] && process.argv[1].endsWith('server.js')) || process.env.pm_id !== undefined || process.env.PM2_HOME !== undefined) {`;

if (content.includes(oldCheck)) {
  content = content.replace(oldCheck, newCheck);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('SUCCESSFULLY_PATCHED');
} else if (content.includes('process.env.pm_id !== undefined')) {
  console.log('ALREADY_PATCHED');
} else {
  console.log('OLD_CHECK_NOT_FOUND');
}
