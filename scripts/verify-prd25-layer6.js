/**
 * scripts/verify-prd25-layer6.js
 * Verification Suite for PRD 25 Layer 6: Frontend Smoke & Serving Tests
 *
 * Real HTTP calls, Zero mocks.
 */

import http from 'node:http';
import { createApp } from '../src/app.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS:\x1b[0m Test ${totalTests}: ${message}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m Test ${totalTests}: ${message}`);
    if (details) console.error(`    \x1b[33mDetails: ${details}\x1b[0m`);
    process.exitCode = 1;
  }
}

function makeRequest(serverUrl, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const req = http.request(url, { method: 'GET' }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: body
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runLayer6() {
  console.log('\n======================================================================');
  console.log('🚀 RUNNING PRD 25 LAYER 6: FRONTEND SMOKE TESTS');
  console.log('======================================================================\n');

  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    const views = [
      {
        path: '/finance-dashboard.html',
        title: 'Financial Dashboard',
        requiredElements: ['statTotalBudget', 'statTotalConsumed', 'statTotalRemaining', 'statTotalInvoiced', 'statTotalPaid', 'statTotalOutstanding', 'projectsTableBody']
      },
      {
        path: '/project-budget.html',
        title: 'Project Budget & Expenses',
        requiredElements: ['projectSelect', 'statBudget', 'statConsumed', 'burnProgressBar', 'budgetHistoryTableBody', 'expensesTableBody']
      },
      {
        path: '/my-expenses.html',
        title: 'My Expenses',
        requiredElements: ['myExpensesTableBody', 'btnOpenSubmitModal', 'submitExpenseForm']
      },
      {
        path: '/invoice-manager.html',
        title: 'Invoice Manager',
        requiredElements: ['invoicesTableBody', 'btnOpenCreateInvoice', 'createInvoiceForm']
      },
      {
        path: '/budget-alerts.html',
        title: 'Budget Alerts & Reports',
        requiredElements: ['activeAlertsTableBody', 'acknowledgedTableBody', 'plProjectSelect', 'btnExportJSON', 'btnExportCSV']
      }
    ];

    for (const v of views) {
      console.log(`\n--- Smoke Testing: ${v.path} ---`);
      const res = await makeRequest(serverUrl, v.path);
      assert(res.status === 200, `${v.path} serves with HTTP 200 OK`);
      assert(res.headers['content-type']?.includes('text/html'), `${v.path} has text/html Content-Type`);
      assert(res.data.includes('<!DOCTYPE html>'), `${v.path} contains standard HTML5 doctype`);
      assert(res.data.includes(v.title), `${v.path} contains expected title '${v.title}'`);
      assert(res.data.includes('fonts.googleapis.com'), `${v.path} loads modern typography`);
      assert(!res.data.includes('secret') && !res.data.includes('password') && !res.data.includes('bearer '), `${v.path} contains zero hardcoded secrets`);

      for (const elId of v.requiredElements) {
        assert(res.data.includes(elId), `${v.path} includes required DOM element id='${elId}'`);
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('\n======================================================================');
  console.log(`PRD 25 LAYER 6 RESULTS: ${passedTests}/${totalTests} PASS (${failedTests} FAILED)`);
  console.log('======================================================================\n');

  if (failedTests > 0) process.exit(1);
}

runLayer6().catch(err => {
  console.error('Layer 6 fatal error:', err);
  process.exit(1);
});
