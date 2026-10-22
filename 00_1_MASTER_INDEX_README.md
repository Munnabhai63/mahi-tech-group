================================================================
MASTER INDEX / README
PROJECT: Internal Innovation & Execution Platform
FILE TO SAVE AS: 00_MASTER_INDEX_README.md
LOCATION: Root of project documentation folder (read this FIRST)
================================================================

PURPOSE OF THIS FILE
----------------------------------------------------------------
This file is the single entry-point for ANY human or AI model
(Antigravity, GPT, Claude, or any future assistant) working on
this project. It defines:
  1. The exact reading order of all documentation files.
  2. WHEN each file must be read (before design, before coding,
     before touching a specific module).
  3. The exact filename convention used for saving each file.
  4. A one-line summary of what each file governs.

RULE: No AI model or developer may start building ANY part of
this system without reading files 00-A and 00-B FIRST, in full,
every single time a new work session begins. These two files are
NON-SKIPPABLE governance law for this entire project.

================================================================
SECTION 1: MANDATORY GOVERNANCE FILES (READ BEFORE ANYTHING ELSE)
================================================================

ORDER | FILENAME                                          | WHEN TO READ
------|----------------------------------------------------|---------------------------
00-A  | 00_REVERSE_ENGINEERING_ENFORCEMENT_PROTOCOL.md      | Before reading any other
      |                                                      | file. Before building ANY
      |                                                      | competitor-inspired feature,
      |                                                      | re-read this file again.
00-B  | 00_AI_INTEGRATION_MASTER_MODULE.md                  | Immediately after 00-A.
      |                                                      | Before building ANY AI
      |                                                      | feature anywhere in the app,
      |                                                      | re-read this file again.

WHAT 00-A COVERS:
  - The law that AI must NEVER copy a competitor's code, UI, or
    branding.
  - The mandatory sequence before building any competitor-
    inspired feature: Analyze -> Structured Report -> Cross-check
    against OUR rules -> Our rules always win -> Then build.
  - The exact Reverse-Engineering Report template (State Diagram,
    Trigger-Condition-Action Table, Data Model Guess, Gaps vs Our
    Project, Adaptation Plan).
  - Master Competitor Reference List (Categories A-F).
  - Rule: if no competitor match exists, AI must ASK Admin before
    inventing anything new — never invent silently.

WHAT 00-B COVERS:
  - The project's AI philosophy: "AI SUGGESTS. HUMAN DECIDES."
  - The 7 official AI touchpoints across the whole platform.
  - Hard rule: AI can NEVER approve ideas, approve payouts,
    offboard members, or cast votes — only suggest, draft, or
    pre-score (advisory only).
  - The ai_suggestions / ai_config / ai_interaction_log schema
    used by every other module that adds an AI feature.
  - Rule: any NEW AI feature added later must re-run the 00-A
    protocol before being added to this file.

================================================================
SECTION 2: CORE BUILD ORDER (READ IN THIS EXACT SEQUENCE)
================================================================

This is the official build order. Each file assumes every file
above it in this list has already been read and implemented.
Do NOT jump ahead — later files depend on tables/rules defined
in earlier files.

STEP | FILENAME                              | ONE-LINE SUMMARY
-----|----------------------------------------|---------------------------------------------
01   | 01_DATABASE_AUTH_BACKBONE.md           | Users, sessions, roles, permissions, login/
     |                                         | logout, RBAC matrix. Foundation for everything.
02   | 02_IDEA_QUOTA_ENGINE.md                | Idea submission, draft vs submit, quota
     |                                         | (2 ideas / 7-14 days, admin-configurable).
03   | 03_VOTING_GATE.md                      | Team voting, 70-80% green threshold, quorum,
     |                                         | admin override, approve/revise/reject logic.
04   | 04_PARALLEL_FANOUT.md                  | What happens the SECOND an idea is approved:
     |                                         | parallel task creation across all roles.
05   | 05_OFFBOARDING_KILLSWITCH.md           | The 7-step kill-switch for removing a member
     |                                         | with zero access leakage, built early on purpose.
06   | 06_REVENUE_SPLIT_ENGINE.md             | 50/50 split (first 5 months) -> 100% team
     |                                         | split after. Wallets, withdrawals, payouts.
07   | 07_FRONTEND_CENTER_DASHBOARD.md        | The shared center panel: Kanban, live votes
     |                                         | feed, notifications, WebSocket architecture.
08   | 08_FRONTEND_CORNER_PANELS.md           | The 4 corner panels: Researcher, Developer,
     |                                         | Admin (quick), Producer.
09   | 09_FRONTEND_USER_PROFILE.md            | Full profile page: ideas, projects, ratings,
     |                                         | earnings, Former Member handling.
10   | 10_FRONTEND_ADMIN_PANEL.md             | Full-screen Admin control center: members,
     |                                         | ideas, projects, revenue, offboarding, config,
     |                                         | audit logs.
11   | 11_COWORKING_CANVAS.md                 | Shared live co-working room (embed Miro/FigJam
     |                                         | OR custom CRDT build). Built late on purpose.
12   | 12_MEETING_INTEGRATION.md              | Host/join meetings via Jitsi or Daily.co,
     |                                         | linked to idea review voting.
13   | 13_UI_POLISH_FINAL_QA.md               | Final polish, performance, security, 8 E2E
     |                                         | test scenarios, launch sign-off checklist.

================================================================
SECTION 3: READING TIMELINE (WHO READS WHAT, WHEN)
================================================================

PHASE 0 - BEFORE ANY CODE IS WRITTEN (Admin + every AI model):
   -> Read 00-A and 00-B fully. No exceptions.

PHASE 1 - BACKEND FOUNDATION BUILD (Developers):
   -> Read Steps 01 -> 02 -> 03 -> 04 -> 05 -> 06 in exact order.
   -> These six files form the complete backend/data logic layer.
   -> Do not touch frontend files until all six are implemented
      and tested.

PHASE 2 - FRONTEND BUILD (Developers, after Phase 1 is stable):
   -> Read Steps 07 -> 08 -> 09 -> 10 in exact order.
   -> Step 07 (center dashboard) MUST exist before Step 08
      (corner panels) because corner panels reuse its WebSocket
      and notification infrastructure.

PHASE 3 - ADVANCED / LOW-PRIORITY MODULES (Developers, last):
   -> Read Steps 11 -> 12.
   -> These are intentionally built last — least MVP-critical,
      most complex (real-time canvas, video infra).

PHASE 4 - FINALIZATION (Entire team + Admin):
   -> Read Step 13 only when Steps 01-12 are fully built and
      functional.
   -> Step 13 has zero new features — it is a QA/polish/sign-off
      gate before real launch.

ONGOING RULE (applies forever, not just once):
   -> Any time ANY new feature is proposed that is inspired by a
      competitor tool, re-read 00-A first.
   -> Any time ANY new AI capability is proposed, re-read 00-B
      first.

================================================================
SECTION 4: COMPLETE FILE LIST WITH EXACT SAVE NAMES
================================================================

Save every file using EXACTLY these names (case-sensitive),
in a single flat folder or numbered sub-folders — either works,
as long as the numeric prefix order is preserved:

  00_REVERSE_ENGINEERING_ENFORCEMENT_PROTOCOL.md
  00_AI_INTEGRATION_MASTER_MODULE.md
  01_DATABASE_AUTH_BACKBONE.md
  02_IDEA_QUOTA_ENGINE.md
  03_VOTING_GATE.md
  04_PARALLEL_FANOUT.md
  05_OFFBOARDING_KILLSWITCH.md
  06_REVENUE_SPLIT_ENGINE.md
  07_FRONTEND_CENTER_DASHBOARD.md
  08_FRONTEND_CORNER_PANELS.md
  09_FRONTEND_USER_PROFILE.md
  10_FRONTEND_ADMIN_PANEL.md
  11_COWORKING_CANVAS.md
  12_MEETING_INTEGRATION.md
  13_UI_POLISH_FINAL_QA.md
  00_MASTER_INDEX_README.md   <-- this file (keep at the very top)

TOTAL FILE COUNT: 16 files (2 governance + 13 build steps +
1 index/README).

================================================================
SECTION 5: NON-NEGOTIABLE RULES (PROJECT CONSTITUTION)
================================================================

These 6 rules appear across multiple files but are repeated here
as the final, permanent source of truth. No file, no AI model,
no future feature may contradict these:

1. PARALLEL FAN-OUT: Once an idea is approved by vote, work on
   research, frontend, backend, and testing happens IN PARALLEL,
   not sequentially. Dependency gates exist only at specific
   integration sub-tasks.

2. IDEA GATING: Every idea must pass BOTH a personal time-boxed
   quota (2 ideas per 7-14 days, admin-configurable, fixed cycle)
   AND a team vote with 70-80% green approval before any work
   begins.

3. REVENUE SPLIT: First 5 months after go-live = 50% idea owner /
   50% team. After 5 months = 100% team (owner loses special cut).
   This is fixed and non-negotiable.

4. MANUAL PAYOUT CONTROL: All withdrawals go through a payment
   gateway but require explicit manual Admin approval before any
   money moves. Never fully automated.

5. AIRTIGHT OFFBOARDING: A departing member loses ALL access
   immediately (sessions, login, external services, tasks,
   wallet) but their attribution/credit remains permanently
   visible as "Former Member." Admin retains ultimate control
   over everything at all times.

6. HUMAN-IN-THE-LOOP AI: AI may only suggest, draft, summarize,
   or pre-score. AI may NEVER approve ideas, approve payouts,
   offboard members, or cast votes. Every AI action requires
   explicit human Accept/Edit/Reject.

================================================================
SECTION 6: KNOWN OPEN ITEMS / FUTURE ADDENDUMS
================================================================

The following items are intentionally NOT yet fully designed and
are flagged here so no AI model assumes they are finished:

  - FULL RATINGS ENGINE: Step 09 currently uses only a single
    rating_avg column. Who rates, when, on what scale, and how
    per-project rating breakdowns work has NOT been designed yet.
    A dedicated Ratings Engine PRD is pending and should be
    requested as its own file when needed (suggested filename:
    14_RATINGS_ENGINE.md).

Any future addendum file MUST follow the same single-code-block,
=== divider format as all files above, and MUST be added to this
Master Index under both Section 2 (build order) and Section 4
(file list) immediately upon creation.

================================================================
END OF MASTER INDEX
================================================================