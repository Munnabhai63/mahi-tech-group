const fs = require('fs');
const vm = require('vm');

const localPath = 'F:\\UserData\\Downloads\\ai-power-tools\\YouPI-PG\\apps\\merchant-admin\\src\\views\\admin.html';
let content = fs.readFileSync(localPath, 'utf8');

// Replace the broken isProtected line
const brokenLine = 'return (//api/v1/admin//.test(url) || //api/services/.test(url) || //api/admin/tickets/.test(url)) && !//admin/sms-gateway/download-apk/.test(url);';
const fixedLine = 'return (\\/\\/api\\/v1\\/admin\\/\\/.test(url) || \\/\\/api\\/services\\/.test(url) || \\/\\/api\\/admin\\/tickets\\/.test(url)) && !\\/\\/admin\\/sms-gateway\\/download-apk\\/.test(url);';

// Actually, in JS code in a string literal, we need:
// return (/\/api\/v1\/admin\//.test(url) || /\/api\/services/.test(url) || /\/api\/admin\/tickets/.test(url)) && !/\/admin\/sms-gateway\/download-apk/.test(url);
const properJsLine = 'return (/\\/api\\/v1\\/admin\\//.test(url) || /\\/api\\/services/.test(url) || /\\/api\\/admin\\/tickets/.test(url)) && !/\\/admin\\/sms-gateway\\/download-apk/.test(url);';

// Let's replace whatever is inside function isProtected(url) { ... }
const isProtectedRegex = /function\s+isProtected\s*\(\s*url\s*\)\s*\{[\s\S]*?\}/;
const fixedIsProtected = `function isProtected(url) {
        return (url.includes('/api/v1/admin/') || url.includes('/api/services') || url.includes('/api/admin/tickets')) && !url.includes('/admin/sms-gateway/download-apk');
      }`;

if (!isProtectedRegex.test(content)) {
  console.error("isProtectedRegex not found!");
  process.exit(1);
}

content = content.replace(isProtectedRegex, fixedIsProtected);
fs.writeFileSync(localPath, content, 'utf8');
console.log("Successfully fixed isProtected in admin.html!");

// Now test syntax!
const cleanContent = content.replaceAll('{{API_BASE_URL}}', '');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let index = 0;
let hasError = false;

while ((match = scriptRegex.exec(cleanContent)) !== null) {
  index++;
  const scriptCode = match[1];
  try {
    new vm.Script(scriptCode, { filename: `admin.html:script_${index}.js` });
    console.log(`Script #${index} PASSED syntax check.`);
  } catch (err) {
    hasError = true;
    console.error(`Script #${index} FAILED syntax check:`, err.message);
  }
}

if (!hasError) {
  console.log("ALL SCRIPTS IN ADMIN.HTML PASSED SYNTAX CHECK 100%!");
}
