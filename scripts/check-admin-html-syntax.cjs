const fs = require('fs');
const vm = require('vm');

const filePath = 'F:\\UserData\\Downloads\\ai-power-tools\\YouPI-PG\\apps\\merchant-admin\\src\\views\\admin.html';
const content = fs.readFileSync(filePath, 'utf8');

// Replace template placeholders like {{API_BASE_URL}}
const cleanContent = content.replaceAll('{{API_BASE_URL}}', '');

const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let index = 0;

while ((match = scriptRegex.exec(cleanContent)) !== null) {
  index++;
  const scriptCode = match[1];
  console.log(`Checking Script #${index}... length: ${scriptCode.length}`);
  try {
    new vm.Script(scriptCode, { filename: `admin.html:script_${index}.js` });
    console.log(`Script #${index} PASSED syntax check.`);
  } catch (err) {
    console.error(`Script #${index} FAILED syntax check:`);
    console.error(err);
  }
}
