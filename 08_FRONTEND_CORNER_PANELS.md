# STEP 8 — FRONTEND 4 ROLE-BASED CORNER PANELS
# File: 08_FRONTEND_CORNER_PANELS.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 2 (Frontend) | Priority: HIGH | Build Order: #8 of 13
# Depends On: 01 to 07 (all backend + Center Dashboard must be working first)

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Step 7 me shared CENTER dashboard bana. Ab is step me 4 individual
CORNER panels banenge — har role ka apna PERSONAL workspace jahan
wo apna specific kaam karega. Ye 4 panels Center Dashboard ke
chaaron corners me fit honge (jaisa user ne shuru me describe kiya tha).

Is module ka kaam hai:
1. Researcher Corner Panel (Top-Left) banana
2. Developer Corner Panel (Top-Right) banana
3. Admin Corner Panel (Bottom-Left) banana
4. Producer/Tester Corner Panel (Bottom-Right) banana
5. Har panel ko uske role ke RBAC permissions (Step 1) ke hisaab
   se hi features dikhana

AI INSTRUCTION: Ye 4 panels "mini-dashboards" hain — har role ka
apna kaam yahan hoga, lekin Center Dashboard (Step 7) hamesha
beech me visible rahega taaki sabko pata rahe overall project
status kya hai. Admin ka FULL control panel (jisme offboarding,
revenue approval, etc. hai) Step 10 me alag se detail hoga — yahan
Admin corner sirf UNKA QUICK-ACCESS WORKSPACE view hai.

===================================================================
2. SCREEN LAYOUT REMINDER
===================================================================

  +-------------------+-------------------+
  |   RESEARCHER       |     DEVELOPER      |
  |   PANEL (2.1)       |     PANEL (2.2)    |
  +-------------------+-------------------+
  |         CENTER DASHBOARD (Step 7)       |
  +-------------------+-------------------+
  |   ADMIN             |     PRODUCER       |
  |   PANEL (2.3)        |     PANEL (2.4)    |
  +-------------------+-------------------+

NOTE: Login ke baad, user ko uske role ke hisaab se layout dikhega.
Options:
  a) Har user apna PANEL bada/focused dekhega + baaki 3 corners
     chhote/minimized preview me (taaki unhe pata rahe doosre kya
     kar rahe hain)
  b) Ya simple tab-switch: "My Workspace" vs "Team View" (Center)
Recommendation: Option (a) better hai kyunki user ka original
vision yahi tha — sab EK SAATH, EK SCREEN par dikhein.

===================================================================
3. CORNER PANEL — 2.1 RESEARCHER PANEL
===================================================================

Components:
  - "Submit New Idea" button (Step 2) with quota badge
  - "My Ideas" list (Draft/Pending/Approved/Rejected status tags)
  - "My Research Tasks" list (from project_tasks, task_type='research')
       each task: Project name, status, "Upload Research" button
  - Upload Research Flow:
       -> File upload (PDF/doc) -> attach to project_tasks
       -> On submit: task.status = 'DONE' -> triggers Step 4
          dependency-unlock logic (notifies Developer)
  - "My Profile Summary" mini-card: ideas submitted count,
    approval rate, rating average

Key API calls used: POST /api/ideas/draft, POST /api/ideas/:id/submit,
GET /api/ideas/my, GET /api/projects/my-tasks, PATCH /api/tasks/:id/status

===================================================================
4. CORNER PANEL — 2.2 DEVELOPER PANEL
===================================================================

Components:
  - "My Dev Tasks" list (task_type='backend' or 'frontend'),
    grouped by: TODO / Blocked / In Progress / Done
  - BLOCKED tasks show tooltip: "Waiting on: [Dependency Task]"
    (from Step 4 depends_on_task_id logic)
  - "Research Ready" alert banner: jab Researcher research upload
    kare, yahan turant notification banner dikhega: "Research
    for [Project] is ready - view attachment"
  - Task action buttons: "Start Task" (TODO->IN_PROGRESS),
    "Mark Complete" (IN_PROGRESS->DONE, triggers next dependency unlock)
  - Sub-role split view (optional tab): "Backend Tasks" | "Frontend Tasks"
    (based on users.sub_role from Step 1)
  - "My Profile Summary" mini-card: projects built, rating average,
    total earnings (links to wallet, Step 6)

Key API calls used: GET /api/projects/my-tasks, PATCH /api/tasks/:id/status,
GET /api/ideas/:id (to view research attachment)

===================================================================
5. CORNER PANEL — 2.3 ADMIN PANEL (Quick-Access version)
===================================================================

NOTE: Full detailed Admin Control Panel banega Step 10 me
(10_FRONTEND_ADMIN_PANEL.md). Yahan sirf QUICK-ACCESS summary hai
jo Admin ke corner me chhota sa dikhega.

Components:
  - "Pending Approvals" quick count: Withdrawals pending, Final
    Project Reviews pending, Ideas needing override
  - "Quick Actions" buttons: Add Member, Remove Member (opens
    Step 5 kill-switch flow), Enter Revenue (opens Step 6 form)
  - "Team Health" mini-stats: Active members count, Projects live
    count, Average team rating
  - Shortcut link: "Open Full Admin Control Panel" -> navigates
    to dedicated full-screen Admin view (Step 10)

Key API calls used: GET /api/admin/withdrawals/pending,
GET /api/admin/projects/all, GET /api/admin/members

===================================================================
6. CORNER PANEL — 2.4 PRODUCER/TESTER PANEL
===================================================================

Components:
  - "My Testing Tasks" list (task_type='testing'), grouped by
    TODO / Blocked / In Progress / Done
  - "Dev Build Ready" alert banner: jab Developer apna task DONE
    kare aur dependent "Full QA Testing" task unblock ho, yahan
    banner dikhega: "[Project] build is ready for testing"
  - Test Report Submission Flow:
       -> Form: Bug list / Pass-Fail checklist / Notes
       -> Attach test report file
       -> On submit: task.status = 'DONE' -> triggers next
          dependency unlock (Admin Final Review stage)
  - "My Profile Summary" mini-card: projects tested, rating average

Key API calls used: GET /api/projects/my-tasks, PATCH /api/tasks/:id/status

===================================================================
7. SHARED COMPONENT ACROSS ALL 4 PANELS — "Profile Summary Mini-Card"
===================================================================

Har panel me ye same component repeat hoga (role ke hisaab se
thoda data alag), lekin structure same:

  Data source: GET /api/users/:id/profile (Step 9 me pura detail
  banega, yahan sirf mini preview chahiye)

  Shows:
    - Avatar + Name + Role badge
    - Total Ideas Submitted
    - Total Projects Built
    - Rating Average (star display)
    - Total Revenue Earned (wallet shortcut)
    - Quota Remaining badge (if applicable to role)

===================================================================
8. NOTIFICATION BANNERS — CROSS-ROLE TRIGGER MAPPING
===================================================================

Ye table important hai — ye exactly wahi "event-driven notification"
requirement hai jo user ne shuru me maanga tha:

Trigger Event                        | Banner Shown To      | Panel Location
--------------------------------------|----------------------|------------------
Researcher uploads PDF/research       | Developer             | Dev Panel (top banner)
Developer marks Dev task DONE          | Producer              | Producer Panel (top banner)
Producer marks Testing task DONE        | Admin                 | Admin Panel (quick approvals)
Admin approves Final Review             | All project members   | Center Dashboard + respective panels
Idea gets APPROVED (from voting)        | Idea Owner + assigned team | All relevant panels

===================================================================
9. API ENDPOINTS (STEP 8 SCOPE — mostly reused)
===================================================================

Method | Endpoint                              | Access         | Purpose
-------|-------------------------------------------|----------------|-------------------------------
GET    | /api/users/:id/profile-mini                 | Authenticated  | Mini profile card data
GET    | /api/projects/my-tasks?role=researcher       | Authenticated  | Role-filtered task list
POST   | /api/tasks/:id/upload                        | Assigned user  | File upload for task completion
GET    | /api/banners/active                          | Authenticated  | Active cross-role alert banners

===================================================================
10. FRONTEND TECH NOTES
===================================================================

- Har corner panel ek SEPARATE React component hona chahiye
  (ResearcherPanel.jsx, DeveloperPanel.jsx, AdminPanel.jsx,
  ProducerPanel.jsx) taaki maintain karna aasan ho
- Conditional rendering: Login ke time user.role check karke
  decide karo kaunsa panel "primary/expanded" dikhega aur baaki
  teen "minimized/preview" mode me
- Banner notifications ko WebSocket (Step 7 ka connection) se
  real-time trigger karo, polling se nahi

===================================================================
11. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Har panel sirf apne role ke RBAC permissions (Step 1 Section 5)
   ke hisaab se hi actions dikhayega — backend bhi double-check
   karega (frontend hide kaafi nahi hai).
2. Cross-role banners (Section 8) hamesha REAL-TIME hone chahiye,
   delay acceptable nahi hai (ye poore workflow ka core hai:
   "Researcher upload kare to Developer ko turant pata chale").
3. Profile Summary Mini-Card consistent design follow karega
   sabhi 4 panels me (sirf data differ hoga, UI pattern same).
4. Admin Corner Panel sirf QUICK-ACCESS hai — poora control Step 10
   ki dedicated full-screen Admin Panel me jayega, is corner ko
   overload mat karo.

===================================================================
12. ACCEPTANCE CRITERIA (Step 8 Done kab maana jayega)
===================================================================

[ ] 4 separate corner panels (Researcher/Developer/Admin/Producer)
    ban chuke hain
[ ] Researcher "Submit Idea" aur "Upload Research" flow working hai
[ ] Developer ko Research-ready banner real-time mil raha hai
[ ] Developer task complete karte hi Producer ko banner mil raha hai
[ ] Producer test-report submit karte hi Admin ko approval-pending
    dikh raha hai
[ ] Admin quick-access panel se Add/Remove Member aur Revenue Entry
    shortcuts kaam kar rahe hain
[ ] Profile Summary Mini-Card sabhi 4 panels me sahi data dikha raha hai
[ ] RBAC permissions sahi se enforce ho rahe hain (ek role doosre
    role ka action nahi kar pa raha)

===================================================================
13. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 9: Frontend User Profile
Page (file name: 09_FRONTEND_USER_PROFILE.md) banegi. Ye Mini-Card
(Section 7) ka FULL detailed version hoga — poori profile history,
har idea/project ka breakdown, rating details, aur revenue ledger
view, jo click karne par Mini-Card se khulega.

===================================================================
END OF FILE 08
===================================================================