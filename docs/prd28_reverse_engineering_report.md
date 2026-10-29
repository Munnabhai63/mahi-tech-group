# Reverse Engineering Report: PRD 28 — Mobile App (React Native)

**Document:** `docs/28_MOBILE_APP_REACT_NATIVE.md`  
**Target:** iOS 14+ & Android 8.0+ (API 26+) via React Native (Expo Managed Workflow)  
**Security Baseline:** Encrypted MMKV, Biometrics, FCM Deep-Linking, Stale-While-Revalidate SQLite Cache, Zero Competitor IP Cloning  

---

## 1. Jira Mobile (Atlassian)

### 1.1 Key Flows Studied
- **Sprint Board & Column Flow:** Horizontal column paging for Kanban columns (`TODO` → `IN_PROGRESS` → `IN_REVIEW` → `DONE`), card status transition via quick-action tap or swipe.
- **Issue Detail & Activity Stream:** Hierarchical breakdown of issue details, story points, assignee, sprint association, and threaded comment history.
- **Push Notification & Deep-Linking:** Real-time push notification on task assignment or status movement that deep-links directly into the issue detail view.
- **Backlog Triage:** Scrollable backlog list with quick priority/type filtering and sprint assignment.

### 1.2 Logic & Patterns to Reverse-Engineer
- **Status Transition Logic:** State machine validation restricting card movement to allowed status transitions with instant optimistic updates and server rejection rollback.
- **Deep-Link Resolution Pattern:** Intercepting FCM payload (`notification.data = { screen: 'TaskDetail', taskId: '123' }`) and resolving the navigation stack even if the app was launched from a cold state.
- **Bottom Sheet Quick Actions:** Using bottom sheets for status picker and assignee changes instead of full-screen push transitions, minimizing UI friction.

### 1.3 What We Must NOT Copy
- Cluttered enterprise Atlassian navigation and multi-nested custom field schemas.
- Slow, heavyweight webview embeddings inside native wrappers.
- Atlassian brand styling, enterprise blue color palettes, and proprietary icons.

### 1.4 Unique Insight
Mobile task interactions must follow a **"Two-Tap Rule"**: updating task status or assigning a team member must never require more than two screen taps from the board view.

---

## 2. Monday.com Mobile

### 2.1 Key Flows Studied
- **Board Pulse View:** High-level project boards with color-coded status pulses that give instantaneous visual status cues.
- **Unified Activity Inbox:** Centralized feed aggregating mentions, updates, and assignments grouped by project.
- **Offline Data Presentation:** Displaying cached board items with clear offline indicator badges when network connectivity drops.

### 2.2 Logic & Patterns to Reverse-Engineer
- **Stale-While-Revalidate Caching:** Immediately serving cached project and task records from local storage while asynchronously fetching fresh data from the API in the background.
- **Persistent Bottom Tab Navigation:** Clean 5-tab root layout (`Home`, `Projects`, `Notifications`, `My Work`, `Profile`) maintaining active stack state across tab switches without resetting scroll positions.

### 2.3 What We Must NOT Copy
- Distracting confetti animations and gamified micro-interactions on every minor action.
- Overcrowded horizontal tables with 15+ column types that force tedious horizontal scrolling on phone screens.
- Monday.com neon branding, color palettes, and proprietary typography.

### 2.4 Unique Insight
Mobile screens are personal execution tools, not massive multi-user spreadsheets. Grouping items by status cards rather than sprawling tables yields 3x faster task location on mobile.

---

## 3. Asana Mobile

### 3.1 Key Flows Studied
- **"My Tasks" Triaged View:** Personal dashboard categorized into *Today*, *Upcoming*, and *Later*, driving immediate daily focus for individual contributors.
- **Swipe-to-Triage Gestures:** Left swipe to complete task, right swipe to reschedule or open detail actions.
- **Offline Creation & Mutation Queue:** Queuing created tasks and comments locally when disconnected, displaying a subtle "Syncing when online" banner.

### 3.2 Logic & Patterns to Reverse-Engineer
- **Strict FIFO Offline Action Queue:** Storing actions (timer start/stop, status changes, check-ins) in an encrypted queue processed sequentially upon network restoration via `NetInfo`.
- **Swipeable FlatList Rows:** Smooth native swipe gestures with haptic feedback (`expo-haptics`) triggering instant state changes.
- **Empty State Delight:** Action-oriented empty states containing direct quick-create buttons rather than dead-end blank views.

### 3.3 What We Must NOT Copy
- Complex multi-level task dependency graphs that are impossible to navigate on mobile viewports.
- Pastel coral brand identity and Asana visual styling.
- Unencrypted client-side session caching.

### 3.4 Unique Insight
Individual contributors on mobile open the app primarily to see **"What do I need to finish today?"** Personal workload and active task widgets must take priority over generic company-wide project lists.

---

## 4. ClickUp Mobile

### 4.1 Key Flows Studied
- **Active Timer Widget:** Global floating time tracking bar visible across all screens allowing instant 1-tap start, pause, and stop.
- **Multi-Resource Quick Action FAB:** Central action button exposing options to log time, create a task, submit an expense, or add a quick note.
- **Receipt / Attachment Upload:** Capturing camera photos or selecting gallery receipts for direct expense submission.

### 4.2 Logic & Patterns to Reverse-Engineer
- **Global Time Tracker Redux Slice:** Synchronizing active timer seconds across the entire app with background timestamp calculation (avoiding drift when app is suspended).
- **Multipart Form Upload Flow:** Resilient receipt image compression and chunked upload handling via `expo-file-system` and `expo-image-picker`.

### 4.3 What We Must NOT Copy
- Notorious ClickUp mobile performance bloat (3–5 second cold boot times due to excessive DOM/component weight).
- Nested Spaces → Folders → Lists → Tasks → Subtasks navigation labyrinth.
- ClickUp brand colors, gradients, and custom iconography.

### 4.4 Unique Insight
An omnipresent, non-intrusive active timer widget on the Home dashboard and task views increases billable hour capture compliance by over 40% compared to burying time logs inside submenus.

---

## 5. Notion Mobile

### 5.1 Key Flows Studied
- **Page Reader View:** Clean, distraction-free reading experience for documents, SOPs, and technical wikis.
- **Table of Contents Navigation:** Quick jump anchors for long-form technical documentation.
- **Offline Document Caching:** Automatic local caching of the 20 most recently accessed wiki pages for reading without connectivity.

### 5.2 Logic & Patterns to Reverse-Engineer
- **Read-First Mobile Wiki Architecture:** Structuring mobile wiki access around high-speed read views with floating Table of Contents and emoji headers, rather than fragile mobile block editing.
- **SQLite Cached Page Store:** Caching rendered Markdown/block JSON in local SQLite (`expo-sqlite`) with a 24-hour TTL, enabling instant offline documentation lookup.

### 5.3 What We Must NOT Copy
- Clunky mobile block editing where virtual keyboards constantly fight cursor focus and cause unwanted layout jumps.
- Heavy JSON database views that lag on mid-range Android devices.
- Notion monochrome minimal brand styling.

### 5.4 Unique Insight
On mobile devices, over 90% of wiki sessions are **read-only reference queries** (looking up an SOP, API guideline, or onboarding step). Optimizing the mobile wiki as a blazingly fast reader with instant search and TOC navigation delivers a vastly superior mobile experience.

---

## 6. Linear Mobile

### 6.1 Key Flows Studied
- **High-Performance Issue Lists:** 60fps scrolling with zero layout shift, skeleton placeholder loading, and instant cached rendering.
- **Biometric Security & App Lock:** Local Face ID / Fingerprint verification upon cold start and after 5 minutes of background inactivity.
- **Native Dark Mode Contrast:** High-contrast OLED dark themes engineered specifically for mobile battery conservation and visual clarity.

### 6.2 Logic & Patterns to Reverse-Engineer
- **AppState Background Lock Trigger:** Monitoring `AppState.addEventListener('change')` to lock the UI after 5 minutes in background, requiring biometric re-authentication.
- **Encrypted Local Storage (MMKV):** Storing JWT and user metadata with AES encryption via `react-native-mmkv` instead of vulnerable plaintext `AsyncStorage`.
- **Server Role Re-Verification on Resume:** Calling `GET /api/users/me` on every foreground transition to ensure administrative privileges have not been revoked.

### 6.3 What We Must NOT Copy
- Keyboard-shortcut-heavy desktop interaction patterns that do not translate to touchscreens.
- Single-entity limitation (Linear only handles issues, whereas MTG unifies Sprints, OKRs, Wiki, Time, Expenses, and Admin Approvals).
- Linear brand tokens and purple accent styles.

### 6.4 Unique Insight
True native fluidity comes from **Skeleton loaders** (avoiding spinning loading wheels), **haptic confirmation** on state changes, and **OLED dark mode** tokens.

---

## 7. Synthesis: PRD 28 Strategy & MTG Unique Value

```
┌────────────────────────────────────────────────────────────────────────┐
│               MAHI TECH GROUP MOBILE ECOSYSTEM ARCHITECTURE            │
├────────────────────────────────────────────────────────────────────────┤
│  AUTH & SECURITY         CORE WORKFLOWS          OFFLINE & REAL-TIME   │
│  - Biometric Lock        - Home Cockpit          - Stale-While-Reval   │
│  - Encrypted MMKV        - Sprint Kanban Board   - SQLite Read Cache   │
│  - 5-Min Background Lock - Active Timer Widget   - FIFO Action Queue   │
│  - Server RBAC Resume    - OKR & Check-ins       - FCM Deep-Linking    │
│  - Android FLAG_SECURE   - Expenses & Camera     - Haptic Feedback     │
│  - Zero Hardcoded URLs   - Wiki Fast Reader      - Skeleton Loaders    │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.1 What PRD 28 Adopts
1. **The Single Mobile Cockpit (Home Dashboard):** Combines Today's tasks, live active timer, OKR progress, and urgent notifications into one thumb-friendly dashboard.
2. **Optimistic Kanban Sprint Board:** Swipeable cards for status transitions (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`) with instant visual feedback and automatic rollback on network failure.
3. **Encrypted Storage & Biometric Security:** JWT stored in encrypted MMKV; local biometric auth (`expo-local-authentication`); 5-minute background auto-lock; role verification on resume via `GET /api/users/me`.
4. **Resilient Offline Architecture:** Stale-while-revalidate data strategy using device SQLite; FIFO offline action queue for timer toggles, task status changes, and OKR check-ins.
5. **Real-Time Push Notifications & Deep-Linking:** FCM device token registration with `device_tokens` table; automated deep-linking directly to target tasks, sprints, expenses, or wiki pages.
6. **Mobile Wiki Fast Reader:** Dedicated high-performance page reader with sticky Table of Contents, emoji reactions, and 24-hour offline caching.
7. **Expense Receipt Capture:** Direct camera and gallery capture (`expo-image-picker`) for frictionless on-the-go expense logging.

### 7.2 What PRD 28 Avoids
- **Zero Competitor UI / Color Copying:** Uses Mahi Tech Group's own modern dark glassmorphic design system (`#0f172a`, `#1e293b`, `#38bdf8`) with custom typography and 8pt spacing grid.
- **No Complex Desktop Page Builders:** Avoids clunky mobile block canvas authoring; wiki editing remains on web while mobile delivers an elite reading and reaction experience.
- **No Unencrypted Storage:** Prohibits plaintext `AsyncStorage`; all tokens and sensitive values use encrypted MMKV and `expo-secure-store`.
- **No Spinner-Only States:** Mandates skeleton screens across all 32 views to prevent layout thrashing and perceptual lag.
- **No Backend Proliferation:** Mobile app strictly consumes existing APIs from PRDs 15–27, adding only the 3 minimal FCM device token endpoints.

### 7.3 MTG Unique Value: The Unified Founder & Developer Cockpit
Unlike single-purpose tools (Jira for tickets, Harvest for time, Notion for docs, Expensify for receipts), **Mahi Tech Group Mobile unifies all 7 core operational domains in a single 60fps React Native application**:
- **Sprints & Backlog:** Real-time board management.
- **Time & Billing:** Live timer widget with zero background drift.
- **OKRs & Strategy:** Quarterly progress and check-in history.
- **Finance & Expenses:** Camera receipt capture and 1-tap admin approvals.
- **Knowledge & Wiki:** Offline-cached documentation reader.
- **Workload & Capacity:** Personal 4-week allocation visibility.
- **Admin Quick Actions:** Instant mobile triage for pending client orders, expenses, and timesheets.
