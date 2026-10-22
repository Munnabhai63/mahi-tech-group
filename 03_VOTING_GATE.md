# STEP 3 — VOTING GATE LOGIC
# File: 03_VOTING_GATE.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 1 (Foundation) | Priority: CRITICAL | Build Order: #3 of 13
# Depends On: 01_DATABASE_AUTH_BACKBONE.md, 02_IDEA_QUOTA_ENGINE.md

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Jab koi idea "PENDING_REVIEW" status me aati hai (Step 2 se), to wo kaam
turant shuru NAHI hoti. Poori team ko us idea par VOTE karna hota hai.
Sirf 70-80% "Green" approval milne par hi idea "APPROVED" hoti hai aur
Step 4 (Parallel Fan-Out) trigger hota hai.

Is module ka kaam hai:
1. Pending idea par automatic Review Meeting schedule karna
2. Sabhi eligible members ko notify karna ki vote karna hai
3. Har member ka vote record karna (score + green/red + comment)
4. Green percentage calculate karna aur final decision lena (Approve/Revise/Reject)
5. Idea owner ko khud apni idea par vote karne se rokna
6. Admin ko veto power dena (chahe percentage kuch bhi ho)

AI INSTRUCTION: Ye module sirf VOTING aur DECISION tak limited hai.
Idea approve hone ke baad project create karna aur team members ko
kaam assign karna Step 4 (04_PARALLEL_FANOUT.md) ka scope hai, is
file ka nahi.

===================================================================
2. VOTING RULES (CONFIRMED BY USER)
===================================================================

- Approval threshold: 70% se 80% ke beech "Green" votes chahiye
  (Admin configurable; default = 70%)
- Idea owner apni khud ki idea par vote NAHI kar sakta
- Eligible voters = total active users - 1 (owner minus kiya gaya)
- Quorum rule: kam se kam 70% eligible voters ko vote karna zaroori hai,
  warna voting window extend hogi
- Har vote me 3 scores hote hain (Feasibility, Market Potential, Team
  Capacity - 0 se 10 scale par) + ek Green/Red flag + optional comment
- Admin ke paas hamesha VETO power hai — chahe percentage kuch bhi aaye,
  Admin final decision override kar sakta hai

===================================================================
3. DATABASE SCHEMA — TABLES FOR STEP 3
===================================================================

---------------------------------------------------------------
3.1 TABLE: votes  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE votes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id             UUID NOT NULL REFERENCES ideas(id),
    voter_id            UUID NOT NULL REFERENCES users(id),
    score_feasibility   INT CHECK (score_feasibility BETWEEN 0 AND 10),
    score_market        INT CHECK (score_market BETWEEN 0 AND 10),
    score_capacity      INT CHECK (score_capacity BETWEEN 0 AND 10),
    vote_color          VARCHAR(10) NOT NULL CHECK (vote_color IN ('green','red')),
    comment             TEXT,
    voted_at            TIMESTAMP DEFAULT NOW(),
    UNIQUE(idea_id, voter_id)
);

NOTE: UNIQUE(idea_id, voter_id) ensure karta hai ki ek user ek idea
par sirf ek baar hi vote kar sake.

---------------------------------------------------------------
3.2 TABLE: review_meetings  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE review_meetings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idea_id         UUID NOT NULL REFERENCES ideas(id),
    scheduled_at    TIMESTAMP NOT NULL,
    voting_window_end TIMESTAMP NOT NULL,
    status          VARCHAR(20) DEFAULT 'SCHEDULED' CHECK (status IN
                    ('SCHEDULED','ONGOING','COMPLETED','EXTENDED')),
    created_at      TIMESTAMP DEFAULT NOW()
);

---------------------------------------------------------------
3.3 UPDATE TO EXISTING TABLE: ideas (from Step 2)
---------------------------------------------------------------

Columns already present from Step 2, ab inka use shuru hoga:

- voting_deadline      -> review_meetings.voting_window_end se set hoga
- green_percentage     -> vote count ke basis par calculate + update hoga
- status               -> PENDING_REVIEW -> APPROVED / REVISE / REJECTED

---------------------------------------------------------------
3.4 ADMIN CONFIG ADDITION (system_config table se)
---------------------------------------------------------------

Seed values add karo:
-- ('vote_approval_threshold', '70')
-- ('vote_quorum_percentage', '70')
-- ('voting_window_hours', '48')

===================================================================
4. VOTING GATE — LOGIC FLOW
===================================================================

---------------------------------------------------------------
4.1 Idea Submit hote hi (Trigger from Step 2)
---------------------------------------------------------------

ideas.status = 'PENDING_REVIEW' hote hi:
  -> System auto-creates row in review_meetings
       scheduled_at = NOW() (ya Admin-defined slot)
       voting_window_end = NOW() + voting_window_hours (default 48 hrs)
  -> ideas.voting_deadline = review_meetings.voting_window_end
  -> Notification bheji jaati hai SABHI active users ko (owner ko chhodkar)
       "New idea pending your vote: [Title] - Vote by [deadline]"

---------------------------------------------------------------
4.2 Vote Cast karte waqt (Check Sequence)
---------------------------------------------------------------

User clicks vote (Green/Red + scores + comment)
  -> Backend checks: voter_id != idea.owner_id (owner block)
  -> Backend checks: NOW() <= ideas.voting_deadline (window still open)
  -> Backend checks: UNIQUE(idea_id, voter_id) - duplicate vote block
  -> IF all pass:
        -> Insert row in votes table
        -> Recalculate green_percentage (see 4.3)
        -> Log in access_log (action='vote_cast')
  -> ELSE: reject with appropriate error message

---------------------------------------------------------------
4.3 Green Percentage Calculation (runs after every vote)
---------------------------------------------------------------

eligible_voters = COUNT(active users) - 1   (owner excluded)
total_votes_cast = COUNT(votes WHERE idea_id = X)
green_votes = COUNT(votes WHERE idea_id = X AND vote_color = 'green')

green_percentage = (green_votes / total_votes_cast) * 100

UPDATE ideas SET green_percentage = [calculated value]

NOTE: Percentage sirf cast hue votes par base hoga (not on total
eligible), lekin FINAL decision sirf voting_deadline cross hone ke
baad ya quorum poora hone ke baad hi liya jayega (Section 4.4).

---------------------------------------------------------------
4.4 Final Decision Logic (runs when window closes OR quorum met early)
---------------------------------------------------------------

Trigger: Scheduled job checks every review_meeting where
         NOW() >= voting_window_end AND status != 'COMPLETED'

Step A - Quorum Check:
  participation_rate = (total_votes_cast / eligible_voters) * 100
  IF participation_rate < vote_quorum_percentage (70%):
       -> review_meetings.status = 'EXTENDED'
       -> voting_window_end += 24 hours (one-time extension)
       -> Notify non-voters: "Your vote is pending, please vote urgently"
       -> STOP (wait for next cycle check)

Step B - Decision (only if quorum met):
  IF green_percentage >= vote_approval_threshold (70-80%):
       -> ideas.status = 'APPROVED'
       -> Trigger Step 4: Parallel Fan-Out Engine
       -> Notify idea owner: "Your idea has been approved!"
  ELSE IF green_percentage >= 50 AND < threshold:
       -> ideas.status = 'REVISE'
       -> Notify owner with all comments: "Revise and resubmit"
  ELSE (green_percentage < 50):
       -> ideas.status = 'REJECTED'
       -> ideas.status eventually set to 'ARCHIVED' after owner views it
       -> Attribution/history permanently retained (for profile stats)

  -> review_meetings.status = 'COMPLETED'

---------------------------------------------------------------
4.5 Admin Veto Power
---------------------------------------------------------------

Admin ke paas special endpoint hai jisse wo kisi bhi stage par
(chahe quorum poora ho ya na ho, chahe percentage kuch bhi ho):
  -> Manually idea.status ko APPROVED / REVISE / REJECTED set kar sakta hai
  -> Reason mandatory field hai jo log hota hai (access_log +
     ideas table me admin_override_reason column, agar add karna ho)
  -> Ye action turant notify hota hai poori team ko: "Admin has
     [approved/rejected] this idea"

===================================================================
5. API ENDPOINTS (STEP 3 SCOPE)
===================================================================

Method | Endpoint                               | Access         | Purpose
-------|-----------------------------------------|----------------|-------------------------------
POST   | /api/ideas/:id/vote                      | Non-owner only | Cast vote (green/red + scores)
GET    | /api/ideas/:id/votes                     | Authenticated  | All votes + current percentage
GET    | /api/ideas/pending-my-vote               | Authenticated  | Ideas awaiting this user's vote
GET    | /api/ideas/:id/meeting                   | Authenticated  | Review meeting details/deadline
PATCH  | /api/admin/ideas/:id/override            | Admin only     | Manual approve/reject/revise
PATCH  | /api/admin/config/voting                 | Admin only     | Threshold/quorum/window change

===================================================================
6. FRONTEND REQUIREMENTS (STEP 3 SCOPE)
===================================================================

- Center Dashboard me "Pending Votes" panel — sabhi non-voted ideas
  ki list jismein har member ko vote karna baaki hai
- Voting Card UI: Title + Description + Attachment preview +
  3 sliders (Feasibility/Market/Capacity 0-10) + Green/Red toggle
  button + Comment box + Submit Vote button
- Live progress bar: "Green: 65% | Votes cast: 9/12 | Deadline: 18hrs left"
- Idea owner ko vote card dikhegi lekin DISABLED state me
  ("You cannot vote on your own idea")
- Admin ko ek extra "Override Decision" button dikhega har pending
  idea par, jisse manual approve/reject/revise ho sake

===================================================================
7. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Idea owner kabhi apni khud ki idea par vote nahi kar sakta
   (backend-enforced, sirf frontend hide se kaam nahi chalega).
2. Approval threshold hamesha system_config se aayega (70-80% range,
   exact value Admin decide karega), hardcoded nahi.
3. Quorum poora hue bina final decision kabhi nahi liya jayega
   (sirf Admin veto ke zariye bypass ho sakta hai).
4. Rejected ideas ka data DELETE nahi hoga — status ARCHIVED rahega,
   taaki owner ki profile stats (total ideas submitted) sahi rahe.
5. Har vote UNIQUE(idea_id, voter_id) constraint se protected hoga —
   double voting kisi bhi tarah possible nahi honi chahiye.
6. Admin veto action hamesha reason ke saath log hona chahiye
   (audit trail ke liye).

===================================================================
8. ACCEPTANCE CRITERIA (Step 3 Done kab maana jayega)
===================================================================

[ ] votes aur review_meetings tables ban chuki hain
[ ] Idea PENDING_REVIEW hote hi review_meeting auto-create ho raha hai
[ ] Non-owner members ko vote notification mil raha hai
[ ] Owner apni idea par vote nahi kar pa raha (backend blocked)
[ ] Green percentage real-time recalculate ho raha hai har vote ke baad
[ ] Quorum incomplete hone par window auto-extend ho raha hai
[ ] Final decision (Approve/Revise/Reject) threshold ke basis par
    automatically lag raha hai jab window close hoti hai
[ ] Admin override endpoint kaam kar raha hai with reason logging
[ ] Approved idea Step 4 trigger ke liye ready signal bhej rahi hai

===================================================================
9. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 4: Parallel Fan-Out Engine
(file name: 04_PARALLEL_FANOUT.md) banegi. Usme projects aur
project_members tables banengi, approved idea se automatically ek
project create hoga, revenue clock start hoga (5-month timer), aur
Researcher/Frontend/Backend/Producer sabko EK SAATH (parallel)
kaam assign hoga — strictly sequential nahi.

===================================================================
END OF FILE 03
===================================================================