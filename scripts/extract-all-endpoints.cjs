const fs = require('fs');
const path = require('path');

const mounts = {
  'auth.js': '/api/auth',
  'sign.js': '/api/sign',
  'admin.js': '/api/admin',
  'superadmin.js': '/api/superadmin',
  'users.js': '/api/users',
  'ideas.js': '/api/ideas',
  'projects.js': '/api/projects',
  'tasks.js': '/api/tasks',
  'withdrawals.js': '/api/withdrawals',
  'coworking.js': '/api/coworking-rooms',
  'meetings.js': '/api/meetings',
  'dashboard.js': '/api/dashboard'
};

const routesDir = path.join(__dirname, '..', 'src', 'routes');
const files = fs.readdirSync(routesDir);

const results = [];

files.forEach(f => {
  if (!f.endsWith('.js')) return;
  const mount = mounts[f] || '/api';
  const content = fs.readFileSync(path.join(routesDir, f), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const singleMatch = line.match(/router\.(get|post|patch|put|delete)\(\s*['"]([^'"]+)['"]/i);
    const arrayMatch = line.match(/router\.(get|post|patch|put|delete)\(\s*\[([^\]]+)\]/i);
    if (singleMatch) {
      const p = singleMatch[2] === '/' ? mount : (mount + (singleMatch[2].startsWith('/') ? singleMatch[2] : '/' + singleMatch[2]));
      results.push({ file: f, line: i + 1, method: singleMatch[1].toUpperCase(), route: p });
    } else if (arrayMatch) {
      const paths = arrayMatch[2].split(',').map(s => s.trim().replace(/['"]/g, ''));
      paths.forEach(sub => {
        const p = sub.startsWith('/api') ? sub : (mount + (sub.startsWith('/') ? sub : '/' + sub));
        results.push({ file: f, line: i + 1, method: arrayMatch[1].toUpperCase(), route: p });
      });
    }
  });
});

fs.writeFileSync(path.join(__dirname, 'all-endpoints.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('Saved', results.length, 'endpoints to all-endpoints.json');
