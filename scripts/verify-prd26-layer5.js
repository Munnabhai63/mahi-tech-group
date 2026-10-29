/**
 * scripts/verify-prd26-layer5.js
 * Verification Suite for PRD 26 Layer 5: Platform-Wide Trigger Integration
 *
 * Verifies platform-wide trigger integration across all services:
 * 1. SPRINT: SPRINT_STARTED in startSprint, SPRINT_COMPLETED in completeSprint
 * 2. BACKLOG: ITEM_CREATED in createBacklogItem, ITEM_ASSIGNED in updateBacklogItem, ITEM_STATUS_CHANGED in updateItemStatus
 * 3. OKR: OKR_PROGRESS_UPDATED, OKR_PROGRESS_REACHED, OKR_AT_RISK in submitCheckin
 * 4. GANTT: TASK_COMPLETED in updateProgress/updateItem, MILESTONE_MISSED in updateMilestone
 * 5. WORKLOAD: MEMBER_OVERLOADED in evaluateAndCreateWorkloadAlert
 * 6. TIME: TIME_ENTRY_APPROVED in approveTimeEntry, TIME_ENTRY_REJECTED in rejectTimeEntry
 * 7. EXPENSE: EXPENSE_APPROVED in approveExpense, EXPENSE_REJECTED in rejectExpense,
 *             BUDGET_THRESHOLD_REACHED & BUDGET_EXCEEDED in evaluateBudgetAlerts,
 *             INVOICE_OVERDUE in processOverdueInvoices
 * 8. CLIENT: CLIENT_ORDER_SUBMITTED in submitClientOrder, CLIENT_MILESTONE_APPROVED in decideMilestoneApproval
 * 9. GITHUB: PR_MERGED in processWebhookEvent
 * 10. MEMBER: MEMBER_OFFBOARDED in executeOffboardingKillswitch, REVENUE_SHARE_BLOCKED in applyParticipationBlocks
 * 11. PIPELINE: PIPELINE_STAGE_COMPLETED in approveHandoff
 * 12. Non-blocking safety: Host service succeeds even if fireTrigger receives unexpected inputs.
 *
 * Real SQLite database, ZERO mocks.
 */

import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { fireTrigger, processQueueBatch } from '../src/services/automationEngine.js';
import { createSprint, startSprint, completeSprint } from '../src/services/sprintService.js';
import { createBacklogItem, updateBacklogItem, updateItemStatus } from '../src/services/backlogService.js';
import { createObjective, createKeyResult, submitCheckin } from '../src/services/okrService.js';
import { createItem as createGanttItem, updateProgress, updateMilestone, createMilestone } from '../src/services/ganttService.js';
import { evaluateAndCreateWorkloadAlert } from '../src/services/workloadService.js';
import { createManualEntry, requestApproval, approveTimeEntry, rejectTimeEntry } from '../src/services/timeTrackingService.js';
import { createBudget, submitExpense, approveExpense, rejectExpense, evaluateBudgetAlerts, processOverdueInvoices, createInvoice } from '../src/services/financeService.js';
import { submitClientOrder, decideMilestoneApproval } from '../src/services/clientFacingService.js';
import { processWebhookEvent } from '../src/services/githubWebhookProcessor.js';
import { executeOffboardingKillswitch } from '../src/services/offboardingService.js';
import { applyParticipationBlocks } from '../src/services/pointPoolService.js';
import { approveHandoff } from '../src/services/pipelineService.js';
import crypto from 'node:crypto';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${message}`);
    failed++;
  }
}

/**
 * Helper to ensure an active rule exists for module/event so fireTrigger enqueues
 */
function ensureRule(module, event, name, projectId = null, createdBy = null) {
  const cleanModule = String(module).toUpperCase();
  const cleanEvent = String(event).toUpperCase();
  const existing = queryOne(
    'SELECT id FROM automation_rules WHERE trigger_module = ? AND trigger_event = ? AND is_active = 1 LIMIT 1;',
    [cleanModule, cleanEvent]
  );
  if (existing) return existing.id;

  const adminId = createdBy || queryOne("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1;")?.id;

  const res = execute(
    `INSERT INTO automation_rules (
       name, description, scope, project_id, trigger_module, trigger_event,
       trigger_conditions, actions, is_active, created_by, created_at, updated_at
     ) VALUES (?, ?, 'GLOBAL', ?, ?, ?, NULL, ?, 1, ?, datetime('now'), datetime('now'));`,
    [
      name || `Rule for ${cleanModule}:${cleanEvent}`,
      `Auto verification test rule`,
      projectId,
      cleanModule,
      cleanEvent,
      JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: `Trigger fired: ${cleanEvent}` } }]),
      adminId
    ]
  );
  return Number(res.lastInsertRowid);
}

async function run() {
  console.log('='.repeat(80));
  console.log('PRD 26 Layer 5 Verification Suite: Platform-Wide Trigger Integration');
  console.log('='.repeat(80));

  const db = getDatabase();

  // Test Fixtures
  const admin = queryOne("SELECT * FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1;") || { id: 1, role: 'admin' };
  const member = queryOne("SELECT * FROM users WHERE role = 'developer' LIMIT 1;") || { id: 2, role: 'developer' };
  let project = queryOne("SELECT * FROM projects LIMIT 1;");
  if (!project) {
    const projId = crypto.randomUUID();
    const ideaId = crypto.randomUUID();
    execute("INSERT INTO projects (id, idea_id, title, owner_id) VALUES (?, ?, 'Layer 5 Test Project', ?);", [projId, ideaId, admin.id]);
    project = { id: projId, title: 'Layer 5 Test Project' };
  }

  // ---------------------------------------------------------------------------
  // 1. SPRINT TRIGGERS (SPRINT_STARTED, SPRINT_COMPLETED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Sprint Triggers ---');
  ensureRule('SPRINT', 'SPRINT_STARTED', 'Test Sprint Started');
  ensureRule('SPRINT', 'SPRINT_COMPLETED', 'Test Sprint Completed');

  const sprintName = `Sprint-L5-${Date.now()}`;
  const sprint = createSprint({
    project_id: project.id,
    name: sprintName,
    goal: 'Test sprint triggers',
    userId: admin.id
  });
  assert(sprint && sprint.id, 'Created draft sprint');

  const beforeStartQueueCount = queryOne(
    "SELECT COUNT(*) as count FROM automation_queue WHERE trigger_event = 'SPRINT_STARTED';"
  )?.count || 0;

  startSprint(sprint.id, admin.id);

  const afterStartQueue = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'SPRINT_STARTED' ORDER BY id DESC LIMIT 1;"
  );
  assert(afterStartQueue && afterStartQueue.trigger_source_id === sprint.id, 'SPRINT_STARTED enqueued in automation_queue');
  assert(afterStartQueue.status === 'QUEUED', 'SPRINT_STARTED job status is QUEUED');
  const startPayload = JSON.parse(afterStartQueue.trigger_data);
  assert(startPayload.project_id === project.id && startPayload.sprint.id === sprint.id, 'SPRINT_STARTED trigger_data snapshot accurate');

  completeSprint(sprint.id, admin.id);

  const afterCompleteQueue = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'SPRINT_COMPLETED' ORDER BY id DESC LIMIT 1;"
  );
  assert(afterCompleteQueue && afterCompleteQueue.trigger_source_id === sprint.id, 'SPRINT_COMPLETED enqueued in automation_queue');
  const completePayload = JSON.parse(afterCompleteQueue.trigger_data);
  assert(completePayload.sprint.status === 'COMPLETED', 'SPRINT_COMPLETED trigger_data has status COMPLETED');

  // ---------------------------------------------------------------------------
  // 2. BACKLOG TRIGGERS (ITEM_CREATED, ITEM_ASSIGNED, ITEM_STATUS_CHANGED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Backlog Triggers ---');
  ensureRule('BACKLOG', 'ITEM_CREATED', 'Test Item Created');
  ensureRule('BACKLOG', 'ITEM_ASSIGNED', 'Test Item Assigned');
  ensureRule('BACKLOG', 'ITEM_STATUS_CHANGED', 'Test Item Status Changed');

  const backlogItem = createBacklogItem({
    project_id: project.id,
    title: `Task L5 ${Date.now()}`,
    description: 'Layer 5 verification task',
    userId: admin.id
  });
  assert(backlogItem && backlogItem.id, 'Created backlog item');

  const itemCreatedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'ITEM_CREATED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [backlogItem.id]
  );
  assert(itemCreatedJob && itemCreatedJob.status === 'QUEUED', 'ITEM_CREATED enqueued in automation_queue');

  updateBacklogItem(backlogItem.id, { assigned_to: member.id }, admin.id);

  const itemAssignedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'ITEM_ASSIGNED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [backlogItem.id]
  );
  assert(itemAssignedJob && itemAssignedJob.status === 'QUEUED', 'ITEM_ASSIGNED enqueued in automation_queue');
  const assignedPayload = JSON.parse(itemAssignedJob.trigger_data);
  assert(assignedPayload.assigned_to === member.id, 'ITEM_ASSIGNED payload has updated assigned_to');

  updateItemStatus(backlogItem.id, { status: 'IN_PROGRESS' }, admin.id);

  const itemStatusJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'ITEM_STATUS_CHANGED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [backlogItem.id]
  );
  assert(itemStatusJob && itemStatusJob.status === 'QUEUED', 'ITEM_STATUS_CHANGED enqueued in automation_queue');
  const statusPayload = JSON.parse(itemStatusJob.trigger_data);
  assert(statusPayload.status === 'IN_PROGRESS' && statusPayload.new_status === 'IN_PROGRESS', 'ITEM_STATUS_CHANGED payload has new status');

  // ---------------------------------------------------------------------------
  // 3. OKR TRIGGERS (OKR_PROGRESS_UPDATED, OKR_PROGRESS_REACHED, OKR_AT_RISK)
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. OKR Triggers ---');
  ensureRule('OKR', 'OKR_PROGRESS_UPDATED', 'Test OKR Progress Updated');
  ensureRule('OKR', 'OKR_PROGRESS_REACHED', 'Test OKR Progress Reached');
  ensureRule('OKR', 'OKR_AT_RISK', 'Test OKR At Risk');

  const obj = createObjective({
    title: `Objective L5 ${Date.now()}`,
    cycle: 'Q1-2026',
    level: 'COMPANY',
    user: admin
  });
  assert(obj && obj.id, 'Created OKR objective');

  const kr = createKeyResult({
    objective_id: obj.id,
    title: 'Deliver 100 features',
    type: 'NUMBER',
    target_value: 100,
    unit: 'features',
    user: admin
  });
  assert(kr && kr.id, 'Created OKR key result');

  // Submit checkin with progress 50
  submitCheckin({
    key_result_id: kr.id,
    new_value: 50,
    confidence: 'MEDIUM',
    user: admin
  });

  const okrUpdatedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'OKR_PROGRESS_UPDATED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [kr.id]
  );
  assert(okrUpdatedJob && okrUpdatedJob.status === 'QUEUED', 'OKR_PROGRESS_UPDATED enqueued in automation_queue');

  // Submit checkin with progress 100
  submitCheckin({
    key_result_id: kr.id,
    new_value: 100,
    confidence: 'HIGH',
    user: admin
  });

  const okrReachedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'OKR_PROGRESS_REACHED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [obj.id]
  );
  assert(okrReachedJob && okrReachedJob.status === 'QUEUED', 'OKR_PROGRESS_REACHED enqueued in automation_queue');

  // Submit checkin with LOW confidence -> triggers AT_RISK
  submitCheckin({
    key_result_id: kr.id,
    new_value: 20,
    confidence: 'LOW',
    user: admin
  });

  const okrAtRiskJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'OKR_AT_RISK' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [obj.id]
  );
  assert(okrAtRiskJob && okrAtRiskJob.status === 'QUEUED', 'OKR_AT_RISK enqueued in automation_queue');

  // ---------------------------------------------------------------------------
  // 4. GANTT TRIGGERS (TASK_COMPLETED, MILESTONE_MISSED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Gantt Triggers ---');
  ensureRule('GANTT', 'TASK_COMPLETED', 'Test Gantt Task Completed');
  ensureRule('GANTT', 'MILESTONE_MISSED', 'Test Gantt Milestone Missed');

  const ganttItem = createGanttItem({
    project_id: project.id,
    title: `Gantt Task L5 ${Date.now()}`,
    start_date: '2026-11-01',
    end_date: '2026-11-10'
  }, admin);
  assert(ganttItem && ganttItem.id, 'Created Gantt item');

  updateProgress(ganttItem.id, 100, admin);

  const taskCompletedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'TASK_COMPLETED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [ganttItem.id]
  );
  assert(taskCompletedJob && taskCompletedJob.status === 'QUEUED', 'TASK_COMPLETED enqueued in automation_queue');

  const milestone = createMilestone({
    project_id: project.id,
    title: `Milestone L5 ${Date.now()}`,
    milestone_date: '2026-10-01'
  }, admin);
  assert(milestone && milestone.id, 'Created Gantt milestone');

  updateMilestone(milestone.id, { status: 'MISSED' }, admin);

  const milestoneMissedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'MILESTONE_MISSED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [milestone.id]
  );
  assert(milestoneMissedJob && milestoneMissedJob.status === 'QUEUED', 'MILESTONE_MISSED enqueued in automation_queue');

  // ---------------------------------------------------------------------------
  // 5. WORKLOAD TRIGGERS (MEMBER_OVERLOADED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Workload Triggers ---');
  ensureRule('WORKLOAD', 'MEMBER_OVERLOADED', 'Test Member Overloaded');

  const dynamicWeek = new Date(Date.now() + Math.floor(Math.random() * 5000000000) + 1000000000).toISOString().split('T')[0];
  evaluateAndCreateWorkloadAlert(member.id, dynamicWeek, 60, 40); // 150% utilization

  const memberOverloadedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'MEMBER_OVERLOADED' AND triggered_by_user_id = ? ORDER BY id DESC LIMIT 1;",
    [member.id]
  );
  assert(memberOverloadedJob && memberOverloadedJob.status === 'QUEUED', 'MEMBER_OVERLOADED enqueued in automation_queue');
  const utilPayload = JSON.parse(memberOverloadedJob.trigger_data);
  assert(utilPayload.utilization_pct > 100, 'MEMBER_OVERLOADED snapshot shows utilization > 100%');

  // ---------------------------------------------------------------------------
  // 6. TIME TRACKING TRIGGERS (TIME_ENTRY_APPROVED, TIME_ENTRY_REJECTED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Time Tracking Triggers ---');
  ensureRule('TIME', 'TIME_ENTRY_APPROVED', 'Test Time Entry Approved');
  ensureRule('TIME', 'TIME_ENTRY_REJECTED', 'Test Time Entry Rejected');

  const timeUserId = crypto.randomUUID();
  execute(
    "INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Time User L5', ?, 'dummy_hash', 'developer', 'active');",
    [timeUserId, `time_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`]
  );
  const timeUser = { id: timeUserId, role: 'developer', name: 'Time User L5' };
  execute("INSERT OR IGNORE INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'backend_dev');", [crypto.randomUUID(), project.id, timeUserId]);

  const baseTime1 = new Date('2055-05-10T08:00:00Z').getTime() + Math.floor(Math.random() * 10000000);
  const res1 = createManualEntry({
    project_id: project.id,
    start_time: new Date(baseTime1).toISOString(),
    end_time: new Date(baseTime1 + 3600000).toISOString(),
    description: 'Work item 1',
    is_billable: true
  }, timeUser);
  const timeEntry1 = res1.time_entry;
  const req1 = requestApproval(timeEntry1.id, timeUser);
  approveTimeEntry(req1.approval_request.id, admin);

  const timeApprovedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'TIME_ENTRY_APPROVED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [timeEntry1.id]
  );
  assert(timeApprovedJob && timeApprovedJob.status === 'QUEUED', 'TIME_ENTRY_APPROVED enqueued in automation_queue');

  const baseTime2 = new Date('2055-06-15T08:00:00Z').getTime() + Math.floor(Math.random() * 10000000);
  const res2 = createManualEntry({
    project_id: project.id,
    start_time: new Date(baseTime2).toISOString(),
    end_time: new Date(baseTime2 + 3600000).toISOString(),
    description: 'Work item 2',
    is_billable: true
  }, timeUser);
  const timeEntry2 = res2.time_entry;
  const req2 = requestApproval(timeEntry2.id, timeUser);
  rejectTimeEntry(req2.approval_request.id, 'Hours are incorrect for this task', admin);

  const timeRejectedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'TIME_ENTRY_REJECTED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [timeEntry2.id]
  );
  assert(timeRejectedJob && timeRejectedJob.status === 'QUEUED', 'TIME_ENTRY_REJECTED enqueued in automation_queue');

  // ---------------------------------------------------------------------------
  // 7. FINANCE TRIGGERS (EXPENSE, BUDGET, INVOICE)
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Finance Triggers ---');
  ensureRule('EXPENSE', 'EXPENSE_APPROVED', 'Test Expense Approved');
  ensureRule('EXPENSE', 'EXPENSE_REJECTED', 'Test Expense Rejected');
  ensureRule('EXPENSE', 'BUDGET_THRESHOLD_REACHED', 'Test Budget Threshold');
  ensureRule('EXPENSE', 'BUDGET_EXCEEDED', 'Test Budget Exceeded');
  ensureRule('EXPENSE', 'INVOICE_OVERDUE', 'Test Invoice Overdue');

  // Setup unique project for finance test to test budget thresholds
  const validIdea = queryOne('SELECT id FROM ideas LIMIT 1;') || { id: crypto.randomUUID() };
  const finProjectId = crypto.randomUUID();
  const finIdeaId = validIdea.id;
  execute(
    "INSERT INTO projects (id, idea_id, title, owner_id) VALUES (?, ?, 'Finance L5 Test', ?);",
    [finProjectId, finIdeaId, admin.id]
  );
  createBudget({ project_id: finProjectId, total_budget: 1000, currency: 'INR', start_date: '2026-01-01', alert_threshold_pct: 80 }, admin);

  const exp1 = submitExpense({
    project_id: finProjectId,
    category_id: 1,
    title: 'Server cloud hosting license',
    amount: 850,
    currency: 'INR',
    expense_date: '2026-05-01',
    description: 'Server cloud hosting license'
  }, admin);
  approveExpense(exp1.expense.id, admin);

  const expApprovedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'EXPENSE_APPROVED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [exp1.expense.id]
  );
  assert(expApprovedJob && expApprovedJob.status === 'QUEUED', 'EXPENSE_APPROVED enqueued in automation_queue');

  const budgetThresholdJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'BUDGET_THRESHOLD_REACHED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [finProjectId]
  );
  assert(budgetThresholdJob && budgetThresholdJob.status === 'QUEUED', 'BUDGET_THRESHOLD_REACHED enqueued in automation_queue');

  const exp2 = submitExpense({
    project_id: finProjectId,
    category_id: 4,
    title: 'Domain renewal ads',
    amount: 300,
    currency: 'INR',
    expense_date: '2026-05-02',
    description: 'Domain renewal ads'
  }, admin);
  rejectExpense(exp2.expense.id, { rejection_reason: 'Exceeds monthly allocation' }, admin);

  const expRejectedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'EXPENSE_REJECTED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [exp2.expense.id]
  );
  assert(expRejectedJob && expRejectedJob.status === 'QUEUED', 'EXPENSE_REJECTED enqueued in automation_queue');

  // Create overdue invoice and process
  const invoiceRes = createInvoice({
    project_id: finProjectId,
    title: 'Overdue Project Invoice',
    client_name: 'Overdue Client',
    client_email: 'client@example.com',
    issue_date: '2026-09-01',
    due_date: '2026-09-15',
    currency: 'INR',
    items: [{ description: 'Dev sprint', quantity: 1, unit_price: 500 }]
  }, admin);
  execute("UPDATE invoices SET status = 'SENT', due_date = '2026-09-15' WHERE id = ?;", [invoiceRes.invoice.id]);

  processOverdueInvoices(admin);

  const invoiceOverdueJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'INVOICE_OVERDUE' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [invoiceRes.invoice.id]
  );
  assert(invoiceOverdueJob && invoiceOverdueJob.status === 'QUEUED', 'INVOICE_OVERDUE enqueued in automation_queue');

  // ---------------------------------------------------------------------------
  // 8. CLIENT TRIGGERS (CLIENT_ORDER_SUBMITTED, CLIENT_MILESTONE_APPROVED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. Client Triggers ---');
  ensureRule('CLIENT', 'CLIENT_ORDER_SUBMITTED', 'Test Client Order Submitted');
  ensureRule('CLIENT', 'CLIENT_MILESTONE_APPROVED', 'Test Client Milestone Approved');

  // Setup client
  let clientUser = queryOne("SELECT * FROM clients WHERE status = 'ACTIVE' LIMIT 1;");
  if (!clientUser) {
    const clRes = execute(
      "INSERT INTO clients (name, email, password_hash, company_name, created_by, status) VALUES ('Client Test', ?, 'hash', 'Acme Inc', ?, 'ACTIVE');",
      [`client_${Date.now()}@test.com`, admin.id]
    );
    clientUser = { id: Number(clRes.lastInsertRowid), name: 'Client Test', email: 'client@test.com' };
  }
  execute(
    "INSERT OR REPLACE INTO client_project_access (client_id, project_id, access_level, granted_by, is_active) VALUES (?, ?, 'FULL', ?, 1);",
    [clientUser.id, project.id, admin.id]
  );

  const orderResult = submitClientOrder(clientUser, {
    project_id: project.id,
    title: 'Custom Feature Request',
    description: 'Client needs custom reporting view',
    order_type: 'NEW_REQUEST',
    priority: 'HIGH'
  });
  assert(orderResult && orderResult.order, 'Client order submitted');

  const clientOrderJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'CLIENT_ORDER_SUBMITTED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [orderResult.order.id]
  );
  assert(clientOrderJob && clientOrderJob.status === 'QUEUED', 'CLIENT_ORDER_SUBMITTED enqueued in automation_queue');

  // Setup client milestone approval
  const cMilestone = createMilestone({ project_id: project.id, title: `Client Release Milestone ${Date.now()}`, milestone_date: '2026-11-20' }, admin);
  const apprRes = execute(
    "INSERT INTO client_milestone_approvals (milestone_id, client_id, project_id, requested_by, requested_at, decision) VALUES (?, ?, ?, ?, datetime('now'), NULL);",
    [cMilestone.id, clientUser.id, project.id, admin.id]
  );
  const approvalId = Number(apprRes.lastInsertRowid);

  decideMilestoneApproval(clientUser, approvalId, { decision: 'APPROVED', decision_note: 'Looks great!' });

  const clientMilestoneJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'CLIENT_MILESTONE_APPROVED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [approvalId]
  );
  assert(clientMilestoneJob && clientMilestoneJob.status === 'QUEUED', 'CLIENT_MILESTONE_APPROVED enqueued in automation_queue');

  // ---------------------------------------------------------------------------
  // 9. GITHUB TRIGGERS (PR_MERGED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. GitHub Triggers ---');
  ensureRule('GITHUB', 'PR_MERGED', 'Test PR Merged');

  // Ensure repo linked
  execute(
    "INSERT OR REPLACE INTO project_github_repos (id, project_id, repo_full_name, repo_name, repo_url, status) VALUES (?, ?, 'owner/layer5-repo', 'layer5-repo', 'https://github.com/owner/layer5-repo', 'ACTIVE');",
    [crypto.randomUUID(), project.id]
  );

  await processWebhookEvent('pull_request', 'closed', {
    repository: { full_name: 'owner/layer5-repo' },
    pull_request: {
      id: 99101,
      number: 42,
      title: 'feat: add payment gateway integration',
      base: { ref: 'main' },
      merged: true,
      user: { login: 'octocat' }
    }
  });

  const prMergedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'PR_MERGED' AND trigger_source_id = 99101 ORDER BY id DESC LIMIT 1;"
  );
  assert(prMergedJob && prMergedJob.status === 'QUEUED', 'PR_MERGED enqueued in automation_queue');
  const prPayload = JSON.parse(prMergedJob.trigger_data);
  assert(prPayload.pr.number === 42 && prPayload.pr.merged === true, 'PR_MERGED trigger_data verified');

  // ---------------------------------------------------------------------------
  // 10. MEMBER TRIGGERS (MEMBER_OFFBOARDED, REVENUE_SHARE_BLOCKED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. Member Triggers ---');
  ensureRule('MEMBER', 'MEMBER_OFFBOARDED', 'Test Member Offboarded');
  ensureRule('MEMBER', 'REVENUE_SHARE_BLOCKED', 'Test Revenue Share Blocked');

  // Create temporary user to offboard
  const tempUserId = crypto.randomUUID();
  execute(
    "INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Offboard Me', ?, 'dummy_hash', 'developer', 'active');",
    [tempUserId, `offboard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`]
  );

  executeOffboardingKillswitch({
    userId: tempUserId,
    adminUserId: admin.id,
    reason: 'Testing PRD 26 automation trigger'
  });

  const memberOffboardedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'MEMBER_OFFBOARDED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [tempUserId]
  );
  assert(memberOffboardedJob && memberOffboardedJob.status === 'QUEUED', 'MEMBER_OFFBOARDED enqueued in automation_queue');

  // Test REVENUE_SHARE_BLOCKED via applyParticipationBlocks
  const blockedUserId = crypto.randomUUID();
  execute(
    "INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Low Part Member', ?, 'dummy_hash', 'developer', 'active');",
    [blockedUserId, `lowpart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`]
  );
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'backend_dev');", [crypto.randomUUID(), project.id, blockedUserId]);

  applyParticipationBlocks(project.id);

  const revBlockedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'REVENUE_SHARE_BLOCKED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [blockedUserId]
  );
  assert(revBlockedJob && revBlockedJob.status === 'QUEUED', 'REVENUE_SHARE_BLOCKED enqueued in automation_queue');

  // ---------------------------------------------------------------------------
  // 11. PIPELINE TRIGGERS (PIPELINE_STAGE_COMPLETED)
  // ---------------------------------------------------------------------------
  console.log('\n--- 11. Pipeline Triggers ---');
  ensureRule('PIPELINE', 'PIPELINE_STAGE_COMPLETED', 'Test Pipeline Stage Completed');

  // Create deliverable with 100% complete RESEARCH stage
  const delivId = crypto.randomUUID();
  execute(
    "INSERT INTO pipeline_deliverables (id, project_id, title, current_stage, status, created_by) VALUES (?, ?, 'Core Architecture', 'RESEARCH', 'ACTIVE', ?);",
    [delivId, project.id, admin.id]
  );
  // Add 1 checklist point that is APPROVED
  execute(
    "INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, weight, status, created_by) VALUES (?, ?, 'RESEARCH', 'Doc Spec', 5, 'APPROVED', ?);",
    [crypto.randomUUID(), delivId, admin.id]
  );

  approveHandoff(delivId, 'RESEARCH', 'DESIGN', 'Stage ready for design handover', admin.id);

  const stageCompletedJob = queryOne(
    "SELECT * FROM automation_queue WHERE trigger_event = 'PIPELINE_STAGE_COMPLETED' AND trigger_source_id = ? ORDER BY id DESC LIMIT 1;",
    [delivId]
  );
  assert(stageCompletedJob && stageCompletedJob.status === 'QUEUED', 'PIPELINE_STAGE_COMPLETED enqueued in automation_queue');

  // ---------------------------------------------------------------------------
  // 12. BATCH PROCESSING & SAFETY
  // ---------------------------------------------------------------------------
  console.log('\n--- 12. Batch Queue Execution & Non-blocking Safety ---');

  // Process queued jobs through processQueueBatch
  const batchRes = processQueueBatch(15);
  assert(batchRes.processed > 0, `processQueueBatch processed ${batchRes.processed} jobs successfully`);

  // Verify non-blocking behavior: fireTrigger called with invalid/null args never throws
  let threw = false;
  try {
    fireTrigger(null, null, null, null, null, null);
    fireTrigger(undefined, undefined);
    fireTrigger('UNKNOWN_MODULE', 'NON_EXISTENT_EVENT', 'FOO', 'BAR');
  } catch (err) {
    threw = true;
  }
  assert(!threw, 'fireTrigger handles edge cases / null gracefully without throwing');

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(`Layer 5 Verification Complete: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error in Layer 5 verification suite:', err);
  process.exit(1);
});
