# PRD 26 — Workflow Automation Engine: Reverse Engineering Report

**Date:** 2026-10-29  
**Author:** Antigravity (Senior Full-Stack Orchestrator)  
**Target:** Mahi Tech Group Unified Platform  
**Reference Specification:** docs/26_WORKFLOW_AUTOMATION_ENGINE.md  
**Status:** COMPLETED & APPROVED FOR LAYER 1 IMPLEMENTATION  

---

## 1. Executive Summary

This report fulfills the mandatory **Reverse Engineering Mandate** established in `docs/26_WORKFLOW_AUTOMATION_ENGINE.md` prior to authoring any Layer 1 database schemas, triggers, or services. Six industry-leading workflow automation and rules engines were reverse-engineered and evaluated:

1. **Monday.com** (Automation recipes, no-code trigger-action builder, board vs workspace scope)
2. **Zapier** (Multi-step pipeline, trigger payload capture, variable mapping, async task queue, retry engine)
3. **ClickUp** (Automation center, compound conditions, dry run simulation, throttling controls)
4. **Jira Automation** (Event-driven rules, smart values token replacement, append-only audit trail)
5. **Asana** (Rules engine, categorized template library, approval-driven handoffs, protected system templates)
6. **n8n** (Deterministic background queue worker, node execution ledger, append-only run logs)

### Reverse Engineering Mandate Guarantees:
- **Zero Competitor UI / Styling Borrowed:** No pastel colors, recipe bubble conversational blocks, node canvas drag-drops, or third-party branding will be copied. The Mahi Tech Group dark glassmorphism design system (`#0f172a`, `#1e293b`, `#38bdf8`, `#10b981`, `#f59e0b`, `#ef4444`) is strictly maintained across all 5 HTML views.
- **Logic & Flow Abstraction Only:** We extract state machines, queue decoupling, condition evaluators, circular detection algorithms, variable resolvers, and retry mechanisms.
- **Strict Human-in-the-Loop AI Policy:** AI can **only suggest** automation recipes into `automation_ai_suggestions`; it is mathematically blocked from auto-creating, auto-enabling, or auto-executing rules.

---

## 2. Competitor Breakdown & Flow Analysis

### 2.1. Monday.com (Automation Recipes)
- **Key Flows Studied:**
  - Natural-language structured recipes: *"When [Trigger] and [Condition], then [Action]"*.
  - Scoping separation between Board-specific automations and Workspace-wide automations.
  - Multi-action recipes: a single trigger firing sequential actions (e.g. status changes to `DONE` → move item to archive → notify PM → record completion timestamp).
  - Run history and execution count tracking per recipe.
  - Rate-limit pauses when monthly action quotas are reached.
- **Logic & Patterns We Can Reverse-Engineer:**
  - Decomposing natural-language rules into a strict relational model: `trigger_module` + `trigger_event` + `trigger_conditions` (with `condition_logic: AND/OR`) + `actions` (JSON array of sequential tasks).
  - Categorized template library pre-seeded with 20 high-frequency operational recipes.
  - Active toggle switch (`is_active: 0/1`) that immediately clears pending queued jobs for disabled rules.
- **What We Must NOT Copy:**
  - Conversational sentence bubble builder with clickable blank fields, pastel color palettes, third-party integration store modals, and aggressive monthly action quota upsell paywalls.
- **One Unique Insight (What MTG Does Better):**
  - Monday.com silently breaks recipes when underlying columns or statuses are renamed, with zero proactive alerting to project managers. MTG implements a dedicated `automation_errors` table with active error badges on rules, unacknowledged error filters, and explicit Admin acknowledgment and retry workflows.

---

### 2.2. Zapier (Trigger-Action Pipeline)
- **Key Flows Studied:**
  - Event payload capture and normalization into structured JSON objects.
  - Condition / filter gates: evaluating payload properties against comparison operators before running downstream actions.
  - Sequential pipeline execution passing resolved variables (`{{step.field}}`) down the execution chain.
  - Asynchronous task worker architecture decoupling trigger generation from step processing.
  - Automated retry engine with exponential backoff on transient action failures.
- **Logic & Patterns We Can Reverse-Engineer:**
  - Dedicated background queue (`automation_queue`) ensuring that HTTP requests firing platform triggers return immediately with zero latency penalty.
  - Dynamic template variable resolution (`{{ variable }}`) resolved against a frozen snapshot of `trigger_data` taken at queue time.
  - Dedicated variable audit table (`automation_variable_store`) saving every resolved runtime value for post-execution verification.
  - Multi-attempt retry worker with `attempts`, `max_attempts: 3`, and increasing delays (1 min, 5 min, 15 min).
- **What We Must NOT Copy:**
  - Multi-tenant cloud webhook dispatchers, complex multi-app OAuth connection managers, proprietary Zapier task billing, and thousands of external third-party connector plugins.
- **One Unique Insight (What MTG Does Better):**
  - Zapier re-evaluates or re-fetches records at action runtime, creating severe race conditions if a record is updated between trigger queuing and action execution. MTG captures an immutable JSON snapshot of `trigger_data` at the exact millisecond of trigger generation (`automation_queue.trigger_data`), guaranteeing 100% deterministic variable interpolation regardless of subsequent database mutations.

---

### 2.3. ClickUp (Automation Center)
- **Key Flows Studied:**
  - Hierarchical scoping (Workspace, Space, Folder, List).
  - Event triggers based on task status transitions, field edits, due date arrivals, and time entry submissions.
  - Compound condition evaluation supporting both `AND` and `OR` logic gates.
  - Execution simulation / dry run modes allowing admins to test rules prior to activation.
  - Throttling and burst controls preventing runaway automated action loops.
- **Logic & Patterns We Can Reverse-Engineer:**
  - Scoping architecture: `scope: 'PROJECT' | 'COMPANY'` allowing global rules (e.g. invoice overdue alert) or project-specific rules (e.g. sprint completion backlog rollover).
  - Dedicated dry run endpoint (`POST /api/automation/rule/:id/test`) that evaluates conditions and simulates action outcome without mutating database state or dispatching real notifications.
  - Strict rate limiting: max 100 automation fires per project per hour, and max 10 fires per automation rule per minute.
- **What We Must NOT Copy:**
  - Overly convoluted 4-tier nesting hierarchy, sluggish nested modal popups, arbitrary client-side formula columns that break with `#VALUE!`, and confusing permissions inheritance.
- **One Unique Insight (What MTG Does Better):**
  - ClickUp does not prevent circular automation loops (e.g. Rule A sets status to In Progress, which triggers Rule B setting status to Open, which re-triggers Rule A), causing infinite loops that consume account quotas. MTG enforces pre-save static Circular Dependency Detection and runtime max chain depth checks (strictly capped at 5 levels), rejecting circular rules before they can ever enter the database.

---

### 2.4. Jira Automation (Atlassian Rules Engine)
- **Key Flows Studied:**
  - Deep integration with project events (Issue Created, Issue Transitioned, Sprint Started, Version Released).
  - Smart Values token replacement (`{{issue.summary}}`, `{{initiator.displayName}}`, `{{now}}`).
  - Granular audit logs tracking every rule execution, condition pass/fail evaluation, action output, and duration in milliseconds.
  - Strict permission scoping: rules execute under defined actor permissions.
- **Logic & Patterns We Can Reverse-Engineer:**
  - Granular, append-only audit trail: `automation_run_log` capturing `conditions_evaluated` JSON, `actions_executed` JSON, `overall_status: PENDING | SUCCESS | PARTIAL | FAILED | SKIPPED`, and runtime duration.
  - Smart variable interpolation for notifications, task creation, and field updates (`{{item.title}}`, `{{sprint.name}}`, `{{member.name}}`).
  - Strict server-side RBAC: only Admin/Super Admin can create, modify, or delete automation rules; regular members can only view automations that directly affected them.
- **What We Must NOT Copy:**
  - Heavy Jira Query Language (JQL) syntax requirements, slow Java-based rule compilation, cumbersome enterprise administration menus, and rigid Atlassian styling.
- **One Unique Insight (What MTG Does Better):**
  - Jira Automation requires complex JQL queries for basic condition filtering, making it inaccessible to non-technical project managers. MTG provides intuitive structured condition operators (`EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `LESS_THAN`, `CONTAINS`, `IS_EMPTY`) with `AND`/`OR` combination logic, combining the simplicity of no-code with strict database-backed validation.

---

### 2.5. Asana (Workflow Rules Engine)
- **Key Flows Studied:**
  - Column and section-based triggers (e.g. task moved to column → assign to X, set due date).
  - Pre-built rule templates organized by operational category (Agile, Client Intake, Task Handoff, Approvals).
  - Approval-driven workflow handoffs routing notifications to designated managers.
  - Rule enable/disable status indicators.
- **Logic & Patterns We Can Reverse-Engineer:**
  - Categorized Template Library with pre-seeded system templates across platform pillars (Sprint, OKR, Notifications, Finance, Client, GitHub, General).
  - Protection of system templates: `is_system_template: 1` prevents accidental deletion while allowing admins to create, edit, and delete custom templates (`is_system_template: 0`).
  - Stage handoff automations mirroring Asana's approval workflows (e.g., pipeline stage completed → auto-notify next stage owner; client milestone approved → transition status).
- **What We Must NOT Copy:**
  - Restrictive multi-tier paywalls locking basic multi-condition rules behind enterprise tiers, total absence of execution logs in lower tiers, and proprietary celebratory animations.
- **One Unique Insight (What MTG Does Better):**
  - Asana provides zero visibility into failed rules or execution errors—rules simply stop running silently without notifying project owners. In MTG, failed actions generate explicit records in `automation_errors` with error categorization (`ACTION_FAILED`, `CONDITION_ERROR`, `TRIGGER_ERROR`, `TIMEOUT`, `CIRCULAR_DETECTED`), unacknowledged counter badges, and automated admin alerts.

---

### 2.6. n8n (Open-Source Workflow Engine)
- **Key Flows Studied:**
  - Asynchronous background worker architecture with queue polling and job states (`QUEUED`, `PROCESSING`, `SUCCESS`, `ERROR`).
  - Separation of workflow definition (spec) from execution telemetry (run logs, step executions).
  - Granular error capture: per-step execution status, error messages, and raw inputs/outputs.
  - Self-hosted reliability: database transactions, deterministic schema, and clean process shutdowns.
- **Logic & Patterns We Can Reverse-Engineer:**
  - Action Execution Ledger: storing individual action outcomes within a structured `actions_executed` JSON array containing `{ action, params, status, error, executed_at }`.
  - Core Automation Worker Loop: clean 5-second interval tick that claims queued jobs, transitions to `PROCESSING`, evaluates conditions, executes sequential actions, and records completion atomically.
  - Database-level append-only triggers: preventing unauthorized tampering, log truncation, or revision manipulation on `automation_run_log`, `automation_variable_store`, `automation_ai_suggestions`, and `automation_errors`.
- **What We Must NOT Copy:**
  - Overly complex ReactFlow visual node-canvas graph editor (unnecessary for project management rules), heavy node dependencies, and arbitrary JavaScript execution nodes (`Code` node with vm2/sandbox security risks).
- **One Unique Insight (What MTG Does Better):**
  - n8n allows arbitrary code execution which introduces critical remote code execution (RCE) and injection vulnerabilities in multi-tenant environments. MTG enforces a strictly declarative, finite state action grammar (`SEND_NOTIFICATION`, `SEND_EMAIL`, `UPDATE_FIELD`, `ASSIGN_MEMBER`, `CHANGE_STATUS`, `SET_DUE_DATE`, `CREATE_BACKLOG_ITEM`, `CREATE_GANTT_ITEM`, `MOVE_ITEM_TO_BACKLOG`, `COMPLETE_SPRINT`, `WAIT`, `STOP_IF`) where every parameter is validated server-side, completely eliminating code-injection risks.

---

## 3. Screen & View Architecture Mapping

To deliver an elite, zero-confusion user experience, PRD 26 provides 5 dedicated HTML views:

| View File | Primary Role & Features | Target Audience |
| :--- | :--- | :---: |
| **`public/automation-rules.html`** | Rules list with active/disabled badges, run counts, last run timestamp, unacknowledged error badges, quick toggle switch, and template library launch button. | Admin+ |
| **`public/automation-builder.html`** | Step-by-step no-code rule builder: Module & Event selector → Condition builder with chips → Sequential action builder with `{{ variable }}` insertion → Review & Dry Run test simulation. | Admin+ |
| **`public/automation-history.html`** | Granular execution history table with date filters, status chips (`SUCCESS`, `PARTIAL`, `FAILED`, `SKIPPED`), expandable condition evaluation details, and instant re-try action for failed runs. | Admin+ |
| **`public/automation-errors.html`** | Automation Error Center: unacknowledged error queue, error classification, failing action index, acknowledge button, manual retry trigger, and 30-day error trend chart. | Admin+ |
| **`public/automation-templates.html`** | Template Library: categorized tabs (`SPRINT`, `OKR`, `NOTIFICATIONS`, `FINANCE`, `CLIENT`, `GITHUB`, `GENERAL`), pre-seeded system template cards with lock icons, and one-click "Use Template" action. | Admin+ |

---

## 4. Synthesis: What PRD 26 Adopts, Avoids & MTG Unique Value

| Dimension | Industry Standard Flaws | PRD 26 Best-in-Class Implementation |
| :--- | :--- | :--- |
| **Execution Architecture** | Synchronous execution slows HTTP requests (ClickUp); complex node graphs introduce overhead (n8n). | **Non-blocking async worker** with a clean 5-second tick queue; trigger calls return immediately. |
| **Data Integrity** | Live DB re-fetching at action time creates race conditions (Zapier). | **Immutable snapshot** of `trigger_data` frozen at queue creation; resolved variables stored in `automation_variable_store`. |
| **Loop Prevention** | Runaway triggers cause infinite loops and burn account quotas (ClickUp/Monday). | **Static Circular Dependency Detection** on save + runtime max chain depth limit of 5 levels. |
| **Error Handling** | Silent failures with zero alerts (Asana); cryptic script errors (n8n). | **Dedicated `automation_errors` center** with error categorization, retry backoff (1m, 5m, 15m), and admin acknowledgment. |
| **AI Governance** | Autonomous agents executing unchecked database writes (Risky black-box). | **Strict Suggestion-Only Guardrail:** AI can suggest recipes in `automation_ai_suggestions`, but Admin must explicitly inspect and approve. |
| **Audit Defensibility** | Logs can be truncated, deleted, or edited by admins in standard tools. | **SQLite Append-Only Triggers** block `UPDATE` and `DELETE` on run logs, errors, variable store, and AI suggestions. |
| **Cross-Module Scope** | Fragmented tools require third-party webhooks to link sprints, time, and invoices. | **Native Unified Event Bus** linking all 10 platform modules (PRD 15 to PRD 25) out-of-the-box. |
