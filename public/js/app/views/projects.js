import { stageMeta } from '../data.js';
import { state, currentUser, getUser, getProject, projectProgress, missingPrerequisites, persistData, addAudit, addNotification, formatDate, formatDateTime, formatINR, escapeHTML, titleCase } from '../store.js';
import { icon, badge, plainBadge, avatar, person, progress, pageHead, card, notice, emptyState, withPreview, openDialog, closeDialog, confirmDialog, toast, bindTabs, formValues, setFormError, showPlaceholder } from '../ui.js';

function evaluateStage(project) {
  const map = Object.fromEntries(project.tasks.map(task => [task.name, task.status]));
  const foundational = project.tasks.slice(0, 7);
  const allFoundational = foundational.every(task => task.status === 'DONE');
  if (allFoundational && map['Full QA Testing'] === 'DONE' && map['Admin Final Review'] === 'DONE') return 'LIVE';
  if (allFoundational && map['Full QA Testing'] === 'DONE') return 'ADMIN_REVIEW';
  if (allFoundational && ['TODO', 'IN_PROGRESS'].includes(map['Full QA Testing'])) return 'TESTING';
  if (['Deep Research', 'Backend Architecture Setup', 'Frontend UI Scaffolding', 'UI/UX Design', 'Test Plan Preparation'].some(name => map[name] === 'DONE') || ['Frontend API Integration', 'Feature Logic Lock'].some(name => ['IN_PROGRESS', 'DONE'].includes(map[name]))) return 'INTEGRATION';
  return 'RESEARCH_DEV_PARALLEL';
}

function projectCard(project) {
  const done = project.tasks.filter(task => task.status === 'DONE').length;
  const contributors = [...new Set(project.tasks.map(task => task.assignedTo))].map(getUser).filter(Boolean);
  return `<button class="project-card" data-project-id="${project.id}" data-search="${escapeHTML(`${project.title} ${project.code}`.toLowerCase())}"><span class="project-card__top"><span class="project-card__code">${project.code}</span>${badge(project.stage)}</span><h3>${escapeHTML(project.title)}</h3><p>${escapeHTML(project.summary)}</p>${progress(projectProgress(project))}<span class="project-card__foot"><span class="avatar-stack">${contributors.slice(0, 3).map(user => avatar(user, 'sm')).join('')}</span><small>${done}/9 tasks</small></span></button>`;
}

export function renderProjects() {
  const user = currentUser();
  const projects = user?.role === 'admin' ? state.data.projects : state.data.projects.filter(project => project.ownerId === user?.id || project.tasks.some(task => task.assignedTo === user?.id));
  const stages = Object.keys(stageMeta).filter(stage => stage !== 'REJECTED_AT_REVIEW' || projects.some(project => project.stage === stage));
  const board = `<div class="filter-bar"><div class="field field--search"><label for="project-search">Search projects</label><div class="input-wrap">${icon('search')}<input class="input" id="project-search" placeholder="Search by title or project code"></div></div><div class="field"><label for="project-stage-filter">Pipeline stage</label><select class="select" id="project-stage-filter"><option value="all">All stages</option>${stages.map(stage => `<option value="${stage}">${stageMeta[stage]?.label || titleCase(stage)}</option>`).join('')}</select></div><span class="filter-count" id="project-filter-count">${projects.length} projects</span></div><div class="kanban-board" id="project-board">${stages.map(stage => { const items = projects.filter(project => project.stage === stage); return `<section class="kanban-column" data-stage="${stage}"><div class="kanban-column__head"><h2>${stageMeta[stage]?.label || titleCase(stage)}</h2><span class="kanban-column__count">${items.length}</span></div><div class="kanban-column__body">${items.length ? items.map(projectCard).join('') : '<div class="empty-state" style="padding:25px 8px"><p>No projects at this gate.</p></div>'}</div></section>`; }).join('')}</div>`;
  const html = `${pageHead('Organization projects', 'Pipeline, not a black box.', 'Follow every project through parallel tracks, integration, testing, final review, and live operations.', `<a class="btn btn--outline" href="#/app/tasks">${icon('check-square')} My task queue</a>`)}${withPreview(board, { title: 'No projects in this pipeline', description: 'Approved ideas will appear here after project fan-out.', icon: 'folder' })}`;
  return { html, mount() {
    document.querySelectorAll('[data-project-id]').forEach(button => button.addEventListener('click', () => { location.hash = `#/app/projects/${button.dataset.projectId}`; }));
    const search = document.querySelector('#project-search'); const stage = document.querySelector('#project-stage-filter');
    const filter = () => {
      const query = search.value.trim().toLowerCase(); let visible = 0;
      document.querySelectorAll('.kanban-column').forEach(column => {
        const stageVisible = stage.value === 'all' || column.dataset.stage === stage;
        column.hidden = !stageVisible;
        let columnVisible = 0;
        column.querySelectorAll('[data-project-id]').forEach(project => {
          const show = stageVisible && (!query || project.dataset.search.includes(query)); project.hidden = !show;
          if (show) { visible++; columnVisible++; }
        });
        const count = column.querySelector('.kanban-column__count'); if (count && (query || stage.value !== 'all')) count.textContent = columnVisible;
      });
      document.querySelector('#project-filter-count').textContent = `${visible} project${visible === 1 ? '' : 's'}`;
    };
    search?.addEventListener('input', filter); stage?.addEventListener('change', filter);
  } };
}

function taskRow(task, project, mapView = false, index = 0) {
  const user = getUser(task.assignedTo); const missing = missingPrerequisites(task, project);
  const body = `<div><div class="task-card__title"><h3>${escapeHTML(task.name)}</h3>${badge(task.status)}${plainBadge(task.type, 'neutral')}</div><div class="task-card__meta"><span>${icon('user')} ${escapeHTML(user?.name || 'Unassigned')}</span><span>${icon('chart')} Weight ${task.weight}%</span><span>${icon('clock')} ${task.completedAt ? `Done ${formatDate(task.completedAt, { year: false })}` : `Updated ${formatDate(task.updatedAt, { year: false })}`}</span></div>${task.status === 'BLOCKED' && missing.length ? `<div class="dependency-note">${icon('lock')}<span>Waiting for: ${missing.map(escapeHTML).join(', ')}</span></div>` : ''}</div><div class="task-card__actions"><button class="btn btn--outline btn--sm" data-open-task="${task.id}">Details ${icon('chevron-right', 'icon--sm')}</button></div>`;
  if (mapView) return `<div class="task-map__row ${task.status === 'DONE' ? 'is-done' : ''}"><div class="task-map__rail"><span class="task-map__number">${task.status === 'DONE' ? icon('check', 'icon--sm') : String(index + 1).padStart(2, '0')}</span></div><article class="task-card ${task.status === 'BLOCKED' ? 'is-blocked' : ''}">${body}</article></div>`;
  return `<article class="task-card ${task.status === 'BLOCKED' ? 'is-blocked' : ''}" data-task-status="${task.status}" data-task-assignee="${task.assignedTo}">${body}</article>`;
}

function assetsFor(project) {
  const defaults = [
    ['Research handoff', 'research', 'u-research'], ['Service flow and screen map', 'design', 'u-design'], ['API contract notes', 'document', 'u-dev-back'], ['Acceptance report', 'testing', 'u-producer'], ['Release checklist', 'review', 'u-admin']
  ];
  const generated = defaults.slice(0, Math.min(defaults.length, project.assetCount)).map((asset, index) => ({ id: `${project.id}-asset-${index}`, title: asset[0], type: asset[1], contributorId: asset[2], organizationOwned: true, createdAt: project.createdAt }));
  return [...generated, ...(project.localAssets || [])];
}

function projectOverview(project) {
  const owner = getUser(project.ownerId); const contributors = [...new Set(project.tasks.map(task => task.assignedTo))].map(getUser).filter(Boolean);
  const next = project.tasks.find(task => task.status !== 'DONE');
  return `${project.stage === 'REJECTED_AT_REVIEW' ? `<div class="mb-2">${notice(`Admin rejected this project at final review${project.reviewedAt ? ` on ${formatDateTime(project.reviewedAt)}` : ''}. The project remains ACTIVE; its delivery history is preserved and Admin can record a new final-review decision.${project.reviewNotes ? ` Review notes: ${escapeHTML(project.reviewNotes)}` : ''}`, 'danger', 'Rejected at final review', 'alert')}</div>` : ''}<div class="grid-main-side"><div class="stack"><section class="card card--pad"><div class="project-identity"><span class="project-identity__mark">${project.code.slice(-2)}</span><div><h2>${escapeHTML(project.title)}</h2><p>${project.code} · Organization-owned project · Created ${formatDate(project.createdAt)}</p></div></div><p class="mt-2 muted">${escapeHTML(project.summary)}</p><div class="divider"></div>${progress(projectProgress(project), 'Nine-task delivery progress')}<div class="project-stats mt-2"><div class="project-stat"><span>Current gate</span><strong style="font-size:15px">${stageMeta[project.stage]?.short || titleCase(project.stage)}</strong></div><div class="project-stat"><span>Tasks complete</span><strong>${project.tasks.filter(task => task.status === 'DONE').length}/9</strong></div><div class="project-stat"><span>Contributors</span><strong>${contributors.length}</strong></div><div class="project-stat"><span>Assets</span><strong>${assetsFor(project).length}</strong></div></div></section><section class="card card--pad"><div class="spread mb-2"><div><div class="eyebrow">Dependency map</div><h2 class="mt-1" style="font:600 20px var(--font-display)">The nine-task fan-out</h2></div><button class="btn btn--ghost btn--sm" data-show-tab="tasks">Open full task list ${icon('arrow-up-right', 'icon--sm')}</button></div><div class="task-map">${project.tasks.map((task, index) => taskRow(task, project, true, index)).join('')}</div></section></div><aside class="stack"><section class="card card--pad"><div class="eyebrow">Current focus</div>${next ? `<h2 class="mt-1" style="font:600 20px var(--font-display)">${escapeHTML(next.name)}</h2><p class="small muted mt-1">${next.status === 'BLOCKED' ? 'Blocked until every prerequisite is complete.' : 'The next incomplete task in the delivery map.'}</p><div class="mt-2">${person(getUser(next.assignedTo), `${titleCase(next.type)} track`)}</div><button class="btn btn--outline btn--full mt-2" data-open-task="${next.id}">Inspect task</button>` : emptyState('All nine tasks complete', 'This project has passed every delivery gate.', '', 'check')}</section><section class="card card--pad"><div class="eyebrow">Idea owner</div><div class="mt-2">${person(owner, 'Original proposal owner')}</div><a class="btn btn--ghost btn--full mt-2" href="#/app/ideas/${project.ideaId}">View source idea ${icon('arrow-up-right', 'icon--sm')}</a></section><section class="card card--pad"><div class="eyebrow">Co-working room</div><h3 class="mt-1" style="font:600 17px var(--font-display)">Shared canvas</h3><p class="small muted mt-1">Presence, simulated cursors, visual notes, and local snapshots.</p><a class="btn btn--soft btn--full mt-2" href="#/app/coworking/${project.id}">${icon('pen')} Open canvas</a></section></aside></div>`;
}

function contributorsPanel(project) {
  const ids = [...new Set(project.tasks.map(task => task.assignedTo))];
  return `<section class="card card--flush"><div class="card-head"><div><h2>Contributor attribution</h2><p>Role, assigned tracks, and contribution weights remain attached to project history.</p></div></div><div class="table-wrap" style="border:0;border-radius:0"><table class="data-table"><thead><tr><th>Contributor</th><th>Project responsibilities</th><th>Tasks</th><th>Contribution weight</th><th>Status</th></tr></thead><tbody>${ids.map(id => { const user = getUser(id); const tasks = project.tasks.filter(task => task.assignedTo === id); const weight = tasks.reduce((sum, task) => sum + task.weight, 0); return `<tr><td>${person(user, user?.email)}</td><td>${tasks.map(task => plainBadge(task.type)).join(' ')}</td><td>${tasks.filter(task => task.status === 'DONE').length} done / ${tasks.length} assigned</td><td><strong>${weight}%</strong></td><td>${badge(user?.status || 'unknown')}</td></tr>`; }).join('')}</tbody></table></div></section>${notice('Weights are task-level mock fixtures for interface demonstration. Production payout calculations must use the server’s recorded project-member weights.', 'info')}`;
}

function assetsPanel(project) {
  const assets = assetsFor(project);
  return `<section class="card card--pad"><div class="spread mb-2"><div><div class="eyebrow">Organization assets</div><h2 class="mt-1" style="font:600 20px var(--font-display)">Deliverables & handoffs</h2></div><button class="btn btn--primary btn--sm" id="add-asset">${icon('plus', 'icon--sm')} Add local reference</button></div>${assets.length ? `<div class="asset-grid">${assets.map(asset => { const contributor = getUser(asset.contributorId); return `<button class="asset-card" data-asset-id="${asset.id}" style="text-align:left"><span class="asset-card__icon">${icon(asset.type === 'design' ? 'pen' : asset.type === 'testing' ? 'check-square' : 'file')}</span><h3>${escapeHTML(asset.title)}</h3><p>${titleCase(asset.type)} · ORG owned${asset.localOnly ? ' · local filename/reference only' : ''}</p><span class="asset-card__foot"><span>${escapeHTML(contributor?.name || 'Project team')}</span><span>${formatDate(asset.createdAt, { year: false })}</span></span></button>`; }).join('')}</div>` : emptyState('No project assets', 'Add a local reference to preview the organization-owned asset state.', '', 'upload')}</section>`;
}

function revenuePanel(project) {
  const user = currentUser(); const canSeeDetailed = user?.role === 'admin' || project.ownerId === user?.id;
  const months = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6+'];
  const ledger = state.data.ledger.filter(row => row.projectId === project.id);
  const aggregate = ledger.reduce((sum, row) => sum + row.amount, 0);
  return `<div class="stack"><section class="card card--pad"><div class="eyebrow">Revenue rule</div><h2 class="mt-1" style="font:600 21px var(--font-display)">Five shared months. Then Team 100%.</h2><p class="small muted mt-1">The current service evidence applies Owner 50% / Team 50% for months one through five, then Team 100%. Payouts always require manual Admin approval.</p><div class="revenue-timeline">${months.map((month, index) => `<div class="revenue-month ${index >= 5 ? 'is-team' : ''}"><div class="revenue-month__bar"><span style="height:${index >= 5 ? 100 : 50}%"></span></div><small>${month}</small><strong>${index >= 5 ? 'Team 100%' : '50 / 50'}</strong></div>`).join('')}</div>${!project.revenueStart ? notice('The revenue clock has not started in this mock project. The timeline explains the rule; it does not represent accrued earnings.', 'info') : notice(`Revenue clock started ${formatDate(project.revenueStart)}. This live mock project is beyond the initial five-month split window.`, 'success')}</section><section class="card card--flush"><div class="card-head"><div><h2>${canSeeDetailed ? 'Recorded project splits' : 'Aggregate project earnings'}</h2><p>${canSeeDetailed ? 'Owner/Admin detailed ledger view.' : 'Detailed rows are restricted to the project owner and Admin.'}</p></div></div>${canSeeDetailed ? (ledger.length ? `<div class="table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Contributor</th><th>Source</th><th>Rule</th><th>Period</th><th>Amount</th></tr></thead><tbody>${ledger.map(row => `<tr><td>${person(getUser(row.userId), getUser(row.userId)?.role)}</td><td class="cell-title">${escapeHTML(row.source)}</td><td>${escapeHTML(row.rule)}</td><td>${escapeHTML(row.month)}</td><td class="text-success strong">${formatINR(row.amount)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No earnings entries', 'No revenue splits have been recorded for this project in the mock ledger.', '', 'wallet')) : `<div class="card-body"><div class="stat-card"><div class="stat-card__label">Aggregate recorded team earnings</div><div class="stat-card__value">${formatINR(aggregate)}</div><div class="stat-card__note">Combined project total; no contributor-level rows disclosed</div></div><div class="mt-2">${notice('Detailed project earnings are visible only to the project owner and Admin. Your own wallet history remains available in your profile.', 'info', 'Aggregate-only member view', 'lock')}</div></div>`}</section></div>`;
}

export function renderProjectDetail(id) {
  const project = getProject(id); const user = currentUser();
  if (!project) return { html: `${pageHead('Projects', 'Project not found')}${emptyState('This project does not exist', 'Return to the pipeline to choose an available mock project.', '<a class="btn btn--primary" href="#/app/projects">Back to projects</a>', 'folder')}` };
  const canView = user?.role === 'admin' || project.ownerId === user?.id || project.tasks.some(task => task.assignedTo === user?.id);
  if (!canView) return { html: `${pageHead('Project access', 'Assigned members only')}${notice('This project is not in your assigned workspace. Admin can view all projects.', 'danger', 'Access restricted', 'lock')}` };
  const canReview = user?.role === 'admin' && ['ADMIN_REVIEW', 'REJECTED_AT_REVIEW'].includes(project.stage);
  const content = `<div data-tab-scope><section data-tab-panel="overview">${projectOverview(project)}</section><section data-tab-panel="tasks" hidden><div class="filter-bar"><div class="field"><label for="detail-task-filter">Task status</label><select class="select" id="detail-task-filter"><option value="all">All statuses</option><option>TODO</option><option>BLOCKED</option><option>IN_PROGRESS</option><option>DONE</option></select></div><div class="field"><label for="detail-assignee-filter">Assignee</label><select class="select" id="detail-assignee-filter"><option value="all">All contributors</option>${[...new Set(project.tasks.map(task => task.assignedTo))].map(id => `<option value="${id}">${escapeHTML(getUser(id)?.name)}</option>`).join('')}</select></div></div><div class="task-list" id="project-task-list">${project.tasks.map(task => taskRow(task, project)).join('')}</div></section><section data-tab-panel="assets" hidden>${assetsPanel(project)}</section><section data-tab-panel="contributors" hidden>${contributorsPanel(project)}</section><section data-tab-panel="revenue" hidden>${revenuePanel(project)}</section></div>`;
  const html = `${pageHead(`${project.code} · ${stageMeta[project.stage]?.label || titleCase(project.stage)}`, escapeHTML(project.title), 'Project context, dependencies, contributors, organization assets, and financial history in one operational view.', `<a class="btn btn--outline" href="#/app/projects">${icon('arrow-left')} Pipeline</a><a class="btn btn--outline" href="#/app/coworking/${project.id}">${icon('pen')} Canvas</a>${canReview ? `<button class="btn btn--primary" id="final-review">${icon('shield')} Final review</button>` : ''}`)}<div class="tabs" data-tabs role="tablist" aria-label="Project sections">${[['overview', 'Overview'], ['tasks', `Tasks ${project.tasks.length}`], ['assets', `Assets ${assetsFor(project).length}`], ['contributors', 'Contributors'], ['revenue', 'Revenue']].map(([tab, label], index) => `<button class="tab" role="tab" data-tab="${tab}" aria-selected="${index === 0}">${label}</button>`).join('')}</div>${withPreview(content, { title: 'No project detail in this preview', description: 'The empty-state preview hides tasks, assets, and financial entries.', icon: 'folder' })}`;
  return { html, mount() {
    bindTabs(document);
    document.querySelectorAll('[data-show-tab]').forEach(button => button.addEventListener('click', () => document.querySelector(`[data-tab="${button.dataset.showTab}"]`)?.click()));
    document.querySelectorAll('[data-open-task]').forEach(button => button.addEventListener('click', () => openTaskDialog(button.dataset.openTask)));
    const statusFilter = document.querySelector('#detail-task-filter'); const assigneeFilter = document.querySelector('#detail-assignee-filter');
    const filter = () => document.querySelectorAll('#project-task-list [data-task-status]').forEach(task => { task.hidden = !((statusFilter.value === 'all' || task.dataset.taskStatus === statusFilter.value) && (assigneeFilter.value === 'all' || task.dataset.taskAssignee === assigneeFilter.value)); });
    statusFilter?.addEventListener('change', filter); assigneeFilter?.addEventListener('change', filter);
    document.querySelector('#add-asset')?.addEventListener('click', () => openAssetDialog(project.id));
    document.querySelectorAll('[data-asset-id]').forEach(button => button.addEventListener('click', () => {
      const asset = assetsFor(project).find(item => item.id === button.dataset.assetId); const contributor = getUser(asset.contributorId);
      openDialog({ title: escapeHTML(asset.title), subtitle: 'Organization-owned project asset', content: `<dl class="definition-list"><dt>Asset type</dt><dd>${titleCase(asset.type)}</dd><dt>Contributor</dt><dd>${escapeHTML(contributor?.name || 'Project team')}</dd><dt>Ownership</dt><dd>DEFAULT_ORG</dd><dt>Storage</dt><dd>${asset.localOnly ? 'Local metadata only; no file uploaded' : 'Mock asset record; no remote file'}</dd></dl>${notice('File storage and delivery are unavailable in this frontend phase. This dialog displays asset metadata only.', 'info')}`, footer: '<button class="btn btn--primary" data-close-dialog>Close</button>' });
    }));
    document.querySelector('#final-review')?.addEventListener('click', () => openFinalReview(project.id));
  } };
}

export function openTaskDialog(taskId) {
  const project = state.data.projects.find(item => item.tasks.some(task => task.id === taskId));
  const task = project?.tasks.find(item => item.id === taskId); if (!task) return;
  const user = currentUser(); const assignee = getUser(task.assignedTo); const missing = missingPrerequisites(task, project);
  const canEdit = user?.status === 'active' && (user.role === 'admin' || (task.assignedTo === user.id && (user.role !== 'designer' || task.type === 'design')));
  const actionButtons = canEdit && task.status !== 'BLOCKED' && task.status !== 'DONE' ? `${task.status === 'TODO' ? `<button class="btn btn--outline" data-task-update="IN_PROGRESS">Start task</button>` : ''}<button class="btn btn--primary" data-task-update="DONE">${icon('check')} Mark done</button>` : '';
  openDialog({ title: escapeHTML(task.name), subtitle: `${escapeHTML(project.title)} · ${titleCase(task.type)} track`, wide: true, content: `<div class="spread"><div>${person(assignee, `${titleCase(assignee?.role || '')}${assignee?.subRole ? ` · ${assignee.subRole}` : ''}`)}</div>${badge(task.status)}</div><div class="project-stats mt-2"><div class="project-stat"><span>Contribution weight</span><strong>${task.weight}%</strong></div><div class="project-stat"><span>Prerequisites</span><strong>${task.dependsOn.length}</strong></div><div class="project-stat"><span>Last updated</span><strong style="font-size:13px">${formatDate(task.updatedAt, { year: false })}</strong></div><div class="project-stat"><span>Track</span><strong style="font-size:13px">${titleCase(task.type)}</strong></div></div><div class="mt-3"><div class="eyebrow mb-1">Dependency contract</div>${task.dependsOn.length ? `<div class="checklist">${task.dependsOn.map(name => { const prerequisite = project.tasks.find(item => item.name === name); return `<div class="checklist-item ${prerequisite?.status === 'DONE' ? 'is-done' : ''}"><span class="checklist-item__mark">${icon(prerequisite?.status === 'DONE' ? 'check' : 'lock')}</span><div><strong>${escapeHTML(name)}</strong><p>${prerequisite?.status || 'Missing task'} · all listed prerequisites must be DONE.</p></div></div>`; }).join('')}</div>` : '<p class="small muted">No prerequisite. This is the initial research task.</p>'}</div>${missing.length && task.status === 'BLOCKED' ? `<div class="mt-2">${notice(`Cannot start until all prerequisites are DONE: ${missing.join(', ')}.`, 'warning', 'Task blocked', 'lock')}</div>` : ''}<div class="mt-3"><div class="eyebrow mb-1">Deliverable reference</div>${task.deliverable ? `<div class="recording-row"><span class="recording-row__icon">${icon('file')}</span><div><strong>${escapeHTML(task.deliverable)}</strong><small>Mock reference; no stored file</small></div></div>` : '<p class="small muted">No deliverable reference recorded.</p>'}${canEdit && task.status !== 'DONE' ? `<div class="field mt-2"><label for="task-file">Add a local filename reference</label><input class="input" id="task-file" type="file"><span class="field-hint">The selected file is never read or uploaded. Only its filename is used as a mock deliverable label.</span></div>` : ''}</div>`, footer: `${user?.role === 'admin' ? '<button class="btn btn--ghost" id="reassign-task">Reassign</button>' : ''}<button class="btn btn--outline" data-close-dialog>Close</button>${actionButtons}`, onMount(dialog) {
    dialog.querySelectorAll('[data-task-update]').forEach(button => button.addEventListener('click', () => {
      const newStatus = button.dataset.taskUpdate;
      if (task.status === 'BLOCKED' && missing.length) return toast('This task still has incomplete prerequisites.', 'error');
      task.status = newStatus; task.updatedAt = new Date().toISOString(); task.completedAt = newStatus === 'DONE' ? new Date().toISOString() : null;
      const file = dialog.querySelector('#task-file')?.files?.[0]; if (file) task.deliverable = `${file.name} (local reference only)`;
      const unblocked = [];
      if (newStatus === 'DONE') project.tasks.filter(item => item.status === 'BLOCKED').forEach(item => { if (missingPrerequisites(item, project).length === 0) { item.status = 'TODO'; item.updatedAt = new Date().toISOString(); unblocked.push(item); addNotification(item.assignedTo, 'task', `Task “${item.name}” is now unblocked in ${project.title}.`, `#/app/projects/${project.id}`); } });
      project.stage = evaluateStage(project);
      addAudit(`task_status_${newStatus.toLowerCase()}`, `task:${task.id} ${task.name} -> ${newStatus}; project stage ${project.stage}`, 'projects'); persistData(); closeDialog();
      toast(`${task.name} marked ${titleCase(newStatus)} in local mock data.${unblocked.length ? ` ${unblocked.length} dependent task(s) unblocked.` : ''}`);
      window.dispatchEvent(new CustomEvent('app:refresh'));
    }));
    dialog.querySelector('#task-file')?.addEventListener('change', event => { if (event.target.files[0]) { task.deliverable = `${event.target.files[0].name} (local reference only)`; persistData(); toast('Filename saved locally. The file was not uploaded.', 'info'); } });
    dialog.querySelector('#reassign-task')?.addEventListener('click', () => openReassignDialog(project.id, task.id));
  } });
}

function compatible(task, user) {
  if (user.role === 'admin') return true;
  if (task.type === 'research') return user.role === 'researcher';
  if (task.type === 'backend') return user.role === 'developer' && user.subRole !== 'frontend';
  if (task.type === 'frontend') return user.role === 'developer' && user.subRole !== 'backend';
  if (task.type === 'design') return user.role === 'designer';
  if (task.type === 'testing') return user.role === 'producer';
  if (task.type === 'review') return user.role === 'admin';
  return true;
}

function openReassignDialog(projectId, taskId) {
  const project = getProject(projectId); const task = project.tasks.find(item => item.id === taskId);
  openDialog({ title: 'Reassign task', subtitle: `${task.name} · Admin action`, content: `<form id="reassign-form" class="stack"><div class="field"><label for="reassign-user">Active member</label><select class="select" id="reassign-user" name="userId">${state.data.users.filter(user => user.status === 'active').map(user => `<option value="${user.id}" ${user.id === task.assignedTo ? 'selected' : ''}>${escapeHTML(user.name)} — ${titleCase(user.role)}${user.subRole ? ` / ${user.subRole}` : ''}${compatible(task, user) ? '' : ' (cross-role)'}</option>`).join('')}</select></div><label class="check"><input type="checkbox" name="allowCrossRole"><span>Allow an executive cross-role reassignment when the selected member does not match this task type.</span></label>${notice('Role-compatible reassignment is preferred. Cross-role use is recorded as an executive override in the local audit fixture.', 'warning')}</form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-reassignment">Save reassignment</button>', onMount(dialog) {
    dialog.querySelector('#save-reassignment').addEventListener('click', () => {
      const values = formValues(dialog.querySelector('#reassign-form')); const target = getUser(values.userId);
      if (!compatible(task, target) && !values.allowCrossRole) return setFormError(dialog.querySelector('#reassign-form'), 'Select a role-compatible member or explicitly allow the executive override.', 'userId');
      const previous = getUser(task.assignedTo); task.assignedTo = target.id; task.updatedAt = new Date().toISOString();
      addAudit('task_reassigned_by_admin', `task:${task.id} ${previous?.name} -> ${target.name}${compatible(task, target) ? '' : ' cross-role override'}`, 'projects', compatible(task, target) ? 'info' : 'warning');
      addNotification(target.id, 'task', `You were assigned “${task.name}” in ${project.title}.`, `#/app/projects/${project.id}`); persistData(); closeDialog(); toast(`Task reassigned to ${target.name} in local mock data.`); window.dispatchEvent(new CustomEvent('app:refresh'));
    });
  } });
}

function openAssetDialog(projectId) {
  openDialog({ title: 'Add organization asset reference', subtitle: 'Metadata only · no upload service', content: `<form id="asset-form" class="stack"><div class="field"><label for="asset-title">Asset title</label><input class="input" id="asset-title" name="title" required placeholder="e.g. Research synthesis v2"></div><div class="field"><label for="asset-type">Asset type</label><select class="select" id="asset-type" name="type"><option value="research">Research</option><option value="design">Design</option><option value="document">Document</option><option value="testing">Testing</option><option value="review">Review</option></select></div><div class="field"><label for="asset-url">Reference URL (optional)</label><input class="input" id="asset-url" name="url" type="url" placeholder="https://…"><span class="field-hint">Stored as local text only; never fetched by this prototype.</span></div><div class="field"><label for="asset-file">Or choose a local filename</label><input class="input" id="asset-file" name="file" type="file"><span class="field-hint">No file contents are read, stored, or uploaded.</span></div>${notice('The asset will be labelled organization-owned with your contributor attribution in local mock data.', 'info')}</form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-asset">Save local reference</button>', onMount(dialog) {
    dialog.querySelector('#save-asset').addEventListener('click', () => {
      const form = dialog.querySelector('#asset-form'); const values = formValues(form); const file = dialog.querySelector('#asset-file').files[0];
      if (!values.title?.trim() && !file) return setFormError(form, 'Add an asset title or choose a filename.', 'title');
      if (values.url && !/^https?:\/\//i.test(values.url)) return setFormError(form, 'Use an http(s) URL or leave the reference blank.', 'url');
      const project = getProject(projectId); project.localAssets ||= [];
      project.localAssets.push({ id: `asset-${Date.now()}`, title: values.title?.trim() || file.name, type: values.type, url: values.url || null, fileName: file?.name || null, contributorId: currentUser().id, organizationOwned: true, localOnly: true, createdAt: new Date().toISOString() });
      addAudit('project_asset_reference_added', `project:${projectId} local metadata only`, 'projects'); persistData(); closeDialog(); toast('Asset reference saved locally. Nothing was uploaded.', 'info'); window.dispatchEvent(new CustomEvent('app:refresh'));
    });
  } });
}

export function openFinalReview(projectId) {
  const project = getProject(projectId); const incomplete = project.tasks.slice(0, 8).filter(task => task.status !== 'DONE');
  openDialog({ title: 'Admin final review gate', subtitle: project.title, content: `${incomplete.length ? notice(`Approval is blocked by: ${incomplete.map(task => task.name).join(', ')}.`, 'danger', 'Eight preceding tasks must be DONE') : notice('All eight preceding tasks are DONE. Approval can move this project to LIVE and archive its co-working room.', 'success', 'Gate requirements satisfied')}<form id="review-form" class="stack mt-2"><div class="field"><label for="review-notes">Review notes</label><textarea class="textarea" id="review-notes" name="notes" placeholder="Record the release or rejection rationale."></textarea></div><div class="field"><label for="review-decision">Decision</label><select class="select" id="review-decision" name="decision"><option value="approved" ${incomplete.length ? 'disabled' : ''}>Approve for LIVE</option><option value="rejected">Reject at review</option></select></div></form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="submit-review">Record local decision</button>', onMount(dialog) {
    dialog.querySelector('#submit-review').addEventListener('click', () => {
      const values = formValues(dialog.querySelector('#review-form')); const approved = values.decision === 'approved';
      if (approved && incomplete.length) return toast('All eight preceding tasks must be DONE before approval.', 'error');
      project.stage = approved ? 'LIVE' : 'REJECTED_AT_REVIEW'; project.status = approved ? 'LIVE' : 'ACTIVE';
      project.reviewDecision = approved ? 'APPROVED' : 'REJECTED'; project.reviewNotes = values.notes?.trim() || null; project.reviewedAt = new Date().toISOString(); project.reviewedBy = currentUser().id;
      if (approved) { const review = project.tasks.find(task => task.type === 'review'); review.status = 'DONE'; review.completedAt = new Date().toISOString(); project.revenueStart ||= new Date().toISOString(); if (state.data.coworking[project.id]) state.data.coworking[project.id].status = 'archived'; }
      addAudit(approved ? 'project_approved_live' : 'project_rejected_at_review', `project:${project.id} notes:${values.notes || 'None'}`, 'projects', approved ? 'info' : 'warning'); persistData(); closeDialog(); toast(`Local final-review decision recorded: ${approved ? 'LIVE' : 'Rejected at review'}.`); window.dispatchEvent(new CustomEvent('app:refresh'));
    });
  } });
}

export { taskRow, evaluateStage };
