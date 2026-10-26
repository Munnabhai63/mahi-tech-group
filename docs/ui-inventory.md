# MAHI TECH GROUP — Frontend feature inventory

## Source and design review

The source repository is a Node.js 20+/Express 5 application with semantic HTML, vanilla CSS, and vanilla JavaScript. Its product evidence describes MAHI TECH GROUP, a role-based collaboration and governance platform. Repository routes, services, schema, PRDs, and workflows remain the source of truth for product capabilities.

The previously implemented MAHI SKILLS frontend is the **visual reference only**. Its editorial layout, typography, color, spacing, components, interactions, motion, and responsive behavior have been transferred to MAHI TECH GROUP. Learning tracks, mentorship booking, career guidance, and MAHI SKILLS contact details are not product features and are not retained in the current interface.

## Current implementation status

The MAHI TECH GROUP public homepage and complete evidenced application frontend are implemented. The homepage is available at `public/index.html`; the application is available at `public/app.html`. Both use browser-only mock state and explicit service boundaries.

The public homepage uses the dark studio/editorial hero and coordinated ivory, ink, electric-cobalt, and lime design system. Application routes reuse that visual language in distinct role-aware operational layouts rather than copying the marketing-page composition.

See `docs/application-completion-report.md` for the screen-by-screen record, final QA results, service blockers, and exact Git status.

### Implemented homepage UI

- Responsive navigation, full-screen mobile menu, section links, scroll progress, and focus-managed menu behavior.
- Editorial hero with existing photographic art direction, layered delivery-loop graphics, oversized typography, workspace CTAs, and subtle pointer motion.
- Audience strip for researchers, UI/UX designers, developers, producers, and Admins.
- Four full-bleed capability compositions for Ideas & Voting, Project Delivery, Meetings & Co-working, and Revenue & Governance, with alternating layouts, custom line-art graphics, hover/focus states, and keyboard-accessible preview dialogs.
- Connected-collaboration collage, three collaboration benefits, honest workspace-preview action, and three-step meeting/context agenda.
- Three delivery-model chapters covering execution, accountability, and connected disciplines.
- Five exclusive FAQ accordions with product-evidenced answers and accessible open/closed states.
- Final CTA and footer routes into the workspace preview, membership application, member access, and Access & Support.
- Local product content, locally hosted fonts and images, responsive layouts, reduced-motion behavior, and frontend-only interactions.

## Homepage architecture

- `public/index.html`: semantic homepage, navigation, section, dialog, and footer markup.
- `public/css/site.css`: shared tokens, components, baseline section styles, dialog, and global motion behavior.
- `public/css/hero-studio.css`: isolated editorial hero composition and responsive behavior.
- `public/css/homepage-studio.css`: capability, collaboration, delivery-model, FAQ, CTA, audience, and footer compositions.
- `public/js/data/site.js`: central homepage-to-workspace route configuration.
- `public/js/data/home.js`: product capability and FAQ content.
- `public/js/pages/home.js`: capability/FAQ rendering and frontend-only navigation, dialog, reveal, route-link, and hero interactions.
- `public/assets/`: local brand, font, and photographic assets.

## Integration boundary

The homepage makes no API calls and simulates no account, project, meeting, payment, support-delivery, or persistence success. Capability previews use local product content and route into the explicitly labelled application demonstration. No public email-draft, telephone, mentorship, enrollment, or booking action is presented.

The application likewise remains a frontend demonstration. Production authentication, persistence, delivery, storage, payment, media, realtime, external revocation, and secure signing remain later integration work.

## Final homepage verification

- **44/44 rebrand-specific browser checks passed** at 360, 390, 768, 1024, 1440, and 1920 pixels.
- Four capability previews, five FAQs, all images, all fragment targets, and all 28 reveal states were verified after real scrolling and settled transitions.
- No horizontal overflow, out-of-bounds key text, missing targets, empty links, unsupported product copy, external contact actions, console errors, page errors, or external runtime requests were detected.
- Visible buttons met the tested 24-pixel minimum target check.
- Mobile-menu focus placement, background inertness, Escape handling, and link navigation passed.
- Capability dialog content, workspace CTA, Escape close, focus return, and footer capability shortcuts passed.
- Exclusive FAQ state and reduced-motion behavior passed; hero parallax remains disabled under reduced motion.
- **5/5 Axe WCAG A/AA scans** reported zero violations for the homepage and capability dialog at mobile and desktop sizes, and for the mobile menu. Automated scans do not replace manual accessibility review.
- Desktop, tablet, and mobile screenshots were visually reviewed after the final component corrections.

Current screenshots and the machine-readable report are saved in `/home/user/mahi-tech-design-qa/`. Historical visual-reference captures remain separately in `/home/user/mahi-homepage-final/`.

## Application feature inventory — implemented frontend scope

### Public and access screens

- About page and expanded brand/team content supported by repository evidence.
- Access & Support page with membership, member-access, demo-role, and authenticated support-ticket guidance; it sends no public contact request.
- Legacy `#/mentorship` URL compatibility mapped to Access & Support, without a mentorship product or booking flow.
- Signup/application, login/logout, role selection, and session-state screens.
- Applicable legal, privacy, terms, and policy screens.

### Member dashboard and role workspaces

- Dashboard summary, active-project Kanban, pending-vote feed, notifications, activity, and role-focused work areas.
- Researcher, designer, developer, producer/tester, and admin work queues.
- Profile/settings areas for bio, privacy, language, password/profile editing, and former-member states.

### Projects, tasks, and deliverables

- Multi-stage project pipeline, project details, assets, contributors, contribution weights, final review, and launch state.
- Task status, dependencies, uploads, assignment/reassignment, role alerts, and Kanban interactions.
- Research, design, development, and QA deliverable workflows.

### Ideas, voting, and governance

- Idea draft/submit, quota, pending votes, scoring, comments, decision history, meeting-linked review, and admin override.
- Governance/compliance, disputes, signatures/waivers, and unified audit interfaces.

### Meetings and co-working

- Meeting list, scheduling, start/join/leave/end/cancel, attendance, video-room presentation, review voting, recordings, bilingual notes, and notes confirmation.
- Project co-working room, participant presence, shared canvas, object tools, cursor state, and snapshots.

### Profile, wallet, and notifications

- Profile header, metrics, ideas/projects/ratings/earnings tabs, and privacy states.
- Wallet balance, earnings ledger, withdrawal request/status, frozen-wallet, and settlement states.
- Notification and settings screens.

### Support and administration

- Support ticket list/detail, filters, new ticket, threaded messages, status/priority/category, and internal admin replies.
- Admin overview, applications, members, ideas, projects, revenue/payouts, offboarding, configuration, meetings, and audit/access logs.
- Super-admin command overview, member directory/export, performance intelligence, support, ideation controls, payment-gateway configuration presentation, governance/compliance, and unified audit.

### Digital signing

- Dispute-agreement and liability-waiver review, agree/decline, and signature states.

These application items are implemented as frontend UI/UX with realistic mock data and local interactions. None is represented as a connected production service in this milestone.
