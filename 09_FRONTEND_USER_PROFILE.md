# STEP 9 — FRONTEND USER PROFILE PAGE
# File: 09_FRONTEND_USER_PROFILE.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 2 (Frontend) | Priority: MEDIUM-HIGH | Build Order: #9 of 13
# Depends On: 01, 02, 03, 04, 06, 08 (users, ideas, votes, projects, revenue, mini-card)

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Step 8 me har corner panel ke andar ek chhota "Profile Summary
Mini-Card" tha. Is step me uska FULL detailed version banega — ek
dedicated Profile Page jahan user (ya koi aur team member) kisi
bhi member ki COMPLETE history dekh sakta hai.

User ki original requirement thi: "Har user ka profile ho jisme
dikhe - kitni ideas submit ki, kitne projects bane, unki ratings
kya hain, aur kitna revenue kamaya."

Is module ka kaam hai:
1. Full profile page banana (apna + team members ka, view-permission ke hisaab se)
2. Ideas history tab (sabhi submitted ideas + unka status/outcome)
3. Projects history tab (sabhi projects jisme contribute kiya)
4. Ratings breakdown tab (har project ki rating individually)
5. Revenue/Earnings ledger tab (Step 6 ke revenue_splits ka visual view)
6. "Former Member" tag handling (Step 5 offboarding attribution rule)

AI INSTRUCTION: Ye page READ-HEAVY hai, zyada likhne/editing
actions nahi hain (sirf apni profile photo/bio edit kar sakta hai
user). Saara core data Step 1-6 ke backend se already aa raha hai
— is file me sirf AGGREGATION aur DISPLAY logic define ho raha hai.

===================================================================
2. PROFILE PAGE — LAYOUT STRUCTURE
===================================================================

  +----------------------------------------------------+
  |  [Avatar]  Name                                      |
  |            Role: Developer (Backend)                 |
  |            Status: Active  /  (Former Member) tag     |
  |            Rating: 4.6 ★ (based on 12 projects)        |
  +----------------------------------------------------+
  |  Quick Stats Row:                                     |
  |  Ideas Submitted: 8 | Projects Built: 12 |             |
  |  Approval Rate: 62% | Total Earned: ₹45,000             |
  +----------------------------------------------------+
  |  TABS: [ Ideas ] [ Projects ] [ Ratings ] [ Earnings ]  |
  +----------------------------------------------------+
  |         (Tab content area - see Section 3-6)          |
  +----------------------------------------------------+

===================================================================
3. TAB 1 — "IDEAS" (submission history)
===================================================================

Data source: GET /api/users/:id/ideas

Table/List columns:
  - Idea Title
  - Submitted Date
  - Status badge (Draft/Pending/Revise/Approved/Rejected/Archived)
  - Green Percentage (final vote result)
  - Linked Project (if approved -> clickable link to project)

Filter options: Status dropdown, Date range

NOTE: Rejected/Archived ideas bhi hamesha dikhengi yahan (Step 2
rule: "Rejected/Approved dono tarah ki ideas quota me gin chuki
maani jayengi" — isi tarah profile history me bhi PERMANENT rahengi,
delete nahi hogi).

===================================================================
4. TAB 2 — "PROJECTS" (contribution history)
===================================================================

Data source: GET /api/users/:id/projects

Card/List per project:
  - Project Title
  - Role played in that project (researcher/backend_dev/
    frontend_dev/producer/idea_owner)
  - Current stage (from projects.current_stage)
  - Contribution weight (%) - from project_members table
  - Status: Live / In Progress / Archived

Special case: Agar idea_owner tha us project ka, to ek badge
dikhega: "💡 Idea Owner" (extra highlight, kyunki revenue split
alag hota hai pehle 5 mahine ke liye - Step 6 reference)

===================================================================
5. TAB 3 — "RATINGS" (performance breakdown)
===================================================================

Data source: GET /api/users/:id/ratings

NOTE: Rating system ka DETAILED mechanism (kaun rate karta hai,
kab, kitne scale par) is PRD series me STILL PENDING hai — ye
future step me define karna hoga (recommend: ise Step 10 ke baad
ek chhoti "Ratings Engine" addendum file banayein, kyunki abhi
tak sirf users.rating_avg column reference use ho raha hai, poora
mechanism nahi bana).

Jo abhi dikhayenge (available data se):
  - Overall rating_avg (from users table)
  - Per-project rating (if per-project rating data exists future me)
  - Simple star-display UI + numeric breakdown

AI INSTRUCTION: Is tab ko MVP me simplified rakho — sirf
users.rating_avg dikhao abhi. Jab Ratings Engine ki alag PRD
banegi (future addendum), tab per-project detailed breakdown
add hoga.

===================================================================
6. TAB 4 — "EARNINGS" (revenue ledger view)
===================================================================

Data source: GET /api/users/:id/earnings (uses revenue_splits
table from Step 6)

Components:
  - Total Earned (all-time) — big number at top
  - Earnings Timeline Chart (line/bar chart, month-wise)
  - Table: Project | Amount | Rule Applied (Owner-50/Team-50 or
    Team-100) | Date
  - Wallet Balance (current, withdrawable) + "Withdraw" button
    shortcut (links to Step 6 withdrawal flow)
  - If viewing OWN profile: full detail visible
  - If viewing SOMEONE ELSE's profile: Admin sees full detail,
    other roles see ONLY aggregate total (privacy rule — see
    Section 8 below)

===================================================================
7. "FORMER MEMBER" HANDLING (Step 5 integration)
===================================================================

Agar profile ke user.status = 'inactive' (offboarded via Step 5):

  - Header me tag dikhega: "⚠️ Former Member (Left on [date])"
  - Ideas/Projects history SAB KUCH SAME dikhega (attribution
    preserved rule, Step 5 Section 5)
  - "Withdraw" button HIDDEN/DISABLED hoga (wallet frozen, Step 5
    Section 6) with tooltip: "Wallet frozen - contact Admin for settlement"
  - Profile EDIT options (photo/bio) sab disabled honge
  - Is profile ko koi bhi VIEW kar sakta hai (read-only), lekin
    koi interaction possible nahi

===================================================================
8. PRIVACY / VISIBILITY RULES
===================================================================

Viewer Role     | Can view OWN full profile | Can view OTHERS' profile
----------------|---------------------------|---------------------------------
Researcher      | Yes (full)                 | Yes (ideas/projects/rating only,
                |                             | earnings shown as aggregate total only)
Developer       | Yes (full)                 | Same as above
Producer        | Yes (full)                 | Same as above
Admin           | Yes (full)                 | Yes (FULL detail including
                |                             | exact earnings breakdown - per
                |                             | RBAC Step 1, revenue.manual_entry
                |                             | + payout.approve permissions)

RULE: Kisi doosre normal member ki EXACT earnings breakdown
(project-wise amount) PRIVATE rahegi — sirf TOTAL number dikhega.
Sirf Admin ko full financial transparency milegi (jaisa RBAC
matrix Step 1 me define hai).

===================================================================
9. API ENDPOINTS (STEP 9 SCOPE)
===================================================================

Method | Endpoint                              | Access              | Purpose
-------|-------------------------------------------|---------------------|-------------------------------
GET    | /api/users/:id/profile                      | Authenticated        | Full profile header + stats
GET    | /api/users/:id/ideas                         | Authenticated        | Ideas tab data
GET    | /api/users/:id/projects                      | Authenticated        | Projects tab data
GET    | /api/users/:id/ratings                       | Authenticated        | Ratings tab data
GET    | /api/users/:id/earnings                      | Owner or Admin only  | Earnings tab (detailed)
GET    | /api/users/:id/earnings-summary               | Authenticated        | Earnings tab (aggregate only, for non-owner/non-admin viewers)
PATCH  | /api/users/me/profile                         | Owner only           | Edit own photo/bio

===================================================================
10. FRONTEND TECH NOTES
===================================================================

- Tabs component: simple controlled tab-state (no need for heavy
  routing, can be query-param based: ?tab=earnings for deep-linking)
- Earnings chart: Recharts line/bar chart (monthly aggregation of
  revenue_splits.amount grouped by date)
- Lazy-load tabs data (don't fetch all 4 tabs on initial load —
  fetch only active tab, improves performance for large history)

===================================================================
11. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Ideas/Projects history kabhi hide/delete nahi hogi, chahe idea
   reject hui ho ya member offboard ho chuka ho (permanent record).
2. Earnings detailed breakdown sirf OWNER khud ya ADMIN dekh sakta
   hai — baaki sabko sirf aggregate total dikhega (privacy rule).
3. Former Member profile READ-ONLY hoga — koi edit/withdraw action
   possible nahi hoga.
4. Rating tab MVP me simplified (sirf overall avg) rahega jab tak
   dedicated Ratings Engine PRD na bane.

===================================================================
12. ACCEPTANCE CRITERIA (Step 9 Done kab maana jayega)
===================================================================

[ ] Profile page header + quick stats row sahi data dikha raha hai
[ ] Ideas tab sabhi statuses ke saath correct list dikha raha hai
[ ] Projects tab role + contribution weight ke saath dikh raha hai
[ ] Ratings tab overall avg dikha raha hai (simplified MVP version)
[ ] Earnings tab: owner/admin ko full detail, others ko sirf
    aggregate total dikh raha hai
[ ] Former Member tag aur read-only state sahi se apply ho raha hai
[ ] Withdraw button sirf active, non-frozen wallet par visible/enabled hai
[ ] Privacy rules (Section 8) backend par bhi enforce ho rahe hain
    (not just frontend hiding)

===================================================================
13. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 10: Frontend Admin Control
Panel (file name: 10_FRONTEND_ADMIN_PANEL.md) banegi. Ye Step 8 ke
"Admin Quick-Access Corner" ka FULL expanded version hoga — poora
member management (add/remove/offboard), revenue entry + withdrawal
approvals, project final-review, aur system config (quota/voting
threshold settings) sab ek dedicated full-screen Admin view me.

===================================================================
END OF FILE 09
===================================================================