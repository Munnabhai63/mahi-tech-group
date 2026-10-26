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
const manifest = [];

// App-level routes from src/app.js
manifest.push({
  method: 'GET',
  fullPath: '/api/health',
  auth: 'None (Public)',
  handlerFile: 'src/app.js'
});
manifest.push({
  method: 'GET',
  fullPath: '/api/debug/error-test',
  auth: 'None (Public)',
  handlerFile: 'src/app.js'
});

for (const m of mounts) {
  const filePath = path.join(routesDir, m.file);
  if (!fs.existsSync(filePath)) continue;

  const content = fs.readFileSync(filePath, 'utf8');

  // Match router.<method>(pathOrArray, ...args)
  const regex = /router\.(get|post|patch|put|delete)\s*\(\s*(\[[^\]]+\]|['"`][^'"`]+['"`])\s*,([\s\S]*?)(?=\n\s*(?:router\.|export|module|\/\/|\/\*|$))/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const rawPaths = match[2];
    const argsBlock = match[3];

    let paths = [];
    if (rawPaths.startsWith('[')) {
      paths = rawPaths.replace(/[\[\]'"`\s]/g, '').split(',').filter(Boolean);
    } else {
      paths = [rawPaths.replace(/['"`\s]/g, '')];
    }

    for (const p of paths) {
      let fullPath;
      if (m.prefix === '/api' && m.file === 'dashboard.js') {
        // Only include paths meant for /api mount (notifications, activity)
        if (p.startsWith('/notifications') || p.startsWith('/activity') || p.startsWith('/banners')) {
          fullPath = `/api${p}`;
        } else {
          continue; // Don't duplicate /summary or /kanban under /api if they are primarily /api/dashboard
        }
      } else if (m.prefix === '/api/dashboard' && m.file === 'dashboard.js') {
        if (p.startsWith('/notifications') || p.startsWith('/activity')) {
          continue; // Don't create /api/dashboard/notifications duplicate
        }
        fullPath = `${m.prefix}${p === '/' ? '' : p}`;
      } else {
        fullPath = `${m.prefix}${p === '/' ? '' : p}`;
      }

      if (manifest.some(r => r.method === method && r.fullPath === fullPath)) {
        continue;
      }

      // Middlewares
      const mw = [];
      if (m.file === 'admin.js') {
        mw.push('authenticate', "requireRole('admin')");
      } else if (m.file === 'superadmin.js') {
        mw.push('authenticate', "requireRole('admin')");
      }

      if (argsBlock.includes('authenticate') && !mw.includes('authenticate')) {
        mw.push('authenticate');
      }
      const roleMatch = argsBlock.match(/requireRole\(([^)]+)\)/);
      if (roleMatch && !mw.some(x => x.includes('requireRole'))) {
        mw.push(`requireRole(${roleMatch[1].trim()})`);
      }
      const permMatch = argsBlock.match(/requirePermission\(([^)]+)\)/);
      if (permMatch) {
        mw.push(`requirePermission(${permMatch[1].trim()})`);
      }
      if (argsBlock.includes('upload.')) {
        const u = argsBlock.match(/upload\.[a-zA-Z0-9_]+\([^)]*\)/);
        if (u) mw.push(u[0]);
      }

      const authStr = mw.length > 0 ? mw.join(', ') : 'None (Public)';

      manifest.push({
        method,
        fullPath,
        auth: authStr,
        handlerFile: `src/routes/${m.file}`
      });
    }
  }
}

// Sort alphabetically by fullPath then method
manifest.sort((a, b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method));

fs.writeFileSync(path.resolve(__dirname, 'route-manifest.json'), JSON.stringify(manifest, null, 2));

// Generate markdown table
let md = '| METHOD | Full Path | Auth Middleware | Handler File |\n';
md += '|---|---|---|---|\n';
for (const r of manifest) {
  md += `| \`${r.method}\` | \`${r.fullPath}\` | ${r.auth} | \`${r.handlerFile}\` |\n`;
}

fs.writeFileSync(path.resolve(__dirname, 'route-manifest.md'), md);
console.log(`Successfully generated manifest with ${manifest.length} unique endpoints in JSON and Markdown!`);
