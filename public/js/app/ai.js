import { state, currentUser, getProject, userTasks, visibleNotifications, persistData, addAudit, uid, escapeHTML, formatDateTime, titleCase } from './store.js';
import { icon, plainBadge, notice, toast } from './ui.js';
import { notificationPriority } from './notifications.js';

// Deterministic browser-only demonstrations of the seven touchpoints approved in 00_3.
// No model, network request, file-content parser, or autonomous final action is used.
export const AI_FEATURES = {
  reply: { label: 'Smart replies', short: 'Replies', icon: 'message', href: '#/app/support', description: 'Two or three editable drafts for member and Admin support replies.' },
  meeting_summary: { label: 'Meeting summaries', short: 'Meetings', icon: 'video', href: '#/app/meetings', description: 'Summary and action-item drafts that remain behind the Admin publish gate.' },
  research_summary: { label: 'Research summaries', short: 'Research', icon: 'book', href: '#/app/workspace', description: 'Metadata-based demonstration summaries; the original reference always remains primary.' },
  idea_prescore: { label: 'Idea pre-scores', short: 'Idea advisor', icon: 'bulb', href: '#/app/voting', description: 'Separate advisory hints that never enter human voting calculations.' },
  notification_digest: { label: 'Notification digests', short: 'Digest', icon: 'bell', href: '#/app/notifications', description: 'Daily or weekly batches of normal-priority local updates only.' },
  standup: { label: 'Standup drafts', short: 'Standup', icon: 'activity', href: '#/app/dashboard', description: 'Daily drafts derived from local task status and dependency state.' },
  task_breakdown: { label: 'Task breakdowns', short: 'Breakdowns', icon: 'check-square', href: '#/app/tasks', description: 'Editable subtask suggestions; only human acceptance creates local subtasks.' }
};

const DEFAULT_AI_CONFIG = {
  confidenceThreshold: 75,
  digestFrequencyHours: 24,
  features: Object.fromEntries(Object.keys(AI_FEATURES).map(key => [key, true]))
};

export function getAiConfig() {
  const saved = state.data.aiConfig || {};
  state.data.aiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...saved,
    features: { ...DEFAULT_AI_CONFIG.features, ...(saved.features || {}) }
  };
  return state.data.aiConfig;
}
export function aiEnabled(type) { return Boolean(getAiConfig().features[type]); }
export function aiDisabledNotice(type) {
  if (aiEnabled(type)) return '';
  return notice(`${AI_FEATURES[type]?.label || 'This AI touchpoint'} is disabled by Admin. Existing operational controls remain available.`, 'info', 'Simulated touchpoint disabled', 'lock');
}

function recordInteraction(suggestion, action) {
  state.data.aiInteractions ||= [];
  state.data.aiInteractions.push({ id: uid('ai-log'), suggestionId: suggestion.id, type: suggestion.type, action, userId: currentUser()?.id || null, at: new Date().toISOString() });
  addAudit(`ai_${action}`, `suggestion:${suggestion.id} type:${suggestion.type} source:${suggestion.sourceId} local-simulation`, 'ai', action === 'rejected' ? 'warning' : 'info');
}

export function createAiSuggestion({ type, sourceId, targetUserId = currentUser()?.id || null, content, confidence = 70 }) {
  if (!aiEnabled(type) || !AI_FEATURES[type]) return null;
  state.data.aiSuggestions ||= [];
  const existing = state.data.aiSuggestions.find(item => item.type === type && item.sourceId === sourceId && item.targetUserId === targetUserId);
  if (existing) return existing;
  const suggestion = {
    id: uid('ai'), type, sourceId, targetUserId,
    suggestedContent: content.trim(), confidenceScore: Math.max(0, Math.min(100, Number(confidence) || 0)),
    status: 'DRAFT', createdAt: new Date().toISOString(), reviewedBy: null, reviewedAt: null,
    simulated: true
  };
  state.data.aiSuggestions.unshift(suggestion);
  recordInteraction(suggestion, 'generated');
  persistData();
  return suggestion;
}

export function getAiSuggestion(id) { return (state.data.aiSuggestions || []).find(item => item.id === id) || null; }
export function suggestionsFor(type, sourceId = null) {
  return (state.data.aiSuggestions || []).filter(item => item.type === type && (!sourceId || item.sourceId === sourceId));
}

export function aiSuggestionHTML(suggestion, { readOnly = false, compact = false, context = '' } = {}) {
  if (!suggestion) return '';
  const config = getAiConfig(); const low = suggestion.confidenceScore < config.confidenceThreshold;
  const open = ['DRAFT', 'EDITED'].includes(suggestion.status);
  return `<section class="ai-suggestion ${low ? 'is-low-confidence' : ''} ${compact ? 'ai-suggestion--compact' : ''}" data-ai-suggestion="${suggestion.id}" data-ai-type="${suggestion.type}">
    <div class="ai-suggestion__head"><div>${plainBadge('✨ AI Suggested · Simulated', 'violet')} <span class="ai-confidence">${suggestion.confidenceScore}% confidence</span></div><span class="ai-status" data-ai-status>${titleCase(suggestion.status)}</span></div>
    ${context ? `<p class="ai-suggestion__context">${escapeHTML(context)}</p>` : ''}
    ${low ? notice('AI is not fully confident - please review carefully before accepting. This deterministic demo did not call a model.', 'warning') : ''}
    <div class="ai-suggestion__content" data-ai-content>${escapeHTML(suggestion.suggestedContent)}</div>
    <div class="ai-suggestion__editor" data-ai-editor hidden><label class="field"><span class="field-label">Edit simulated suggestion</span><textarea class="textarea" data-ai-edit-text>${escapeHTML(suggestion.suggestedContent)}</textarea></label><div class="cluster mt-1"><button class="btn btn--primary btn--sm" type="button" data-ai-save-edit>Save edited draft</button><button class="btn btn--ghost btn--sm" type="button" data-ai-cancel-edit>Cancel</button></div></div>
    <p class="tiny muted mt-1">Local template/output only. Human review is required; no final action is automatic.</p>
    ${open && !readOnly ? `<div class="ai-suggestion__actions" data-ai-actions><button class="btn btn--primary btn--sm" type="button" data-ai-review="accept">${icon('check', 'icon--sm')} Accept</button><button class="btn btn--outline btn--sm" type="button" data-ai-review="edit">${icon('edit', 'icon--sm')} Edit</button><button class="btn btn--ghost btn--sm" type="button" data-ai-review="reject">${icon('x', 'icon--sm')} Reject</button></div>` : `<div class="ai-suggestion__reviewed">${suggestion.reviewedAt ? `${titleCase(suggestion.status)} ${formatDateTime(suggestion.reviewedAt)}` : readOnly ? 'Review is reserved for the assigned member or Admin.' : titleCase(suggestion.status)}</div>`}
  </section>`;
}

function paintReviewed(card, suggestion) {
  card.dataset.aiState = suggestion.status;
  const status = card.querySelector('[data-ai-status]'); if (status) status.textContent = titleCase(suggestion.status);
  const actions = card.querySelector('[data-ai-actions]');
  if (actions) actions.innerHTML = `<span class="ai-suggestion__reviewed">${titleCase(suggestion.status)} · human review recorded locally</span>`;
}

export function bindAiSuggestions(root = document, { onAccept = null } = {}) {
  root.querySelectorAll('[data-ai-review]').forEach(button => button.addEventListener('click', () => {
    const card = button.closest('[data-ai-suggestion]'); const suggestion = getAiSuggestion(card?.dataset.aiSuggestion); if (!suggestion) return;
    const action = button.dataset.aiReview;
    if (action === 'edit') { const editor = card.querySelector('[data-ai-editor]'); editor.hidden = false; editor.querySelector('textarea')?.focus(); return; }
    if (!['DRAFT', 'EDITED'].includes(suggestion.status)) return;
    if (action === 'accept') {
      if (onAccept?.(suggestion, card) === false) return;
      suggestion.status = 'ACCEPTED';
    } else if (action === 'reject') suggestion.status = 'REJECTED';
    else return;
    suggestion.reviewedBy = currentUser()?.id || null; suggestion.reviewedAt = new Date().toISOString();
    recordInteraction(suggestion, action === 'accept' ? 'accepted' : 'rejected'); persistData(); paintReviewed(card, suggestion);
  }));
  root.querySelectorAll('[data-ai-save-edit]').forEach(button => button.addEventListener('click', () => {
    const card = button.closest('[data-ai-suggestion]'); const suggestion = getAiSuggestion(card?.dataset.aiSuggestion); if (!suggestion) return;
    const editor = card.querySelector('[data-ai-editor]'); const text = editor.querySelector('[data-ai-edit-text]').value.trim();
    if (!text) { editor.querySelector('[data-ai-edit-text]').setAttribute('aria-invalid', 'true'); return; }
    suggestion.suggestedContent = text; suggestion.status = 'EDITED'; suggestion.reviewedBy = currentUser()?.id || null; suggestion.reviewedAt = new Date().toISOString();
    card.querySelector('[data-ai-content]').textContent = text; card.querySelector('[data-ai-status]').textContent = 'Edited'; editor.hidden = true;
    recordInteraction(suggestion, 'edited'); persistData();
  }));
  root.querySelectorAll('[data-ai-cancel-edit]').forEach(button => button.addEventListener('click', () => { button.closest('[data-ai-editor]').hidden = true; }));
}

export function ensureReplySuggestions(ticket, viewer = currentUser()) {
  if (!viewer || !aiEnabled('reply')) return [];
  const last = [...ticket.messages].reverse().find(message => !message.internal) || ticket.messages.at(-1);
  const subject = ticket.subject;
  const drafts = [
    `Thanks for the context about “${subject}”. I’ve reviewed the thread and will check the relevant project or account state before adding an update.`,
    `I can reproduce the concern described in ${ticket.number}. Could you confirm the exact project or screen and the result you expected? I’ll keep the details in this thread.`,
    ticket.status === 'resolved' || ticket.status === 'closed'
      ? `Thanks for confirming. I’ll keep ${ticket.number} closed; if the same issue returns, please reference this ticket so the history stays connected.`
      : `The next step is clear: I’ll review the latest message${last?.userId === viewer.id ? '' : ` from ${last?.userId || 'the reporter'}`} and reply here with a specific update rather than changing the ticket automatically.`
  ];
  return drafts.map((content, index) => createAiSuggestion({ type: 'reply', sourceId: `${ticket.id}:${viewer.id}:${index + 1}`, targetUserId: viewer.id, content, confidence: index === 1 ? 68 : 82 }));
}

export function ensureResearchSummary(task) {
  if (!task || task.type !== 'research' || !task.deliverable || !aiEnabled('research_summary')) return null;
  const project = getProject(task.projectId);
  const content = [
    `Research frame: ${project?.title || 'this project'} needs evidence about the people, context, and constraints behind the proposed service.`,
    'Evidence check: verify interview/source coverage and distinguish observed needs from assumptions in the original handoff.',
    'Service constraint: preserve low-bandwidth, accessible states and explicit human ownership in downstream tracks.',
    'Open question: confirm which operational edge cases need design and test coverage before integration.',
    `Handoff: use “${task.deliverable}” as the source of truth; this demo summary is metadata-based, not a reading of its contents.`,
    'Next action: backend, frontend, design, and test owners should verify the original reference before acting.'
  ].join('\n');
  return createAiSuggestion({ type: 'research_summary', sourceId: task.id, targetUserId: task.assignedTo, content, confidence: 58 });
}

export function ensureIdeaPrescore(idea, viewer = currentUser()) {
  if (!idea || idea.status !== 'PENDING_REVIEW' || !viewer || !aiEnabled('idea_prescore')) return null;
  const text = `${idea.title} ${idea.description}`.toLowerCase();
  const specificity = Math.min(3, Math.floor(text.length / 180));
  const feasibility = Math.min(9, 5 + specificity + (/low-bandwidth|simple|concise|narrow/.test(text) ? 1 : 0));
  const market = Math.min(9, 5 + specificity + (/community|people|member|clinic|grower|student|worker/.test(text) ? 1 : 0));
  const capacity = Math.max(3, Math.min(9, 8 - (/partner|integration|automated|real-time/.test(text) ? 2 : 0) - (specificity === 0 ? 2 : 0)));
  const content = `Advisory only — not a vote\nFeasibility: ${feasibility}/10\nMarket: ${market}/10\nCapacity: ${capacity}/10\nReview cue: check the evidence, operating owner, dependency scope, and team capacity yourself. These template scores never change green percentage, quorum, or the final decision.`;
  return createAiSuggestion({ type: 'idea_prescore', sourceId: `${idea.id}:${viewer.id}`, targetUserId: viewer.id, content, confidence: 72 });
}

export function ensureNotificationDigest(user = currentUser()) {
  if (!user || !aiEnabled('notification_digest')) return null;
  const frequency = Number(getAiConfig().digestFrequencyHours); const bucket = Math.floor(Date.now() / (frequency * 3600000));
  const start = bucket * frequency * 3600000; const end = start + frequency * 3600000;
  const normal = visibleNotifications().filter(note => notificationPriority(note) === 'normal' && new Date(note.at).getTime() >= start && new Date(note.at).getTime() < end);
  const counts = normal.reduce((result, note) => { result[note.type] = (result[note.type] || 0) + 1; return result; }, {});
  const detail = Object.entries(counts).map(([type, count]) => `${count} ${type.replaceAll('_', ' ')} update${count === 1 ? '' : 's'}`).join(', ');
  const content = normal.length
    ? `${frequency === 24 ? 'Daily' : 'Weekly'} local digest: ${detail}.\nReview the linked inbox for context. Critical and urgent alerts were excluded and remain individual notifications.`
    : `${frequency === 24 ? 'Daily' : 'Weekly'} local digest: no normal-priority updates fall inside this period.\nCritical and urgent alerts are never batched into this digest.`;
  return createAiSuggestion({ type: 'notification_digest', sourceId: `${user.id}:${bucket}`, targetUserId: user.id, content, confidence: 91 });
}

export function ensureStandup(user = currentUser()) {
  if (!user || !aiEnabled('standup')) return null;
  const day = new Date().toISOString().slice(0, 10); const tasks = userTasks(user.id);
  const done = tasks.filter(task => task.completedAt && task.completedAt.slice(0, 10) === day);
  const active = tasks.filter(task => task.status === 'IN_PROGRESS'); const blocked = tasks.filter(task => task.status === 'BLOCKED');
  const names = (items, empty) => items.length ? items.slice(0, 3).map(task => task.name).join('; ') : empty;
  const content = `Yesterday / completed: ${names(done, 'No task completion was recorded locally today.')}\nToday / in progress: ${names(active, 'Review the ready queue and choose the next unblocked assignment.')}\nBlockers: ${names(blocked, 'No blocked tasks in the current local queue.')}\nEdit this draft before confirming; it is not posted to the team automatically.`;
  return createAiSuggestion({ type: 'standup', sourceId: `${user.id}:${day}`, targetUserId: user.id, content, confidence: done.length || active.length ? 84 : 66 });
}

export function ensureMeetingSummary(meeting) {
  if (!meeting || meeting.status !== 'ENDED' || !meeting.notesStatus || !aiEnabled('meeting_summary')) return null;
  const source = (meeting.transcriptRaw || meeting.notesEn || '').trim();
  const sentences = source.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(' ') || `${meeting.title} ended; confirm the discussion record and follow-up ownership with participants.`;
  const actionLines = source.split(/\n|(?<=[.!?])\s+/).filter(line => /\b(will|should|must|follow-up|action|next step)\b/i.test(line)).slice(0, 3);
  const actions = actionLines.length ? actionLines : ['Confirm owners and due dates for the follow-up actions before publishing.'];
  const content = `Summary\n${summary}\n\nAction items\n${actions.map(item => `• ${item.trim()}`).join('\n')}\n\nDraft only: Admin must review and confirm before attendees can see published notes.`;
  return createAiSuggestion({ type: 'meeting_summary', sourceId: meeting.id, targetUserId: meeting.hostId || currentUser()?.id, content, confidence: source.length > 120 ? 82 : 61 });
}

const BREAKDOWN_COPY = {
  research: ['Confirm research questions and target participants', 'Attach source/evidence log and synthesis', 'Record constraints and open handoff questions'],
  backend: ['Confirm API/resource boundaries from the research handoff', 'Define validation, permission, and failure states', 'Record integration notes for the frontend owner'],
  frontend: ['Map research and design states to component structure', 'Implement loading, empty, error, and responsive states', 'Document integration assumptions and keyboard checks'],
  testing: ['Translate acceptance criteria into pass/fail checks', 'Cover dependency, role, responsive, and accessibility cases', 'Attach bug list, evidence, and release recommendation']
};
export function ensureTaskBreakdown(task) {
  if (!task || !BREAKDOWN_COPY[task.type] || !task.assignedTo || !aiEnabled('task_breakdown')) return null;
  const project = getProject(task.projectId);
  const content = BREAKDOWN_COPY[task.type].map(item => `- ${item}${project ? ` (${project.title})` : ''}`).join('\n');
  return createAiSuggestion({ type: 'task_breakdown', sourceId: task.id, targetUserId: task.assignedTo, content, confidence: 78 });
}
export function ensureProjectBreakdowns(project) {
  if (!project) return [];
  return project.tasks.filter(task => BREAKDOWN_COPY[task.type]).map(ensureTaskBreakdown).filter(Boolean);
}
export function acceptBreakdown(suggestion, task) {
  if (!suggestion || !task) return;
  const lines = suggestion.suggestedContent.split('\n').map(line => line.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
  task.subtasks ||= [];
  lines.forEach(title => { if (!task.subtasks.some(item => item.title === title)) task.subtasks.push({ id: uid('sub'), title, status: 'TODO', sourceSuggestionId: suggestion.id, localOnly: true }); });
  persistData();
}

export function applyAiSuggestion(suggestion) {
  if (!suggestion) return;
  if (suggestion.type === 'task_breakdown') {
    const task = state.data.projects.flatMap(project => project.tasks).find(item => item.id === suggestion.sourceId);
    if (task) acceptBreakdown(suggestion, task);
  }
  if (suggestion.type === 'research_summary') {
    const task = state.data.projects.flatMap(project => project.tasks).find(item => item.id === suggestion.sourceId);
    if (task) task.researchSummary = suggestion.suggestedContent;
  }
  if (suggestion.type === 'standup') {
    state.data.standups ||= [];
    if (!state.data.standups.some(item => item.suggestionId === suggestion.id)) state.data.standups.push({ id: uid('standup'), suggestionId: suggestion.id, userId: currentUser()?.id, content: suggestion.suggestedContent, status: 'CONFIRMED_LOCAL', confirmedAt: new Date().toISOString(), localOnly: true });
  }
  // Pre-scores and digests are acknowledgements only. Meeting summaries are applied
  // in their review dialog so the existing Admin confirmation gate remains explicit.
  persistData();
}

export function renderAiSettings() {
  const config = getAiConfig();
  return `<form id="ai-config-form" class="stack"><section class="config-card"><div class="config-card__head"><span class="config-card__icon">${icon('activity')}</span><div><h3>AI Settings · simulated touchpoints</h3><p>Seven approved assists only. Every suggestion requires human review and no model is connected.</p></div></div><div class="field"><label for="ai-confidence">Confidence warning threshold · <output id="ai-confidence-value">${config.confidenceThreshold}%</output></label><input id="ai-confidence" name="confidenceThreshold" type="range" min="0" max="100" step="1" value="${config.confidenceThreshold}"><span class="field-hint">Suggestions below this score show the yellow review warning.</span></div><div class="field mt-2"><label for="ai-digest-frequency">Digest frequency</label><select class="select" id="ai-digest-frequency" name="digestFrequencyHours"><option value="24" ${Number(config.digestFrequencyHours) === 24 ? 'selected' : ''}>Every 24 hours / daily</option><option value="168" ${Number(config.digestFrequencyHours) === 168 ? 'selected' : ''}>Every 168 hours / weekly</option></select></div></section><section class="config-card"><div class="config-card__head"><span class="config-card__icon">${icon('settings')}</span><div><h3>Independent feature toggles</h3><p>Disabling an assist never disables the underlying operational workflow.</p></div></div><div class="ai-toggle-grid">${Object.entries(AI_FEATURES).map(([type, meta]) => `<label class="check ai-toggle"><input type="checkbox" name="feature:${type}" ${config.features[type] ? 'checked' : ''}><span><strong>${meta.label}</strong><br><small>${meta.description}</small></span></label>`).join('')}</div></section>${notice('Settings and suggestions are stored in this browser only. No AI endpoint, model, database, or automatic sender is connected.', 'info')}<div class="form-actions"><button class="btn btn--primary" type="submit">Save local AI settings</button></div></form>`;
}

export function bindAiSettings() {
  const form = document.querySelector('#ai-config-form'); if (!form) return;
  const range = form.elements.confidenceThreshold; range?.addEventListener('input', () => { document.querySelector('#ai-confidence-value').textContent = `${range.value}%`; });
  form.addEventListener('submit', event => {
    event.preventDefault(); const threshold = Number(range.value); const frequency = Number(form.elements.digestFrequencyHours.value);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) return;
    if (![24, 168].includes(frequency)) return;
    const config = getAiConfig(); config.confidenceThreshold = threshold; config.digestFrequencyHours = frequency;
    Object.keys(AI_FEATURES).forEach(type => { config.features[type] = Boolean(form.elements[`feature:${type}`]?.checked); });
    addAudit('admin_ai_config_updated', `threshold:${threshold} digest:${frequency} toggles:${JSON.stringify(config.features)} local-only`, 'ai', 'warning'); persistData();
    toast('Seven simulated AI touchpoint settings saved locally.', 'info');
  });
}
