// Frontend-only fixtures derived from repository workflows. No network requests are made.
export const roleMeta = {
  researcher: { label: 'Researcher', icon: 'book', userId: 'u-research', description: 'Frame opportunities, submit ideas, and complete deep research.' },
  designer: { label: 'UI/UX Designer', icon: 'pen', userId: 'u-design', description: 'Turn research into flows, interfaces, and design deliverables.' },
  developer: { label: 'Developer', icon: 'grid', userId: 'u-dev-front', description: 'Build frontend or backend tracks and resolve task dependencies.' },
  producer: { label: 'Producer / Tester', icon: 'check-square', userId: 'u-producer', description: 'Prepare test plans, validate builds, and report quality gates.' },
  admin: { label: 'Admin', icon: 'shield', userId: 'u-admin', description: 'Coordinate people, projects, approvals, meetings, and payouts.' }
};

export const stageMeta = {
  RESEARCH_DEV_PARALLEL: { label: 'Parallel tracks', short: 'Parallel', icon: 'layers', tone: 'info' },
  INTEGRATION: { label: 'Integration', short: 'Integration', icon: 'link', tone: 'violet' },
  TESTING: { label: 'Testing', short: 'Testing', icon: 'check-square', tone: 'warning' },
  ADMIN_REVIEW: { label: 'Admin review', short: 'Final review', icon: 'eye', tone: 'warning' },
  LIVE: { label: 'Live', short: 'Live', icon: 'globe', tone: 'success' }
};

export const taskBlueprints = [
  { name: 'Deep Research', type: 'research', role: 'researcher', dependsOn: [] },
  { name: 'Backend Architecture Setup', type: 'backend', role: 'developer', subRole: 'backend', dependsOn: ['Deep Research'] },
  { name: 'Frontend UI Scaffolding', type: 'frontend', role: 'developer', subRole: 'frontend', dependsOn: ['Deep Research'] },
  { name: 'UI/UX Design', type: 'design', role: 'designer', dependsOn: ['Deep Research'] },
  { name: 'Test Plan Preparation', type: 'testing', role: 'producer', dependsOn: ['Deep Research'] },
  { name: 'Frontend API Integration', type: 'frontend', role: 'developer', subRole: 'frontend', dependsOn: ['Backend Architecture Setup'] },
  { name: 'Feature Logic Lock', type: 'backend', role: 'developer', subRole: 'backend', dependsOn: ['Backend Architecture Setup'] },
  { name: 'Full QA Testing', type: 'testing', role: 'producer', dependsOn: ['Deep Research', 'Backend Architecture Setup', 'Frontend UI Scaffolding', 'UI/UX Design', 'Test Plan Preparation', 'Frontend API Integration', 'Feature Logic Lock'] },
  { name: 'Admin Final Review', type: 'review', role: 'admin', dependsOn: ['Deep Research', 'Backend Architecture Setup', 'Frontend UI Scaffolding', 'UI/UX Design', 'Test Plan Preparation', 'Frontend API Integration', 'Feature Logic Lock', 'Full QA Testing'] }
];

const users = [
  { id: 'u-admin', name: 'Ananya Rao', email: 'ananya@demo.mahi', role: 'admin', subRole: null, status: 'active', initials: 'AR', joinedAt: '2024-02-12', lastActive: '2026-10-25T09:42:00+05:30', bio: 'Administrator coordinating project gates, member operations, and organization governance.', location: 'Pune, Maharashtra', rating: 4.9, ideas: 8, projects: 12, meetings: 64, wallet: 0, totalEarnings: 0, frozen: false, color: '#ddd5f5' },
  { id: 'u-research', name: 'Mira Nair', email: 'mira@demo.mahi', role: 'researcher', subRole: null, status: 'active', initials: 'MN', joinedAt: '2025-01-18', lastActive: '2026-10-25T10:18:00+05:30', bio: 'Researcher interested in public services, field interviews, and making complex systems easier to navigate.', location: 'Kochi, Kerala', rating: 4.8, ideas: 11, projects: 7, meetings: 42, wallet: 18450, totalEarnings: 74200, frozen: false, color: '#dce9c7' },
  { id: 'u-design', name: 'Arjun Mehta', email: 'arjun@demo.mahi', role: 'designer', subRole: null, status: 'active', initials: 'AM', joinedAt: '2025-03-09', lastActive: '2026-10-25T09:56:00+05:30', bio: 'Product designer working across research synthesis, accessible interaction, and clear service journeys.', location: 'Ahmedabad, Gujarat', rating: 4.7, ideas: 4, projects: 9, meetings: 38, wallet: 12600, totalEarnings: 68500, frozen: false, color: '#f1dfbd' },
  { id: 'u-dev-front', name: 'Kabir Shah', email: 'kabir@demo.mahi', role: 'developer', subRole: 'frontend', status: 'active', initials: 'KS', joinedAt: '2025-02-21', lastActive: '2026-10-25T10:04:00+05:30', bio: 'Frontend developer focused on resilient interfaces, useful states, and maintainable design systems.', location: 'Mumbai, Maharashtra', rating: 4.9, ideas: 3, projects: 10, meetings: 45, wallet: 21200, totalEarnings: 91300, frozen: false, color: '#cdddf5' },
  { id: 'u-dev-back', name: 'Ishaan Kulkarni', email: 'ishaan@demo.mahi', role: 'developer', subRole: 'backend', status: 'active', initials: 'IK', joinedAt: '2025-04-14', lastActive: '2026-10-24T18:22:00+05:30', bio: 'Backend developer interested in reliable workflows, traceable decisions, and thoughtful API boundaries.', location: 'Nashik, Maharashtra', rating: 4.6, ideas: 2, projects: 8, meetings: 36, wallet: 15900, totalEarnings: 79000, frozen: false, color: '#d7e6e0' },
  { id: 'u-producer', name: 'Sana Iqbal', email: 'sana@demo.mahi', role: 'producer', subRole: null, status: 'active', initials: 'SI', joinedAt: '2025-06-02', lastActive: '2026-10-25T08:47:00+05:30', bio: 'Producer and tester coordinating release readiness, acceptance checks, and actionable quality reports.', location: 'Bhopal, Madhya Pradesh', rating: 4.8, ideas: 5, projects: 9, meetings: 48, wallet: 9800, totalEarnings: 63400, frozen: false, color: '#f2d5d0' },
  { id: 'u-research-2', name: 'Neel Joshi', email: 'neel@demo.mahi', role: 'researcher', subRole: null, status: 'active', initials: 'NJ', joinedAt: '2026-01-10', lastActive: '2026-10-23T16:10:00+05:30', bio: 'Researcher exploring local commerce, cooperative tools, and neighborhood-scale services.', location: 'Jaipur, Rajasthan', rating: 4.4, ideas: 3, projects: 3, meetings: 16, wallet: 4200, totalEarnings: 18600, frozen: false, color: '#e5dcbf' },
  { id: 'u-former', name: 'Devika Rao', email: 'devika@demo.mahi', role: 'designer', subRole: null, status: 'inactive', initials: 'DR', joinedAt: '2024-08-19', lastActive: '2026-08-31T17:30:00+05:30', bio: 'Former product designer. Historical contributions remain attributed and read-only.', location: 'Bengaluru, Karnataka', rating: 4.5, ideas: 6, projects: 5, meetings: 27, wallet: 7300, totalEarnings: 44900, frozen: true, color: '#deded8', exitedAt: '2026-08-31' }
];

const projectSeeds = [
  { id: 'p-arogya', ideaId: 'i-clinic', code: 'MTG–026', title: 'Arogya Queue', summary: 'A clearer clinic-token and waiting-time service for neighborhood health centers.', stage: 'RESEARCH_DEV_PARALLEL', ownerId: 'u-research', createdAt: '2026-10-08', revenueStart: null, assetCount: 3 },
  { id: 'p-khet', ideaId: 'i-farm', code: 'MTG–025', title: 'Khet Price Brief', summary: 'A concise, local-language market briefing concept for smallholder growers.', stage: 'INTEGRATION', ownerId: 'u-research-2', createdAt: '2026-09-14', revenueStart: null, assetCount: 5 },
  { id: 'p-mess', ideaId: 'i-mess', code: 'MTG–024', title: 'Mess Mate', summary: 'A hostel meal feedback and menu-planning workflow built around student schedules.', stage: 'TESTING', ownerId: 'u-research', createdAt: '2026-08-20', revenueStart: null, assetCount: 7 },
  { id: 'p-language', ideaId: 'i-language', code: 'MTG–023', title: 'Local Language Desk', summary: 'A review workspace for translating civic information with human context.', stage: 'ADMIN_REVIEW', ownerId: 'u-research-2', createdAt: '2026-07-11', revenueStart: null, assetCount: 8 },
  { id: 'p-repair', ideaId: 'i-repair', code: 'MTG–019', title: 'Repair Circle', summary: 'A coordination service connecting repair volunteers with community collection days.', stage: 'LIVE', ownerId: 'u-research', createdAt: '2026-03-05', revenueStart: '2026-04-01', assetCount: 11 }
];

function assignedFor(blueprint) {
  if (blueprint.role === 'researcher') return 'u-research';
  if (blueprint.role === 'designer') return 'u-design';
  if (blueprint.role === 'producer') return 'u-producer';
  if (blueprint.role === 'admin') return 'u-admin';
  return blueprint.subRole === 'backend' ? 'u-dev-back' : 'u-dev-front';
}

function statusesFor(stage) {
  if (stage === 'LIVE') return Array(9).fill('DONE');
  if (stage === 'ADMIN_REVIEW') return [...Array(8).fill('DONE'), 'IN_PROGRESS'];
  if (stage === 'TESTING') return [...Array(7).fill('DONE'), 'IN_PROGRESS', 'BLOCKED'];
  if (stage === 'INTEGRATION') return ['DONE', 'DONE', 'DONE', 'DONE', 'DONE', 'IN_PROGRESS', 'TODO', 'BLOCKED', 'BLOCKED'];
  return ['IN_PROGRESS', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED'];
}

function buildTasks(project) {
  const statuses = statusesFor(project.stage);
  return taskBlueprints.map((blueprint, index) => ({
    id: `${project.id}-t${index + 1}`,
    projectId: project.id,
    ...blueprint,
    assignedTo: assignedFor(blueprint),
    status: statuses[index],
    weight: index === 0 ? 18 : index === 8 ? 8 : 10,
    updatedAt: `2026-10-${String(Math.max(8, 24 - index)).padStart(2, '0')}T10:30:00+05:30`,
    completedAt: statuses[index] === 'DONE' ? `2026-10-${String(Math.max(8, 20 - index)).padStart(2, '0')}T16:00:00+05:30` : null,
    deliverable: statuses[index] === 'DONE' ? `${blueprint.name} — reviewed handoff` : null
  }));
}

const ideas = [
  { id: 'i-clinic', ownerId: 'u-research', title: 'Clinic waiting, without the uncertainty', description: 'Explore a simple token and waiting-time communication service for neighborhood clinics. The proposal prioritizes low-bandwidth access, staff-controlled updates, and clear expectations rather than automated medical decisions.', status: 'PENDING_REVIEW', submittedAt: '2026-10-22T11:30:00+05:30', deadline: '2026-10-27T18:00:00+05:30', greenPercentage: 66.67, participation: 50, eligible: 6, quotaCycle: 'October 2026', projectId: 'p-arogya', reviewMeeting: { id: 'rm-clinic', ideaId: 'i-clinic', status: 'SCHEDULED', scheduledAt: '2026-10-22T11:30:00+05:30', votingWindowEnd: '2026-10-27T18:00:00+05:30', createdAt: '2026-10-22T11:30:00+05:30' }, comments: [{ userId: 'u-design', text: 'The staff update flow needs to stay lightweight. I would like to test the empty and delayed states during design.', at: '2026-10-23T14:20:00+05:30' }], decisions: [{ decision: 'VOTING_OPEN', reason: 'Idea submitted and review window opened.', actorId: 'u-research', at: '2026-10-22T11:30:00+05:30' }] },
  { id: 'i-farm', ownerId: 'u-research-2', title: 'A market brief growers can actually use', description: 'Research and prototype a concise market-price briefing in local languages, with clear source timestamps and a human review step.', status: 'APPROVED', submittedAt: '2026-09-10T09:00:00+05:30', deadline: '2026-09-12T09:00:00+05:30', greenPercentage: 83.33, participation: 100, eligible: 6, projectId: 'p-khet', comments: [], decisions: [{ decision: 'APPROVED', reason: 'Green vote crossed the 70% approval threshold with quorum met.', actorId: null, at: '2026-09-12T09:00:00+05:30' }] },
  { id: 'i-mess', ownerId: 'u-research', title: 'Hostel meals with a feedback loop', description: 'A meal schedule and structured feedback workflow that helps hostel teams spot recurring issues without open-ended complaint threads.', status: 'APPROVED', submittedAt: '2026-08-14T09:00:00+05:30', deadline: '2026-08-16T09:00:00+05:30', greenPercentage: 100, participation: 100, eligible: 6, projectId: 'p-mess', comments: [], decisions: [{ decision: 'APPROVED', reason: 'Unanimous green vote after quorum.', actorId: null, at: '2026-08-16T09:00:00+05:30' }] },
  { id: 'i-language', ownerId: 'u-research-2', title: 'Human-reviewed civic translation desk', description: 'A review queue for public-information translations with context notes, reviewer attribution, and version history.', status: 'APPROVED', submittedAt: '2026-07-05T09:00:00+05:30', deadline: '2026-07-07T09:00:00+05:30', greenPercentage: 83.33, participation: 100, eligible: 6, projectId: 'p-language', comments: [], decisions: [{ decision: 'APPROVED', reason: 'Approved through team voting.', actorId: null, at: '2026-07-07T09:00:00+05:30' }] },
  { id: 'i-repair', ownerId: 'u-research', title: 'Community repair collection days', description: 'Coordinate repair volunteers, item intake, and collection-day capacity for neighborhood repair events.', status: 'APPROVED', submittedAt: '2026-02-25T09:00:00+05:30', deadline: '2026-02-27T09:00:00+05:30', greenPercentage: 100, participation: 100, eligible: 6, projectId: 'p-repair', comments: [], decisions: [{ decision: 'APPROVED', reason: 'Approved through team voting and moved to project fan-out.', actorId: null, at: '2026-02-27T09:00:00+05:30' }] },
  { id: 'i-tools', ownerId: 'u-design', title: 'A lending ledger for shared tools', description: 'A neighborhood tool-library concept covering availability, deposits, returns, and condition notes. The first research cycle should clarify who carries each operational responsibility.', status: 'REVISE', submittedAt: '2026-10-12T10:00:00+05:30', deadline: '2026-10-14T10:00:00+05:30', greenPercentage: 57.14, participation: 100, eligible: 6, projectId: null, comments: [{ userId: 'u-producer', text: 'Please add a clearer damage and late-return workflow before resubmission.', at: '2026-10-14T12:00:00+05:30' }], decisions: [{ decision: 'REVISE', reason: 'Green vote was between 50% and the approval threshold.', actorId: null, at: '2026-10-14T10:00:00+05:30' }] },
  { id: 'i-nightbus', ownerId: 'u-dev-front', title: 'Night-bus coordination board', description: 'A departure coordination concept for late-shift workers. The current proposal depends on data sources and operating partnerships that are not yet established.', status: 'REJECTED', submittedAt: '2026-09-25T10:00:00+05:30', deadline: '2026-09-27T10:00:00+05:30', greenPercentage: 28.57, participation: 100, eligible: 6, projectId: null, comments: [], decisions: [{ decision: 'REJECTED', reason: 'Green vote remained below 50% after quorum.', actorId: null, at: '2026-09-27T10:00:00+05:30' }] },
  { id: 'i-draft', ownerId: 'u-research', title: 'Accessible government-form checklist', description: 'Draft: research whether a shared, plain-language checklist could help people prepare documents before visiting a service center.', status: 'DRAFT', submittedAt: null, deadline: null, greenPercentage: 0, participation: 0, eligible: 6, projectId: null, comments: [], decisions: [] },
  { id: 'i-killed', ownerId: 'u-research-2', title: 'Duplicate community notice board', description: 'This proposal substantially duplicates an existing approved workflow and has been removed from active ideation.', status: 'KILLED', preKillStatus: 'PENDING_REVIEW', killedReason: 'Duplicate scope; active review was overlapping with Repair Circle.', submittedAt: '2026-10-01T10:00:00+05:30', deadline: null, greenPercentage: 0, participation: 0, eligible: 6, projectId: null, comments: [], decisions: [{ decision: 'KILLED', reason: 'Duplicate scope; active review was overlapping with Repair Circle.', actorId: 'u-admin', at: '2026-10-03T15:00:00+05:30' }] }
];

const votes = [
  { id: 'v1', ideaId: 'i-clinic', voterId: 'u-design', color: 'green', feasibility: 8, market: 8, capacity: 7, comment: 'Strong service-design scope if staff workload stays central.', at: '2026-10-22T13:10:00+05:30' },
  { id: 'v2', ideaId: 'i-clinic', voterId: 'u-dev-back', color: 'green', feasibility: 8, market: 7, capacity: 7, comment: 'Feasible with a deliberately narrow first release.', at: '2026-10-22T16:45:00+05:30' },
  { id: 'v3', ideaId: 'i-clinic', voterId: 'u-dev-front', color: 'red', feasibility: 6, market: 7, capacity: 4, comment: 'Current frontend capacity is constrained until integration finishes.', at: '2026-10-23T09:20:00+05:30' }
];

const meetings = [
  { id: 'm-clinic-review', title: 'Idea review — Arogya Queue', description: 'Review the clinic-service proposal, capacity concerns, and open research questions.', projectId: 'p-arogya', ideaId: 'i-clinic', scheduledAt: '2026-10-25T16:00:00+05:30', duration: 45, status: 'SCHEDULED', hostId: 'u-admin', participantIds: ['u-admin', 'u-research', 'u-design', 'u-dev-front', 'u-dev-back', 'u-producer'], attendance: [], recording: null, notesStatus: null, notesEn: '', notesHi: '' },
  { id: 'm-integration', title: 'Integration stand-up', description: 'Resolve API integration and feature-lock questions across the development tracks.', projectId: 'p-khet', ideaId: 'i-farm', scheduledAt: '2026-10-25T11:00:00+05:30', startedAt: '2026-10-25T11:02:00+05:30', duration: 30, status: 'LIVE', hostId: 'u-admin', participantIds: ['u-admin', 'u-dev-front', 'u-dev-back', 'u-producer'], attendance: [{ userId: 'u-admin', joinedAt: '2026-10-25T11:01:00+05:30', leftAt: null }, { userId: 'u-dev-front', joinedAt: '2026-10-25T11:02:00+05:30', leftAt: null }, { userId: 'u-dev-back', joinedAt: '2026-10-25T11:04:00+05:30', leftAt: null }], recording: null, notesStatus: null, notesEn: '', notesHi: '' },
  { id: 'm-qa', title: 'Mess Mate — QA readout', description: 'Walk through acceptance results, unresolved edge cases, and the final-review gate.', projectId: 'p-mess', ideaId: 'i-mess', scheduledAt: '2026-10-24T15:00:00+05:30', startedAt: '2026-10-24T15:01:00+05:30', endedAt: '2026-10-24T15:43:00+05:30', duration: 45, status: 'ENDED', hostId: 'u-admin', participantIds: ['u-admin', 'u-research', 'u-design', 'u-dev-front', 'u-dev-back', 'u-producer'], attendance: [{ userId: 'u-admin', joinedAt: '2026-10-24T15:00:00+05:30', leftAt: '2026-10-24T15:43:00+05:30' }, { userId: 'u-producer', joinedAt: '2026-10-24T15:01:00+05:30', leftAt: '2026-10-24T15:43:00+05:30' }, { userId: 'u-dev-front', joinedAt: '2026-10-24T15:05:00+05:30', leftAt: '2026-10-24T15:40:00+05:30' }], recording: { id: 'rec-qa', title: 'QA readout recording', duration: '42:18', size: '84 MB', createdAt: '2026-10-24T15:45:00+05:30' }, notesStatus: 'PENDING', notesEn: 'Sana presented the acceptance report. Mobile menu keyboard checks passed. Two low-bandwidth states need clearer retry language. Kabir will update the empty-state copy before Admin final review.', notesHi: 'सना ने स्वीकृति रिपोर्ट प्रस्तुत की। मोबाइल मेनू कीबोर्ड जाँच सफल रही। धीमे नेटवर्क की दो स्थितियों में पुनः प्रयास का संदेश स्पष्ट करना है। अंतिम समीक्षा से पहले कबीर खाली स्थिति का पाठ बदलेंगे।' },
  { id: 'm-repair', title: 'Repair Circle — operations retrospective', description: 'Review the live project workflow, team handoffs, and follow-up actions.', projectId: 'p-repair', ideaId: 'i-repair', scheduledAt: '2026-10-19T14:00:00+05:30', startedAt: '2026-10-19T14:00:00+05:30', endedAt: '2026-10-19T14:38:00+05:30', duration: 40, status: 'ENDED', hostId: 'u-admin', participantIds: ['u-admin', 'u-research', 'u-design', 'u-dev-front', 'u-dev-back', 'u-producer'], attendance: [{ userId: 'u-admin', joinedAt: '2026-10-19T14:00:00+05:30', leftAt: '2026-10-19T14:38:00+05:30' }, { userId: 'u-research', joinedAt: '2026-10-19T14:01:00+05:30', leftAt: '2026-10-19T14:38:00+05:30' }, { userId: 'u-design', joinedAt: '2026-10-19T14:02:00+05:30', leftAt: '2026-10-19T14:38:00+05:30' }, { userId: 'u-dev-front', joinedAt: '2026-10-19T14:03:00+05:30', leftAt: '2026-10-19T14:38:00+05:30' }, { userId: 'u-dev-back', joinedAt: '2026-10-19T14:03:00+05:30', leftAt: '2026-10-19T14:38:00+05:30' }, { userId: 'u-producer', joinedAt: '2026-10-19T14:02:00+05:30', leftAt: '2026-10-19T14:38:00+05:30' }], recording: { id: 'rec-repair', title: 'Operations retrospective', duration: '37:52', size: '76 MB', createdAt: '2026-10-19T14:40:00+05:30' }, notesStatus: 'CONFIRMED', notesEn: 'The team reviewed the live collection-day workflow. Intake ownership is clear, and the contributor history remains attached to each handoff. Follow-up: keep the next operations review focused on capacity and accessibility.', notesHi: 'टीम ने लाइव संग्रह-दिवस कार्यप्रवाह की समीक्षा की। इनटेक की जिम्मेदारी स्पष्ट है और प्रत्येक हैंडऑफ के साथ योगदानकर्ता इतिहास जुड़ा रहता है। अगली समीक्षा क्षमता और सुलभता पर केंद्रित होगी।', notesConfirmedAt: '2026-10-19T16:10:00+05:30' },
  { id: 'm-design', title: 'Design handoff — Local Language Desk', description: 'Cancelled after the handoff was completed asynchronously with annotated deliverables.', projectId: 'p-language', ideaId: 'i-language', scheduledAt: '2026-10-23T13:00:00+05:30', duration: 30, status: 'CANCELLED', hostId: 'u-admin', participantIds: ['u-admin', 'u-design', 'u-dev-front'], attendance: [], recording: null, notesStatus: null, notesEn: '', notesHi: '' }
];

const tickets = [
  { id: 't-1042', number: 'MTG-1042', reporterId: 'u-dev-front', subject: 'Research attachment will not open', category: 'access_issue', priority: 'high', status: 'in_progress', createdAt: '2026-10-24T10:12:00+05:30', updatedAt: '2026-10-25T09:20:00+05:30', linkedDisputeId: null, messages: [{ id: 'tm1', userId: 'u-dev-front', internal: false, text: 'The research handoff link in Khet Price Brief opens an access-denied state for me. Other project links are working.', at: '2026-10-24T10:12:00+05:30' }, { id: 'tm2', userId: 'u-admin', internal: false, text: 'Thanks for the detail. I am checking the project membership and attachment scope. Please do not share the link outside the assigned team.', at: '2026-10-24T11:05:00+05:30' }, { id: 'tm3', userId: 'u-admin', internal: true, text: 'Internal review: membership record appears correct; inspect organization asset permission next.', at: '2026-10-25T09:20:00+05:30' }] },
  { id: 't-1038', number: 'MTG-1038', reporterId: 'u-research', subject: 'Clarification on withdrawal review', category: 'billing', priority: 'normal', status: 'open', createdAt: '2026-10-23T14:35:00+05:30', updatedAt: '2026-10-23T14:35:00+05:30', linkedDisputeId: null, messages: [{ id: 'tm4', userId: 'u-research', internal: false, text: 'My latest withdrawal is still pending. Could you confirm whether any additional bank detail is needed?', at: '2026-10-23T14:35:00+05:30' }] },
  { id: 't-1029', number: 'MTG-1029', reporterId: 'u-producer', subject: 'Meeting notes language correction', category: 'bug', priority: 'low', status: 'resolved', createdAt: '2026-10-20T12:00:00+05:30', updatedAt: '2026-10-21T09:10:00+05:30', linkedDisputeId: null, messages: [{ id: 'tm5', userId: 'u-producer', internal: false, text: 'One phrase in the Hindi notes changes the owner of the follow-up. Please review the highlighted sentence.', at: '2026-10-20T12:00:00+05:30' }, { id: 'tm6', userId: 'u-admin', internal: false, text: 'Corrected and confirmed. The updated notes now identify the frontend owner.', at: '2026-10-21T09:10:00+05:30' }] },
  { id: 't-1017', number: 'MTG-1017', reporterId: 'u-former', subject: 'Final settlement statement request', category: 'billing', priority: 'normal', status: 'closed', createdAt: '2026-09-02T10:00:00+05:30', updatedAt: '2026-09-04T16:20:00+05:30', linkedDisputeId: 'd-301', messages: [{ id: 'tm7', userId: 'u-former', internal: false, text: 'Please provide the final statement associated with my frozen-wallet settlement.', at: '2026-09-02T10:00:00+05:30' }, { id: 'tm8', userId: 'u-admin', internal: false, text: 'The statement was added to the offboarding record and the ticket is now closed.', at: '2026-09-04T16:20:00+05:30' }] }
];

const disputes = [
  { id: 'd-301', number: 'DSP-0301', title: 'Offboarding settlement clarification', raisedBy: 'u-admin', partyIds: ['u-admin', 'u-former'], linkedTicketId: 't-1017', status: 'under_review', disputeType: 'offboarding_settlement', description: 'Clarify the frozen-wallet amount, settlement statement, and final administrative review after offboarding.', createdAt: '2026-09-02T11:00:00+05:30', settlementAmount: null, settlementAction: null, agreement: { id: 'ag-301', version: 1, status: 'signed', text: 'The parties confirm the final offboarding settlement statement, preserved project attribution, and closure of active withdrawal access. This demonstration document is not a legally executed agreement.' }, waiver: { id: 'wf-301', type: 'financial_final_settlement', status: 'signed', text: 'The member acknowledges review of the demonstrated settlement scope. This prototype waiver has no legal effect.' }, signatures: [{ id: 'sig-301-ag', userId: 'u-former', documentType: 'agreement', documentId: 'ag-301', status: 'signed', agreed: true, at: '2026-09-03T12:00:00+05:30' }, { id: 'sig-301-wf', userId: 'u-former', documentType: 'waiver', documentId: 'wf-301', status: 'signed', agreed: true, at: '2026-09-03T12:04:00+05:30' }] },
  { id: 'd-302', number: 'DSP-0302', title: 'Deliverable attribution review', raisedBy: 'u-design', partyIds: ['u-design', 'u-dev-front', 'u-admin'], linkedTicketId: null, status: 'under_review', disputeType: 'contribution_disagreement', linkedProjectId: 'p-khet', description: 'Review contributor labels on a shared deliverable while preserving the underlying project history.', createdAt: '2026-10-21T09:30:00+05:30', settlementAmount: null, settlementAction: null, agreement: { id: 'ag-302', version: 2, status: 'pending', text: 'The parties will review the recorded deliverable history and confirm the contributor labels attached to the shared project asset. This demonstration document is not a legally executed agreement.' }, waiver: null, signatures: [{ id: 'sig-302-design', userId: 'u-design', documentType: 'agreement', documentId: 'ag-302', status: 'signed', agreed: true, at: '2026-10-22T10:00:00+05:30' }, { id: 'sig-302-front', userId: 'u-dev-front', documentType: 'agreement', documentId: 'ag-302', status: 'pending', agreed: null, at: null, expiresAt: '2026-11-05T10:00:00+05:30' }] }
];

function createLedger() {
  const rows = [];
  const people = ['u-research', 'u-design', 'u-dev-front', 'u-dev-back', 'u-producer'];
  const amounts = [6400, 5800, 7200, 6900, 5200];
  people.forEach((userId, index) => rows.push({ id: `led-${index + 1}`, userId, projectId: 'p-repair', source: 'Community repair service pilot', gross: 36000, amount: amounts[index], rule: 'Team share — first five months', month: '2026-08', status: 'APPROVED', createdAt: '2026-09-01T10:00:00+05:30' }));
  people.forEach((userId, index) => rows.push({ id: `led-${index + 7}`, userId, projectId: 'p-repair', source: 'Repair Circle operations', gross: 30000, amount: amounts[index] + 2200, rule: 'Team 100% — after month five', month: '2026-09', status: 'APPROVED', createdAt: '2026-10-01T10:00:00+05:30' }));
  return rows;
}

const auditLogs = [
  { id: 'a1', userId: 'u-admin', action: 'meeting_notes_pending', resource: 'meeting:m-qa bilingual notes submitted for confirmation', module: 'meetings', severity: 'info', at: '2026-10-25T09:32:00+05:30' },
  { id: 'a2', userId: 'u-dev-front', action: 'task_status_in_progress', resource: 'task:p-khet-t6 Frontend API Integration', module: 'projects', severity: 'info', at: '2026-10-25T09:08:00+05:30' },
  { id: 'a3', userId: 'u-research', action: 'idea_submitted', resource: 'idea:i-clinic voting window opened', module: 'ideas', severity: 'info', at: '2026-10-24T17:20:00+05:30' },
  { id: 'a4', userId: 'u-admin', action: 'support_internal_note', resource: 'ticket:MTG-1042 member-invisible note added', module: 'support', severity: 'info', at: '2026-10-24T16:02:00+05:30' },
  { id: 'a5', userId: 'u-admin', action: 'admin_override_veto', resource: 'idea:i-killed duplicate scope removed from active ideation', module: 'governance', severity: 'warning', at: '2026-10-24T14:40:00+05:30' },
  { id: 'a6', userId: 'u-dev-back', action: 'vote_cast', resource: 'idea:i-clinic green vote; scores recorded', module: 'voting', severity: 'info', at: '2026-10-24T12:16:00+05:30' },
  { id: 'a7', userId: 'u-admin', action: 'payout_manual_review', resource: 'withdrawal:w-102 status remains PENDING', module: 'wallet', severity: 'info', at: '2026-10-23T15:30:00+05:30' },
  { id: 'a8', userId: 'u-admin', action: 'external_access_check', resource: 'offboarding:ob-201 repository and design-tool checks recorded', module: 'offboarding', severity: 'warning', at: '2026-10-22T11:10:00+05:30' },
  { id: 'a9', userId: 'u-admin', action: 'config_updated', resource: 'config:vote_quorum_percentage value 70', module: 'configuration', severity: 'warning', at: '2026-10-20T10:00:00+05:30' },
  { id: 'a10', userId: 'u-former', action: 'access_revoked', resource: 'user:u-former sessions revoked and login disabled', module: 'offboarding', severity: 'critical', at: '2026-08-31T17:30:00+05:30' }
];

export function createInitialData() {
  const projects = projectSeeds.map(seed => ({ ...seed, tasks: buildTasks(seed) }));
  return {
    version: 1,
    users: structuredClone(users),
    projects,
    ideas: structuredClone(ideas),
    votes: structuredClone(votes),
    meetings: structuredClone(meetings),
    tickets: structuredClone(tickets),
    disputes: structuredClone(disputes),
    applications: [
      { id: 'app-71', name: 'Ritika Sen', email: 'ritika@example.test', desiredRole: 'designer', desiredSubRole: null, status: 'pending', submittedAt: '2026-10-24T13:00:00+05:30', note: 'Interested in accessible service journeys and research-led interface design.' },
      { id: 'app-70', name: 'Vikram Pillai', email: 'vikram@example.test', desiredRole: 'developer', desiredSubRole: 'backend', status: 'pending', submittedAt: '2026-10-23T09:30:00+05:30', note: 'Interested in API design, data integrity, and traceable operational workflows.' },
      { id: 'app-66', name: 'Leena Das', email: 'leena@example.test', desiredRole: 'researcher', desiredSubRole: null, status: 'rejected', submittedAt: '2026-10-15T09:30:00+05:30', decidedAt: '2026-10-17T15:00:00+05:30', note: 'Application history retained in this mock review queue.' }
    ],
    withdrawals: [
      { id: 'w-102', userId: 'u-research', amount: 5000, status: 'PENDING', requestedAt: '2026-10-22T10:00:00+05:30', reviewedAt: null, reason: null },
      { id: 'w-101', userId: 'u-dev-front', amount: 7500, status: 'APPROVED', requestedAt: '2026-10-15T10:00:00+05:30', reviewedAt: '2026-10-17T14:00:00+05:30', reason: null },
      { id: 'w-099', userId: 'u-design', amount: 4000, status: 'PAID', requestedAt: '2026-09-28T10:00:00+05:30', reviewedAt: '2026-09-29T14:00:00+05:30', reason: null },
      { id: 'w-094', userId: 'u-producer', amount: 3000, status: 'REJECTED', requestedAt: '2026-09-10T10:00:00+05:30', reviewedAt: '2026-09-11T14:00:00+05:30', reason: 'Bank detail verification was incomplete.' },
      { id: 'w-088', userId: 'u-former', amount: 7300, status: 'PENDING', requestedAt: '2026-08-28T10:00:00+05:30', reviewedAt: null, reason: null }
    ],
    ledger: createLedger(),
    notifications: [
      { id: 'n1', userId: 'all', type: 'meeting', message: 'Idea review for Arogya Queue is scheduled for 4:00 PM today.', link: '#/app/meetings/m-clinic-review', readBy: [], at: '2026-10-25T09:40:00+05:30' },
      { id: 'n2', userId: 'u-dev-front', type: 'task', message: 'Research is ready. Frontend API Integration is available in Khet Price Brief.', link: '#/app/projects/p-khet', readBy: [], at: '2026-10-25T09:15:00+05:30' },
      { id: 'n3', userId: 'u-producer', type: 'task', message: 'Build ready: Full QA Testing can begin in Mess Mate.', link: '#/app/projects/p-mess', readBy: [], at: '2026-10-24T18:30:00+05:30' },
      { id: 'n4', userId: 'u-admin', type: 'support', message: 'A high-priority project access ticket is waiting for review.', link: '#/superadmin/support', readBy: [], at: '2026-10-24T10:12:00+05:30' },
      { id: 'n5', userId: 'u-research', type: 'vote', message: 'Your idea “Clinic waiting, without the uncertainty” is open for team voting.', link: '#/app/ideas/i-clinic', readBy: ['u-research'], at: '2026-10-22T11:30:00+05:30' }
    ],
    config: { ideaQuota: 2, quotaCycleDays: 7, votingWindowHours: 48, approvalThreshold: 70, quorumPercentage: 70, revenueSplitMonths: 5, ownerSplit: 50, teamSplit: 50, orgName: 'MAHI TECH GROUP', orgEmail: 'no-reply@mahitechgroup.com' },
    performanceConfig: { tasks: 30, ideas: 25, voting: 20, meetings: 15, revenue: 10 },
    performance: [
      { userId: 'u-dev-front', score: 92.4, tasks: 96, ideas: 68, voting: 95, meetings: 90, revenue: 94, trend: 'improving', monthly: [58, 65, 69, 76, 84, 92] },
      { userId: 'u-research', score: 89.7, tasks: 90, ideas: 98, voting: 90, meetings: 86, revenue: 82, trend: 'improving', monthly: [70, 71, 78, 80, 85, 90] },
      { userId: 'u-producer', score: 86.2, tasks: 92, ideas: 74, voting: 86, meetings: 94, revenue: 79, trend: 'stable', monthly: [80, 84, 82, 86, 88, 86] },
      { userId: 'u-design', score: 82.8, tasks: 88, ideas: 76, voting: 82, meetings: 80, revenue: 84, trend: 'stable', monthly: [75, 79, 85, 81, 84, 83] },
      { userId: 'u-dev-back', score: 79.5, tasks: 87, ideas: 62, voting: 78, meetings: 77, revenue: 86, trend: 'declining', monthly: [88, 86, 84, 83, 80, 79] },
      { userId: 'u-research-2', score: 71.3, tasks: 75, ideas: 82, voting: 72, meetings: 69, revenue: 55, trend: 'improving', monthly: [42, 48, 52, 60, 66, 71] }
    ],
    offboarding: [
      { id: 'ob-201', userId: 'u-former', reason: 'Member exit and role transition', status: 'COMPLETED', startedAt: '2026-08-31T17:00:00+05:30', completedAt: '2026-08-31T17:30:00+05:30', externalChecks: [{ id: 'github_org', service: 'Remove from GitHub org', status: 'COMPLETED' }, { id: 'google_drive', service: 'Remove from Google Drive shared folders', status: 'COMPLETED' }, { id: 'figma_team', service: 'Remove from Figma team', status: 'COMPLETED' }, { id: 'shared_passwords', service: 'Reset any shared passwords', status: 'PENDING' }, { id: 'slack_channels', service: 'Remove from Slack/communication channels', status: 'COMPLETED' }], steps: ['revoke sessions', 'disable login', 'revoke external access', 'reassign tasks', 'preserve attribution', 'freeze wallet', 'write exit audit'].map((name, index) => ({ step: index + 1, name, status: 'DONE' })) }
    ],
    governance: [
      { id: 'g1', userId: 'u-former', action: 'data_export_delivered', notes: 'Historical profile and attribution export recorded for the former member.', actorId: 'u-admin', at: '2026-08-31T17:30:00+05:30' },
      { id: 'g2', userId: 'u-dev-back', action: 'consent_given', notes: 'Workspace consent record affirmed in the append-only governance fixture.', actorId: 'u-admin', at: '2026-10-18T10:00:00+05:30' }
    ],
    gateway: { mode: 'sandbox', name: 'SIMULATED_GATEWAY_STUB', apiKeyMasked: '••••••••••••7F2A', webhookMasked: '••••••••••••91C0', autoApproval: false, lastDiagnostic: null },
    coworking: {
      'p-arogya': { roomId: 'room-arogya', status: 'active', presence: ['u-research', 'u-design', 'u-dev-front'], objects: [{ id: 'o1', type: 'sticky', x: 12, y: 16, text: 'Who updates the waiting time?', color: 'yellow' }, { id: 'o2', type: 'sticky', x: 39, y: 34, text: 'Keep staff control explicit', color: 'blue' }, { id: 'o3', type: 'text', x: 18, y: 68, text: 'RESEARCH QUESTIONS' }, { id: 'o4', type: 'shape', x: 64, y: 18, shape: 'rect' }], snapshots: [{ id: 'snap1', name: 'Research framing', at: '2026-10-24T16:20:00+05:30', by: 'u-research', objects: [{ id: 'snap1-o1', type: 'sticky', x: 12, y: 16, text: 'Who updates the waiting time?', color: 'yellow' }, { id: 'snap1-o3', type: 'text', x: 18, y: 68, text: 'RESEARCH QUESTIONS' }] }, { id: 'snap2', name: 'Service flow v2', at: '2026-10-23T11:00:00+05:30', by: 'u-design', objects: [{ id: 'snap2-o1', type: 'sticky', x: 12, y: 16, text: 'Who updates the waiting time?', color: 'yellow' }, { id: 'snap2-o2', type: 'sticky', x: 39, y: 34, text: 'Keep staff control explicit', color: 'blue' }, { id: 'snap2-o3', type: 'text', x: 18, y: 68, text: 'RESEARCH QUESTIONS' }, { id: 'snap2-o4', type: 'shape', x: 64, y: 18, shape: 'rect' }] }] },
      'p-khet': { roomId: 'room-khet', status: 'active', presence: ['u-dev-back'], objects: [{ id: 'o5', type: 'text', x: 14, y: 20, text: 'INTEGRATION MAP' }, { id: 'o6', type: 'sticky', x: 43, y: 42, text: 'Source timestamp on every brief', color: 'yellow' }], snapshots: [] }
    },
    auditLogs: structuredClone(auditLogs)
  };
}

export const signingDocuments = {
  'agreement:ag-302': {
    id: 'ag-302', type: 'agreement', title: 'Deliverable Attribution Review Agreement', number: 'AGR–0302 / VERSION 2', party: 'Kabir Shah', status: 'pending', disputeId: 'd-302',
    paragraphs: [
      'This demonstration agreement records the review scope for contributor labels attached to the shared project deliverable. It is presented solely to demonstrate the MAHI TECH GROUP signing interface and has no legal effect.',
      'The reviewing party will inspect the recorded project history, named contributors, and relevant deliverable versions before confirming the attribution summary. Historical work will remain attributed during and after the review.',
      'No production signature, identity verification, payment, or legal submission occurs in this frontend prototype. A production implementation must use authenticated document retrieval and server-recorded signature events.'
    ],
    clauses: ['Review the complete document before choosing an action.', 'Confirm that the displayed name matches the intended demo identity.', 'Record either acceptance or decline; declining does not silently accept any term.', 'Preserve the decision state in the visible document history.']
  },
  'waiver:wf-301': {
    id: 'wf-301', type: 'waiver', title: 'Settlement Review Liability Waiver', number: 'WVR–0301 / SETTLEMENT', party: 'Devika Rao', status: 'signed', disputeId: 'd-301', signedAt: '2026-09-03T12:04:00+05:30',
    paragraphs: [
      'This historical demonstration waiver records the frozen-wallet settlement review associated with a former member. The signed state is mock data and does not represent a legally binding waiver.',
      'The former member profile remains read-only. Historical attribution is preserved while active access and further withdrawal requests remain disabled.',
      'The final settlement shown in the related offboarding record is fictional and included only to verify the signing and settlement screens.'
    ],
    clauses: ['Document scope is limited to the displayed settlement review.', 'Historical attribution is not removed by this demonstration.', 'No new withdrawal or payment is initiated by viewing this document.', 'The recorded mock signature state is read-only.']
  }
};
