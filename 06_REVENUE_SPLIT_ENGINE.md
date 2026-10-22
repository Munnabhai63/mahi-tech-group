# STEP 6 — REVENUE SPLIT ENGINE
# File: 06_REVENUE_SPLIT_ENGINE.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 2-3 (Automation -> Monetization) | Priority: CRITICAL | Build Order: #6 of 13
# Depends On: 01_DATABASE_AUTH_BACKBONE.md, 04_PARALLEL_FANOUT.md, 05_OFFBOARDING_KILLSWITCH.md

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Ye module decide karta hai ki jab koi project LIVE ho jaye aur
revenue generate kare, to wo paisa KISKO, KITNA, aur KAB milega.
Plus ye module Admin ko payout par MANUAL CONTROL deta hai —
koi bhi withdrawal automatic nahi hoga.

Is module ka kaam hai:
1. Revenue events record karna (jab bhi project se paisa aaye)
2. 5-month timer check karna aur uske hisaab se split rule apply karna
3. Har user ke wallet me uska share credit karna
4. User ko "Withdraw" request karne dena
5. Admin ko withdrawal manually approve/reject karne dena
6. Payment Gateway ke zariye final payout karna
7. Immutable ledger maintain karna (audit/compliance ke liye)

AI INSTRUCTION: Ye module sirf CALCULATION aur WALLET MANAGEMENT
tak limited hai. Actual payment gateway integration (Stripe
Connect/Razorpay Route jaisa) ek THIRD-PARTY API call hai jo is
file ke Section 6 me define hai — gateway ka poora backend khud
mat banao, sirf unki API use karo.

===================================================================
2. REVENUE SPLIT RULE (CONFIRMED BY USER — NON-NEGOTIABLE)
===================================================================

- Project LIVE hone ke baad PEHLE 5 MAHINE:
     -> Idea Owner ko = 50% revenue
     -> Baaki TEAM (sabhi contributors) ko = 50% revenue (weighted split)

- Project LIVE hone ke 5 MAHINE KE BAAD:
     -> Idea Owner ka special cut KHATAM
     -> 100% revenue poori TEAM me split hoga (owner bhi team ka
        normal member ban jata hai is split ke liye)

- "5 mahine" ki ginti hamesha `projects.revenue_clock_start`
  (Step 4 me set hua) se hogi, revenue event ki date se nahi

===================================================================
3. DATABASE SCHEMA — TABLES FOR STEP 6
===================================================================

---------------------------------------------------------------
3.1 TABLE: revenue_events  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE revenue_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id),
    amount          DECIMAL(12,2) NOT NULL,
    source          VARCHAR(100),
    entered_by       UUID REFERENCES users(id),
    event_date       DATE NOT NULL,
    created_at       TIMESTAMP DEFAULT NOW()
);

NOTE: Revenue entry sirf Admin kar sakta hai (per RBAC matrix,
Step 1 Section 5: revenue.manual_entry = admin only). Future me
agar payment gateway se direct webhook aaye (e.g. app store sale),
to entered_by = 'SYSTEM' ho sakta hai.

---------------------------------------------------------------
3.2 TABLE: revenue_splits  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE revenue_splits (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revenue_event_id    UUID NOT NULL REFERENCES revenue_events(id),
    user_id             UUID NOT NULL REFERENCES users(id),
    amount              DECIMAL(12,2) NOT NULL,
    rule_applied        VARCHAR(30) CHECK (rule_applied IN
                        ('OWNER_50_TEAM_50','TEAM_100')),
    created_at          TIMESTAMP DEFAULT NOW()
);

---------------------------------------------------------------
3.3 TABLE: withdrawals  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE withdrawals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    amount              DECIMAL(12,2) NOT NULL,
    status              VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN
                        ('PENDING','APPROVED','REJECTED','PAID')),
    requested_at         TIMESTAMP DEFAULT NOW(),
    approved_by          UUID REFERENCES users(id),
    approved_at          TIMESTAMP,
    paid_at              TIMESTAMP,
    gateway_txn_id       VARCHAR(150),
    rejection_reason     TEXT
);

---------------------------------------------------------------
3.4 UPDATE TO EXISTING TABLE: users (from Step 1 + Step 5)
---------------------------------------------------------------

Already available columns ka use:
  - wallet_balance    -> revenue_splits se credit hoga
  - wallet_frozen      -> Step 5 se, agar TRUE hai to withdrawal
                          blocked rahega chahe balance ho

===================================================================
4. REVENUE SPLIT LOGIC — STEP BY STEP FLOW
===================================================================

---------------------------------------------------------------
4.1 Revenue Entry (Admin action)
---------------------------------------------------------------

Admin project select karke revenue amount enter karta hai
  -> INSERT row in revenue_events (project_id, amount, source,
     event_date, entered_by=admin)
  -> Trigger Split Calculation (Section 4.2) IMMEDIATELY

---------------------------------------------------------------
4.2 Split Calculation Logic
---------------------------------------------------------------

project = SELECT * FROM projects WHERE id = revenue_event.project_id
months_since_live = DATEDIFF(months, project.revenue_clock_start, NOW())

IF months_since_live < 5:
    rule_applied = 'OWNER_50_TEAM_50'
    owner_share = amount * 0.50
    team_pool   = amount * 0.50

    -> INSERT revenue_splits row for owner_id = project.owner_id,
       amount = owner_share, rule_applied

    -> team_members = SELECT * FROM project_members WHERE
       project_id = X AND removed_at IS NULL
       (NOTE: agar member removed ho chuka hai Step 5 se, to uska
       future revenue split me koi automatic hissa nahi, lekin
       uska PAST frozen wallet balance Step 5 Section 6 ke rules
       se separately handle hoga)

    -> team_pool ko team_members ke beech weighted split karo
       based on contribution_weight column (project_members table,
       Step 4 se). Agar sab weights equal/0 hain, to equal split
       (team_pool / count of members) default hoga.

    -> FOR EACH team member: INSERT revenue_splits row
       (amount = team_pool * (member_weight / total_weight))

ELSE (months_since_live >= 5):
    rule_applied = 'TEAM_100'
    team_pool = amount * 1.00

    -> team_members = SELECT * FROM project_members WHERE
       project_id = X AND removed_at IS NULL
       (owner ab normal team member jaisa treat hota hai, uska
       special 50% cut khatam)

    -> team_pool ko same weighted logic se split karo (jaisa upar hai)
    -> FOR EACH team member: INSERT revenue_splits row

---------------------------------------------------------------
4.3 Wallet Credit (runs after split calculation)
---------------------------------------------------------------

FOR EACH row inserted in revenue_splits:
    UPDATE users SET wallet_balance = wallet_balance + split.amount
    WHERE id = split.user_id

    -> Notify user: "You earned ₹[amount] from project [Title]"

EXCEPTION: Agar user.wallet_frozen = TRUE (offboarded member jo
abhi settlement pending hai), to credit NAHI hoga us user ko —
system instead Admin ko flag karega: "Former member [Name] was
due ₹[amount] from this split — manual settlement required"
(ye amount kahin orphan na ho, isliye ek `pending_settlements`
tracking log rakhna recommended hai, Admin review ke liye).

---------------------------------------------------------------
4.4 Withdrawal Request Flow (User action)
---------------------------------------------------------------

User clicks "Withdraw" on their dashboard, enters amount
  -> Backend checks: user.wallet_frozen = FALSE
  -> Backend checks: requested amount <= user.wallet_balance
  -> IF checks pass:
        INSERT row in withdrawals (status='PENDING')
        Notify Admin: "New withdrawal request from [Name]: ₹[amount]"
  -> ELSE: reject with error ("Insufficient balance" or
     "Wallet frozen, contact Admin")

---------------------------------------------------------------
4.5 Admin Manual Approval Flow (CRITICAL — user explicitly wants
    manual control, NOT full automation)
---------------------------------------------------------------

Admin sees pending withdrawal in Admin Dashboard
  -> Admin reviews amount + user history
  -> Admin clicks APPROVE:
        -> withdrawals.status = 'APPROVED', approved_by, approved_at set
        -> UPDATE users SET wallet_balance -= withdrawal.amount
           (deduct immediately on approval, before actual gateway payout,
           taaki double-withdraw na ho sake)
        -> Trigger Payment Gateway Payout API call (Section 6)
  -> Admin clicks REJECT:
        -> withdrawals.status = 'REJECTED', rejection_reason mandatory
        -> wallet_balance untouched
        -> Notify user with reason

---------------------------------------------------------------
4.6 Payment Gateway Payout (Final Step)
---------------------------------------------------------------

Gateway API call success:
  -> withdrawals.status = 'PAID', paid_at = NOW(),
     gateway_txn_id = [returned transaction id]
  -> Notify user: "₹[amount] has been paid to your account.
     Transaction ID: [id]"

Gateway API call fails:
  -> withdrawals.status reverts logic needed: Admin notified
     "Payout failed for [Name], ₹[amount] - retry or refund to wallet"
  -> Manual Admin decision: retry payout OR refund wallet_balance

===================================================================
5. IMMUTABLE LEDGER PRINCIPLE
===================================================================

- revenue_events, revenue_splits, withdrawals — ye teeno tables
  me kabhi UPDATE/DELETE on historical amount values nahi hoga
  (sirf STATUS fields update honge jaise withdrawals.status)
- Agar koi correction chahiye (galat amount enter ho gaya), to
  NAYI reversing entry banao, purani ko edit mat karo — ye
  accounting/compliance best-practice hai (audit trail ke liye)

===================================================================
6. PAYMENT GATEWAY INTEGRATION NOTE
===================================================================

- Reference stack: Stripe Connect (Separate Charges and Transfers
  model), Razorpay Route (India-specific, recommended for Indian
  team/compliance), PayPal Commerce, Adyen for Platforms
- Pattern to follow: "Hold then Release" — commission/split amount
  calculate karke HOLD karo wallet me, Admin approval ke baad hi
  actual gateway transfer trigger karo (ye bilkul Stripe Connect
  ke delayed-payout pattern jaisa hai)
- India-specific: TDS deduction, invoice generation per payout —
  ye CA (Chartered Accountant) consultation ke baad finalize karna
  hoga, is PRD me sirf placeholder field (`tds_deducted` column
  withdrawals table me add kiya ja sakta hai future me)

===================================================================
7. API ENDPOINTS (STEP 6 SCOPE)
===================================================================

Method | Endpoint                                   | Access        | Purpose
-------|-----------------------------------------------|---------------|--------------------------------
POST   | /api/admin/projects/:id/revenue               | Admin only    | New revenue event entry
GET    | /api/users/me/wallet                           | Authenticated | Wallet balance + split history
GET    | /api/users/me/earnings                         | Authenticated | Full earnings breakdown (per project)
POST   | /api/withdrawals/request                       | Authenticated | New withdrawal request
GET    | /api/admin/withdrawals/pending                 | Admin only    | All pending requests
PATCH  | /api/admin/withdrawals/:id/approve              | Admin only    | Approve + trigger payout
PATCH  | /api/admin/withdrawals/:id/reject               | Admin only    | Reject with reason
GET    | /api/admin/revenue/ledger                       | Admin only    | Full immutable ledger view

===================================================================
8. FRONTEND REQUIREMENTS (STEP 6 SCOPE)
===================================================================

- User Dashboard: "My Wallet" card — current balance, "Withdraw"
  button, past earnings table (project-wise, date-wise)
- Withdraw modal: amount input, bank/UPI details (if not saved),
  Submit -> status "Pending Admin Approval"
- Admin Dashboard: "Pending Withdrawals" table with Approve/Reject
  buttons, amount, user name, requested date
- Admin "Revenue Entry" form: project dropdown, amount, source,
  date -> Submit (auto-triggers split calculation, shows live
  preview: "Owner gets ₹X, Team gets ₹Y split among Z members")
- Project detail page: revenue timeline chart showing total
  earned + split history over 5-month lifecycle

===================================================================
9. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Revenue split rule hamesha 5-month clock (revenue_clock_start)
   se calculate hoga, kisi aur date se nahi.
2. Pehle 5 mahine: Owner 50% / Team 50%. Baad me: Team 100%.
   Ye values HARDCODE ho sakti hain (business rule fixed hai),
   lekin "5 months" duration system_config me rakhna recommended
   hai future flexibility ke liye.
3. Withdrawal kabhi fully-automatic nahi hoga — Admin manual
   approval HAMESHA mandatory hai, chahe amount kitna bhi ho.
4. Frozen wallet (offboarded member) se koi withdrawal possible
   nahi jab tak Admin manually settle na kare.
5. Ledger tables (revenue_events, revenue_splits, withdrawals)
   me historical amount values kabhi edit/delete nahi honge —
   sirf naye correcting entries ya status updates.
6. Wallet balance deduction APPROVAL ke time hoga, gateway payout
   success se pehle hi (double-withdrawal prevention ke liye).

===================================================================
10. ACCEPTANCE CRITERIA (Step 6 Done kab maana jayega)
===================================================================

[ ] revenue_events, revenue_splits, withdrawals tables ban chuki hain
[ ] Admin revenue entry kar sakta hai aur split auto-calculate ho raha hai
[ ] 5-month check sahi se Owner-50/Team-50 vs Team-100 decide kar raha hai
[ ] Weighted split contribution_weight ke basis par sahi distribute ho raha hai
[ ] Wallet balance credit ho raha hai har split ke baad
[ ] Frozen wallet wale user ko credit nahi mil raha (pending settlement flag)
[ ] User withdrawal request kar pa raha hai
[ ] Admin approve/reject kar pa raha hai with reason logging
[ ] Approval par wallet turant deduct ho raha hai (before gateway call)
[ ] Payment gateway API call successfully payout kar raha hai
[ ] Ledger immutable hai — koi bhi historical amount edit nahi ho raha

===================================================================
11. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 7: Frontend Center
Dashboard (file name: 07_FRONTEND_CENTER_DASHBOARD.md) banegi.
Ab tak sab BACKEND modules the (Step 1-6). Step 7 se FRONTEND
build shuru hoga — sabse pehle shared "Center Dashboard" jo
sabhi roles ka real-time status ek jagah dikhata hai (Kanban,
voting panel, notifications feed, active projects overview).

===================================================================
END OF FILE 06
===================================================================