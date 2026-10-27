import { execSync } from 'node:child_process';
import fs from 'node:fs';

const testFiles = [
  'run-all-clarification-tests.js',
  'run-step01-amendment-tests.js',
  'run-step2-tests.js',
  'run-step3-tests.js',
  'run-step4-tests.js',
  'run-step04-amendment-tests.js',
  'run-step5-tests.js',
  'run-step6-tests.js',
  'run-step7-tests.js',
  'run-step08-tests.js',
  'run-step08-revision-tests.js',
  'run-step08-followup-tests.js',
  'run-step09-profile-tests.js',
  'run-step10-admin-tests.js',
  'run-step11-coworking-tests.js',
  'run-step12-meeting-tests.js',
  'run-step13-final-qa-tests.js',
  'run-step14-superadmin-tests.js'
];

const results = [];

for (const file of testFiles) {
  process.stdout.write(`Testing ${file} ... `);
  try {
    const out = execSync(`node scripts/${file}`, { timeout: 60000, stdio: 'pipe' }).toString();
    console.log('PASS');
    results.push({ file, status: 'PASS', details: 'All tests passed cleanly' });
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : '';
    const stderr = err.stderr ? err.stderr.toString() : '';
    const combined = (stdout + '\n' + stderr).trim();
    const lastErrorLine = combined.split('\n').filter(l => l.includes('Error') || l.includes('FAIL') || l.includes('❌')).slice(-3).join(' | ');
    console.log(`FAIL: ${lastErrorLine || err.message}`);
    results.push({ file, status: 'FAIL', details: lastErrorLine || err.message });
  }
  // Brief pause to allow socket to fully close
  execSync('node -e "setTimeout(() => {}, 1000)"');
}

fs.writeFileSync('scripts/comprehensive-test-report.json', JSON.stringify(results, null, 2));
console.log('\n=== COMPREHENSIVE TEST REPORT SAVED ===');
console.table(results);
