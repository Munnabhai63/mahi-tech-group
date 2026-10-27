import { stageMeta } from '../data.js';
import {
  state,
  currentUser,
  getUser,
  getProject,
  projectProgress,
  missingPrerequisites,
  persistData,
  addAudit,
  addNotification,
  formatDate,
  formatDateTime,
  formatINR,
  escapeHTML,
  titleCase,
  fetchProjectAssets
} from '../store.js';
import { api, getAuthToken } from '../api.js';
import {
  icon,
  badge,
  plainBadge,
  avatar,
  person,
  progress,
  pageHead,
  card,
  notice,
  emptyState,
  withPreview,
  openDialog,
  closeDialog,
  confirmDialog,
  toast,
  bindTabs,
  formValues,
  setFormError
} from '../ui.js';
import { renderPipelineDashboard } from './pipeline.js';

function evaluateStage(project) {
  const map = Object.fromEntries((project.tasks || []).map(task => [task.name || task.task_name, task.status]));
  const foundational = (project.tasks || []).slice(0, 7);
  const allFoundational = foundational.length >= 7 && foundational.every(task => task.status === 'DONE');
  if (allFoundational && map['Full QA Testing'] === 'DONE' && map['Admin Final Review'] === 'DONE') return 'LIVE';
  if (allFoundational && map['Full QA Testing'] === 'DONE') return 'ADMIN_REVIEW';
  if (allFoundational && ['TODO', 'IN_PROGRESS'].includes(map['Full QA Testing'])) return 'TESTING';
  if (['Deep Research', 'Backend Architecture Setup', 'Frontend UI Scaffolding', 'UI/UX Design', 'Test Plan Preparation'].some(name => map[name] === 'DONE') || ['Frontend API Integration', 'Feature Logic Lock'].some(name => ['IN_PROGRESS', 'DONE'].includes(map[name]))) return 'INTEGRATION';
  return 'RESEARCH_DEV_PARALLEL';
}

function projectCard(project) {
  const tasks = project.tasks || [];
  const done = tasks.filter(task => task.status === 'DONE').length;
  const contributors = [...new Set(tasks.map(task => task.assignedTo || task.assigned_to))].map(getUser).filter(Boolean);
  return `<button class="project-card" data-project-id="${project.id}" data-search="${escapeHTML(`${project.title} ${project.code || ''}`.toLowerCase())}"><span class="project-card__top"><span class="project-card__code">${project.code || 'PRJ'}</span>${badge(project.stage || project.current_stage)}</span><h3>${escapeHTML(project.title)}</h3><p>${escapeHTML(project.summary || project.description || '')}</p>${progress(projectProgress(project))}<span class="project-card__foot"><span class="avatar-stack">${contributors.slice(0, 3).map(user => avatar(user, 'sm')).join('')}</span><small>${done}/9 tasks</small></span></button>`;
}

export function renderProjects() {
  const user = currentUser();
  const projects = user?.role === 'admin' ? state.data.projects : state.data.projects.filter(project => project.ownerId === user?.id || (project.tasks || []).some(task => (task.assignedTo || task.assigned_to) === user?.id));
  const stages = Object.keys(stageMeta).filter(stage => stage !== 'REJECTED_AT_REVIEW' || projects.some(project => (project.stage || project.current_stage) === stage));
  
  const board = `<div class="filter-bar"><div class="field field--search"><label for="project-search">Search projects</label><div class="input-wrap">${icon('search')}<input class="input" id="project-search" placeholder="Search by title or project code"></div></div><div class="field"><label for="project-stage-filter">Pipeline stage</label><select class="select" id="project-stage-filter"><option value="all">All stages</option>${stages.map(stage => `<option value="${stage}">${stageMeta[stage]?.label || titleCase(stage)}</option>`).join('')}</select></div><span class="filter-count" id="project-filter-count">${projects.length} projects</span></div><div class="kanban-board" id="project-board">${stages.map(stage => { const items = projects.filter(project => (project.stage || project.current_stage) === stage); return `<section class="kanban-column" data-stage="${stage}"><div class="kanban-column__head"><h2>${stageMeta[stage]?.label || titleCase(stage)}</h2><span class="kanban-column__count">${items.length}</span></div><div class="kanban-column__body">${items.length ? items.map(projectCard).join('') : '<div class="empty-state" style="padding:25px 8px"><p>No projects at this gate.</p></div>'}</div></section>`; }).join('')}</div>`;
  
  return {
    html: `${pageHead('Organization projects', 'Pipeline, not a black box.', 'Follow every project through parallel tracks, integration, testing, final review, and live operations.', `<a class="btn btn--outline" href="#/app/tasks">${icon('check-square')} My task queue</a>`)}${withPreview(board, { title: 'No projects in this pipeline', description: 'Approved ideas will appear here after project fan-out.', icon: 'folder' })}`,
    mount() {
      document.querySelectorAll('[data-project-id]').forEach(button => button.addEventListener('click', () => { location.hash = `#/app/projects/${button.dataset.projectId}`; }));
      const search = document.querySelector('#project-search');
      const stage = document.querySelector('#project-stage-filter');
      const filter = () => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;
        document.querySelectorAll('.kanban-column').forEach(column => {
          const stageVisible = stage.value === 'all' || column.dataset.stage === stage;
          column.hidden = !stageVisible;
          let columnVisible = 0;
          column.querySelectorAll('[data-project-id]').forEach(project => {
            const show = stageVisible && (!query || project.dataset.search.includes(query));
            project.hidden = !show;
            if (show) { visible++; columnVisible++; }
          });
          const count = column.querySelector('.kanban-column__count');
          if (count && (query || stage.value !== 'all')) count.textContent = columnVisible;
        });
        document.querySelector('#project-filter-count').textContent = `${visible} project${visible === 1 ? '' : 's'}`;
      };
      search?.addEventListener('input', filter);
      stage?.addEventListener('change', filter);

      if (getAuthToken()) {
        api.get('/api/dashboard/kanban').then(res => {
          if (res) {
            const list = [];
            Object.entries(res).forEach(([stg, prjs]) => {
              if (Array.isArray(prjs)) {
                prjs.forEach(p => list.push({
                  id: p.id,
                  code: p.title ? p.title.slice(0, 3).toUpperCase() : 'PRJ',
                  title: p.title,
                  summary: p.description || '',
                  stage: p.current_stage || stg,
                  tasks: p.tasks || []
                }));
              }
            });
            if (list.length) {
              state.data.projects = list;
              filter();
            }
          }
        }).catch(() => {});
      }
    }
  };
}

function taskRow(task, project, mapView = false, index = 0) {
  const user = getUser(task.assignedTo || task.assigned_to);
  const missing = missingPrerequisites(task, project);
  const taskName = task.name || task.task_name || 'Task';
  const taskType = task.type || task.task_type || 'dev';
  const body = `<div><div class="task-card__title"><h3>${escapeHTML(taskName)}</h3>${badge(task.status)}${plainBadge(taskType, 'neutral')}</div><div class="task-card__meta"><span>${icon('user')} ${escapeHTML(user?.name || 'Unassigned')}</span><span>${icon('chart')} Weight ${task.weight || 10}%</span><span>${icon('clock')} ${task.completedAt || task.completed_at ? `Done ${formatDate(task.completedAt || task.completed_at, { year: false })}` : `Updated ${formatDate(task.updatedAt || task.updated_at, { year: false })}`}</span></div>${task.status === 'BLOCKED' && missing.length ? `<div class="dependency-note">${icon('lock')}<span>Waiting for: ${missing.map(escapeHTML).join(', ')}</span></div>` : ''}</div><div class="task-card__actions"><button class="btn btn--outline btn--sm" data-open-task="${task.id}">Details ${icon('chevron-right', 'icon--sm')}</button></div>`;
  if (mapView) return `<div class="task-map__row ${task.status === 'DONE' ? 'is-done' : ''}"><div class="task-map__rail"><span class="task-map__number">${task.status === 'DONE' ? icon('check', 'icon--sm') : String(index + 1).padStart(2, '0')}</span></div><article class="task-card ${task.status === 'BLOCKED' ? 'is-blocked' : ''}">${body}</article></div>`;
  return `<article class="task-card ${task.status === 'BLOCKED' ? 'is-blocked' : ''}" data-task-status="${task.status}" data-task-assignee="${task.assignedTo || task.assigned_to}">${body}</article>`;
}

function assetsFor(project) {
  const liveAssets = state.live.projectAssets[project.id];
  if (liveAssets?.length) {
    return liveAssets.map(a => ({
      id: a.id,
      title: a.description || a.type,
      type: a.type,
      url: a.url,
      contributorName: a.uploaded_by_label || a.uploaded_by_name || 'Contributor',
      organizationOwned: true,
      createdAt: a.created_at
    }));
  }
  const defaults = [
    ['Research handoff', 'research', 'u-research'], ['Service flow and screen map', 'design', 'u-design'], ['API contract notes', 'document', 'u-dev-back'], ['Acceptance report', 'testing', 'u-producer'], ['Release checklist', 'review', 'u-admin']
  ];
  return defaults.slice(0, Math.min(defaults.length, project.assetCount || 0)).map((asset, index) => ({ id: `${project.id}-asset-${index}`, title: asset[0], type: asset[1], contributorName: 'Project team', organizationOwned: true, createdAt: project.createdAt }));
}

function projectOverview(project) {
  const owner = getUser(project.ownerId || project.owner_id);
  const tasks = project.tasks || [];
  const contributors = [...new Set(tasks.map(task => task.assignedTo || task.assigned_to))].map(getUser).filter(Boolean);
  const next = tasks.find(task => task.status !== 'DONE');
  const stage = project.stage || project.current_stage || 'RESEARCH_DEV_PARALLEL';

  return `<div class="grid-main-side"><div class="stack"><section class="card card--pad"><div class="project-identity"><span class="project-identity__mark">${(project.code || 'PRJ').slice(-2)}</span><div><h2>${escapeHTML(project.title)}</h2><p>${project.code || 'PRJ'} · Organization-owned project · Created ${formatDate(project.createdAt || project.created_at)}</p></div></div><p class="mt-2 muted">${escapeHTML(project.summary || project.description || '')}</p><div class="divider"></div>${progress(projectProgress(project), 'Delivery progress')}<div class="project-stats mt-2"><div class="project-stat"><span>Current gate</span><strong style="font-size:15px">${stageMeta[stage]?.short || titleCase(stage)}</strong></div><div class="project-stat"><span>Tasks complete</span><strong>${tasks.filter(task => task.status === 'DONE').length}/${tasks.length || 9}</strong></div><div class="project-stat"><span>Contributors</span><strong>${contributors.length}</strong></div><div class="project-stat"><span>Assets</span><strong>${assetsFor(project).length}</strong></div></div></section><section class="card card--pad"><div class="spread mb-2"><div><div class="eyebrow">Dependency map</div><h2 class="mt-1" style="font:600 20px var(--font-display)">Delivery tasks</h2></div><button class="btn btn--ghost btn--sm" data-show-tab="tasks">Open full task list ${icon('arrow-up-right', 'icon--sm')}</button></div><div class="task-map">${tasks.map((task, index) => taskRow(task, project, true, index)).join('')}</div></section></div><aside class="stack"><section class="card card--pad"><div class="eyebrow">Current focus</div>${next ? `<h2 class="mt-1" style="font:600 20px var(--font-display)">${escapeHTML(next.name || next.task_name)}</h2><p class="small muted mt-1">${next.status === 'BLOCKED' ? 'Blocked until every prerequisite is complete.' : 'The next incomplete task in the delivery map.'}</p><div class="mt-2">${person(getUser(next.assignedTo || next.assigned_to), `${titleCase(next.type || next.task_type || 'dev')} track`)}</div><button class="btn btn--outline btn--full mt-2" data-open-task="${next.id}">Inspect task</button>` : emptyState('All tasks complete', 'This project has passed every delivery gate.', '', 'check')}</section><section class="card card--pad"><div class="eyebrow">Idea owner</div><div class="mt-2">${person(owner, 'Original proposal owner')}</div><a class="btn btn--ghost btn--full mt-2" href="#/app/ideas/${project.ideaId || project.idea_id}">View source idea ${icon('arrow-up-right', 'icon--sm')}</a></section><section class="card card--pad"><div class="eyebrow">Co-working room</div><h3 class="mt-1" style="font:600 17px var(--font-display)">Shared canvas</h3><p class="small muted mt-1">Presence, cursor sync, and shared notes.</p><a class="btn btn--soft btn--full mt-2" href="#/app/coworking/${project.id}">${icon('pen')} Open canvas</a></section></aside></div>`;
}

function contributorsPanel(project) {
  const tasks = project.tasks || [];
  const ids = [...new Set(tasks.map(task => task.assignedTo || task.assigned_to))];
  return `<section class="card card--flush"><div class="card-head"><div><h2>Contributor attribution</h2><p>Role, assigned tracks, and contribution weights remain permanently attached to project history.</p></div></div><div class="table-wrap" style="border:0;border-radius:0"><table class="data-table"><thead><tr><th>Contributor</th><th>Project responsibilities</th><th>Tasks</th><th>Contribution weight</th><th>Status</th></tr></thead><tbody>${ids.map(id => { const user = getUser(id); const userTasksList = tasks.filter(task => (task.assignedTo || task.assigned_to) === id); const weight = userTasksList.reduce((sum, task) => sum + (task.weight || 10), 0); return `<tr><td>${person(user, user?.email)}</td><td>${userTasksList.map(task => plainBadge(task.type || task.task_type || 'dev')).join(' ')}</td><td>${userTasksList.filter(task => task.status === 'DONE').length} done / ${userTasksList.length} assigned</td><td><strong>${weight}%</strong></td><td>${badge(user?.status || 'active')}</td></tr>`; }).join('')}</tbody></table></div></section>`;
}

function assetsPanel(project) {
  const assets = assetsFor(project);
  return `<section class="card card--pad"><div class="spread mb-2"><div><div class="eyebrow">Organization assets</div><h2 class="mt-1" style="font:600 20px var(--font-display)">Deliverables & handoffs</h2></div><button class="btn btn--primary btn--sm" id="add-asset">${icon('plus', 'icon--sm')} Add asset URL</button></div>${assets.length ? `<div class="asset-grid">${assets.map(asset => `<div class="asset-card" style="text-align:left"><span class="asset-card__icon">${icon('file')}</span><h3>${escapeHTML(asset.title)}</h3><p>${titleCase(asset.type)} · ORG owned</p>${asset.url ? `<a class="small mono link-btn mt-1" href="${escapeHTML(asset.url)}" target="_blank" rel="noopener">Open document ${icon('arrow-up-right', 'icon--sm')}</a>` : ''}<span class="asset-card__foot"><span>${escapeHTML(asset.contributorName)}</span><span>${formatDate(asset.createdAt, { year: false })}</span></span></div>`).join('')}</div>` : emptyState('No project assets', 'Add an asset URL to register a deliverable for this project.', '', 'upload')}</section>`;
}

function revenuePanel(project) {
  const user = currentUser();
  const canSeeDetailed = user?.role === 'admin' || (project.ownerId || project.owner_id) === user?.id;
  const months = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6+'];
  const ledger = state.data.ledger.filter(row => row.projectId === project.id);
  const aggregate = ledger.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return `<div class="stack"><section class="card card--pad"><div class="eyebrow">Revenue rule</div><h2 class="mt-1" style="font:600 21px var(--font-display)">Five shared months. Then Team 100%.</h2><p class="small muted mt-1">Owner 50% / Team 50% for months one through five, then Team 100%. Payouts require manual Admin approval.</p><div class="revenue-timeline">${months.map((month, index) => `<div class="revenue-month ${index >= 5 ? 'is-team' : ''}"><div class="revenue-month__bar"><span style="height:${index >= 5 ? 100 : 50}%"></span></div><small>${month}</small><strong>${index >= 5 ? 'Team 100%' : '50 / 50'}</strong></div>`).join('')}</div></section><section class="card card--flush"><div class="card-head"><div><h2>${canSeeDetailed ? 'Recorded project splits' : 'Aggregate project earnings'}</h2><p>${canSeeDetailed ? 'Owner/Admin detailed ledger view.' : 'Detailed rows are restricted to the project owner and Admin.'}</p></div></div>${canSeeDetailed ? (ledger.length ? `<div class="table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Contributor</th><th>Source</th><th>Rule</th><th>Period</th><th>Amount</th></tr></thead><tbody>${ledger.map(row => `<tr><td>${person(getUser(row.userId), getUser(row.userId)?.role)}</td><td class="cell-title">${escapeHTML(row.source)}</td><td>${escapeHTML(row.rule)}</td><td>${escapeHTML(row.month)}</td><td class="text-success strong">${formatINR(row.amount)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No earnings entries', 'No revenue splits have been recorded for this project.', '', 'wallet')) : `<div class="card-body"><div class="stat-card"><div class="stat-card__label">Aggregate recorded team earnings</div><div class="stat-card__value">${formatINR(aggregate)}</div><div class="stat-card__note">Combined project total; contributor rows private</div></div></div>`}</section></div>`;
}

export function renderProjectDetail(id) {
  const project = getProject(id);
  const user = currentUser();
  if (!project) return { html: `${pageHead('Projects', 'Project not found')}${emptyState('This project does not exist', 'Return to the pipeline to choose an available project.', '<a class="btn btn--primary" href="#/app/projects">Back to projects</a>', 'folder')}` };
  
  const tasks = project.tasks || [];
  const canView = user?.role === 'admin' || (project.ownerId || project.owner_id) === user?.id || tasks.some(task => (task.assignedTo || task.assigned_to) === user?.id);
  if (!canView) return { html: `${pageHead('Project access', 'Assigned members only')}${notice('This project is not in your assigned workspace. Admin can view all projects.', 'danger', 'Access restricted', 'lock')}` };
  
  const stage = project.stage || project.current_stage || 'RESEARCH_DEV_PARALLEL';
  const canReview = user?.role === 'admin' && ['ADMIN_REVIEW', 'REJECTED_AT_REVIEW'].includes(stage);
  
  const content = `<div data-tab-scope><section data-tab-panel="overview">${projectOverview(project)}</section><section data-tab-panel="pipeline" hidden><div id="pipeline-view-container"></div></section><section data-tab-panel="point-pool" hidden><div class="card card--pad"><div class="spread mb-2"><div><div class="eyebrow">PRD 16 Feature</div><h2 class="mt-1" style="font:600 20px var(--font-display)">Point Pool & Checklist Board</h2><p class="small muted mt-1">Multi-member point pool board. Claim points by stage, manage tool links, and inspect abandoned tasks.</p></div><a class="btn btn--primary btn--sm" href="/point-pool-board.html?projectId=${project.id}" target="_blank">Open Full Board ↗</a></div><iframe src="/point-pool-board.html?projectId=${project.id}&embedded=true&v=179313" style="width:100%;height:850px;border:none;border-radius:8px;background:#090d16;"></iframe></div></section><section data-tab-panel="participation" hidden><div class="card card--pad"><div class="spread mb-2"><div><div class="eyebrow">PRD 16 Feature</div><h2 class="mt-1" style="font:600 20px var(--font-display)">Participation % & Thresholds</h2><p class="small muted mt-1">Multi-member contribution tracking, personal threshold standing, and revenue gates.</p></div><a class="btn btn--primary btn--sm" href="/participation-dashboard.html?projectId=${project.id}" target="_blank">Open Participation Dashboard ↗</a></div><iframe src="/participation-dashboard.html?projectId=${project.id}&embedded=true&v=179313" style="width:100%;height:850px;border:none;border-radius:8px;background:#090d16;"></iframe></div></section><section data-tab-panel="github" hidden><div class="card card--pad"><div class="spread mb-2"><div><div class="eyebrow">PRD 17 Feature</div><h2 class="mt-1" style="font:600 20px var(--font-display)">GitHub Repository & GitFlow</h2><p class="small muted mt-1">Dedicated repository status, branch architecture, and team permissions.</p></div><a class="btn btn--primary btn--sm" href="/github-repo-panel.html?projectId=${project.id}" target="_blank">Open Full Panel ↗</a></div><iframe src="/github-repo-panel.html?projectId=${project.id}&embedded=true&v=179313" style="width:100%;height:850px;border:none;border-radius:8px;background:#090d16;"></iframe></div></section><section data-tab-panel="tasks" hidden><div class="filter-bar"><div class="field"><label for="detail-task-filter">Task status</label><select class="select" id="detail-task-filter"><option value="all">All statuses</option><option>TODO</option><option>BLOCKED</option><option>IN_PROGRESS</option><option>DONE</option></select></div></div><div class="task-list" id="project-task-list">${tasks.map(task => taskRow(task, project)).join('')}</div></section><section data-tab-panel="assets" hidden>${assetsPanel(project)}</section><section data-tab-panel="contributors" hidden>${contributorsPanel(project)}</section><section data-tab-panel="revenue" hidden>${revenuePanel(project)}</section></div>`;
  
  const html = `${pageHead(`${project.code || 'PRJ'} · ${stageMeta[stage]?.label || titleCase(stage)}`, escapeHTML(project.title), 'Project context, dependencies, contributors, organization assets, and financial history.', `<a class="btn btn--outline" href="#/app/projects">${icon('arrow-left')} Pipeline</a><a class="btn btn--outline" href="#/app/coworking/${project.id}">${icon('pen')} Canvas</a>${canReview ? `<button class="btn btn--primary" id="final-review">${icon('shield')} Final review</button>` : ''}`)}<div class="tabs" data-tabs role="tablist" aria-label="Project sections">${[['overview', 'Overview'], ['pipeline', 'Pipeline'], ['point-pool', 'Point Pool'], ['participation', 'Participation %'], ['github', 'GitHub'], ['tasks', `Tasks ${tasks.length}`], ['assets', `Assets ${assetsFor(project).length}`], ['contributors', 'Contributors'], ['revenue', 'Revenue']].map(([tab, label], index) => `<button class="tab" role="tab" data-tab="${tab}" aria-selected="${index === 0}">${label}</button>`).join('')}</div>${withPreview(content, { title: 'No project detail in this preview', description: 'The empty-state preview hides tasks, assets, and financial entries.', icon: 'folder' })}`;
  
  return {
    html,
    mount() {
      bindTabs(document);
      document.querySelectorAll('[data-show-tab]').forEach(button => button.addEventListener('click', () => document.querySelector(`[data-tab="${button.dataset.showTab}"]`)?.click()));
      document.querySelectorAll('[data-open-task]').forEach(button => button.addEventListener('click', () => openTaskDialog(button.dataset.openTask)));
      document.querySelector('#add-asset')?.addEventListener('click', () => openAssetDialog(project.id));
      document.querySelector('#final-review')?.addEventListener('click', () => openFinalReview(project.id));
      
      const pipelineMount = document.querySelector('#pipeline-view-container');
      if (pipelineMount) {
        renderPipelineDashboard(project.id, pipelineMount);
      }
      document.querySelector('[data-tab="pipeline"]')?.addEventListener('click', () => {
        if (pipelineMount) {
          renderPipelineDashboard(project.id, pipelineMount);
        }
      });

      if (getAuthToken()) {
        fetchProjectAssets(project.id);
      }
    }
  };
}

export function openTaskDialog(taskId) {
  const project = state.data.projects.find(item => (item.tasks || []).some(task => task.id === taskId));
  const task = project?.tasks?.find(item => item.id === taskId);
  if (!task) return;
  
  const user = currentUser();
  const assignee = getUser(task.assignedTo || task.assigned_to);
  const missing = missingPrerequisites(task, project);
  const canEdit = user?.status === 'active' && (user.role === 'admin' || (task.assignedTo || task.assigned_to) === user.id);
  const actionButtons = canEdit && task.status !== 'BLOCKED' && task.status !== 'DONE' ? `${task.status === 'TODO' ? `<button class="btn btn--outline" id="btn-in-progress" data-task-update="IN_PROGRESS">Start task</button>` : ''}<button class="btn btn--primary" id="btn-mark-done" data-task-update="DONE">${icon('check')} Mark done</button>` : '';
  
  const taskName = task.name || task.task_name;
  const taskType = task.type || task.task_type || 'dev';
  const dependsOn = task.dependsOn || [];

  openDialog({
    title: escapeHTML(taskName),
    subtitle: `${escapeHTML(project.title)} · ${titleCase(taskType)} track`,
    wide: true,
    content: `<div class="spread"><div>${person(assignee, `${titleCase(assignee?.role || '')}${assignee?.subRole ? ` · ${assignee.subRole}` : ''}`)}</div>${badge(task.status)}</div><div class="project-stats mt-2"><div class="project-stat"><span>Contribution weight</span><strong>${task.weight || 10}%</strong></div><div class="project-stat"><span>Prerequisites</span><strong>${dependsOn.length}</strong></div><div class="project-stat"><span>Track</span><strong style="font-size:13px">${titleCase(taskType)}</strong></div></div><div class="mt-3"><div class="eyebrow mb-1">Dependency contract</div>${dependsOn.length ? `<div class="checklist">${dependsOn.map(name => { const prerequisite = project.tasks.find(item => (item.name || item.task_name) === name); return `<div class="checklist-item ${prerequisite?.status === 'DONE' ? 'is-done' : ''}"><span class="checklist-item__mark">${icon(prerequisite?.status === 'DONE' ? 'check' : 'lock')}</span><div><strong>${escapeHTML(name)}</strong><p>${prerequisite?.status || 'Missing task'} · all listed prerequisites must be DONE.</p></div></div>`; }).join('')}</div>` : '<p class="small muted">No prerequisite. Initial track task.</p>'}</div>${missing.length && task.status === 'BLOCKED' ? `<div class="mt-2">${notice(`Cannot start until all prerequisites are DONE: ${missing.join(', ')}.`, 'warning', 'Task blocked', 'lock')}</div>` : ''}<div class="mt-3"><div class="eyebrow mb-1">Deliverable URL reference</div>${canEdit && task.status !== 'DONE' ? `<div class="field mt-2"><label for="task-url">Deliverable URL (optional text reference)</label><input class="input" id="task-url" type="url" placeholder="https://github.com/... or Figma link"><span class="field-hint">Enter your pull request, branch, or design prototype URL.</span></div>` : ''}</div>`,
    footer: `${user?.role === 'admin' ? '<button class="btn btn--ghost" id="reassign-task">Reassign</button>' : ''}<button class="btn btn--outline" data-close-dialog>Close</button>${actionButtons}`,
    onMount(dialog) {
      dialog.querySelectorAll('[data-task-update]').forEach(button => button.addEventListener('click', async () => {
        const newStatus = button.dataset.taskUpdate;
        if (task.status === 'BLOCKED' && missing.length) return toast('This task still has incomplete prerequisites.', 'error');
        
        button.disabled = true;
        button.textContent = 'Updating...';

        try {
          if (getAuthToken()) {
            const res = await api.patch(`/api/tasks/${task.id}/status`, { status: newStatus });
            task.status = newStatus;
            toast(res.message || `Task updated to ${newStatus}`, 'success');
            
            // Refresh tasks
            api.get('/api/projects/my-tasks').then(tRes => {
              if (tRes?.tasks) state.live.myTasks = tRes.tasks;
            }).catch(() => {});
          } else {
            task.status = newStatus;
            task.updatedAt = new Date().toISOString();
            persistData();
            toast(`${taskName} marked ${titleCase(newStatus)}.`);
          }
          closeDialog();
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          button.disabled = false;
          button.textContent = newStatus === 'DONE' ? 'Mark done' : 'Start task';
          toast(err.message || 'Failed to update task status.', 'error');
        }
      }));

      dialog.querySelector('#reassign-task')?.addEventListener('click', () => openReassignDialog(project.id, task.id));
    }
  });
}

function openReassignDialog(projectId, taskId) {
  const project = getProject(projectId);
  const task = project.tasks.find(item => item.id === taskId);
  openDialog({
    title: 'Reassign task',
    subtitle: `${task.name || task.task_name} · Admin action`,
    content: `<form id="reassign-form" class="stack"><div class="field"><label for="reassign-user">Active member</label><select class="select" id="reassign-user" name="userId">${state.data.users.filter(user => user.status === 'active').map(user => `<option value="${user.id}" ${user.id === (task.assignedTo || task.assigned_to) ? 'selected' : ''}>${escapeHTML(user.name)} — ${titleCase(user.role)}</option>`).join('')}</select></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-reassignment">Save reassignment</button>',
    onMount(dialog) {
      dialog.querySelector('#save-reassignment').addEventListener('click', async () => {
        const values = formValues(dialog.querySelector('#reassign-form'));
        const btn = dialog.querySelector('#save-reassignment');
        btn.disabled = true;
        btn.textContent = 'Reassigning...';

        try {
          if (getAuthToken()) {
            await api.patch(`/api/admin/projects/${projectId}/reassign`, {
              taskId,
              newUserId: values.userId,
              allowCrossRole: true
            });
            toast('Task reassigned successfully.', 'success');
          } else {
            task.assignedTo = values.userId;
            persistData();
            toast('Task reassigned locally.');
          }
          closeDialog();
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Save reassignment';
          toast(err.message || 'Failed to reassign task.', 'error');
        }
      });
    }
  });
}

function openAssetDialog(projectId) {
  openDialog({
    title: 'Add organization asset URL',
    subtitle: 'Register project deliverable URL reference',
    content: `<form id="asset-form" class="stack"><div class="field"><label for="asset-title">Asset description / title</label><input class="input" id="asset-title" name="description" required placeholder="e.g. Production API Spec v1"></div><div class="field"><label for="asset-type">Asset type</label><select class="select" id="asset-type" name="type"><option value="pdf_doc">Document (PDF/Doc)</option><option value="design_file">Design (Figma/Prototype)</option><option value="code_repo">Source Code / Repo</option><option value="domain">Domain / Web Property</option><option value="app_listing">App Listing / Store</option><option value="other">Other Asset</option></select></div><div class="field"><label for="asset-url">Deliverable URL</label><input class="input" id="asset-url" name="url" type="url" required placeholder="https://…"><span class="field-hint">Enter the URL to your asset stored in Google Drive, GitHub, Figma, etc.</span></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-asset">Register asset</button>',
    onMount(dialog) {
      dialog.querySelector('#save-asset').addEventListener('click', async () => {
        const form = dialog.querySelector('#asset-form');
        const btn = dialog.querySelector('#save-asset');
        const values = formValues(form);

        if (!values.description?.trim()) return setFormError(form, 'Add a description for the asset.', 'description');
        if (!values.url || !/^https?:\/\//i.test(values.url)) return setFormError(form, 'Provide a valid http(s) URL.', 'url');

        btn.disabled = true;
        btn.textContent = 'Saving...';

        try {
          if (getAuthToken()) {
            await api.post(`/api/projects/${projectId}/assets`, {
              type: values.type,
              url: values.url.trim(),
              description: values.description.trim()
            });
            toast('Asset registered successfully.', 'success');
            await fetchProjectAssets(projectId);
          } else {
            const project = getProject(projectId);
            project.localAssets = project.localAssets || [];
            project.localAssets.push({
              id: `asset-${Date.now()}`,
              title: values.description.trim(),
              type: values.type,
              url: values.url.trim(),
              contributorName: currentUser().name,
              organizationOwned: true,
              createdAt: new Date().toISOString()
            });
            persistData();
            toast('Asset saved locally.');
          }
          closeDialog();
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Register asset';
          setFormError(form, err.message || 'Failed to save asset.');
        }
      });
    }
  });
}

export function openFinalReview(projectId) {
  const project = getProject(projectId);
  const tasks = project.tasks || [];
  const incomplete = tasks.slice(0, 8).filter(task => task.status !== 'DONE');
  openDialog({
    title: 'Admin final review gate',
    subtitle: project.title,
    content: `${incomplete.length ? notice(`Approval is blocked by: ${incomplete.map(task => task.name || task.task_name).join(', ')}.`, 'danger', 'Eight preceding tasks must be DONE') : notice('All eight preceding tasks are DONE. Approval can move this project to LIVE.', 'success', 'Gate requirements satisfied')}<form id="review-form" class="stack mt-2"><div class="field"><label for="review-notes">Review notes</label><textarea class="textarea" id="review-notes" name="notes" placeholder="Record the release or rejection rationale."></textarea></div><div class="field"><label for="review-decision">Decision</label><select class="select" id="review-decision" name="decision"><option value="approved" ${incomplete.length ? 'disabled' : ''}>Approve for LIVE</option><option value="rejected">Reject at review</option></select></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="submit-review">Record decision</button>',
    onMount(dialog) {
      dialog.querySelector('#submit-review').addEventListener('click', async () => {
        const submitBtn = dialog.querySelector('#submit-review');
        const values = formValues(dialog.querySelector('#review-form'));
        const approved = values.decision === 'approved';
        if (approved && incomplete.length) return toast('All eight preceding tasks must be DONE before approval.', 'error');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Recording decision...';

        try {
          if (getAuthToken()) {
            const res = await api.patch(`/api/admin/projects/${projectId}/final-review`, {
              approved,
              notes: values.notes?.trim() || null
            });
            project.stage = res.stage || (approved ? 'LIVE' : 'REJECTED_AT_REVIEW');
            project.status = approved ? 'LIVE' : 'ACTIVE';
          } else {
            project.stage = approved ? 'LIVE' : 'REJECTED_AT_REVIEW';
            project.status = approved ? 'LIVE' : 'ACTIVE';
          }
          persistData();
          closeDialog();
          toast(`Final-review decision recorded: ${approved ? 'LIVE' : 'Rejected at review'}.`, 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Record decision';
          toast(api.extractError(err, 'Failed to record final review decision.'), 'error');
        }
      });
    }
  });
}

export { taskRow, evaluateStage };
