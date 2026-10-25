import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const require = createRequire('/home/user/mahi-tech-group-web/package.json');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const report = [];
const pause = (page, ms = 140) => page.waitForTimeout(ms);
async function go(page, route) { await page.goto(`${base}/app.html#${route}`, { waitUntil: 'networkidle' }); await page.waitForSelector('#main-content'); await pause(page, 60); }
async function login(page, role = 'admin') { await go(page, '/login'); await page.locator(`[data-demo-role="${role}"]`).click(); await pause(page); }
async function data(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('mtg-frontend-data-v1'))); }
async function scenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(); const errors = []; const apiCalls = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); page.on('request', request => { if (request.url().includes('/api/')) apiCalls.push(request.url()); });
  const started = Date.now();
  try { await fn(page); assert.deepEqual(apiCalls, [], 'No backend API calls are allowed'); assert.deepEqual(errors, [], 'No browser errors expected'); report.push({ name, status: 'passed', ms: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { report.push({ name, status: 'failed', error: error.stack, errors, apiCalls, url: page.url() }); console.error(`FAIL ${name}\n${error.stack}`); await page.screenshot({ path: `/home/user/mahi-app-qa/failure-${report.length}.png`, fullPage: true }).catch(() => {}); }
  finally { await context.close(); }
}

await scenario('public access states, signup, and Admin application approval', async page => {
  for (const test of [
    ['pending@example.com', '/application-status?status=pending', 'Application pending review'],
    ['rejected@example.com', '/application-status?status=rejected', 'Application not approved']
  ]) {
    await go(page, '/login'); await page.locator('#login-email').fill(test[0]); await page.locator('#login-password').fill('password1'); await page.locator('#login-form button[type=submit]').click(); await pause(page);
    assert.ok(page.url().includes(test[1])); assert.ok((await page.locator('body').innerText()).includes(test[2]));
  }
  for (const test of [['inactive@example.com', 'Access Revoked'], ['suspended@example.com', 'Account Suspended']]) {
    await go(page, '/login'); await page.locator('#login-email').fill(test[0]); await page.locator('#login-password').fill('password1'); await page.locator('#login-form button[type=submit]').click();
    assert.ok((await page.locator('#login-form').innerText()).includes(test[1]));
  }
  await go(page, '/signup');
  await page.locator('#signup-name').fill('QA Applicant'); await page.locator('#signup-email').fill('qa.applicant@example.com'); await page.locator('#signup-password').fill('password1'); await page.locator('#signup-role').selectOption('developer'); await page.locator('#signup-subrole').selectOption('backend'); await page.locator('#signup-note').fill('Frontend QA membership application for workflow verification.'); await page.locator('[name=terms]').check(); await page.locator('#signup-form button[type=submit]').click(); await pause(page);
  let fixtures = await data(page); const application = fixtures.applications.find(item => item.email === 'qa.applicant@example.com'); assert.equal(application.status, 'pending'); assert.equal(application.desiredSubRole, 'backend');
  await login(page, 'admin'); await go(page, '/admin/applications'); const row = page.locator('#application-rows tr').filter({ hasText: 'QA Applicant' }); await row.locator('[data-review-application]').click(); await page.locator('[data-application-decision="approve"]').click(); await pause(page);
  fixtures = await data(page); assert.equal(fixtures.applications.find(item => item.id === application.id).status, 'approved'); assert.ok(fixtures.users.some(user => user.id === application.id && user.role === 'developer' && user.subRole === 'backend'));
  await go(page, '/contact'); assert.ok((await page.locator('#main-content').innerText()).includes('Access & support')); assert.equal(await page.locator('#contact-form').count(), 0); assert.equal(await page.locator('.contact-option[href="#/signup"]').count(), 1); assert.equal(await page.locator('.contact-option[href="#/login"]').count(), 1);
  await go(page, '/mentorship'); assert.ok((await page.locator('#main-content').innerText()).includes('Access & support')); assert.equal(await page.locator('#mentorship-form').count(), 0);
});

await scenario('task dependencies, role switching, and final-review rejection recovery', async page => {
  await login(page, 'researcher'); await go(page, '/app/projects/p-arogya'); await page.locator('[data-open-task="p-arogya-t1"]').first().click(); await page.locator('[data-task-update="DONE"]').click(); await pause(page);
  let fixtures = await data(page); let project = fixtures.projects.find(item => item.id === 'p-arogya'); assert.equal(project.tasks[0].status, 'DONE'); assert.deepEqual(project.tasks.slice(1, 5).map(task => task.status), ['TODO', 'TODO', 'TODO', 'TODO']);
  await go(page, '/role-selection'); await page.locator('[data-select-role="developer"]').click(); await pause(page); await go(page, '/app/projects/p-arogya'); await page.locator('[data-open-task="p-arogya-t3"]').first().click(); await page.locator('[data-task-update="IN_PROGRESS"]').click(); await pause(page); await page.locator('[data-open-task="p-arogya-t3"]').first().click(); await page.locator('[data-task-update="DONE"]').click(); await pause(page);
  fixtures = await data(page); project = fixtures.projects.find(item => item.id === 'p-arogya'); assert.equal(project.tasks[2].status, 'DONE'); assert.equal(project.stage, 'INTEGRATION');
  await go(page, '/role-selection'); await page.locator('[data-select-role="admin"]').click(); await pause(page); await go(page, '/app/projects/p-language'); await page.locator('#final-review').click(); await page.locator('#review-decision').selectOption('rejected'); await page.locator('#review-notes').fill('QA rejection: confirm the final accessibility note before release.'); await page.locator('#submit-review').click(); await pause(page);
  fixtures = await data(page); project = fixtures.projects.find(item => item.id === 'p-language'); assert.equal(project.stage, 'REJECTED_AT_REVIEW'); assert.equal(project.status, 'ACTIVE'); assert.ok((await page.locator('body').innerText()).includes('Rejected at final review')); assert.ok(await page.locator('#final-review').isVisible());
  await page.locator('#final-review').click(); await page.locator('#review-decision').selectOption('approved'); await page.locator('#review-notes').fill('QA approval after reviewing the rejection recovery state.'); await page.locator('#submit-review').click(); await pause(page);
  fixtures = await data(page); project = fixtures.projects.find(item => item.id === 'p-language'); assert.equal(project.stage, 'LIVE'); assert.equal(project.tasks[8].status, 'DONE');
  await go(page, '/app/coworking/p-language'); assert.ok((await page.locator('body').innerText()).includes('archived and read-only'));
});

await scenario('voting, direct review meeting, Admin fan-out, and role-compatible assignment', async page => {
  await login(page, 'producer'); await go(page, '/app/ideas/i-clinic'); await page.locator('#cast-vote').click(); await page.locator('#vote-comment').fill('QA green vote with complete scoring.'); await page.locator('#record-vote').click(); await pause(page);
  let fixtures = await data(page); assert.ok(fixtures.votes.some(vote => vote.ideaId === 'i-clinic' && vote.voterId === 'u-producer'));
  await go(page, '/app/ideas/new'); await page.locator('#idea-title').fill('QA community knowledge desk'); await page.locator('#idea-description').fill('A frontend-only test proposal for coordinating reviewed community knowledge sessions with clear ownership and capacity notes.'); await page.locator('#submit-idea').click(); await pause(page);
  fixtures = await data(page); const idea = fixtures.ideas.find(item => item.title === 'QA community knowledge desk'); assert.equal(idea.status, 'PENDING_REVIEW'); assert.equal(idea.reviewMeeting.ideaId, idea.id); assert.equal(idea.reviewMeeting.scheduledAt, idea.submittedAt); assert.equal(idea.reviewMeeting.votingWindowEnd, idea.deadline);
  await go(page, '/role-selection'); await page.locator('[data-select-role="admin"]').click(); await pause(page); await go(page, `/app/ideas/${idea.id}`); await page.locator('#override-idea').click(); await page.locator('#override-reason').fill('QA Admin override to verify nine-task fan-out and role-compatible assignment.'); await page.locator('#save-override').click(); await pause(page);
  fixtures = await data(page); const updated = fixtures.ideas.find(item => item.id === idea.id); const project = fixtures.projects.find(item => item.id === updated.projectId); assert.equal(updated.status, 'APPROVED'); assert.equal(project.tasks.length, 9);
  const roleFor = task => fixtures.users.find(user => user.id === task.assignedTo)?.role;
  assert.equal(roleFor(project.tasks[0]), 'researcher'); assert.equal(roleFor(project.tasks[1]), 'developer'); assert.equal(roleFor(project.tasks[2]), 'developer'); assert.equal(roleFor(project.tasks[3]), 'designer'); assert.equal(roleFor(project.tasks[4]), 'producer'); assert.equal(roleFor(project.tasks[8]), 'admin');
  assert.equal(fixtures.users.find(user => user.id === project.tasks[1].assignedTo).subRole, 'backend'); assert.equal(fixtures.users.find(user => user.id === project.tasks[2].assignedTo).subRole, 'frontend');
});

await scenario('member support isolation and manual withdrawal lifecycle', async page => {
  await login(page, 'developer'); await go(page, '/app/support/t-1042'); assert.ok(!(await page.locator('body').innerText()).includes('Internal review: membership record'));
  await page.locator('#reply-body').fill('QA member reply with additional attachment context.'); await page.locator('#ticket-reply button[type=submit]').click(); await pause(page);
  await go(page, '/app/wallet'); const before = (await data(page)).users.find(user => user.id === 'u-dev-front').wallet; await page.locator('#request-withdrawal').click(); await page.locator('#withdrawal-amount').fill('100'); await page.locator('#submit-withdrawal').click(); await pause(page);
  let fixtures = await data(page); const request = fixtures.withdrawals.find(item => item.userId === 'u-dev-front' && item.amount === 100 && item.status === 'PENDING'); assert.ok(request); assert.equal(fixtures.users.find(user => user.id === 'u-dev-front').wallet, before);
  await go(page, '/role-selection'); await page.locator('[data-select-role="elevated"]').click(); await pause(page); await go(page, '/superadmin/support'); await page.locator('[data-ticket="t-1042"]').first().click(); await page.locator('#admin-reply-body').fill('QA internal-only investigation note.'); await page.locator('#admin-thread-reply [name=internal]').check(); await page.locator('#admin-thread-reply button[type=submit]').click(); await pause(page);
  await go(page, '/admin/revenue'); await page.locator(`[data-approve-withdrawal="${request.id}"]`).click(); await page.locator('#confirm-withdrawal-review').click(); await pause(page);
  fixtures = await data(page); assert.equal(fixtures.withdrawals.find(item => item.id === request.id).status, 'PAID'); assert.equal(fixtures.users.find(user => user.id === 'u-dev-front').wallet, before - 100);
  await go(page, '/role-selection'); await page.locator('[data-select-role="developer"]').click(); await pause(page); await go(page, '/app/support/t-1042'); const text = await page.locator('body').innerText(); assert.ok(text.includes('QA member reply')); assert.ok(!text.includes('QA internal-only investigation note'));
});

await scenario('meeting lifecycle, recording reference, and bilingual notes confirmation', async page => {
  await login(page, 'admin'); await go(page, '/app/meetings'); await page.locator('#schedule-meeting').click(); await page.locator('#schedule-title').fill('QA operational review'); await page.locator('#schedule-project').selectOption('p-khet'); await page.locator('#schedule-recording').selectOption('true'); await page.locator('#save-meeting').click(); await pause(page);
  let fixtures = await data(page); const meeting = fixtures.meetings.find(item => item.title === 'QA operational review'); assert.equal(meeting.status, 'SCHEDULED');
  await page.locator('[data-meeting-control="start"]').first().click(); await pause(page); await page.locator('[data-meeting-control="join"]').click(); await pause(page); await page.locator('[data-meeting-control="end"]').click(); await pause(page);
  fixtures = await data(page); assert.equal(fixtures.meetings.find(item => item.id === meeting.id).status, 'ENDED'); assert.ok(fixtures.meetings.find(item => item.id === meeting.id).attendance.every(item => item.leftAt));
  await page.locator('#add-recording').click(); await page.locator('#recording-file').setInputFiles({ name: 'qa-review.mp4', mimeType: 'video/mp4', buffer: Buffer.from('frontend-only') }); await page.locator('#save-recording').click(); await pause(page); fixtures = await data(page); assert.equal(fixtures.meetings.find(item => item.id === meeting.id).recording.title, 'qa-review.mp4');
  await go(page, '/app/meetings/m-qa'); await page.locator('#review-notes').click(); await page.locator('#confirm-notes').click(); await pause(page); fixtures = await data(page); assert.equal(fixtures.meetings.find(item => item.id === 'm-qa').notesStatus, 'CONFIRMED'); assert.ok((await page.locator('body').innerText()).includes('English & Hindi'));
});

await scenario('co-working pen, object editing, snapshots, and listener cleanup', async page => {
  await login(page, 'admin'); await go(page, '/app/coworking/p-arogya'); await page.locator('[data-canvas-tool="pen"]').click(); const board = await page.locator('#canvas-board').boundingBox();
  await page.mouse.move(board.x + board.width * .55, board.y + board.height * .55); await page.mouse.down(); await page.mouse.move(board.x + board.width * .62, board.y + board.height * .62, { steps: 6 }); await page.mouse.move(board.x + board.width * .70, board.y + board.height * .55, { steps: 6 }); await page.mouse.up(); await pause(page, 250);
  let fixtures = await data(page); assert.ok(fixtures.coworking['p-arogya'].objects.some(object => object.type === 'pen' && object.points.split(' ').length > 5)); assert.ok(await page.locator('[data-pen-id] polyline').count());
  await page.locator('[data-canvas-tool="sticky"]').click(); await page.mouse.click(board.x + board.width * .78, board.y + board.height * .78); await page.waitForSelector('#canvas-object-form'); await page.locator('#canvas-object-text').fill('QA sticky note'); await page.locator('#save-canvas-object').click(); await pause(page); fixtures = await data(page); assert.ok(fixtures.coworking['p-arogya'].objects.some(object => object.text === 'QA sticky note'));
  await page.locator('#save-snapshot').click(); await page.locator('#snapshot-name').fill('QA complete canvas'); await page.locator('#confirm-snapshot').click(); await pause(page); fixtures = await data(page); assert.ok(fixtures.coworking['p-arogya'].snapshots[0].objects.length >= 2);
  await page.locator('[data-restore-snapshot="snap1"]').click(); await page.locator('[data-confirm="true"]').click(); await pause(page); fixtures = await data(page); assert.equal(fixtures.coworking['p-arogya'].objects.length, 2);
  await go(page, '/app/dashboard'); await go(page, '/app/coworking/p-arogya'); fixtures = await data(page); assert.equal(fixtures.coworking['p-arogya'].presence.filter(id => id === 'u-admin').length, 1);
});

await scenario('authenticated token signing and locked financial settlement', async page => {
  const route = '/sign/disputes/d-302?document=ag-302&signature=sig-302-front&token=local-demo-sig-302-front';
  await go(page, route); assert.ok((await page.locator('body').innerText()).includes('Authentication required')); await page.locator('[data-sign-identity="u-dev-front"]').click(); await pause(page); assert.ok(await page.locator('#signing-form').isVisible());
  await page.locator('[data-sign-decision="true"]').click(); assert.ok(await page.locator('#signing-form').isVisible()); await page.locator('[name=reviewed]').check(); await page.locator('[data-sign-decision="true"]').click(); await pause(page);
  let fixtures = await data(page); const signature = fixtures.disputes.find(item => item.id === 'd-302').signatures.find(item => item.id === 'sig-302-front'); assert.equal(signature.status, 'signed'); assert.equal(signature.agreed, true); assert.equal(fixtures.disputes.find(item => item.id === 'd-302').status, 'settled'); assert.ok((await page.locator('body').innerText()).includes('Acceptance recorded locally'));
  await go(page, '/role-selection'); await page.locator('[data-select-role="elevated"]').click(); await pause(page); await go(page, '/superadmin/disputes'); await page.locator('[data-open-dispute="d-302"]').first().click(); await page.locator('#settle-dispute').click(); await page.locator('#settlement-action').selectOption('wallet_credit'); await page.locator('#dispute-settlement-amount').fill('100'); await page.locator('#settlement-target').selectOption('u-dev-front'); await page.locator('#dispute-settlement-notes').fill('QA settlement lock verification.'); await page.locator('#execute-dispute-settlement').click(); await page.locator('[data-confirm="true"]').click(); await pause(page);
  fixtures = await data(page); const dispute = fixtures.disputes.find(item => item.id === 'd-302'); assert.equal(dispute.settlementAmount, 100); assert.equal(dispute.settlementAction, 'wallet_credit'); await page.locator('[data-open-dispute="d-302"]').first().click(); assert.ok((await page.locator('#drawer-root').innerText()).includes('locked to this mock record')); assert.equal(await page.locator('#settle-dispute').count(), 0);
});

await scenario('declined agreement returns dispute to negotiation and invalid tokens stay closed', async page => {
  await go(page, '/sign/disputes/d-302?document=ag-302&signature=sig-302-front&token=wrong-token'); assert.ok((await page.locator('body').innerText()).includes('Authentication required')); await page.locator('[data-sign-identity="u-dev-front"]').click(); await pause(page); assert.ok((await page.locator('body').innerText()).includes('Invalid signature token'));
  await page.locator('[data-demo-token]').click(); await pause(page); await page.locator('[name=reviewed]').check(); await page.locator('[data-sign-decision="false"]').click(); await pause(page); const fixtures = await data(page); assert.equal(fixtures.disputes.find(item => item.id === 'd-302').status, 'negotiation'); assert.equal(fixtures.disputes.find(item => item.id === 'd-302').signatures.find(item => item.id === 'sig-302-front').agreed, false);
});

await scenario('elevated performance, gateway, ideation, governance, and unified audit controls', async page => {
  await login(page, 'admin'); await go(page, '/superadmin/performance'); await page.locator('#weight-tasks').fill('40'); await page.locator('#weights-form button[type=submit]').click(); assert.ok((await page.locator('#weights-form').innerText()).includes('Weights must sum to exactly 100%')); await page.locator('#weight-tasks').fill('30'); await page.locator('#weights-form button[type=submit]').click(); await pause(page); assert.equal((await data(page)).performanceConfig.tasks, 30);
  await go(page, '/superadmin/gateway'); assert.ok(await page.locator('#gateway-auto').isDisabled()); await page.locator('#test-gateway').click(); assert.ok((await page.locator('#gateway-test-result').innerText()).includes('No external HTTP request was made'));
  await go(page, '/superadmin/ideas'); await page.locator('[data-kill-idea="i-clinic"]').click(); await page.locator('#kill-reason').fill('QA kill-switch verification.'); await page.locator('#confirm-kill-idea').click(); await pause(page); let fixtures = await data(page); assert.equal(fixtures.ideas.find(item => item.id === 'i-clinic').status, 'KILLED'); await page.locator('[data-restore-idea="i-clinic"]').click(); await page.locator('#restore-reason').fill('QA restore verification.'); await page.locator('#confirm-restore-idea').click(); await pause(page); fixtures = await data(page); assert.equal(fixtures.ideas.find(item => item.id === 'i-clinic').status, 'PENDING_REVIEW');
  await go(page, '/superadmin/governance?user=u-dev-back'); await page.locator('#governance-toggle').click(); await page.locator('[data-confirm="true"]').click(); await pause(page); fixtures = await data(page); assert.equal(fixtures.users.find(item => item.id === 'u-dev-back').status, 'suspended'); await page.locator('#governance-toggle').click(); await page.locator('[data-confirm="true"]').click(); await pause(page); fixtures = await data(page); assert.equal(fixtures.users.find(item => item.id === 'u-dev-back').status, 'active'); assert.ok(fixtures.governance.some(item => item.action === 'restriction_lifted'));
  await go(page, '/superadmin/audit'); await page.locator('#unified-search').fill('restriction_lifted'); assert.ok((await page.locator('#unified-list').innerText()).includes('Restriction Lifted'));
});

fs.writeFileSync('/home/user/mahi-app-qa/workflow-results.json', JSON.stringify(report, null, 2));
console.log(`\n${report.filter(item => item.status === 'passed').length}/${report.length} workflow scenarios passed.`);
await browser.close();
