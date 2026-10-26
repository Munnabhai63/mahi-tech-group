const fs = require('fs');
const path = require('path');

const publicDir = path.resolve(__dirname, '../public/js');
let errors = 0;
let checked = 0;

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      walk(full);
    } else if (f.endsWith('.js')) {
      const content = fs.readFileSync(full, 'utf8');
      const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          checked++;
          const resolved = path.resolve(dir, importPath);
          const candidates = [resolved, resolved + '.js', path.join(resolved, 'index.js')];
          const exists = candidates.some(c => fs.existsSync(c));
          if (!exists) {
            console.error('Missing module in', path.relative(path.resolve(__dirname, '..'), full), '->', importPath);
            errors++;
          }
        }
      }
    }
  }
}

walk(publicDir);
console.log(`Checked ${checked} local module import statements.`);
if (errors === 0) {
  console.log('All frontend ES module imports resolved 100% cleanly!');
} else {
  console.error(`Found ${errors} unresolved import errors.`);
  process.exit(1);
}
