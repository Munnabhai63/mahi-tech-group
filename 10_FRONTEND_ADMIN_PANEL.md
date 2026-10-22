# STEP 10 — FRONTEND ADMIN CONTROL PANEL
# File: 10_FRONTEND_ADMIN_PANEL.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 2-3 (Frontend + Governance) | Priority: CRITICAL | Build Order: #10 of 13
# Depends On: 01, 03, 04, 05, 06, 08 (auth, voting, fan-out, offboarding, revenue, corner panels)

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Step 8 me Admin ke corner me sirf ek CHHOTA "Quick-Access" panel
tha. Is step me uska FULL, DEDICATED, FULL-SCREEN version banega
jahan Admin (user khud, Owner) ko COMPLETE control milega poore
system par — jo user ka end-goal tha: "Admin retains ultimate
control over everything."

Is module ka kaam hai:
1. Member management (Add/Edit/Remove/Offboard) — ek jagah
2. Revenue entry + Withdrawal approvals — pura financial control
3. Project final-review/launch approval — har project ka last gate
4. System configuration (quota limits, voting thresholds, windows)
5. Idea override (manual approve/reject/revise, Step 3 veto power)
6. Audit logs / Access logs viewer — full transparency Admin ke liye
7. Organization-level settings (company name, branding — future-proofing)

AI INSTRUCTION: Ye file CENTRALIZE karti hai saare Admin-only
endpoints jo Step 1-6 me already define ho chuke hain. Is file me
NAYI backend logic nahi likhni — sirf UNHI endpoints ko ek
COHESIVE Admin UI me assemble karna hai. Agar koi naya endpoint
chahiye jo pehle define nahi hua, to use yahan clearly "NEW
ENDPOINT" tag ke saath likho.

===================================================================
2. ADMIN PANEL — NAVIGATION STRUCTURE
===================================================================

  Admin Control Panel (full-screen, separate from 4-corner view)
  |
  |-- 2.1 Dashboard Overview (default landing)
  |-- 2.2 Member Management
  |-- 2.3 Idea Governance (Override + Pending Review list)
  |-- 2.4 Project Management (Final Review + Reassignment)
  |-- 2.5 Revenue & Payouts
  |-- 2.6 Offboarding Center
  |-- 2.7 System Configuration
  |-- 2.8 Audit Logs

NOTE: Admin corner panel (Step 8) ka "Open Full Admin Control
Panel" button yahan navigate karega.

===================================================================
3. SECTION 2.1 — DASHBOARD OVERVIEW
===================================================================

Data source: GET /api/admin/dashboard/overview (NEW ENDPOINT —
aggregates multiple existing queries into one summary call)

Widgets:
  - Total Active Members (by role breakdown: Researchers/Devs/Producers)
  - Active Projects count (by stage: Parallel/Integration/Testing/Review/Live)
  - Pending Approvals count (Idea votes needing override + Withdrawals
    pending + Projects awaiting final review)
  - Total Revenue Generated (all-time, all projects)
  - Recent Offboarding events (last 5, if any)

===================================================================
4. SECTION 2.2 — MEMBER MANAGEMENT
===================================================================

Data source: GET /api/admin/members (Step 1)

Table columns:
  - Avatar + Name
  - Role + Sub-role
  - Status (Active/Inactive badge)
  - Rating Avg
  - Ideas Submitted / Projects Built (quick counts)
  - Actions: [Edit Role] [View Profile] [Remove Member]

"Add Member" button (top-right):
  -> Modal form: Name, Email, Role dropdown, Sub-role (if Developer)
  -> On submit: POST /api/admin/members/add (Step 1)
  -> System auto-generates temp password + sends invite

"Remove Member" button -> triggers full Step 5 kill-switch flow
  (confirmation modal + 7-step progress checklist UI, as defined
  in 05_OFFBOARDING_KILLSWITCH.md Section 7)

"Edit Role" -> PATCH /api/admin/members/:id (role/sub_role change
  — NEW ENDPOINT, not explicitly defined earlier but implied by
  Step 1's RBAC structure)

===================================================================
5. SECTION 2.3 — IDEA GOVERNANCE
===================================================================

Two sub-tabs:

5.1 "Pending Review" tab:
  Data source: GET /api/ideas (filter status=PENDING_REVIEW)
  Shows: all ideas currently in voting, live green_percentage,
  time remaining, quorum status
  Action: "Override" button -> opens override modal
  (PATCH /api/admin/ideas/:id/override, Step 3 Section 4.5)
  Mandatory reason field before submit

5.2 "Decision History" tab:
  Data source: GET /api/ideas (filter status=APPROVED/REJECTED/REVISE)
  Shows: full historical log of all idea decisions, including
  whether Admin override was used (flag: admin_overridden=true/false)

===================================================================
6. SECTION 2.4 — PROJECT MANAGEMENT
===================================================================

Data source: GET /api/admin/projects/all (Step 4)

View: Same Kanban as Center Dashboard (Step 7) BUT with extra
Admin-only controls on each card:
  - "Reassign Member" (drag-drop or dropdown) ->
    PATCH /api/admin/projects/:id/reassign (Step 4)
  - "Final Review" button (only active when stage=ADMIN_REVIEW) ->
    PATCH /api/admin/projects/:id/final-review (Step 4)
    -> Opens review modal: Test report summary, Approve/Reject
       buttons, rejection requires reason + routes back to
       relevant stage (Dev or Testing)

===================================================================
7. SECTION 2.5 — REVENUE & PAYOUTS
===================================================================

Two sub-tabs:

7.1 "Enter Revenue" tab:
  Form: Project dropdown, Amount, Source, Date
  -> POST /api/admin/projects/:id/revenue (Step 6)
  -> Live preview before submit: "Owner gets ₹X (if <5mo) / Team
     gets ₹Y split among Z members" (calls split-preview logic)

7.2 "Pending Withdrawals" tab:
  Data source: GET /api/admin/withdrawals/pending (Step 6)
  Table: User, Amount, Requested Date, [Approve] [Reject] buttons
  Approve -> PATCH /api/admin/withdrawals/:id/approve (triggers
  gateway payout, Step 6 Section 4.5-4.6)
  Reject -> PATCH /api/admin/withdrawals/:id/reject (reason mandatory)

7.3 "Ledger" view (read-only):
  Data source: GET /api/admin/revenue/ledger (Step 6)
  Full immutable transaction history — filterable by project/user/date

===================================================================
8. SECTION 2.6 — OFFBOARDING CENTER
===================================================================

Data source: GET /api/admin/offboarding/history (Step 5)

Shows: Table of all past offboarding events — Name, Date, Initiated
By, Status (Completed/In Progress/Failed), Wallet Frozen Amount

Click row -> detail view showing full 7-step checklist status
(GET /api/admin/offboarding/:id/status, Step 5)

"Frozen Wallets" widget (linked from Step 5 Section 6):
  List of former members with frozen wallet_balance -> "Settle
  Manually" action button (NEW ENDPOINT needed: POST
  /api/admin/wallets/:user_id/settle — marks frozen amount as
  paid externally, or triggers one-time gateway payout then freezes
  permanently)

===================================================================
9. SECTION 2.7 — SYSTEM CONFIGURATION
===================================================================

Data source/updates: system_config table (Step 2, Step 3)

Editable settings form:
  - Idea Quota Limit (default: 2)
  - Idea Quota Window (7 or 14 days)
  - Vote Approval Threshold (70-80%)
  - Vote Quorum Percentage (default: 70%)
  - Voting Window Hours (default: 48)
  - Revenue Split Duration (default: 5 months) — NEW CONFIG KEY
    recommended here per Step 6 Section 9 Rule #2

Each field -> PATCH /api/admin/config/[module] (Step 2/3 endpoints,
  extended here into one unified settings screen)

===================================================================
10. SECTION 2.8 — AUDIT LOGS
===================================================================

Data source: GET /api/admin/access-logs (NEW ENDPOINT — reads from
access_log table, Step 1)

Table: Timestamp, User, Action, Resource, IP Address
Filters: User dropdown, Action type dropdown, Date range
Purpose: Full transparency/compliance trail — every login, vote,
offboarding, revenue entry, override action traceable here

===================================================================
11. API ENDPOINTS SUMMARY (STEP 10 SCOPE)
===================================================================

Method | Endpoint                                | Status        | Purpose
-------|---------------------------------------------|---------------|--------------------------------
GET    | /api/admin/dashboard/overview                | NEW           | Aggregated overview widgets
PATCH  | /api/admin/members/:id                        | NEW           | Edit role/sub-role
POST   | /api/admin/wallets/:user_id/settle             | NEW           | Manual frozen wallet settlement
GET    | /api/admin/access-logs                         | NEW           | Audit log viewer
(all other endpoints reused from Steps 1, 3, 4, 5, 6 as referenced above)

===================================================================
12. FRONTEND TECH NOTES
===================================================================

- Separate route/layout from the 4-corner view (e.g., /admin/*
  routes, guarded by role==='admin' check both frontend AND
  backend middleware)
- Use a sidebar navigation layout (Section 2 structure) rather
  than tabs, since 8 sections is too many for a tab bar
- Reuse Kanban component from Step 7 (don't rebuild) — just add
  extra admin-only action buttons conditionally rendered

===================================================================
13. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Har route aur API call is section ka backend par DOUBLE-CHECK
   hoga role==='admin' — frontend route-guard kaafi nahi hai.
2. Remove Member action hamesha full Step 5 kill-switch flow
   trigger karega — koi shortcut/direct-delete button nahi hoga.
3. Revenue entry aur Withdrawal approval sirf is panel se hi
   possible hoga, kahin aur se nahi (single source of truth for
   financial actions).
4. System Config changes turant effect lenge naye submissions par,
   lekin ALREADY-RUNNING processes (ongoing votes, ongoing quota
   cycles) par retroactively apply NAHI honge (taaki mid-cycle
   confusion na ho).
5. Audit log kabhi edit/delete nahi ho sakta, Admin ko bhi nahi
   (append-only table).

===================================================================
14. ACCEPTANCE CRITERIA (Step 10 Done kab maana jayega)
===================================================================

[ ] Dashboard Overview sahi aggregated stats dikha raha hai
[ ] Member Management se Add/Edit/Remove sab kaam kar rahe hain
[ ] Remove Member poora 7-step kill-switch checklist trigger kar raha hai
[ ] Idea Governance override working hai with mandatory reason
[ ] Project Final Review Approve/Reject sahi stage-transition kar raha hai
[ ] Revenue Entry + split-preview sahi calculate ho raha hai
[ ] Withdrawal Approve/Reject gateway payout tak trigger kar raha hai
[ ] Offboarding Center history + frozen wallets settlement dikh raha hai
[ ] System Config changes system_config table me persist ho rahe hain
[ ] Audit Logs filterable aur accurate hain
[ ] Sabhi routes/APIs backend-level admin-only check se protected hain

===================================================================
15. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 11: Co-working Canvas
(file name: 11_COWORKING_CANVAS.md) banegi. Ye sabse COMPLEX
frontend module hai (WebSocket real-time shared canvas, jaisa
Miro/FigJam), isliye jaan-bujh kar sequence me LATE (11th) rakha
gaya hai — MVP ke liye sabse kam critical, sabse zyada engineering
effort wala module.

===================================================================
END OF FILE 10
===================================================================