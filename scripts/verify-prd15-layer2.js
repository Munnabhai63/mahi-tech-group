import crypto from 'node:crypto';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import * as pipelineService from '../src/services/pipelineService.js';

console.log('===================================================================');
console.log('  PRD 15 — LAYER 2 CORE SERVICE UNIT VERIFICATION');
console.log('===================================================================');

// Ensure database initialized
getDatabase();

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    process.exit(1);
  }
}

// 0. Setup test users and test project
console.log('\n--- SETUP: Preparing Test Users & Project ---');

let adminUser = queryOne("SELECT id, role FROM users WHERE role = 'admin' LIMIT 1;");
let researcherUser = queryOne("SELECT id, role FROM users WHERE role = 'researcher' LIMIT 1;");
let designerUser = queryOne("SELECT id, role FROM users WHERE role = 'designer' LIMIT 1;");
let devUser = queryOne("SELECT id, role FROM users WHERE role = 'developer' LIMIT 1;");
let testerUser = queryOne("SELECT id, role FROM users WHERE role = 'producer' OR role = 'tester' LIMIT 1;");

if (!adminUser) {
  const id = crypto.randomUUID();
  execute("INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Admin Test', 'admin.test@mahi.com', 'hash', 'admin', 'active')", [id]);
  adminUser = { id, role: 'admin' };
}
if (!researcherUser) {
  const id = crypto.randomUUID();
  execute("INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Researcher Test', 'res.test@mahi.com', 'hash', 'researcher', 'active')", [id]);
  researcherUser = { id, role: 'researcher' };
}
if (!designerUser) {
  const id = crypto.randomUUID();
  execute("INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Designer Test', 'des.test@mahi.com', 'hash', 'designer', 'active')", [id]);
  designerUser = { id, role: 'designer' };
}
if (!devUser) {
  const id = crypto.randomUUID();
  execute("INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Dev Test', 'dev.test@mahi.com', 'hash', 'developer', 'active')", [id]);
  devUser = { id, role: 'developer' };
}
if (!testerUser) {
  const id = crypto.randomUUID();
  execute("INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Tester Test', 'test.test@mahi.com', 'hash', 'producer', 'active')", [id]);
  testerUser = { id, role: 'producer' };
}

// Ensure an idea exists for project idea_id foreign key
let idea = queryOne("SELECT id FROM ideas LIMIT 1;");
if (!idea) {
  const ideaId = crypto.randomUUID();
  execute(`
    INSERT INTO ideas (id, owner_id, title, description, status)
    VALUES (?, ?, 'Pipeline Test Idea', 'Idea for testing pipeline', 'APPROVED')
  `, [ideaId, adminUser.id]);
  idea = { id: ideaId };
}

// Create dedicated test project
const testProjectId = 'proj_l2_' + Date.now();
execute(`
  INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status)
  VALUES (?, ?, 'PRD 15 Layer 2 Test Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE')
`, [testProjectId, idea.id, adminUser.id]);

console.log(`  Users ready: Admin (${adminUser.id}), Researcher (${researcherUser.id}), Designer (${designerUser.id}), Dev (${devUser.id}), Tester (${testerUser.id})`);
console.log(`  Project ready: ${testProjectId}`);

// TEST 1: createDeliverable — success case
console.log('\n--- TEST 1: createDeliverable (success case) ---');
const deliv1 = pipelineService.createDeliverable(
  testProjectId,
  'Authentication Module',
  'JWT + RBAC Deliverable',
  adminUser.id
);
assert(deliv1 && deliv1.id, 'Deliverable created with valid ID');
assert(deliv1.project_id === testProjectId, 'Deliverable linked to project');
assert(deliv1.current_stage === 'RESEARCH', 'Deliverable current_stage is RESEARCH');
assert(deliv1.status === 'ACTIVE', 'Deliverable status is ACTIVE');

// Verify access_log entry
const logEntry1 = queryOne("SELECT * FROM access_log WHERE target_id = ? AND action = 'pipeline_deliverable_created'", [deliv1.id]);
assert(logEntry1 !== null, 'access_log recorded pipeline_deliverable_created');

// TEST 2: addChecklistPoint — success + invalid stage blocked
console.log('\n--- TEST 2: addChecklistPoint (success + invalid stage blocked) ---');
const ptResearch1 = pipelineService.addChecklistPoint(
  deliv1.id,
  'RESEARCH',
  'Competitor Auth Analysis',
  'Analyze OAuth and JWT flows',
  5,
  adminUser.id
);
assert(ptResearch1 && ptResearch1.id, 'Checklist point created with valid ID');
assert(ptResearch1.stage === 'RESEARCH', 'Point stage is RESEARCH');
assert(ptResearch1.weight === 5, 'Point weight is 5');
assert(ptResearch1.status === 'UNCLAIMED', 'Point initial status is UNCLAIMED');

let invalidStageBlocked = false;
try {
  pipelineService.addChecklistPoint(deliv1.id, 'INVALID_STAGE', 'Test Point', '', 5, adminUser.id);
} catch (err) {
  invalidStageBlocked = true;
}
assert(invalidStageBlocked, 'Invalid stage INVALID_STAGE was blocked');

let futureStageBlocked = false;
try {
  pipelineService.addChecklistPoint(deliv1.id, 'DEV', 'premature dev point', '', 5, adminUser.id);
} catch (err) {
  futureStageBlocked = true;
}
assert(futureStageBlocked, 'Adding point to DEV stage when deliverable is in RESEARCH without open addendum blocked');

// TEST 3: claimPoint — success + role mismatch blocked
console.log('\n--- TEST 3: claimPoint (success + role mismatch blocked) ---');
let roleMismatchBlocked = false;
try {
  pipelineService.claimPoint(ptResearch1.id, devUser.id, 'developer');
} catch (err) {
  roleMismatchBlocked = true;
}
assert(roleMismatchBlocked, 'Developer claiming RESEARCH point was blocked with role mismatch error');

const claimedPt1 = pipelineService.claimPoint(ptResearch1.id, researcherUser.id, 'researcher');
assert(claimedPt1.status === 'CLAIMED', 'Point status transitioned to CLAIMED');
assert(claimedPt1.assigned_to === researcherUser.id, 'Point assigned_to set to researcherUser ID');

// TEST 4: startPoint — success + wrong user blocked
console.log('\n--- TEST 4: startPoint (success + wrong user blocked) ---');
let wrongUserStartBlocked = false;
try {
  pipelineService.startPoint(ptResearch1.id, devUser.id);
} catch (err) {
  wrongUserStartBlocked = true;
}
assert(wrongUserStartBlocked, 'Non-assigned user starting point was blocked');

const startedPt1 = pipelineService.startPoint(ptResearch1.id, researcherUser.id);
assert(startedPt1.status === 'IN_PROGRESS', 'Point status transitioned to IN_PROGRESS');

// TEST 5: submitPoint — success
console.log('\n--- TEST 5: submitPoint (success) ---');
let wrongUserSubmitBlocked = false;
try {
  pipelineService.submitPoint(ptResearch1.id, devUser.id, 'https://asset.com/doc.pdf');
} catch (err) {
  wrongUserSubmitBlocked = true;
}
assert(wrongUserSubmitBlocked, 'Non-assigned user submitting point was blocked');

const submittedPt1 = pipelineService.submitPoint(
  ptResearch1.id,
  researcherUser.id,
  'https://assets.mahi.com/research.pdf',
  'https://tools.mahi.com/research-board',
  'All competitor benchmarks verified'
);
assert(submittedPt1.status === 'SUBMITTED', 'Point status transitioned to SUBMITTED');
assert(submittedPt1.submitted_at !== null, 'submitted_at timestamp set');
assert(submittedPt1.asset_url === 'https://assets.mahi.com/research.pdf', 'asset_url saved');

// TEST 6: approvePoint — success + computeStagePercent verified
console.log('\n--- TEST 6: approvePoint (success + computeStagePercent verified) ---');
let unauthorizedApproveBlocked = false;
try {
  pipelineService.approvePoint(ptResearch1.id, devUser.id);
} catch (err) {
  unauthorizedApproveBlocked = true;
}
assert(unauthorizedApproveBlocked, 'Non-admin/non-lead approving point was blocked');

const approveRes1 = pipelineService.approvePoint(ptResearch1.id, adminUser.id);
assert(approveRes1.updatedPoint.status === 'APPROVED', 'Point status transitioned to APPROVED');
assert(approveRes1.updatedPoint.approved_by === adminUser.id, 'approved_by recorded');
assert(approveRes1.stagePercent === 100.00, 'Stage completion is 100.00% (1/1 point approved)');

// TEST 7: revisionPoint — success
console.log('\n--- TEST 7: revisionPoint (success) ---');
// Create a second point to test revision flow
const ptResearch2 = pipelineService.addChecklistPoint(
  deliv1.id,
  'RESEARCH',
  'Security Standards Checklist',
  'OWASP recommendations',
  5,
  adminUser.id
);
pipelineService.claimPoint(ptResearch2.id, researcherUser.id, 'researcher');
pipelineService.startPoint(ptResearch2.id, researcherUser.id);
pipelineService.submitPoint(ptResearch2.id, researcherUser.id, 'https://asset.com/sec.pdf');

const revisedPt = pipelineService.revisionPoint(ptResearch2.id, adminUser.id, 'Please include OAuth2.1 details');
assert(revisedPt.status === 'IN_PROGRESS', 'Point status returned to IN_PROGRESS upon revision request');
assert(revisedPt.point_description.includes('[Revision Requested: Please include OAuth2.1 details]'), 'Revision note recorded in description');

// TEST 8: computeStagePercent — exact math verified
console.log('\n--- TEST 8: computeStagePercent (exact math verified) ---');
// Currently in RESEARCH: ptResearch1 is APPROVED (weight 5), ptResearch2 is IN_PROGRESS (weight 5). Total weight = 10.
// Expected percent: 5 / 10 * 100 = 50.00%
const pctAt50 = pipelineService.computeStagePercent(deliv1.id, 'RESEARCH');
assert(pctAt50 === 50.00, `Stage percent exact math: expected 50.00, got ${pctAt50}`);

// Finish and approve ptResearch2 so RESEARCH becomes 100%
pipelineService.submitPoint(ptResearch2.id, researcherUser.id, 'https://asset.com/sec_v2.pdf');
const approveRes2 = pipelineService.approvePoint(ptResearch2.id, adminUser.id);
assert(approveRes2.stagePercent === 100.00, `Stage percent after second approval: expected 100.00, got ${approveRes2.stagePercent}`);

// TEST 9: approveHandoff — blocked when < 100%, success at 100%
console.log('\n--- TEST 9: approveHandoff (blocked when < 100%, success at 100%) ---');
// Create a separate deliverable that is < 100% to test block
const delivIncomplete = pipelineService.createDeliverable(testProjectId, 'Incomplete Deliverable', 'desc', adminUser.id);
const ptInc = pipelineService.addChecklistPoint(delivIncomplete.id, 'RESEARCH', 'Part 1', '', 5, adminUser.id);

let prematureHandoffBlocked = false;
try {
  pipelineService.approveHandoff(delivIncomplete.id, 'RESEARCH', 'DESIGN', 'Premature handoff', adminUser.id);
} catch (err) {
  prematureHandoffBlocked = true;
}
assert(prematureHandoffBlocked, 'Handoff blocked when stage completion is 0.00% (< 100.00%)');

// Now test success on deliv1 which is 100%
const handoff1 = pipelineService.approveHandoff(
  deliv1.id,
  'RESEARCH',
  'DESIGN',
  'Research phase complete and validated by team',
  adminUser.id
);
assert(handoff1 && handoff1.id, 'Handoff record created');
assert(handoff1.from_stage === 'RESEARCH' && handoff1.to_stage === 'DESIGN', 'Handoff from RESEARCH to DESIGN');
assert(handoff1.stage_completion_pct === 100.00, 'Handoff recorded at 100.00%');
assert(handoff1.snapshot_json.includes('Competitor Auth Analysis'), 'Snapshot JSON contains approved checklist points');

const updatedDeliv1 = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [deliv1.id]);
assert(updatedDeliv1.current_stage === 'DESIGN', 'Deliverable current_stage transitioned to DESIGN');

// TEST 10: approveHandoff — blocked when open addendum exists
console.log('\n--- TEST 10: approveHandoff (blocked when open addendum exists) ---');
// Advance deliv1 in DESIGN stage to 100%
const ptDesign1 = pipelineService.addChecklistPoint(deliv1.id, 'DESIGN', 'Figma Wireframes', 'Mockups', 10, adminUser.id);
pipelineService.claimPoint(ptDesign1.id, designerUser.id, 'designer');
pipelineService.startPoint(ptDesign1.id, designerUser.id);
pipelineService.submitPoint(ptDesign1.id, designerUser.id, 'https://figma.com/file');
pipelineService.approvePoint(ptDesign1.id, adminUser.id);

// Raise an open addendum against DESIGN stage
const openAddendumDesign = pipelineService.raiseAddendum(
  deliv1.id,
  'DEV',
  'DESIGN',
  'Missing Mobile Error States',
  'Need 320px error state screen',
  'ADDENDUM',
  devUser.id
);
assert(openAddendumDesign.status === 'OPEN', 'Open addendum raised against DESIGN');

let handoffWithOpenAddendumBlocked = false;
try {
  pipelineService.approveHandoff(deliv1.id, 'DESIGN', 'DEV', 'Trying handoff with open addendum', adminUser.id);
} catch (err) {
  handoffWithOpenAddendumBlocked = true;
}
assert(handoffWithOpenAddendumBlocked, 'Handoff blocked when open addendum request exists against stage');

// TEST 11: raiseAddendum — ADDENDUM type success
console.log('\n--- TEST 11: raiseAddendum (ADDENDUM type success) ---');
assert(openAddendumDesign.type === 'ADDENDUM', 'Addendum created with type ADDENDUM');
assert(openAddendumDesign.requesting_stage === 'DEV', 'requesting_stage is DEV');
assert(openAddendumDesign.target_stage === 'DESIGN', 'target_stage is DESIGN');

// TEST 12: raiseAddendum — BUG_TICKET wrong direction blocked
console.log('\n--- TEST 12: raiseAddendum (BUG_TICKET wrong direction blocked) ---');
let invalidBugTicketBlocked = false;
try {
  // DEV raising bug ticket to RESEARCH is forbidden (must be TEST -> DEV)
  pipelineService.raiseAddendum(
    deliv1.id,
    'DEV',
    'RESEARCH',
    'Wrong Bug Ticket',
    'Invalid direction',
    'BUG_TICKET',
    devUser.id
  );
} catch (err) {
  invalidBugTicketBlocked = true;
}
assert(invalidBugTicketBlocked, 'BUG_TICKET from DEV to RESEARCH was blocked (TEST->DEV only)');

// Valid bug ticket test:
// First create a DEV point
// To add point to DEV, we can either advance deliverable or use an open addendum.
// Let's fulfill or reject the design addendum first
// TEST 13: fulfillAddendum — success
console.log('\n--- TEST 13: fulfillAddendum (success) ---');
// Add the new point to fulfill openAddendumDesign
const ptDesignAddendum = pipelineService.addChecklistPoint(
  deliv1.id,
  'DESIGN',
  'Missing Mobile Error States Point',
  'Mobile error mockups',
  5,
  adminUser.id
);
pipelineService.claimPoint(ptDesignAddendum.id, designerUser.id, 'designer');
pipelineService.startPoint(ptDesignAddendum.id, designerUser.id);
pipelineService.submitPoint(ptDesignAddendum.id, designerUser.id, 'https://figma.com/error-states');
pipelineService.approvePoint(ptDesignAddendum.id, adminUser.id);

const fulfilledAddendum = pipelineService.fulfillAddendum(openAddendumDesign.id, ptDesignAddendum.id, adminUser.id);
assert(fulfilledAddendum.status === 'FULFILLED', 'Addendum status transitioned to FULFILLED');
assert(fulfilledAddendum.resolved_by === adminUser.id, 'resolved_by recorded on addendum');

// Now DESIGN has zero open addendums and 100% complete, so handoff DESIGN -> DEV succeeds
const handoffDesignToDev = pipelineService.approveHandoff(
  deliv1.id,
  'DESIGN',
  'DEV',
  'Design approved and handed to Dev',
  adminUser.id
);
assert(handoffDesignToDev.to_stage === 'DEV', 'Deliverable handed off to DEV');

// TEST 14: rejectAddendum — success
console.log('\n--- TEST 14: rejectAddendum (success) ---');
const addendumToReject = pipelineService.raiseAddendum(
  deliv1.id,
  'DEV',
  'RESEARCH',
  'Unnecessary Research Question',
  'Question answered in docs',
  'ADDENDUM',
  devUser.id
);
let nonAdminRejectBlocked = false;
try {
  pipelineService.rejectAddendum(addendumToReject.id, 'Invalid request', devUser.id);
} catch (err) {
  nonAdminRejectBlocked = true;
}
assert(nonAdminRejectBlocked, 'Non-admin attempting to reject addendum blocked');

const rejectedAddendum = pipelineService.rejectAddendum(addendumToReject.id, 'Already documented in wiki', adminUser.id);
assert(rejectedAddendum.status === 'REJECTED', 'Addendum status transitioned to REJECTED');

// Now test BUG_TICKET in DEV stage
console.log('\n--- BUG_TICKET Verification: TEST -> DEV ---');
const ptDev1 = pipelineService.addChecklistPoint(deliv1.id, 'DEV', 'Auth Route Handler', 'Code JWT route', 10, adminUser.id);
pipelineService.claimPoint(ptDev1.id, devUser.id, 'developer');
pipelineService.startPoint(ptDev1.id, devUser.id);
pipelineService.submitPoint(ptDev1.id, devUser.id, 'https://github.com/pull/1');
pipelineService.approvePoint(ptDev1.id, adminUser.id);

// DEV stage -> TEST stage
pipelineService.approveHandoff(deliv1.id, 'DEV', 'TEST', 'Dev completed, moving to Test', adminUser.id);

// Tester raises bug ticket against DEV point
const bugTicket = pipelineService.raiseAddendum(
  deliv1.id,
  'TEST',
  'DEV',
  'Auth Route Handler',
  'Token expiration does not return 401',
  'BUG_TICKET',
  testerUser.id
);
assert(bugTicket.type === 'BUG_TICKET', 'Valid BUG_TICKET created by Tester');

// Check that targeted DEV point status was set to REVISION_NEEDED
const devPtAfterBug = queryOne('SELECT status FROM pipeline_checklist_points WHERE id = ?', [ptDev1.id]);
assert(devPtAfterBug.status === 'REVISION_NEEDED', 'Target DEV point status forced to REVISION_NEEDED by bug ticket');

// Dev fixes and resubmits, lead approves
execute("UPDATE pipeline_checklist_points SET status = 'IN_PROGRESS' WHERE id = ?", [ptDev1.id]);
pipelineService.submitPoint(ptDev1.id, devUser.id, 'https://github.com/pull/2');
pipelineService.approvePoint(ptDev1.id, adminUser.id);

// Fulfill the bug ticket
pipelineService.fulfillAddendum(bugTicket.id, ptDev1.id, adminUser.id);

// In TEST stage: create test point and complete it
const ptTest1 = pipelineService.addChecklistPoint(deliv1.id, 'TEST', 'E2E Auth Test Suite', 'Verify tokens and expiration', 10, adminUser.id);
pipelineService.claimPoint(ptTest1.id, testerUser.id, 'producer');
pipelineService.startPoint(ptTest1.id, testerUser.id);
pipelineService.submitPoint(ptTest1.id, testerUser.id, 'https://reports.mahi.com/test-run');
pipelineService.approvePoint(ptTest1.id, adminUser.id);

// Handoff TEST -> COMPLETE
const handoffComplete = pipelineService.approveHandoff(deliv1.id, 'TEST', 'COMPLETE', 'All QA suites pass', adminUser.id);
assert(handoffComplete.to_stage === 'COMPLETE', 'Deliverable stage reached COMPLETE');

const deliv1StatusAfterComplete = queryOne('SELECT status FROM pipeline_deliverables WHERE id = ?', [deliv1.id]);
assert(deliv1StatusAfterComplete.status === 'COMPLETE', 'Deliverable status is COMPLETE');

// TEST 15: adminApproveLive — blocked when deliverable not COMPLETE
console.log('\n--- TEST 15: adminApproveLive (blocked when deliverable not COMPLETE) ---');
// delivIncomplete is still in RESEARCH (status ACTIVE)
let liveBlockedDueToIncomplete = false;
try {
  pipelineService.adminApproveLive(testProjectId, adminUser.id, 'Go live attempt');
} catch (err) {
  liveBlockedDueToIncomplete = true;
}
assert(liveBlockedDueToIncomplete, 'adminApproveLive blocked when an incomplete deliverable exists in project');

// Delete or cancel delivIncomplete so we can test addendum blocking
execute("UPDATE pipeline_deliverables SET status = 'COMPLETE' WHERE id = ?", [delivIncomplete.id]);

// TEST 16: adminApproveLive — blocked when open addendum exists
console.log('\n--- TEST 16: adminApproveLive (blocked when open addendum exists) ---');
const lingeringAddendum = pipelineService.raiseAddendum(
  deliv1.id,
  'TEST',
  'DEV',
  'Late Addendum Request',
  'Need another edge case check',
  'ADDENDUM',
  testerUser.id
);

let liveBlockedDueToOpenAddendum = false;
try {
  pipelineService.adminApproveLive(testProjectId, adminUser.id, 'Go live attempt');
} catch (err) {
  liveBlockedDueToOpenAddendum = true;
}
assert(liveBlockedDueToOpenAddendum, 'adminApproveLive blocked when an open addendum request exists');

// Reject the lingering addendum
pipelineService.rejectAddendum(lingeringAddendum.id, 'Post-launch backlog', adminUser.id);

// TEST 17: adminApproveLive (success) & getDeliverableDetail
console.log('\n--- TEST 17: adminApproveLive (success when all conditions met) ---');
const liveProject = pipelineService.adminApproveLive(
  testProjectId,
  adminUser.id,
  'All 4 stages verified. Production approved.'
);
assert(liveProject.status === 'LIVE', 'Project status transitioned to LIVE');
assert(liveProject.current_stage === 'LIVE', 'Project current_stage transitioned to LIVE');

const delivAfterLive = queryOne('SELECT status, current_stage FROM pipeline_deliverables WHERE id = ?', [deliv1.id]);
assert(delivAfterLive.status === 'LIVE', 'Deliverable status transitioned to LIVE');
assert(delivAfterLive.current_stage === 'LIVE', 'Deliverable current_stage transitioned to LIVE');

// Verify access_log for live approval
const liveLog = queryOne("SELECT * FROM access_log WHERE target_id = ? AND action = 'pipeline_admin_approved_live'", [testProjectId]);
assert(liveLog !== null, 'access_log recorded pipeline_admin_approved_live');

console.log('\n--- TEST 18: getDeliverableDetail (full tree returned) ---');
const detailTree = pipelineService.getDeliverableDetail(deliv1.id);
assert(detailTree && detailTree.deliverable, 'getDeliverableDetail returns deliverable object');
assert(detailTree.stages && detailTree.stages.RESEARCH && detailTree.stages.DESIGN && detailTree.stages.DEV && detailTree.stages.TEST, 'All 4 stages represented in tree');
assert(detailTree.handoffs.length >= 4, 'Handoff records included in tree');
assert(detailTree.addendums.length >= 1, 'Addendum records included in tree');
assert(typeof detailTree.summary.RESEARCH === 'number', 'Summary contains computed % per stage');

console.log('\n===================================================================');
console.log(`  LAYER 2 VERIFICATION SUMMARY: ${passedCount}/${totalCount} ASSERTIONS PASS`);
console.log('===================================================================');
