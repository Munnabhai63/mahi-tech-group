# PRD 29 — UI Polish & Full Frontend-Backend Wiring

## Purpose
Make the platform 100% usable for real team onboarding starting immediately.
Zero dummy data. Every function wired. Every screen production-ready.

## Reverse Engineering Mandate
Before Layer 1 begins, Antigravity must:
1. Study competitor UI flows: Linear (keyboard-first, error states), Notion (empty states),
   Monday.com (onboarding), Jira (form validation patterns).
2. Map what flows/patterns to adopt and what NOT to copy verbatim.
3. Produce a structured Reverse-Engineering Report (competitor → our own version).
4. Only after RE Report is submitted, begin Layer 1.

## Layer Plan

---

## Layer 1 — Wiring Audit + Dummy Data Removal
**Goal:** Every UI element hits a real API. Zero hardcoded/mock data anywhere.

### Tasks
1. Full codebase grep for:
   - Hardcoded arrays, objects, fake names, fake emails, lorem ipsum
   - `TODO`, `FIXME`, `mock`, `dummy`, `placeholder` in frontend files
   - Any `setTimeout` simulating fake API calls
2. For every item found: wire to real API endpoint or remove entirely.
3. Audit every form submit button — confirm it calls correct API and handles response.
4. Audit every list/table — confirm it fetches from real endpoint, not local state mock.
5. Confirm NO hardcoded credentials in any frontend JS file.

### Verification
- Script: `scripts/verify-prd29-layer1.js`
- Must grep and assert zero dummy data patterns remain
- Must confirm all API calls return real DB data
- Real HTTP calls only — no mocks in lifecycle tests

---

## Layer 2 — First-Run Setup & Team Onboarding
**Goal:** A brand new install can onboard Admin + team members in under 10 minutes.

### Tasks
1. **First-Run Detection:** On first server start (zero users in DB), redirect to `/setup` page.
2. **Admin Setup Screen:**
   - Create Super Admin account (name, email, password)
   - Set company name ("Mahi Tech Group")
   - Set platform URL
   - Generates `.env` guidance (never stores secrets in DB)
3. **Team Invite Flow:**
   - Admin → Invite by email (generates invite token, sends link)
   - Invite link → member creates own password
   - Role assigned by Admin after signup
4. **Seed Real Data:**
   - Default expense categories (5)
   - Default automation templates (already seeded in PRD 26 — verify present)
   - Default wiki space ("General") auto-created
   - Default OKR cycle (current quarter) auto-created
5. **Onboarding Checklist (Admin Dashboard):**
   - [ ] Admin account created
   - [ ] At least 1 team member invited
   - [ ] First project created
   - [ ] First task created
   - Checklist disappears after all 4 complete

### Verification
- Script: `scripts/verify-prd29-layer2.js`
- Real fresh DB, real HTTP calls, real invite token flow

---

## Layer 3 — Empty States, Error States, Loading States
**Goal:** Every screen handles every possible state gracefully.

### Tasks
For EVERY screen in the web app:
1. **Empty State:** If list/table has zero items — show illustrated empty state with CTA button.
   - Example: "No projects yet. [Create your first project →]"
2. **Error State:** If API returns 4xx/5xx — show inline error message (not blank screen).
3. **Loading State:** Skeleton loader shown while fetching. No blank white flash.
4. **Network Offline:** Banner shown at top. Forms disabled with tooltip.
5. **403 Forbidden:** Friendly "You don't have access" screen (not raw JSON).
6. **404 Not Found:** Friendly "This page doesn't exist" screen.
7. **Form Validation:**
   - Client-side: required fields, email format, number ranges — inline red error text
   - Server-side: error message displayed below field (not just alert popup)

### Verification
- Script: `scripts/verify-prd29-layer3.js`
- Test each state type via real API manipulation (force 500, force empty DB, etc.)

---

## Layer 4 — Design Consistency & Component Cleanup
**Goal:** Uniform design system across every screen. No visual inconsistencies.

### Tasks
1. **Color Tokens:** Audit every hardcoded hex color. Move to CSS variables / design tokens.
   - Primary: defined once, used everywhere
   - Status colors (success/warning/danger/info): consistent
   - Dark mode tokens must match Layer 5 mobile dark theme (#0f172a, #1e293b, #38bdf8)
2. **Typography:** One font stack, consistent heading/body/caption sizes.
3. **Spacing:** 4px/8px grid. No random pixel values.
4. **Button States:** All buttons have hover, active, disabled, loading states.
5. **Table/List Consistency:** Same row height, same padding, same hover color across all tables.
6. **Modal/Dialog Consistency:** Same header, close button, footer layout everywhere.
7. **Toast/Notification:** Single unified toast component used everywhere. No mix of alert() + custom toast.
8. **Icon Set:** One icon library, used consistently. No mixed icon styles.
9. **Mobile Responsive:** Every web screen usable on tablet/mobile browser.
10. **Remove dead CSS/JS:** Any unused component files or styles deleted.

### Verification
- Script: `scripts/verify-prd29-layer4.js`
- Visual consistency checklist (automated where possible, manual checklist for rest)

---

## Layer 5 — Integration Seal & Production Readiness Check
**Goal:** Platform is ready for real daily team use. Full regression clean.

### Tasks
1. Full end-to-end user journey test (real HTTP, real DB):
   - Admin creates project → invites member → member logs in → creates task → marks complete
   - Admin runs payroll → member sees revenue share → Admin approves withdrawal
   - Member submits expense → Admin approves → Budget updated
   - Member logs time → Weekly report shows correct hours
   - Admin views Analytics → correct data shown
   - Client portal: Admin creates client → shares project → client logs in → sees tasks
2. Performance check:
   - Page load < 2 seconds on local
   - API response < 500ms for all main endpoints
   - No N+1 queries remaining (audit all new Layer 1-4 endpoints)
3. Security final check:
   - No secrets in frontend
   - No Admin role in public dropdown
   - Server-side RBAC on every new endpoint added in this PRD
   - All admin actions logged in access_log
4. Regression: ALL previous PRD test suites must still pass.
5. Commit message: `feat(polish): PRD 29 complete — UI Polish & Full Wiring sealed`

### Verification
- Script: `scripts/verify-prd29-layer5.js`
- Full regression across ALL PRDs
- Submit final Status Report with cumulative test count

---

## Standing Rules (apply to every layer)
- Read ALL relevant files before starting any layer
- DO NOT move to next layer until current layer 100% done, tests pass, GO-AHEAD given
- No dummy data anywhere — ever
- No hardcoded credentials
- Server-side RBAC on every endpoint
- Every admin action logged
- Real HTTP calls in all lifecycle/integration tests
- No mocks in DB state tests
- Submit honest Status Report with real console output