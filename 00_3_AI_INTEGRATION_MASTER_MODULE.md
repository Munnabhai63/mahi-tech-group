# FILE 00-B — AI INTEGRATION MASTER MODULE
# File: 00_AI_INTEGRATION_MASTER_MODULE.md
# Type: PRD + Technical MD (Combined)
# Project: Team Collaboration + IP Governance Platform
# Priority: HIGH — Read AFTER 00-A (Reverse-Engineering Protocol), BEFORE 01
# Built Per Protocol: 00_REVERSE_ENGINEERING_ENFORCEMENT_PROTOCOL.md (Section 7 Report below)

===================================================================
0. MANDATORY REVERSE-ENGINEERING REPORT (per 00-A Protocol, Section 7)
===================================================================

--- REVERSE-ENGINEERING REPORT ---
Target Competitors: ClickUp Brain (Category B) + Intercom Fin AI
Agent (NEW Category F reference)

Flow Analyzed: "AI assistance embedded inside a workspace" +
"AI auto-reply with human safety-net"

1. State Diagram (observed pattern):
   Message/Task Created -> AI Drafts Suggestion -> Confidence
   Check -> [High Confidence: Show as ready-to-send draft] OR
   [Low Confidence: Flag for human / Ask-for-input mode] ->
   Human Accepts/Edits/Rejects -> Action Executes (only after
   human action, never before)

2. Trigger-Condition-Action Table (observed):
   Trigger: New comment/task/thread -> Condition: AI available +
   context indexed -> Action: Draft summary/reply/subtask suggestion
   Trigger: AI confidence < threshold -> Condition: escalation rule
   matched -> Action: Route to human, AI pauses
   Trigger: Human sends reply themselves -> Condition: any -> Action:
   AI session ends/stands down for that thread

3. Data Model Guess (inferred):
   ai_suggestion(id, source_type, source_id, suggested_text,
   confidence_score, status[draft/accepted/edited/rejected],
   created_by='AI', reviewed_by, reviewed_at)

4. Gaps vs Our Project:
   - ClickUp Brain/Intercom Fin dono SaaS-scale products hain jo
     AI ko kaafi autonomy dete hain (auto-resolve, auto-close).
     HAMARE project me ye allowed NAHI hai — hamari Non-Negotiable
     Rules (Step 1-13) me kahin bhi AI ko automatic approval/
     payout/offboarding/vote ka adhikaar nahi diya gaya.
   - Intercom Fin "resolves and bills autonomously" — hum is
     autonomy ko REJECT karte hain, hamara team chhota (10-15)
     hai aur IP-sensitive hai, har AI action human-reviewed hona
     chahiye.

5. Adaptation Plan:
   - ClickUp Brain ka "draft + summarize + suggest subtasks"
     pattern LIYA gaya hai (Section 3 neeche)
   - Intercom Fin ka "confidence threshold + shadow mode + human-
     in-the-loop ask-for-input" safety pattern LIYA gaya hai
     (Section 5 neeche) — lekin AUTONOMOUS RESOLUTION/AUTO-SEND
     wala part REJECT kiya gaya hai, humesha human final-approval
     chahiye
--- END REPORT ---

===================================================================
1. PURPOSE OF THIS MODULE
===================================================================

User ki requirement: "Jahan bhi support ho sake, jahan team ka
SMS/message reply ya koi aisi cheez ho jo AI kar sakte hain, wahan
AI ka use karna hai."

Is module ka kaam hai AI ko poore software me "assist everywhere"
mode me embed karna — lekin ek CORE SHART ke saath: **AI sirf
SUGGEST karega, kabhi khud se FINAL ACTION execute nahi karega.**
Har jagah Human-in-the-Loop rahega.

===================================================================
2. CORE PRINCIPLE (NON-NEGOTIABLE — carry forward from Steps 1-13)
===================================================================

"AI SUGGESTS. HUMAN DECIDES."

- AI kabhi bhi: idea approve/reject nahi karega (Step 3 rule
  intact), payout approve nahi karega (Step 6 rule intact),
  member offboard nahi karega (Step 5 rule intact), vote cast
  nahi karega khud se
- AI sirf: draft banayega, summary banayega, suggestion dega —
  INSAAN (jiska role/permission ho) use Accept/Edit/Reject karega
- Ye bilkul Intercom Fin ke "Ask for Input / Shadow Mode" pattern
  jaisa hai, jahan Fin draft tayyar karta hai lekin low-confidence
  ya sensitive cases me human se confirm karwata hai — hum is
  SAFETY pattern ko apnaate hain, lekin Fin ki AUTONOMOUS-SEND
  capability ko reject karte hain

===================================================================
3. AI TOUCHPOINTS — WHERE AI WILL BE INTEGRATED (full list)
===================================================================

---------------------------------------------------------------
3.1 Smart Reply Suggestions (Notifications/Comments/Messages)
---------------------------------------------------------------
Jab koi member ko koi message/comment/notification aata hai jisका
reply dena ho, AI 2-3 suggested replies dikhayega (ClickUp Brain
ke "craft the perfect reply" feature se inspired).
  -> User ek click me select kar sakta hai, ya edit karke bhej
     sakta hai, ya ignore karke khud type kar sakta hai
  -> AI KABHI auto-send nahi karega

---------------------------------------------------------------
3.2 Meeting Summarization + Action Items (Step 12 integration)
---------------------------------------------------------------
Meeting khatam hone ke baad (Step 12's meetings table), AI:
  -> Transcript se summary banayega
  -> Action items extract karega ("Arjun will finish backend by
     Friday")
  -> Center Dashboard par post karega as DRAFT
  -> Admin/Host REVIEW karke "Publish" dabayega tabhi team-wide
     visible hoga

---------------------------------------------------------------
3.3 Research Summarization (Step 4 Researcher task integration)
---------------------------------------------------------------
Jab Researcher PDF/doc upload kare (project_tasks, type=research),
AI turant ek 5-6 line ka summary generate karega taaki Developer
ko poora document padhne ki zaroorat na pade.
  -> Summary "AI Generated - verify before use" tag ke saath
     dikhega, original PDF bhi hamesha available rahega

---------------------------------------------------------------
3.4 Idea Feasibility Pre-Score (Step 3 Voting Gate support, NOT replacement)
---------------------------------------------------------------
Jab idea PENDING_REVIEW ho (Step 3), voting start hone se pehle,
AI ek SUGGESTED feasibility/market score dikhayega voters ko ek
HELPER HINT ke roop me.
  -> CRITICAL RULE: Ye AI score sirf ADVISORY hai — green_percentage
     calculation (Step 3 Section 4.3) me ye KABHI count nahi hoga.
     Final decision 100% HUMAN VOTES se hi aayega, jaisa Step 3
     me already locked hai

---------------------------------------------------------------
3.5 Smart Notification Digest
---------------------------------------------------------------
Individual notifications bhejne ke bajaye (jo spam jaisa lag sakta
hai), AI ek daily/weekly DIGEST compile karega: "Aaj 3 ideas submit
hui, 2 tasks unblock hue, 1 project live hua" — CRITICAL/urgent
notifications (Step 13 Section 3) ab bhi real-time individually
jayengi, sirf NORMAL-priority wale digest me batch honge

---------------------------------------------------------------
3.6 AI Standup Generator
---------------------------------------------------------------
Har din, AI automatically compile karega ki kis member ne kya kaam
kiya (task status changes, comments se) — ClickUp Brain ke
"Automated Standups" feature se inspired.
  -> Har member apna "Aaj maine ye kiya" manually type karne ki
     bajaye AI-generated draft dekh sakta hai, confirm/edit kar
     sakta hai

---------------------------------------------------------------
3.7 Task Auto-Breakdown Suggestion (Step 4 Fan-out support)
---------------------------------------------------------------
Jab idea APPROVED ho (Step 4 trigger), AI initial 4 parallel tasks
(Research/Backend/Frontend/Testing) ke andar SUB-TASKS suggest
karega (ClickUp Brain ke "AI-powered subtask generator" se
inspired).
  -> Assigned member in suggestions ko Accept/Edit/Delete kar
     sakta hai — AI khud se task create/assign FINAL nahi karega
     bina human confirmation ke

===================================================================
4. DATABASE SCHEMA — TABLES FOR THIS MODULE
===================================================================

---------------------------------------------------------------
4.1 TABLE: ai_suggestions (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE ai_suggestions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type         VARCHAR(30) NOT NULL CHECK (source_type IN
                        ('reply','meeting_summary','research_summary',
                         'idea_prescore','notification_digest',
                         'standup','task_breakdown')),
    source_id           UUID,
    target_user_id       UUID REFERENCES users(id),
    suggested_content    TEXT NOT NULL,
    confidence_score     DECIMAL(5,2),
    status               VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN
                        ('DRAFT','ACCEPTED','EDITED','REJECTED')),
    reviewed_by           UUID REFERENCES users(id),
    reviewed_at            TIMESTAMP,
    created_at             TIMESTAMP DEFAULT NOW()
);

---------------------------------------------------------------
4.2 TABLE: ai_config (BUILD NOW)
---------------------------------------------------------------

CREATE TABLE ai_config (
    key             VARCHAR(50) PRIMARY KEY,
    value           VARCHAR(100) NOT NULL,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- Seed values (confidence-threshold pattern, reverse-engineered
-- from Intercom Fin Section 0.5):
-- ('ai_confidence_threshold', '75')
-- ('ai_digest_frequency_hours', '24')
-- ('ai_feature_toggle_smart_reply', 'true')
-- ('ai_feature_toggle_prescore', 'true')
-- ('ai_feature_toggle_standup', 'true')

---------------------------------------------------------------
4.3 TABLE: ai_interaction_log (BUILD NOW — audit trail)
---------------------------------------------------------------

CREATE TABLE ai_interaction_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_id   UUID REFERENCES ai_suggestions(id),
    action           VARCHAR(20) CHECK (action IN
                     ('generated','accepted','edited','rejected')),
    user_id          UUID REFERENCES users(id),
    timestamp        TIMESTAMP DEFAULT NOW()
);

===================================================================
5. CONFIDENCE THRESHOLD + HUMAN-IN-LOOP LOGIC (reverse-engineered
   from Intercom Fin pattern, Section 0 Report)
===================================================================

Jab bhi AI suggestion generate karta hai:

  IF confidence_score >= ai_confidence_threshold (default 75%):
      -> Suggestion "ready" state me dikhta hai, user ek-click
         Accept kar sakta hai
  ELSE (confidence_score < threshold):
      -> Suggestion "needs review" tag ke saath highlighted
         hota hai, user ko EXTRA warning dikhta hai: "AI is not
         confident about this - please review carefully before
         accepting"
      -> Kabhi bhi AUTO-ACCEPT nahi hoga chahe confidence kitna
         bhi high ho — Accept hamesha ek explicit human click hai

NOTE: Humne Intercom Fin ka "autonomous resolve + auto-bill" wala
hissa jaan-bujh kar NAHI liya (Section 0.4 Gap) — hamare chhote,
IP-sensitive team ke liye har AI output par human eyes zaroori hai.

===================================================================
6. API ENDPOINTS (THIS MODULE SCOPE)
===================================================================

Method | Endpoint                                   | Access         | Purpose
-------|-----------------------------------------------|----------------|--------------------------------
POST   | /api/ai/suggest/reply                          | Authenticated  | Generate reply suggestions
POST   | /api/ai/summarize/meeting/:id                   | Authenticated  | Meeting summary generation
POST   | /api/ai/summarize/research/:task_id              | Authenticated  | Research PDF summary
POST   | /api/ai/prescore/idea/:id                        | Authenticated  | Idea feasibility pre-score (advisory only)
GET    | /api/ai/digest/my                                | Authenticated  | Fetch notification digest
POST   | /api/ai/standup/generate                         | Authenticated  | Auto standup draft
POST   | /api/ai/breakdown/task/:id                        | Assigned user  | Subtask breakdown suggestions
PATCH  | /api/ai/suggestions/:id/review                    | Authenticated  | Accept/Edit/Reject an AI suggestion
PATCH  | /api/admin/ai-config                              | Admin only     | Confidence threshold/toggle settings

===================================================================
7. FRONTEND REQUIREMENTS
===================================================================

- Har jagah jahan AI suggestion aaye (reply box, task creation,
  meeting summary, standup), ek consistent "✨ AI Suggested" badge
  + [Accept] [Edit] [Reject] teen buttons hamesha saath dikhenge
- Low-confidence suggestions par ek yellow warning banner:
  "AI is not fully confident - please review"
- Admin Config Panel (Step 10 ka extension) me ek naya "AI
  Settings" tab — confidence threshold slider, feature on/off
  toggles per touchpoint (Section 3 ke 7 touchpoints individually
  enable/disable kar sakte hain)
- Idea Pre-Score (Section 3.4) voting card ke paas ek chhota,
  CLEARLY SEPARATE box me dikhega, kabhi human voting UI ke saath
  mix/confuse nahi hoga

===================================================================
8. NON-NEGOTIABLE RULES (carry forward + new)
===================================================================

1. AI kabhi bhi FINAL ACTION execute nahi karega — idea
   approve/reject, payout approve, member offboard, vote cast —
   ye sab 100% HUMAN-ONLY actions hamesha rahenge (Steps 1-13
   rules intact, is module unhe override nahi karta).
2. Idea Pre-Score (3.4) kabhi green_percentage calculation (Step
   3) me count nahi hoga — sirf advisory display.
3. Har AI suggestion ka accept/edit/reject ai_interaction_log me
   permanently log hoga (audit trail).
4. Low-confidence suggestions explicit warning ke saath dikhengi,
   kabhi silently high-confidence jaisa treat nahi honge.
5. AI feature-wise ON/OFF toggle Admin ke paas hamesha rahega
   (ai_config table) — agar koi touchpoint kaam na kare ya
   bharosemand na lage, Admin use disable kar sakta hai bina
   developer help ke.
6. Future me koi bhi NAYA AI touchpoint add karne se pehle
   00_REVERSE_ENGINEERING_ENFORCEMENT_PROTOCOL.md ka process
   phir se follow hoga — is file me jo 7 touchpoints hain, sirf
   wahi abhi approved hain.

===================================================================
9. ACCEPTANCE CRITERIA
===================================================================

[ ] ai_suggestions, ai_config, ai_interaction_log tables ban
    chuki hain
[ ] Smart Reply suggestions kaam kar rahe hain, user accept/edit/
    reject kar pa raha hai
[ ] Meeting summary draft generate ho raha hai aur publish-gate
    se guzar raha hai
[ ] Research PDF upload hote hi summary generate ho raha hai
[ ] Idea pre-score advisory box dikh raha hai, voting % me count
    NAHI ho raha (verify karke confirm karo)
[ ] Notification digest sahi frequency par generate ho raha hai
[ ] Standup draft auto-generate ho raha hai task-status data se
[ ] Task breakdown suggestions project fan-out ke time aa rahe hain
[ ] Confidence threshold warning sahi se trigger ho raha hai
    low-score suggestions par
[ ] Admin AI Settings se sabhi 7 touchpoints individually
    on/off ho pa rahe hain
[ ] Audit log har AI interaction record kar raha hai

===================================================================
10. NEXT FILE REFERENCE
===================================================================

Is file ke baad -> 01_DATABASE_AUTH_BACKBONE.md se actual build
shuru hoga. Is module (00-B) ko Step 4 (Fan-out), Step 6
(Revenue... NA, AI payout se door rakha gaya), Step 7 (Center
Dashboard - digest widget), aur Step 12 (Meeting - summary) ke
saath INTEGRATE karte waqt dobara reference karna.

===================================================================
END OF FILE 00-B
===================================================================