export const tracks = [
  {
    id: 'ideas-voting',
    title: 'Ideas & Voting',
    subtitle: 'Turn proposals into visible team decisions.',
    description: 'Prepare an evidenced idea, invite members to score and vote, and keep quorum, thresholds, comments, and the final decision attached to the proposal.',
    audience: 'For researchers, designers, developers, producers, and Admins.',
    icon: 'search-check',
    number: '01',
    category: 'PROPOSE / REVIEW',
    tag: 'IDEAS / DECISIONS',
    concept: 'THE DELIVERY LOOP',
    stages: ['IDEATE', 'VOTE', 'DECIDE'],
    colors: ['#c8f45e', '#d8eff7'],
    visualTitle: 'Ideas / Voting',
    modules: [
      { title: 'Draft proposals within a quota', detail: 'Capture a clear idea, evidence, category, and ownership before review.' },
      { title: 'Cast green or red votes with scores', detail: 'Keep member judgment, optional scoring, and vote comments visible.' },
      { title: 'Meet quorum and approval thresholds', detail: 'Use participation and approval rules to distinguish approval, revision, and rejection.' },
      { title: 'Record or extend the decision', detail: 'Close the voting window or use the defined quorum extension when required.' }
    ]
  },
  {
    id: 'project-delivery',
    title: 'Project Delivery',
    subtitle: 'Move approved work through explicit quality gates.',
    description: 'Fan an approved idea into nine connected tasks, then coordinate research, architecture, UI/UX, development, integration, testing, QA, and final Admin review.',
    audience: 'For multidisciplinary delivery teams and operational Admins.',
    icon: 'code',
    number: '02',
    category: 'PLAN / EXECUTE',
    tag: 'PROJECTS / QUALITY',
    concept: 'THE PROJECT PATH',
    stages: ['PLAN', 'BUILD', 'REVIEW'],
    colors: ['#ffcadb', '#e4dcff'],
    visualTitle: 'Projects / Delivery',
    modules: [
      { title: 'Fan out nine connected tasks', detail: 'Create the evidenced research, design, development, testing, and review stages.' },
      { title: 'Unlock work through dependencies', detail: 'Make blocked, available, active, review, and completed states understandable.' },
      { title: 'Assign owners and attach deliverables', detail: 'Keep role-compatible responsibility and submitted references attached to each task.' },
      { title: 'Complete QA and final review', detail: 'Move through quality checks and Admin approval before the project reaches LIVE.' }
    ]
  },
  {
    id: 'meetings-coworking',
    title: 'Meetings & Co-working',
    subtitle: 'Keep discussion, decisions, and shared thinking together.',
    description: 'Schedule contextual meetings, record attendance and notes, and use a project canvas for notes, shapes, drawing, snapshots, and collaborative exploration.',
    audience: 'For project teams working through research, design, and delivery decisions.',
    icon: 'message',
    number: '03',
    category: 'MEET / MAKE',
    tag: 'MEETINGS / CANVAS',
    concept: 'THE WORKING CONTEXT',
    stages: ['MEET', 'MAKE', 'RECORD'],
    colors: ['#d8eff7', '#c8f45e'],
    visualTitle: 'Meetings / Canvas',
    modules: [
      { title: 'Schedule contextual meetings', detail: 'Coordinate ad hoc and idea-review sessions with relevant participants and projects.' },
      { title: 'Record attendance and bilingual notes', detail: 'Keep meeting participation, recording references, decisions, and notes reviewable.' },
      { title: 'Think together on a shared canvas', detail: 'Use sticky notes, text, shapes, pen tools, and visible participant context.' },
      { title: 'Save and restore named snapshots', detail: 'Preserve canvas milestones and archive completed project boards when appropriate.' }
    ]
  },
  {
    id: 'revenue-governance',
    title: 'Revenue & Governance',
    subtitle: 'Connect contribution, settlement, and operational history.',
    description: 'Keep revenue events, allocation rules, withdrawal review, disputes, waivers, audit history, and member lifecycle changes visible to the right roles.',
    audience: 'For contributors, producers, and Admin operations.',
    icon: 'layers',
    number: '04',
    category: 'GOVERN / SUSTAIN',
    tag: 'REVENUE / OPERATIONS',
    concept: 'THE OPERATING RECORD',
    stages: ['RECORD', 'REVIEW', 'SETTLE'],
    colors: ['#e4dcff', '#ffcadb'],
    visualTitle: 'Revenue / Governance',
    modules: [
      { title: 'Record contribution-aware allocations', detail: 'Connect revenue events to the project, contributors, and applicable split rules.' },
      { title: 'Review withdrawals manually', detail: 'Keep request, approval, rejection, and settlement states explicit and Admin-controlled.' },
      { title: 'Preserve audit and governance history', detail: 'Maintain the operational record behind configuration, decisions, and member actions.' },
      { title: 'Resolve disputes, waivers, and offboarding', detail: 'Review exceptions and lifecycle changes without erasing attribution or history.' }
    ]
  }
];

export const faqs = [
  {
    question: 'What happens after an idea is submitted?',
    answer: 'The idea moves through drafting and voting review. Members can score, comment, and cast green or red votes during the decision window. Quorum and approval thresholds determine whether it is approved, returned for revision, or rejected; an approved idea can then fan out into project delivery.'
  },
  {
    question: 'How does an idea become a project?',
    answer: 'An approved proposal creates nine connected tasks across deep research, backend architecture, frontend scaffolding, UI/UX design, test preparation, API integration, feature logic, full QA, and Admin final review. Dependencies and role-aware ownership keep the sequence visible.'
  },
  {
    question: 'Which roles does the workspace support?',
    answer: 'The role model includes Admin, Researcher, UI/UX Designer, Developer, and Producer, with an elevated Admin zone for sensitive operations. The interface adapts queues, actions, projects, meetings, and administration to the active role.'
  },
  {
    question: 'How are revenue and withdrawals governed?',
    answer: 'The evidenced model starts with a 50% Owner / 50% Team split for five months, then moves to 100% Team. Contribution and allocation records stay attached to projects, while withdrawals require manual Admin review rather than automatic payout.'
  },
  {
    question: 'Is this public preview connected to live services?',
    answer: 'No. The design preview uses local demonstration data. It does not provide live video, realtime co-working, media delivery, payment processing, external offboarding, or production persistence. Those boundaries remain explicit wherever a relevant action is previewed.'
  }
];
