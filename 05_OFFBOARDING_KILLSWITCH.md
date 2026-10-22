# STEP 5 — ADMIN OFFBOARDING KILL-SWITCH
# File: 05_OFFBOARDING_KILLSWITCH.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 1-2 (Built EARLY, not last) | Priority: CRITICAL | Build Order: #5 of 13
# Depends On: 01_DATABASE_AUTH_BACKBONE.md, 04_PARALLEL_FANOUT.md

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Ye module poore project ka SABSE CRITICAL IP-PROTECTION feature hai.
User ne clearly bola hai: agar koi team member company chhod de, to
Admin ke paas poora control hona chahiye ki us member ka access
TURANT aur COMPLETELY revoke ho jaye — lekin uska contribution/credit
(attribution) hamesha visible rahe.

Is module ka kaam hai:
1. Admin ko ek single "Remove Member" action dena jo saari services
   se turant access revoke kare
2. Departing member ka koi bhi personal ownership na rahe kisi bhi
   asset (code, PDF, design, domain, listing) par — sab kuch ORG
   entity ke under store hota hai, shuru se hi
3. Attribution/credit history permanently preserve karna
   ("Idea by: [Name] (Former Member)")
4. Active tasks ko "Unassigned" pool me daalna taaki project na ruke
5. Revenue wallet ko freeze karna jab tak Admin manually settle na kare
6. Poori offboarding process ka audit log rakhna (legal protection ke liye)

AI INSTRUCTION: Ye module jaan-bujh kar EARLY (Step 5, sequence me
last nahi) banaya ja raha hai, kyunki IP-leak ka risk har din
badhta hai jaise-jaise team bade projects par kaam karti hai. Is
file ko Step 4 ke turant baad implement karo, Step 6 (Revenue) se
pehle.

===================================================================
2. CORE PRINCIPLE (NON-NEGOTIABLE — carry from Master PRD)
===================================================================

"NOTHING IS PERSONALLY OWNED."

- Koi bhi code repository, PDF research doc, design file, domain,
  app-store listing — ye sab SHURU SE HI "ORG" entity ke naam par
  store honge, kisi individual user account ke naam par nahi.
- Is wajah se jab koi member chala jaye, to transfer karne ki
  zaroorat hi nahi padti — asset pehle se hi company ke paas hai.
- Member sirf CONTRIBUTOR hai, OWNER kabhi nahi (sirf Admin/Org
  owner hai).

===================================================================
3. DATABASE SCHEMA — TABLES FOR STEP 5
===================================================================

---------------------------------------------------------------
3.1 TABLE: offboarding  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE offboarding (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    initiated_by            UUID NOT NULL REFERENCES users(id),
    reason                  TEXT,
    initiated_at            TIMESTAMP DEFAULT NOW(),
    completed_at            TIMESTAMP,
    revoked_services_json   JSONB,
    wallet_frozen_amount    DECIMAL(12,2) DEFAULT 0.0,
    status                  VARCHAR(20) DEFAULT 'IN_PROGRESS' CHECK (status IN
                            ('IN_PROGRESS','COMPLETED','FAILED'))
);

---------------------------------------------------------------
3.2 TABLE: assets  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE assets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id),
    type                VARCHAR(30) CHECK (type IN
                        ('code_repo','pdf_doc','design_file','domain',
                         'app_listing','other')),
    url                 TEXT NOT NULL,
    owner_entity        VARCHAR(20) NOT NULL DEFAULT 'ORG',
    uploaded_by          UUID REFERENCES users(id),
    created_at           TIMESTAMP DEFAULT NOW()
);

NOTE: owner_entity column HAMESHA 'ORG' default hoga. Ye column
kabhi 'USER' ya kisi individual id par set NAHI hogi — chahe
uploaded_by kuch bhi ho. uploaded_by sirf ATTRIBUTION ke liye hai,
OWNERSHIP ke liye nahi.

---------------------------------------------------------------
3.3 UPDATE TO EXISTING TABLE: users (from Step 1)
---------------------------------------------------------------

Already available columns ka use:
  - status -> 'active' se 'inactive' set hoga (DELETE nahi)
  - deactivated_at -> timestamp set hoga offboarding ke time
  - wallet_balance -> freeze flag ke saath lock hoga (Step 6 isse
    interact karega)

---------------------------------------------------------------
3.4 UPDATE TO EXISTING TABLE: project_members (from Step 4)
---------------------------------------------------------------

Already available column ka use:
  - removed_at -> timestamp set hoga jab member offboard ho

---------------------------------------------------------------
3.5 UPDATE TO EXISTING TABLE: sessions (from Step 1)
---------------------------------------------------------------

Already available column ka use:
  - is_revoked -> TRUE set hoga SABHI sessions ke liye (not just one)

===================================================================
4. KILL-SWITCH SEQUENCE (7-STEP PROCESS — EXACT ORDER MANDATORY)
===================================================================

Jab Admin "Remove Member" button click kare (confirmation popup ke
saath: "Are you sure? This action is immediate and irreversible for
access."), backend EXACTLY is order me execute karega:

---------------------------------------------------------------
STEP 1: Invalidate Session Tokens Immediately
---------------------------------------------------------------
  -> UPDATE sessions SET is_revoked = TRUE WHERE user_id = X
     (ALL active sessions, ALL devices)
  -> User agla API call karega to turant 401 milega, chahe wo
     already logged in ho kisi bhi device par

---------------------------------------------------------------
STEP 2: Disable Login
---------------------------------------------------------------
  -> UPDATE users SET status = 'inactive', deactivated_at = NOW()
     WHERE id = X
  -> IMPORTANT: PATCH-style update, DELETE query kabhi nahi
     (Okta reference rule — DELETE se attribution history toot
     jaati hai aur future audits fail ho sakte hain)

---------------------------------------------------------------
STEP 3: Revoke External Service Access
---------------------------------------------------------------
  -> Agar system GitHub/Google Drive/Figma jaise external tools
     se SCIM/OAuth integrated hai, to API call bhejo deprovision
     ke liye (PATCH active=false pattern, as per Okta model)
  -> Agar abhi integration nahi hai, to Admin ko ek MANUAL CHECKLIST
     dikhayi jaye (GitLab Deprovisioner reference ke style me):
       [ ] Remove from GitHub org
       [ ] Remove from Google Drive shared folders
       [ ] Remove from Figma team
       [ ] Reset any shared passwords
       [ ] Remove from Slack/communication channels
  -> revoked_services_json field me ye checklist ka status save
     hoga

---------------------------------------------------------------
STEP 4: Reassign Active Tasks
---------------------------------------------------------------
  -> SELECT all project_tasks WHERE assigned_to = X AND status
     != 'DONE'
  -> SET assigned_to = NULL (status label: "Unassigned")
  -> Notify respective Project's Admin/Team: "Task [Name] needs
     reassignment - previous assignee removed"
  -> project_members row ke liye: SET removed_at = NOW() (row
     delete NAHI hoga, history preserve)

---------------------------------------------------------------
STEP 5: Preserve Attribution
---------------------------------------------------------------
  -> ideas.owner_id, project_tasks history, votes — in sabme
     user_id reference as-is rahega (FOREIGN KEY tootne nahi
     denge, ON DELETE RESTRICT, kabhi CASCADE nahi is case me)
  -> Display logic (frontend): agar linked user.status =
     'inactive', to naam ke saath automatically tag dikhega:
     "Idea by: [Name] (Former Member)"
  -> Ye rule profile stats (ideas submitted, projects built,
     ratings) ko bhi apply hoga — purani history kabhi erase
     nahi hogi

---------------------------------------------------------------
STEP 6: Freeze Revenue Wallet
---------------------------------------------------------------
  -> users.wallet_balance ko FREEZE state me daalo (naya column
     agar chahiye: `wallet_frozen BOOLEAN DEFAULT FALSE` users
     table me add karo, offboarding ke time TRUE set hoga)
  -> Koi bhi naya withdrawal request block ho jayega jab tak
     Admin manually settle na kare (Step 6 ka Revenue Module
     isse directly interact karega)
  -> offboarding.wallet_frozen_amount = users.wallet_balance
     (snapshot le liya jata hai record ke liye)

---------------------------------------------------------------
STEP 7: Write Exit Audit Log
---------------------------------------------------------------
  -> INSERT row in `offboarding` table with:
       user_id, initiated_by (Admin), reason, revoked_services_json,
       wallet_frozen_amount, status='COMPLETED', completed_at=NOW()
  -> INSERT row in `access_log` (action='member_offboarded')
  -> Final confirmation email/notification bheji jaati hai Admin ko:
     "Offboarding complete for [Name]. All access revoked.
     Attribution preserved. Wallet frozen at ₹[amount]."

===================================================================
5. WHAT HAPPENS IF MEMBER TRIES TO ACCESS AFTER OFFBOARDING
===================================================================

  Scenario: Former member tries login
    -> status='inactive' check fails at login -> "Access Revoked" error

  Scenario: Former member had an old valid JWT token (not expired yet)
    -> session.is_revoked = TRUE check fails at EVERY API request
       middleware -> 401 Unauthorized, forced logout

  Scenario: Former member tries to access shared asset link directly
    -> assets.owner_entity = 'ORG' means access control is checked
       against CURRENT active project_members, not against
       uploaded_by -> access denied since removed_at is set

===================================================================
6. API ENDPOINTS (STEP 5 SCOPE)
===================================================================

Method | Endpoint                                     | Access      | Purpose
-------|-------------------------------------------------|-------------|--------------------------------
POST   | /api/admin/members/:id/offboard                  | Admin only  | Trigger full 7-step kill-switch
GET    | /api/admin/offboarding/:id/status                | Admin only  | Offboarding progress/checklist
PATCH  | /api/admin/offboarding/:id/checklist              | Admin only  | Manual checklist item tick
GET    | /api/admin/offboarding/history                    | Admin only  | All past offboarding records
GET    | /api/admin/wallets/frozen                         | Admin only  | List of frozen wallets pending settlement

===================================================================
7. FRONTEND REQUIREMENTS (STEP 5 SCOPE)
===================================================================

- Admin Control Panel me har member ke row ke saath ek red
  "Remove Member" button, click par confirmation modal:
  "This will immediately revoke all access. Attribution will be
  preserved. Continue?"
- Offboarding progress dikhane wala real-time checklist UI
  (7 steps, ek-ek karke green tick hote hue)
- Manual External Service Checklist (Step 3) — Admin ke liye
  interactive checkboxes jo manually tick karne honge agar
  automatic integration nahi hai
- "Former Member" tag automatically dikhega profile cards, idea
  cards, aur project history me jahan bhi us user ka reference ho
- Admin Dashboard me ek "Frozen Wallets" section jahan se manual
  settlement initiate kiya ja sake (Step 6 Revenue Module se linked)

===================================================================
8. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Offboarding me kabhi DELETE query use nahi hogi — hamesha
   status/PATCH-style updates (users, project_members, sessions).
2. Asset ownership hamesha 'ORG' hoga, kabhi individual user ke
   naam par nahi — ye rule Step 4 se hi follow ho raha hai.
3. Attribution kabhi erase nahi hogi — "Former Member" tag ke
   saath hamesha credit dikhega.
4. Kill-switch 7-step sequence EXACT ORDER me chalegi — order
   skip ya badalna allowed nahi (session revoke sabse pehle,
   audit log sabse last).
5. Active tasks turant "Unassigned" honge, kabhi orphan/stuck
   state me nahi rahenge.
6. Wallet freeze automatic hoga, lekin FINAL settlement/payout
   hamesha Admin ka MANUAL decision rahega (full automation nahi).
7. Foreign keys jo user_id reference karte hain (ideas.owner_id,
   votes.voter_id, project_tasks history) par ON DELETE RESTRICT
   lagana hai, CASCADE kabhi nahi — taaki accidental data loss na ho.

===================================================================
9. ACCEPTANCE CRITERIA (Step 5 Done kab maana jayega)
===================================================================

[ ] offboarding aur assets tables ban chuki hain
[ ] Admin "Remove Member" click karte hi 7-step sequence EXACT
    order me execute ho rahi hai
[ ] Removed user turant login nahi kar pa raha (status check)
[ ] Removed user ka purana JWT token bhi reject ho raha hai
    (session revoke check)
[ ] Active tasks automatically "Unassigned" ho rahe hain
[ ] Attribution ("Former Member" tag) sahi dikh raha hai sabhi
    purani ideas/projects me
[ ] Wallet freeze ho raha hai aur naya withdrawal request block
    ho raha hai
[ ] Audit log entry create ho rahi hai har offboarding par
[ ] Manual external-service checklist UI Admin ko dikh raha hai
[ ] Foreign key constraints RESTRICT mode me hain, CASCADE nahi

===================================================================
10. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 6: Revenue Split Engine
(file name: 06_REVENUE_SPLIT_ENGINE.md) banegi. Isme revenue_events,
revenue_splits, aur withdrawals tables banengi. 5-month timer
(Step 4 ke revenue_clock_start se) check hoga: pehle 5 mahine
Owner 50% + Team 50%, uske baad Team 100%. Wallet freeze logic
(is file ka Step 6) directly isi module se interact karega.

===================================================================
END OF FILE 05
===================================================================