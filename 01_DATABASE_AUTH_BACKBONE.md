# STEP 1 — DATABASE + AUTH BACKBONE
# File: 01_DATABASE_AUTH_BACKBONE.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 1 (Foundation) | Priority: CRITICAL | Build Order: #1 of 13

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Ye module poore project ki neev (foundation) hai. Is module ke bina
koi bhi aage ka feature (Idea Engine, Voting, Revenue, Offboarding)
kaam nahi karega.

Is module ka kaam hai:
1. Sabhi users ko database me store karna (Researcher, Developer, Producer, Admin)
2. Login/Signup/Session system banana
3. Role-Based Access Control (RBAC) set karna
4. Baaki sabhi tables (ideas, votes, projects, revenue) ke liye base structure dena

AI INSTRUCTION: Is file ko sabse pehle implement karo. Jab tak ye module
100% complete aur tested na ho, koi bhi doosra module (Idea Engine,
Voting Gate, etc.) start mat karo.

===================================================================
2. USER ROLES (CONFIRMED)
===================================================================

Role            | Count | Sub-roles
----------------|-------|------------------
Researcher      | 4-5   | -
Developer       | 4-5   | Frontend, Backend (mixed)
Producer/Tester | 4-5   | -
Admin           | 1     | Owner (full control)

Rule: Admin role sirf 1 hi hoga poore system me by default (future me
Admin khud aur admin add kar sakta hai, lekin default = 1 Owner).

===================================================================
3. DATABASE SCHEMA — CORE TABLES (STEP 1 SCOPE)
===================================================================

NOTE: Neeche di gayi tables me se sirf users, sessions,
roles_permissions, aur access_log Step 1 me banani hain. Baaki
tables (ideas, votes, projects, revenue_events, etc.) sirf
reference ke liye dikhayi gayi hain taaki AI ko pata rahe ki
future me kya aane wala hai — unhe abhi mat banao.

---------------------------------------------------------------
3.1 TABLE: users  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(100) NOT NULL,
    email             VARCHAR(150) UNIQUE NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    role              VARCHAR(20) NOT NULL CHECK (role IN
                      ('researcher','developer','producer','admin')),
    sub_role          VARCHAR(20) CHECK (sub_role IN
                      ('frontend','backend',NULL)),
    status            VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN
                      ('active','inactive','suspended')),
    rating_avg        DECIMAL(3,2) DEFAULT 0.0,
    idea_quota_used   INT DEFAULT 0,
    quota_reset_date  DATE,
    wallet_balance    DECIMAL(12,2) DEFAULT 0.0,
    profile_photo_url TEXT,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW(),
    deactivated_at    TIMESTAMP NULL
);

---------------------------------------------------------------
3.2 TABLE: sessions  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    token           VARCHAR(500) NOT NULL,
    device_info     VARCHAR(255),
    ip_address      VARCHAR(45),
    created_at      TIMESTAMP DEFAULT NOW(),
    expires_at      TIMESTAMP NOT NULL,
    is_revoked      BOOLEAN DEFAULT FALSE
);

---------------------------------------------------------------
3.3 TABLE: roles_permissions  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE roles_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role            VARCHAR(20) NOT NULL,
    permission_key  VARCHAR(100) NOT NULL,
    allowed         BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(role, permission_key)
);

---------------------------------------------------------------
3.4 TABLE: access_log  (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE access_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    action      VARCHAR(100) NOT NULL,
    resource    VARCHAR(100),
    ip_address  VARCHAR(45),
    timestamp   TIMESTAMP DEFAULT NOW()
);

---------------------------------------------------------------
3.5 FUTURE TABLES (DO NOT BUILD YET — reference only)
---------------------------------------------------------------

ideas, votes, projects, project_members, revenue_events,
revenue_splits, withdrawals, offboarding, assets, notifications

Ye tables Step 2, 4, 5, 6 me banengi. Step 1 me inka zikar sirf is
liye hai taaki users.id ka foreign key design shuru se hi sahi ho.

===================================================================
4. AUTHENTICATION FLOW
===================================================================

---------------------------------------------------------------
4.1 Signup Flow
---------------------------------------------------------------

Admin creates account manually (self-signup allowed only for first user)
  -> Admin adds team members via "Add Member" panel
  -> System generates temporary password + sends invite email
  -> New member logs in -> forced password reset on first login
  -> Role assigned by Admin at creation time (cannot self-select role)

RULE: Normal users (Researcher/Developer/Producer) cannot self-register.
Sirf Admin naye members add kar sakta hai. Ye IP-security ke liye
zaroori hai (taaki koi outsider khud se account na bana sake).

---------------------------------------------------------------
4.2 Login Flow
---------------------------------------------------------------

User enters email + password
  -> Backend verifies password_hash (bcrypt/argon2)
  -> If status = 'inactive' or 'suspended' -> LOGIN BLOCKED
     (error: "Access Revoked")
  -> If valid -> generate JWT token
  -> Create entry in sessions table
  -> Log entry in access_log (action='login')
  -> Return token + role -> Frontend redirects to correct corner panel

---------------------------------------------------------------
4.3 Session Validation (every request)
---------------------------------------------------------------

Request comes in with JWT token
  -> Check token signature valid
  -> Check session.is_revoked = FALSE
  -> Check session.expires_at > NOW()
  -> Check users.status = 'active'
  -> If any check fails -> 401 Unauthorized -> force logout

---------------------------------------------------------------
4.4 Logout / Token Revocation
---------------------------------------------------------------

User clicks logout OR Admin revokes access
  -> sessions.is_revoked = TRUE (for that session or ALL sessions of user)
  -> Log entry in access_log (action='logout' or 'force_revoked')

CRITICAL NOTE (from Okta reference): Jab Admin kisi member ko remove
kare, system ko status = 'inactive' (PATCH-style) use karna hai,
DELETE query se record kabhi mat udao. DELETE sirf raw data corrupt
karega aur attribution (credit) history toot jayegi. Ye rule Step 5
(Offboarding Module) me use hoga, lekin iski neev yahi par
(users.status field) rakhni hai.

===================================================================
5. RBAC — PERMISSION MATRIX (SEED DATA FOR roles_permissions)
===================================================================

permission_key           | researcher | developer | producer | admin
--------------------------|:----------:|:---------:|:--------:|:-----:
idea.submit               | true       | true      | true     | true
idea.vote                 | true       | true      | true     | true
project.view_own          | true       | true      | true     | true
project.view_all          | false      | false     | false    | true
project.launch_approve    | false      | false     | false    | true
member.add                | false      | false     | false    | true
member.remove             | false      | false     | false    | true
payout.approve            | false      | false     | false    | true
revenue.manual_entry      | false      | false     | false    | true
asset.export_download     | false      | false     | false    | true
meeting.host              | true       | true      | true     | true
coworking.join            | true       | true      | true     | true

AI INSTRUCTION: Ye table backend me seed data ki tarah insert karo
(roles_permissions table me). Har API endpoint is table ko check
karke decide karega ki request allow hai ya nahi.

===================================================================
6. API ENDPOINTS (STEP 1 SCOPE)
===================================================================

Method | Endpoint                          | Access         | Purpose
-------|-----------------------------------|----------------|------------------------------
POST   | /api/auth/login                   | Public         | Login + token generate
POST   | /api/auth/logout                  | Authenticated  | Current session revoke
POST   | /api/auth/refresh                 | Authenticated  | Token refresh
POST   | /api/admin/members/add            | Admin only     | New member create
PATCH  | /api/admin/members/:id/status     | Admin only     | Activate/Deactivate (NOT delete)
GET    | /api/users/me                     | Authenticated  | Apni profile fetch
GET    | /api/admin/members                | Admin only     | Sabhi members ki list
PATCH  | /api/users/me/password            | Authenticated  | Password change

===================================================================
7. NON-NEGOTIABLE RULES (carry forward from Master PRD)
===================================================================

1. Koi bhi user khud se signup nahi kar sakta — sirf Admin naye member add karega.
2. Offboarding ke time DELETE query kabhi use mat karo — hamesha status='inactive'.
3. Har login/logout/access event access_log me record hona chahiye.
4. Role assignment sirf Admin kar sakta hai, user khud apna role nahi badal sakta.
5. Password hamesha hashed (bcrypt/argon2) store hoga, plain text kabhi nahi.
6. Session table se multiple device login track hoga (future offboarding
   kill-switch ke liye zaroori).

===================================================================
8. ACCEPTANCE CRITERIA (Step 1 Done kab maana jayega)
===================================================================

[ ] users, sessions, roles_permissions, access_log tables live DB me ban chuki hain
[ ] Admin account seed ho chuka hai (first user)
[ ] Admin "Add Member" se naya user bana sakta hai with role assign
[ ] Login/Logout working + JWT token generate ho raha hai
[ ] Deactivated user login nahi kar pa raha (status check working)
[ ] RBAC permission check kam se kam 2 endpoints par test ho chuka hai
[ ] Access log har login/logout par entry create kar raha hai

===================================================================
9. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 2: Idea + Quota Engine
(file name: 02_IDEA_QUOTA_ENGINE.md) banegi. Usme ideas table aur
quota logic (2 ideas / 7-14 days) implement hoga — jiska foreign
key isi users.id par depend karega.

===================================================================
END OF FILE 01
===================================================================