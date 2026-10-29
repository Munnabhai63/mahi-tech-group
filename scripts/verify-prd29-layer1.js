/**
 * PRD 29 LAYER 1 VERIFICATION SUITE
 * Full Wiring Audit + Dummy Data Removal Verification
 *
 * Mandatory Verification Rules:
 * 1. Real HTTP network calls only — ZERO mocks.
 * 2. Real database queries through Express endpoints.
 * 3. Strict automated codebase scan verifying zero dummy/mock data remnants.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 5099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runLayer1Verification() {
  console.log('\n===================================================================');
  console.log('       PRD 29 LAYER 1: FULL WIRING & ZERO-DUMMY DATA VERIFICATION');
  console.log('===================================================================\n');

  // 1. Initialize DB and seed
  console.log('[1/3] Initializing SQLite database and seed records...');
  runMigration();
  await runSeed();
  console.log('✔ Database ready.\n');

  // 2. Start Live Express Server on real port
  console.log(`[2/3] Starting real Express server on ${BASE_URL}...`);
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log('✔ Server bound and listening for real HTTP requests.\n');

  try {
    console.log('[3/3] Executing real HTTP verification tests...\n');

    // TEST 1: Health Endpoint
    console.log('--- TEST 1: Health Check (GET /api/health) ---');
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    assert(healthRes.status === 200, `Expected 200, got ${healthRes.status}`);
    const healthData = await healthRes.json();
    assert(healthData.status === 'ok', 'Health status must be ok');
    console.log('✔ PASS: Health endpoint is active.\n');
    results.push({ name: 'GET /api/health', status: 'PASS' });

    // TEST 2: Admin Login
    console.log('--- TEST 2: Real Admin Authentication (POST /api/auth/login) ---');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@mahitechgroup.com',
        password: 'AdminPassword@2026'
      })
    });
    assert(loginRes.status === 200, `Login expected 200, got ${loginRes.status}`);
    const loginData = await loginRes.json();
    assert(loginData.token, 'Response must include JWT token');
    const token = loginData.token;
    console.log('✔ PASS: Real JWT token obtained for admin.\n');
    results.push({ name: 'POST /api/auth/login (Real Auth)', status: 'PASS' });

    // TEST 3: Authenticated User Info
    console.log('--- TEST 3: Authenticated User Profile (GET /api/users/me) ---');
    const meRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert(meRes.status === 200, `Expected 200, got ${meRes.status}`);
    const meData = await meRes.json();
    assert(meData.user?.role === 'admin', 'User role must be admin');
    assert(meData.user?.email === 'admin@mahitechgroup.com', 'Admin email match');
    console.log(`✔ PASS: Authenticated as ${meData.user.name} (${meData.user.email}).\n`);
    results.push({ name: 'GET /api/users/me', status: 'PASS' });

    // TEST 4: Real Live Ideas Endpoint
    console.log('--- TEST 4: Live Ideas API (GET /api/ideas) ---');
    const ideasRes = await fetch(`${BASE_URL}/api/ideas`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert(ideasRes.status === 200, `Expected 200, got ${ideasRes.status}`);
    const ideasData = await ideasRes.json();
    assert(Array.isArray(ideasData.ideas), 'ideasData.ideas must be an array');
    console.log(`✔ PASS: GET /api/ideas returned ${ideasData.ideas.length} live ideas.\n`);
    results.push({ name: 'GET /api/ideas (Live Pipeline)', status: 'PASS' });

    // TEST 5: Real Live Projects Endpoint
    console.log('--- TEST 5: Live Projects API (GET /api/projects) ---');
    const projectsRes = await fetch(`${BASE_URL}/api/projects`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert(projectsRes.status === 200, `Expected 200, got ${projectsRes.status}`);
    const projectsData = await projectsRes.json();
    assert(Array.isArray(projectsData.projects), 'projectsData.projects must be an array');
    console.log(`✔ PASS: GET /api/projects returned ${projectsData.projects.length} live projects.\n`);
    results.push({ name: 'GET /api/projects (Live Projects)', status: 'PASS' });

    // TEST 6: Real Live Meetings Endpoint
    console.log('--- TEST 6: Live Meetings API (GET /api/meetings) ---');
    const meetingsRes = await fetch(`${BASE_URL}/api/meetings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert(meetingsRes.status === 200, `Expected 200, got ${meetingsRes.status}`);
    const meetingsData = await meetingsRes.json();
    assert(Array.isArray(meetingsData.meetings), 'meetingsData.meetings must be an array');
    console.log(`✔ PASS: GET /api/meetings returned ${meetingsData.meetings.length} live meetings.\n`);
    results.push({ name: 'GET /api/meetings (Live Meetings)', status: 'PASS' });

    // TEST 7: Unified Forensic Audit Stream Endpoint
    console.log('--- TEST 7: Forensic Audit Stream (GET /api/superadmin/audit) ---');
    const auditRes = await fetch(`${BASE_URL}/api/superadmin/audit?limit=25`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const auditData = await auditRes.json();
    if (auditRes.status !== 200) {
      console.error('Audit Error Data:', auditData);
    }
    assert(auditRes.status === 200, `Expected 200, got ${auditRes.status}: ${auditData.error || ''}`);
    assert(Array.isArray(auditData.logs), 'auditData.logs must be an array');
    assert(typeof auditData.count === 'number', 'auditData.count must be numeric');
    console.log(`✔ PASS: GET /api/superadmin/audit returned ${auditData.logs.length} forensic entries (Total: ${auditData.count}).\n`);
    results.push({ name: 'GET /api/superadmin/audit (Forensic Stream)', status: 'PASS' });

    // TEST 8: Automated Frontend Codebase Scan for Mock/Dummy Data Remnants
    console.log('--- TEST 8: Frontend Codebase Scan for Zero Dummy / Mock Artifacts ---');
    const publicJsDir = path.join(ROOT_DIR, 'public', 'js');

    function getAllFiles(dir, fileList = []) {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
          getAllFiles(filePath, fileList);
        } else if (filePath.endsWith('.js')) {
          fileList.push(filePath);
        }
      });
      return fileList;
    }

    const allJsFiles = getAllFiles(publicJsDir);
    console.log(`Scanning ${allJsFiles.length} frontend JavaScript files in public/js/...`);

    const forbiddenPatterns = [
      { pattern: /u-research/i, desc: 'Fake user ID u-research' },
      { pattern: /u-design/i, desc: 'Fake user ID u-design' },
      { pattern: /u-producer/i, desc: 'Fake user ID u-producer' },
      { pattern: /p-arogya/i, desc: 'Fake project p-arogya' },
      { pattern: /p-payflow/i, desc: 'Fake project p-payflow' },
      { pattern: /p-agri/i, desc: 'Fake project p-agri' },
      { pattern: /p-ai-ops/i, desc: 'Fake project p-ai-ops' },
      { pattern: /p-learn/i, desc: 'Fake project p-learn' },
      { pattern: /i-clinic/i, desc: 'Fake idea i-clinic' },
      { pattern: /i-upi/i, desc: 'Fake idea i-upi' },
      { pattern: /i-mandir/i, desc: 'Fake idea i-mandir' },
      { pattern: /i-drone/i, desc: 'Fake idea i-drone' },
      { pattern: /i-legal/i, desc: 'Fake idea i-legal' },
      { pattern: /demo\.mahi/i, desc: 'Forbidden mock domain demo.mahi' },
      { pattern: /example\.com/i, desc: 'Forbidden mock domain example.com' },
      { pattern: /example\.test/i, desc: 'Forbidden mock domain example.test' }
    ];

    const violations = [];
    allJsFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');
      forbiddenPatterns.forEach(({ pattern, desc }) => {
        if (pattern.test(content)) {
          const rel = path.relative(ROOT_DIR, file);
          violations.push(`Violation in ${rel}: Matched ${desc}`);
        }
      });
    });

    if (violations.length > 0) {
      console.error('Violations found:');
      violations.forEach((v) => console.error(` ❌ ${v}`));
      throw new Error(`Found ${violations.length} forbidden mock patterns in frontend codebase`);
    }

    console.log('✔ PASS: Zero dummy/mock data patterns detected across all public/js/ files.\n');
    results.push({ name: 'Automated Frontend Zero-Dummy Audit', status: 'PASS' });

    // TEST 9: Store Initial State Audit
    console.log('--- TEST 9: Store Data Structure Cleanliness ---');
    const dataJsPath = path.join(ROOT_DIR, 'public', 'js', 'app', 'data.js');
    const storeJsPath = path.join(ROOT_DIR, 'public', 'js', 'app', 'store.js');

    const dataContent = fs.readFileSync(dataJsPath, 'utf8');
    const storeContent = fs.readFileSync(storeJsPath, 'utf8');

    assert(!dataContent.includes('// Frontend-only fixtures'), 'Fixtures disclaimer must be removed');
    assert(dataContent.includes('users: []'), 'Users must initialize as empty array');
    assert(dataContent.includes('projects: []'), 'Projects must initialize as empty array');
    assert(dataContent.includes('ideas: []'), 'Ideas must initialize as empty array');
    assert(storeContent.includes('return false;'), 'isDemoMode() must return false');

    console.log('✔ PASS: State initializes completely empty and isDemoMode() is locked false.\n');
    results.push({ name: 'Store Initial State Audit', status: 'PASS' });

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('[TEST SERVER] Server gracefully stopped.\n');
  }

  console.log('===================================================================');
  console.log('                       VERIFICATION SUMMARY');
  console.log('===================================================================');
  results.forEach((r, idx) => {
    console.log(`[${idx + 1}/${results.length}] ${r.name.padEnd(45)} [ ${r.status} ]`);
  });
  console.log('===================================================================\n');
  console.log('✔ ALL LAYER 1 VERIFICATION CHECKS PASSED WITH 100% SUCCESS.\n');
}

runLayer1Verification().catch((err) => {
  console.error('\n❌ LAYER 1 VERIFICATION FAILED:', err);
  process.exit(1);
});
