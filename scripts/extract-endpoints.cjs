const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'src', 'routes');
const files = fs.readdirSync(routesDir);

const results = [];

files.forEach(f => {
  if (!f.endsWith('.js')) return;
  const content = fs.readFileSync(path.join(routesDir, f), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const singleMatch = line.match(/router\.(get|post|patch|put|delete)\(\s*['"]([^'"]+)['"]/i);
    const arrayMatch = line.match(/router\.(get|post|patch|put|delete)\(\s*\[([^\]]+)\]/i);
    if (singleMatch) {
      results.push({ file: f, line: i + 1, method: singleMatch[1].toUpperCase(), path: singleMatch[2] });
    } else if (arrayMatch) {
      const paths = arrayMatch[2].split(',').map(s => s.trim().replace(/['"]/g, ''));
      paths.forEach(p => results.push({ file: f, line: i + 1, method: arrayMatch[1].toUpperCase(), path: p }));
    }
  });
});

console.log(JSON.stringify(results, null, 2));
