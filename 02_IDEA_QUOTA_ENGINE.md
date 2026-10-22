# STEP 2 — IDEA + QUOTA ENGINE
# File: 02_IDEA_QUOTA_ENGINE.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 1 (Foundation) | Priority: CRITICAL | Build Order: #2 of 13
# Depends On: 01_DATABASE_AUTH_BACKBONE.md (users table must exist first)

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Ye module decide karta hai ki koi bhi team member (Researcher, Developer,
Producer, Admin) KAB aur KITNI ideas submit kar sakta hai. Idea submission
"free-for-all" NAHI hai — har user ka ek time-boxed quota hai.

Is module ka kaam hai:
1. Har user ke liye idea submission quota set karna (e.g., 2 ideas / 7 ya 14 din)
2. Idea ka basic record store karna (title, description, owner, status)
3. Quota exhaust hone par submit button/API ko block karna
4. Quota cycle ko automatically reset karna (fixed window, rolling nahi)

AI INSTRUCTION: Ye module sirf IDEA CREATION aur QUOTA tak limited hai.
Voting logic is file ka part NAHI hai — wo Step 3
(03_VOTING_GATE.md) me banegi. Is file me idea ka status sirf
"DRAFT" aur "PENDING_REVIEW" tak jayega, uske aage ka flow Step 3 handle karega.

===================================================================
2. QUOTA RULES (CONFIRMED BY USER)
===================================================================

- Har user ko ek fixed quota milta hai: default = 2 ideas
- Quota window: 7 din YA 14 din (Admin configure kar sakta hai; default = 7 din)
- Window TYPE: FIXED CYCLE (jaise Mon-Sun), ROLLING window NAHI
  (rolling window se vote overload ho sakta hai, isliye fixed cycle chosen)
- Jab quota khatam ho jaye, user ka "Submit Idea" button disabled ho jayega
  jab tak naya cycle start na ho
- Rejected ya Approved ideas bhi quota count me shaamil rahengi
  (yaani ek submit kiya hua idea chahe reject ho jaye, wo quota se minus ho chuka hai)

===================================================================
3. DATABASE SCHEMA — TABLES FOR STEP 2
===================================================================

---------------------------------------------------------------
3.1 TABLE: ideas  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE ideas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID NOT NULL REFERENCES users(id),
    title               VARCHAR(200) NOT NULL,
    description         TEXT NOT NULL,
    attachment_url      TEXT,
    status              VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                        ('DRAFT','PENDING_REVIEW','REVISE','APPROVED',
                         'REJECTED','ARCHIVED')),
    submitted_at        TIMESTAMP,
    voting_deadline     TIMESTAMP,
    green_percentage    DECIMAL(5,2) DEFAULT 0.0,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

NOTE: voting_deadline aur green_percentage columns yahan reserve kiye gaye
hain kyunki Step 3 (Voting Gate) inhe use karega. Step 2 me inka sirf
default value set hoga, logic Step 3 me likhoge.

---------------------------------------------------------------
3.2 TABLE: idea_quota_log  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE idea_quota_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    idea_id         UUID REFERENCES ideas(id),
    cycle_start     DATE NOT NULL,
    cycle_end       DATE NOT NULL,
    used_count      INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMP DEFAULT NOW()
);

---------------------------------------------------------------
3.3 UPDATE TO EXISTING TABLE: users (from Step 1)
---------------------------------------------------------------

Step 1 me already ye columns add kiye gaye the, ab inka USE shuru hoga:

- idea_quota_used    -> har submission par +1 hoga
- quota_reset_date   -> is date ke baad idea_quota_used = 0 reset hoga

---------------------------------------------------------------
3.4 ADMIN CONFIG TABLE (NEW — BUILD NOW)
---------------------------------------------------------------

CREATE TABLE system_config (
    key             VARCHAR(50) PRIMARY KEY,
    value           VARCHAR(100) NOT NULL,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- Seed values:
-- ('idea_quota_limit', '2')
-- ('idea_quota_window_days', '7')

AI INSTRUCTION: Quota limit aur window hardcode mat karo — hamesha
system_config table se fetch karo, taaki Admin future me value change
kar sake without code change.

===================================================================
4. QUOTA ENGINE — LOGIC FLOW
===================================================================

---------------------------------------------------------------
4.1 Naya Idea Submit karte waqt (Check Sequence)
---------------------------------------------------------------

User clicks "Submit Idea"
  -> Backend fetches system_config (idea_quota_limit, idea_quota_window_days)
  -> Backend checks users.quota_reset_date
       IF quota_reset_date <= TODAY:
           -> Reset users.idea_quota_used = 0
           -> Set new users.quota_reset_date = TODAY + window_days
  -> IF users.idea_quota_used >= idea_quota_limit:
           -> REJECT request (error: "Quota exhausted. Resets on [date]")
  -> ELSE:
           -> Create new row in `ideas` table (status='DRAFT' or 'PENDING_REVIEW')
           -> Insert row in `idea_quota_log`
           -> users.idea_quota_used += 1
           -> Return success

---------------------------------------------------------------
4.2 Quota Reset Job (Scheduled/Cron)
---------------------------------------------------------------

Daily cron job (runs once every 24 hours):
  -> SELECT all users WHERE quota_reset_date <= TODAY
  -> FOR EACH user:
        SET idea_quota_used = 0
        SET quota_reset_date = TODAY + quota_window_days
  -> Log reset action in access_log (action='quota_reset')

NOTE: Ye cron job backup ke taur par hai. Primary check hamesha
real-time (Section 4.1) par hoga, cron sirf housekeeping ke liye hai.

---------------------------------------------------------------
4.3 Idea Draft vs Submit (Two-step ya One-step?)
---------------------------------------------------------------

User ko do options milenge:
  a) "Save as Draft" -> status='DRAFT', QUOTA COUNT NAHI HOGA
  b) "Submit for Review" -> status='PENDING_REVIEW', QUOTA COUNT HOGA,
     submitted_at = NOW(), aur ye Step 3 (Voting Gate) ko trigger karega

RULE: Jab tak user "Submit for Review" nahi dabata, quota consume nahi
hota. Draft me unlimited baar edit kar sakta hai.

===================================================================
5. API ENDPOINTS (STEP 2 SCOPE)
===================================================================

Method | Endpoint                          | Access         | Purpose
-------|-----------------------------------|----------------|-------------------------------
POST   | /api/ideas/draft                  | All roles      | Draft idea create/save
PATCH  | /api/ideas/:id/draft               | Owner only     | Draft edit
POST   | /api/ideas/:id/submit              | Owner only     | Submit for review (quota check)
GET    | /api/ideas/my                      | Authenticated  | Apni submitted ideas list
GET    | /api/ideas/:id                     | Authenticated  | Single idea detail
GET    | /api/users/me/quota-status         | Authenticated  | Remaining quota + reset date
PATCH  | /api/admin/config/quota            | Admin only     | Quota limit/window change

===================================================================
6. FRONTEND REQUIREMENTS (STEP 2 SCOPE)
===================================================================

- Researcher/Developer/Producer/Admin corner panel me ek "Submit New Idea"
  button hamesha visible rahega
- Button ke paas chhota badge/counter dikhega: "Quota: 1/2 used | Resets in 4 days"
- Agar quota khatam -> button disabled + tooltip: "Quota exhausted, resets on [date]"
- Idea submit form fields: Title, Description, Attachment upload (PDF/doc), Save Draft / Submit buttons
- "My Ideas" tab me list dikhegi with status badges (Draft/Pending/Approved/Rejected)

===================================================================
7. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Quota check hamesha backend par hoga, sirf frontend disable kaafi NAHI
   hai (security ke liye — kisi bhi user ko direct API call se bypass
   karne ka chance na mile).
2. Quota window FIXED cycle hoga, rolling nahi (Section 2 rule).
3. Draft ideas quota consume nahi karti, sirf "Submit for Review" karta hai.
4. Quota limit/window values hamesha system_config se aayengi, hardcoded nahi.
5. Rejected/Approved dono tarah ki ideas permanently quota count me gin
   chuki maani jayengi (wapas refund nahi hoga).
6. Idea ka status jab PENDING_REVIEW ho, to turant Step 3 (Voting Gate)
   ko trigger karna hai — is file ka scope sirf yahan tak hai.

===================================================================
8. ACCEPTANCE CRITERIA (Step 2 Done kab maana jayega)
===================================================================

[ ] ideas, idea_quota_log, system_config tables ban chuki hain
[ ] Quota limit/window Admin se configurable hai
[ ] User draft create/edit kar sakta hai bina quota consume kiye
[ ] "Submit for Review" par quota check + increment working hai
[ ] Quota exhaust hone par backend request reject kar raha hai (not just frontend)
[ ] Daily cron job quota reset kar raha hai sahi date par
[ ] Quota status API (remaining count + reset date) kaam kar raha hai
[ ] Frontend par quota badge aur disabled button sahi dikh raha hai

===================================================================
9. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 3: Voting Gate Logic
(file name: 03_VOTING_GATE.md) banegi. Usme votes table aur
green_percentage calculation, 70-80% approval threshold, aur
idea status transition (PENDING_REVIEW -> APPROVED/REVISE/REJECTED)
implement hoga — jo isi ideas table ko update karega.

===================================================================
END OF FILE 02
===================================================================