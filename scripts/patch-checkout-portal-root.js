import fs from 'node:fs';

const filePath = '/var/www/ovipay/apps/checkout-portal/src/server.js';
let content = fs.readFileSync(filePath, 'utf8');

const regex = /\/\/\s*Not found[\s\r\n]*res\.writeHead\(404[^)]*\);[\s\r\n]*res\.end\(['"]Checkout Page Not Found['"]\);/;

const replacement = `// Root Landing Portal: GET /
      if (pathname === '/' || pathname === '') {
        const portalPath = path.join(__dirname, 'views', 'portal.html');
        if (fs.existsSync(portalPath)) {
          const html = fs.readFileSync(portalPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
            ...BASE_SECURITY_HEADERS
          });
          res.end(html);
          return;
        }
      }

      // Not found
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Checkout Page Not Found');`;

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('PORTAL_ROOT_PATCHED_SUCCESSFULLY');
} else {
  console.log('REGEX_NOT_FOUND');
}
