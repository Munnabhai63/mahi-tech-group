# STEP 11 — CO-WORKING CANVAS (SHARED LIVE WORKSPACE)
# File: 11_COWORKING_CANVAS.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Build Phase: Phase 4 (Advanced Real-time Features) | Priority: MEDIUM (MVP-optional) | Build Order: #11 of 13
# Depends On: 01 (auth/sessions), 04 (projects), 07 (WebSocket infra from Center Dashboard)

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

User ki original requirement thi: "Researcher, Developer, Producer
sab ek saath, ek hi shared window/session me milkar kaam kar sakein"
— ye module WAHI "Co-working Room" feature implement karta hai.

Is module ka kaam hai:
1. Ek persistent shared canvas/room banana (jaisa Miro/FigJam)
2. Multiple users ko SAME session me real-time collaborate karne dena
3. Live cursor/presence tracking (kaun kahan kaam kar raha hai)
4. Conflict-free simultaneous editing (CRDT/OT based)
5. Project ke saath canvas ko link karna (har project ka apna room)

AI INSTRUCTION: Ye module JAAN-BUJH KAR sequence me 11th (late)
rakha gaya hai kyunki:
  - Ye MVP ke liye sabse KAM critical hai (core workflow iske bina
    bhi chal sakta hai)
  - Ye SABSE ZYADA engineering-complex hai (custom WebRTC/CRDT
    banana mushkil hai)
  - RECOMMENDATION: Shuru me CUSTOM build mat karo — third-party
    embed use karo (Section 3), phase 2 me custom feature add karo
    agar zaroorat ho

===================================================================
2. BUILD STRATEGY — TWO OPTIONS (CHOOSE ONE FOR MVP)
===================================================================

---------------------------------------------------------------
OPTION A (RECOMMENDED FOR MVP): Embed Existing Tool
---------------------------------------------------------------

- Use Miro / FigJam / Conceptboard SDK/Embed API directly inside
  an iframe within your app
- Each project gets an auto-created board via their API
  (e.g., Miro's REST API: POST /boards -> returns board_id)
- Your app just stores `coworking_board_url` per project and
  embeds it in an iframe when "Join Co-working Room" is clicked
- PROS: Zero WebSocket/CRDT engineering needed, production-ready,
  battle-tested
- CONS: Dependent on third-party service, may have monthly cost
  per active board/user

---------------------------------------------------------------
OPTION B (CUSTOM BUILD — only if Option A is rejected): Build In-House
---------------------------------------------------------------

Required architecture (reverse-engineered from Miro/FigJam pattern):
  1. WebSocket server (reuse Step 7's infra) with dedicated
     "canvas:{project_id}" channel
  2. CRDT library (e.g., Yjs or Automerge) for conflict-free
     simultaneous editing — multiple users editing same canvas
     object without overwriting each other
  3. Redis Pub/Sub to sync canvas state across multiple backend
     server instances (if horizontally scaled)
  4. Presence/cursor tracking: each client broadcasts its cursor
     position every ~100ms over WebSocket, other clients render
     it as a colored cursor with user's name label
  5. Canvas rendering: HTML5 Canvas or SVG-based library
     (e.g., tldraw, Excalidraw open-source — these already have
     Yjs integration built-in, highly recommended as a base)

RECOMMENDATION: If building custom, use an OPEN-SOURCE base like
"tldraw" or "Excalidraw" (both have real-time collaboration
plugins already built with Yjs) instead of starting from zero.

===================================================================
3. DATABASE SCHEMA — TABLES FOR STEP 11
===================================================================

---------------------------------------------------------------
3.1 TABLE: coworking_rooms (BUILD NOW — works for both Option A/B)
---------------------------------------------------------------

CREATE TABLE coworking_rooms (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id),
    room_type           VARCHAR(20) DEFAULT 'embedded' CHECK (room_type IN
                        ('embedded','custom')),
    external_board_url  TEXT,
    canvas_state_json   JSONB,
    created_at          TIMESTAMP DEFAULT NOW(),
    last_active_at      TIMESTAMP DEFAULT NOW()
);

NOTE: Agar Option A (embed) use kar rahe ho, to external_board_url
me third-party board link store hoga. Agar Option B (custom), to
canvas_state_json me periodic snapshots save honge (CRDT state
backup ke liye, taaki server restart par data na khoye).

---------------------------------------------------------------
3.2 TABLE: room_participants (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE room_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         UUID NOT NULL REFERENCES coworking_rooms(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    joined_at       TIMESTAMP DEFAULT NOW(),
    left_at         TIMESTAMP NULL
);

NOTE: Ye table presence tracking aur "who worked on this project's
canvas" attribution ke liye useful hai (Step 5 offboarding attribution
principle isse bhi apply hoga agar future me canvas-contribution
credit dikhana ho).

===================================================================
4. ROOM LIFECYCLE FLOW
===================================================================

---------------------------------------------------------------
4.1 Room Creation (Auto, tied to Project)
---------------------------------------------------------------

Jab project create hota hai (Step 4, idea approved), optionally:
  -> Auto-create coworking_room row (room_type based on Admin's
     chosen strategy from Section 2)
  -> If Option A: call third-party API to create board, store
     external_board_url
  -> If Option B: initialize empty canvas_state_json

---------------------------------------------------------------
4.2 Joining a Room
---------------------------------------------------------------

User clicks "Join Co-working Room" (from Project Detail page or
Center Dashboard project card)
  -> INSERT row in room_participants (joined_at=NOW())
  -> If Option A: render iframe with external_board_url
  -> If Option B: open WebSocket connection to "canvas:{project_id}"
     channel, render canvas component, broadcast "user joined"
     presence event to other connected clients

---------------------------------------------------------------
4.3 Live Presence Indicators
---------------------------------------------------------------

  -> Each connected user's avatar shown in a "Who's here" bar at
     top of canvas (e.g., "Riya, Arjun, Priya are in this room")
  -> Live colored cursors with name labels (Option B only — Option
     A's embedded tool handles this natively)

---------------------------------------------------------------
4.4 Leaving a Room
---------------------------------------------------------------

  -> UPDATE room_participants SET left_at = NOW()
  -> Broadcast "user left" presence event
  -> If Option B: periodically save canvas_state_json snapshot
     (every few minutes or on last-user-leaves event)

===================================================================
5. API ENDPOINTS (STEP 11 SCOPE)
===================================================================

Method | Endpoint                                | Access              | Purpose
-------|---------------------------------------------|---------------------|--------------------------------
POST   | /api/projects/:id/coworking-room/create       | System (auto) / Admin | Room creation
GET    | /api/projects/:id/coworking-room               | Project members      | Fetch room details/URL
POST   | /api/coworking-rooms/:id/join                  | Project members      | Join + log participant
POST   | /api/coworking-rooms/:id/leave                 | Project members      | Leave + log timestamp
WS     | /ws/canvas/:project_id                          | Project members      | (Option B only) real-time canvas sync

===================================================================
6. FRONTEND REQUIREMENTS (STEP 11 SCOPE)
===================================================================

- "Join Co-working Room" button on Project Detail page (visible to
  all project_members of that project, not to outsiders)
- If Option A: full-screen iframe modal/page with embedded tool
- If Option B: custom canvas component (based on tldraw/Excalidraw)
  with: toolbar (shapes, text, sticky notes, pen), "Who's here" avatar
  bar, live cursors
- "Exit Room" button, confirmation if unsaved changes (Option B)

===================================================================
7. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. Sirf us project ke assigned project_members hi room join kar
   sakte hain — RBAC check zaroori (backend-enforced, not just
   frontend hide).
2. Option A ya B — jo bhi choose karo, canvas content hamesha
   project ke saath linked rahega, kisi individual account ke
   saath nahi (ORG-ownership principle, Step 5 Section 2 se consistent).
3. Room offboarded member ke liye turant inaccessible ho jayega
   (Step 5 kill-switch ka Section 3 "Revoke External Service
   Access" isko bhi cover karega agar Option A third-party embed
   use ho raha hai).
4. Agar Option B custom build karte ho, to periodic state snapshot
   MANDATORY hai — data loss acceptable nahi hai server crash/restart par.

===================================================================
8. ACCEPTANCE CRITERIA (Step 11 Done kab maana jayega)
===================================================================

[ ] coworking_rooms aur room_participants tables ban chuki hain
[ ] Project create hote hi (ya Admin trigger se) room auto-create ho raha hai
[ ] Multiple users same room me simultaneously join kar sakte hain
[ ] Presence bar sahi se dikha raha hai kaun-kaun room me hai
[ ] (Option B only) Live cursors aur simultaneous editing bina
    conflict ke kaam kar raha hai
[ ] Offboarded member room access nahi kar pa raha
[ ] (Option B only) Canvas state snapshot periodically save ho raha hai

===================================================================
9. NEXT STEP REFERENCE
===================================================================

Is file ke complete hone ke baad -> STEP 12: Meeting Integration
(file name: 12_MEETING_INTEGRATION.md) banegi. Isme "Host Meeting"
feature banega (Jitsi/Daily.co embed recommended, custom WebRTC
NAHI banana), jisme Voting Panel (Step 3) bhi directly meeting
UI ke andar embed hoga taaki team review meetings isi software
se ho sakein.

===================================================================
END OF FILE 11
===================================================================