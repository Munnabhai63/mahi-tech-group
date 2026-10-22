# STEP 4 — PARALLEL FAN-OUT ENGINE
# File: 04_PARALLEL_FANOUT.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 1-2 (Foundation -> Automation) | Priority: CRITICAL | Build Order: #4 of 13
# Depends On: 01_DATABASE_AUTH_BACKBONE.md, 02_IDEA_QUOTA_ENGINE.md, 03_VOTING_GATE.md

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Jab koi idea Step 3 (Voting Gate) se "APPROVED" hoti hai, to is module
ka kaam shuru hota hai. Ye module idea ko ek real PROJECT me convert
karta hai aur sabse IMPORTANT user rule ko implement karta hai:

**Approval ke baad kaam SEQUENTIAL nahi, PARALLEL chalega** — Researcher,
Frontend Developer, Backend Developer, Producer sabko EK SAATH kaam
assign hoga (sirf integration points par dependency rahegi).

Is module ka kaam hai:
1. Approved idea se naya "project" record banana
2. Idea owner ki attribution permanently lock karna
3. Revenue clock start karna (5-month timer jo Step 6 use karega)
4. Sabhi roles ko EK SAATH parallel task assign karna
5. Integration dependency points define karna (jahan roles ek dusre
   par wait karte hain, jaise "Dev Integrate" sirf "Research Done"
   ke baad)
6. Notifications bhejna sabhi assigned members ko

AI INSTRUCTION: Ye module sirf PROJECT CREATION aur TASK FAN-OUT tak
limited hai. Notification ka detailed engine Step 5 ke parallel bhi
chal sakta hai lekin core notification trigger-points yahin define
honge. Revenue calculation Step 6 ka scope hai, yahan sirf clock
START hoga.

===================================================================
2. PARALLEL EXECUTION RULE (CONFIRMED BY USER — CRITICAL)
===================================================================

GALAT (Purana sequential model - reference ke liye, is tarah NAHI chalega):
  Researcher -> (wait) -> Developer -> (wait) -> Producer -> (wait) -> Admin

SAHI (Naya Parallel model - APPROVAL KE BAAD):
  Idea APPROVED
       |
       |--> Researcher(s) start deep research          [PARALLEL]
       |--> Backend Developer(s) start API/architecture [PARALLEL]
       |--> Frontend Developer(s) start UI scaffolding  [PARALLEL]
       |--> Producer(s) start test-plan preparation     [PARALLEL]
       |
       (sab apna kaam alag-alag start karte hain, lekin kuch
        INTEGRATION GATES hote hain jahan wait karna padta hai)

INTEGRATION GATES (dependency sirf yahan hai, baaki sab parallel hai):
  Gate 1: Backend API ready -> Frontend integration start ho sakta hai
  Gate 2: Research findings ready -> Dev final feature-logic lock kar sakta hai
  Gate 3: Dev build complete -> Producer full testing start kar sakta hai
  Gate 4: Testing passed -> Admin final review/launch approval

NOTE: Gates sirf un specific sub-tasks ko block karte hain jo
dusre role ke output par depend karte hain — PURA ROLE block
nahi hota. Jaise Frontend Developer UI scaffolding turant shuru
kar sakta hai (wait nahi), sirf "API binding" wala specific task
Backend ke ready hone tak wait karega.

===================================================================
3. DATABASE SCHEMA — TABLES FOR STEP 4
===================================================================

---------------------------------------------------------------
3.1 TABLE: projects  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE projects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id             UUID NOT NULL REFERENCES ideas(id),
    org_id              UUID NOT NULL DEFAULT 'DEFAULT_ORG',
    title               VARCHAR(200) NOT NULL,
    owner_id            UUID NOT NULL REFERENCES users(id),
    revenue_clock_start TIMESTAMP,
    current_stage       VARCHAR(30) DEFAULT 'RESEARCH_DEV_PARALLEL' CHECK (current_stage IN
                        ('RESEARCH_DEV_PARALLEL','INTEGRATION','TESTING',
                         'ADMIN_REVIEW','LIVE','REJECTED_AT_REVIEW')),
    status              VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN
                        ('ACTIVE','PAUSED','LIVE','ARCHIVED')),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

NOTE: owner_id yahan PERMANENTLY lock ho jayega idea ke original
submitter se — ye field kabhi change nahi hogi, chahe wo member
baad me team chhod de (Step 5 Offboarding dekhna, attribution
retain hoti hai).

---------------------------------------------------------------
3.2 TABLE: project_members  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE project_members (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              UUID NOT NULL REFERENCES projects(id),
    user_id                 UUID NOT NULL REFERENCES users(id),
    role_in_project         VARCHAR(30) NOT NULL CHECK (role_in_project IN
                            ('researcher','frontend_dev','backend_dev',
                             'producer','admin_reviewer')),
    task_status             VARCHAR(20) DEFAULT 'ASSIGNED' CHECK (task_status IN
                            ('ASSIGNED','IN_PROGRESS','BLOCKED_ON_DEPENDENCY',
                             'SUBMITTED','APPROVED')),
    contribution_weight     DECIMAL(5,2) DEFAULT 0.0,
    joined_at               TIMESTAMP DEFAULT NOW(),
    removed_at              TIMESTAMP NULL
);

NOTE: removed_at column Step 5 (Offboarding) ke liye reserve hai —
jab member team chhode, usko DELETE nahi karenge, sirf removed_at
timestamp set karenge (attribution preserve karne ke liye).

---------------------------------------------------------------
3.3 TABLE: project_tasks  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE project_tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id),
    assigned_to          UUID REFERENCES users(id),
    task_name           VARCHAR(150) NOT NULL,
    task_type           VARCHAR(30) CHECK (task_type IN
                        ('research','backend','frontend','testing','review')),
    depends_on_task_id   UUID REFERENCES project_tasks(id) NULL,
    status               VARCHAR(20) DEFAULT 'TODO' CHECK (status IN
                        ('TODO','BLOCKED','IN_PROGRESS','DONE')),
    created_at           TIMESTAMP DEFAULT NOW(),
    completed_at         TIMESTAMP NULL
);

NOTE: depends_on_task_id hi wo column hai jo "Integration Gates"
(Section 2) ko implement karta hai — ClickUp ke "Waiting On /
Blocking" dependency model se reverse-engineered (reference:
Master Competitor Stack, Category B).

===================================================================
4. FAN-OUT LOGIC — STEP BY STEP FLOW
===================================================================

---------------------------------------------------------------
4.1 Trigger: Idea APPROVED (from Step 3)
---------------------------------------------------------------

ideas.status = 'APPROVED' hote hi, backend automatically:

  1. CREATE new row in `projects`
       idea_id = approved idea ka id
       owner_id = ideas.owner_id (LOCKED permanently)
       revenue_clock_start = NOW()   <- 5-month timer yahan se start
       current_stage = 'RESEARCH_DEV_PARALLEL'

  2. AUTO-ASSIGN project_members (parallel roles):
       -> Available Researchers (based on current workload) assigned
          role_in_project = 'researcher'
       -> Available Backend Developers assigned
          role_in_project = 'backend_dev'
       -> Available Frontend Developers assigned
          role_in_project = 'frontend_dev'
       -> Available Producers assigned
          role_in_project = 'producer'
       -> Admin auto-added as 'admin_reviewer' (always, no assignment needed)

  3. CREATE project_tasks (initial parallel batch, NO dependency):
       - "Deep Research" (type=research, assigned_to=researcher, depends_on=NULL)
       - "Backend Architecture Setup" (type=backend, assigned_to=backend_dev, depends_on=NULL)
       - "Frontend UI Scaffolding" (type=frontend, assigned_to=frontend_dev, depends_on=NULL)
       - "Test Plan Preparation" (type=testing, assigned_to=producer, depends_on=NULL)

     Ye 4 tasks SAATH SAATH shuru hote hain (status=TODO -> IN_PROGRESS
     jaise hi member unhe open kare).

  4. CREATE dependent tasks (BLOCKED initially, triggered later):
       - "Frontend API Integration" (depends_on_task_id = Backend Architecture task)
       - "Feature Logic Lock" (depends_on_task_id = Deep Research task)
       - "Full QA Testing" (depends_on_task_id = Feature Logic Lock task)
       - "Admin Final Review" (depends_on_task_id = Full QA Testing task)

  5. SEND notifications to all assigned members (trigger for Step
     Notification Engine): "You have been assigned to project:
     [Title] - Role: [Your Role] - Start now"

---------------------------------------------------------------
4.2 Workload-Based Assignment Logic (Available Member kaise choose ho)
---------------------------------------------------------------

Jab multiple Researchers/Devs/Producers available hon, system auto-pick
karega is priority order se:
  1. Jis member ke paas sabse kam ACTIVE assigned tasks hon
     (COUNT project_tasks WHERE assigned_to=user AND status != 'DONE')
  2. Agar tie ho, to jis member ka rating_avg sabse zyada ho
  3. Admin ko hamesha MANUAL OVERRIDE ka option milega assignment
     change karne ke liye (drag-drop ya dropdown se)

---------------------------------------------------------------
4.3 Dependency Unlock Logic (Gate trigger)
---------------------------------------------------------------

Jab koi parent task complete hota hai:
  project_tasks.status = 'DONE' (parent) hote hi
    -> System checks all tasks WHERE depends_on_task_id = parent.id
    -> UNBLOCK those tasks: status 'BLOCKED' -> 'TODO'
    -> Notify assigned_to user: "Your task [Name] is now unblocked, you can start"

Example: "Backend Architecture Setup" DONE hote hi ->
         "Frontend API Integration" turant BLOCKED se TODO ho jayega
         aur Frontend Developer ko notify kiya jayega.

---------------------------------------------------------------
4.4 Stage Progression (current_stage update)
---------------------------------------------------------------

projects.current_stage changes automatically based on task completion:

  RESEARCH_DEV_PARALLEL  -> jab tak initial 4 parallel tasks chal rahe hon
  INTEGRATION            -> jab Backend/Research dono DONE ho jayen aur
                            Frontend/Feature-lock tasks start hon
  TESTING                -> jab Full QA Testing task TODO/IN_PROGRESS ho
  ADMIN_REVIEW           -> jab Full QA Testing DONE ho jaye
  LIVE                   -> jab Admin "Admin Final Review" ko APPROVE kare
  REJECTED_AT_REVIEW     -> jab Admin reject kare (loops back to relevant stage)

===================================================================
5. API ENDPOINTS (STEP 4 SCOPE)
===================================================================

Method | Endpoint                                   | Access          | Purpose
-------|----------------------------------------------|-----------------|--------------------------------
POST   | /api/projects/auto-create (internal trigger)  | System-only     | Approved idea se project banana
GET    | /api/projects/:id                             | Project members | Project detail + all tasks
GET    | /api/projects/my-tasks                        | Authenticated   | Mere assigned tasks (status-wise)
PATCH  | /api/tasks/:id/status                          | Assigned user   | Task status update (TODO->IN_PROGRESS->DONE)
PATCH  | /api/admin/projects/:id/reassign               | Admin only      | Manual member reassignment
GET    | /api/admin/projects/all                        | Admin only      | Sabhi active projects overview
PATCH  | /api/admin/projects/:id/final-review            | Admin only      | Admin approve -> stage=LIVE

===================================================================
6. FRONTEND REQUIREMENTS (STEP 4 SCOPE)
===================================================================

- Center Dashboard me "Active Projects" board — Kanban-style columns:
  Research/Dev Parallel | Integration | Testing | Admin Review | Live
- Har role ke corner panel me "My Tasks" list — status ke saath
  (TODO / Blocked / In Progress / Done), BLOCKED tasks grayed-out
  with tooltip: "Waiting on: [Dependency Task Name]"
- Project card par multiple avatars dikhenge (sabhi parallel-assigned
  members ke) — "Who is working on what" ek glance me visible
- Admin Control Panel me "Reassign" drag-drop option + "Final Review
  Approve/Reject" button jab stage=ADMIN_REVIEW ho

===================================================================
7. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Idea owner_id project me permanently LOCK hoga — kabhi change
   nahi hoga, chahe member team chhod de ya role badle.
2. Approval ke baad kaam kabhi STRICTLY sequential nahi chalega —
   initial 4 tasks hamesha parallel create honge.
3. Dependency sirf specific SUB-TASKS par lagegi, pura role kabhi
   block nahi hoga.
4. revenue_clock_start project creation ke exact moment par set
   hoga — iska Step 6 (Revenue Engine) directly use karega 5-month
   calculation ke liye.
5. Member assignment workload-based hoga by default, lekin Admin
   hamesha manual override kar sakta hai.
6. Task status DELETE kabhi nahi hoga, sirf status transitions
   (TODO/BLOCKED/IN_PROGRESS/DONE) honge — history preserve rahegi.

===================================================================
8. ACCEPTANCE CRITERIA (Step 4 Done kab maana jayega)
===================================================================

[ ] projects, project_members, project_tasks tables ban chuki hain
[ ] Approved idea se automatically project create ho raha hai
[ ] revenue_clock_start sahi timestamp ke saath set ho raha hai
[ ] 4 parallel initial tasks auto-create ho rahe hain (no dependency)
[ ] Dependent tasks BLOCKED state me create ho rahe hain
[ ] Parent task DONE hote hi dependent task auto-unblock ho raha hai
[ ] Workload-based auto-assignment logic kaam kar raha hai
[ ] Admin manual reassignment kar pa raha hai
[ ] current_stage sahi transitions follow kar raha hai (Parallel ->
    Integration -> Testing -> Admin Review -> Live)
[ ] Notifications sabhi assigned members ko mil rahi hain

===================================================================
9. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 5: Admin Offboarding
Kill-Switch (file name: 05_OFFBOARDING_KILLSWITCH.md) banegi.
Ye module JAAN-BUJH KAR jaldi banaya ja raha hai (sequence me
5th, sabse last nahi) kyunki IP-protection critical hai. Isme
project_members.removed_at, assets table ka ORG-ownership model,
aur 7-step kill-switch sequence (session revoke -> access revoke
-> task reassign -> attribution preserve -> wallet freeze ->
audit log) implement hoga.

===================================================================
END OF FILE 04
===================================================================