# FILE 00-A — REVERSE-ENGINEERING ENFORCEMENT PROTOCOL
# File: 00_REVERSE_ENGINEERING_ENFORCEMENT_PROTOCOL.md
# Type: MASTER GOVERNANCE RULE (MD) — applies to ALL 13 steps + future modules
# Project: Team Collaboration + IP Governance Platform
# Priority: HIGHEST — READ THIS FILE FIRST, BEFORE 01, BEFORE EVERYTHING
# Applies To: Antigravity (or any AI model) working on this project at ANY stage

===================================================================
1. PURPOSE OF THIS FILE
===================================================================

Ye file is poore project ka "CONSTITUTION" hai jab baat competitor-
inspired features ki aati hai. User ne clearly bola hai: "Pehle
reverse engineering se analysis karo, uske baad hi usi output ke
according cheezein build karo. Apni man-marzi se kuch mat badhao."

Is file ka kaam hai: EK HI BAAR ye rule set karna, taaki future me
har naye feature/module ke time user ko baar-baar ye instruction
repeat na karni pade. Ye rule PERMANENT hai, poore project life-
cycle me lagu hoga.

===================================================================
2. THE CORE RULE (NON-NEGOTIABLE — READ CAREFULLY)
===================================================================

Jab bhi AI (Antigravity ya koi bhi model) is project ke liye koi
AISA FEATURE/COMPONENT build kar raha ho jo:
  - Kisi competitor tool (Master Competitor List, 48 sites) se
    "inspired" ho, YA
  - Jiska workflow/logic kisi existing tool jaisa dikhta ho, YA
  - User ne khud bola ho "competitor se achi cheez le lo"

...to AI KABHI BHI apni training knowledge/assumption/creativity
se seedha feature design NAHI karega. 

MANDATORY SEQUENCE (skip karna FORBIDDEN hai):

  STEP A: Pehle REVERSE-ENGINEERING SKILL (Antigravity's existing
          reverse-engineering capability) ka use karke us specific
          competitor tool/flow ka ACTUAL analysis karo
  STEP B: Us analysis ka output STRUCTURED FORMAT me do (State
          Diagram, Trigger-Condition-Action Table, Data Model
          Guess, Gaps vs Our Project, Adaptation Plan) — ye format
          pehle se defined hai (Reverse-Engineering Master Prompt)
  STEP C: Us output ko hamari PROJECT PRD/MD files (01-13 + future)
          ke Non-Negotiable Rules se cross-check karo
  STEP D: Agar conflict ho (competitor pattern vs hamara rule),
          to HAMESHA HAMARA RULE JEETEGA — competitor pattern sirf
          REFERENCE hai, LAW nahi
  STEP E: TABHI jaake actual PRD likhna ya code implement karna
          shuru karo — Step A-D skip karke SEEDHA build karna
          STRICTLY FORBIDDEN hai

===================================================================
3. WHY THIS RULE EXISTS
===================================================================

- User apna product "copy" nahi karna chahta — sirf PROVEN WORKFLOW
  LOGIC seekhna chahta hai aur apne project ke according adapt
  karna chahta hai
- Bina analysis ke AI agar khud se feature "imagine" kar le, to
  wo feature na to competitor-proven hoga, na user ke original
  vision ke saath fit hoga — ye RISK hai jo avoid karna hai
- Reverse-engineering sirf tab meaningful hai jab wo DISCIPLINED
  ho — random guessing nahi

===================================================================
4. REFERENCE MATERIALS THIS PROTOCOL USES
===================================================================

4.1 Master Competitor List (48 sites, 5 categories):
    Category A - Idea Management + Voting (18): IdeaScale,
    Brightidea, HYPE Innovation, Viima, Qmarkets, Wazoku, Ideawake,
    Ideanote, Planview Spigit/IdeaPlace, Canny, UserVoice, Aha!
    Ideas, Sideways 6, ITONICS, Miro (idea mode), Productboard,
    Featurebase, edison365
    Category B - Task/Workflow Automation (12): ClickUp, Jira,
    Monday.com, Asana, Wrike, Trello, Smartsheet, Airtable, Notion,
    Basecamp, Teamwork.com, GoodDay
    Category C - Revenue Split/Payment Gateway (6): Stripe Connect,
    Adyen for Platforms, Mangopay, PayPal Commerce/Braintree,
    Razorpay Route, Tipalti
    Category D - Access Control/Offboarding (6): Okta, Microsoft
    Entra ID, JumpCloud, SailPoint, OneLogin, Rippling IT
    Category E - Co-working/Shared Canvas (6): Miro, FigJam, Mural,
    Lucidspark, Microsoft Whiteboard, Conceptboard
    Category F (NEW - added for AI Integration Module): ClickUp
    Brain, Intercom Fin AI Agent, Notion AI (reference as needed
    for future AI feature analysis)

4.2 Reverse-Engineering Master Prompt (already defined earlier):
    ROLE (Reverse-Engineering & Workflow Analyst, NOT code copier)
    -> TASK (analyze UX flow of [TOOL_NAME] for [FLOW_TO_STUDY])
    -> STRICT BOUNDARIES (no code/UI/branding copying)
    -> OUTPUT FORMAT (State Diagram, Trigger-Condition-Action
       Table, Data Model Guess, Gaps vs Our Project, Adaptation
       Plan) -> CONTEXT (always reference our own PRD files first,
       prioritize OUR rules over competitor logic)

===================================================================
5. STRICT BOUNDARIES (WHAT REVERSE-ENGINEERING IS NOT ALLOWED TO DO)
===================================================================

  ❌ Competitor ka actual code copy karna
  ❌ Competitor ka UI/visual design/branding copy karna
  ❌ Competitor ka feature "as-is" without adaptation le lena
  ❌ Analysis skip karke seedha "main features add kar deta hoon"
     bol dena
  ❌ Ek competitor ka pura product clone karne ki koshish karna
  
  ✅ Sirf WORKFLOW LOGIC, STATE TRANSITIONS, TRIGGER-ACTION PATTERNS
     study karna
  ✅ Us logic ko hamare PROJECT_MEMORY.md ke rules ke saath adapt
     karke naya, apna version banana
  ✅ Gaps identify karna — "ye competitor pattern hamare project
     me kyun fit nahi karega" bhi explicitly likhna

===================================================================
6. WHEN NO MATCHING COMPETITOR EXISTS
===================================================================

Agar AI ko koi naya feature build karna hai aur Master Competitor
List (Section 4.1) me koi relevant match NAHI milta:

  -> AI khud se feature INVENT NAHI karega
  -> AI pehle user/Admin se POOCHEGA: "Is feature ke liye koi
     specific competitor reference chahiye ya main apne judgement
     se design karun (bina kisi tool copy kiye, sirf apne PRD
     rules follow karke)?"
  -> Sirf Admin ki explicit permission ke baad hi AI apne judgement
     se aage badhega

===================================================================
7. MANDATORY OUTPUT TEMPLATE (whenever reverse-engineering is used)
===================================================================

Har baar jab ye protocol trigger ho, AI ko ye template follow
karte hue output dena hoga BEFORE building anything:

  --- REVERSE-ENGINEERING REPORT ---
  Target Competitor: [Name]
  Flow Analyzed: [Specific flow, e.g. "idea voting mechanism"]
  
  1. State Diagram: [states + transitions observed]
  2. Trigger-Condition-Action Table: [structured table]
  3. Data Model Guess: [inferred schema/fields]
  4. Gaps vs Our Project: [where this pattern conflicts with our
     Non-Negotiable Rules, e.g. "Their model allows owner self-
     vote, OUR rule forbids this - Section X of 03_VOTING_GATE.md"]
  5. Adaptation Plan: [exact changes made before using in our PRD]
  --- END REPORT ---

  AI is report ko user ko dikhayega, PHIR implementation/PRD-
  writing shuru karega.

===================================================================
8. NON-NEGOTIABLE RULES (SUMMARY)
===================================================================

1. Reverse-engineering MANDATORY hai jab bhi competitor-inspired
   feature banaya ja raha ho — skip karna allowed nahi.
2. Hamari PRD/PROJECT_MEMORY.md rules HAMESHA competitor pattern se
   upar hain — conflict me hamara rule jeetega.
3. Code/UI/branding copy kabhi nahi, sirf WORKFLOW LOGIC adapt hoga.
4. Agar koi competitor match na mile, AI khud se invent nahi
   karega — Admin se poochega.
5. Har reverse-engineering output Section 7 ke template me
   documented hona chahiye — bina document ke koi feature build
   nahi hoga.
6. Ye protocol FILE 01 se pehle, sabse pehle padhi jaani chahiye —
   isके baad hi 01-13 series aur AI Integration Module shuru honge.

===================================================================
9. NEXT FILE REFERENCE
===================================================================

Is file ke baad -> 00_AI_INTEGRATION_MASTER_MODULE.md padho (jo
isi protocol ko follow karke ClickUp Brain + Intercom Fin AI
Agent se reverse-engineered hai). Uske baad 01_DATABASE_AUTH_
BACKBONE.md se build shuru hoga.

===================================================================
END OF FILE 00-A
===================================================================