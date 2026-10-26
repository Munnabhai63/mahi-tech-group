# MAHI TECH GROUP — Complete frontend implementation plan

> **Implementation status:** Complete for the evidenced frontend scope. See `docs/application-completion-report.md` for the screen-by-screen record, final QA evidence, service blockers, and Git status.

## Scope and boundaries

This plan covers the application frontend evidenced by the repository, PRDs, routes, services, schema, and legacy screens. The later design-transfer milestone applies the approved editorial visual system to a MAHI TECH GROUP homepage at `public/index.html`; it does not retain MAHI SKILLS learning or mentorship product features. The application is delivered at `public/app.html` as a vanilla ES-module single-page frontend with realistic mock data and browser-only state.

No API, database, WebSocket, authentication, payment, email, upload, video, AI, or signing backend is called or modified. Actions that require services are identified as prototype actions. Local interactions never claim real account creation, submission, payment, booking, signature, or server persistence.

## Roles and access model

- **Researcher:** own projects/tasks, ideas, voting, research deliverables, meetings, co-working, profile, wallet, support.
- **UI/UX Designer:** own projects/design tasks, design deliverables, ideas, voting, meetings, co-working, profile, wallet, support.
- **Developer:** own frontend/backend tasks, dependency states, research-ready alerts, ideas, voting, meetings, co-working, profile, wallet, support.
- **Producer / Tester:** testing queue, blocked/build-ready states, test reports, ideas, voting, meetings, co-working, profile, wallet, support.
- **Admin:** member capabilities plus all-project visibility, applications, member management, final review, revenue/payouts, offboarding, configuration, meeting-note confirmation, and access logs.
- **Elevated admin zone:** an admin-only access area, not an invented additional RBAC role. Adds directory/export, performance intelligence, all-ticket inbox, ideation controls, disputes, gateway, governance, and unified audit.
- **Former member:** read-only historical attribution, disabled editing/withdrawals, frozen-wallet and revoked-access messaging.

## Shared UI and states

- Responsive app shell with role-aware sidebar, mobile drawer, breadcrumbs, global quick navigation, notification drawer, account menu, and prototype-state controls.
- Public access screens use a focused editorial-access layout rather than an operational sidebar.
- Shared components: stat blocks, status badges, filters, tables, tabs, Kanban cards, timeline, activity feed, empty/loading/error states, dialogs, drawers, toast messages, and confirmation patterns.
- Normal, loading, empty, and error previews are available through an explicitly labelled UI-preview control.
- Mock mutations are browser-only and can be reset from Settings.

## Phase 1 — Foundation, public access, and member workspaces

| Route / screen | Required UI and states |
| --- | --- |
| `#/about` | Platform purpose, workflow, roles, organization-owned assets, governance boundaries |
| `#/contact` | Access & Support routes and guidance; no public message-delivery claim |
| `#/signup` | Application form, desired role, developer specialization, validation, local pending state |
| `#/application-status` | Pending/approved/rejected application-state previews and next actions |
| `#/login` | Mock sign-in, demo profile selection, inactive/expired-state previews |
| `#/role-selection` | Researcher/designer/developer/producer/admin/elevated-admin demo entry |
| `#/mentorship` | Legacy compatibility route to Access & Support; no mentorship or booking product |
| `#/legal/terms` | Terms and prototype/legal boundaries |
| `#/legal/privacy` | Privacy, financial visibility, attribution, audit, and mock-data notice |
| `#/app/dashboard` | Quick stats, shared project board, pending votes, notifications, activity, meetings |
| `#/app/workspace` | Role-specific researcher/designer/developer/producer/admin workspace |
| `#/app/tasks` | Full role-filtered queue with TODO/BLOCKED/IN_PROGRESS/DONE and dependency detail |
| `#/app/notifications` | Read/unread filters, mark one/all read, relevant-screen links |
| `#/app/former-member` | Read-only former-member profile, attribution, frozen wallet, revoked access |

## Phase 2 — Projects, tasks, ideas, and governance

| Route / screen | Required UI and states |
| --- | --- |
| `#/app/projects` | Five-stage Kanban: Parallel, Integration, Testing, Admin Review, Live |
| `#/app/projects/:id` | Overview, nine-track task map, dependencies, contributors, assets, revenue timeline |
| Project task dialog | Assignment, status action, blocked prerequisite list, upload/deliverable placeholder |
| Project asset dialog | ORG-owned asset type, URL/attachment placeholder, contributor attribution |
| `#/app/ideas` | Draft/pending/revise/approved/rejected/archived history and filters |
| `#/app/ideas/new` | Draft and submit-for-review flows, quota remaining, validation |
| `#/app/ideas/:id` | Vote progress, quorum/deadline, comments, decision history, linked meeting/project |
| `#/app/voting` | Pending-my-vote queue and voting dialog |
| Voting dialog | Green/red vote, feasibility/market/capacity scores, comment, confirmation, local result; revise is a calculated decision, not a vote option |
| Admin idea override | Mandatory reason, decision history, overridden flag |

The project task map reflects the implemented service evidence: Deep Research; Backend Architecture Setup; Frontend UI Scaffolding; UI/UX Design; Test Plan Preparation; Frontend API Integration; Feature Logic Lock; Full QA Testing; Admin Final Review.

## Phase 3 — Meetings, co-working, profiles, wallets, and support

| Route / screen | Required UI and states |
| --- | --- |
| `#/app/meetings` | Scheduled/live/ended/cancelled filters, scheduling flow, join/start/end/cancel states |
| `#/app/meetings/:id` | Mock video-room states, attendance, linked voting sidebar, recordings, notes |
| Meeting notes | English/Hindi tabs, pending review, participant-only notice, admin confirmation |
| `#/app/coworking/:projectId` | Project room, presence, simulated cursors, shapes/text/sticky/pen tools, snapshots |
| `#/app/profile` | Header, quick stats, ideas/projects/ratings/earnings tabs |
| `#/app/members/:id` | Other-member profile with aggregate-only financial privacy for non-admin viewers |
| `#/app/wallet` | Balance, earnings chart/ledger, withdrawal history/request, frozen state |
| `#/app/settings` | Bio/profile, password placeholder, language/privacy, mock-data reset |
| `#/app/support` | Own-ticket list, filters, new-ticket form |
| `#/app/support/:id` | Member thread without internal notes, reply and status states |

## Phase 4 — Admin operations

| Route / screen | Required UI and states |
| --- | --- |
| `#/admin` | Member/project/approval/revenue widgets and recent offboarding |
| `#/admin/applications` | Pending application review, approve/reject, applicant detail |
| `#/admin/members` | Search/filter, add/edit role, profile, remove/offboard |
| `#/admin/ideas` | Pending review, decision history, override with reason |
| `#/admin/projects` | All-project Kanban, reassignment, contribution weight, final review |
| `#/admin/revenue` | Revenue entry/split preview, pending withdrawals, immutable ledger |
| `#/admin/offboarding` | Seven-step checklist, external-service checklist, history, frozen-wallet settlement |
| `#/admin/config` | Quota, voting window/threshold/quorum, revenue duration, organization settings |
| `#/admin/meetings` | Meeting administration and bilingual note review/confirmation |
| `#/admin/audit` | Access-log filters for user/action/resource/date |

## Phase 5 — Elevated administration and signing

| Route / screen | Required UI and states |
| --- | --- |
| `#/superadmin` | Command metrics, open disputes/tickets/payouts, system integrity |
| `#/superadmin/members` | Full directory, search/filter/sort, CSV export, detail drawer/tabs |
| `#/superadmin/performance` | Leaderboard, score breakdown, trends, heatmap, weight configuration |
| `#/superadmin/support` | All tickets, overdue/priority/status filters, internal notes, dispute linking |
| `#/superadmin/ideas` | Ideation controls, hide/restore states, quota configuration |
| `#/superadmin/disputes` | Dispute list/detail, parties, agreement/waiver editor, signatures, settlement |
| `#/superadmin/gateway` | Masked config, disabled auto-approval, diagnostics, payouts, ledger export |
| `#/superadmin/governance` | Block/unblock checklist, category state, append-only history, data export |
| `#/superadmin/audit` | Unified timeline, module/severity/actor/date filters, pagination/export |
| `#/sign/:type/:id` | Agreement or waiver review, validation states, accept/decline confirmation, signed state |

## Phase 6 — Verification and completion audit

- Verify every route renders and every role guard behaves correctly.
- Test public forms, role selection, navigation, mobile drawer, dialogs, filters, tabs, local mutations, and reset.
- Test Kanban/task status, voting, ticket reply, meeting controls, canvas tools/snapshot, wallet request, admin reviews, and signing confirmation as browser-only interactions.
- Test loading, empty, error, former-member, frozen-wallet, blocked-task, and access-denied states.
- Run responsive checks at 360, 390, 768, 1024, and 1440 pixels, plus automated accessibility scans of representative public/member/admin/elevated/signing screens.
- Record completion screen by screen, genuine blockers, and exact Git commit/push state.
