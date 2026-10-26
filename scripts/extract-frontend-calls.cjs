const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'route-manifest.json'), 'utf8'));

// Helper to normalize route pattern: replace parameter tokens with :param
function normalizePath(p) {
  return p
    .replace(/\/+/g, '/')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:[a-zA-Z0-9_]+/g, ':param');
}

const appDir = path.resolve(__dirname, '../public/js/app');
const files = [];

function walk(dir) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      walk(full);
    } else if (item.endsWith('.js')) {
      files.push(full);
    }
  }
}
walk(appDir);

const frontendCalls = [];

for (const file of files) {
  const relFile = path.relative(path.resolve(__dirname, '..'), file).replace(/\\/g, '/');
  const code = fs.readFileSync(file, 'utf8');

  // Match api.get, api.post, api.patch, api.put, api.delete
  // Or fetchWithAuth(...) or fetch(...)
  const regex = /\b(?:api|window\.api)\.(get|post|patch|put|delete)\s*\(\s*(['"`])([^'"`\n]+)\2/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    const method = match[1].toUpperCase();
    const rawPath = match[3];
    frontendCalls.push({
      method,
      rawPath,
      file: relFile
    });
  }

  // Also check direct fetch or api() calls
  const fetchRegex = /\b(?:fetch|fetchWithAuth)\s*\(\s*(['"`])([^'"`\n]+)\1/g;
  while ((match = fetchRegex.exec(code)) !== null) {
    const rawPath = match[2];
    if (rawPath.startsWith('/api') || rawPath.startsWith('api')) {
      frontendCalls.push({
        method: 'GET', // or inferred
        rawPath,
        file: relFile
      });
    }
  }
}

console.log(`Found ${frontendCalls.length} frontend API calls.`);

// Now reconcile against manifest
const reconciliation = [];

for (const call of frontendCalls) {
  const normCallPath = normalizePath(call.rawPath.split('?')[0]);
  
  // Try to find matching route in manifest
  const match = manifest.find(m => {
    if (m.method !== call.method) return false;
    const normManifest = normalizePath(m.fullPath);
    return normCallPath === normManifest;
  });

  let verdict = 'NOT_IN_BACKEND';
  let matchedBackend = null;

  if (match) {
    verdict = 'MATCH';
    matchedBackend = match.fullPath;
  } else {
    // Check if path exists under another method (MISMATCH)
    const methodMismatch = manifest.find(m => {
      return normalizePath(m.fullPath) === normCallPath;
    });
    if (methodMismatch) {
      verdict = 'MISMATCH (METHOD)';
      matchedBackend = `${methodMismatch.method} ${methodMismatch.fullPath}`;
    } else {
      // Check if path exists with different prefix or spelling
      const similar = manifest.find(m => {
        const lastPartCall = normCallPath.split('/').pop();
        const lastPartManifest = normalizePath(m.fullPath).split('/').pop();
        return lastPartCall === lastPartManifest && lastPartCall !== ':param';
      });
      if (similar) {
        verdict = 'MISMATCH (PATH)';
        matchedBackend = `${similar.method} ${similar.fullPath}`;
      }
    }
  }

  reconciliation.push({
    file: call.file,
    method: call.method,
    frontendPath: call.rawPath,
    verdict,
    matchedBackend
  });
}

fs.writeFileSync(path.resolve(__dirname, 'reconciliation.json'), JSON.stringify(reconciliation, null, 2));

// Filter unique by method + frontendPath
const unique = [];
const seen = new Set();
for (const r of reconciliation) {
  const key = `${r.method} ${r.frontendPath}`;
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(r);
  }
}

console.log(`Unique frontend endpoints called: ${unique.length}`);
let mismatches = unique.filter(u => u.verdict !== 'MATCH');
console.log(`Mismatches / Not in backend: ${mismatches.length}`);
console.log(JSON.stringify(mismatches, null, 2));
