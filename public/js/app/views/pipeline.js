/**
 * PRD 15 — Layer 4: 4-Role Project Pipeline Frontend Views
 * 
 * VIEW 1: Pipeline Dashboard (per project)
 * VIEW 2: Deliverable Detail View (4-column checklist layout)
 * VIEW 3: Addendum / Bug Ticket Panel (Embedded at bottom of View 2)
 * VIEW 4: Admin Pipeline Approval Screen (Admin Panel)
 * 
 * Strict RBAC: All user roles are derived ONLY from GET /api/users/me (never localStorage)
 */

import { api } from '../api.js';
import {
  state, getUser, currentUser, formatDate, formatDateTime, escapeHTML, titleCase
} from '../store.js';
import {
  icon, badge, plainBadge, progress, pageHead, card, notice, emptyState,
  openDialog, closeDialog, confirmDialog, toast, formValues, setFormError
} from '../ui.js';

// ===================================================================
// SERVER-SIDE ROLE VERIFICATION & PERMISSIONS
// ===================================================================

let cachedServerUser = null;
let lastUserFetchTime = 0;

/**
 * Derives user role and credentials STRICTLY from GET /api/users/me
 * @param {boolean} force - if true, bypasses short in-memory cache
 */
export async function getVerifiedUser(force = false) {
  const now = Date.now();
  if (!force && cachedServerUser && (now - lastUserFetchTime < 3000)) {
    return cachedServerUser;
  }
  try {
    const res = await api.get('/api/users/me');
    cachedServerUser = res?.user || res || null;
    lastUserFetchTime = now;
    return cachedServerUser;
  } catch (err) {
    console.error('Failed to verify user role from server:', err);
    return null;
  }
}

/**
 * Checks if user is Lead or Admin for a project
 */
export function isLeadOrAdmin(user, project) {
  if (!user) return false;
  const role = (user.role || '').toLowerCase();
  const subRole = (user.sub_role || user.subRole || '').toLowerCase();
  if (role === 'admin' || role === 'lead' || subRole === 'lead') return true;
  if (project && (project.owner_id === user.id || project.ownerId === user.id)) return true;
  return false;
}

/**
 * Checks if member can claim a checklist point in this stage
 */
export function canMemberClaim(user, stage, project) {
  if (!user) return false;
  const role = (user.role || '').toLowerCase();
  const subRole = (user.sub_role || user.subRole || '').toLowerCase();

  // Lead or Admin see Claim on any stage
  if (role === 'admin' || role === 'lead' || subRole === 'lead' || (project && (project.owner_id === user.id || project.ownerId === user.id))) {
    return true;
  }

  // Role matching:
  if (stage === 'RESEARCH') return role === 'researcher';
  if (stage === 'DESIGN') return role === 'designer';
  if (stage === 'DEV') return role === 'developer';
  if (stage === 'TEST') return role === 'tester' || role === 'producer';

  return false;
}

/**
 * Checks if user can raise a bug ticket (Tester role members or Lead/Admin only)
 */
export function canRaiseBugTicket(user) {
  if (!user) return false;
  const role = (user.role || '').toLowerCase();
  const subRole = (user.sub_role || user.subRole || '').toLowerCase();
  return role === 'tester' || role === 'producer' || role === 'admin' || role === 'lead' || subRole === 'lead';
}

/**
 * Checks if user can raise an addendum (Role-matched active stage members or Lead/Admin)
 */
export function canRaiseAddendum(user) {
  if (!user) return false;
  const role = (user.role || '').toLowerCase();
  const subRole = (user.sub_role || user.subRole || '').toLowerCase();
  if (role === 'admin' || role === 'lead' || subRole === 'lead') return true;
  return ['researcher', 'designer', 'developer', 'tester', 'producer'].includes(role);
}

// ===================================================================
// STAGE & STATUS STYLING HELPERS
// ===================================================================

const STAGE_COLORS = {
  RESEARCH: { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe', dot: '#4f46e5' }, // Indigo
  DESIGN:   { bg: '#fce7f3', text: '#9d174d', border: '#fbcfe8', dot: '#db2777' }, // Pink
  DEV:      { bg: '#fef3c7', text: '#92400e', border: '#fde68a', dot: '#d97706' }, // Amber
  TEST:     { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0', dot: '#059669' }, // Emerald
  COMPLETE: { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe', dot: '#2563eb' }, // Blue
  LIVE:     { bg: '#dcfce7', text: '#166534', border: '#bbf7d0', dot: '#16a34a' }  // Green
};

export function stageBadge(stage) {
  const s = (stage || 'RESEARCH').toUpperCase();
  const c = STAGE_COLORS[s] || STAGE_COLORS.RESEARCH;
  return `<span class="badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border};font-weight:600;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c.dot};margin-right:5px;"></span>${escapeHTML(s)}</span>`;
}

const POINT_STATUS_MAP = {
  UNCLAIMED:       { label: 'UNCLAIMED',       icon: '🔓', tone: 'neutral' },
  CLAIMED:         { label: 'CLAIMED',         icon: '🔒', tone: 'info' },
  IN_PROGRESS:     { label: 'IN_PROGRESS',     icon: '⚙️', tone: 'warning' },
  SUBMITTED:       { label: 'SUBMITTED',       icon: '📤', tone: 'purple' },
  APPROVED:        { label: 'APPROVED',        icon: '✅', tone: 'success' },
  REVISION_NEEDED: { label: 'REVISION_NEEDED', icon: '🔄', tone: 'danger' }
};

export function pointStatusBadge(status) {
  const info = POINT_STATUS_MAP[status] || { label: status, icon: '•', tone: 'neutral' };
  const purpleStyle = info.tone === 'purple' ? 'background:#f3e8ff;color:#6b21a8;border:1px solid #e9d5ff;' : '';
  return `<span class="badge badge--${info.tone}" style="${purpleStyle}font-size:11px;font-weight:600;">${info.icon} ${escapeHTML(info.label)}</span>`;
}

export function deliverableStatusBadge(status) {
  const s = (status || 'ACTIVE').toUpperCase();
  let tone = 'info';
  if (s === 'PAUSED') tone = 'warning';
  else if (s === 'COMPLETE' || s === 'LIVE') tone = 'success';
  else if (s === 'CANCELLED') tone = 'danger';
  return badge(s, tone);
}

// ===================================================================
// VIEW 1: PIPELINE DASHBOARD (per project)
// ===================================================================

/**
 * Renders View 1 inside the given container element
 */
export async function renderPipelineDashboard(projectId, container) {
  if (!container) return;
  container.innerHTML = `
    <div style="padding:24px;text-align:center;">
      <div class="skeleton skeleton-block" style="height:40px;width:240px;margin:0 auto 16px;"></div>
      <div class="skeleton skeleton-block" style="height:120px;"></div>
    </div>
  `;

  try {
    const verifiedUser = await getVerifiedUser(true);
    const deliverables = await api.get(`/api/pipeline/deliverables/${projectId}`).catch(() => []);
    const project = state.data.projects.find(p => p.id === projectId) || { id: projectId };
    const canAdd = isLeadOrAdmin(verifiedUser, project);

    let html = `
      <div class="pipeline-dashboard" id="pipeline-dashboard-root">
        <div class="spread mb-3" style="align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div class="eyebrow" style="color:var(--primary, #4f46e5);font-weight:600;">4-Role Delivery Engine</div>
            <h2 style="font:600 22px var(--font-display);margin-top:2px;">Pipeline Deliverables</h2>
            <p class="small muted">Stage gates: Research → Design → Dev → Test → Complete → Live.</p>
          </div>
          ${canAdd ? `
            <button class="btn btn--primary" id="btn-add-deliverable">
              ${icon('plus', 'icon--sm')} Add Deliverable
            </button>
          ` : ''}
        </div>
    `;

    if (!deliverables || deliverables.length === 0) {
      html += emptyState(
        'No Deliverables Yet',
        'No deliverables have been registered for this project. Lead or Admin can add the first deliverable to begin the pipeline.',
        canAdd ? `<button class="btn btn--primary mt-2" id="btn-add-deliverable-empty">${icon('plus', 'icon--sm')} Add Deliverable</button>` : '',
        'folder'
      );
    } else {
      html += `<div class="deliverables-grid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:16px;">`;
      for (const d of deliverables) {
        const rPct = Number(d.summary?.RESEARCH ?? d.stages?.RESEARCH?.completion_pct ?? 0).toFixed(1);
        const dPct = Number(d.summary?.DESIGN ?? d.stages?.DESIGN?.completion_pct ?? 0).toFixed(1);
        const devPct = Number(d.summary?.DEV ?? d.stages?.DEV?.completion_pct ?? 0).toFixed(1);
        const tPct = Number(d.summary?.TEST ?? d.stages?.TEST?.completion_pct ?? 0).toFixed(1);

        html += `
          <div class="card card--pad deliverable-card" data-deliverable-id="${escapeHTML(d.id)}" style="cursor:pointer;transition:transform 0.15s ease, box-shadow 0.15s ease;">
            <div class="spread mb-2" style="align-items:flex-start;">
              <h3 style="font:600 17px var(--font-display);margin:0;color:var(--text-main, #0f172a);">${escapeHTML(d.title)}</h3>
              <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                ${stageBadge(d.current_stage)}
                ${deliverableStatusBadge(d.status)}
              </div>
            </div>
            ${d.description ? `<p class="small muted mb-2" style="line-height:1.4;">${escapeHTML(d.description)}</p>` : ''}
            
            <div class="mini-progress-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;padding:12px;background:var(--bg-subtle, #f8fafc);border-radius:8px;border:1px solid var(--border-subtle, #e2e8f0);">
              <div>
                <div class="spread small"><span style="font-size:11px;font-weight:600;color:#4f46e5;">Research</span><strong style="font-size:11px;">${rPct}%</strong></div>
                <div class="progress mt-1" style="height:6px;" role="progressbar" aria-valuenow="${rPct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${rPct}%;background:#4f46e5;"></span></div>
              </div>
              <div>
                <div class="spread small"><span style="font-size:11px;font-weight:600;color:#db2777;">Design</span><strong style="font-size:11px;">${dPct}%</strong></div>
                <div class="progress mt-1" style="height:6px;" role="progressbar" aria-valuenow="${dPct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${dPct}%;background:#db2777;"></span></div>
              </div>
              <div>
                <div class="spread small"><span style="font-size:11px;font-weight:600;color:#d97706;">Dev</span><strong style="font-size:11px;">${devPct}%</strong></div>
                <div class="progress mt-1" style="height:6px;" role="progressbar" aria-valuenow="${devPct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${devPct}%;background:#d97706;"></span></div>
              </div>
              <div>
                <div class="spread small"><span style="font-size:11px;font-weight:600;color:#059669;">Test</span><strong style="font-size:11px;">${tPct}%</strong></div>
                <div class="progress mt-1" style="height:6px;" role="progressbar" aria-valuenow="${tPct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${tPct}%;background:#059669;"></span></div>
              </div>
            </div>

            <div class="spread mt-2 pt-2" style="border-top:1px solid var(--border-subtle, #e2e8f0);align-items:center;">
              <span class="small muted">Click to open 4-stage detail</span>
              <span class="small strong text-primary" style="display:inline-flex;align-items:center;gap:4px;">Open Detail ${icon('arrow-up-right', 'icon--sm')}</span>
            </div>
          </div>
        `;
      }
      html += `</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Bind Add Deliverable button
    const addBtn = container.querySelector('#btn-add-deliverable') || container.querySelector('#btn-add-deliverable-empty');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        openAddDeliverableModal(projectId, () => renderPipelineDashboard(projectId, container));
      });
    }

    // Bind deliverable card clicks to open View 2
    container.querySelectorAll('.deliverable-card').forEach(cardEl => {
      cardEl.addEventListener('click', () => {
        const deliverableId = cardEl.dataset.deliverableId;
        renderDeliverableDetail(deliverableId, container, projectId);
      });
    });

  } catch (err) {
    console.error('Error rendering pipeline dashboard:', err);
    container.innerHTML = `<div class="notice notice--danger">${icon('alert')}<div><strong>Error loading pipeline</strong><p>${escapeHTML(api.extractError(err, 'Failed to load project deliverables.'))}</p></div></div>`;
  }
}

/**
 * Modal to add a new deliverable (Lead/Admin only)
 */
function openAddDeliverableModal(projectId, onDone) {
  openDialog({
    title: 'Add New Deliverable',
    subtitle: 'Register a deliverable for 4-role pipeline tracking',
    content: `
      <form id="form-add-deliverable" class="stack" novalidate>
        <div class="field">
          <label for="deliv-title">Deliverable Title (required)</label>
          <input class="input" id="deliv-title" name="title" required placeholder="e.g. Core Authentication Service" maxlength="300" autofocus>
        </div>
        <div class="field">
          <label for="deliv-desc">Description</label>
          <textarea class="textarea" id="deliv-desc" name="description" placeholder="Scope, requirements, or architecture notes..."></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--primary" id="btn-save-deliverable">Create Deliverable</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-add-deliverable');
      const saveBtn = dialog.querySelector('#btn-save-deliverable');
      
      saveBtn.addEventListener('click', async () => {
        const values = formValues(form);
        const title = values.title?.trim();
        if (!title) {
          return setFormError(form, 'Deliverable title is required.', 'title');
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating...';

        try {
          await api.post('/api/pipeline/deliverables', {
            project_id: projectId,
            title,
            description: values.description?.trim() || ''
          });
          closeDialog();
          toast('Deliverable created successfully.', 'success');
          if (onDone) onDone();
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Create Deliverable';
          setFormError(form, api.extractError(err, 'Failed to create deliverable.'));
        }
      });
    }
  });
}

// ===================================================================
// VIEW 2: DELIVERABLE DETAIL VIEW (4-column stage layout)
// ===================================================================

/**
 * Renders View 2 (with embedded View 3) inside the container
 */
export async function renderDeliverableDetail(deliverableId, container, projectId) {
  if (!container) return;
  container.innerHTML = `
    <div style="padding:24px;text-align:center;">
      <div class="skeleton skeleton-block" style="height:36px;width:180px;margin-bottom:16px;"></div>
      <div class="skeleton skeleton-block" style="height:300px;"></div>
    </div>
  `;

  try {
    const verifiedUser = await getVerifiedUser(true);
    const detail = await api.get(`/api/pipeline/deliverables/${deliverableId}/detail`);
    const deliverable = detail.deliverable;
    const project = state.data.projects.find(p => p.id === (deliverable.project_id || projectId)) || { id: deliverable.project_id || projectId };
    const leadOrAdmin = isLeadOrAdmin(verifiedUser, project);

    const stagesList = ['RESEARCH', 'DESIGN', 'DEV', 'TEST'];
    const validTransitions = {
      RESEARCH: 'DESIGN',
      DESIGN:   'DEV',
      DEV:      'TEST',
      TEST:     'COMPLETE'
    };

    let html = `
      <div class="deliverable-detail-view" id="deliverable-detail-root">
        <div class="spread mb-2" style="align-items:center;">
          <button class="btn btn--ghost btn--sm" id="btn-back-to-dashboard">
            ${icon('arrow-left', 'icon--sm')} Back to Deliverables
          </button>
          <div style="display:flex;gap:8px;align-items:center;">
            ${stageBadge(deliverable.current_stage)}
            ${deliverableStatusBadge(deliverable.status)}
          </div>
        </div>

        <div class="card card--pad mb-3" style="background:var(--bg-subtle, #f8fafc);">
          <div class="spread" style="align-items:flex-start;">
            <div>
              <div class="eyebrow">Deliverable Detail</div>
              <h2 style="font:600 24px var(--font-display);margin:4px 0;">${escapeHTML(deliverable.title)}</h2>
              ${deliverable.description ? `<p class="muted small">${escapeHTML(deliverable.description)}</p>` : ''}
            </div>
            <div style="text-align:right;">
              <span class="small muted">Current Stage</span>
              <div style="font:700 16px var(--font-mono);">${deliverable.current_stage}</div>
            </div>
          </div>
        </div>

        <!-- 4-Column Stage Layout -->
        <div class="stages-column-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:16px;align-items:start;">
    `;

    for (const stage of stagesList) {
      const stageInfo = detail.stages?.[stage] || { stage, points: [], completion_pct: 0 };
      const pct = Number(stageInfo.completion_pct || 0);
      const points = stageInfo.points || [];
      const isCurrentStage = deliverable.current_stage === stage;
      const isHandedOff = (detail.handoffs || []).some(h => h.from_stage === stage);
      const nextStage = validTransitions[stage];

      html += `
        <div class="card card--flush stage-column" data-stage="${stage}" style="border:1px solid var(--border-subtle, #e2e8f0);border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <!-- Column Header -->
          <div class="stage-header card-head" style="background:var(--bg-subtle, #f8fafc);padding:14px;border-bottom:1px solid var(--border-subtle, #e2e8f0);">
            <div class="spread mb-1" style="align-items:center;">
              <h3 style="font:600 16px var(--font-display);margin:0;">${stageBadge(stage)}</h3>
              <strong style="font:700 14px var(--font-mono);">${pct.toFixed(1)}%</strong>
            </div>
            ${progress(pct, '', pct >= 100 ? 'success' : '')}

            ${leadOrAdmin && pct >= 100 && !isHandedOff && isCurrentStage ? `
              <div class="mt-2">
                <button class="btn btn--primary btn--sm btn--full btn-approve-handoff" 
                        data-from-stage="${stage}" 
                        data-to-stage="${nextStage}">
                  Approve Handoff →
                </button>
              </div>
            ` : isHandedOff ? `
              <div class="mt-2 text-center">
                <span class="badge badge--success" style="font-size:11px;">✅ Handoff Approved</span>
              </div>
            ` : ''}
          </div>

          <!-- Points List -->
          <div class="stage-points-body card-body" style="padding:12px;display:flex;flex-direction:column;gap:10px;min-height:160px;">
      `;

      if (points.length === 0) {
        html += `<p class="small muted text-center" style="padding:24px 8px;">No checklist points in ${titleCase(stage)} stage.</p>`;
      } else {
        for (const pt of points) {
          const isAssignedToMe = verifiedUser && verifiedUser.id === pt.assigned_to;
          const assignedUser = pt.assigned_to ? getUser(pt.assigned_to) : null;
          // Rule 2: Admin NOT visible as a stage worker in claimed by list
          const isAdminWorker = assignedUser?.role === 'admin';
          const assigneeName = isAdminWorker ? '' : (assignedUser?.name || pt.assigned_to_name || '');

          html += `
            <div class="card card--pad checklist-point-card" data-point-id="${escapeHTML(pt.id)}" style="background:var(--surface, #ffffff);border:1px solid var(--border-subtle, #e2e8f0);border-radius:6px;padding:12px;">
              <div class="spread mb-1" style="align-items:flex-start;gap:8px;">
                <div style="font-weight:600;font-size:14px;color:var(--text-main, #0f172a);line-height:1.3;">
                  ${escapeHTML(pt.point_title)}
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0;">
                  <span class="badge badge--neutral badge--no-dot" style="font-size:10px;font-weight:600;" title="Weight">W:${pt.weight}</span>
                </div>
              </div>

              ${pt.point_description ? `<p class="small muted mb-2" style="font-size:12px;line-height:1.4;">${escapeHTML(pt.point_description)}</p>` : ''}

              <div class="spread mb-2" style="align-items:center;">
                ${pointStatusBadge(pt.status)}
                ${assigneeName ? `<span class="small muted" style="font-size:11px;">👤 ${escapeHTML(assigneeName)}</span>` : ''}
              </div>

              ${pt.asset_url || pt.tool_link ? `
                <div class="small mb-2" style="font-size:11px;display:flex;flex-direction:column;gap:2px;">
                  ${pt.asset_url ? `<a href="${escapeHTML(pt.asset_url)}" target="_blank" rel="noopener" class="link-btn text-primary">🔗 Asset: ${escapeHTML(pt.asset_url.slice(0, 32))}...</a>` : ''}
                  ${pt.tool_link ? `<a href="${escapeHTML(pt.tool_link)}" target="_blank" rel="noopener" class="link-btn text-primary">🛠️ Tool: ${escapeHTML(pt.tool_link.slice(0, 32))}...</a>` : ''}
                </div>
              ` : ''}

              <!-- Action Buttons per Point -->
              <div class="point-actions mt-2" style="display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--border-subtle, #f1f5f9);padding-top:8px;">
                ${pt.status === 'UNCLAIMED' && canMemberClaim(verifiedUser, stage, project) ? `
                  <button class="btn btn--outline btn--sm btn-claim-point" data-point-id="${pt.id}">Claim</button>
                ` : ''}

                ${pt.status === 'CLAIMED' && isAssignedToMe ? `
                  <button class="btn btn--outline btn--sm btn-start-point" data-point-id="${pt.id}">Start</button>
                ` : ''}

                ${(pt.status === 'IN_PROGRESS' || pt.status === 'REVISION_NEEDED') && isAssignedToMe ? `
                  <button class="btn btn--primary btn--sm btn-submit-point" data-point-id="${pt.id}">Submit</button>
                ` : ''}

                ${pt.status === 'SUBMITTED' && leadOrAdmin ? `
                  <button class="btn btn--primary btn--sm btn-approve-point" data-point-id="${pt.id}">Approve</button>
                  <button class="btn btn--danger btn--sm btn-revision-point" data-point-id="${pt.id}">Request Revision</button>
                ` : ''}
              </div>
            </div>
          `;
        }
      }

      html += `
          </div>

          <!-- Add Point Button at bottom (Lead/Admin only) -->
          ${leadOrAdmin ? `
            <div class="card-foot" style="padding:10px 14px;background:var(--bg-subtle, #f8fafc);border-top:1px solid var(--border-subtle, #e2e8f0);">
              <button class="btn btn--ghost btn--sm btn--full btn-add-point" data-stage="${stage}">
                ${icon('plus', 'icon--sm')} Add Point
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }

    html += `
        </div>

        <!-- Embedded View 3: Addendum & Bug Ticket Panel -->
        <div id="addendum-panel-mount" class="mt-4"></div>
      </div>
    `;

    container.innerHTML = html;

    // 1. Back button
    container.querySelector('#btn-back-to-dashboard')?.addEventListener('click', () => {
      renderPipelineDashboard(deliverable.project_id || projectId, container);
    });

    // 2. Claim buttons
    container.querySelectorAll('.btn-claim-point').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Claiming...';
        try {
          await api.patch(`/api/pipeline/points/${btn.dataset.pointId}/claim`);
          toast('Point claimed successfully.', 'success');
          renderDeliverableDetail(deliverableId, container, projectId);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Claim';
          toast(api.extractError(err, 'Failed to claim point.'), 'error');
        }
      });
    });

    // 3. Start buttons
    container.querySelectorAll('.btn-start-point').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Starting...';
        try {
          await api.patch(`/api/pipeline/points/${btn.dataset.pointId}/start`);
          toast('Work started on point.', 'success');
          renderDeliverableDetail(deliverableId, container, projectId);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Start';
          toast(api.extractError(err, 'Failed to start point.'), 'error');
        }
      });
    });

    // 4. Submit buttons
    container.querySelectorAll('.btn-submit-point').forEach(btn => {
      btn.addEventListener('click', () => {
        openSubmitPointModal(btn.dataset.pointId, () => {
          renderDeliverableDetail(deliverableId, container, projectId);
        });
      });
    });

    // 5. Approve buttons
    container.querySelectorAll('.btn-approve-point').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Approving...';
        try {
          await api.patch(`/api/pipeline/points/${btn.dataset.pointId}/approve`);
          toast('Point approved.', 'success');
          renderDeliverableDetail(deliverableId, container, projectId);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Approve';
          toast(api.extractError(err, 'Failed to approve point.'), 'error');
        }
      });
    });

    // 6. Request Revision buttons
    container.querySelectorAll('.btn-revision-point').forEach(btn => {
      btn.addEventListener('click', () => {
        openRevisionPointModal(btn.dataset.pointId, () => {
          renderDeliverableDetail(deliverableId, container, projectId);
        });
      });
    });

    // 7. Approve Handoff buttons
    container.querySelectorAll('.btn-approve-handoff').forEach(btn => {
      btn.addEventListener('click', () => {
        const fromStage = btn.dataset.fromStage;
        const toStage = btn.dataset.toStage;
        openHandoffModal(deliverableId, fromStage, toStage, () => {
          renderDeliverableDetail(deliverableId, container, projectId);
        });
      });
    });

    // 8. Add Point buttons
    container.querySelectorAll('.btn-add-point').forEach(btn => {
      btn.addEventListener('click', () => {
        const stage = btn.dataset.stage;
        openAddPointModal(deliverableId, stage, () => {
          renderDeliverableDetail(deliverableId, container, projectId);
        });
      });
    });

    // Mount View 3 (Addendum & Bug Ticket Panel)
    const addendumMount = container.querySelector('#addendum-panel-mount');
    if (addendumMount) {
      renderAddendumPanel(deliverableId, addendumMount, verifiedUser, leadOrAdmin);
    }

  } catch (err) {
    console.error('Error rendering deliverable detail view:', err);
    container.innerHTML = `<div class="notice notice--danger">${icon('alert')}<div><strong>Error loading deliverable</strong><p>${escapeHTML(api.extractError(err, 'Failed to load deliverable detail.'))}</p></div></div>`;
  }
}

/**
 * Modal to submit work on a point
 */
function openSubmitPointModal(pointId, onDone) {
  openDialog({
    title: 'Submit Checklist Point',
    subtitle: 'Provide proof of deliverable or tool link for review',
    content: `
      <form id="form-submit-point" class="stack" novalidate>
        <div class="field">
          <label for="submit-asset-url">Asset URL (document / design / repository)</label>
          <input class="input" id="submit-asset-url" name="asset_url" type="url" placeholder="https://github.com/... or Figma link" autofocus>
        </div>
        <div class="field">
          <label for="submit-tool-link">Tool / Runner Link (optional)</label>
          <input class="input" id="submit-tool-link" name="tool_link" type="url" placeholder="https://...">
        </div>
        <div class="field">
          <label for="submit-notes">Submission Notes</label>
          <textarea class="textarea" id="submit-notes" name="notes" placeholder="Summarize your work and testing steps..."></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--primary" id="btn-confirm-submit">Submit Point</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-submit-point');
      const submitBtn = dialog.querySelector('#btn-confirm-submit');

      submitBtn.addEventListener('click', async () => {
        const values = formValues(form);
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
          await api.patch(`/api/pipeline/points/${pointId}/submit`, {
            asset_url: values.asset_url?.trim() || null,
            tool_link: values.tool_link?.trim() || null,
            notes: values.notes?.trim() || null
          });
          closeDialog();
          toast('Point submitted for Lead review.', 'success');
          if (onDone) onDone();
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Point';
          setFormError(form, api.extractError(err, 'Failed to submit point.'));
        }
      });
    }
  });
}

/**
 * Modal to request revision on a point (Lead/Admin)
 */
function openRevisionPointModal(pointId, onDone) {
  openDialog({
    title: 'Request Revision',
    subtitle: 'Point will be returned to member with notes',
    content: `
      <form id="form-revision-point" class="stack" novalidate>
        <div class="field">
          <label for="revision-reason">Reason for Revision (required)</label>
          <textarea class="textarea" id="revision-reason" name="reason" required placeholder="Explain clearly what changes are needed..." autofocus></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--danger" id="btn-confirm-revision">Send Revision Request</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-revision-point');
      const confirmBtn = dialog.querySelector('#btn-confirm-revision');

      confirmBtn.addEventListener('click', async () => {
        const values = formValues(form);
        const reason = values.reason?.trim();
        if (!reason) {
          return setFormError(form, 'Revision reason is required.', 'reason');
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Sending...';

        try {
          await api.patch(`/api/pipeline/points/${pointId}/revision`, { reason });
          closeDialog();
          toast('Revision request sent to member.', 'info');
          if (onDone) onDone();
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Send Revision Request';
          setFormError(form, api.extractError(err, 'Failed to request revision.'));
        }
      });
    }
  });
}

/**
 * Modal to approve stage handoff (Lead/Admin)
 */
function openHandoffModal(deliverableId, fromStage, toStage, onDone) {
  openDialog({
    title: `Approve Stage Handoff (${fromStage} → ${toStage})`,
    subtitle: 'Creates an immutable record and unlocks the next stage',
    content: `
      <form id="form-handoff" class="stack" novalidate>
        <div class="field">
          <label>Stage Transition</label>
          <div style="font:600 15px var(--font-mono);padding:10px;background:var(--bg-subtle, #f8fafc);border-radius:6px;border:1px solid var(--border-subtle, #e2e8f0);">
            ${fromStage} ➔ ${toStage}
          </div>
        </div>
        <div class="field">
          <label for="handoff-notes">Handoff Notes & Sign-off Details (required)</label>
          <textarea class="textarea" id="handoff-notes" name="handoff_notes" required placeholder="Confirm deliverables meet acceptance criteria..." autofocus></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--primary" id="btn-confirm-handoff">Approve & Unlock ${toStage}</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-handoff');
      const confirmBtn = dialog.querySelector('#btn-confirm-handoff');

      confirmBtn.addEventListener('click', async () => {
        const values = formValues(form);
        const notes = values.handoff_notes?.trim();
        if (!notes) {
          return setFormError(form, 'Handoff notes are required.', 'handoff_notes');
        }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Processing...';

        try {
          await api.post(`/api/pipeline/deliverables/${deliverableId}/handoff`, {
            from_stage: fromStage,
            to_stage: toStage,
            handoff_notes: notes
          });
          closeDialog();
          toast(`Handoff approved: ${fromStage} → ${toStage}`, 'success');
          if (onDone) onDone();
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = `Approve & Unlock ${toStage}`;
          setFormError(form, api.extractError(err, 'Failed to approve stage handoff.'));
        }
      });
    }
  });
}

/**
 * Modal to add a checklist point to a stage (Lead/Admin)
 */
function openAddPointModal(deliverableId, stage, onDone) {
  openDialog({
    title: `Add Checklist Point (${stage})`,
    subtitle: `Assign responsibilities and weight to the ${titleCase(stage)} track`,
    content: `
      <form id="form-add-point" class="stack" novalidate>
        <div class="field">
          <label for="point-title">Point Title (required)</label>
          <input class="input" id="point-title" name="point_title" required placeholder="e.g. Wireframe Dashboard UI" maxlength="300" autofocus>
        </div>
        <div class="field">
          <label for="point-desc">Description (optional)</label>
          <textarea class="textarea" id="point-desc" name="point_description" placeholder="Specific technical requirements..."></textarea>
        </div>
        <div class="field">
          <label for="point-weight">Weight (1 - 10)</label>
          <input class="input" id="point-weight" name="weight" type="number" min="1" max="10" value="5" required>
          <span class="field-hint">Contribution impact percentage factor for this stage.</span>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--primary" id="btn-save-point">Add Point</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-add-point');
      const saveBtn = dialog.querySelector('#btn-save-point');

      saveBtn.addEventListener('click', async () => {
        const values = formValues(form);
        const title = values.point_title?.trim();
        const weight = Number(values.weight || 5);

        if (!title) {
          return setFormError(form, 'Point title is required.', 'point_title');
        }
        if (isNaN(weight) || weight < 1 || weight > 10) {
          return setFormError(form, 'Weight must be between 1 and 10.', 'weight');
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Adding...';

        try {
          await api.post(`/api/pipeline/deliverables/${deliverableId}/points`, {
            stage,
            point_title: title,
            point_description: values.point_description?.trim() || '',
            weight
          });
          closeDialog();
          toast('Checklist point added.', 'success');
          if (onDone) onDone();
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Add Point';
          setFormError(form, api.extractError(err, 'Failed to add point.'));
        }
      });
    }
  });
}

// ===================================================================
// VIEW 3: ADDENDUM / BUG TICKET PANEL
// ===================================================================

/**
 * Renders View 3 inside the container (embedded at bottom of View 2)
 */
export async function renderAddendumPanel(deliverableId, container, currentUser, leadOrAdmin) {
  if (!container) return;

  try {
    const addendums = await api.get(`/api/pipeline/deliverables/${deliverableId}/addendums`).catch(() => []);
    const userRole = (currentUser?.role || '').toLowerCase();
    const canBug = canRaiseBugTicket(currentUser);
    const canAddendum = canRaiseAddendum(currentUser);

    let html = `
      <section class="card card--pad addendum-panel" style="border:1px solid var(--border-subtle, #e2e8f0);border-radius:8px;">
        <div class="spread mb-3" style="align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div class="eyebrow" style="color:var(--primary, #4f46e5);font-weight:600;">Feedback & Quality Control</div>
            <h3 style="font:600 20px var(--font-display);margin-top:2px;">Addendum & Bug Ticket Requests</h3>
            <p class="small muted">Formal feedback loop across stages with full audit trail.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${canAddendum ? `
              <button class="btn btn--outline btn--sm" id="btn-raise-addendum">
                ${icon('plus', 'icon--sm')} Raise Addendum
              </button>
            ` : ''}
            ${canBug ? `
              <button class="btn btn--danger btn--sm" id="btn-raise-bug">
                ${icon('alert', 'icon--sm')} Raise Bug Ticket
              </button>
            ` : ''}
          </div>
        </div>
    `;

    if (!addendums || addendums.length === 0) {
      html += `<p class="small muted text-center" style="padding:24px 0;">No addendums or bug tickets raised for this deliverable.</p>`;
    } else {
      html += `<div class="addendums-list" style="display:flex;flex-direction:column;gap:10px;">`;
      for (const item of addendums) {
        const isBug = item.type === 'BUG_TICKET';
        const typeBadge = isBug
          ? `<span class="badge badge--danger" style="font-weight:600;">🐞 BUG TICKET</span>`
          : `<span class="badge badge--info" style="font-weight:600;">📑 ADDENDUM</span>`;
        
        let statusBadge = `<span class="badge badge--warning">OPEN</span>`;
        if (item.status === 'FULFILLED') statusBadge = `<span class="badge badge--success">FULFILLED</span>`;
        if (item.status === 'REJECTED') statusBadge = `<span class="badge badge--danger">REJECTED</span>`;

        const raiser = getUser(item.raised_by);
        const raiserName = raiser?.name || item.raised_by || 'Member';

        html += `
          <div class="card card--pad addendum-item-card" data-addendum-id="${escapeHTML(item.id)}" style="background:var(--bg-subtle, #f8fafc);border:1px solid var(--border-subtle, #e2e8f0);border-radius:6px;padding:12px;">
            <div class="spread mb-1" style="align-items:flex-start;flex-wrap:wrap;gap:8px;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                ${typeBadge}
                <strong style="font:600 13px var(--font-mono);color:var(--text-main, #0f172a);">${item.requesting_stage} ➔ ${item.target_stage}</strong>
                ${statusBadge}
              </div>
              <span class="small muted" style="font-size:11px;">Raised by <strong>${escapeHTML(raiserName)}</strong> · ${formatDate(item.created_at)}</span>
            </div>

            <div style="font-weight:600;font-size:14px;margin-top:6px;color:var(--text-main, #0f172a);">${escapeHTML(item.point_title)}</div>
            <p class="small muted mt-1" style="line-height:1.4;">${escapeHTML(item.reason)}</p>

            ${item.status === 'OPEN' && (leadOrAdmin || userRole === 'admin') ? `
              <div class="mt-2 pt-2" style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border-subtle, #e2e8f0);">
                ${leadOrAdmin ? `
                  <button class="btn btn--primary btn--sm btn-fulfill-addendum" data-addendum-id="${item.id}">Fulfill</button>
                ` : ''}
                ${userRole === 'admin' ? `
                  <button class="btn btn--outline btn--sm btn-reject-addendum" data-addendum-id="${item.id}">Reject</button>
                ` : ''}
              </div>
            ` : ''}
          </div>
        `;
      }
      html += `</div>`;
    }

    html += `</section>`;
    container.innerHTML = html;

    // Handlers
    container.querySelector('#btn-raise-addendum')?.addEventListener('click', () => {
      openRaiseAddendumModal(deliverableId, currentUser, () => {
        renderAddendumPanel(deliverableId, container, currentUser, leadOrAdmin);
      });
    });

    container.querySelector('#btn-raise-bug')?.addEventListener('click', () => {
      openRaiseBugModal(deliverableId, () => {
        renderAddendumPanel(deliverableId, container, currentUser, leadOrAdmin);
      });
    });

    container.querySelectorAll('.btn-fulfill-addendum').forEach(btn => {
      btn.addEventListener('click', () => {
        openFulfillAddendumModal(btn.dataset.addendumId, () => {
          renderAddendumPanel(deliverableId, container, currentUser, leadOrAdmin);
        });
      });
    });

    container.querySelectorAll('.btn-reject-addendum').forEach(btn => {
      btn.addEventListener('click', () => {
        openRejectAddendumModal(btn.dataset.addendumId, () => {
          renderAddendumPanel(deliverableId, container, currentUser, leadOrAdmin);
        });
      });
    });

  } catch (err) {
    console.error('Error rendering addendum panel:', err);
    container.innerHTML = `<div class="notice notice--danger"><p>${escapeHTML(api.extractError(err, 'Failed to load addendums.'))}</p></div>`;
  }
}

/**
 * Modal to raise Addendum
 */
function openRaiseAddendumModal(deliverableId, user, onDone) {
  let defaultStage = 'RESEARCH';
  const role = (user?.role || '').toLowerCase();
  if (role === 'designer') defaultStage = 'DESIGN';
  else if (role === 'developer') defaultStage = 'DEV';
  else if (role === 'tester' || role === 'producer') defaultStage = 'TEST';

  openDialog({
    title: 'Raise Stage Addendum',
    subtitle: 'Request additional work in a target stage',
    content: `
      <form id="form-raise-addendum" class="stack" novalidate>
        <div class="field">
          <label for="add-req-stage">Requesting Stage</label>
          <select class="select" id="add-req-stage" name="requesting_stage">
            <option value="RESEARCH" ${defaultStage === 'RESEARCH' ? 'selected' : ''}>RESEARCH</option>
            <option value="DESIGN" ${defaultStage === 'DESIGN' ? 'selected' : ''}>DESIGN</option>
            <option value="DEV" ${defaultStage === 'DEV' ? 'selected' : ''}>DEV</option>
            <option value="TEST" ${defaultStage === 'TEST' ? 'selected' : ''}>TEST</option>
          </select>
        </div>
        <div class="field">
          <label for="add-target-stage">Target Stage (where new point is needed)</label>
          <select class="select" id="add-target-stage" name="target_stage">
            <option value="RESEARCH">RESEARCH</option>
            <option value="DESIGN" selected>DESIGN</option>
            <option value="DEV">DEV</option>
            <option value="TEST">TEST</option>
          </select>
        </div>
        <div class="field">
          <label for="add-title">Point Title Requested (required)</label>
          <input class="input" id="add-title" name="point_title" required placeholder="e.g. Additional Auth Token Refresh Logic" autofocus>
        </div>
        <div class="field">
          <label for="add-reason">Reason (required)</label>
          <textarea class="textarea" id="add-reason" name="reason" required placeholder="Explain why this addendum is necessary..."></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--primary" id="btn-submit-addendum">Raise Addendum</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-raise-addendum');
      const btn = dialog.querySelector('#btn-submit-addendum');

      btn.addEventListener('click', async () => {
        const values = formValues(form);
        if (!values.point_title?.trim()) return setFormError(form, 'Point title is required.', 'point_title');
        if (!values.reason?.trim()) return setFormError(form, 'Reason is required.', 'reason');

        btn.disabled = true;
        btn.textContent = 'Submitting...';

        try {
          await api.post(`/api/pipeline/deliverables/${deliverableId}/addendum`, {
            requesting_stage: values.requesting_stage,
            target_stage: values.target_stage,
            point_title: values.point_title.trim(),
            reason: values.reason.trim(),
            type: 'ADDENDUM'
          });
          closeDialog();
          toast('Addendum request submitted.', 'success');
          if (onDone) onDone();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Raise Addendum';
          setFormError(form, api.extractError(err, 'Failed to raise addendum.'));
        }
      });
    }
  });
}

/**
 * Modal to raise Bug Ticket (Tester or Lead/Admin only)
 */
function openRaiseBugModal(deliverableId, onDone) {
  openDialog({
    title: 'Raise Bug Ticket (TEST ➔ DEV)',
    subtitle: 'Logs a critical defect that blocks DEV stage completion',
    content: `
      <form id="form-raise-bug" class="stack" novalidate>
        <div class="field">
          <label>Stage Routing (Fixed)</label>
          <div style="font:600 14px var(--font-mono);padding:10px;background:var(--bg-subtle, #f8fafc);border-radius:6px;border:1px solid var(--border-subtle, #e2e8f0);color:#dc2626;">
            TEST ➔ DEV (Bug Ticket)
          </div>
        </div>
        <div class="field">
          <label for="bug-title">Bug Title / Defect Summary (required)</label>
          <input class="input" id="bug-title" name="point_title" required placeholder="e.g. 500 error on invalid token payload" autofocus>
        </div>
        <div class="field">
          <label for="bug-reason">Steps to Reproduce / Defect Reason (required)</label>
          <textarea class="textarea" id="bug-reason" name="reason" required placeholder="Describe expected vs actual behavior and steps to reproduce..."></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--danger" id="btn-submit-bug">Raise Bug Ticket</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-raise-bug');
      const btn = dialog.querySelector('#btn-submit-bug');

      btn.addEventListener('click', async () => {
        const values = formValues(form);
        if (!values.point_title?.trim()) return setFormError(form, 'Bug title is required.', 'point_title');
        if (!values.reason?.trim()) return setFormError(form, 'Reason is required.', 'reason');

        btn.disabled = true;
        btn.textContent = 'Submitting...';

        try {
          await api.post(`/api/pipeline/deliverables/${deliverableId}/addendum`, {
            requesting_stage: 'TEST',
            target_stage: 'DEV',
            point_title: values.point_title.trim(),
            reason: values.reason.trim(),
            type: 'BUG_TICKET'
          });
          closeDialog();
          toast('Bug ticket raised against DEV track.', 'warning');
          if (onDone) onDone();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Raise Bug Ticket';
          setFormError(form, api.extractError(err, 'Failed to raise bug ticket.'));
        }
      });
    }
  });
}

/**
 * Modal to fulfill an addendum / bug ticket (Lead/Admin)
 */
function openFulfillAddendumModal(addendumId, onDone) {
  openDialog({
    title: 'Fulfill Addendum / Bug Ticket',
    subtitle: 'Link the approved checklist point that resolves this request',
    content: `
      <form id="form-fulfill-addendum" class="stack" novalidate>
        <div class="field">
          <label for="fulfill-point-id">Fulfilling Checklist Point ID (required)</label>
          <input class="input" id="fulfill-point-id" name="point_id" required placeholder="Enter the approved point ID..." autofocus>
          <span class="field-hint">The checklist point created and approved to satisfy this requirement.</span>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--primary" id="btn-confirm-fulfill">Mark Fulfilled</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-fulfill-addendum');
      const btn = dialog.querySelector('#btn-confirm-fulfill');

      btn.addEventListener('click', async () => {
        const values = formValues(form);
        const pointId = values.point_id?.trim();
        if (!pointId) return setFormError(form, 'Checklist Point ID is required.', 'point_id');

        btn.disabled = true;
        btn.textContent = 'Processing...';

        try {
          await api.patch(`/api/pipeline/addendum/${addendumId}/fulfill`, { point_id: pointId });
          closeDialog();
          toast('Addendum marked FULFILLED.', 'success');
          if (onDone) onDone();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Mark Fulfilled';
          setFormError(form, api.extractError(err, 'Failed to fulfill addendum.'));
        }
      });
    }
  });
}

/**
 * Modal to reject an addendum (Admin only)
 */
function openRejectAddendumModal(addendumId, onDone) {
  openDialog({
    title: 'Reject Addendum Request',
    subtitle: 'Admin decision to reject an addendum or defect request',
    content: `
      <form id="form-reject-addendum" class="stack" novalidate>
        <div class="field">
          <label for="reject-reason">Rejection Reason (required)</label>
          <textarea class="textarea" id="reject-reason" name="reason" required placeholder="Provide clear technical rationale for rejection..." autofocus></textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--danger" id="btn-confirm-reject">Reject Request</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-reject-addendum');
      const btn = dialog.querySelector('#btn-confirm-reject');

      btn.addEventListener('click', async () => {
        const values = formValues(form);
        const reason = values.reason?.trim();
        if (!reason) return setFormError(form, 'Rejection reason is required.', 'reason');

        btn.disabled = true;
        btn.textContent = 'Rejecting...';

        try {
          await api.patch(`/api/pipeline/addendum/${addendumId}/reject`, { reason });
          closeDialog();
          toast('Addendum request rejected.', 'info');
          if (onDone) onDone();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Reject Request';
          setFormError(form, api.extractError(err, 'Failed to reject addendum.'));
        }
      });
    }
  });
}

// ===================================================================
// VIEW 4: ADMIN PIPELINE APPROVAL SCREEN (Admin Panel)
// ===================================================================

/**
 * Renders View 4 inside the given container (or standalone in Admin Panel)
 */
export async function renderAdminPipelineApprovals(container) {
  if (!container) return;
  container.innerHTML = `
    <div style="padding:24px;text-align:center;">
      <div class="skeleton skeleton-block" style="height:40px;width:300px;margin:0 auto 16px;"></div>
      <div class="skeleton skeleton-block" style="height:200px;"></div>
    </div>
  `;

  try {
    const verifiedUser = await getVerifiedUser(true);
    if (verifiedUser?.role !== 'admin') {
      container.innerHTML = `<div class="notice notice--danger">${icon('shield')}<div><strong>Admin Access Required</strong><p>Only verified administrators can access the Pipeline Go-Live Approval screen.</p></div></div>`;
      return;
    }

    // Load all projects
    const allProjects = state.data.projects || [];
    const summaries = [];

    for (const p of allProjects) {
      try {
        const summary = await api.get(`/api/admin/projects/${p.id}/pipeline/summary`);
        if (summary && summary.deliverables && summary.deliverables.length > 0) {
          summaries.push(summary);
        }
      } catch (e) {
        // Project might not have deliverables or non-existent in pipeline
      }
    }

    let html = `
      <section class="admin-pipeline-approvals" id="admin-pipeline-approvals-root">
        <div class="spread mb-3" style="align-items:center;">
          <div>
            <div class="eyebrow" style="color:var(--primary, #4f46e5);font-weight:600;">Governance & Deployment Gate</div>
            <h2 style="font:600 22px var(--font-display);margin-top:2px;">Pipeline Go-Live Approvals</h2>
            <p class="small muted">Verify 100% completion across all deliverables, zero open addendums, and zero bug tickets before authorizing production Go-Live.</p>
          </div>
          <button class="btn btn--ghost btn--sm" id="btn-refresh-approvals">
            ${icon('refresh', 'icon--sm')} Refresh
          </button>
        </div>
    `;

    if (summaries.length === 0) {
      html += emptyState(
        'No Projects Awaiting Pipeline Go-Live',
        'No active projects with pipeline deliverables were found.',
        '',
        'folder'
      );
    } else {
      for (const item of summaries) {
        const proj = item.project;
        const rawDeliverables = item.deliverables || [];
        const normalizedDeliverables = rawDeliverables.map(entry => {
          const d = entry.deliverable ? entry.deliverable : entry;
          return {
            ...d,
            summary: entry.summary || d.summary || {},
            stages: entry.stages || d.stages || {},
            addendums: entry.addendums || d.addendums || []
          };
        });
        const addendums = item.addendums || normalizedDeliverables.flatMap(d => d.addendums || []);

        const openAddendums = addendums.filter(a => a.status === 'OPEN' && a.type === 'ADDENDUM');
        const openBugs = addendums.filter(a => a.status === 'OPEN' && a.type === 'BUG_TICKET');
        const allComplete = normalizedDeliverables.length > 0 && normalizedDeliverables.every(d => d.status === 'COMPLETE');
        const isLive = proj.current_stage === 'LIVE' || proj.status === 'LIVE' || (normalizedDeliverables.length > 0 && normalizedDeliverables.every(d => d.status === 'LIVE'));

        const canApprove = allComplete && openAddendums.length === 0 && openBugs.length === 0 && !isLive;

        let tooltipReason = '';
        if (isLive) tooltipReason = 'Project and deliverables are already LIVE.';
        else if (normalizedDeliverables.length === 0) tooltipReason = 'No deliverables found.';
        else if (!allComplete) tooltipReason = 'All deliverables must be in COMPLETE status before Go-Live.';
        else if (openAddendums.length > 0) tooltipReason = `${openAddendums.length} open addendum(s) must be fulfilled or rejected.`;
        else if (openBugs.length > 0) tooltipReason = `${openBugs.length} open bug ticket(s) must be resolved.`;

        html += `
          <div class="card card--pad mb-3 project-pipeline-approval-card" data-project-id="${proj.id}" style="border:1px solid var(--border-subtle, #e2e8f0);border-radius:8px;">
            <div class="spread mb-2" style="align-items:flex-start;flex-wrap:wrap;gap:8px;">
              <div>
                <h3 style="font:600 18px var(--font-display);margin:0;">
                  <a href="#/app/projects/${proj.id}" class="table-link">${escapeHTML(proj.title)}</a>
                </h3>
                <span class="small muted">${proj.code || 'PRJ'} · Current Stage: <strong>${proj.current_stage || proj.stage}</strong></span>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                ${openAddendums.length > 0 ? `<span class="badge badge--danger" style="font-weight:600;">${openAddendums.length} Open Addendums</span>` : ''}
                ${openBugs.length > 0 ? `<span class="badge badge--danger" style="font-weight:600;">${openBugs.length} Open Bug Tickets</span>` : ''}
                ${badge(proj.current_stage || proj.status || 'ACTIVE')}
              </div>
            </div>

            <!-- Deliverables Summary Table -->
            <div class="table-wrap mt-2" style="border:1px solid var(--border-subtle, #e2e8f0);border-radius:6px;overflow:hidden;">
              <table class="data-table" style="font-size:13px;width:100%;">
                <thead>
                  <tr style="background:var(--bg-subtle, #f8fafc);">
                    <th>Deliverable Title</th>
                    <th style="text-align:center;">Research %</th>
                    <th style="text-align:center;">Design %</th>
                    <th style="text-align:center;">Dev %</th>
                    <th style="text-align:center;">Test %</th>
                    <th style="text-align:right;">Status</th>
                  </tr>
                </thead>
                <tbody>
        `;

        for (const deliv of normalizedDeliverables) {
          const rPct = Number(deliv.summary?.RESEARCH ?? deliv.stages?.RESEARCH?.completion_pct ?? 0).toFixed(0);
          const dPct = Number(deliv.summary?.DESIGN ?? deliv.stages?.DESIGN?.completion_pct ?? 0).toFixed(0);
          const devPct = Number(deliv.summary?.DEV ?? deliv.stages?.DEV?.completion_pct ?? 0).toFixed(0);
          const tPct = Number(deliv.summary?.TEST ?? deliv.stages?.TEST?.completion_pct ?? 0).toFixed(0);

          html += `
            <tr>
              <td style="font-weight:600;color:var(--text-main, #0f172a);">${escapeHTML(deliv.title)}</td>
              <td style="text-align:center;"><span style="color:#4f46e5;font-weight:600;">${rPct}%</span></td>
              <td style="text-align:center;"><span style="color:#db2777;font-weight:600;">${dPct}%</span></td>
              <td style="text-align:center;"><span style="color:#d97706;font-weight:600;">${devPct}%</span></td>
              <td style="text-align:center;"><span style="color:#059669;font-weight:600;">${tPct}%</span></td>
              <td style="text-align:right;">${deliverableStatusBadge(deliv.status)}</td>
            </tr>
          `;
        }

        html += `
                </tbody>
              </table>
            </div>

            <!-- Approval Footer -->
            <div class="spread mt-3 pt-2" style="border-top:1px solid var(--border-subtle, #e2e8f0);align-items:center;">
              <span class="small muted">
                ${canApprove ? '✅ All completion criteria met. Ready for Go-Live approval.' : `⚠️ ${tooltipReason}`}
              </span>

              ${isLive ? `
                <span class="badge badge--success" style="font-weight:700;font-size:12px;padding:6px 12px;">✅ LIVE APPROVED</span>
              ` : `
                <button class="btn ${canApprove ? 'btn--primary' : 'btn--outline'} btn-approve-go-live" 
                        data-project-id="${proj.id}" 
                        ${!canApprove ? 'disabled' : ''} 
                        title="${escapeHTML(tooltipReason || 'Click to approve production Go-Live')}">
                  ${icon('shield', 'icon--sm')} Approve Go-Live
                </button>
              `}
            </div>
          </div>
        `;
      }
    }

    html += `</section>`;
    container.innerHTML = html;

    // Refresh handler
    container.querySelector('#btn-refresh-approvals')?.addEventListener('click', () => {
      renderAdminPipelineApprovals(container);
    });

    // Go-live approval button
    container.querySelectorAll('.btn-approve-go-live:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        openApproveGoLiveModal(btn.dataset.projectId, () => {
          renderAdminPipelineApprovals(container);
        });
      });
    });

  } catch (err) {
    console.error('Error rendering admin pipeline approvals:', err);
    container.innerHTML = `<div class="notice notice--danger">${icon('alert')}<div><strong>Error loading approvals</strong><p>${escapeHTML(api.extractError(err, 'Failed to load pipeline summary.'))}</p></div></div>`;
  }
}

/**
 * Modal for Admin Go-Live approval
 */
function openApproveGoLiveModal(projectId, onDone) {
  openDialog({
    title: 'Approve Pipeline Go-Live',
    subtitle: 'Final production sign-off. Transitions project and deliverables to LIVE.',
    content: `
      <form id="form-approve-golive" class="stack" novalidate>
        <div class="field">
          <label for="golive-notes">Approval Notes & Verification Record (required)</label>
          <textarea class="textarea" id="golive-notes" name="approval_notes" required placeholder="Record QA sign-off, production deployment hash, or readiness notes..." autofocus></textarea>
          <span class="field-hint">This note is recorded immutably in the central audit access_log.</span>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn--outline" data-close-dialog>Cancel</button>
      <button class="btn btn--primary" id="btn-confirm-golive">${icon('shield', 'icon--sm')} Authorize Go-Live</button>
    `,
    onMount(dialog) {
      const form = dialog.querySelector('#form-approve-golive');
      const confirmBtn = dialog.querySelector('#btn-confirm-golive');

      confirmBtn.addEventListener('click', async () => {
        const values = formValues(form);
        const notes = values.approval_notes?.trim();
        if (!notes) return setFormError(form, 'Approval notes are required.', 'approval_notes');

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Authorizing...';

        try {
          await api.patch(`/api/admin/projects/${projectId}/pipeline/approve-live`, {
            approval_notes: notes
          });
          closeDialog();
          toast('Project approved for LIVE production!', 'success');
          if (onDone) onDone();
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Authorize Go-Live';
          setFormError(form, api.extractError(err, 'Failed to approve Go-Live.'));
        }
      });
    }
  });
}
