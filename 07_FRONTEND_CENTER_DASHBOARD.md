# STEP 7 — FRONTEND CENTER DASHBOARD
# File: 07_FRONTEND_CENTER_DASHBOARD.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 2 (Frontend Begins) | Priority: HIGH | Build Order: #7 of 13
# Depends On: 01 to 06 (all backend modules must be live/tested before this)

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Ab tak (Step 1-6) sirf BACKEND bana hai. Is step se FRONTEND build
shuru hota hai. Sabse pehle "Center Dashboard" banega — ye wahi
screen hai jo user ne shuru me describe ki thi: 4-corner layout ke
BEECH me ek SHARED LIVE PANEL jo poori team ko real-time status
dikhata hai.

Is module ka kaam hai:
1. Ek central, shared, LIVE-updating dashboard screen banana
2. Sabhi active projects ka Kanban-style view dikhana
3. Pending votes/ideas ka live feed dikhana
4. Notifications feed ek jagah centralize karna
5. Real-time updates (WebSocket) implement karna taaki kisi ko
   refresh na karna pade

AI INSTRUCTION: Ye sirf CENTER panel hai. 4 corner role-panels
(Researcher/Developer/Producer/Admin) Step 8 me alag se banenge.
Is file ka scope sirf wo screen hai jo SABKO EK SAATH dikhti hai
(shared/common view), individual role-specific views nahi.

===================================================================
2. UI LAYOUT CONCEPT (confirmed by user earlier)
===================================================================

Full Screen Layout:

  +-------------------+-------------------+
  |   RESEARCHER       |     DEVELOPER      |
  |   (Top-Left)       |     (Top-Right)    |
  +-------------------+-------------------+
  |                                         |
  |        CENTER DASHBOARD (THIS FILE)     |
  |     Shared Live Panel - all roles see   |
  |              this same screen           |
  |                                         |
  +-------------------+-------------------+
  |   ADMIN            |     PRODUCER       |
  |   (Bottom-Left)     |     (Bottom-Right) |
  +-------------------+-------------------+

NOTE: Center Dashboard screen size/position flexible rakho
(expandable/collapsible panel ya separate full-screen tab bhi ho
sakta hai) — important ye hai ki DATA sabke liye same/live ho,
exact pixel layout baad me UI-polish (Step 13) me refine hoga.

===================================================================
3. CENTER DASHBOARD — COMPONENTS (BUILD LIST)
===================================================================

---------------------------------------------------------------
3.1 Component: Active Projects Kanban Board
---------------------------------------------------------------

Data source: GET /api/admin/projects/all (ya role-filtered version
GET /api/projects/my for non-admin users showing only their projects)

Columns (from Step 4, projects.current_stage):
  - Research/Dev Parallel
  - Integration
  - Testing
  - Admin Review
  - Live

Each card shows:
  - Project title
  - Idea owner avatar + name
  - All assigned member avatars (parallel contributors)
  - Progress indicator (tasks done / total tasks)
  - Stage badge with color coding

Interaction: Click card -> opens Project Detail Modal/Page
(task list, dependency status, revenue timeline if Admin)

---------------------------------------------------------------
3.2 Component: Pending Votes / Ideas Feed
---------------------------------------------------------------

Data source: GET /api/ideas/pending-my-vote (Step 3)

Shows:
  - List of ideas currently in PENDING_REVIEW
  - Title, submitted by, time remaining on voting_deadline
  - Live green_percentage progress bar
  - "Vote Now" button (opens Voting Card modal from Step 3)

Real-time behavior: Jaise hi koi vote cast hota hai (kisi bhi user
se), is feed ka green_percentage LIVE update hona chahiye bina
page refresh ke (WebSocket push).

---------------------------------------------------------------
3.3 Component: Notification Feed (Live)
---------------------------------------------------------------

Data source: GET /api/notifications/my + WebSocket subscription

Shows chronological list:
  - "Research uploaded for [Project] - Dev can start"
  - "Your idea [Title] was approved!"
  - "New withdrawal request pending" (Admin only)
  - "You earned ₹[amount] from [Project]"
  - "Task [Name] is now unblocked"

Each notification: icon (by event_type), timestamp, read/unread
dot indicator, click -> navigates to relevant screen

---------------------------------------------------------------
3.4 Component: Team Activity Ticker (optional but recommended)
---------------------------------------------------------------

Ek chhoti scrolling strip (jaise stock-ticker) jo recent actions
dikhaye real-time: "Riya submitted new idea", "Arjun completed
Backend task", "Priya cast a vote" — ye team ko "sab kuch live
chal raha hai" ka feel deta hai, co-presence awareness ke liye
(Miro/FigJam jaisa presence-indicator pattern, reference se liya)

---------------------------------------------------------------
3.5 Component: Quick Stats Bar (Top of Center Dashboard)
---------------------------------------------------------------

Small stat cards:
  - Active Projects count
  - Pending Votes count
  - My Quota Remaining (per logged-in user)
  - Team members online (presence indicator)

===================================================================
4. REAL-TIME ARCHITECTURE (WebSocket Design)
===================================================================

---------------------------------------------------------------
4.1 Connection Setup
---------------------------------------------------------------

On login success:
  -> Frontend opens WebSocket connection to server
     (e.g., wss://yourapp.com/ws?token=[JWT])
  -> Server validates token, subscribes client to relevant channels:
       - "org:global" (all org-wide events - new ideas, votes, projects)
       - "user:{user_id}" (personal notifications)
       - "project:{project_id}" (for each project user is part of)

---------------------------------------------------------------
4.2 Event Types Pushed Over WebSocket
---------------------------------------------------------------

Event Type              | Triggers From          | Who Receives
-------------------------|------------------------|---------------------
idea.submitted            | Step 2 (Idea Engine)   | org:global
vote.cast                 | Step 3 (Voting Gate)   | org:global (for % update)
idea.approved              | Step 3                 | org:global + owner
task.unblocked             | Step 4 (Fan-out)       | user:{assigned_to}
project.stage_changed      | Step 4                 | project:{id}
revenue.credited           | Step 6                 | user:{id}
member.offboarded          | Step 5                 | org:global (Admin view)

---------------------------------------------------------------
4.3 Backend Technology Recommendation
---------------------------------------------------------------

- WebSocket server: Socket.IO ya native WS with Redis Pub/Sub
  adapter (taaki multiple backend server instances ke beech bhi
  events sync ho sakein — Miro/FigJam jaisa Redis pub/sub pattern,
  reference se liya)
- Fallback: Agar WebSocket fail ho (firewall issues), to polling
  fallback (every 10-15 sec GET /api/notifications/my) hona chahiye

===================================================================
5. API ENDPOINTS (STEP 7 SCOPE — mostly reused from earlier steps)
===================================================================

Method | Endpoint                          | Access         | Purpose
-------|-----------------------------------|----------------|-------------------------------
GET    | /api/dashboard/summary             | Authenticated  | Quick stats bar data (single call)
GET    | /api/notifications/my              | Authenticated  | Notification feed list
PATCH  | /api/notifications/:id/read         | Authenticated  | Mark notification as read
WS     | /ws?token=                          | Authenticated  | WebSocket live connection
GET    | /api/activity/recent                | Authenticated  | Team Activity Ticker feed

NOTE: notifications table already defined in Master Schema
(Step 1 reference list) — is step me ise ACTIVELY build karo:

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    event_type      VARCHAR(50) NOT NULL,
    message         TEXT NOT NULL,
    link            TEXT,
    read_status     BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT NOW()
);

===================================================================
6. FRONTEND TECH STACK RECOMMENDATION
===================================================================

- Framework: React (ya Next.js agar SSR chahiye) — component-based,
  real-time state management ke liye best suited
- State management: Redux Toolkit ya Zustand (WebSocket events se
  aane wale live updates ko global state me reflect karne ke liye)
- UI Kit: TailwindCSS + shadcn/ui ya Material UI (fast build ke liye)
- Kanban board: dnd-kit ya react-beautiful-dnd library use karo
  (drag-drop future me Admin reassignment ke liye bhi kaam aayega)
- Charts (revenue timeline, stats): Recharts ya Chart.js

===================================================================
7. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Center Dashboard ka data HAMESHA live/real-time hona chahiye —
   koi bhi manual refresh pe depend NAHI karega critical info ke liye.
2. Har role (Researcher/Developer/Producer/Admin) isi EK dashboard
   ko dekhega — alag-alag versions nahi banenge (sirf permission-based
   data filtering hogi, e.g. Admin sabhi projects dekhega, baaki
   apne assigned projects).
3. WebSocket disconnect hone par automatic reconnect + fallback
   polling implement karna mandatory hai (production reliability).
4. Notification read/unread status backend me persist honi chahiye,
   sirf frontend state me nahi (taaki dusre device par bhi sahi state dikhe).

===================================================================
8. ACCEPTANCE CRITERIA (Step 7 Done kab maana jayega)
===================================================================

[ ] notifications table ban chuki hai aur populate ho rahi hai
[ ] Center Dashboard screen load hoti hai with Kanban + Votes Feed +
    Notifications + Stats Bar
[ ] WebSocket connection successfully establish ho raha hai login ke baad
[ ] Vote cast karte hi green_percentage LIVE update ho raha hai
    bina refresh ke (kam se kam 2 browser tabs me test karke verify karo)
[ ] Naya idea submit hote hi sabhi online users ko real-time
    notification mil rahi hai
[ ] Task unblock hone par assigned user ko turant notification
    mil rahi hai
[ ] WebSocket disconnect/reconnect gracefully handle ho raha hai
[ ] Role-based data filtering sahi kaam kar rahi hai (Admin vs non-Admin view)

===================================================================
9. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 8: Frontend 4 Role-Based
Corner Panels (file name: 08_FRONTEND_CORNER_PANELS.md) banegi.
Isme Researcher, Developer, Producer, aur Admin ke individual
corner-screens banenge — jisme har role ka apna specific workspace
hoga (idea submit form, my tasks list, upload panel, etc.) jo
is Center Dashboard ke CHAARON corners me fit honge.

===================================================================
END OF FILE 07
===================================================================