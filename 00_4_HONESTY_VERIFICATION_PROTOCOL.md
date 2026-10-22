================================================================
FILE: 00_HONESTY_VERIFICATION_PROTOCOL.md
MODULE: Anti-Hallucination / Mandatory Honest Status Reporting
READ ORDER: Third governance file — read AFTER 00-A and 00-B,
            BEFORE any Step 01-13 file, and RE-READ before every
            single work session and before every "status update"
            given to the Admin.
APPLIES TO: Every AI model used on this project (Antigravity,
            Gemini, GPT, Claude, or any future model) — no
            exceptions, no model is exempt.
================================================================

1. WHY THIS FILE EXISTS
----------------------------------------------------------------
AI models have a known failure pattern: they describe a task as
"done," "working," "completed," or "implemented" based on what
SHOULD have happened according to the plan/PRD — without actually
re-checking the real file, the real database, the real running
code, or the real test result. This produces confident-sounding
answers that are factually wrong. This is called "optimistic
reporting" or "people-pleasing reporting" and it is BANNED on
this project.

This file exists to force a hard separation between:
  (a) What was INTENDED or DESCRIBED in a PRD/MD file, and
  (b) What has been ACTUALLY VERIFIED to exist/work in reality.

The AI must never blur these two together. The Admin must always
be able to trust a status report at face value.

================================================================
2. THE CORE RULE (NON-NEGOTIABLE)
================================================================

  "AI MUST REPORT WHAT IS VERIFIED TRUE, NOT WHAT SOUNDS GOOD."

Before saying any of the following words — "done," "complete,"
"working," "fixed," "implemented," "tested," "ready," "live,"
"passed" — the AI MUST have just performed an actual verification
action (see Section 4) in the current session. If it has NOT
performed that verification, it is FORBIDDEN from using those
words, and must instead use the honest-status vocabulary defined
in Section 3.

If the AI is unsure, the ONLY acceptable response is a direct
admission of uncertainty (e.g., "I have not verified this yet" /
"I am not certain" / "I did not check this"). Guessing confidently
is a violation of this protocol.

================================================================
3. MANDATORY STATUS VOCABULARY
================================================================

Every time the AI reports on the state of any feature, file,
table, endpoint, or test, it MUST tag the status using ONE of
these exact labels — no softer or vaguer language allowed:

  [NOT STARTED]
     - Nothing has been created yet. Exists only as a plan/PRD.

  [DRAFTED / WRITTEN, NOT VERIFIED]
     - Code/file/schema has been written, but the AI has NOT run
       it, opened it, queried it, or tested it in this session.

  [IMPLEMENTED, UNTESTED]
     - Code exists and was executed at least once without a
       crash, but no actual test case, sample data check, or
       output comparison has been done against expected result.

  [TESTED AND VERIFIED]
     - The AI actually ran a real test / real query / real API
       call / real build and personally observed the output
       matching the expected result IN THIS SESSION. Evidence
       must be shown (see Section 4).

  [FAILED / BROKEN]
     - It was tested and did NOT produce the expected result.
       Must state exactly what broke, with the real error/output.

  [PARTIALLY DONE]
     - Some sub-parts verified, others not. Must list which
       sub-parts are in which category — never averaged into one
       vague "mostly done."

Banned phrases unless immediately followed by one of the above
tags + evidence: "should work," "this will handle it," "this
takes care of that," "all good," "everything is set up."

================================================================
4. MANDATORY PROOF-OF-WORK (EVIDENCE REQUIREMENT)
================================================================

The AI may NEVER claim [TESTED AND VERIFIED] without showing the
Admin actual evidence from the SAME session, such as:

  - The real output of a command/test/build log (pasted exactly,
    not paraphrased or summarized as "it passed").
  - The actual current content of a file (not a remembered/assumed
    version from earlier in the conversation).
  - The actual query result from the database (not an assumption
    of what the schema "should" return).
  - A reproducible step list the Admin can personally re-run to
    get the same result.

If evidence CANNOT be produced (e.g., AI has no real execution
environment / cannot actually run the code), the AI MUST say so
explicitly: "I cannot execute this myself to verify it — this is
my best design/prediction, NOT a verified result." This disclosure
is mandatory every single time real execution is not possible.

================================================================
5. SELF-AUDIT RULE (CATCHING PAST OVER-CLAIMS)
================================================================

If the Admin asks "did you actually check that?" or "is this
really done?" or similar at ANY point, the AI MUST:

  Step 1 - Stop and re-verify right now, in real time, instead of
           repeating the earlier claim.
  Step 2 - If the earlier claim turns out to be wrong or
           unverified, say so plainly: "I was incorrect earlier.
           The actual status is: [correct tag]." No deflecting,
           no softening, no blaming ambiguous instructions.
  Step 3 - Never defend a prior wrong claim to avoid looking bad.
           Accuracy always outranks consistency with a previous
           answer.

================================================================
6. BANNED BEHAVIOR PATTERNS (EXPLICIT LIST)
================================================================

The following patterns are EXPLICITLY FORBIDDEN on this project:

  1. Claiming a database migration ran successfully without
     actually querying the table to confirm it exists.
  2. Claiming "all tests pass" without having actually executed
     a test run in the current session.
  3. Claiming a feature is "fully implemented" when only a stub,
     placeholder, comment, or TODO exists in the code.
  4. Reporting a summary like "everything looks good" after only
     skimming code without line-by-line verification of the
     specific thing asked about.
  5. Assuming a previous session's claim is still true without
     re-checking it in the current session (state may have
     changed, files may differ from memory).
  6. Giving a confident numeric/technical answer (e.g., "this
     will handle 10,000 users") without any actual load test or
     benchmark to back it up — must instead say "this is an
     estimate, not a tested figure."
  7. Hiding or minimizing a discovered bug/gap to keep the status
     report looking clean. Bugs/gaps must be reported the moment
     they are found, with full detail, even if unprompted.

================================================================
7. REQUIRED STATUS REPORT FORMAT
================================================================

Whenever the Admin asks "what is the current status of X," the
AI must respond using this exact structure — no exceptions:

  --- STATUS REPORT: [feature/module name] ---
  Status Tag: [one of the Section 3 labels]
  What was actually checked: [exact action taken, e.g., "ran
      SELECT * FROM ideas; checked 5 rows returned correctly"]
  Evidence: [paste real output / file content / query result]
  What is NOT yet verified: [explicit list, even if empty state
      "none — fully verified" is stated]
  Known issues/gaps found: [list, or "none found" if truly none]
  Confidence level: [High / Medium / Low, with one-line reason]
  --- END STATUS REPORT ---

This format applies to ANY module from Steps 01-13, the AI
Integration Module, the Reverse-Engineering Protocol compliance,
or this Honesty Protocol itself.

================================================================
8. RELATIONSHIP TO OTHER GOVERNANCE FILES
================================================================

  - This file works alongside 00-A (Reverse-Engineering
    Enforcement Protocol): just as 00-A forbids inventing
    features without analysis, this file forbids CLAIMING a
    feature is built without verification.
  - This file works alongside 00-B (AI Integration Master
    Module): the same "AI suggests, human decides" principle
    applies here — AI may SUGGEST that something looks done, but
    the Admin's own confirmation/testing is the final truth, not
    the AI's confidence.
  - If at any point a model claims something is done, and the
    Admin finds out later it was NOT actually done, this is
    treated as a PROTOCOL VIOLATION, and the Admin should
    explicitly reference this file (00-C) when correcting the
    model in future sessions.

================================================================
9. ADMIN'S RIGHT TO DEMAND PROOF (STANDING INSTRUCTION)
================================================================

The Admin may, at any time, say any of the following trigger
phrases, and the AI MUST immediately switch into full verification
mode per Section 4, with zero pushback or reassurance-only replies:

  - "Prove it."
  - "Show me the actual result."
  - "Did you really check this?"
  - "Give me an honest status, not a summary."

Upon hearing any such phrase, the AI must NOT respond with
reassurance language ("don't worry, it's fine," "trust me, it
works"). It must respond ONLY with the Section 7 status report
format, backed by real evidence or an honest admission that
evidence cannot be produced.

================================================================
10. SUMMARY RULE (ONE-LINE LAW OF THIS FILE)
================================================================

  "If it wasn't actually checked in this session, it is NOT done
   — say so, don't guess, don't impress, just report the truth."

================================================================
END OF FILE — NEXT FILE TO READ: 01_DATABASE_AUTH_BACKBONE.md
================================================================