import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_SHA = {
  'public/app.html': '93f3922ba731304f5d3bcd53df787cee35bcd8266b70ff43da115d28a6148fa3',
  'public/index.html': '0164f691c7cbb06f58c4e42c0701398c44bf88585a750522a83a5295ceb70d53',
  'public/assets/brand/favicon.svg': '0099125cbee72c71eee5bff084a04cf36080fe0f581ce9376c549d1457b38c97',
  'public/css/application.css': '2ef03646224cf5d0e6cc27cc6e507b34a33a1fdacc989826162dd285b5ef5816',
  'public/css/hero-studio.css': 'ebcea565fadea173266b9ff0c76a7b7f6937bf94dabf73fa107537c1ccf79e5f',
  'public/css/homepage-studio.css': '39c755914e7d773bd0e87b5e9b7d11950ada59f649fe9b1c8f0fcb4995af79d7',
  'public/css/site.css': 'f0c203c6b4a2acc8613e954a8a3bc167a9b27a22019f61a989f404bfb666b419',
  'public/js/app/data.js': '9573862f07623624d6a8d02fc727b0bcfae6ef96861f2358c337507fb157fea8',
  'public/js/app/index.js': 'fdaf7a95f864bd46f60ec05c03d965f53448daf330eba09948c0fbd12356a72a',
  'public/js/app/shell.js': '7958dd87eb9368fb18ade55842f131f107fda821892f14aa389a5cc437655189',
  'public/js/app/store.js': '36be90bb03b945fc79fa237602048abd07e44dffb3dda7df835a9572ad8c1547',
  'public/js/app/ui.js': 'ea5b338f985af9e047077beda53fbc6ad49cb21a909a2145313cf7798ca1422f',
  'public/js/app/views/admin.js': '7d1edbc9edb0242f201c879b94bdedb60c83a35078f66e307d763c7f6b87bb51',
  'public/js/app/views/disputes.js': 'af280aae1cd300757dc60a95bc3ff5da03d463b81bc28e28c67cbddee62ec8eb',
  'public/js/app/views/ideas.js': '3d495dc85ae97ac356fc93864b73a85c59454fd5e730d1840609639c31c759f9',
  'public/js/app/views/meetings.js': '1e99a7888037b3897279272895724855757e37c1d2c1393638814773ab8ef71d',
  'public/js/app/views/member.js': '5d6a18e598c6076fb902da2fb56417115597b1786ea6aeb2ca3935499f17dd2e',
  'public/js/app/views/projects.js': 'b9d1a8b16267225be197784cda5958b2b0d262ed6e60d69aa7bf357c4846814c',
  'public/js/app/views/public.js': 'c9ca1d5f7dc4f490acbeaa91b2f6d964017c59c00d9ca1e10a2c85b1367486b6',
  'public/js/app/views/signing.js': '33d446a1402c0bf62ebec6f7283d0dc0d2a121e517454f974bf1b560dbe1b888',
  'public/js/app/views/superadmin.js': 'aaee55fe1d406d4db67533d86b22338c7cd99a323c5444f1123579eaf36fca7d',
  'public/js/data/home.js': '18a09355f534f3c610e99ca378c46addbf4de46d1f59dc2dcab8e7a070c1e66d',
  'public/js/data/site.js': '5cfa36facb2ee699ffe4caf633f97b1629b989db513ee2c0e33c9309e66b0359',
  'public/js/pages/home.js': 'f800da428a0403d32d01fe4beff211fe6ba4106ff3fe247e3e3e4a7d4e7f7aa0'
};

console.log('Fetching staged-final.diff from origin/Oviaxe-UI...');
const rawDiff = execSync(
  'git show origin/Oviaxe-UI:Oviaxe-UI/mahi-delivery-audit/staged-final.diff',
  { maxBuffer: 50 * 1024 * 1024 }
).toString('utf8');

const chunks = rawDiff.split('diff --git ');

// 1. Process all new text files
let matchCount = 0;
let fileCount = 0;

for (let i = 1; i < chunks.length; i++) {
  const chunk = chunks[i];
  const headerMatch = chunk.match(/^a\/([^\s]+)\s+b\/([^\s]+)/);
  if (!headerMatch) continue;
  const filePath = headerMatch[2];

  if (chunk.includes('Binary files')) {
    console.log(`Skipping binary file: ${filePath}`);
    continue;
  }

  let fileContent = '';

  if (chunk.includes('new file mode')) {
    const lines = chunk.split('\n');
    const contentLines = [];
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith('@@ ')) {
        inHunk = true;
        continue;
      }
      if (inHunk && line.startsWith('+')) {
        contentLines.push(line.slice(1));
      }
    }
    fileContent = contentLines.join('\n') + '\n';
  } else if (filePath === 'public/index.html') {
    // Modified file - reconstruct from hunk context + additions
    const lines = chunk.split('\n');
    const newLines = ['<!DOCTYPE html>', '<html lang="en">'];
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith('@@ ')) {
        inHunk = true;
        continue;
      }
      if (inHunk) {
        if (line.startsWith(' ') || line.startsWith('+')) {
          newLines.push(line.slice(1));
        }
      }
    }
    fileContent = newLines.join('\n') + '\n';
  } else {
    console.log(`Unknown modification type for: ${filePath}`);
    continue;
  }

  const hash = crypto.createHash('sha256').update(fileContent).digest('hex');
  const expectedHash = TARGET_SHA[filePath];

  fileCount++;
  if (expectedHash) {
    if (hash === expectedHash) {
      console.log(`✓ [SHA MATCH] ${filePath}`);
      matchCount++;
    } else {
      console.error(`✗ [SHA MISMATCH] ${filePath}: got ${hash}, expected ${expectedHash}`);
    }
  } else {
    console.log(`ℹ [NEW FILE] ${filePath} (${hash.slice(0, 8)})`);
  }

  // Ensure directory exists and write
  const fullPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, fileContent, 'utf8');
}

console.log(`\nExtracted ${fileCount} files. SHA256 verified matches: ${matchCount}/${Object.keys(TARGET_SHA).length}`);
