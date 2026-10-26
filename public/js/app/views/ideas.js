import { taskBlueprints } from '../data.js';
import { state, currentUser, getUser, getIdea, getProject, pendingVotesFor, persistData, addAudit, addNotification, formatDate, formatDateTime, relativeTime, escapeHTML, titleCase, uid } from '../store.js';
import { icon, badge, plainBadge, avatar, person, progress, pageHead, notice, emptyState, withPreview, openDialog, closeDialog, toast, bindTabs, formValues, setFormError } from '../ui.js';

function ideaVotes(ideaId) { return state.data.votes.filter(vote => vote.ideaId === ideaId); }
function quotaFor(userId) {
  const config = state.data.config; const cutoff = Date.now() - config.quotaCycleDays * 86400000;
  const used = state.data.ideas.filter(idea => idea.ownerId === userId && idea.status !== 'DRAFT' && idea.submittedAt && new Date(idea.submittedAt).getTime() >= cutoff).length;
  return { used, remaining: Math.max(0, config.ideaQuota - used), limit: config.ideaQuota, days: config.quotaCycleDays };
}
function voteMeter(idea) {
  const votes = ideaVotes(idea.id); const green = votes.filter(vote => vote.color === 'green').length; const red = votes.length - green;
  const greenWidth = votes.length ? green / votes.length * 100 : 0; const redWidth = votes.length ? red / votes.length * 100 : 0;
  return `<div class="vote-meter"><div class="vote-meter__bar" role="img" aria-label="${green} green and ${red} red votes"><span class="green" style="width:${greenWidth}%"></span><span class="red" style="width:${redWidth}%"></span></div><div class="vote-meter__labels"><span>${green} green · ${red} red</span><strong>${idea.greenPercentage || 0}% green</strong></div></div>`;
}
function ideaCard(idea) {
  const owner = getUser(idea.ownerId); const user = currentUser(); const hasVoted = ideaVotes(idea.id).some(vote => vote.voterId === user.id);
  return `<article class="idea-card" data-idea-status="${idea.status}" data-idea-owner="${idea.ownerId}" data-search="${escapeHTML(`${idea.title} ${idea.description}`.toLowerCase())}"><div class="idea-card__top">${badge(idea.status)}<span class="tiny muted">${idea.submittedAt ? relativeTime(idea.submittedAt) : 'Unsubmitted draft'}</span></div><h2>${escapeHTML(idea.title)}</h2><p class="idea-card__description">${escapeHTML(idea.description)}</p><div class="idea-card__meta"><span>By ${escapeHTML(owner?.name)}</span><span>${ideaVotes(idea.id).length} votes</span>${idea.projectId ? '<span>Project created</span>' : ''}</div>${idea.status === 'PENDING_REVIEW' ? voteMeter(idea) : ''}<div class="idea-card__foot"><span class="person">${avatar(owner, 'sm')}<span class="person__meta"><strong>${escapeHTML(owner?.name)}</strong><span>${titleCase(owner?.role || '')}</span></span></span><a class="btn btn--outline btn--sm" href="#/app/ideas/${idea.id}">${idea.status === 'PENDING_REVIEW' && idea.ownerId !== user.id && !hasVoted ? 'Review & vote' : 'Open idea'} ${icon('arrow-up-right', 'icon--sm')}</a></div></article>`;
}

export function evaluateVotingDecision(ideaId, simulatedDate = null) {
  const idea = getIdea(ideaId); if (!idea) return { action: 'NOT_FOUND' };
  if (idea.status !== 'PENDING_REVIEW') return { action: 'ALREADY_DECIDED', status: idea.status };
  const now = simulatedDate ? new Date(simulatedDate) : new Date();
  if (idea.deadline && new Date(idea.deadline) > now) return { action: 'PENDING', status: idea.status };
  const votes = ideaVotes(ideaId); const eligibleVoters = state.data.users.filter(user => user.status === 'active' && user.id !== idea.ownerId).length;
  const green = votes.filter(vote => vote.color === 'green').length; const greenPercentage = votes.length ? Math.round(green / votes.length * 10000) / 100 : 0; const participationRate = eligibleVoters ? Math.round(votes.length / eligibleVoters * 10000) / 100 : 0;
  idea.eligible = eligibleVoters; idea.greenPercentage = greenPercentage; idea.participation = participationRate; idea.decisions ||= [];
  const meeting = idea.reviewMeeting;
  if (participationRate < state.data.config.quorumPercentage && meeting && meeting.status !== 'EXTENDED') {
    const currentEnd = new Date(meeting.votingWindowEnd || idea.deadline); const extendedEnd = new Date(currentEnd.getTime() + 24 * 3600000).toISOString();
    meeting.status = 'EXTENDED'; meeting.votingWindowEnd = extendedEnd; idea.deadline = extendedEnd;
    const reason = `Quorum not met (${participationRate}% < ${state.data.config.quorumPercentage}%). Window extended 24 hours.`;
    idea.decisions.push({ decision: 'EXTENDED', reason, actorId: null, at: now.toISOString(), newDeadline: extendedEnd });
    addAudit('voting_window_extended', `review_meeting:${meeting.id} idea:${ideaId} participation:${participationRate}%`, 'voting', 'warning'); persistData();
    return { action: 'EXTENDED', reason, newDeadline: extendedEnd, participationRate };
  }
  const newStatus = greenPercentage >= state.data.config.approvalThreshold ? 'APPROVED' : greenPercentage >= 50 ? 'REVISE' : 'REJECTED';
  idea.status = newStatus; if (meeting) meeting.status = 'COMPLETED';
  const reason = newStatus === 'APPROVED' ? `Green vote ${greenPercentage}% met the ${state.data.config.approvalThreshold}% approval threshold.` : newStatus === 'REVISE' ? `Green vote ${greenPercentage}% was between 50% and the approval threshold.` : `Green vote ${greenPercentage}% remained below 50%.`;
  idea.decisions.push({ decision: newStatus, reason, actorId: null, at: now.toISOString() });
  addAudit(`voting_decision_${newStatus.toLowerCase()}`, `idea:${ideaId} green:${greenPercentage}% participation:${participationRate}%`, 'voting', newStatus === 'APPROVED' ? 'info' : 'warning');
  const project = newStatus === 'APPROVED' ? fanoutIdea(idea) : null;
  addNotification(idea.ownerId, 'idea', `Voting completed for “${idea.title}”: ${newStatus}.`, project ? `#/app/projects/${project.id}` : `#/app/ideas/${idea.id}`); persistData();
  return { action: newStatus, status: newStatus, greenPercentage, participationRate, project };
}

export function renderIdeas() {
  state.data.ideas.forEach(idea => evaluateVotingDecision(idea.id));
  const user = currentUser(); const quota = quotaFor(user.id);
  const actions = `<a class="btn btn--outline" href="#/app/voting">${icon('vote')} Voting queue <span class="badge badge--info badge--no-dot">${pendingVotesFor().length}</span></a><a class="btn btn--primary" href="#/app/ideas/new">${icon('plus')} New idea</a>`;
  const content = `<div class="role-banner"><span class="role-banner__icon">${icon('bulb')}</span><div><h2>${quota.remaining} of ${quota.limit} submissions remain in this ${quota.days}-day window</h2><p>Drafts do not consume quota. Submitting or submitting a saved draft does.</p></div><a class="btn btn--soft btn--sm" href="#/app/ideas/new">Open editor</a></div><div class="filter-bar"><div class="field field--search"><label for="idea-search">Search ideas</label><div class="input-wrap">${icon('search')}<input class="input" id="idea-search" placeholder="Search title or description"></div></div><div class="field"><label for="idea-status">Decision state</label><select class="select" id="idea-status"><option value="all">All states</option><option value="DRAFT">Drafts</option><option value="PENDING_REVIEW">Pending review</option><option value="APPROVED">Approved</option><option value="REVISE">Revise</option><option value="REJECTED">Rejected</option><option value="KILLED">Removed by Admin</option></select></div><div class="field"><label for="idea-owner">Ownership</label><select class="select" id="idea-owner"><option value="all">All members</option><option value="mine">My ideas</option></select></div><span class="filter-count" id="idea-count">${state.data.ideas.length} ideas</span></div><div class="idea-grid" id="idea-grid">${state.data.ideas.map(ideaCard).join('')}</div><div id="idea-filter-empty" hidden>${emptyState('No ideas match these filters', 'Clear a filter or search for a different phrase.', '', 'search')}</div>`;
  return { html: `${pageHead('Ideation & governance', 'Ideas with a decision trail.', 'Draft, submit, score, vote, and inspect the outcome without losing the context behind it.', actions)}${withPreview(content, { title: 'No ideas in this workspace', description: 'Start a draft or clear the current filters to see proposals.', action: '<a class="btn btn--primary" href="#/app/ideas/new">Create a draft</a>', icon: 'bulb' })}`, mount() {
    const search = document.querySelector('#idea-search'); const status = document.querySelector('#idea-status'); const owner = document.querySelector('#idea-owner');
    const filter = () => {
      let visible = 0; const query = search.value.trim().toLowerCase();
      document.querySelectorAll('#idea-grid [data-idea-status]').forEach(card => { const show = (!query || card.dataset.search.includes(query)) && (status.value === 'all' || card.dataset.ideaStatus === status.value) && (owner.value === 'all' || card.dataset.ideaOwner === user.id); card.hidden = !show; if (show) visible++; });
      document.querySelector('#idea-count').textContent = `${visible} idea${visible === 1 ? '' : 's'}`; document.querySelector('#idea-filter-empty').hidden = visible > 0;
    };
    search?.addEventListener('input', filter); status?.addEventListener('change', filter); owner?.addEventListener('change', filter);
  } };
}

function ideaForm(idea = null) {
  const user = currentUser(); const quota = quotaFor(user.id);
  const content = `${idea ? notice('Only DRAFT ideas can be edited. Saving changes does not consume quota; submitting does.', 'info') : ''}<form id="idea-form" class="stack" novalidate><input type="hidden" name="ideaId" value="${idea?.id || ''}"><div class="field"><label for="idea-title">Idea title</label><input class="input" id="idea-title" name="title" maxlength="200" required value="${escapeHTML(idea?.title || '')}" placeholder="Frame the opportunity clearly"></div><div class="field"><label for="idea-description">Problem, people, and proposed direction</label><textarea class="textarea" id="idea-description" name="description" style="min-height:190px" required placeholder="What problem have you observed? Who experiences it? What would you like the team to research or build?">${escapeHTML(idea?.description || '')}</textarea><span class="field-hint">A title and description are required for drafts and submission.</span></div><div class="field"><label for="idea-attachment">Attachment URL (optional)</label><input class="input" id="idea-attachment" name="attachmentUrl" type="url" value="${escapeHTML(idea?.attachmentUrl || '')}" placeholder="https://…"><span class="field-hint">Saved as a text reference only. This prototype never fetches or uploads the attachment.</span></div><div class="grid-2"><div class="card card--pad" style="padding:16px"><div class="eyebrow">Quota</div><strong class="mt-1" style="display:block;font:650 24px var(--font-display)">${quota.remaining} remaining</strong><span class="small muted">${quota.used}/${quota.limit} used in the current ${quota.days}-day window.</span></div><div class="card card--pad" style="padding:16px"><div class="eyebrow">Voting contract</div><strong class="mt-1" style="display:block;font:650 24px var(--font-display)">${state.data.config.approvalThreshold}% green</strong><span class="small muted">${state.data.config.quorumPercentage}% quorum · ${state.data.config.votingWindowHours}-hour window.</span></div></div>${notice('Green votes at or above the approval threshold lead to APPROVED after quorum. 50% up to the threshold leads to REVISE; below 50% leads to REJECTED. The idea owner cannot vote.', 'info')}</form>`;
  return { html: `${pageHead(idea ? 'Edit draft' : 'New idea', idea ? 'Refine the draft.' : 'Give the team something clear to consider.', 'Draft freely, then submit when the proposal is ready for the team voting window.', '<a class="btn btn--outline" href="#/app/ideas">Cancel</a>')}${content}<div class="form-actions"><button class="btn btn--outline" id="save-draft">Save draft locally</button><button class="btn btn--primary" id="submit-idea">Submit for team review ${icon('arrow-up-right')}</button></div>`, mount() {
    const save = submitMode => {
      const form = document.querySelector('#idea-form'); const values = formValues(form);
      if (!values.title?.trim()) return setFormError(form, 'Add a title before saving this idea.', 'title');
      if (!values.description?.trim()) return setFormError(form, 'Add a description before saving this idea.', 'description');
      if (values.attachmentUrl && !/^https?:\/\//i.test(values.attachmentUrl)) return setFormError(form, 'Use an http(s) attachment URL or leave it blank.', 'attachmentUrl');
      if (submitMode === 'submit' && quota.remaining <= 0) return setFormError(form, `Submission quota exhausted for this ${quota.days}-day window. You can still save a draft.`);
      let target = idea;
      if (!target) {
        target = { id: uid('i'), ownerId: user.id, title: values.title.trim(), description: values.description.trim(), attachmentUrl: values.attachmentUrl || null, status: 'DRAFT', submittedAt: null, deadline: null, greenPercentage: 0, participation: 0, eligible: state.data.users.filter(member => member.status === 'active' && member.id !== user.id).length, projectId: null, comments: [], decisions: [] };
        state.data.ideas.unshift(target);
      } else { target.title = values.title.trim(); target.description = values.description.trim(); target.attachmentUrl = values.attachmentUrl || null; }
      if (submitMode === 'submit') {
        target.status = 'PENDING_REVIEW'; target.submittedAt = new Date().toISOString(); target.deadline = new Date(Date.now() + state.data.config.votingWindowHours * 3600000).toISOString(); target.reviewMeeting = { id: uid('review'), ideaId: target.id, status: 'SCHEDULED', scheduledAt: target.submittedAt, votingWindowEnd: target.deadline, createdAt: target.submittedAt };
        target.decisions.push({ decision: 'VOTING_OPEN', reason: 'Idea submitted and review window opened.', actorId: user.id, at: target.submittedAt });
        addAudit('idea_submitted', `idea:${target.id} local voting window opened`, 'ideas');
        state.data.users.filter(member => member.status === 'active' && member.id !== user.id).forEach(member => addNotification(member.id, 'vote', `A new idea is awaiting your vote: “${target.title}”.`, `#/app/ideas/${target.id}`));
      } else addAudit('idea_draft_saved', `idea:${target.id} local draft`, 'ideas');
      persistData(); toast(submitMode === 'submit' ? 'Idea submitted to the local voting queue. No server submission occurred.' : 'Draft saved in local mock data.', 'info'); location.hash = `#/app/ideas/${target.id}`;
    };
    document.querySelector('#save-draft')?.addEventListener('click', () => save('draft'));
    document.querySelector('#submit-idea')?.addEventListener('click', () => save('submit'));
  } };
}

export function renderNewIdea(params) {
  const draft = params.get('draft') ? getIdea(params.get('draft')) : null; const user = currentUser();
  if (draft && (draft.status !== 'DRAFT' || draft.ownerId !== user.id)) return { html: `${pageHead('Idea editor', 'Draft unavailable')}${notice('Only the owner can edit an idea while it is in DRAFT status.', 'danger', 'Editing restricted', 'lock')}` };
  return ideaForm(draft);
}

export function renderVoting() {
  state.data.ideas.forEach(idea => evaluateVotingDecision(idea.id));
  const pending = pendingVotesFor(); const user = currentUser();
  const voted = state.data.ideas.filter(idea => ideaVotes(idea.id).some(vote => vote.voterId === user.id));
  const content = `<div class="tabs" data-tabs role="tablist"><button class="tab" data-tab="pending" aria-selected="true">Awaiting my vote <span class="tab-count">${pending.length}</span></button><button class="tab" data-tab="history" aria-selected="false">My voting history <span class="tab-count">${voted.length}</span></button></div><div data-tab-scope><section data-tab-panel="pending">${pending.length ? `<div class="idea-grid">${pending.map(ideaCard).join('')}</div>` : emptyState('Your voting queue is clear', 'Ideas awaiting your green or red vote will appear here. You cannot vote on your own ideas.', '<a class="btn btn--outline" href="#/app/ideas">Browse all ideas</a>', 'vote')}</section><section data-tab-panel="history" hidden>${voted.length ? `<div class="idea-grid">${voted.map(ideaCard).join('')}</div>` : emptyState('No votes recorded', 'Your mock voting history will appear after you cast a vote.', '', 'vote')}</section></div>`;
  return { html: `${pageHead('Team consensus', 'Your vote, with your reasoning.', 'Cast one green or red vote per idea and add optional feasibility, market, capacity, and comment context.', '<a class="btn btn--outline" href="#/app/ideas">All ideas</a>')}${withPreview(content, { title: 'No voting work here', description: 'Your queue is empty in this preview.', icon: 'vote' })}`, mount() { bindTabs(document); } };
}

export function renderIdeaDetail(id) {
  evaluateVotingDecision(id);
  const idea = getIdea(id); const user = currentUser();
  if (!idea) return { html: `${pageHead('Ideas', 'Idea not found')}${emptyState('This idea does not exist', 'Return to the idea library to choose another record.', '<a class="btn btn--primary" href="#/app/ideas">Back to ideas</a>', 'bulb')}` };
  const owner = getUser(idea.ownerId); const votes = ideaVotes(id); const green = votes.filter(vote => vote.color === 'green').length;
  const userVote = votes.find(vote => vote.voterId === user.id); const canVote = idea.status === 'PENDING_REVIEW' && idea.ownerId !== user.id && !userVote && new Date(idea.deadline).getTime() > Date.now();
  const participation = idea.eligible ? Math.round(votes.length / idea.eligible * 1000) / 10 : 0;
  const comments = [...(idea.comments || []).map(comment => ({ ...comment, color: null })), ...votes.filter(vote => vote.comment).map(vote => ({ userId: vote.voterId, text: vote.comment, at: vote.at, color: vote.color }))].sort((a, b) => new Date(b.at) - new Date(a.at));
  const actions = `${idea.status === 'DRAFT' && idea.ownerId === user.id ? `<a class="btn btn--outline" href="#/app/ideas/new?draft=${idea.id}">${icon('edit')} Edit draft</a>` : ''}${idea.projectId ? `<a class="btn btn--outline" href="#/app/projects/${idea.projectId}">${icon('folder')} Open project</a>` : ''}${canVote ? `<button class="btn btn--primary" id="cast-vote">${icon('vote')} Cast vote</button>` : ''}${user?.role === 'admin' && !['KILLED', 'ARCHIVED'].includes(idea.status) ? `<button class="btn btn--outline" id="override-idea">${icon('shield')} Admin decision</button>` : ''}`;
  const main = `<div class="grid-main-side"><div class="stack"><section class="card card--pad"><div class="spread"><div class="person">${avatar(owner)}<div class="person__meta"><strong>${escapeHTML(owner?.name)}</strong><span>${titleCase(owner?.role || '')} · Idea owner</span></div></div>${badge(idea.status)}</div><h2 class="mt-3" style="font:600 25px/1.25 var(--font-display);letter-spacing:-.03em">${escapeHTML(idea.title)}</h2><p class="mt-2" style="line-height:1.8;color:var(--ink-2)">${escapeHTML(idea.description)}</p>${idea.attachmentUrl ? `<div class="mt-2"><span class="badge badge--info">Attachment reference</span><p class="small muted mt-1 mono">${escapeHTML(idea.attachmentUrl)}</p></div>` : ''}<div class="divider"></div><dl class="definition-list"><dt>Submitted</dt><dd>${formatDateTime(idea.submittedAt)}</dd><dt>Voting deadline</dt><dd>${formatDateTime(idea.deadline)}</dd><dt>Source project</dt><dd>${idea.projectId ? `<a class="link-btn" href="#/app/projects/${idea.projectId}">${escapeHTML(getProject(idea.projectId)?.title || idea.projectId)}</a>` : 'No project created'}</dd>${idea.killedReason ? `<dt>Removal reason</dt><dd>${escapeHTML(idea.killedReason)}</dd>` : ''}</dl>${idea.status === 'KILLED' ? `<div class="mt-2">${notice('This idea was removed from active ideation by Admin. Its previous status and reason remain in decision history.', 'danger')}</div>` : ''}</section><section class="card card--pad"><div class="eyebrow">Voter comments</div><h2 class="mt-1 mb-2" style="font:600 20px var(--font-display)">Reasoning alongside the score</h2>${comments.length ? comments.map(comment => { const commenter = getUser(comment.userId); return `<article class="comment"><div class="comment__head">${avatar(commenter, 'sm')}<strong>${escapeHTML(commenter?.name)}</strong>${comment.color ? badge(comment.color, comment.color === 'green' ? 'success' : 'danger') : ''}<time>${formatDateTime(comment.at)}</time></div><p>${escapeHTML(comment.text)}</p></article>`; }).join('') : emptyState('No voter comments yet', 'Optional comments submitted with votes will appear here.', '', 'message')}</section><section class="card card--pad"><div class="eyebrow">Decision history</div><div class="activity-list mt-2">${(idea.decisions || []).length ? [...idea.decisions].reverse().map(decision => `<div class="activity-item"><span class="activity-item__dot">${icon(decision.decision === 'APPROVED' ? 'check' : decision.decision === 'KILLED' ? 'alert' : 'vote')}</span><div><p><strong>${titleCase(decision.decision)}</strong> — ${escapeHTML(decision.reason)}</p><time>${formatDateTime(decision.at)} · ${decision.actorId ? escapeHTML(getUser(decision.actorId)?.name || 'Admin') : 'Voting engine'}</time></div></div>`).join('') : emptyState('No decision events', 'Drafts have not entered a voting or Admin decision flow.', '', 'clock')}</div></section></div><aside class="stack"><section class="card card--pad"><div class="eyebrow mb-2">Live vote summary</div><div class="vote-summary"><div class="quorum-ring" style="--pct:${Math.min(100, participation)}%"><div class="quorum-ring__copy"><strong>${participation}%</strong><span>participation</span></div></div><div><strong style="font:650 25px var(--font-display)">${idea.greenPercentage || 0}%</strong><p class="small muted">green votes</p><p class="tiny muted mt-1">${votes.length} of ${idea.eligible || 0} eligible voters</p></div></div><div class="mt-2">${voteMeter(idea)}</div><div class="key-value"><span>Approval threshold</span><strong>${state.data.config.approvalThreshold}% green</strong></div><div class="key-value"><span>Quorum</span><strong>${state.data.config.quorumPercentage}% participation</strong></div><div class="key-value"><span>Your vote</span><strong>${idea.ownerId === user.id ? 'Owner · cannot vote' : userVote ? titleCase(userVote.color) : canVote ? 'Not cast' : 'Unavailable'}</strong></div>${canVote ? `<button class="btn btn--primary btn--full mt-2" id="cast-vote-side">Review & vote</button>` : ''}</section><section class="card card--pad"><div class="eyebrow">Review meeting</div><h3 class="mt-1" style="font:600 17px var(--font-display)">${idea.reviewMeeting ? titleCase(idea.reviewMeeting.status) : idea.status === 'PENDING_REVIEW' ? 'Scheduled review window' : 'Review completed'}</h3><p class="small muted mt-1">The idea’s voting window and review-meeting record share the same deadline.</p><div class="key-value"><span>Opened</span><strong>${formatDate(idea.submittedAt, { year: false })}</strong></div><div class="key-value"><span>Window end</span><strong>${formatDate(idea.deadline, { year: false })}</strong></div>${idea.status === 'PENDING_REVIEW' && participation < state.data.config.quorumPercentage ? notice('Quorum is not yet met. At evaluation, the implemented service can extend the window by 24 hours.', 'warning') : ''}</section><section class="card card--pad"><div class="eyebrow">Votes by member</div><div class="mt-1">${votes.length ? votes.map(vote => `<div class="list-row"><div class="list-row__main">${person(getUser(vote.voterId), `${vote.color} · F${vote.feasibility ?? '—'} / M${vote.market ?? '—'} / C${vote.capacity ?? '—'}`)}</div>${badge(vote.color, vote.color === 'green' ? 'success' : 'danger')}</div>`).join('') : '<p class="small muted mt-2">No votes have been cast.</p>'}</div></section></aside></div>`;
  return { html: `${pageHead(`${idea.status.replaceAll('_', ' ')} · ${owner?.name}`, escapeHTML(idea.title), 'Proposal context, voting evidence, review timing, comments, and decision history.', actions)}${withPreview(main, { title: 'No idea detail in this preview', description: 'The empty-state preview hides the proposal, votes, and decision history.', icon: 'bulb' })}`, mount() {
    document.querySelector('#cast-vote')?.addEventListener('click', () => openVoteDialog(idea.id));
    document.querySelector('#cast-vote-side')?.addEventListener('click', () => openVoteDialog(idea.id));
    document.querySelector('#override-idea')?.addEventListener('click', () => openOverrideDialog(idea.id));
  } };
}

export function openVoteDialog(ideaId) {
  const idea = getIdea(ideaId); const user = currentUser();
  if (!idea || idea.status !== 'PENDING_REVIEW') return toast('Voting is only available while an idea is pending review.', 'error');
  if (idea.ownerId === user.id) return toast('Idea owners cannot vote on their own ideas.', 'error');
  if (ideaVotes(ideaId).some(vote => vote.voterId === user.id)) return toast('You have already voted on this idea.', 'error');
  if (new Date(idea.deadline).getTime() <= Date.now()) return toast('The voting window for this idea has closed.', 'error');
  openDialog({ title: 'Cast your team vote', subtitle: idea.title, wide: true, content: `<form id="vote-form" class="stack"><div class="field"><span class="field-label">Vote color</span><div class="vote-choice"><label class="green"><input type="radio" name="color" value="green" checked><span><strong>Green</strong><br><small>Support moving the idea forward</small></span></label><label class="red"><input type="radio" name="color" value="red"><span><strong>Red</strong><br><small>Do not support in the current form</small></span></label></div></div><div class="field"><span class="field-label">Optional scores · integers from 0 to 10</span><div class="score-grid"><div class="score-field"><label for="score-feasibility">Feasibility</label><input id="score-feasibility" name="feasibility" type="number" min="0" max="10" step="1" value="7"><small>Can this be delivered?</small></div><div class="score-field"><label for="score-market">Market</label><input id="score-market" name="market" type="number" min="0" max="10" step="1" value="7"><small>Is the need meaningful?</small></div><div class="score-field"><label for="score-capacity">Capacity</label><input id="score-capacity" name="capacity" type="number" min="0" max="10" step="1" value="7"><small>Can the team take it on?</small></div></div></div><div class="field"><label for="vote-comment">Comment (optional)</label><textarea class="textarea" id="vote-comment" name="comment" placeholder="Explain the reasoning behind your vote."></textarea></div>${notice('One vote per eligible active member. Your vote cannot be changed in this local preview after it is recorded.', 'warning')}</form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="record-vote">Record local vote</button>', onMount(dialog) {
    dialog.querySelector('#record-vote').addEventListener('click', () => {
      const form = dialog.querySelector('#vote-form'); const values = formValues(form);
      for (const key of ['feasibility', 'market', 'capacity']) { const value = values[key]; if (value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 10)) return setFormError(form, 'Scores must be whole numbers from 0 to 10.', key); }
      const vote = { id: uid('v'), ideaId, voterId: user.id, color: values.color, feasibility: values.feasibility === '' ? null : Number(values.feasibility), market: values.market === '' ? null : Number(values.market), capacity: values.capacity === '' ? null : Number(values.capacity), comment: values.comment?.trim() || null, at: new Date().toISOString() };
      state.data.votes.push(vote); const votes = ideaVotes(ideaId); idea.greenPercentage = Math.round(votes.filter(item => item.color === 'green').length / votes.length * 10000) / 100; idea.participation = Math.round(votes.length / idea.eligible * 1000) / 10;
      addAudit('vote_cast', `idea:${ideaId} ${vote.color}; local mock vote`, 'voting'); addNotification(idea.ownerId, 'vote', `${user.name} cast a ${vote.color} vote on “${idea.title}”.`, `#/app/ideas/${idea.id}`); evaluateVotingDecision(ideaId); persistData(); closeDialog(); toast('Your vote was recorded in local mock data only.'); window.dispatchEvent(new CustomEvent('app:refresh'));
    });
  } });
}

function chooseAssignee(blueprint) {
  const candidates = state.data.users.filter(user => user.status === 'active' && user.role === blueprint.role && (!blueprint.subRole || user.subRole === blueprint.subRole));
  const load = user => state.data.projects.flatMap(project => project.tasks).filter(task => task.assignedTo === user.id && task.status !== 'DONE').length;
  return [...candidates].sort((a, b) => load(a) - load(b) || b.rating - a.rating || a.joinedAt.localeCompare(b.joinedAt))[0]?.id || null;
}

export function fanoutIdea(idea) {
  if (idea.projectId && getProject(idea.projectId)) return getProject(idea.projectId);
  const id = uid('p'); const now = new Date().toISOString();
  const project = { id, ideaId: idea.id, code: `MTG–LOCAL`, title: idea.title, summary: idea.description, stage: 'RESEARCH_DEV_PARALLEL', status: 'ACTIVE', ownerId: idea.ownerId, createdAt: now, revenueStart: null, assetCount: 0, tasks: taskBlueprints.map((blueprint, index) => ({ id: `${id}-t${index + 1}`, projectId: id, ...blueprint, assignedTo: chooseAssignee(blueprint), status: index === 0 ? 'TODO' : 'BLOCKED', weight: index === 0 ? 18 : index === 8 ? 8 : 10, updatedAt: now, completedAt: null, deliverable: null })) };
  state.data.projects.unshift(project); idea.projectId = id; state.data.coworking[id] = { roomId: `room-${id}`, status: 'active', presence: [], objects: [], snapshots: [] };
  return project;
}

export function openOverrideDialog(ideaId) {
  const idea = getIdea(ideaId);
  openDialog({ title: 'Admin idea decision', subtitle: `${idea.title} · Executive override / veto`, content: `<form id="override-form" class="stack"><div class="field"><label for="override-decision">Decision</label><select class="select" id="override-decision" name="decision"><option value="APPROVED">APPROVED — create project if needed</option><option value="REVISE">REVISE — request revision</option><option value="REJECTED">REJECTED — close proposal</option></select></div><div class="field"><label for="override-reason">Mandatory reason</label><textarea class="textarea" id="override-reason" name="reason" required placeholder="Explain the decision and its operational context."></textarea></div>${notice('A clear reason is mandatory. Approving an idea triggers the nine-task project fan-out in the current service workflow; this demo mirrors that locally.', 'warning')}</form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--danger" id="save-override">Record local override</button>', onMount(dialog) {
    dialog.querySelector('#save-override').addEventListener('click', () => {
      const form = dialog.querySelector('#override-form'); const values = formValues(form); if (!values.reason?.trim()) return setFormError(form, 'A clear reason is strictly mandatory for an Admin override.', 'reason');
      idea.status = values.decision; idea.decisions.push({ decision: values.decision, reason: values.reason.trim(), actorId: currentUser().id, at: new Date().toISOString(), overridden: true });
      if (idea.reviewMeeting) idea.reviewMeeting.status = 'COMPLETED'; let project = null; if (values.decision === 'APPROVED') project = fanoutIdea(idea);
      addAudit('admin_override_veto', `idea:${idea.id} decision:${values.decision} reason:${values.reason.trim()}`, 'ideas', 'warning'); addNotification(idea.ownerId, 'idea', `Admin recorded ${values.decision} for “${idea.title}”.`, `#/app/ideas/${idea.id}`); persistData(); closeDialog(); toast(`Admin decision saved locally${project ? ' and nine-task project created' : ''}.`, 'info'); window.dispatchEvent(new CustomEvent('app:refresh'));
    });
  } });
}
