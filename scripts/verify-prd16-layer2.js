import crypto from 'node:crypto';
import { getDatabase, queryAll, queryOne, execute } from '../src/db/database.js';
import * as pointPoolService from '../src/services/pointPoolService.js';
import * as pipelineService from '../src/services/pipelineService.js';
import * as payoutService from '../src/services/payoutService.js';

console.log('===================================================================');
console.log('       PRD 16 — LAYER 2: CORE SERVICE SUITE VERIFICATION');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

try {
  // Setup isolated test entities
  const adminUser = queryOne("SELECT * FROM users WHERE role = 'admin' LIMIT 1;");
  if (!adminUser) {
    throw new Error('Admin user not found in database. Seed data must be present.');
  }

  // Create test users for different roles
  const ts = Date.now();
  const testDevUser = {
    id: `dev-${ts}`,
    name: 'Test Dev 16',
    email: `dev16.${ts}@example.com`,
    role: 'developer'
  };
  const testDevUser2 = {
    id: `dev2-${ts}`,
    name: 'Test Dev 16 Two',
    email: `dev16.2.${ts}@example.com`,
    role: 'developer'
  };
  const testDesignerUser = {
    id: `des-${ts}`,
    name: 'Test Designer 16',
    email: `des16.${ts}@example.com`,
    role: 'designer'
  };
  const testLeadUser = {
    id: `lead-${ts}`,
    name: 'Test Lead 16',
    email: `lead16.${ts}@example.com`,
    role: 'developer',
    sub_role: 'lead'
  };

  const dummyHash = '$2a$10$abcdefghijklmnopqrstuu';
  execute(
    "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
    [testDevUser.id, testDevUser.name, testDevUser.email, testDevUser.role, dummyHash]
  );
  execute(
    "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
    [testDevUser2.id, testDevUser2.name, testDevUser2.email, testDevUser2.role, dummyHash]
  );
  execute(
    "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
    [testDesignerUser.id, testDesignerUser.name, testDesignerUser.email, testDesignerUser.role, dummyHash]
  );
  execute(
    "INSERT INTO users (id, name, email, role, sub_role, status, password_hash) VALUES (?, ?, ?, ?, ?, 'active', ?);",
    [testLeadUser.id, testLeadUser.name, testLeadUser.email, testLeadUser.role, testLeadUser.sub_role, dummyHash]
  );

  const testIdeaId = `idea-${ts}`;
  execute(`
    INSERT INTO ideas (id, owner_id, title, description, status)
    VALUES (?, ?, 'PRD 16 Test Idea', 'Testing Core Services', 'APPROVED')
  `, [testIdeaId, adminUser.id]);

  // Create test project
  const testProject = {
    id: `proj-prd16-l2-${ts}`,
    idea_id: testIdeaId,
    title: 'PRD 16 Layer 2 Core Test Project',
    owner_id: adminUser.id,
    current_stage: 'RESEARCH_DEV_PARALLEL',
    status: 'ACTIVE'
  };
  execute(
    "INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status) VALUES (?, ?, ?, ?, ?, ?);",
    [testProject.id, testProject.idea_id, testProject.title, testProject.owner_id, testProject.current_stage, testProject.status]
  );

  // Add members to project
  execute(
    "INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'frontend_dev');",
    [`pm-dev1-${ts}`, testProject.id, testDevUser.id]
  );
  execute(
    "INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'backend_dev');",
    [`pm-dev2-${ts}`, testProject.id, testDevUser2.id]
  );
  execute(
    "INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'designer');",
    [`pm-des1-${ts}`, testProject.id, testDesignerUser.id]
  );
  execute(
    "INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'admin_reviewer');",
    [`pm-lead1-${ts}`, testProject.id, testLeadUser.id]
  );

  // Create test deliverable
  const testDeliv = {
    id: `deliv-prd16-${ts}`,
    project_id: testProject.id,
    title: 'Core Deliverable 16',
    current_stage: 'DEV',
    status: 'IN_PROGRESS'
  };
  execute(
    "INSERT INTO pipeline_deliverables (id, project_id, title, current_stage, status, created_by) VALUES (?, ?, ?, ?, ?, ?);",
    [testDeliv.id, testDeliv.project_id, testDeliv.title, testDeliv.current_stage, testDeliv.status, adminUser.id]
  );

  // Helper to add checklist points directly
  function createPoint(stage, title, weight = 5) {
    const ptId = `pt-${stage.toLowerCase()}-${crypto.randomUUID()}`;
    execute(`
      INSERT INTO pipeline_checklist_points (
        id, deliverable_id, stage, point_title, point_description, weight, status, created_by
      ) VALUES (?, ?, ?, ?, 'Description', ?, 'UNCLAIMED', ?)
    `, [ptId, testDeliv.id, stage, title, weight, adminUser.id]);
    return ptId;
  }

  // -----------------------------------------------------------------
  // 1. claimPoint — success case
  // -----------------------------------------------------------------
  console.log('--- TEST 1: claimPoint (Success) ---');
  const ptDev1 = createPoint('DEV', 'API Endpoint Auth', 5);
  const claimRes = pointPoolService.claimPoint(ptDev1, testDevUser.id, testDevUser.role);

  assert(claimRes.updatedPoint.status === 'CLAIMED', 'claimPoint: point status updated to CLAIMED');
  assert(claimRes.updatedPoint.claim_locked_by === testDevUser.id, 'claimPoint: claim_locked_by set to userId');
  assert(claimRes.updatedPoint.assigned_to === testDevUser.id, 'claimPoint: assigned_to set to userId');
  assert(!!claimRes.updatedPoint.claim_locked_at, 'claimPoint: claim_locked_at timestamp set');
  assert(claimRes.claimRecord && claimRes.claimRecord.claimed_by === testDevUser.id, 'claimPoint: point_pool_claims record created');

  // Verify access_log entry
  const claimLog = queryOne("SELECT * FROM access_log WHERE target_id = ? AND action = 'point_claimed'", [ptDev1]);
  assert(!!claimLog, 'claimPoint: logged to access_log with action point_claimed');

  // -----------------------------------------------------------------
  // 2. claimPoint — 409 if already claimed
  // -----------------------------------------------------------------
  console.log('\n--- TEST 2: claimPoint (409 Conflict if already claimed) ---');
  let err409 = null;
  try {
    pointPoolService.claimPoint(ptDev1, testDevUser2.id, testDevUser2.role);
  } catch (e) {
    err409 = e;
  }
  assert(!!err409 && err409.status === 409, 'claimPoint: throws 409 Conflict if already claimed/locked', err409?.message);

  // -----------------------------------------------------------------
  // 3. claimPoint — 403 if role mismatch
  // -----------------------------------------------------------------
  console.log('\n--- TEST 3: claimPoint (403 Forbidden on Role Mismatch) ---');
  const ptDesign1 = createPoint('DESIGN', 'UI Wireframe Mockup', 5);
  let err403 = null;
  try {
    // Developer trying to claim DESIGN stage point
    pointPoolService.claimPoint(ptDesign1, testDevUser.id, testDevUser.role);
  } catch (e) {
    err403 = e;
  }
  assert(!!err403 && err403.status === 403, 'claimPoint: throws 403 on role mismatch', err403?.message);

  // -----------------------------------------------------------------
  // 4. releasePoint — success (claim record updated, not deleted)
  // -----------------------------------------------------------------
  console.log('\n--- TEST 4: releasePoint (Success — append-only record updated) ---');
  const releasedPt = pointPoolService.releasePoint(ptDev1, testLeadUser.id, 'Reassigning task to another sprint');
  assert(releasedPt.status === 'UNCLAIMED', 'releasePoint: point status updated to UNCLAIMED');
  assert(releasedPt.claim_locked_by === null, 'releasePoint: claim_locked_by cleared to NULL');
  assert(releasedPt.claim_locked_at === null, 'releasePoint: claim_locked_at cleared to NULL');
  assert(releasedPt.assigned_to === null, 'releasePoint: assigned_to cleared to NULL');

  const claimRecAfterRelease = queryOne('SELECT * FROM point_pool_claims WHERE point_id = ?', [ptDev1]);
  assert(!!claimRecAfterRelease, 'releasePoint: point_pool_claims record still exists (not deleted)');
  assert(!!claimRecAfterRelease.released_at, 'releasePoint: released_at set on claim record');
  assert(claimRecAfterRelease.released_by === testLeadUser.id, 'releasePoint: released_by set to admin/lead');
  assert(claimRecAfterRelease.release_reason === 'Reassigning task to another sprint', 'releasePoint: release_reason recorded');

  // -----------------------------------------------------------------
  // 5. releasePoint — 403 if not Lead/Admin
  // -----------------------------------------------------------------
  console.log('\n--- TEST 5: releasePoint (403 if not Lead/Admin) ---');
  // Claim it again first
  pointPoolService.claimPoint(ptDev1, testDevUser.id, testDevUser.role);
  let release403 = null;
  try {
    pointPoolService.releasePoint(ptDev1, testDevUser2.id, 'Developer attempting unauthorized release');
  } catch (e) {
    release403 = e;
  }
  assert(!!release403 && release403.status === 403, 'releasePoint: throws 403 when releaser is not Lead or Admin', release403?.message);

  // -----------------------------------------------------------------
  // 6. releasePoint — blocked on empty reason
  // -----------------------------------------------------------------
  console.log('\n--- TEST 6: releasePoint (Blocked on empty reason) ---');
  let releaseEmptyReason = null;
  try {
    pointPoolService.releasePoint(ptDev1, adminUser.id, '   ');
  } catch (e) {
    releaseEmptyReason = e;
  }
  assert(!!releaseEmptyReason && releaseEmptyReason.status === 400, 'releasePoint: throws 400 when reason is empty', releaseEmptyReason?.message);

  // -----------------------------------------------------------------
  // 7. getPointPool — returns stages grouped with participation
  // -----------------------------------------------------------------
  console.log('\n--- TEST 7: getPointPool (Stages grouped + participation) ---');
  const pool = pointPoolService.getPointPool(testProject.id, testDevUser.id, testDevUser.role);
  assert(!!pool.stages, 'getPointPool: returns stages container');
  assert(Array.isArray(pool.stages.RESEARCH), 'getPointPool: stages.RESEARCH is array');
  assert(Array.isArray(pool.stages.DESIGN), 'getPointPool: stages.DESIGN is array');
  assert(Array.isArray(pool.stages.DEV), 'getPointPool: stages.DEV is array');
  assert(Array.isArray(pool.stages.TEST), 'getPointPool: stages.TEST is array');
  assert(Array.isArray(pool.participation), 'getPointPool: returns participation summary array');

  // -----------------------------------------------------------------
  // 8. getAbandonedPoints — returns points past abandonment_days
  // -----------------------------------------------------------------
  console.log('\n--- TEST 8: getAbandonedPoints ---');
  const ptAbandoned = createPoint('DEV', 'Abandoned Task', 5);
  pointPoolService.claimPoint(ptAbandoned, testDevUser2.id, testDevUser2.role);
  // Force claim_locked_at to 10 days ago
  execute("UPDATE pipeline_checklist_points SET claim_locked_at = datetime('now', '-10 days') WHERE id = ?", [ptAbandoned]);

  const abandonedList = pointPoolService.getAbandonedPoints(testProject.id);
  const foundAbandoned = abandonedList.find(p => p.id === ptAbandoned);
  assert(!!foundAbandoned, 'getAbandonedPoints: returns points past abandonment_days', `Found point ID: ${foundAbandoned?.id}`);
  assert(foundAbandoned?.claim_locked_by === testDevUser2.id, 'getAbandonedPoints: includes claimer info');

  // -----------------------------------------------------------------
  // 9. computeParticipationPct — exact math verified
  // -----------------------------------------------------------------
  console.log('\n--- TEST 9: computeParticipationPct (Exact math verified) ---');
  // Create 2 points weight 5 each in RESEARCH, both approved by userId
  const ptR1 = createPoint('RESEARCH', 'Market Research 1', 5);
  const ptR2 = createPoint('RESEARCH', 'Market Research 2', 5);
  execute("UPDATE pipeline_checklist_points SET status = 'APPROVED', claim_locked_by = ? WHERE id = ?", [testDevUser.id, ptR1]);
  execute("UPDATE pipeline_checklist_points SET status = 'APPROVED', claim_locked_by = ? WHERE id = ?", [testDevUser.id, ptR2]);

  const devPctR = pointPoolService.computeParticipationPct(testDevUser.id, testProject.id, 'RESEARCH');
  const otherPctR = pointPoolService.computeParticipationPct(testDevUser2.id, testProject.id, 'RESEARCH');
  assert(devPctR === 100.00, 'computeParticipationPct: 100% when member claimed all approved weight', `Actual: ${devPctR}%`);
  assert(otherPctR === 0.00, 'computeParticipationPct: 0% for non-claiming member', `Actual: ${otherPctR}%`);

  // -----------------------------------------------------------------
  // 10. computeOverallParticipationPct — cross-stage math verified
  // -----------------------------------------------------------------
  console.log('\n--- TEST 10: computeOverallParticipationPct (Cross-stage math verified) ---');
  // RESEARCH has 10 points for testDevUser.id.
  // Add 10 points in TEST stage for testDevUser2.id. Total approved across project = 20.
  const ptT1 = createPoint('TEST', 'Integration Tests', 10);
  execute("UPDATE pipeline_checklist_points SET status = 'APPROVED', claim_locked_by = ? WHERE id = ?", [testDevUser2.id, ptT1]);

  const overallDev1 = pointPoolService.computeOverallParticipationPct(testDevUser.id, testProject.id);
  const overallDev2 = pointPoolService.computeOverallParticipationPct(testDevUser2.id, testProject.id);
  // Total = 10 (RESEARCH) + 10 (TEST) = 20. Each has 10/20 = 50.00%
  assert(overallDev1 === 50.00, 'computeOverallParticipationPct: member 1 has exactly 50.00% of approved points', `Actual: ${overallDev1}%`);
  assert(overallDev2 === 50.00, 'computeOverallParticipationPct: member 2 has exactly 50.00% of approved points', `Actual: ${overallDev2}%`);

  // -----------------------------------------------------------------
  // 11. applyParticipationBlocks — member below threshold blocked
  // 12. applyParticipationBlocks — member above threshold NOT blocked
  // -----------------------------------------------------------------
  console.log('\n--- TEST 11 & 12: applyParticipationBlocks ---');
  // Designer has 0.00% participation (below 20% default threshold).
  // Dev 1 has 50.00% (above 20% default threshold).
  // Create revenue event and revenue splits
  const revEventId = `rev-event-${ts}`;
  execute(`
    INSERT INTO revenue_events (id, project_id, amount, source, event_date, entered_by)
    VALUES (?, ?, 10000.00, 'Enterprise Contract', '2026-10-27', ?)
  `, [revEventId, testProject.id, adminUser.id]);

  const splitDev1 = `split-dev1-${ts}`;
  const splitDes1 = `split-des1-${ts}`;
  execute(`
    INSERT INTO revenue_splits (id, revenue_event_id, user_id, amount, rule_applied, split_type, is_blocked)
    VALUES (?, ?, ?, 500.00, 'OWNER_50_TEAM_50', 'TEAM_CONTRIBUTOR', 0)
  `, [splitDev1, revEventId, testDevUser.id]);
  execute(`
    INSERT INTO revenue_splits (id, revenue_event_id, user_id, amount, rule_applied, split_type, is_blocked)
    VALUES (?, ?, ?, 300.00, 'OWNER_50_TEAM_50', 'TEAM_CONTRIBUTOR', 0)
  `, [splitDes1, revEventId, testDesignerUser.id]);

  const blockRes = pointPoolService.applyParticipationBlocks(testProject.id);
  const blockedDesSplit = queryOne('SELECT * FROM revenue_splits WHERE id = ?', [splitDes1]);
  const unblockedDevSplit = queryOne('SELECT * FROM revenue_splits WHERE id = ?', [splitDev1]);

  assert(blockedDesSplit.is_blocked === 1, 'applyParticipationBlocks: member below threshold is blocked (is_blocked = 1)');
  assert(blockedDesSplit.block_reason?.includes('Participation below threshold'), 'applyParticipationBlocks: block_reason recorded');
  assert(unblockedDevSplit.is_blocked === 0, 'applyParticipationBlocks: member above threshold is NOT blocked (is_blocked = 0)');
  assert(blockRes.blockedMembers.some(m => m.userId === testDesignerUser.id), 'applyParticipationBlocks: blocked member returned in blockedMembers list');

  // -----------------------------------------------------------------
  // 13. unblockRevenueSplit — success with valid reason
  // 14. unblockRevenueSplit — blocked if reason < 10 chars
  // 15. unblockRevenueSplit — blocked if not Admin
  // -----------------------------------------------------------------
  console.log('\n--- TEST 13, 14 & 15: unblockRevenueSplit ---');
  // Test 14: blocked if reason < 10 chars
  let unblockShortErr = null;
  try {
    pointPoolService.unblockRevenueSplit(splitDes1, adminUser.id, 'Too short');
  } catch (e) {
    unblockShortErr = e;
  }
  assert(!!unblockShortErr && unblockShortErr.status === 400, 'unblockRevenueSplit: blocked if reason < 10 characters', unblockShortErr?.message);

  // Test 15: blocked if not Admin
  let unblockNotAdminErr = null;
  try {
    pointPoolService.unblockRevenueSplit(splitDes1, testLeadUser.id, 'Valid length reason but not admin');
  } catch (e) {
    unblockNotAdminErr = e;
  }
  assert(!!unblockNotAdminErr && unblockNotAdminErr.status === 403, 'unblockRevenueSplit: blocked if caller is not Admin', unblockNotAdminErr?.message);

  // Test 13: success with valid reason
  const unblockedSplit = pointPoolService.unblockRevenueSplit(splitDes1, adminUser.id, 'Board verified exceptional off-pipeline contributions');
  assert(unblockedSplit.is_blocked === 0, 'unblockRevenueSplit: is_blocked restored to 0');
  assert(unblockedSplit.unblocked_by === adminUser.id, 'unblockRevenueSplit: unblocked_by set to adminId');
  assert(!!unblockedSplit.unblocked_at, 'unblockRevenueSplit: unblocked_at timestamp recorded');

  // -----------------------------------------------------------------
  // 16. setThreshold — success case
  // 17. setThreshold — blocked if project is LIVE
  // 18. setThreshold — blocked if pct > 100 or days > 30
  // 19. getThreshold — returns default if not set
  // -----------------------------------------------------------------
  console.log('\n--- TEST 16, 17, 18 & 19: setThreshold & getThreshold ---');
  // Test 19: default threshold if not set
  const defaultThresh = pointPoolService.getThreshold(`fresh-project-${ts}`);
  assert(defaultThresh.threshold_pct === 20.00, 'getThreshold: returns default threshold 20.00%');
  assert(defaultThresh.abandonment_days === 7, 'getThreshold: returns default abandonment 7 days');

  // Test 16: setThreshold success
  const customThresh = pointPoolService.setThreshold(testProject.id, 25.00, 10, adminUser.id);
  assert(customThresh.threshold_pct === 25.00, 'setThreshold: threshold_pct updated to 25.00');
  assert(customThresh.abandonment_days === 10, 'setThreshold: abandonment_days updated to 10');

  // Test 18: blocked if pct > 100 or days > 30
  let errPctOver = null;
  try {
    pointPoolService.setThreshold(testProject.id, 105, 5, adminUser.id);
  } catch (e) {
    errPctOver = e;
  }
  assert(!!errPctOver && errPctOver.status === 400, 'setThreshold: blocked if thresholdPct > 100', errPctOver?.message);

  let errDaysOver = null;
  try {
    pointPoolService.setThreshold(testProject.id, 20, 35, adminUser.id);
  } catch (e) {
    errDaysOver = e;
  }
  assert(!!errDaysOver && errDaysOver.status === 400, 'setThreshold: blocked if abandonDays > 30', errDaysOver?.message);

  // Test 17: blocked if project is LIVE
  const liveProjId = `live-proj-${ts}`;
  execute("INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status) VALUES (?, ?, 'Live Project', ?, 'LIVE', 'LIVE')", [liveProjId, testIdeaId, adminUser.id]);
  let errLiveFrozen = null;
  try {
    pointPoolService.setThreshold(liveProjId, 30, 5, adminUser.id);
  } catch (e) {
    errLiveFrozen = e;
  }
  assert(!!errLiveFrozen && errLiveFrozen.status === 400, 'setThreshold: blocked if project is LIVE (threshold frozen)', errLiveFrozen?.message);

  // -----------------------------------------------------------------
  // 20. addToolLink — success case
  // 21. addToolLink — blocked if invalid URL
  // 22. getToolLinks — returns only non-deleted links
  // 23. deleteToolLink — soft delete verified
  // -----------------------------------------------------------------
  console.log('\n--- TEST 20, 21, 22 & 23: Tool Links Management ---');
  // Test 21: invalid URL blocked
  let invalidUrlErr = null;
  try {
    pointPoolService.addToolLink(ptDev1, testProject.id, testDevUser.id, 'Invalid Link', 'ftp://not-allowed.com');
  } catch (e) {
    invalidUrlErr = e;
  }
  assert(!!invalidUrlErr && invalidUrlErr.status === 400, 'addToolLink: blocked on invalid URL protocol', invalidUrlErr?.message);

  // Test 20: success case
  const tool1 = pointPoolService.addToolLink(ptDev1, testProject.id, testDevUser.id, 'Figma Prototype', 'https://figma.com/file/mockup123');
  assert(tool1.tool_name === 'Figma Prototype', 'addToolLink: tool link created with correct name');
  assert(tool1.tool_url === 'https://figma.com/file/mockup123', 'addToolLink: tool link created with correct URL');

  // Test 22: getToolLinks returns non-deleted
  const tool2 = pointPoolService.addToolLink(ptDev1, testProject.id, testDevUser.id, 'GitHub PR', 'https://github.com/pull/42');
  const linksBefore = pointPoolService.getToolLinks(ptDev1);
  assert(linksBefore.length === 2, 'getToolLinks: returns all active tool links for point', `Found ${linksBefore.length}`);

  // Test 23: deleteToolLink soft delete
  pointPoolService.deleteToolLink(tool2.id, testDevUser.id);
  const linksAfter = pointPoolService.getToolLinks(ptDev1);
  assert(linksAfter.length === 1, 'deleteToolLink: link no longer returned by getToolLinks');
  const dbTool2 = queryOne('SELECT * FROM point_tool_links WHERE id = ?', [tool2.id]);
  assert(!!dbTool2 && !!dbTool2.deleted_at, 'deleteToolLink: soft delete verified (deleted_at set, row still in DB)');

  // -----------------------------------------------------------------
  // 24. pipelineService.claimPoint — now sets claim_locked_by
  // -----------------------------------------------------------------
  console.log('\n--- TEST 24: pipelineService.claimPoint sets claim_locked_by ---');
  const ptPipeline = createPoint('DEV', 'Pipeline Integration Point', 5);
  const pipePoint = pipelineService.claimPoint(ptPipeline, testDevUser.id, testDevUser.role);
  assert(pipePoint.status === 'CLAIMED', 'pipelineService.claimPoint: status updated to CLAIMED');
  assert(pipePoint.claim_locked_by === testDevUser.id, 'pipelineService.claimPoint: claim_locked_by set to userId');
  assert(!!pipePoint.claim_locked_at, 'pipelineService.claimPoint: claim_locked_at set');

  const pipeClaimRec = queryOne('SELECT * FROM point_pool_claims WHERE point_id = ?', [ptPipeline]);
  assert(!!pipeClaimRec && pipeClaimRec.claimed_by === testDevUser.id, 'pipelineService.claimPoint: point_pool_claims record created');

  // -----------------------------------------------------------------
  // 25. pipelineService.adminApproveLive — calls applyParticipationBlocks
  // -----------------------------------------------------------------
  console.log('\n--- TEST 25: pipelineService.adminApproveLive calls applyParticipationBlocks ---');
  // Mark all deliverables for testProject as COMPLETE
  execute("UPDATE pipeline_deliverables SET status = 'COMPLETE' WHERE project_id = ?", [testProject.id]);
  // Re-block designer's split to verify adminApproveLive runs applyParticipationBlocks
  execute("UPDATE revenue_splits SET is_blocked = 0 WHERE id = ?", [splitDes1]);

  const liveRes = pipelineService.adminApproveLive(testProject.id, adminUser.id, 'Final sign-off');
  assert(liveRes.status === 'LIVE' || liveRes.project?.status === 'LIVE', 'adminApproveLive: project transitions to LIVE');
  assert(Array.isArray(liveRes.blockedMembers), 'adminApproveLive: returns blockedMembers array from applyParticipationBlocks');
  assert(liveRes.blockedMembers.some(m => m.userId === testDesignerUser.id), 'adminApproveLive: blockedMembers contains low-participation member');

  // -----------------------------------------------------------------
  // 26. payoutService — skips is_blocked = 1 splits & blocks withdrawal
  // -----------------------------------------------------------------
  console.log('\n--- TEST 26: payoutService Skips Blocked Splits & Blocks Withdrawal ---');
  // Designer has blocked split (splitDes1 is blocked by adminApproveLive above)
  const eligibleSplits = payoutService.getEligiblePayoutSplits(testDesignerUser.id, testProject.id);
  assert(eligibleSplits.length === 0, 'payoutService.getEligiblePayoutSplits: skips is_blocked = 1 splits silently', `Found: ${eligibleSplits.length}`);

  // Test withdrawal request blocked due to blocked splits
  // Give designer wallet balance first
  execute("UPDATE users SET wallet_balance = 1000.00 WHERE id = ?", [testDesignerUser.id]);
  const withdrawalRes = payoutService.requestWithdrawal({
    userId: testDesignerUser.id,
    amount: 100.00
  });
  assert(withdrawalRes.success === false && withdrawalRes.status === 400, 'payoutService.requestWithdrawal: returns 400 when splits are blocked');
  assert(withdrawalRes.error?.includes('blocked due to insufficient project participation'), 'payoutService.requestWithdrawal: exact error message returned');

  console.log('\n===================================================================');
  console.log(`  PRD 16 LAYER 2 VERIFICATION COMPLETE: ${passedTests}/${totalTests} CHECKS PASSED`);
  console.log('===================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
} catch (err) {
  console.error('\n❌ FATAL EXCEPTION DURING VERIFICATION:', err);
  process.exit(1);
}
