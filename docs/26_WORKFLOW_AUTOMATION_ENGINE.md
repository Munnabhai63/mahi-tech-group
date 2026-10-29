# PRD 26 — Workflow Automation Engine
**File:** docs/26_WORKFLOW_AUTOMATION_ENGINE.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 15 (Pipeline), PRD 18 (Sprint Planning), PRD 19 (OKR), PRD 20 (Gantt), PRD 21 (Workload), PRD 22 (Time Tracking), PRD 23 (Analytics), PRD 24 (Client Portal), PRD 25 (Budget)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Monday.com (Automation recipes — IF trigger THEN action, no-code automation builder)
- ClickUp (Automations — trigger + condition + action, 50+ built-in automations)
- Zapier (Multi-step workflows, trigger → filter → action chain, app integrations)
- Jira (Automation rules — trigger + conditions + actions, smart values, branching)
- Asana (Rules — trigger + action, project-level and org-level rules)
- Make (formerly Integromat) (Visual workflow builder, modules, routing, error handling)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's automation flow — how triggers are defined, how conditions are evaluated, how actions are executed, how errors are handled, how automation history is logged
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (Trigger Event → Condition Check → Action Execution → Log)
4. Map every business rule (e.g., automation runs asynchronously, failed automation retried 3 times, circular automation detection, rate limiting per automation)
5. Identify what we will NOT copy (visual design, branding, color scheme, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group a powerful no-code Workflow Automation Engine where Admin can define IF-THEN automation rules across all platform modules — so repetitive tasks happen automatically, notifications fire at the right time, statuses update without manual intervention, and the team focuses on real work instead of admin overhead. Built our own way, AI can only SUGGEST automations — never auto-create or auto-publish them.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Create Automation Rule | ✅ | ✅ | ❌ |
| Edit Automation Rule | ✅ | ✅ | ❌ |
| Delete Automation Rule | ✅ | ✅ | ❌ |
| Enable / Disable Automation | ✅ | ✅ | ❌ |
| View Automation Rules | ✅ | ✅ | ❌ |
| View Automation Run History | ✅ | ✅ | ❌ |
| View own triggered automations | ✅ | ✅ | ✅ |
| Test Automation (dry run) | ✅ | ✅ | ❌ |
| View Automation Errors | ✅ | ✅ | ❌ |
| Acknowledge Automation Error | ✅ | ✅ | ❌ |
| AI Suggest Automation | ✅ | ✅ | ❌ |
| Approve AI Suggested Automation | ✅ | ✅ | ❌ |

---

## 🗄️ Database Tables (New — 7 Tables)

### Table 1: automation_rules

CREATE TABLE automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  project_id INTEGER REFERENCES projects(id),
  -- NULL = global/company-wide automation; non-NULL = project-specific
  scope TEXT NOT NULL DEFAULT 'PROJECT',
  -- PROJECT | COMPANY
  is_active INTEGER NOT NULL DEFAULT 1,
  -- 0 = disabled; 1 = enabled
  trigger_module TEXT NOT NULL,
  -- SPRINT | BACKLOG | OKR | GANTT | WORKLOAD | TIME | PIPELINE | EXPENSE | INVOICE | CLIENT_ORDER | GITHUB | MEMBER
  trigger_event TEXT NOT NULL,
  -- e.g. 'SPRINT_STARTED' | 'ITEM_STATUS_CHANGED' | 'OKR_PROGRESS_UPDATED' |
  --      'EXPENSE_APPROVED' | 'INVOICE_OVERDUE' | 'BUDGET_THRESHOLD_REACHED' |
  --      'MEMBER_OFFBOARDED' | 'PR_MERGED' | 'CLIENT_ORDER_SUBMITTED' etc.
  trigger_conditions TEXT,
  -- JSON: array of conditions e.g.
  -- [{ field: 'status', operator: 'EQUALS', value: 'DONE' },
  --  { field: 'priority', operator: 'EQUALS', value: 'HIGH' }]
  condition_logic TEXT NOT NULL DEFAULT 'AND',
  -- AND | OR (how multiple conditions are combined)
  actions TEXT NOT NULL,
  -- JSON: array of actions e.g.
  -- [{ action: 'SEND_NOTIFICATION', params: { to: 'ASSIGNEE', message: 'Your task is done' } },
  --  { action: 'UPDATE_FIELD', params: { field: 'sprint_id', value: null } },
  --  { action: 'CREATE_BACKLOG_ITEM', params: { title: 'Follow up: {{item.title}}' } }]
  run_count INTEGER DEFAULT 0,
  -- total times this automation has fired successfully
  last_run_at TEXT,
  is_ai_suggested INTEGER DEFAULT 0,
  -- 1 = created via AI suggestion flow; 0 = manually created
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 2: automation_run_log

CREATE TABLE automation_run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automation_rules(id),
  trigger_event TEXT NOT NULL,
  trigger_source_type TEXT,
  -- module that fired the trigger e.g. 'SPRINT' | 'BACKLOG_ITEM' etc.
  trigger_source_id INTEGER,
  -- id of the specific record that triggered the automation
  triggered_by_user_id INTEGER REFERENCES users(id),
  -- user whose action fired the trigger (NULL if system-triggered)
  conditions_evaluated TEXT,
  -- JSON: result of each condition check { field, operator, value, result: true/false }
  conditions_passed INTEGER NOT NULL DEFAULT 0,
  -- 1 = all conditions met; 0 = conditions not met (automation skipped)
  actions_executed TEXT,
  -- JSON: result of each action { action, params, status: 'SUCCESS'|'FAILED', error: null|message }
  overall_status TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING | SUCCESS | PARTIAL | FAILED | SKIPPED
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  -- number of retry attempts made
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
-- Append-only: DB trigger prevents update/delete
-- Every automation fire creates one run_log row

### Table 3: automation_errors

CREATE TABLE automation_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automation_rules(id),
  run_log_id INTEGER NOT NULL REFERENCES automation_run_log(id),
  error_type TEXT NOT NULL,
  -- ACTION_FAILED | CONDITION_ERROR | TRIGGER_ERROR | TIMEOUT | CIRCULAR_DETECTED
  error_message TEXT NOT NULL,
  action_index INTEGER,
  -- which action in the actions array failed (0-based index)
  retry_scheduled INTEGER DEFAULT 0,
  -- 1 = retry queued; 0 = no retry
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: only acknowledged_by and acknowledged_at mutable (exception for ack)

### Table 4: automation_templates

CREATE TABLE automation_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  -- SPRINT | OKR | NOTIFICATIONS | FINANCE | CLIENT | GITHUB | GENERAL
  trigger_module TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  trigger_conditions TEXT,
  -- JSON: pre-filled conditions
  actions TEXT NOT NULL,
  -- JSON: pre-filled actions
  is_system_template INTEGER NOT NULL DEFAULT 1,
  -- 1 = built-in template (cannot be deleted); 0 = user-saved template
  created_by INTEGER REFERENCES users(id),
  -- NULL for system templates
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Pre-seeded with 20 built-in templates (see Built-in Templates section)

### Table 5: automation_queue

CREATE TABLE automation_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automation_rules(id),
  run_log_id INTEGER REFERENCES automation_run_log(id),
  trigger_event TEXT NOT NULL,
  trigger_source_type TEXT,
  trigger_source_id INTEGER,
  triggered_by_user_id INTEGER REFERENCES users(id),
  trigger_data TEXT,
  -- JSON: full snapshot of trigger event data at time of queuing
  status TEXT NOT NULL DEFAULT 'QUEUED',
  -- QUEUED | PROCESSING | DONE | FAILED
  scheduled_at TEXT DEFAULT (datetime('now')),
  -- when to process (immediate = now; retry = future)
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Queue processed by automation engine worker (async)
-- Rows cleaned up after 30 days (soft-delete via status=DONE)

### Table 6: automation_variable_store

CREATE TABLE automation_variable_store (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automation_rules(id),
  run_log_id INTEGER NOT NULL REFERENCES automation_run_log(id),
  variable_name TEXT NOT NULL,
  -- e.g. 'item.title' | 'sprint.name' | 'member.name'
  variable_value TEXT,
  -- resolved value at runtime
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: stores resolved template variables per run for audit
-- Allows {{ variable }} syntax in action params

### Table 7: automation_ai_suggestions

CREATE TABLE automation_ai_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggested_by_system TEXT NOT NULL DEFAULT 'INTERNAL_AI',
  -- AI tool that suggested this (always internal suggestion layer)
  suggestion_context TEXT,
  -- JSON: what platform data triggered this suggestion
  suggested_name TEXT NOT NULL,
  suggested_description TEXT,
  suggested_trigger_module TEXT NOT NULL,
  suggested_trigger_event TEXT NOT NULL,
  suggested_conditions TEXT,
  suggested_actions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING | APPROVED | REJECTED | DISMISSED
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  rejection_reason TEXT,
  approved_automation_id INTEGER REFERENCES automation_rules(id),
  -- set when Admin approves and automation rule is created
  created_at TEXT DEFAULT (datetime('now'))
);
-- Append-only: DB trigger prevents update/delete
-- AI SUGGESTS ONLY — Admin must explicitly approve before any automation is created

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_run_log_update
BEFORE UPDATE ON automation_run_log
BEGIN SELECT RAISE(ABORT, 'automation_run_log is append-only'); END;

CREATE TRIGGER prevent_run_log_delete
BEFORE DELETE ON automation_run_log
BEGIN SELECT RAISE(ABORT, 'automation_run_log is append-only'); END;

CREATE TRIGGER prevent_automation_error_delete
BEFORE DELETE ON automation_errors
BEGIN SELECT RAISE(ABORT, 'automation_errors is append-only'); END;

CREATE TRIGGER prevent_variable_store_update
BEFORE UPDATE ON automation_variable_store
BEGIN SELECT RAISE(ABORT, 'automation_variable_store is append-only'); END;

CREATE TRIGGER prevent_variable_store_delete
BEFORE DELETE ON automation_variable_store
BEGIN SELECT RAISE(ABORT, 'automation_variable_store is append-only'); END;

CREATE TRIGGER prevent_ai_suggestion_update
BEFORE UPDATE ON automation_ai_suggestions
BEGIN SELECT RAISE(ABORT, 'automation_ai_suggestions is append-only'); END;

CREATE TRIGGER prevent_ai_suggestion_delete
BEFORE DELETE ON automation_ai_suggestions
BEGIN SELECT RAISE(ABORT, 'automation_ai_suggestions is append-only'); END;

---

## 📋 Built-in Triggers (Supported Events)

### SPRINT Module
- SPRINT_CREATED
- SPRINT_STARTED
- SPRINT_COMPLETED
- SPRINT_CANCELLED
- SPRINT_ITEM_ADDED
- SPRINT_ITEM_MOVED_TO_BACKLOG

### BACKLOG Module
- ITEM_CREATED
- ITEM_STATUS_CHANGED
- ITEM_ASSIGNED
- ITEM_STORY_POINTS_CHANGED
- ITEM_PRIORITY_CHANGED
- ITEM_DELETED

### OKR Module
- OBJECTIVE_CREATED
- KR_CHECKIN_SUBMITTED
- OKR_PROGRESS_REACHED (condition: progress_pct >= X)
- OKR_COMPLETED
- OKR_AT_RISK (status changed to AT_RISK)

### GANTT Module
- GANTT_ITEM_STATUS_CHANGED
- MILESTONE_ACHIEVED
- MILESTONE_MISSED (due date passed, status still PENDING)
- GANTT_ITEM_OVERDUE
- BASELINE_SNAPSHOT_TAKEN

### WORKLOAD Module
- MEMBER_OVERLOADED (utilization > 100%)
- MEMBER_UNDERLOADED (utilization < 30%)
- AVAILABILITY_MARKED
- CAPACITY_CHANGED

### TIME Module
- TIMER_STARTED
- TIMER_STOPPED
- TIME_ENTRY_SUBMITTED
- TIME_ENTRY_APPROVED
- TIME_ENTRY_REJECTED

### PIPELINE Module
- CHECKLIST_POINT_APPROVED
- STAGE_HANDOFF_CREATED
- PIPELINE_STAGE_COMPLETED
- ADDENDUM_REQUESTED

### EXPENSE / FINANCE Module
- EXPENSE_SUBMITTED
- EXPENSE_APPROVED
- EXPENSE_REJECTED
- BUDGET_THRESHOLD_REACHED
- BUDGET_EXCEEDED
- INVOICE_CREATED
- INVOICE_SENT
- INVOICE_PAID
- INVOICE_OVERDUE

### CLIENT Module
- CLIENT_ORDER_SUBMITTED
- CLIENT_ORDER_STATUS_CHANGED
- CLIENT_MILESTONE_APPROVED
- CLIENT_MILESTONE_REJECTED
- CLIENT_FEEDBACK_SUBMITTED

### GITHUB Module
- PR_OPENED
- PR_MERGED
- PR_CLOSED_WITHOUT_MERGE
- BRANCH_CREATED
- COMMIT_PUSHED

### MEMBER Module
- MEMBER_JOINED
- MEMBER_OFFBOARDED
- MEMBER_ROLE_CHANGED
- REVENUE_SHARE_BLOCKED (participation below threshold)

---

## ⚙️ Supported Actions

### Notification Actions
- SEND_NOTIFICATION: { to: 'ASSIGNEE'|'ADMIN'|'PROJECT_MEMBERS'|'SPECIFIC_USER', message: '{{template}}' }
- SEND_EMAIL: { to: email_or_role, subject: '{{template}}', body: '{{template}}' }

### Data Update Actions
- UPDATE_FIELD: { entity_type, entity_id_from_trigger, field, value }
- ASSIGN_MEMBER: { entity_type, entity_id_from_trigger, user_id }
- CHANGE_STATUS: { entity_type, entity_id_from_trigger, new_status }
- SET_DUE_DATE: { entity_type, entity_id_from_trigger, due_date_offset_days }

### Create Actions
- CREATE_BACKLOG_ITEM: { project_id, title: '{{template}}', type, priority, assigned_to }
- CREATE_GANTT_ITEM: { project_id, title: '{{template}}', start_date_offset, duration_days }
- CREATE_EXPENSE_REMINDER: { project_id, message: '{{template}}' }

### Sprint Actions
- MOVE_ITEM_TO_BACKLOG: { item_id_from_trigger }
- COMPLETE_SPRINT: { sprint_id_from_trigger }

### GitHub Actions
- CREATE_GITHUB_BRANCH: { repo, branch_name: '{{template}}' }
-- Note: GitHub actions are SUGGESTIONS only — Admin must confirm before execution

### Workflow Control Actions
- WAIT: { hours: N }
-- pause N hours before next action in sequence
- STOP_IF: { condition }
-- stop automation chain if condition met

---

## 🔌 API Routes (22 Endpoints)

### Automation Rule Routes

POST   /api/automation/rule/create
         body: { name, description, project_id, scope, trigger_module, trigger_event, trigger_conditions, condition_logic, actions }
         rule: circular automation detection before save; max 50 active rules per project
         role: Admin+

GET    /api/automation/rules
         query: ?project_id=&scope=&is_active=&trigger_module=
         returns: all automation rules (filtered)
         role: Admin+

GET    /api/automation/rule/:ruleId
         returns: rule detail + last 10 run logs + error count
         role: Admin+

PATCH  /api/automation/rule/:ruleId
         body: any editable field
         rule: cannot edit while automation is PROCESSING in queue
         role: Admin+

DELETE /api/automation/rule/:ruleId
         rule: cannot delete system-template-based rules; logs deletion to access_log
         role: Admin+

PATCH  /api/automation/rule/:ruleId/toggle
         body: { is_active }
         rule: disabling clears pending queue entries for this rule
         role: Admin+

POST   /api/automation/rule/:ruleId/test
         body: { mock_trigger_data }
         rule: dry run — evaluates conditions + simulates actions without executing them
         returns: { conditions_result, actions_that_would_fire, estimated_outcome }
         role: Admin+

### Run Log & History Routes

GET    /api/automation/logs
         query: ?automation_id=&status=&from=&to=&project_id=
         returns: automation run logs with filters
         role: Admin+

GET    /api/automation/log/:runLogId
         returns: full run log detail (conditions evaluated, actions executed, variables resolved)
         role: Admin+

### Error Routes

GET    /api/automation/errors
         query: ?automation_id=&acknowledged=
         returns: all automation errors
         role: Admin+

PATCH  /api/automation/error/:errorId/acknowledge
         rule: acknowledged_by = current admin, acknowledged_at = now
         role: Admin+

PATCH  /api/automation/error/:errorId/retry
         rule: re-queues the failed automation run; increments retry_count; max 3 retries
         role: Admin+

### Template Routes

GET    /api/automation/templates
         query: ?category=
         returns: all templates (system + user-saved)
         role: Admin+

POST   /api/automation/template/save
         body: { name, description, category, trigger_module, trigger_event, trigger_conditions, actions }
         rule: saves current rule config as reusable template
         role: Admin+

DELETE /api/automation/template/:templateId
         rule: system templates (is_system_template=1) cannot be deleted
         role: Admin+

POST   /api/automation/template/:templateId/use
         body: { project_id, name }
         rule: creates new automation rule from template
         role: Admin+

### AI Suggestion Routes

GET    /api/automation/suggestions
         returns: all AI suggestions with status PENDING
         role: Admin+

PATCH  /api/automation/suggestion/:suggestionId/approve
         rule: creates automation rule from suggestion; sets approved_automation_id; status → APPROVED
         role: Admin+

PATCH  /api/automation/suggestion/:suggestionId/reject
         body: { rejection_reason }
         rule: status → REJECTED; logged
         role: Admin+

### Queue Routes

GET    /api/automation/queue
         query: ?status=&automation_id=
         returns: current automation queue state
         role: Admin+

### Stats Route

GET    /api/automation/stats
         returns: total rules, active rules, runs today, success rate, top triggered automations, error count
         role: Admin+

GET    /api/automation/stats/project/:projectId
         returns: project-level automation stats
         role: Admin+

---

## 🔧 Automation Engine (Core Service Logic)

### automationEngine.js — Core Worker

The automation engine runs as an async background worker:

1. TRIGGER DETECTION
   - Every service in the platform (sprintService, backlogService, okrService etc.)
     calls automationEngine.fireTrigger(module, event, sourceType, sourceId, userId, data)
     after every state-changing operation
   - fireTrigger() looks up all active automation_rules matching module + event
   - For each matching rule: creates automation_queue entry

2. QUEUE PROCESSOR
   - setInterval runs every 5 seconds
   - Picks QUEUED entries one at a time (status → PROCESSING)
   - Creates automation_run_log entry (status = PENDING)
   - Evaluates conditions against live DB data
   - If conditions not met: run_log status → SKIPPED
   - If conditions met: executes actions in sequence
   - On success: run_log status → SUCCESS; automation_rules.run_count++
   - On partial failure: run_log status → PARTIAL; creates automation_errors entry
   - On full failure: run_log status → FAILED; creates automation_errors entry; schedules retry if attempts < max_attempts

3. CIRCULAR DETECTION
   - Before saving any automation rule: check if trigger_event of this rule matches any action
     that could fire from the actions of existing rules → reject with error if circular chain detected
   - Max chain depth = 5 (automation A triggers automation B triggers C... max 5 levels)

4. TEMPLATE VARIABLE RESOLUTION
   - Actions support {{ variable }} syntax e.g. {{ item.title }}, {{ sprint.name }}, {{ member.name }}
   - Variables resolved from trigger_data snapshot at queue time
   - Resolved variables stored in automation_variable_store per run

5. RATE LIMITING
   - Max 100 automation fires per project per hour
   - Max 10 fires per automation rule per minute
   - Excess fires queued and processed after rate window resets

6. RETRY LOGIC
   - Failed actions retried up to max_attempts (default 3)
   - Retry delay: attempt 1 = 1 min, attempt 2 = 5 min, attempt 3 = 15 min
   - After 3 failed attempts: status → FAILED permanently; error acknowledged required

---

## 📋 Built-in Templates (Pre-seeded — 20 Templates)

TEMPLATE 01: When sprint starts → notify all sprint members
TEMPLATE 02: When sprint completed → move TODO items back to backlog
TEMPLATE 03: When backlog item status = DONE → notify assignee
TEMPLATE 04: When backlog item overdue → notify assignee + Admin
TEMPLATE 05: When OKR progress >= 100% → notify objective owner
TEMPLATE 06: When OKR status = AT_RISK → notify Admin
TEMPLATE 07: When gantt milestone missed → notify Admin + create follow-up backlog item
TEMPLATE 08: When member overloaded → notify Admin
TEMPLATE 09: When expense approved → notify expense submitter
TEMPLATE 10: When expense rejected → notify expense submitter with rejection reason
TEMPLATE 11: When budget threshold reached (80%) → notify Admin
TEMPLATE 12: When budget exceeded (100%) → notify Admin + Super Admin
TEMPLATE 13: When invoice overdue → notify Admin
TEMPLATE 14: When client order submitted → notify Admin + assigned handler
TEMPLATE 15: When client milestone approved → update milestone status to ACHIEVED
TEMPLATE 16: When PR merged → notify project team
TEMPLATE 17: When time entry rejected → notify submitter
TEMPLATE 18: When member offboarded → notify Admin + remove from active sprint
TEMPLATE 19: When pipeline stage completed → notify next stage owner
TEMPLATE 20: When revenue share blocked → notify Admin with member name + reason

---

## 🖥️ Frontend Views (5 HTML Views)

### View 1: Automation Rules List (automation-rules.html)
- Table: rule name | scope | trigger module | trigger event | status badge | run count | last run | actions
- Status badge: green=ACTIVE, grey=DISABLED
- "Create Automation" button → opens automation builder
- "Templates" button → opens template library
- Filter: by project, scope, module, status
- Error count badge per rule (red if > 0 unacknowledged errors)
- Toggle enable/disable switch per rule
- Admin only view

### View 2: Automation Builder (automation-builder.html)
- Step 1 — TRIGGER:
  - Module selector (dropdown: SPRINT | BACKLOG | OKR | GANTT | etc.)
  - Event selector (filtered by module)
  - Project scope selector (PROJECT or COMPANY)
- Step 2 — CONDITIONS (optional):
  - "Add Condition" button → field selector + operator + value input
  - AND/OR logic toggle
  - Conditions shown as chip list (removable)
- Step 3 — ACTIONS:
  - "Add Action" button → action type selector + params form
  - Actions shown as ordered list (drag to reorder)
  - {{ variable }} picker for template fields
  - "Add Wait Step" button (inserts WAIT action between steps)
- Step 4 — REVIEW:
  - Summary of trigger, conditions, actions
  - "Test (Dry Run)" button → shows simulated outcome
  - "Save Automation" button
- Admin only view

### View 3: Automation Run History (automation-history.html)
- Date range picker + automation rule filter
- Table: automation name | trigger event | source | triggered by | status badge | started at | duration
- Status badges: green=SUCCESS, yellow=PARTIAL, red=FAILED, grey=SKIPPED
- Click row → full detail:
  - Conditions evaluated (each condition: field / operator / value / PASS or FAIL)
  - Actions executed (each action: type / params / status / error if failed)
  - Variables resolved (variable name / resolved value)
- "Retry" button for FAILED runs (Admin only)
- Admin only view

### View 4: Automation Error Center (automation-errors.html)
- List of all unacknowledged errors
- Each error: automation name | error type | action that failed | error message | time | retry count
- "Acknowledge" button per error
- "Retry" button per error (if retries remaining)
- Acknowledged errors section (collapsible)
- Error trend chart: errors per day last 30 days
- Admin only view

### View 5: Template Library (automation-templates.html)
- Category tabs: ALL | SPRINT | OKR | NOTIFICATIONS | FINANCE | CLIENT | GITHUB | GENERAL
- Each template card: name, description, trigger summary, action count, usage count
- "Use Template" button → pre-fills automation builder with template config
- "Save as Template" button on automation builder → saves current config as custom template
- System templates marked with lock icon (cannot be deleted)
- Custom templates: edit + delete available
- Admin only view

---

## ⚙️ Business Rules (Non-Negotiable)

1. AI can ONLY suggest automations — never auto-create, auto-enable, or auto-execute any automation
2. Admin must explicitly approve every AI suggestion before an automation rule is created
3. Circular automation detection mandatory before any rule save — service rejects circular chains
4. Max chain depth = 5 levels (A fires B fires C fires D fires E = max allowed)
5. Max 50 active automation rules per project — service rejects beyond limit
6. Max 100 automation fires per project per hour — excess queued
7. Max 10 fires per automation rule per minute — excess queued
8. All automation execution is async (queue-based) — never blocks the triggering HTTP request
9. Failed automations retried max 3 times with increasing delays (1min, 5min, 15min)
10. After 3 failed retries: status = FAILED permanently; Admin must acknowledge error
11. Dry run (test) mode must NEVER write to DB or send real notifications — simulation only
12. System templates cannot be deleted — only custom templates deletable
13. Disabled automation: pending queue entries for that rule immediately cancelled
14. Template variables ({{ }}) resolved from trigger_data snapshot — never from live DB at action time (prevents race conditions)
15. Every automation fire logged to automation_run_log (append-only)
16. Every action execution result logged per action within run_log.actions_executed JSON
17. GitHub actions require Admin confirmation before execution (not auto-executed)
18. updated_at manually updated in service on every PATCH
19. Server-side RBAC — all role checks in automationService.js, never trust client-side role
20. Automation engine fireTrigger() calls must be non-blocking (async, fire-and-forget to queue)

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations + Seed
- Create 7 tables
- Create 7 triggers
- Seed 20 built-in templates
- Verify all triggers with real INSERT/UPDATE/DELETE tests
- Must pass before Layer 2 begins

### Layer 2: Automation Engine Core (Queue + Processor + Condition Evaluator)
- automationEngine.js (fireTrigger, queue processor, condition evaluator, circular detection)
- automationService.js (rule CRUD, toggle, stats)
- Queue processor setInterval (5 second tick)
- Circular detection algorithm (real test with circular rule attempt)
- Rate limiting logic
- Real tests: fire trigger → verify queue entry → verify run log created
- Must pass before Layer 3 begins

### Layer 3: Action Executor (All Action Types)
- Action executor for all supported action types
- Template variable resolver ({{ syntax }})
- Variable store logging per run
- Retry logic with delays
- Real tests: each action type executed with real DB changes verified
- Must pass before Layer 4 begins

### Layer 4: Template + AI Suggestion + Error API
- Template CRUD (system + custom)
- AI suggestion review (approve/reject)
- Error acknowledge + retry
- Dry run / test endpoint
- Run log and history endpoints
- Queue status endpoint
- Stats endpoints
- Real HTTP tests
- Must pass before Layer 5 begins

### Layer 5: Platform-Wide Trigger Integration
- Add automationEngine.fireTrigger() call to EVERY relevant service:
  sprintService, backlogService, okrService, ganttService, workloadService,
  timeTrackingService, pipelineService, financeService, clientService, githubWebhookProcessor
- Verify each trigger fires correctly with real operations
- Real integration tests: perform action in each module → verify automation queue entry created
- Must pass before Layer 6 begins

### Layer 6: Frontend (5 Views)
- Automation Rules List
- Automation Builder (step-by-step with conditions + actions)
- Automation Run History
- Automation Error Center
- Template Library
- All views functional before Layer 7

### Layer 7: Integration + Full Test Suite
- End-to-end: create rule → fire trigger via real sprint start → verify queue → verify run log → verify action executed (real DB change) → verify notification sent → verify variable store populated
- Circular rule detection blocked (real HTTP test)
- Rate limit test (fire 101 times → verify 101st queued but rate-limited)
- Dry run test (no DB changes, no real notifications)
- AI suggestion approve flow (real automation created from suggestion)
- Retry logic test (force action failure → verify 3 retries → verify FAILED status)
- System template delete blocked (real HTTP test)
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 27 begins

---

## 📊 Test Scripts

scripts/verify-prd26-layer1.js        (DB + triggers + seed)
scripts/verify-prd26-layer2.js        (Automation Engine Core)
scripts/verify-prd26-layer3.js        (Action Executor + Variable Resolver)
scripts/verify-prd26-layer4.js        (Template + AI Suggestion + Error API)
scripts/verify-prd26-layer5.js        (Platform-Wide Trigger Integration)
scripts/verify-prd26-layer6.js        (Frontend smoke)
scripts/verify-prd26-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [ ] 7 tables created and verified
- [ ] 7 triggers tested (append-only confirmed with real DB calls)
- [ ] 20 built-in templates seeded correctly
- [ ] 22 API endpoints working with real HTTP calls
- [ ] Automation engine queue processor running (real 5s interval test)
- [ ] Circular detection blocking circular rules (real HTTP test)
- [ ] Rate limiting tested (real 101-fire scenario)
- [ ] All action types executing correctly (real DB change verified per action)
- [ ] Template variables resolving correctly ({{ syntax }} real test)
- [ ] Retry logic tested (3 attempts with delays verified)
- [ ] Dry run produces no DB changes and no real notifications (real test)
- [ ] AI suggestion approve flow creates real automation rule
- [ ] System template delete blocked (real HTTP test)
- [ ] fireTrigger() integrated into all relevant services (real trigger test per module)
- [ ] 5 frontend views functional
- [ ] Automation builder step-by-step working end-to-end
- [ ] All existing 469 tests still passing
- [ ] Reverse Engineering Report submitted and confirmed
- [ ] Honest Status Report submitted
- [ ] Admin GO-AHEAD received
- [ ] Committed to GitHub with message: feat(automation): PRD 26 complete

---

*PRD 26 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*