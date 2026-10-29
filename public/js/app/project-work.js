import { stageMeta } from './data.js';
import { state, getUser, missingPrerequisites, projectProgress, formatDate, formatDateTime, escapeHTML, titleCase } from './store.js';
import { icon, badge, emptyState } from './ui.js';

// Operational guidance derived from the existing nine-task delivery map and current validators.
// It describes required work; it is never used as evidence that work was performed.
const workDefinitions = {
  'Deep Research': {
    objective: 'Establish a traceable research handoff for the parallel delivery tracks.',
    description: 'Review the approved project context and use the existing research notes to record findings, sources, constraints, and open questions.',
    inScope: ['Research synthesis and a source-aware handoff for downstream tracks.', 'The existing completion-notes and PDF/DOC metadata checks.'],
    outScope: ['Interface design, software implementation, QA execution, and Admin final approval.']
  },
  'Backend Architecture Setup': {
    objective: 'Define the backend foundation needed by integration and feature-logic work.',
    description: 'Use the completed research handoff to prepare the backend architecture assignment and record any available local handoff reference.',
    inScope: ['Backend architecture and setup within the existing delivery map.', 'Optional completion notes and a local filename under the current controls.'],
    outScope: ['Frontend API integration, full QA execution, and Admin final approval.']
  },
  'Frontend UI Scaffolding': {
    objective: 'Prepare the frontend structure on which later API integration can build.',
    description: 'Apply the research handoff to the frontend scaffold without implying that backend integration or feature completion has occurred.',
    inScope: ['Frontend structure and scaffolding for the approved project context.', 'Optional completion notes and a local filename under the current controls.'],
    outScope: ['Backend architecture, later API integration, full QA, and final approval.']
  },
  'UI/UX Design': {
    objective: 'Turn the research handoff into a reviewable interface-design reference.',
    description: 'Record the existing flow, responsive, and accessibility confirmations with a local design filename or an HTTP(S) handoff reference.',
    inScope: ['User flows, interface design, responsive considerations, and accessibility review.', 'The existing design checklist and deliverable-reference validation.'],
    outScope: ['Software implementation, QA execution, and Admin final approval.']
  },
  'Test Plan Preparation': {
    objective: 'Prepare a reviewable test plan before full QA execution.',
    description: 'Define the intended quality checks and record the existing pass/fail review and local test-report filename.',
    inScope: ['Test scope, planned checks, and the existing test-plan review controls.', 'A PDF/TXT/MD filename retained only as local metadata.'],
    outScope: ['Claiming full QA execution, feature completion, or Admin approval.']
  },
  'Frontend API Integration': {
    objective: 'Connect the prepared frontend to the agreed backend architecture.',
    description: 'Complete the integration assignment after Backend Architecture Setup is DONE, without treating integration as feature-lock or QA approval.',
    inScope: ['Frontend/backend integration within the existing task boundary.', 'Optional completion notes and a local filename under the current controls.'],
    outScope: ['Independent backend feature-lock, full QA execution, and Admin final approval.']
  },
  'Feature Logic Lock': {
    objective: 'Stabilize the assigned backend feature logic for downstream QA.',
    description: 'Complete the existing backend feature-logic assignment after its architecture prerequisite, then record the status through the current workflow.',
    inScope: ['The assigned backend feature-logic boundary and its handoff to QA.', 'Optional completion notes and a local filename under the current controls.'],
    outScope: ['Frontend integration ownership, QA sign-off, and Admin final approval.']
  },
  'Full QA Testing': {
    objective: 'Evaluate the integrated delivery against the recorded quality checklist.',
    description: 'Run the existing full-QA completion workflow only after all seven recorded prerequisites are DONE.',
    inScope: ['Completion notes, pass/fail confirmation, bug details or an explicit “None”, and a test-report filename.', 'The existing PDF/DOC/DOCX/TXT/MD and 10 MB metadata validation.'],
    outScope: ['Skipping prerequisites, treating a selected filename as an uploaded report, or granting Admin approval.']
  },
  'Admin Final Review': {
    objective: 'Record the Admin release decision after the eight preceding tasks are complete.',
    description: 'Review the shared delivery state and use the existing Admin review controls without bypassing the final project gate.',
    inScope: ['Admin review of all eight preceding task statuses and the existing project decision record.'],
    outScope: ['Member self-approval, bypassing incomplete prerequisites, or implying a server-side release.']
  }
};

const genericDefinition = {
  objective: 'Complete the assigned work within the existing project delivery map.',
  description: 'This task uses the current project record and completion controls; no additional deadline, scope, or historical activity is inferred.',
  inScope: ['The assigned track and the completion controls already available for this task.'],
  outScope: ['Unrecorded work, unrelated project tasks, and any approval outside the existing workflow.']
};

export function canAccessProject(project, user) {
  return Boolean(project && user && (user.role === 'admin' || project.ownerId === user.id || project.tasks.some(task => task.assignedTo === user.id)));
}

export function canViewTaskWork(project, task, user) {
  if (!canAccessProject(project, user)) return false;
  if (user.role === 'admin' || task.assignedTo === user.id) return true;
  // A direct prerequisite is a relevant handoff for an assigned downstream task.
  return project.tasks.some(candidate => candidate.assignedTo === user.id && candidate.dependsOn.includes(task.name));
}

export function assignedTasks(project, user) {
  return project?.tasks.filter(task => task.assignedTo === user?.id) || [];
}

export function memberIdentity(user) {
  if (!user) return 'Unassigned · no member identity recorded';
  return `${user.name} · @${user.username} · UID ${user.id} · ${titleCase(user.subRole || user.role)}`;
}

export function taskWorkDefinition(task) {
  const base = workDefinitions[task?.name] || genericDefinition;
  let requiredOutput = 'A completion status through the existing controls. Notes and a local filename are optional under the current generic workflow.';
  let acceptance = ['Every recorded prerequisite is DONE before completion.', 'The assignee or Admin records the status through the existing persisted workflow.'];
  if (task?.type === 'research') {
    requiredOutput = 'Research completion notes of at least 20 characters and one PDF/DOC/DOCX filename, up to 10 MB; metadata only.';
    acceptance = ['The research notes and required local filename pass the existing research validation.', 'A selected filename is not represented as an uploaded document.'];
  } else if (task?.type === 'design') {
    requiredOutput = 'Notes of at least 20 characters, all three design confirmations, and a PNG/JPG/JPEG/WebP/SVG/PDF/FIG filename up to 25 MB or an HTTP(S) handoff URL.';
    acceptance = ['Flow review, mobile review, and contrast review are explicitly confirmed.', 'The reference passes the existing design-source validation; no upload is implied.'];
  } else if (task?.type === 'testing') {
    const fullQA = task.name === 'Full QA Testing';
    requiredOutput = `Notes of at least 10 characters, a pass/fail confirmation${fullQA ? ', bug details or an explicit “None”' : ''}, and a PDF/DOC/DOCX/TXT/MD filename up to 10 MB.`;
    acceptance = ['The testing notes, checklist, and required local filename pass the existing QA validation.', 'The selected report remains metadata only and is not represented as uploaded evidence.'];
  }
  return { ...base, requiredOutput, acceptance };
}

function listItems(items) {
  return items.map(item => `<li>${escapeHTML(item)}</li>`).join('');
}

export function taskDefinitionHTML(task) {
  const definition = taskWorkDefinition(task);
  return `<section class="task-definition" aria-labelledby="task-definition-title"><div class="task-section-head"><div><span class="eyebrow">Task work definition</span><h3 id="task-definition-title">Objective, scope & acceptance</h3></div><span class="small muted">Guidance · not completion evidence</span></div><div class="task-definition__objective"><h4>Task objective</h4><p>${escapeHTML(definition.objective)}</p><p>${escapeHTML(definition.description)}</p></div><div class="task-definition__scope"><div><h4>In scope</h4><ul>${listItems(definition.inScope)}</ul></div><div><h4>Outside this task</h4><ul>${listItems(definition.outScope)}</ul></div></div><div class="task-definition__output"><h4>Required deliverable / expected output</h4><p>${escapeHTML(definition.requiredOutput)}</p></div><div class="task-definition__acceptance"><h4>Acceptance & completion checklist</h4><ul>${listItems(definition.acceptance)}</ul><p class="field-hint">Recorded prerequisites and current status are checked separately below; this guidance never bypasses the workflow.</p></div></section>`;
}

function deliverableReference(task) {
  return task.deliverableDetails?.referenceUrl || task.deliverable || task.deliverableDetails?.fileName || task.deliverableDetails?.url || null;
}

export function previousWorkHTML(project, user) {
  const completed = project.tasks.filter(task => task.status === 'DONE');
  const outstanding = project.tasks.filter(task => task.status !== 'DONE');
  const audit = state.data.auditLogs.filter(log => {
    if (log.module !== 'projects') return false;
    const related = log.resource?.startsWith(`project:${project.id}`) || project.tasks.some(task => log.resource?.startsWith(`task:${task.id}`));
    if (!related) return false;
    return user.role === 'admin' || log.action.startsWith('task_status_') || log.action === 'task_reassigned_by_admin';
  }).slice(0, 14);
  const history = completed.length ? `<ol class="work-history">${completed.map(task => {
    const step = project.tasks.indexOf(task) + 1;
    const completionActor = task.completedBy ? getUser(task.completedBy) : null;
    const responsible = completionActor || getUser(task.assignedTo);
    const canSeeDeliverable = canViewTaskWork(project, task, user);
    const reference = deliverableReference(task);
    const summary = task.deliverableDetails?.notes?.trim();
    return `<li class="work-history__item"><div class="work-history__head"><div><span class="eyebrow">Delivery step ${String(step).padStart(2, '0')} · ${escapeHTML(task.id)}</span><h3>${escapeHTML(task.name)}</h3></div>${badge(task.status)}</div><dl class="work-history__facts"><div><dt>Recorded completion</dt><dd>${task.completedAt ? formatDateTime(task.completedAt) : 'Not recorded'}</dd></div><div><dt>${completionActor ? 'Completed by' : 'Assigned member'}</dt><dd>${escapeHTML(memberIdentity(responsible))}${!completionActor ? '<small>Historical completion actor not recorded; current assignment is shown.</small>' : ''}</dd></div><div><dt>Track</dt><dd>${escapeHTML(titleCase(task.type))}</dd></div></dl><div class="work-history__record">${canSeeDeliverable ? `<div><strong>Existing deliverable reference</strong>${reference ? `<code>${escapeHTML(reference)}</code>` : '<p>No deliverable reference recorded.</p>'}</div><div><strong>Recorded completion summary</strong><p>${summary ? escapeHTML(summary) : 'No completion summary recorded.'}</p></div>` : `<div class="restricted-record">${icon('lock')}<span>Deliverable reference and completion summary are limited to the assignee, direct dependent assignees, and Admin. Shared status and responsible identity remain visible.</span></div>`}</div></li>`;
  }).join('')}</ol>` : emptyState('No previous completion recorded', 'No task in this project is currently marked DONE. Missing dates, references, and summaries are not inferred.', '', 'archive');
  const dependencies = outstanding.length ? `<div class="dependency-register">${outstanding.map(task => {
    const missing = missingPrerequisites(task, project);
    const assignee = getUser(task.assignedTo);
    return `<div class="dependency-register__row"><div><strong>${escapeHTML(task.name)}</strong><span>${escapeHTML(task.id)} · ${escapeHTML(assignee?.name || 'Unassigned')}${task.assignedTo === user.id ? ' · My task' : ''}</span></div><div>${badge(task.status)}<p>${missing.length ? `Waiting for: ${escapeHTML(missing.join(', '))}` : 'No incomplete prerequisite recorded.'}</p></div></div>`;
  }).join('')}</div>` : emptyState('No outstanding dependencies', 'Every recorded task is DONE in the current local project state.', '', 'check-square');
  return `<div class="project-activity"><section class="card card--flush"><div class="card-head"><div><span class="eyebrow">Previous Work / Project Activity</span><h2>Recorded completed work</h2><p>Delivery-map order is shown. Dates, identities, references, and summaries come only from current task records.</p></div><span class="small muted">${completed.length} / ${project.tasks.length} DONE</span></div><div class="card-body">${history}</div></section><aside class="stack"><section class="card card--pad"><span class="eyebrow">Project milestones</span><h2 class="activity-card-title">Current recorded state</h2><dl class="definition-list mt-2"><dt>Current stage</dt><dd>${escapeHTML(stageMeta[project.stage]?.label || titleCase(project.stage))}</dd><dt>Project created</dt><dd>${project.createdAt ? formatDate(project.createdAt) : 'Not recorded'}</dd><dt>Completed steps</dt><dd>${completed.length} of ${project.tasks.length}</dd><dt>Overall progress</dt><dd>${projectProgress(project)}%</dd></dl><p class="field-hint mt-2">The current stage is not backdated or treated as a completed milestone.</p></section><section class="card card--flush"><div class="card-head"><div><h2>Project audit activity</h2><p>Existing project/task events permitted for this view.</p></div></div><div class="card-body">${audit.length ? `<div class="activity-list">${audit.map(log => `<div class="activity-item"><span class="activity-item__dot">${icon('activity')}</span><div><p><strong>${escapeHTML(titleCase(log.action))}</strong> · ${escapeHTML(log.resource)}</p><time>${formatDateTime(log.at)} · ${escapeHTML(getUser(log.userId)?.name || 'System')}</time></div></div>`).join('')}</div>` : '<p class="small muted">No project audit events are recorded for this view.</p>'}</div></section></aside><section class="card card--flush project-activity__dependencies"><div class="card-head"><div><h2>Outstanding dependencies & current status</h2><p>Shared delivery context only; restricted deliverable metadata is not exposed here.</p></div></div><div class="card-body">${dependencies}</div></section></div>`;
}

export function personalWorkSummaryHTML(project, user) {
  const ownTasks = assignedTasks(project, user);
  const ownDone = ownTasks.filter(task => task.status === 'DONE').length;
  const ownProgress = ownTasks.length ? Math.round(ownDone / ownTasks.length * 100) : 0;
  return `<section id="personal-work-summary" class="print-only personal-work-summary" aria-hidden="true"><header><span>MAHI TECH GROUP · PERSONAL WORK SUMMARY</span><h1>${escapeHTML(project.title)}</h1><p>${escapeHTML(project.code)} · Prepared ${formatDateTime(new Date().toISOString())}</p></header><section class="print-identity"><h2>Member identity</h2><p>${escapeHTML(memberIdentity(user))}</p></section><section class="print-progress"><h2>Progress</h2><p><strong>Overall shared project:</strong> ${project.tasks.filter(task => task.status === 'DONE').length}/${project.tasks.length} tasks · ${projectProgress(project)}%</p><p><strong>My assigned work:</strong> ${ownDone}/${ownTasks.length} tasks · ${ownProgress}%</p></section><section><h2>My assigned tasks</h2>${ownTasks.length ? ownTasks.map(task => {
    const definition = taskWorkDefinition(task); const reference = deliverableReference(task);
    const dependencies = task.dependsOn.map(name => ({ name, status: project.tasks.find(candidate => candidate.name === name)?.status || 'NOT RECORDED' }));
    return `<article class="print-task"><div class="print-task__head"><h3>${escapeHTML(task.name)}</h3><strong>${escapeHTML(titleCase(task.status))}</strong></div><p>${escapeHTML(task.id)} · ${escapeHTML(titleCase(task.type))} track</p><dl><dt>Objective</dt><dd>${escapeHTML(definition.objective)}</dd><dt>Required output</dt><dd>${escapeHTML(definition.requiredOutput)}</dd>${task.priority ? `<dt>Priority</dt><dd>${escapeHTML(task.priority)}</dd>` : ''}${task.dueDate ? `<dt>Due date</dt><dd>${formatDate(task.dueDate)}</dd>` : ''}<dt>Updated</dt><dd>${task.updatedAt ? formatDateTime(task.updatedAt) : 'Not recorded'}</dd><dt>Completed</dt><dd>${task.completedAt ? formatDateTime(task.completedAt) : 'Not recorded'}</dd><dt>Dependencies</dt><dd>${dependencies.length ? escapeHTML(dependencies.map(item => `${item.name} (${item.status})`).join('; ')) : 'None recorded'}</dd><dt>My deliverable reference</dt><dd>${reference ? escapeHTML(reference) : 'No deliverable reference recorded'}</dd><dt>My completion summary</dt><dd>${task.deliverableDetails?.notes?.trim() ? escapeHTML(task.deliverableDetails.notes.trim()) : 'No completion summary recorded'}</dd></dl></article>`;
  }).join('') : '<p>No tasks are assigned directly to this member in the current project records.</p>'}</section><footer>Browser print view · choose “Save as PDF” in the browser’s print destination. Verified workspace export.</footer></section>`;
}
