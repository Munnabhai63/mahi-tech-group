/**
 * scripts/verify-prd26-layer6.js
 * Verification Suite for PRD 26 Layer 6: Frontend Views
 *
 * Verifies:
 * 1. All 5 required views exist in public/
 * 2. Proper HTML5 structure, metadata, Google Fonts, and design system tokens
 * 3. Consistent subnavigation across all 5 views with correct active classes
 * 4. Correct API endpoints referenced in each client-side script
 * 5. Critical UI components: tables, modals, filters, wizard steps, buttons
 */

import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  }
}

console.log('\n======================================================');
console.log('🧪 PRD 26 LAYER 6: FRONTEND VIEWS VERIFICATION SUITE');
console.log('======================================================\n');

const REQUIRED_FILES = [
  'automation-rules.html',
  'automation-builder.html',
  'automation-history.html',
  'automation-errors.html',
  'automation-templates.html'
];

console.log('--- 1. File Existence & Integrity ---');
const fileContents = {};
for (const file of REQUIRED_FILES) {
  const fullPath = path.join(PUBLIC_DIR, file);
  const exists = fs.existsSync(fullPath);
  assert(exists, `View file exists: public/${file}`);
  if (exists) {
    const content = fs.readFileSync(fullPath, 'utf8');
    assert(content.length > 500, `File content is non-empty (${content.length} bytes): public/${file}`);
    fileContents[file] = content;
  }
}

console.log('\n--- 2. Design Tokens, Typography & Meta Standards ---');
for (const file of REQUIRED_FILES) {
  const content = fileContents[file] || '';
  assert(content.includes('<!DOCTYPE html>'), `${file}: Contains valid DOCTYPE html`);
  assert(content.includes('<meta name="viewport"'), `${file}: Contains responsive viewport meta tag`);
  assert(content.includes('family=Inter') && content.includes('family=Outfit'), `${file}: Imports Inter & Outfit design fonts`);
  assert(content.includes('--bg-dark: #090d16'), `${file}: Uses MAHI brand dark theme token (--bg-dark: #090d16)`);
  assert(content.includes('--color-primary: #38bdf8'), `${file}: Uses primary accent token (#38bdf8)`);
}

console.log('\n--- 3. Subnavigation Consistency ---');
for (const file of REQUIRED_FILES) {
  const content = fileContents[file] || '';
  assert(content.includes('href="/automation-rules.html"'), `${file}: Links to Rules view`);
  assert(content.includes('href="/automation-builder.html"'), `${file}: Links to Builder view`);
  assert(content.includes('href="/automation-history.html"'), `${file}: Links to Run History view`);
  assert(content.includes('href="/automation-errors.html"'), `${file}: Links to Error Center view`);
  assert(content.includes('href="/automation-templates.html"'), `${file}: Links to Templates view`);
  assert(content.includes('href="/app.html"'), `${file}: Links back to Dashboard`);
}

console.log('\n--- 4. View 1: Automation Rules (automation-rules.html) ---');
{
  const c = fileContents['automation-rules.html'] || '';
  assert(c.includes('id="rulesTable"'), 'Rules table container exists');
  assert(c.includes('id="statTotalRules"') && c.includes('id="statActiveRules"'), 'KPI stat cards exist (total, active)');
  assert(c.includes('/api/automation/rules'), 'Fetches rules via /api/automation/rules');
  assert(c.includes('/toggle'), 'Implements rule toggle via /toggle endpoint');
  assert(c.includes('id="deleteModal"'), 'Contains rule deletion confirmation modal');
}

console.log('\n--- 5. View 2: Visual Builder (automation-builder.html) ---');
{
  const c = fileContents['automation-builder.html'] || '';
  assert(c.includes('id="step1"') && c.includes('id="step2"') && c.includes('id="step3"') && c.includes('id="step4"'), 'Multi-step wizard defined (Steps 1 to 4)');
  assert(c.includes('triggerModule') && c.includes('triggerEvent'), 'Trigger module and event selectors present');
  assert(c.includes('conditionLogic') && c.includes('addConditionRow'), 'Conditional logic builder (AND/OR, dynamic rows)');
  assert(c.includes('id="actionsList"') && c.includes('addAction('), 'Declarative action pipeline builder');
  assert(c.includes('/api/automation/rule/create'), 'Submits new rule to /api/automation/rule/create');
  assert(c.includes('/test'), 'Features dry-run testing simulation via /test endpoint');
}

console.log('\n--- 6. View 3: Run History (automation-history.html) ---');
{
  const c = fileContents['automation-history.html'] || '';
  assert(c.includes('id="historyTbody"'), 'Run history table body present');
  assert(c.includes('id="statusFilter"'), 'Status filter dropdown present (SUCCESS, PARTIAL, FAILED, SKIPPED)');
  assert(c.includes('id="detailModal"'), 'Drilldown execution modal exists');
  assert(c.includes('modalConditions') && c.includes('modalActions') && c.includes('modalVariables'), 'Drilldown displays conditions, actions, and resolved variables');
  assert(c.includes('/api/automation/logs'), 'Queries logs via /api/automation/logs');
  assert(c.includes('/api/automation/log/'), 'Queries detailed run log via /api/automation/log/:id');
}

console.log('\n--- 7. View 4: Error Center (automation-errors.html) ---');
{
  const c = fileContents['automation-errors.html'] || '';
  assert(c.includes('id="statUnack"') && c.includes('id="statAck"'), 'Error KPI counters present (Unack, Ack)');
  assert(c.includes('id="errorTbody"'), 'Error fault table body present');
  assert(c.includes('tabUnack') && c.includes('tabAck'), 'Fault triage tabs (Active Faults vs Resolved Archive)');
  assert(c.includes('/api/automation/errors'), 'Queries errors via /api/automation/errors');
  assert(c.includes('/acknowledge'), 'Implements acknowledge via /acknowledge endpoint');
  assert(c.includes('/retry'), 'Implements retry via /retry endpoint');
}

console.log('\n--- 8. View 5: Template Library (automation-templates.html) ---');
{
  const c = fileContents['automation-templates.html'] || '';
  assert(c.includes('id="templateGrid"'), 'Template card grid present');
  assert(c.includes('id="categoryTabs"'), 'Category filter tabs present');
  assert(c.includes('id="deployModal"'), 'Deploy template to project modal present');
  assert(c.includes('id="saveModal"'), 'Create custom blueprint modal present');
  assert(c.includes('/api/automation/templates'), 'Queries templates via /api/automation/templates');
  assert(c.includes('/use'), 'Deploys template via /api/automation/template/:id/use');
  assert(c.includes('/api/automation/template/save'), 'Saves custom blueprint via /api/automation/template/save');
}

console.log('\n======================================================');
console.log(`📊 VERIFICATION SUMMARY: ${passedAssertions}/${totalAssertions} Assertions Passed`);
console.log('======================================================\n');

if (passedAssertions === totalAssertions) {
  console.log('🎉 PRD 26 LAYER 6 (FRONTEND VIEWS) VERIFIED 100% COMPLETE & PASSING!\n');
  process.exit(0);
} else {
  console.error('❌ SOME LAYER 6 CHECKS FAILED!\n');
  process.exit(1);
}
