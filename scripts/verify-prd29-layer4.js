/**
 * Verification Script for PRD 29: Layer 4 — Design Consistency & Component Cleanup
 * 
 * Verifies:
 * 1. CSS Design Tokens (spacing grid, status colors, mobile dark theme, typography stacks)
 * 2. Button State Machine (:hover, :active, :focus-visible, :disabled, .is-loading, spinner animation)
 * 3. Table & List Consistency (uniform row heights, cell padding, hover effects, touch scrollable wrappers)
 * 4. Modal & Dialog Consistency (backdrop blur, uniform padding, header/body/footer structure)
 * 5. Responsive Design Breakpoints (@media queries, mobile grid collapse, adaptive tables)
 * 6. Global Component Hygiene & Clean Alert Removal (zero disruptive alerts in client app code)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

console.log('======================================================================');
console.log('🧪 PRD 29 LAYER 4 VERIFICATION: Design Consistency & Component Cleanup');
console.log('======================================================================\n');

// ----------------------------------------------------------------------------
// Suite 1: CSS Design Tokens & Theme Variables
// ----------------------------------------------------------------------------
console.log('--- Suite 1: CSS Design Tokens & Theme Variables ---');
const appCssPath = path.join(ROOT, 'public', 'css', 'application.css');
const appCss = fs.readFileSync(appCssPath, 'utf8');

// 1.1 Spacing tokens
assert(
  appCss.includes('--space-1:4px') && 
  appCss.includes('--space-2:8px') && 
  appCss.includes('--space-4:16px') && 
  appCss.includes('--space-8:32px'),
  '1.1 Standard 4px/8px Spacing Grid tokens defined in :root'
);

// 1.2 Status color tokens
assert(
  appCss.includes('--status-success:var(--green)') && 
  appCss.includes('--status-warning:var(--amber)') && 
  appCss.includes('--status-danger:var(--red)') && 
  appCss.includes('--status-info:var(--cobalt)'),
  '1.2 Semantic status color tokens mapped to cohesive design tokens'
);

// 1.3 Mobile dark theme tokens (aligned with PRD 28 mobile palette)
assert(
  appCss.includes('--bg-dark:#0f172a') && 
  appCss.includes('--surface-dark:#1e293b') && 
  appCss.includes('--accent-sky:#38bdf8'),
  '1.3 Mobile dark palette design tokens present in application.css'
);

// 1.4 Typography font stacks
assert(
  appCss.includes('--font-display') && 
  appCss.includes('--font-serif') && 
  appCss.includes('--font-body') && 
  appCss.includes('--font-mono'),
  '1.4 Complete typography font stacks configured (display, serif, body, mono)'
);

// ----------------------------------------------------------------------------
// Suite 2: Button State Machine & Interaction Feedback
// ----------------------------------------------------------------------------
console.log('\n--- Suite 2: Button State Machine & Interaction Feedback ---');

// 2.1 Hover and Active states
assert(
  appCss.includes('.btn:hover') && appCss.includes('.btn:active'),
  '2.1 Interactive :hover and :active states defined for .btn'
);

// 2.2 Focus visible outline
assert(
  appCss.includes('.btn:focus-visible{outline:3px solid var(--cobalt)'),
  '2.2 Accessible :focus-visible ring defined for keyboard navigation'
);

// 2.3 Disabled state
assert(
  appCss.includes('.btn:disabled,.btn[disabled],.btn.is-disabled') &&
  appCss.includes('cursor:not-allowed!important') &&
  appCss.includes('opacity:.55!important') &&
  appCss.includes('pointer-events:none!important'),
  '2.3 Strict disabled button state (.btn:disabled, [disabled], .is-disabled)'
);

// 2.4 Loading state and spinner animation
assert(
  appCss.includes('.btn.is-loading') &&
  appCss.includes('.btn.is-loading::after') &&
  appCss.includes('animation:btn-spin .6s linear infinite') &&
  appCss.includes('@keyframes btn-spin'),
  '2.4 Loading button state (.btn.is-loading) with animated CSS spinner'
);

// 2.5 Button variant hierarchy
assert(
  appCss.includes('.btn--primary') &&
  appCss.includes('.btn--outline') &&
  appCss.includes('.btn--ghost') &&
  appCss.includes('.btn--danger') &&
  appCss.includes('.btn--lime'),
  '2.5 Button variants implemented across full semantic hierarchy'
);

// ----------------------------------------------------------------------------
// Suite 3: Table & Data Presentation Consistency
// ----------------------------------------------------------------------------
console.log('\n--- Suite 3: Table & Data Presentation Consistency ---');

// 3.1 Table wrapper with touch scrolling
assert(
  appCss.includes('.table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch') &&
  appCss.includes('border-radius:12px'),
  '3.1 Table wrapper (.table-wrap) has 100% width and smooth touch scrolling'
);

// 3.2 Data table typography & padding
assert(
  appCss.includes('.data-table{width:100%;border-collapse:collapse;min-width:720px;font-size:12px}'),
  '3.2 Data table uses border-collapse and minimum width guard'
);

// 3.3 Uniform row height and cell padding
assert(
  appCss.includes('.data-table td{padding:12px 14px;min-height:48px;line-height:1.5') &&
  appCss.includes('.data-table th{text-align:left;padding:12px 14px;min-height:44px'),
  '3.3 Uniform table cell padding (12px 14px) and min-height (48px)'
);

// 3.4 Hover feedback on table rows
assert(
  appCss.includes('.data-table tbody tr:hover{background:#f5f5ed}'),
  '3.4 Subtle row hover highlight defined on tbody tr:hover'
);

// ----------------------------------------------------------------------------
// Suite 4: Modal, Dialog & Overlay Consistency
// ----------------------------------------------------------------------------
console.log('\n--- Suite 4: Modal, Dialog & Overlay Consistency ---');

// 4.1 Modal dialog styling & backdrop blur
assert(
  appCss.includes('.app-dialog{') &&
  appCss.includes('border-radius:18px') &&
  appCss.includes('.app-dialog::backdrop{background:rgba(15,19,15,.65);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}'),
  '4.1 Modal dialog has smooth backdrop blur and uniform rounded corners'
);

// 4.2 Dialog structure (head, body, foot)
assert(
  appCss.includes('.dialog-head{') &&
  appCss.includes('.dialog-body{') &&
  appCss.includes('.dialog-foot{'),
  '4.2 Standard dialog component layout (.dialog-head, .dialog-body, .dialog-foot)'
);

// 4.3 Drawer component consistency
assert(
  appCss.includes('.drawer{') &&
  appCss.includes('.drawer__head{') &&
  appCss.includes('.drawer__body{') &&
  appCss.includes('.drawer__foot{'),
  '4.3 Slide-out drawer component layout (.drawer__head, body, foot)'
);

// ----------------------------------------------------------------------------
// Suite 5: Responsive Design & Viewport Adaptation
// ----------------------------------------------------------------------------
console.log('\n--- Suite 5: Responsive Design & Viewport Adaptation ---');

// 5.1 Media query breakpoints
assert(
  appCss.includes('@media (max-width:1200px)') &&
  appCss.includes('@media (max-width:980px)') &&
  appCss.includes('@media (max-width:720px)') &&
  appCss.includes('@media (max-width:420px)'),
  '5.1 Comprehensive breakpoint tiers defined (1200px, 980px, 720px, 420px)'
);

// 5.2 Mobile form grid collapse
assert(
  appCss.includes('@media (max-width:720px)') &&
  appCss.includes('.form-grid{grid-template-columns:1fr}'),
  '5.2 Form grid collapses gracefully to single-column on mobile viewports'
);

// 5.3 Mobile stat grid adaptation
assert(
  appCss.includes('@media (max-width:720px)') &&
  appCss.includes('.stat-grid{gap:10px}'),
  '5.3 Metric stat grid adapts gracefully on tablet/mobile screens'
);

// 5.4 Mobile dialog width adaptation
assert(
  appCss.includes('@media (max-width:720px)') &&
  appCss.includes('.app-dialog{width:calc(100% - 20px)'),
  '5.4 Dialogs expand to full viewport margins on narrow screens'
);

// ----------------------------------------------------------------------------
// Suite 6: Global Component Hygiene & Clean Alert Removal
// ----------------------------------------------------------------------------
console.log('\n--- Suite 6: Global Component Hygiene & Clean Alert Removal ---');

// 6.1 Check zero alert() in public/js/app/
const appJsDir = path.join(ROOT, 'public', 'js', 'app');
function scanDirForAlerts(dir) {
  let alertCount = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      alertCount += scanDirForAlerts(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const code = fs.readFileSync(fullPath, 'utf8');
      const matches = code.match(/\balert\s*\(/g);
      if (matches) alertCount += matches.length;
    }
  }
  return alertCount;
}

const appJsAlerts = scanDirForAlerts(appJsDir);
assert(appJsAlerts === 0, '6.1 Zero disruptive alert() calls in public/js/app/ modules', `Found ${appJsAlerts}`);

// 6.2 Check zero alert() in superadmin.js role guard
const superadminJsPath = path.join(ROOT, 'public', 'js', 'superadmin.js');
const superadminJs = fs.readFileSync(superadminJsPath, 'utf8');
const superadminHasAlert = /alert\s*\(\s*['"]Access Denied/.test(superadminJs);
assert(!superadminHasAlert, '6.2 superadmin.js role guard redirects gracefully without alert() popup');

// 6.3 Unified toast service availability
const toastJsPath = path.join(ROOT, 'public', 'js', 'toast.js');
const toastJs = fs.readFileSync(toastJsPath, 'utf8');
assert(
  toastJs.includes('export function showToast') &&
  toastJs.includes('window.showToast = showToast') &&
  toastJs.includes('window.toast = showToast'),
  '6.3 Unified Toast notification service is globally registered'
);

// 6.4 Accessible offline network banner
assert(
  appCss.includes('.offline-banner') &&
  appCss.includes('position: sticky') &&
  appCss.includes('z-index: 10000'),
  '6.4 Offline network notification banner styled and pinned to viewport top'
);

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log('\n======================================================================');
console.log(`📊 LAYER 4 VERIFICATION RESULTS: ${passedTests}/${totalTests} PASS (${((passedTests/totalTests)*100).toFixed(1)}%)`);
console.log('======================================================================');

if (failedTests > 0) {
  console.error(`❌ ${failedTests} test(s) failed in Layer 4.`);
  process.exit(1);
} else {
  console.log('🎉 Layer 4 (Design Consistency & Component Cleanup) 100% Verified!');
  process.exit(0);
}
