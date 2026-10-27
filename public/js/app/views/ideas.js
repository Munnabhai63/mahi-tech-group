import { taskBlueprints } from '../data.js';
import {
  state,
  currentUser,
  getUser,
  getIdea,
  getProject,
  pendingVotesFor,
  persistData,
  addAudit,
  addNotification,
  formatDate,
  formatDateTime,
  relativeTime,
  escapeHTML,
  titleCase,
  uid,
  fetchLiveQuota
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
  notice,
  emptyState,
  withPreview,
  openDialog,
  closeDialog,
  toast,
  bindTabs,
  formValues,
  setFormError
} from '../ui.js';

function ideaVotes(ideaId) { return state.data.votes.filter(vote => vote.ideaId === ideaId); }

function quotaFor(userId) {
  if (state.live.quota) {
    const q = state.live.quota;
    return {
      used: q.used || (q.limit - q.remaining),
      remaining: q.remaining,
      limit: q.limit,
      days: q.windowDays
    };
  }
  const config = state.data.config;
  const cutoff = Date.now() - config.quotaCycleDays * 86400000;
  const used = state.data.ideas.filter(idea => idea.ownerId === userId && idea.status !== 'DRAFT' && idea.submittedAt && new Date(idea.submittedAt).getTime() >= cutoff).length;
  return { used, remaining: Math.max(0, config.ideaQuota - used), limit: config.ideaQuota, days: config.quotaCycleDays };
}

function voteMeter(idea) {
  const votes = ideaVotes(idea.id);
  const green = votes.filter(vote => vote.color === 'green').length;
  const red = votes.length - green;
  const greenWidth = votes.length ? (green / votes.length) * 100 : 0;
  const redWidth = votes.length ? (red / votes.length) * 100 : 0;
  const pct = idea.green_percentage ?? idea.greenPercentage ?? 0;
  return `<div class="vote-meter"><div class="vote-meter__bar" role="img" aria-label="${green} green and ${red} red votes"><span class="green" style="width:${greenWidth}%"></span><span class="red" style="width:${redWidth}%"></span></div><div class="vote-meter__labels"><span>${green} green · ${red} red</span><strong>${pct}% green</strong></div></div>`;
}

function ideaCard(idea) {
  const owner = getUser(idea.owner_id || idea.ownerId);
  const user = currentUser();
  const hasVoted = ideaVotes(idea.id).some(vote => vote.voterId === user.id);
  const submitted = idea.submitted_at || idea.submittedAt;
  return `<article class="idea-card" data-idea-status="${idea.status}" data-idea-owner="${idea.owner_id || idea.ownerId}" data-search="${escapeHTML(`${idea.title} ${idea.description}`.toLowerCase())}"><div class="idea-card__top">${badge(idea.status)}<span class="tiny muted">${submitted ? relativeTime(submitted) : 'Unsubmitted draft'}</span></div><h2>${escapeHTML(idea.title)}</h2><p class="idea-card__description">${escapeHTML(idea.description)}</p><div class="idea-card__meta"><span>By ${escapeHTML(owner?.name || 'Member')}</span><span>${ideaVotes(idea.id).length} votes</span>${idea.projectId || idea.project_id ? '<span>Project created</span>' : ''}</div>${idea.status === 'PENDING_REVIEW' ? voteMeter(idea) : ''}<div class="idea-card__foot"><span class="person">${avatar(owner, 'sm')}<span class="person__meta"><strong>${escapeHTML(owner?.name || 'Member')}</strong><span>${titleCase(owner?.role || '')}</span></span></span><a class="btn btn--outline btn--sm" href="#/app/ideas/${idea.id}">${idea.status === 'PENDING_REVIEW' && (idea.owner_id || idea.ownerId) !== user.id && !hasVoted ? 'Review & vote' : 'Open idea'} ${icon('arrow-up-right', 'icon--sm')}</a></div></article>`;
}

export function evaluateVotingDecision(ideaId, simulatedDate = null) {
  const idea = getIdea(ideaId);
  if (!idea) return { action: 'NOT_FOUND' };
  if (idea.status !== 'PENDING_REVIEW') return { action: 'ALREADY_DECIDED', status: idea.status };
  const now = simulatedDate ? new Date(simulatedDate) : new Date();
  if (idea.deadline && new Date(idea.deadline) > now) return { action: 'PENDING', status: idea.status };
  const votes = ideaVotes(ideaId);
  const eligibleVoters = state.data.users.filter(user => user.status === 'active' && user.id !== (idea.owner_id || idea.ownerId)).length;
  const green = votes.filter(vote => vote.color === 'green').length;
  const greenPercentage = votes.length ? Math.round((green / votes.length) * 10000) / 100 : 0;
  const participationRate = eligibleVoters ? Math.round((votes.length / eligibleVoters) * 10000) / 100 : 0;
  idea.eligible = eligibleVoters;
  idea.greenPercentage = greenPercentage;
  idea.participation = participationRate;
  return { action: 'PENDING', status: idea.status, greenPercentage, participationRate };
}

export function renderIdeas() {
  const user = currentUser();
  const quota = quotaFor(user.id);
  const actions = `<a class="btn btn--outline" href="#/app/voting">${icon('vote')} Voting queue <span class="badge badge--info badge--no-dot">${pendingVotesFor().length}</span></a><a class="btn btn--primary" href="#/app/ideas/new">${icon('plus')} New idea</a>`;
  const content = `<div class="role-banner"><span class="role-banner__icon">${icon('bulb')}</span><div><h2>${quota.remaining} of ${quota.limit} submissions remain in this ${quota.days}-day window</h2><p>Drafts do not consume quota. Submitting or promoting a saved draft consumes 1 allocation.</p></div><a class="btn btn--soft btn--sm" href="#/app/ideas/new">Open editor</a></div><div class="filter-bar"><div class="field field--search"><label for="idea-search">Search ideas</label><div class="input-wrap">${icon('search')}<input class="input" id="idea-search" placeholder="Search title or description"></div></div><div class="field"><label for="idea-status">Decision state</label><select class="select" id="idea-status"><option value="all">All states</option><option value="DRAFT">Drafts</option><option value="PENDING_REVIEW">Pending review</option><option value="APPROVED">Approved</option><option value="REVISE">Revise</option><option value="REJECTED">Rejected</option><option value="KILLED">Removed by Admin</option></select></div><div class="field"><label for="idea-owner">Ownership</label><select class="select" id="idea-owner"><option value="all">All members</option><option value="mine">My ideas</option></select></div><span class="filter-count" id="idea-count">${state.data.ideas.length} ideas</span></div><div class="idea-grid" id="idea-grid">${state.data.ideas.map(ideaCard).join('')}</div><div id="idea-filter-empty" hidden>${emptyState('No ideas match these filters', 'Clear a filter or search for a different phrase.', '', 'search')}</div>`;
  
  return {
    html: `${pageHead('Ideation & governance', 'Ideas with a decision trail.', 'Draft, submit, score, vote, and inspect the outcome with an immutable audit record.', actions)}${withPreview(content, { title: 'No ideas in this workspace', description: 'Start a draft or clear the current filters to see proposals.', action: '<a class="btn btn--primary" href="#/app/ideas/new">Create a draft</a>', icon: 'bulb' })}`,
    mount() {
      const search = document.querySelector('#idea-search');
      const status = document.querySelector('#idea-status');
      const owner = document.querySelector('#idea-owner');
      const filter = () => {
        let visible = 0;
        const query = search.value.trim().toLowerCase();
        document.querySelectorAll('#idea-grid [data-idea-status]').forEach(card => {
          const show = (!query || card.dataset.search.includes(query)) && (status.value === 'all' || card.dataset.ideaStatus === status.value) && (owner.value === 'all' || card.dataset.ideaOwner === user.id);
          card.hidden = !show;
          if (show) visible++;
        });
        document.querySelector('#idea-count').textContent = `${visible} idea${visible === 1 ? '' : 's'}`;
        document.querySelector('#idea-filter-empty').hidden = visible > 0;
      };
      search?.addEventListener('input', filter);
      status?.addEventListener('change', filter);
      owner?.addEventListener('change', filter);

      if (getAuthToken()) {
        fetchLiveQuota();
        api.get('/api/ideas/my').then(res => {
          if (res?.ideas?.length) {
            // Merge with state.data.ideas
            res.ideas.forEach(liveIdea => {
              const idx = state.data.ideas.findIndex(i => i.id === liveIdea.id);
              if (idx >= 0) state.data.ideas[idx] = { ...state.data.ideas[idx], ...liveIdea };
              else state.data.ideas.unshift(liveIdea);
            });
            filter();
          }
        }).catch(() => {});
      }
    }
  };
}

function ideaForm(idea = null) {
  const user = currentUser();
  const quota = quotaFor(user.id);
  const content = `${idea ? notice('Only DRAFT ideas can be edited. Saving changes does not consume quota; submitting does.', 'info') : ''}<form id="idea-form" class="stack" novalidate><input type="hidden" name="ideaId" value="${idea?.id || ''}"><div class="field"><label for="idea-title">Idea title</label><input class="input" id="idea-title" name="title" maxlength="200" required value="${escapeHTML(idea?.title || '')}" placeholder="Frame the opportunity clearly"></div><div class="field"><label for="idea-description">Problem, people, and proposed direction</label><textarea class="textarea" id="idea-description" name="description" style="min-height:190px" required placeholder="What problem have you observed? Who experiences it? What would you like the team to research or build?">${escapeHTML(idea?.description || '')}</textarea><span class="field-hint">A title and description are required for drafts and submission.</span></div><div class="field"><label for="idea-attachment">Attachment URL (optional text reference)</label><input class="input" id="idea-attachment" name="attachmentUrl" type="url" value="${escapeHTML(idea?.attachment_url || idea?.attachmentUrl || '')}" placeholder="https://…"><span class="field-hint">Specify a Google Drive, Figma, GitHub, or specification link.</span></div><div class="grid-2"><div class="card card--pad" style="padding:16px"><div class="eyebrow">Quota</div><strong class="mt-1" style="display:block;font:650 24px var(--font-display)">${quota.remaining} remaining</strong><span class="small muted">${quota.used}/${quota.limit} used in the current ${quota.days}-day window.</span></div><div class="card card--pad" style="padding:16px"><div class="eyebrow">Voting contract</div><strong class="mt-1" style="display:block;font:650 24px var(--font-display)">70% green</strong><span class="small muted">70% quorum · 48-hour voting window.</span></div></div>${notice('Green votes at or above 70% lead to APPROVED after quorum. 50% up to 70% leads to REVISE; below 50% leads to REJECTED. The idea owner cannot vote.', 'info')}</form>`;
  
  return {
    html: `${pageHead(idea ? 'Edit draft' : 'New idea', idea ? 'Refine the draft.' : 'Give the team something clear to consider.', 'Draft freely, then submit when the proposal is ready for team review.', '<a class="btn btn--outline" href="#/app/ideas">Cancel</a>')}${content}<div class="form-actions"><button class="btn btn--outline" id="save-draft">Save draft</button><button class="btn btn--primary" id="submit-idea">Submit for team review ${icon('arrow-up-right')}</button></div>`,
    mount() {
      if (getAuthToken()) {
        fetchLiveQuota();
      }
      const save = async submitMode => {
        const form = document.querySelector('#idea-form');
        const saveDraftBtn = document.querySelector('#save-draft');
        const submitBtn = document.querySelector('#submit-idea');
        const values = formValues(form);

        if (!values.title?.trim()) return setFormError(form, 'Add a title before saving this idea.', 'title');
        if (!values.description?.trim()) return setFormError(form, 'Add a description before saving this idea.', 'description');
        if (values.attachmentUrl && !/^https?:\/\//i.test(values.attachmentUrl)) return setFormError(form, 'Use a valid http(s) attachment URL or leave it blank.', 'attachmentUrl');
        if (submitMode === 'submit' && quota.remaining <= 0) return setFormError(form, `Submission quota exhausted for this ${quota.days}-day window. You can still save as a draft.`);

        saveDraftBtn.disabled = true;
        submitBtn.disabled = true;
        if (submitMode === 'submit') submitBtn.textContent = 'Submitting for review...';
        else saveDraftBtn.textContent = 'Saving draft...';

        try {
          if (getAuthToken()) {
            const payload = {
              title: values.title.trim(),
              description: values.description.trim(),
              attachment_url: values.attachmentUrl?.trim() || null
            };

            let res;
            if (submitMode === 'submit') {
              if (idea?.id && idea.status === 'DRAFT') {
                res = await api.post(`/api/ideas/${idea.id}/submit`);
              } else {
                res = await api.post('/api/ideas', payload);
              }
              toast('Idea submitted successfully! 48-hour voting window opened.', 'success');
              await fetchLiveQuota();
            } else {
              if (idea?.id && idea.status === 'DRAFT') {
                res = await api.patch(`/api/ideas/${idea.id}/draft`, payload);
              } else {
                res = await api.post('/api/ideas/draft', payload);
              }
              toast('Draft saved successfully.', 'info');
            }

            const savedId = res?.idea?.id || idea?.id;
            location.hash = savedId ? `#/app/ideas/${savedId}` : '#/app/ideas';
          } else {
            // Local fallback
            let target = idea;
            if (!target) {
              target = { id: uid('i'), ownerId: user.id, title: values.title.trim(), description: values.description.trim(), attachmentUrl: values.attachmentUrl || null, status: 'DRAFT', submittedAt: null, deadline: null, greenPercentage: 0, participation: 0, eligible: 4, projectId: null, comments: [], decisions: [] };
              state.data.ideas.unshift(target);
            } else {
              target.title = values.title.trim(); target.description = values.description.trim(); target.attachmentUrl = values.attachmentUrl || null;
            }
            if (submitMode === 'submit') {
              target.status = 'PENDING_REVIEW';
              target.submittedAt = new Date().toISOString();
              target.deadline = new Date(Date.now() + 48 * 3600000).toISOString();
              target.reviewMeeting = { id: uid('review'), ideaId: target.id, status: 'SCHEDULED', scheduledAt: target.submittedAt, votingWindowEnd: target.deadline, createdAt: target.submittedAt };
            }
            persistData();
            location.hash = `#/app/ideas/${target.id}`;
          }
        } catch (err) {
          saveDraftBtn.disabled = false;
          submitBtn.disabled = false;
          saveDraftBtn.textContent = 'Save draft';
          submitBtn.innerHTML = `Submit for team review ${icon('arrow-up-right')}`;
          setFormError(form, err.message || 'Failed to save idea.');
        }
      };

      document.querySelector('#save-draft')?.addEventListener('click', () => save('draft'));
      document.querySelector('#submit-idea')?.addEventListener('click', () => save('submit'));
    }
  };
}

export function renderNewIdea(params) {
  const draft = params.get('draft') ? getIdea(params.get('draft')) : null;
  const user = currentUser();
  if (draft && (draft.status !== 'DRAFT' || (draft.owner_id || draft.ownerId) !== user.id)) {
    return { html: `${pageHead('Idea editor', 'Draft unavailable')}${notice('Only the owner can edit an idea while it is in DRAFT status.', 'danger', 'Editing restricted', 'lock')}` };
  }
  return ideaForm(draft);
}

export function renderVoting() {
  const pending = state.live.pendingVotes?.length ? state.live.pendingVotes : pendingVotesFor();
  const user = currentUser();
  const voted = state.data.ideas.filter(idea => ideaVotes(idea.id).some(vote => vote.voterId === user.id));
  const content = `<div class="tabs" data-tabs role="tablist"><button class="tab" data-tab="pending" aria-selected="true">Awaiting my vote <span class="tab-count">${pending.length}</span></button><button class="tab" data-tab="history" aria-selected="false">My voting history <span class="tab-count">${voted.length}</span></button></div><div data-tab-scope><section data-tab-panel="pending">${pending.length ? `<div class="idea-grid">${pending.map(ideaCard).join('')}</div>` : emptyState('Your voting queue is clear', 'Ideas awaiting your green or red vote will appear here. You cannot vote on your own ideas.', '<a class="btn btn--outline" href="#/app/ideas">Browse all ideas</a>', 'vote')}</section><section data-tab-panel="history" hidden>${voted.length ? `<div class="idea-grid">${voted.map(ideaCard).join('')}</div>` : emptyState('No votes recorded', 'Your voting history will appear after you cast a vote.', '', 'vote')}</section></div>`;
  
  return {
    html: `${pageHead('Team consensus', 'Your vote, with your reasoning.', 'Cast one green or red vote per idea and add optional feasibility, market, capacity, and comment context.', '<a class="btn btn--outline" href="#/app/ideas">All ideas</a>')}${withPreview(content, { title: 'No voting work here', description: 'Your queue is empty in this preview.', icon: 'vote' })}`,
    mount() {
      bindTabs(document);
      if (getAuthToken()) {
        api.get('/api/ideas/pending-my-vote').then(res => {
          if (res?.pendingIdeas) {
            state.live.pendingVotes = res.pendingIdeas;
          }
        }).catch(() => {});
      }
    }
  };
}

export function renderIdeaDetail(id) {
  const idea = getIdea(id) || (state.live.pendingVotes || []).find(i => i.id === id);
  const user = currentUser();
  if (!idea) return { html: `${pageHead('Ideas', 'Idea not found')}${emptyState('This idea does not exist', 'Return to the idea library to choose another record.', '<a class="btn btn--primary" href="#/app/ideas">Back to ideas</a>', 'bulb')}` };
  
  const owner = getUser(idea.owner_id || idea.ownerId);
  const votes = ideaVotes(id);
  const userVote = votes.find(vote => vote.voterId === user.id);
  const deadlineMs = idea.deadline || idea.voting_deadline ? new Date(idea.deadline || idea.voting_deadline).getTime() : Date.now() + 86400000;
  const canVote = idea.status === 'PENDING_REVIEW' && (idea.owner_id || idea.ownerId) !== user.id && !userVote && deadlineMs > Date.now();
  const participation = idea.eligible ? Math.round((votes.length / idea.eligible) * 1000) / 10 : 0;
  const comments = [...(idea.comments || []).map(comment => ({ ...comment, color: null })), ...votes.filter(vote => vote.comment).map(vote => ({ userId: vote.voterId, text: vote.comment, at: vote.at, color: vote.color }))].sort((a, b) => new Date(b.at) - new Date(a.at));
  
  const actions = `${idea.status === 'DRAFT' && (idea.owner_id || idea.ownerId) === user.id ? `<a class="btn btn--outline" href="#/app/ideas/new?draft=${idea.id}">${icon('edit')} Edit draft</a>` : ''}${idea.projectId || idea.project_id ? `<a class="btn btn--outline" href="#/app/projects/${idea.projectId || idea.project_id}">${icon('folder')} Open project</a>` : ''}${canVote ? `<button class="btn btn--primary" id="cast-vote">${icon('vote')} Cast vote</button>` : ''}${user?.role === 'admin' && !['KILLED', 'ARCHIVED'].includes(idea.status) ? `<button class="btn btn--outline" id="override-idea">${icon('shield')} Admin decision</button>` : ''}`;
  
  const main = `<div class="grid-main-side"><div class="stack"><section class="card card--pad"><div class="spread"><div class="person">${avatar(owner)}<div class="person__meta"><strong>${escapeHTML(owner?.name || 'Member')}</strong><span>${titleCase(owner?.role || '')} · Idea owner</span></div></div>${badge(idea.status)}</div><h2 class="mt-3" style="font:600 25px/1.25 var(--font-display);letter-spacing:-.03em">${escapeHTML(idea.title)}</h2><p class="mt-2" style="line-height:1.8;color:var(--ink-2)">${escapeHTML(idea.description)}</p>${idea.attachment_url || idea.attachmentUrl ? `<div class="mt-2"><span class="badge badge--info">Attachment reference</span><p class="small muted mt-1 mono"><a href="${escapeHTML(idea.attachment_url || idea.attachmentUrl)}" target="_blank" rel="noopener">${escapeHTML(idea.attachment_url || idea.attachmentUrl)}</a></p></div>` : ''}<div class="divider"></div><dl class="definition-list"><dt>Submitted</dt><dd>${formatDateTime(idea.submitted_at || idea.submittedAt)}</dd><dt>Voting deadline</dt><dd>${formatDateTime(idea.voting_deadline || idea.deadline)}</dd><dt>Source project</dt><dd>${idea.projectId || idea.project_id ? `<a class="link-btn" href="#/app/projects/${idea.projectId || idea.project_id}">${escapeHTML(getProject(idea.projectId || idea.project_id)?.title || 'View project')}</a>` : 'No project created'}</dd></dl></section><section class="card card--pad"><div class="eyebrow">Voter comments</div><h2 class="mt-1 mb-2" style="font:600 20px var(--font-display)">Reasoning alongside the score</h2>${comments.length ? comments.map(comment => { const commenter = getUser(comment.userId); return `<article class="comment"><div class="comment__head">${avatar(commenter, 'sm')}<strong>${escapeHTML(commenter?.name || 'Voter')}</strong>${comment.color ? badge(comment.color, comment.color === 'green' ? 'success' : 'danger') : ''}<time>${formatDateTime(comment.at)}</time></div><p>${escapeHTML(comment.text)}</p></article>`; }).join('') : emptyState('No voter comments yet', 'Optional comments submitted with votes will appear here.', '', 'message')}</section></div><aside class="stack"><section class="card card--pad"><div class="eyebrow mb-2">Live vote summary</div><div class="vote-summary"><div class="quorum-ring" style="--pct:${Math.min(100, participation)}%"><div class="quorum-ring__copy"><strong>${participation}%</strong><span>participation</span></div></div><div><strong style="font:650 25px var(--font-display)">${idea.green_percentage ?? idea.greenPercentage ?? 0}%</strong><p class="small muted">green votes</p><p class="tiny muted mt-1">${votes.length} cast</p></div></div><div class="mt-2">${voteMeter(idea)}</div><div class="key-value"><span>Approval threshold</span><strong>70% green</strong></div><div class="key-value"><span>Quorum</span><strong>70% participation</strong></div><div class="key-value"><span>Your vote</span><strong>${(idea.owner_id || idea.ownerId) === user.id ? 'Owner · cannot vote' : userVote ? titleCase(userVote.color) : canVote ? 'Not cast' : 'Unavailable'}</strong></div>${canVote ? `<button class="btn btn--primary btn--full mt-2" id="cast-vote-side">Review & vote</button>` : ''}</section></aside></div>`;
  
  return {
    html: `${pageHead(`${idea.status.replaceAll('_', ' ')} · ${owner?.name || 'Idea'}`, escapeHTML(idea.title), 'Proposal context, voting evidence, and review timing.', actions)}${withPreview(main, { title: 'No idea detail in this preview', description: 'The empty-state preview hides the proposal, votes, and decision history.', icon: 'bulb' })}`,
    mount() {
      document.querySelector('#cast-vote')?.addEventListener('click', () => openVoteDialog(idea.id));
      document.querySelector('#cast-vote-side')?.addEventListener('click', () => openVoteDialog(idea.id));
      document.querySelector('#override-idea')?.addEventListener('click', () => openOverrideDialog(idea.id));
      if (getAuthToken()) {
        api.get(`/api/ideas/${id}/votes`).then(res => {
          if (res?.summary) {
            idea.greenPercentage = res.summary.greenPercentage;
          }
        }).catch(() => {});
      }
    }
  };
}

export function openVoteDialog(ideaId) {
  const idea = getIdea(ideaId) || (state.live.pendingVotes || []).find(i => i.id === ideaId);
  const user = currentUser();
  if (!idea || idea.status !== 'PENDING_REVIEW') return toast('Voting is only available while an idea is pending review.', 'error');
  if ((idea.owner_id || idea.ownerId) === user.id) return toast('Idea owners cannot vote on their own ideas.', 'error');
  if (ideaVotes(ideaId).some(vote => vote.voterId === user.id)) return toast('You have already voted on this idea.', 'error');
  
  openDialog({
    title: 'Cast your team vote',
    subtitle: idea.title,
    wide: true,
    content: `<form id="vote-form" class="stack"><div class="field"><span class="field-label">Vote color</span><div class="vote-choice"><label class="green"><input type="radio" name="color" value="green" checked><span><strong>Green</strong><br><small>Support moving the idea forward</small></span></label><label class="red"><input type="radio" name="color" value="red"><span><strong>Red</strong><br><small>Do not support in the current form</small></span></label></div></div><div class="field"><span class="field-label">Optional scores · integers from 0 to 10</span><div class="score-grid"><div class="score-field"><label for="score-feasibility">Feasibility</label><input id="score-feasibility" name="feasibility" type="number" min="0" max="10" step="1" value="7"><small>Can this be delivered?</small></div><div class="score-field"><label for="score-market">Market</label><input id="score-market" name="market" type="number" min="0" max="10" step="1" value="7"><small>Is the need meaningful?</small></div><div class="score-field"><label for="score-capacity">Capacity</label><input id="score-capacity" name="capacity" type="number" min="0" max="10" step="1" value="7"><small>Can the team take it on?</small></div></div></div><div class="field"><label for="vote-comment">Comment (optional)</label><textarea class="textarea" id="vote-comment" name="comment" placeholder="Explain the reasoning behind your vote."></textarea></div>${notice('One vote per eligible active member. Your vote cannot be changed after submission.', 'warning')}</form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="record-vote">Submit vote</button>',
    onMount(dialog) {
      dialog.querySelector('#record-vote').addEventListener('click', async () => {
        const form = dialog.querySelector('#vote-form');
        const submitBtn = dialog.querySelector('#record-vote');
        const values = formValues(form);

        for (const key of ['feasibility', 'market', 'capacity']) {
          const value = values[key];
          if (value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 10)) {
            return setFormError(form, 'Scores must be whole numbers from 0 to 10.', key);
          }
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting ballot...';

        try {
          if (getAuthToken()) {
            await api.post(`/api/ideas/${ideaId}/vote`, {
              vote_color: values.color.toLowerCase(),
              score_feasibility: values.feasibility === '' ? null : Number(values.feasibility),
              score_market: values.market === '' ? null : Number(values.market),
              score_capacity: values.capacity === '' ? null : Number(values.capacity),
              comment: values.comment?.trim() || null
            });
            toast('Vote cast successfully!', 'success');
          } else {
            state.data.votes.push({
              id: uid('v'),
              ideaId,
              voterId: user.id,
              color: values.color,
              feasibility: values.feasibility === '' ? null : Number(values.feasibility),
              market: values.market === '' ? null : Number(values.market),
              capacity: values.capacity === '' ? null : Number(values.capacity),
              comment: values.comment?.trim() || null,
              at: new Date().toISOString()
            });
            toast('Vote recorded.');
          }
          closeDialog();
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit vote';
          setFormError(form, err.message || 'Failed to submit vote.');
        }
      });
    }
  });
}

export function fanoutIdea(idea) {
  if (idea.projectId && getProject(idea.projectId)) return getProject(idea.projectId);
  const id = uid('p');
  const now = new Date().toISOString();
  const project = {
    id,
    ideaId: idea.id,
    code: `PRJ`,
    title: idea.title,
    summary: idea.description,
    stage: 'RESEARCH_DEV_PARALLEL',
    status: 'ACTIVE',
    ownerId: idea.owner_id || idea.ownerId,
    createdAt: now,
    revenueStart: null,
    assetCount: 0,
    tasks: []
  };
  state.data.projects.unshift(project);
  idea.projectId = id;
  return project;
}

export function openOverrideDialog(ideaId) {
  const idea = getIdea(ideaId);
  openDialog({
    title: 'Admin idea decision',
    subtitle: `${idea.title} · Executive review`,
    content: `<form id="override-form" class="stack"><div class="field"><label for="override-decision">Decision</label><select class="select" id="override-decision" name="decision"><option value="APPROVED">APPROVED — promote to project</option><option value="REVISE">REVISE — request revision</option><option value="REJECTED">REJECTED — close proposal</option></select></div><div class="field"><label for="override-reason">Mandatory reason</label><textarea class="textarea" id="override-reason" name="reason" required placeholder="Explain the decision and its operational context."></textarea></div>${notice('A clear reason is mandatory for an Admin decision.', 'warning')}</form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--danger" id="save-override">Record decision</button>',
    onMount(dialog) {
      dialog.querySelector('#save-override').addEventListener('click', async () => {
        const form = dialog.querySelector('#override-form');
        const saveBtn = dialog.querySelector('#save-override');
        const values = formValues(form);
        if (!values.reason?.trim()) return setFormError(form, 'A clear reason is mandatory.', 'reason');

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving decision...';

        try {
          if (getAuthToken()) {
            const res = await api.patch(`/api/admin/ideas/${ideaId}/override`, {
              decision: values.decision,
              reason: values.reason.trim()
            });
            if (res?.idea) {
              idea.status = res.idea.status || values.decision;
            } else {
              idea.status = values.decision;
            }
          } else {
            idea.status = values.decision;
          }
          persistData();
          closeDialog();
          toast(`Admin decision saved for “${idea.title}”.`, 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Record decision';
          toast(api.extractError(err, 'Failed to save admin decision.'), 'error');
        }
      });
    }
  });
}
