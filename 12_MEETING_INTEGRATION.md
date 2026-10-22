# STEP 12 — MEETING INTEGRATION
# File: 12_MEETING_INTEGRATION.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 4 (Advanced Real-time Features) | Priority: MEDIUM-HIGH | Build Order: #12 of 13
# Depends On: 01 (auth), 03 (voting gate — meeting ties to review meetings), 04 (projects), 07 (notifications)

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

User ki original requirement thi: "Team meeting launch/host karne
ka feature ho, software ke andar se hi." Plus Step 3 (Voting Gate)
me already "review_meetings" table bani thi jisme idea-approval
voting hoti hai — is module ka kaam hai us meeting ko ACTUALLY
LIVE VIDEO/AUDIO session me convert karna, taaki team real-time
baat karke vote kar sake, na ki sirf async UI se.

Is module ka kaam hai:
1. "Host Meeting" feature banana (kisi bhi time, kisi bhi purpose ke liye)
2. Scheduled Review Meetings (Step 3 se auto-linked) ko actual
   video call me convert karna
3. Video/Audio conferencing embed karna (Jitsi ya Daily.co —
   CUSTOM WebRTC बिल्कुल नहीं banana)
4. Voting Panel (Step 3) ko meeting UI ke andar hi embed karna
5. Meeting attendance log rakhna (kaun aaya, kaun nahi — quorum
   check, Step 3 Section 4.4, isse bhi link ho sakta hai)

AI INSTRUCTION: Is file me custom WebRTC infrastructure BILKUL
mat design karo — ye ek solved problem hai jisko khud banane me
mahino lagenge aur quality kabhi third-party jaisi nahi hogi.
Sirf Jitsi Meet (open-source, self-hostable, free) ya Daily.co
(paid API, easier integration) embed karo.

===================================================================
2. BUILD STRATEGY — TOOL CHOICE
===================================================================

Option 1: Jitsi Meet (RECOMMENDED for cost control)
  - Open-source, can self-host OR use meet.jit.si free public instance
  - Embed via Jitsi Meet IFrame API (JS library)
  - No per-minute cost if self-hosted
  - Good for small team size (10-15 people) — no scaling concerns

Option 2: Daily.co (RECOMMENDED for ease + reliability)
  - Simple REST API: create room -> get URL -> embed iframe
  - Built-in recording, screen-share, reliable at scale
  - Pay-per-minute/participant pricing (budget-friendly for 10-15
    person team)

DECISION: Choose Jitsi if budget-sensitive + okay with self-hosting
maintenance. Choose Daily.co if want zero-maintenance + willing to
pay small monthly cost. (Admin/user can decide at implementation time —
both follow the SAME schema/flow below.)

===================================================================
3. DATABASE SCHEMA — TABLES FOR STEP 12
===================================================================

---------------------------------------------------------------
3.1 TABLE: meetings (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE meetings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               VARCHAR(200) NOT NULL,
    meeting_type        VARCHAR(30) DEFAULT 'general' CHECK (meeting_type IN
                        ('general','idea_review','project_sync')),
    linked_idea_id       UUID REFERENCES ideas(id) NULL,
    linked_project_id    UUID REFERENCES projects(id) NULL,
    hosted_by            UUID NOT NULL REFERENCES users(id),
    room_url             TEXT,
    scheduled_at          TIMESTAMP,
    started_at            TIMESTAMP NULL,
    ended_at              TIMESTAMP NULL,
    status                VARCHAR(20) DEFAULT 'SCHEDULED' CHECK (status IN
                          ('SCHEDULED','LIVE','ENDED','CANCELLED')),
    created_at            TIMESTAMP DEFAULT NOW()
);

NOTE: linked_idea_id ye column hi Step 3 ke review_meetings table
ko is naye meetings table se CONNECT karta hai. Recommendation:
review_meetings (Step 3) ko is meetings table ke saath MERGE kar
sakte ho (ek foreign key meeting_id add karke review_meetings me),
ya dono alag rakh sakte ho — jo bhi AI implement kare, consistency
zaroori hai.

---------------------------------------------------------------
3.2 TABLE: meeting_attendance (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE meeting_attendance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id      UUID NOT NULL REFERENCES meetings(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    joined_at       TIMESTAMP,
    left_at         TIMESTAMP NULL
);

NOTE: Ye data Step 3's "Quorum Check" (Section 4.4 of
03_VOTING_GATE.md) ke saath cross-reference ho sakta hai — agar
idea_review meeting hai to attendance data se pata chal sakta hai
kis-kisne actually join kiya, chahe vote alag se cast hua ho.

===================================================================
4. MEETING LIFECYCLE FLOW
===================================================================

---------------------------------------------------------------
4.1 Ad-hoc Meeting (any member can host, general purpose)
---------------------------------------------------------------

User clicks "Host Meeting" (available in Center Dashboard, all
roles can access per RBAC meeting.host=true, Step 1 Section 5)
  -> Form: Title, Invite members (multi-select), Schedule now or later
  -> Backend calls Jitsi/Daily.co API -> creates room -> gets room_url
  -> INSERT row in meetings (status='SCHEDULED' or 'LIVE' if instant)
  -> Notify invited members: "You've been invited to meeting: [Title]"

---------------------------------------------------------------
4.2 Auto-Linked Review Meeting (from Step 3 Voting Gate)
---------------------------------------------------------------

Jab Step 3's review_meetings row create hoti hai (idea submitted
for voting), optionally:
  -> System auto-creates a linked `meetings` row
       meeting_type = 'idea_review'
       linked_idea_id = idea.id
       hosted_by = Admin (default) or idea owner
  -> Room URL generated same way (Jitsi/Daily.co API call)
  -> ALL eligible voters notified with meeting link alongside
     the async voting card (Step 3 notification)

NOTE: Team is NOT forced to use video call for voting (async
voting from Step 3 still works independently) — video meeting is
an OPTIONAL enhancement for richer discussion before voting.

---------------------------------------------------------------
4.3 Joining a Meeting
---------------------------------------------------------------

User clicks "Join" on a meeting notification/card
  -> meetings.status updated to 'LIVE' (if first joiner) +
     started_at = NOW()
  -> INSERT row in meeting_attendance (joined_at=NOW())
  -> Frontend opens Jitsi/Daily.co iframe embed with room_url
  -> If meeting_type='idea_review': Voting Panel (Step 3 component)
     rendered ALONGSIDE the video iframe (split-screen or
     collapsible sidebar) so team can discuss AND vote simultaneously

---------------------------------------------------------------
4.4 Ending a Meeting
---------------------------------------------------------------

  -> Host clicks "End Meeting" OR last participant leaves
  -> UPDATE meeting_attendance SET left_at = NOW() for all active participants
  -> UPDATE meetings SET status='ENDED', ended_at=NOW()
  -> If linked to idea_review: no automatic action on voting (Step
     3's own deadline/quorum logic continues independently)

===================================================================
5. API ENDPOINTS (STEP 12 SCOPE)
===================================================================

Method | Endpoint                               | Access         | Purpose
-------|--------------------------------------------|----------------|--------------------------------
POST   | /api/meetings/create                         | All roles      | Host new ad-hoc meeting
GET    | /api/meetings/upcoming                        | Authenticated  | List of scheduled/live meetings for user
POST   | /api/meetings/:id/join                        | Invited users  | Join + log attendance
POST   | /api/meetings/:id/leave                       | Participant    | Leave + log timestamp
POST   | /api/meetings/:id/end                         | Host or Admin  | End meeting
GET    | /api/meetings/:id/attendance                  | Host or Admin  | Attendance list (for quorum cross-check)

===================================================================
6. FRONTEND REQUIREMENTS (STEP 12 SCOPE)
===================================================================

- "Host Meeting" button on Center Dashboard (Step 7), visible to all roles
- Meeting creation modal: Title, Invite (multi-select from team
  members list), "Start Now" or "Schedule for Later" toggle
- "Upcoming Meetings" widget on Center Dashboard showing scheduled
  meetings with Join buttons (becomes active 5 min before scheduled_at)
- Meeting Room page: embedded Jitsi/Daily.co iframe (full width),
  with collapsible sidebar — IF meeting_type='idea_review', sidebar
  shows the Voting Card component (Step 3) directly inline
- Notification banner (Step 7/8 integration): "Meeting starting now:
  [Title] - Join"

===================================================================
7. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Custom WebRTC infrastructure NEVER to be built — always use
   Jitsi Meet or Daily.co embed (per AI Instruction, Section 1).
2. Meeting room access sirf invited/eligible participants ko
   milega — backend check zaroori (RBAC + invite-list validation).
3. idea_review type meetings video-call OPTIONAL honi chahiye —
   async voting (Step 3) kabhi bhi meeting attendance par
   dependent/blocked nahi honi chahiye.
4. Attendance log kabhi delete nahi hoga — audit/quorum
   cross-reference ke liye permanent record chahiye.
5. Offboarded member (Step 5) ko meeting invite/join access turant
   revoke ho jayega (session invalidation, Step 5 Section 4
   Step 1, isko bhi automatically cover karega).

===================================================================
8. ACCEPTANCE CRITERIA (Step 12 Done kab maana jayega)
===================================================================

[ ] meetings aur meeting_attendance tables ban chuki hain
[ ] "Host Meeting" se koi bhi role naya meeting create kar sakta hai
[ ] Jitsi/Daily.co API se room successfully create ho raha hai
    aur room_url store ho raha hai
[ ] Idea submit hote hi (Step 3 trigger) linked review meeting
    bhi auto-create ho rahi hai with video room
[ ] Join/Leave attendance correctly log ho raha hai
[ ] idea_review meeting me Voting Panel aur video call dono ek
    saath (split-screen) dikh rahe hain
[ ] Host/Admin meeting end kar sakta hai, status sahi update ho raha hai
[ ] Offboarded member meeting join nahi kar pa raha

===================================================================
9. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 13 (FINAL STEP): UI
Polish + Notifications UI + Final QA (file name:
13_UI_POLISH_FINAL_QA.md) banegi. Ye LAST step hai jisme saare
12 modules ko ek COHESIVE, polished product me finalize kiya
jayega — visual design consistency, notification UI refinement,
end-to-end testing checklist, aur launch-readiness review.

===================================================================
END OF FILE 12
===================================================================