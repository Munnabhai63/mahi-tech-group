const fs = require('fs');
const path = require('path');

const mounts = [
  { prefix: '/api/auth', file: 'auth.js' },
  { prefix: '/api/sign', file: 'sign.js' },
  { prefix: '/api/admin', file: 'admin.js' },
  { prefix: '/api/superadmin', file: 'superadmin.js' },
  { prefix: '/api/users', file: 'users.js' },
  { prefix: '/api/ideas', file: 'ideas.js' },
  { prefix: '/api/projects', file: 'projects.js' },
  { prefix: '/api/tasks', file: 'tasks.js' },
  { prefix: '/api/withdrawals', file: 'withdrawals.js' },
  { prefix: '/api/coworking-rooms', file: 'coworking.js' },
  { prefix: '/api/meetings', file: 'meetings.js' },
  { prefix: '/api/dashboard', file: 'dashboard.js' },
  { prefix: '/api', file: 'dashboard.js' }
];

const routesDir = path.resolve(__dirname, '../src/routes');

const allEndpoints = [];

// Also app-level endpoints in app.js
allEndpoints.push({
  method: 'GET',
  path: '/api/health',
  auth: 'none',
  file: 'src/app.js'
});
allEndpoints.push({
  method: 'GET',
  path: '/api/debug/error-test',
  auth: 'none',
  file: 'src/app.js'
});

for (const m of mounts) {
  const filePath = path.join(routesDir, m.file);
  if (!fs.existsSync(filePath)) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Check top-level router.use in the file
  let fileWideAuth = [];
  if (m.file === 'admin.js') {
    // router.use(authenticate)
  }
  if (m.file === 'superadmin.js') {
    fileWideAuth.push('authenticate', "requireRole('admin')");
  }

  // Regex to find router.METHOD(path, middleware..., handler)
  // We can match multiline router.(get|post|patch|put|delete)
  const regex = /router\.(get|post|patch|put|delete)\s*\(\s*(['"`])([^'"`]+)\2\s*,([\s\S]*?)(?=\n\s*(?:router\.|export|module|\/\/|\/\*|$))/g;
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const relPath = match[3];
    const argsBlock = match[4];

    // Determine full path
    let fullPath;
    if (relPath === '/') {
      fullPath = m.prefix;
    } else if (relPath.startsWith('/')) {
      fullPath = `${m.prefix}${relPath}`;
    } else {
      fullPath = `${m.prefix}/${relPath}`;
    }

    // Clean double slashes
    fullPath = fullPath.replace(/\/+/g, '/');

    // If m.prefix is '/api' and file is dashboard.js, only include routes intended for '/api'
    // in app.js: app.use('/api', dashboardRouter) covers /api/notifications and /api/activity
    if (m.prefix === '/api') {
      if (!relPath.startsWith('/notifications') && !relPath.startsWith('/activity')) {
        continue; // skip duplicate mounts for /dashboard routes
      }
    }
    if (m.prefix === '/api/dashboard') {
      if (relPath.startsWith('/notifications') || relPath.startsWith('/activity')) {
        continue; // skip mounting notifications under /api/dashboard
      }
    }

    // Check middlewares in argsBlock
    const middlewares = [...fileWideAuth];
    if (argsBlock.includes('authenticate')) middlewares.push('authenticate');
    if (argsBlock.includes('requireRole')) {
      const roleMatch = argsBlock.match(/requireRole\((['"`])([^'"`]+)\1\)/);
      if (roleMatch) middlewares.push(`requireRole('${roleMatch[2]}')`);
      else middlewares.push('requireRole');
    }
    if (argsBlock.includes('requirePermission')) {
      const permMatch = argsBlock.match(/requirePermission\((['"`])([^'"`]+)\1\)/);
      if (permMatch) middlewares.push(`requirePermission('${permMatch[2]}')`);
      else middlewares.push('requirePermission');
    }
    if (argsBlock.includes('preventSelfAction')) middlewares.push('preventSelfAction');

    const authStr = middlewares.length ? [...new Set(middlewares)].join(', ') : 'none';

    allEndpoints.push({
      method,
      path: fullPath,
      auth: authStr,
      file: `src/routes/${m.file}`
    });
  }
}

// Remove duplicates if any
const seen = new Set();
const uniqueEndpoints = [];
for (const ep of allEndpoints) {
  const key = `${ep.method} ${ep.path}`;
  if (!seen.has(key)) {
    seen.add(key);
    uniqueEndpoints.push(ep);
  }
}

console.log(JSON.stringify(uniqueEndpoints, null, 2));
console.log(`Total unique endpoints: ${uniqueEndpoints.length}`);
