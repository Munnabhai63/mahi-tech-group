# STEP 13 — UI POLISH + NOTIFICATIONS UI + FINAL QA
# File: 13_UI_POLISH_FINAL_QA.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 4 (Final Polish + Launch Readiness) | Priority: HIGH | Build Order: #13 of 13 (FINAL)
# Depends On: ALL previous steps (01 to 12) must be functionally complete before this

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

Ye FINAL step hai. Is module ka kaam naya feature banana NAHI hai
— is module ka kaam hai jo 12 modules already ban chuke hain,
unko ek COHESIVE, POLISHED, PRODUCTION-READY product me finalize
karna.

Is module ka kaam hai:
1. Visual design consistency laana (sabhi 4 corner panels + center
   dashboard + admin panel ek hi design language follow karein)
2. Notification UI ko refine karna (sirf functional nahi, visually
   clear aur non-intrusive banana)
3. End-to-end testing checklist run karna (poora workflow start
   se end tak test karna)
4. Performance optimization pass
5. Launch-readiness review (security, data integrity, access
   control final verification)

AI INSTRUCTION: Is file ko "DONE" mat maano jab tak Section 6
(End-to-End Test Scenarios) ke SABHI scenarios pass na ho jayen.
Ye poore project ka FINAL GATE hai — isके baad product LIVE/MVP-ready
maana jayega.

===================================================================
2. DESIGN SYSTEM CONSISTENCY CHECKLIST
===================================================================

- [ ] Color palette finalize aur sabhi panels me consistent
      (e.g., Green=Approved/Positive, Red=Rejected/Negative,
      Yellow=Pending, Blue=In-Progress — same meaning everywhere)
- [ ] Typography consistent (same font family/sizes across
      Researcher/Developer/Admin/Producer panels)
- [ ] Button styles unified (Primary/Secondary/Danger variants
      same across all 13 modules)
- [ ] Status badges (Draft/Pending/Approved/Rejected/Live/etc.)
      use SAME badge component everywhere (not different styles
      per module)
- [ ] Loading states (skeleton loaders/spinners) consistent
      across all data-fetching components
- [ ] Empty states designed (e.g., "No ideas submitted yet",
      "No pending votes" — not blank screens)
- [ ] Error states designed (API failure, network error — user-
      friendly messages, not raw error codes)
- [ ] Responsive check: 4-corner layout ka behavior on smaller
      screens (tablet) defined — e.g., switches to tab-based
      navigation if screen too small for 4-corner+center layout

===================================================================
3. NOTIFICATION UI — FINAL REFINEMENT
===================================================================

(Builds on raw notification feed from Step 7 Section 3.3)

- [ ] Notification bell icon with unread-count badge, visible on
      ALL screens (corner panels + admin panel + profile page)
- [ ] Notification dropdown/panel: grouped by "Today", "Earlier"
- [ ] Priority-based visual distinction:
        CRITICAL (e.g., "Your idea needs revision", "Withdrawal
        rejected") -> red/orange accent, stays until dismissed
        NORMAL (e.g., "New idea for voting") -> standard styling,
        auto-marks read after viewing
- [ ] Toast/pop-up notifications for REAL-TIME events (WebSocket-
      pushed) — small, auto-dismissing, non-blocking (e.g., "Riya
      just approved your idea" appears bottom-right for 4 seconds)
- [ ] "Mark all as read" option
- [ ] Click-through: every notification navigates directly to the
      relevant screen (idea detail, project task, wallet, etc.)
- [ ] Sound/visual alert option (user-configurable on/off) for
      high-priority events only (avoid notification fatigue)

===================================================================
4. PERFORMANCE OPTIMIZATION CHECKLIST
===================================================================

- [ ] Lazy-loading implemented for Profile Page tabs (Step 9 Section 10)
- [ ] Kanban board (Step 7) paginates or virtualizes if project
      count grows large (don't render 100+ cards unoptimized)
- [ ] WebSocket reconnection logic tested under network interruption
- [ ] Database indexes added on frequently-queried columns:
        ideas.status, ideas.owner_id, votes.idea_id,
        project_tasks.assigned_to, project_tasks.status,
        revenue_splits.user_id, notifications.user_id,
        sessions.user_id, sessions.is_revoked
- [ ] API response caching where safe (e.g., system_config values
      cached with short TTL, invalidated on Admin update)
- [ ] Image/file upload size limits enforced (research PDFs,
      attachments) to prevent storage bloat

===================================================================
5. SECURITY FINAL REVIEW CHECKLIST
===================================================================

- [ ] Every Admin-only endpoint re-verified for backend role check
      (not just frontend route guard) — cross-reference against
      RBAC matrix (Step 1 Section 5)
- [ ] SQL injection / XSS protection verified on all form inputs
      (idea description, comments, meeting titles, etc.)
- [ ] Password hashing verified (bcrypt/argon2, never plain text)
- [ ] JWT token expiry + refresh flow tested
- [ ] Session revocation (Step 5 kill-switch Step 1) tested —
      confirm offboarded user's OLD tokens truly fail on next request
- [ ] File upload validation (type/size checks) to prevent
      malicious file uploads
- [ ] Rate-limiting on sensitive endpoints (login, idea submit,
      vote cast) to prevent abuse/spam
- [ ] HTTPS enforced everywhere (no plain HTTP in production)
- [ ] Audit log (Step 10 Section 10) confirmed append-only, no
      edit/delete possible even by Admin

===================================================================
6. END-TO-END TEST SCENARIOS (MANDATORY — FULL WORKFLOW)
===================================================================

Scenario 1: Full Idea Lifecycle (Happy Path)
  [ ] Researcher submits idea (within quota) -> Pending Review
  [ ] Team members receive notification + vote
  [ ] Green % crosses 70% threshold -> Idea Approved
  [ ] Project auto-created, 4 parallel tasks assigned
  [ ] Researcher uploads research -> Developer gets banner notification
  [ ] Backend + Frontend dev tasks progress, dependency unlocks correctly
  [ ] Producer gets notified when dev task done -> submits test report
  [ ] Admin gets notified -> approves final review -> project goes LIVE
  [ ] Admin enters revenue -> Owner gets 50%, Team gets 50% (verify math)
  [ ] User requests withdrawal -> Admin approves -> payout succeeds

Scenario 2: Idea Rejection Path
  [ ] Idea submitted, team votes, green % below 50% -> Rejected
  [ ] Idea shows in owner's profile as "Rejected" (not deleted)
  [ ] Quota was still consumed despite rejection

Scenario 3: Quota Limit Enforcement
  [ ] User submits max quota ideas (e.g., 2) -> 3rd submission
      blocked by backend (test via direct API call, not just UI)
  [ ] Quota resets correctly after window period

Scenario 4: Offboarding Full Flow
  [ ] Admin removes a member -> all 7 kill-switch steps execute
  [ ] Removed member cannot login
  [ ] Removed member's old session token fails on next API call
  [ ] Removed member's active tasks reassigned to "Unassigned"
  [ ] Removed member's past ideas/projects still show their name
      with "Former Member" tag
  [ ] Removed member's wallet frozen, withdrawal blocked

Scenario 5: Revenue Split Timing
  [ ] Project revenue entered BEFORE 5 months -> Owner 50/Team 50 verified
  [ ] Simulate/test project revenue entered AFTER 5 months ->
      Team 100% verified, owner gets no special cut

Scenario 6: Parallel Fan-Out Verification
  [ ] Confirm all 4 roles (research/backend/frontend/testing)
      tasks are created SIMULTANEOUSLY on approval (not sequentially)
  [ ] Confirm dependent tasks remain BLOCKED until parent task DONE

Scenario 7: Real-Time Sync
  [ ] Open app in 2 browser sessions (different users) -> cast vote
      in one -> confirm green % updates live in the other WITHOUT refresh
  [ ] Submit new idea in one session -> confirm instant notification
      appears in other session

Scenario 8: Meeting + Co-working
  [ ] Host ad-hoc meeting, invite members, confirm video room loads
  [ ] Idea-review meeting auto-links with Voting Panel inline
  [ ] Join co-working room with 2+ users, confirm presence indicators work

===================================================================
7. LAUNCH READINESS SIGN-OFF
===================================================================

Before declaring MVP "LIVE" / ready for the 10-15 person team to
start using it:

- [ ] All 13 PRD modules' Acceptance Criteria are checked off
- [ ] All 8 End-to-End Test Scenarios (Section 6) pass
- [ ] Security checklist (Section 5) fully reviewed
- [ ] Admin has walked through entire Admin Control Panel personally
- [ ] At least one full dry-run with real/test team members completed
- [ ] Backup/database export process confirmed working (disaster
      recovery basic plan in place)
- [ ] IP Assignment Agreement (legal document, OUTSIDE the software,
      per Step 5 Legal Note) signed by all current team members
- [ ] CA/compliance consultation done for TDS/invoicing on payouts
      (per Step 6 Section 6 India-specific note)

===================================================================
8. NON-NEGOTIABLE RULES (final carry-forward — apply to ENTIRE project)
===================================================================

1. Nothing is personally owned — all assets under ORG entity (Step 5).
2. Never use DELETE-only logic for offboarding — always PATCH/status (Step 1, 5).
3. Idea owner never votes on own idea (Step 3).
4. Attribution always preserved post-offboarding (Step 5, 9).
5. Admin manual approval required before any payout (Step 6).
6. If scope is ever unclear during future development, STOP and
   ask Admin/Owner before assuming — never guess on governance,
   revenue, or access-control logic.

===================================================================
9. PROJECT COMPLETION STATEMENT
===================================================================

Is file ke sign-off ke saath, saare 13 build-order steps complete
ho jaate hain:

  01 - Database + Auth Backbone
  02 - Idea + Quota Engine
  03 - Voting Gate Logic
  04 - Parallel Fan-Out Engine
  05 - Admin Offboarding Kill-Switch
  06 - Revenue Split Engine
  07 - Frontend Center Dashboard
  08 - Frontend 4 Role-Based Corner Panels
  09 - Frontend User Profile Page
  10 - Frontend Admin Control Panel
  11 - Co-working Canvas
  12 - Meeting Integration
  13 - UI Polish + Notifications UI + Final QA (THIS FILE)

Project ab MVP-complete maana jayega jab Section 7 (Launch
Readiness Sign-off) ke sabhi checkboxes tick ho jayen.

===================================================================
END OF FILE 13 — FINAL FILE OF THE SERIES
===================================================================