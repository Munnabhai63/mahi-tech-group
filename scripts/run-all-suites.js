/**
 * FULL TEST BATTERY — runs every verification suite sequentially with a
 * PRISTINE DATABASE PER SUITE (no cross-suite state pollution) and prints an
 * honest consolidated summary. Exits non-zero if any suite fails.
 *
 * Two suite kinds are supported:
 *  - self-booting suites: they create their own app/server and run migrate+seed
 *  - live-server suites: they expect the real server on http://localhost:4000
 *    (the battery boots it fresh for each such suite and stops it afterwards)
 *
 * Usage: npm run test:all
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const BATTERY_DB = path.join(repoRoot, 'test-battery.sqlite');
const SERVER_LOG = path.join(repoRoot, 'battery-server.log');

const SUITES = [
  // ---- self-booting suites (own app instance + migrate/seed) ----
  { file: 'run-tests.js', liveServer: false },                    // Core: auth, RBAC, sessions, audit
  { file: 'run-step2-tests.js', liveServer: false },              // Idea quota engine
  { file: 'run-step3-tests.js', liveServer: false },              // Voting gate & quorum
  { file: 'run-step4-tests.js', liveServer: false },              // Parallel fan-out
  { file: 'run-step01-amendment-tests.js', liveServer: false },
  { file: 'run-step04-amendment-tests.js', liveServer: false },
  { file: 'run-step08-revision-tests.js', liveServer: false },    // Corner panels (revision)
  { file: 'run-step09-profile-tests.js', liveServer: false },     // User profile & wallet
  { file: 'run-step10-admin-tests.js', liveServer: false },       // Admin governance panel
  { file: 'run-step11-coworking-tests.js', liveServer: false },   // Real-time canvas
  { file: 'run-step12-meeting-tests.js', liveServer: false },     // Meeting integration
  { file: 'run-step14-superadmin-tests.js', liveServer: false },  // Super admin + E2E
  { file: 'test-security-enhancements.js', liveServer: false },   // Rate limiter, headers, email
  { file: 'test-youpi-integration.js', liveServer: false },       // YouPI webhook + manual UPI payouts
  { file: 'test-legal-gate.js', liveServer: false },              // Legal onboarding gate + e-signatures
  // ---- live-server suites (real server on port 4000, booted fresh per suite) ----
  { file: 'run-step5-tests.js', liveServer: true },               // Offboarding kill-switch
  { file: 'run-step6-tests.js', liveServer: true },               // Revenue split engine
  { file: 'run-step7-tests.js', liveServer: true },               // Center dashboard
  { file: 'run-step08-tests.js', liveServer: true },              // Corner panels (core)
  { file: 'run-step08-followup-tests.js', liveServer: true },
  { file: 'run-all-clarification-tests.js', liveServer: true },   // Cross-cutting clarifications
  // ---- final QA last (its TEST 08 re-runs earlier suites as children) ----
  { file: 'run-step13-final-qa-tests.js', liveServer: false }
];

function removeBatteryDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(BATTERY_DB + suffix, { force: true }); } catch (e) {}
  }
}

function resetBatteryDb() {
  removeBatteryDb();
  // Several suites run cleanupTestData() BEFORE their own migrate+seed, so the
  // battery must hand them an empty but fully-migrated schema.
  const mig = spawnSync(process.execPath, [path.join('src', 'db', 'migrate.js')], {
    cwd: repoRoot,
    env: baseEnv(),
    stdio: 'ignore',
    timeout: 60_000
  });
  if (mig.status !== 0) {
    console.error('  [BATTERY] WARNING: pre-suite migration failed — suite may fail to boot.');
  }
}

function baseEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DB_PATH: BATTERY_DB,
    PORT: '4000',
    // Fixed per-battery secrets: several suites fabricate JWTs in their own
    // process and call the live server (separate process) — both must share
    // the same signing secret for cross-process session interop.
    JWT_SECRET: 'battery-fixed-jwt-secret-interop-0123456789abcdef',
    ENCRYPTION_KEY: 'battery-fixed-encryption-key-interop-0123456789abcdef'
  };
}

async function waitForServer(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:4000/api/health');
      if (res.ok) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Live-server suites hardcode http://localhost:4000. If another process
 * (e.g. a dev preview server) occupies the port, the freshly spawned battery
 * server dies with EADDRINUSE and the suites silently talk to the WRONG
 * server+database. So the port MUST be free — terminate any occupant.
 */
function freePort4000() {
  if (process.platform !== 'win32') return;
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout || '';
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (line.includes(':4000') && line.toUpperCase().includes('LISTENING')) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid) && Number(pid) !== process.pid) pids.add(pid);
    }
  }
  for (const pid of pids) {
    console.log(`  [BATTERY] Port 4000 occupied by PID ${pid} — terminating it (live-server suites require :4000).`);
    spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
  }
  if (pids.size > 0) {
    spawnSync('ping', ['-n', '2', '127.0.0.1'], { stdio: 'ignore' }); // brief settle delay on Windows
  }
}

async function runSuite(suite) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`  SUITE: ${suite.file}${suite.liveServer ? '  [live server :4000]' : ''}`);
  console.log(`${'='.repeat(72)}\n`);

  let serverProc = null;

  try {
    // Pristine database for every suite — suites migrate+seed themselves
    resetBatteryDb();

    if (suite.liveServer) {
      freePort4000();
      const out = fs.openSync(SERVER_LOG, 'a');
      serverProc = spawn(process.execPath, [path.join('src', 'server.js')], {
        cwd: repoRoot,
        env: baseEnv(),
        stdio: ['ignore', out, out],
        detached: false
      });
      const up = await waitForServer();
      if (!up) {
        console.error(`  [BATTERY] Live server failed to start — see ${SERVER_LOG}`);
        return 'FAIL (server boot)';
      }
    }

    const run = spawnSync(process.execPath, [path.join('scripts', suite.file)], {
      cwd: repoRoot,
      stdio: 'inherit',
      timeout: 12 * 60 * 1000,
      env: baseEnv()
    });

    if (run.status === 0) return 'PASS';
    if (run.status === null) return 'TIMEOUT';
    return `FAIL (exit ${run.status})`;
  } finally {
    if (serverProc) {
      try { serverProc.kill('SIGTERM'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 1200));
      try { serverProc.kill('SIGKILL'); } catch (e) {}
    }
  }
}

const results = [];
let failed = 0;

for (const suite of SUITES) {
  const status = await runSuite(suite);
  results.push({ suite: suite.file, status });
  if (status !== 'PASS') failed++;
}

removeBatteryDb();

console.log(`\n${'='.repeat(72)}`);
console.log('        FULL TEST BATTERY — CONSOLIDATED SUMMARY');
console.log(`${'='.repeat(72)}\n`);
console.table(results);

const passed = results.length - failed;
console.log(`  RESULT: ${passed}/${results.length} suites passed, ${failed} failed.`);
console.log(`  Database used: ${BATTERY_DB} (removed after run; dev database.sqlite untouched)`);
if (failed > 0) {
  process.exit(1);
}
console.log('  ALL SUITES PASSED.');
process.exit(0);
