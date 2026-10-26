const { execSync } = require('child_process');

const diff = execSync('git show 816c0bd', { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });

// Check for live tokens or secrets
const sensitivePatterns = [
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /eyJhbGciOi[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}/,
  /live_[a-zA-Z0-9]{24,}/
];

let leaks = [];
for (const pat of sensitivePatterns) {
  const match = diff.match(pat);
  if (match) leaks.push(match[0]);
}

console.log('Detected credentials/tokens in diff:', leaks.length ? leaks : 'NONE (100% CLEAN)');

// Check file list for test-output files (.log, .sqlite, .png, etc.)
const files = execSync('git diff-tree --no-commit-id --name-only -r 816c0bd', { encoding: 'utf8' }).trim().split('\n');
console.log(`\nTotal files committed: ${files.length}`);

const testOutputExts = ['.sqlite', '.log', '.png', '.jpg', '.webm', '.tmp'];
const testOutputFiles = files.filter(f => testOutputExts.some(ext => f.endsWith(ext)));
console.log('Test output files committed:', testOutputFiles.length ? testOutputFiles : 'NONE (100% CLEAN)');
