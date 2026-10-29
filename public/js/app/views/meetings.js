import { state, currentUser, getUser, getProject, getIdea, getMeeting, pendingVotesFor, persistData, addAudit, addNotification, formatDate, formatDateTime, formatTime, relativeTime, escapeHTML, titleCase, uid } from '../store.js';
import { icon, badge, plainBadge, avatar, person, pageHead, notice, emptyState, withPreview, openDialog, closeDialog, confirmDialog, toast, bindTabs, formValues, setFormError } from '../ui.js';
import { openVoteDialog } from './ideas.js';
import { api } from '../api.js';

function meetingCard(meeting) {
  const project = getProject(meeting.projectId); const host = getUser(meeting.hostId); const attendees = [...new Set((meeting.attendance || []).map(item => item.userId))].map(getUser).filter(Boolean);
  return `<article class="meeting-card ${meeting.status === 'LIVE' ? 'meeting-card--live' : ''}" data-status="${meeting.status}" data-project="${meeting.projectId || ''}" data-search="${escapeHTML(`${meeting.title} ${project?.title || ''}`.toLowerCase())}"><div class="meeting-card__head">${meeting.status === 'LIVE' ? '<span class="live-pill">Live now</span>' : badge(meeting.status)}<span class="tiny muted">${meeting.ideaId ? 'Idea review' : 'Ad hoc meeting'}</span></div><h2>${escapeHTML(meeting.title)}</h2><p class="small muted">${escapeHTML(meeting.description || '')}</p><div class="meeting-card__meta mt-2"><span>${icon('calendar')} ${formatDate(meeting.scheduledAt, { year: false })}</span><span>${icon('clock')} ${formatTime(meeting.scheduledAt)} · ${meeting.duration} min</span><span>${icon('user')} ${escapeHTML(host?.name || meeting.hostName || 'Host')}</span></div><div class="meeting-card__foot"><span class="avatar-stack">${attendees.slice(0, 4).map(user => avatar(user, 'sm')).join('')}${!attendees.length ? '<span class="tiny muted">No attendance yet</span>' : ''}</span><a class="btn ${meeting.status === 'LIVE' ? 'btn--primary' : 'btn--outline'} btn--sm" href="#/app/meetings/${meeting.id}">${meeting.status === 'LIVE' ? 'Enter room' : meeting.status === 'ENDED' ? 'View recap' : 'View details'} ${icon('arrow-up-right', 'icon--sm')}</a></div></article>`;
}

export function renderMeetings() {
  const user = currentUser(); const meetings = [...state.data.meetings].sort((a, b) => { const order = { LIVE: 0, SCHEDULED: 1, ENDED: 2, CANCELLED: 3 }; return order[a.status] - order[b.status] || new Date(b.scheduledAt) - new Date(a.scheduledAt); });
  const content = meetings.length === 0
    ? emptyState('No meetings scheduled yet', 'All scheduled and active video rooms will appear here.', user?.role === 'admin' ? '<button class="btn btn--primary btn--sm mt-2" id="empty-schedule-meeting">Schedule a meeting →</button>' : '<a class="btn btn--outline btn--sm mt-2" href="#/app/dashboard">Back to dashboard →</a>', 'video')
    : `<div class="filter-bar"><div class="field field--search"><label for="meeting-search">Search meetings</label><div class="input-wrap">${icon('search')}<input class="input" id="meeting-search" placeholder="Meeting or project title"></div></div><div class="field"><label for="meeting-status-filter">Status</label><select class="select" id="meeting-status-filter"><option value="all">All meetings</option><option value="LIVE">Live now</option><option value="SCHEDULED">Scheduled</option><option value="ENDED">Ended</option><option value="CANCELLED">Cancelled</option></select></div><div class="field"><label for="meeting-project-filter">Project</label><select class="select" id="meeting-project-filter"><option value="all">All projects</option>${state.data.projects.map(project => `<option value="${project.id}">${escapeHTML(project.title)}</option>`).join('')}</select></div><span class="filter-count" id="meeting-count">${meetings.length} meetings</span></div><div class="meeting-grid" id="meeting-grid">${meetings.map(meetingCard).join('')}</div><div id="meeting-empty" hidden>${emptyState('No meetings match these filters', 'Clear a filter or schedule a new meeting.', user?.role === 'admin' ? '<button class="btn btn--primary btn--sm mt-2" id="empty-schedule-meeting-filter">Schedule a meeting →</button>' : '<a class="btn btn--outline btn--sm mt-2" href="#/app/dashboard">Back to dashboard →</a>', 'video')}</div>`;
  return { html: `${pageHead('Meetings & reviews', 'Meet in the context of the work.', 'Scheduled and live rooms, attendance, linked idea voting, recordings, and bilingual meeting notes.', user?.role === 'admin' ? `<button class="btn btn--primary" id="schedule-meeting">${icon('plus')} Schedule meeting</button>` : '<span class="prototype-badge">Admin schedules · active members join</span>')}${withPreview(content, { title: 'No meetings scheduled', description: 'Admin-scheduled meetings and their attendance history will appear here.', icon: 'video' })}`, mount() {
    document.querySelector('#schedule-meeting')?.addEventListener('click', openScheduleMeeting);
    document.querySelector('#empty-schedule-meeting')?.addEventListener('click', openScheduleMeeting);
    document.querySelector('#empty-schedule-meeting-filter')?.addEventListener('click', openScheduleMeeting);
    const search = document.querySelector('#meeting-search'); const status = document.querySelector('#meeting-status-filter'); const project = document.querySelector('#meeting-project-filter');
    const filter = () => { let count = 0; const query = search?.value.trim().toLowerCase() || ''; document.querySelectorAll('#meeting-grid [data-status]').forEach(meeting => { const show = (!query || meeting.dataset.search.includes(query)) && (status.value === 'all' || meeting.dataset.status === status.value) && (project.value === 'all' || meeting.dataset.project === project.value); meeting.hidden = !show; if (show) count++; }); const countEl = document.querySelector('#meeting-count'); if (countEl) countEl.textContent = `${count} meetings`; const emptyEl = document.querySelector('#meeting-empty'); if (emptyEl) emptyEl.hidden = count > 0; };
    search?.addEventListener('input', filter); status?.addEventListener('change', filter); project?.addEventListener('change', filter);

    // Fetch live meetings from backend
    api.get('/api/meetings').then(res => {
      if (res?.meetings && Array.isArray(res.meetings)) {
        const liveMeetings = res.meetings.map(m => ({
          id: m.id,
          title: m.title,
          description: m.description || '',
          meetingType: m.meeting_type,
          projectId: m.linked_project_id || null,
          ideaId: m.linked_idea_id || null,
          scheduledAt: m.scheduled_at,
          duration: m.duration_minutes || 45,
          status: m.status,
          hostId: m.hosted_by,
          hostName: m.host_name,
          recordingEnabled: Boolean(m.recording_enabled),
          recording: m.recording_file_path ? { title: m.recording_file_path.split(/[/\\]/).pop(), size: 'Stored' } : null,
          notesStatus: m.has_confirmed_notes ? 'CONFIRMED' : null,
          attendance: []
        }));
        const existingIds = new Set(liveMeetings.map(m => m.id));
        state.data.meetings = [
          ...liveMeetings,
          ...state.data.meetings.filter(m => !existingIds.has(m.id))
        ];
        const grid = document.querySelector('#meeting-grid');
        if (grid) {
          const sorted = [...state.data.meetings].sort((a, b) => { const order = { LIVE: 0, SCHEDULED: 1, ENDED: 2, CANCELLED: 3 }; return order[a.status] - order[b.status] || new Date(b.scheduledAt) - new Date(a.scheduledAt); });
          grid.innerHTML = sorted.map(meetingCard).join('');
          filter();
        }
      }
    }).catch(err => console.warn('Could not fetch meetings:', err));
  } };
}

function openScheduleMeeting() {
  openDialog({ title: 'Schedule a meeting', subtitle: 'Admin action · live team schedule', wide: true, content: `<form id="schedule-form" class="form-grid"><div class="field span-2"><label for="schedule-title">Meeting title</label><input class="input" id="schedule-title" name="title" required placeholder="What is the team meeting about?"></div><div class="field"><label for="schedule-type">Meeting type</label><select class="select" id="schedule-type" name="type"><option value="ad_hoc">Ad hoc / project meeting</option><option value="idea_review">Idea review</option></select></div><div class="field"><label for="schedule-time">Scheduled date & time</label><input class="input" id="schedule-time" name="scheduledAt" type="datetime-local" value="${new Date(Date.now() + 3600000).toISOString().slice(0, 16)}" required></div><div class="field"><label for="schedule-project">Linked project (optional)</label><select class="select" id="schedule-project" name="projectId"><option value="">No linked project</option>${state.data.projects.map(project => `<option value="${project.id}">${escapeHTML(project.title)}</option>`).join('')}</select></div><div class="field"><label for="schedule-idea">Linked idea (optional)</label><select class="select" id="schedule-idea" name="ideaId"><option value="">No linked idea</option>${state.data.ideas.filter(idea => idea.status === 'PENDING_REVIEW').map(idea => `<option value="${idea.id}">${escapeHTML(idea.title)}</option>`).join('')}</select></div><div class="field"><label for="schedule-duration">Duration</label><select class="select" id="schedule-duration" name="duration"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></div><div class="field"><label for="schedule-recording">Recording</label><select class="select" id="schedule-recording" name="recording"><option value="false">Recording disabled</option><option value="true">Enable recording reference</option></select></div><div class="span-2">${notice('Scheduling notifies active members and creates a meeting room session.', 'info')}</div></form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-meeting">Schedule meeting</button>', onMount(dialog) {
    dialog.querySelector('#save-meeting').addEventListener('click', async () => {
      const form = dialog.querySelector('#schedule-form');
      const values = formValues(form);
      if (!values.title?.trim()) return setFormError(form, 'Meeting title is required.', 'title');
      if (!values.scheduledAt) return setFormError(form, 'Choose a meeting date and time.', 'scheduledAt');
      const saveBtn = dialog.querySelector('#save-meeting');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Scheduling...';
      try {
        const res = await api.post('/api/meetings', {
          title: values.title.trim(),
          meeting_type: values.type,
          scheduled_at: new Date(values.scheduledAt).toISOString(),
          linked_project_id: values.projectId || null,
          linked_idea_id: values.ideaId || null,
          recording_enabled: values.recording === 'true'
        });
        const m = res?.meeting;
        const newMeeting = {
          id: m ? m.id : uid('m'),
          title: m ? m.title : values.title.trim(),
          description: '',
          meetingType: values.type,
          projectId: values.projectId || null,
          ideaId: values.ideaId || null,
          scheduledAt: new Date(values.scheduledAt).toISOString(),
          duration: Number(values.duration),
          status: 'SCHEDULED',
          hostId: currentUser().id,
          recordingEnabled: values.recording === 'true',
          participantIds: state.data.users.filter(user => user.status === 'active').map(user => user.id),
          attendance: [],
          recording: null,
          notesStatus: null,
          notesEn: '',
          notesHi: '',
          createdAt: new Date().toISOString()
        };
        state.data.meetings.unshift(newMeeting);
        persistData();
        closeDialog();
        toast('Meeting scheduled successfully.', 'success');
        location.hash = `#/app/meetings/${newMeeting.id}`;
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Schedule meeting';
        setFormError(form, api.extractError(err), 'title');
      }
    });
  } });
}

function videoRoom(meeting, user) {
  const attendance = meeting.attendance || [];
  const joined = attendance.some(item => (item.userId === user.id || item.user_id === user.id) && !item.leftAt && !item.left_at);
  if (meeting.status === 'SCHEDULED') return `<div class="video-stage"><div class="video-stage__label">${badge('scheduled')}</div><div class="video-placeholder"><span class="video-placeholder__icon">${icon('calendar')}</span><h2>The room opens when Admin starts.</h2><p>Scheduled for ${formatDateTime(meeting.scheduledAt)}. Active members can join after the meeting moves to LIVE.</p>${user.role === 'admin' ? `<button class="btn btn--lime mt-2" data-meeting-control="start">${icon('play')} Start meeting</button>` : '<button class="btn btn--outline mt-2" disabled>Waiting for host</button>'}</div></div>`;
  if (meeting.status === 'CANCELLED') return `<div class="video-stage"><div class="video-placeholder"><span class="video-placeholder__icon">${icon('x')}</span><h2>This meeting was cancelled.</h2><p>The schedule record remains available, but there is no room to join.</p></div></div>`;
  if (meeting.status === 'ENDED') return `<div class="video-stage"><div class="video-placeholder"><span class="video-placeholder__icon">${icon('check')}</span><h2>Meeting ended.</h2><p>Attendance, any recording reference, and confirmed notes are available in the recap.</p></div></div>`;
  if (!joined) return `<div class="video-stage"><div class="video-stage__label"><span class="live-pill">Live now</span></div><div class="video-placeholder"><span class="video-placeholder__icon">${icon('video')}</span><h2>This meeting is live.</h2><p>Joining records your presence on the meeting roster. Audio and video stages are active for connected participants.</p><button class="btn btn--lime mt-2" data-meeting-control="join">${icon('video')} Join live meeting</button></div></div>`;
  const present = attendance.filter(item => !item.leftAt && !item.left_at).map(item => getUser(item.userId || item.user_id) || { initials: (item.name || item.user_name || 'U').slice(0, 2).toUpperCase(), name: item.name || item.user_name || 'Member', id: item.userId || item.user_id }).filter(Boolean);
  return `<div class="video-stage"><div class="video-stage__label"><span class="live-pill">Live now</span>${plainBadge('Live stage', 'dark')}</div><div class="video-stage__grid">${present.slice(0, 4).map((person, index) => `<div class="video-tile ${index === 0 ? 'is-speaking' : ''}"><span class="video-tile__avatar">${person.initials || 'U'}</span><span class="video-tile__mute">${icon('mic')}</span><span class="video-tile__name">${escapeHTML(person.name)}${person.id === user.id ? ' (you)' : ''}</span></div>`).join('')}</div></div><div class="meeting-controls"><button class="meeting-control" data-room-toggle="mic" aria-pressed="true" aria-label="Mute microphone">${icon('mic')}</button><button class="meeting-control" data-room-toggle="camera" aria-pressed="true" aria-label="Turn off camera">${icon('camera')}</button><button class="meeting-control" id="share-screen" aria-label="Screen sharing">${icon('monitor')}</button><button class="meeting-control--leave" data-meeting-control="leave">${icon('log-out', 'icon--sm')} Leave</button>${user.role === 'admin' ? `<button class="meeting-control--leave" data-meeting-control="end">${icon('stop', 'icon--sm')} End for all</button>` : ''}</div><div class="meeting-room__info"><span>Connected to room presence.</span><span>Attendance is being recorded.</span></div>`;
}

function notesPanel(meeting, user) {
  const attendance = meeting.attendance || [];
  const attended = attendance.some(item => (item.userId === user.id || item.user_id === user.id));
  if (meeting.notesStatus === 'CONFIRMED' && (attended || user.role === 'admin')) {
    const prefs = state.data.uiPreferences?.[user.id] || { notesLanguage: localStorage.getItem('mtg_notes_lang') || 'en' };
    return `<div data-tab-scope><div class="tabs" data-tabs role="tablist" aria-label="Meeting notes languages"><button class="tab" data-tab="english" aria-selected="${prefs.notesLanguage !== 'hi'}">English</button><button class="tab" data-tab="hindi" aria-selected="${prefs.notesLanguage === 'hi'}">हिन्दी</button></div><section data-tab-panel="english" ${prefs.notesLanguage === 'hi' ? 'hidden' : ''}><div class="notes-page">${escapeHTML(meeting.notesEn || '')}</div></section><section data-tab-panel="hindi" ${prefs.notesLanguage !== 'hi' ? 'hidden' : ''}><div class="notes-page">${escapeHTML(meeting.notesHi || '')}</div></section><p class="tiny muted mt-1">Confirmed ${formatDateTime(meeting.notesConfirmedAt)} · visible to attendees and Admin.</p></div>`;
  }
  if (user.role === 'admin' && (meeting.notesStatus === 'PENDING' || meeting.status === 'ENDED')) return `<div>${notice('Draft notes can be confirmed and published. Attendees cannot view them until confirmed.', 'warning', 'Notes Review')}<button class="btn btn--primary btn--full mt-2" id="review-notes">Review bilingual notes</button></div>`;
  if (meeting.notesStatus === 'PENDING') return `<div class="privacy-lock">${icon('lock')}<h3>Notes pending Admin review</h3><p>Confirmed notes are visible to meeting attendees and Admin only.</p></div>`;
  if (!attended && user.role !== 'admin' && meeting.notesStatus === 'CONFIRMED') return `<div class="privacy-lock">${icon('lock')}<h3>Participants only</h3><p>Only attendees and Admin can view confirmed meeting notes.</p></div>`;
  return emptyState('No meeting notes', meeting.status === 'ENDED' ? 'No confirmed bilingual notes are available for this meeting.' : 'Notes become available after recording, review, and Admin confirmation.', '', 'file');
}

export function renderMeetingDetail(id) {
  const meeting = getMeeting(id); const user = currentUser();
  if (!meeting) return { html: `${pageHead('Meetings', 'Meeting not found')}${emptyState('This meeting does not exist', 'Return to the meeting list.', '<a class="btn btn--primary" href="#/app/meetings">Back to meetings</a>', 'video')}` };
  const project = getProject(meeting.projectId); const idea = getIdea(meeting.ideaId); const attendees = [...new Set((meeting.attendance || []).map(item => item.userId || item.user_id))];
  const actions = `${user.role === 'admin' && meeting.status === 'SCHEDULED' ? `<button class="btn btn--outline" id="cancel-meeting">Cancel meeting</button><button class="btn btn--primary" data-meeting-control="start">${icon('play')} Start meeting</button>` : ''}<a class="btn btn--outline" href="#/app/meetings">All meetings</a>`;
  const content = `<div class="meeting-room-layout"><div class="stack"><section class="meeting-room">${videoRoom(meeting, user)}</section><section class="card card--flush"><div class="card-head"><div><h2>Attendance</h2><p>${attendees.length} recorded attendee${attendees.length === 1 ? '' : 's'} · join and leave events remain visible.</p></div>${badge(meeting.status)}</div><div class="card-body"><div class="attendance-list">${(meeting.attendance || []).length ? meeting.attendance.map(record => { const attendee = getUser(record.userId || record.user_id) || { initials: (record.name || record.user_name || 'U').slice(0, 2).toUpperCase(), name: record.name || record.user_name || 'Member', role: record.role || record.user_role || 'member' }; return `<div class="attendance-row">${avatar(attendee, 'sm')}<div class="person__meta"><strong>${escapeHTML(attendee?.name)}</strong><span>${titleCase(attendee?.role || '')}</span></div><span class="attendance-row__time">Joined ${formatTime(record.joinedAt || record.joined_at)}<br>${(record.leftAt || record.left_at) ? `Left ${formatTime(record.leftAt || record.left_at)}` : 'Still in room'}</span></div>`; }).join('') : emptyState('No attendance recorded', 'Active members appear here after joining the live meeting.', '', 'users')}</div></div></section><section class="card card--flush"><div class="card-head"><div><h2>Recording</h2><p>Admin-uploaded recording references and playback boundaries.</p></div>${user.role === 'admin' && meeting.status === 'ENDED' ? '<button class="btn btn--outline btn--sm" id="add-recording">Upload recording</button>' : ''}</div><div class="card-body">${meeting.recording ? `<div class="recording-row"><span class="recording-row__icon">${icon('play')}</span><div><strong>${escapeHTML(meeting.recording.title)}</strong><small>${meeting.recording.duration || 'Stored'} · ${meeting.recording.size || ''} · ${formatDate(meeting.recording.createdAt || meeting.scheduledAt)}</small></div><button class="btn btn--outline btn--sm" id="play-recording">Audio player</button></div>` : emptyState('No recording available', meeting.recordingEnabled ? 'Recording is enabled, but no file has been uploaded yet.' : 'Recording was not enabled for this meeting.', '', 'video')}</div></section></div><aside class="stack"><section class="card card--pad"><div class="eyebrow">Meeting context</div><h3 class="mt-1" style="font:600 18px var(--font-display)">${escapeHTML(meeting.title)}</h3><p class="small muted mt-1">${escapeHTML(meeting.description || '')}</p><dl class="definition-list mt-2"><dt>Host</dt><dd>${escapeHTML(getUser(meeting.hostId)?.name || meeting.hostName || 'Host')}</dd><dt>Scheduled</dt><dd>${formatDateTime(meeting.scheduledAt)}</dd><dt>Duration</dt><dd>${meeting.duration} minutes</dd><dt>Project</dt><dd>${project ? `<a class="link-btn" href="#/app/projects/${project.id}">${escapeHTML(project.title)}</a>` : 'None'}</dd><dt>Recording</dt><dd>${meeting.recordingEnabled || meeting.recording ? 'Enabled / recorded' : 'Not enabled'}</dd></dl></section>${idea ? `<section class="card card--pad"><div class="eyebrow">Linked idea review</div><h3 class="mt-1" style="font:600 17px var(--font-display)">${escapeHTML(idea.title)}</h3><div class="key-value"><span>Status</span><strong>${titleCase(idea.status)}</strong></div><div class="key-value"><span>Green vote</span><strong>${idea.greenPercentage}%</strong></div><div class="key-value"><span>Voting deadline</span><strong>${formatDate(idea.deadline, { year: false })}</strong></div><a class="btn btn--outline btn--full mt-2" href="#/app/ideas/${idea.id}">Open idea & votes</a></section>` : ''}<section class="card card--pad"><div class="spread mb-2"><div><div class="eyebrow">Bilingual notes</div><h3 class="mt-1" style="font:600 18px var(--font-display)">English & Hindi</h3></div>${meeting.notesStatus ? badge(meeting.notesStatus) : ''}</div>${notesPanel(meeting, user)}</section></aside></div>`;
  return { html: `${pageHead(`${meeting.status} · ${formatDate(meeting.scheduledAt)}`, escapeHTML(meeting.title), 'Meeting state, live presence, attendance, recordings, notes, and linked work.', actions)}${withPreview(content, { title: 'No meeting detail in this preview', description: 'The empty-state preview hides video, attendance, recording, and notes.', icon: 'video' })}`, mount() {
    bindTabs(document);

    // Sync live meeting state and notes from backend
    Promise.allSettled([
      api.get(`/api/meetings/${meeting.id}`),
      api.get(`/api/meetings/${meeting.id}/notes`)
    ]).then(([detailRes, notesRes]) => {
      let needsRefresh = false;
      if (detailRes.status === 'fulfilled' && detailRes.value?.meeting) {
        const live = detailRes.value.meeting;
        if (meeting.status !== live.status) {
          meeting.status = live.status;
          needsRefresh = true;
        }
        if (detailRes.value.attendance && Array.isArray(detailRes.value.attendance)) {
          meeting.attendance = detailRes.value.attendance.map(a => ({
            userId: a.user_id,
            name: a.user_name,
            role: a.user_role,
            joinedAt: a.joined_at,
            leftAt: a.left_at
          }));
          needsRefresh = true;
        }
      }
      if (notesRes.status === 'fulfilled' && notesRes.value?.notes) {
        const n = notesRes.value.notes;
        meeting.notesStatus = 'CONFIRMED';
        meeting.notesEn = n.notes_english || '';
        meeting.notesHi = n.notes_hindi || '';
        meeting.notesConfirmedAt = n.confirmed_at;
        meeting.transcriptRaw = n.transcript_raw || '';
        needsRefresh = true;
      }
      if (needsRefresh) {
        window.dispatchEvent(new CustomEvent('app:refresh'));
      }
    }).catch(err => console.warn('Meeting sync error:', err));

    document.querySelectorAll('[data-meeting-control]').forEach(button => button.addEventListener('click', () => handleMeetingControl(meeting.id, button.dataset.meetingControl)));
    document.querySelector('#cancel-meeting')?.addEventListener('click', async () => {
      if (await confirmDialog({ title: 'Cancel this meeting?', message: 'The meeting will be moved to CANCELLED and notifications will be sent to all active members.', confirmLabel: 'Cancel meeting', tone: 'danger' })) {
        try {
          await api.patch(`/api/meetings/${meeting.id}/cancel`);
          meeting.status = 'CANCELLED';
          persistData();
          toast('Meeting cancelled successfully.', 'info');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          toast(api.extractError(err), 'error');
        }
      }
    });
    document.querySelectorAll('[data-room-toggle]').forEach(button => button.addEventListener('click', () => { const on = button.getAttribute('aria-pressed') !== 'true'; button.setAttribute('aria-pressed', String(on)); button.classList.toggle('is-off', !on); button.setAttribute('aria-label', `${on ? 'Turn off' : 'Turn on'} ${button.dataset.roomToggle}`); toast(`${button.dataset.roomToggle} ${on ? 'enabled' : 'disabled'}.`, 'info'); }));
    document.querySelector('#share-screen')?.addEventListener('click', () => toast('Screen sharing session initialized.', 'info'));
    document.querySelector('#play-recording')?.addEventListener('click', () => toast('Audio playback stream ready.', 'info'));
    document.querySelector('#review-notes')?.addEventListener('click', () => openNotesReview(meeting.id));
    document.querySelector('#add-recording')?.addEventListener('click', () => openRecordingReference(meeting.id));
  } };
}

async function handleMeetingControl(id, control) {
  const meeting = getMeeting(id); const user = currentUser(); const now = new Date().toISOString();
  try {
    if (control === 'start') {
      if (user.role !== 'admin' || meeting.status !== 'SCHEDULED') return toast('Only Admin can start a SCHEDULED meeting.', 'error');
      await api.patch(`/api/meetings/${id}/start`);
      meeting.status = 'LIVE';
      meeting.startedAt = now;
      toast('Meeting is now LIVE.', 'success');
    }
    if (control === 'join') {
      if (meeting.status !== 'LIVE') return toast('This meeting is not currently live.', 'error');
      await api.post(`/api/meetings/${id}/join`);
      meeting.attendance ||= [];
      meeting.attendance.push({ userId: user.id, name: user.name, joinedAt: now, leftAt: null });
      toast('Joined the live room.', 'success');
    }
    if (control === 'leave') {
      await api.post(`/api/meetings/${id}/leave`);
      (meeting.attendance || []).filter(item => (item.userId === user.id || item.user_id === user.id) && !item.leftAt && !item.left_at).forEach(item => { item.leftAt = now; item.left_at = now; });
      toast('Left the room.', 'info');
    }
    if (control === 'end') {
      if (user.role !== 'admin' || meeting.status !== 'LIVE') return toast('Only Admin can end a LIVE meeting.', 'error');
      await api.patch(`/api/meetings/${id}/end`);
      meeting.status = 'ENDED';
      meeting.endedAt = now;
      (meeting.attendance || []).filter(item => !item.leftAt && !item.left_at).forEach(item => { item.leftAt = now; item.left_at = now; });
      toast('Meeting ended.', 'info');
    }
  } catch (err) {
    toast(api.extractError(err), 'error');
  }
  persistData();
  window.dispatchEvent(new CustomEvent('app:refresh'));
}

export function openNotesReview(id) {
  const meeting = getMeeting(id); if (currentUser().role !== 'admin') return;
  openDialog({ title: 'Confirm bilingual meeting notes', subtitle: `${meeting.title} · Admin review`, wide: true, content: `<form id="notes-form" class="stack">${notice('Only confirmed notes become visible to meeting attendees. Review both language versions before publishing.', 'warning')}<div class="field"><label for="notes-en">English notes</label><textarea class="textarea" id="notes-en" name="english" style="min-height:180px">${escapeHTML(meeting.notesEn || '')}</textarea></div><div class="field"><label for="notes-hi">Hindi notes</label><textarea class="textarea" id="notes-hi" name="hindi" style="min-height:180px">${escapeHTML(meeting.notesHi || '')}</textarea></div><div class="field"><label for="notes-transcript">Raw transcript reference (optional)</label><textarea class="textarea" id="notes-transcript" name="transcript" placeholder="Transcript text or reference">${escapeHTML(meeting.transcriptRaw || '')}</textarea></div></form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="confirm-notes">Confirm & publish</button>', onMount(dialog) {
    dialog.querySelector('#confirm-notes').addEventListener('click', async () => {
      const form = dialog.querySelector('#notes-form');
      const values = formValues(form);
      if (!values.english?.trim()) return setFormError(form, 'English notes are required before confirmation.', 'english');
      if (!values.hindi?.trim()) return setFormError(form, 'Hindi notes are required before confirmation.', 'hindi');
      const confirmBtn = dialog.querySelector('#confirm-notes');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Publishing...';
      try {
        await api.patch(`/api/admin/meetings/${meeting.id}/notes/confirm`, {
          notes_hindi: values.hindi.trim(),
          notes_english: values.english.trim(),
          transcript_raw: values.transcript?.trim() || null
        });
        meeting.notesEn = values.english.trim();
        meeting.notesHi = values.hindi.trim();
        meeting.transcriptRaw = values.transcript?.trim() || null;
        meeting.notesStatus = 'CONFIRMED';
        meeting.notesConfirmedAt = new Date().toISOString();
        persistData();
        closeDialog();
        toast('Notes confirmed and published to attendees.', 'success');
        window.dispatchEvent(new CustomEvent('app:refresh'));
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & publish';
        setFormError(form, api.extractError(err), 'english');
      }
    });
  } });
}

function openRecordingReference(id) {
  const meeting = getMeeting(id);
  openDialog({ title: 'Upload meeting recording', subtitle: 'Admin only · audio/video file', content: `<form id="recording-form" class="stack"><div class="field"><label for="recording-file">Recording file</label><input class="input" id="recording-file" name="recording" type="file" accept="audio/*,video/*"><span class="field-hint">Uploads to server; triggers AI transcription and note generation.</span></div>${notice('Accepted formats: mp3, wav, m4a, webm, mp4. Max size: 100 MB.', 'info')}</form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-recording">Upload recording</button>', onMount(dialog) {
    dialog.querySelector('#save-recording').addEventListener('click', async () => {
      const form = dialog.querySelector('#recording-form');
      const file = dialog.querySelector('#recording-file').files[0];
      if (!file) return setFormError(form, 'Choose a file to upload.', 'recording');
      const saveBtn = dialog.querySelector('#save-recording');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Uploading...';
      try {
        const formData = new FormData();
        formData.append('recording', file);
        await api.upload(`/api/meetings/${id}/recording`, formData);
        meeting.recording = { id: uid('rec'), title: file.name, duration: 'Processing', size: `${Math.round(file.size / 1024 / 1024 * 10) / 10} MB`, createdAt: new Date().toISOString() };
        persistData();
        closeDialog();
        toast('Recording uploaded. AI processing started.', 'success');
        window.dispatchEvent(new CustomEvent('app:refresh'));
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Upload recording';
        setFormError(form, api.extractError(err), 'recording');
      }
    });
  } });
}

function canvasObject(object, archived) {
  const style = `left:${object.x}%;top:${object.y}%`;
  if (object.type === 'sticky') return `<button class="canvas-object canvas-object--sticky ${object.color === 'blue' ? 'blue' : ''}" style="${style}" data-canvas-object="${object.id}" ${archived ? 'disabled' : ''}>${escapeHTML(object.text)}</button>`;
  if (object.type === 'text') return `<button class="canvas-object canvas-object--text" style="${style}" data-canvas-object="${object.id}" ${archived ? 'disabled' : ''}>${escapeHTML(object.text)}</button>`;
  if (object.type === 'shape') return `<button class="canvas-object canvas-object--shape ${object.shape === 'rect' ? 'rect' : ''}" style="${style}" data-canvas-object="${object.id}" aria-label="Canvas shape" ${archived ? 'disabled' : ''}></button>`;
  if (object.type === 'pen') return `<svg class="canvas-object canvas-object--pen" data-pen-id="${object.id}" style="left:0;top:0;width:100%;height:100%" viewBox="0 0 1000 600" preserveAspectRatio="none"><polyline points="${object.points}" fill="none" stroke="${object.color || '#2d47dc'}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  return '';
}

export function renderCoworking(projectId) {
  const project = getProject(projectId); const user = currentUser();
  if (!project) return { html: `${pageHead('Co-working', 'Project not found')}${emptyState('No co-working room', 'Choose a project from the pipeline.', '<a class="btn btn--primary" href="#/app/projects">Projects</a>', 'pen')}` };
  const allowed = user.role === 'admin' || project.ownerId === user.id || project.tasks.some(task => task.assignedTo === user.id);
  if (!allowed) return { html: `${pageHead('Co-working', 'Contributor access required')}${notice('Only project contributors and Admin can enter this room.', 'danger', 'Access restricted', 'lock')}` };
  state.data.coworking[projectId] ||= { roomId: `room-${projectId}`, status: project.stage === 'LIVE' ? 'archived' : 'active', presence: [], objects: [], snapshots: [] };
  const room = state.data.coworking[projectId]; if (project.stage === 'LIVE') room.status = 'archived'; const archived = room.status === 'archived';
  const present = [...new Set([...room.presence, ...(archived ? [] : [user.id])])].map(getUser).filter(Boolean);
  const cursors = present.filter(member => member.id !== user.id).slice(0, 3);
  const content = `${archived ? `<div class="mb-2">${notice('This project is LIVE. Its co-working canvas is archived and read-only; editing and snapshots are disabled.', 'warning', 'Archived canvas', 'lock')}</div>` : `<div class="mb-2">${notice('Presence and other cursors are simulated. Canvas changes and snapshots are stored only in this browser.', 'info', 'Frontend collaboration preview')}</div>`}<section class="canvas-shell"><div class="canvas-topbar"><div class="canvas-topbar__title"><strong>${escapeHTML(project.title)} / shared canvas</strong><span id="canvas-save-status">${archived ? 'Read-only snapshot' : 'Local canvas ready'}</span></div><div class="presence"><span class="presence__label">${archived ? 'ARCHIVED' : `${present.length} PRESENT`}</span><span class="avatar-stack">${present.slice(0, 4).map(member => avatar(member, 'sm', !archived)).join('')}</span></div><button class="btn btn--outline btn--sm" id="undo-canvas" ${archived ? 'disabled' : ''}>${icon('refresh', 'icon--sm')} Undo</button><button class="btn btn--primary btn--sm" id="save-snapshot" ${archived ? 'disabled' : ''}>${icon('camera', 'icon--sm')} Save snapshot</button></div><div class="canvas-layout"><div class="canvas-tools" role="toolbar" aria-label="Canvas tools">${[['select', 'cursor', 'Select / edit'], ['sticky', 'sticky', 'Sticky note'], ['text', 'type', 'Text'], ['shape', 'circle', 'Shape'], ['pen', 'pen', 'Draw']].map(([tool, iconName, label]) => `<button class="canvas-tool ${tool === 'select' ? 'is-active' : ''}" data-canvas-tool="${tool}" data-label="${label}" aria-label="${label}" aria-pressed="${tool === 'select'}" ${archived ? 'disabled' : ''}>${icon(iconName)}</button>`).join('')}</div><div class="canvas-board tool-select" id="canvas-board" aria-label="Interactive project canvas">${room.objects.map(object => canvasObject(object, archived)).join('')}<span id="drawing-layer"></span>${cursors.map((member, index) => `<span class="canvas-cursor" data-cursor="${member.id}" style="left:${24 + index * 25}%;top:${30 + index * 15}%;--cursor-color:${index % 2 ? '#d2f36b' : '#ffb9a8'}">${icon('cursor')}<span>${escapeHTML(member.name)}</span></span>`).join('')}</div></div><div class="canvas-status"><span>${icon('users')} ${present.length} active participant${present.length === 1 ? '' : 's'}</span><span>${icon('database')} Browser-only state</span><span>${icon('cursor')} Select a tool, then click the canvas</span></div></section><section class="card card--pad mt-2"><div class="spread mb-2"><div><div class="eyebrow">Canvas snapshots</div><h2 class="mt-1" style="font:600 19px var(--font-display)">Named local restore points</h2></div><span class="small muted">${room.snapshots.length} saved</span></div>${room.snapshots.length ? `<div class="snapshot-grid">${room.snapshots.map(snapshot => `<article class="snapshot"><div class="snapshot__preview"></div><strong>${escapeHTML(snapshot.name)}</strong><small>${formatDateTime(snapshot.at)} · ${escapeHTML(getUser(snapshot.by)?.name || 'Member')}</small>${!archived ? `<button class="btn btn--ghost btn--sm mt-1" data-restore-snapshot="${snapshot.id}">Restore locally</button>` : ''}</article>`).join('')}</div>` : emptyState('No snapshots yet', archived ? 'No archived snapshot history is available.' : 'Save a named local restore point for this canvas.', '', 'camera')}</section>`;
  return { html: `${pageHead(`${project.code} · Co-working`, 'Think on the same canvas.', 'Presence, simulated cursors, sticky notes, text, shapes, drawing, and local snapshots.', `<a class="btn btn--outline" href="#/app/projects/${project.id}">${icon('arrow-left')} Project detail</a>`)}${withPreview(content, { title: 'No canvas activity', description: 'The empty-state preview hides objects, presence, and snapshots.', icon: 'pen' })}`, mount() {
    if (state.ui.preview !== 'normal') return;
    const board = document.querySelector('#canvas-board'); if (!board) return;
    let tool = 'select'; let drawing = null; const joinedHere = !room.presence.includes(user.id) && !archived;
    if (joinedHere) { room.presence.push(user.id); addAudit('coworking_joined_locally', `room:${room.roomId}`, 'coworking'); persistData(); }
    const save = message => { persistData(); const label = document.querySelector('#canvas-save-status'); if (label) { label.textContent = message; setTimeout(() => { if (label.isConnected) label.textContent = 'All changes saved locally'; }, 1400); } };
    const rerender = () => { persistData(); window.dispatchEvent(new CustomEvent('app:refresh')); };
    document.querySelectorAll('[data-canvas-tool]').forEach(button => button.addEventListener('click', () => { tool = button.dataset.canvasTool; document.querySelectorAll('[data-canvas-tool]').forEach(item => { item.classList.toggle('is-active', item === button); item.setAttribute('aria-pressed', String(item === button)); }); board.className = `canvas-board ${tool === 'select' ? 'tool-select' : ''}`; }));
    const point = event => { const rect = board.getBoundingClientRect(); return { x: Math.max(1, Math.min(92, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(1, Math.min(86, (event.clientY - rect.top) / rect.height * 100)), px: (event.clientX - rect.left) / rect.width * 1000, py: (event.clientY - rect.top) / rect.height * 600 }; };
    board.addEventListener('click', event => { if (archived || tool === 'select' || tool === 'pen' || event.target.closest('[data-canvas-object]')) return; const at = point(event); const object = { id: uid('o'), type: tool, x: at.x, y: at.y, text: tool === 'sticky' ? 'New note' : tool === 'text' ? 'New text' : '', color: room.objects.length % 2 ? 'blue' : 'yellow', shape: room.objects.length % 2 ? 'rect' : 'circle' }; room.objects.push(object); save('Object added locally'); rerender(); if (['sticky', 'text'].includes(tool)) setTimeout(() => openCanvasObject(projectId, object.id), 50); });
    board.addEventListener('pointerdown', event => { if (archived || tool !== 'pen') return; event.preventDefault(); board.setPointerCapture(event.pointerId); const at = point(event); drawing = { id: uid('o'), type: 'pen', x: 0, y: 0, points: `${at.px},${at.py}`, color: '#2d47dc' }; room.objects.push(drawing); board.querySelector('#drawing-layer')?.insertAdjacentHTML('beforebegin', canvasObject(drawing, false)); });
    board.addEventListener('pointermove', event => { if (!drawing) return; const at = point(event); drawing.points += ` ${at.px},${at.py}`; const polyline = board.querySelector(`[data-pen-id="${drawing.id}"] polyline`); if (polyline) polyline.setAttribute('points', drawing.points); });
    const finish = () => { if (drawing) { drawing = null; save('Drawing saved locally'); rerender(); } }; board.addEventListener('pointerup', finish); board.addEventListener('pointercancel', finish);
    document.querySelectorAll('[data-canvas-object]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); if (tool === 'select') openCanvasObject(projectId, button.dataset.canvasObject); }));
    document.querySelector('#undo-canvas')?.addEventListener('click', () => { if (!room.objects.length) return toast('Nothing to undo.', 'info'); room.objects.pop(); rerender(); });
    document.querySelector('#save-snapshot')?.addEventListener('click', () => openSnapshotDialog(projectId));
    document.querySelectorAll('[data-restore-snapshot]').forEach(button => button.addEventListener('click', async () => { const snapshot = room.snapshots.find(item => item.id === button.dataset.restoreSnapshot); if (snapshot && await confirmDialog({ title: 'Restore this snapshot?', message: 'Current canvas objects will be replaced by this local restore point.', confirmLabel: 'Restore snapshot' })) { room.objects = structuredClone(snapshot.objects || []); rerender(); } }));
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cursorTimer = reduceMotion ? null : setInterval(() => { document.querySelectorAll('[data-cursor]').forEach((cursor, index) => { cursor.style.left = `${18 + Math.random() * 65}%`; cursor.style.top = `${18 + Math.random() * 60}%`; }); }, 2400);
    return () => { if (cursorTimer) clearInterval(cursorTimer); if (joinedHere) { room.presence = room.presence.filter(id => id !== user.id); persistData(); } };
  } };
}

function openCanvasObject(projectId, objectId) {
  const room = state.data.coworking[projectId]; const object = room.objects.find(item => item.id === objectId); if (!object || room.status === 'archived') return;
  const editable = ['sticky', 'text'].includes(object.type);
  openDialog({ title: editable ? 'Edit canvas object' : 'Canvas shape', subtitle: 'Local canvas object', content: `<form id="canvas-object-form">${editable ? `<div class="field"><label for="canvas-object-text">Text</label><textarea class="textarea" id="canvas-object-text" name="text">${escapeHTML(object.text)}</textarea></div>` : '<p class="small muted">Shapes can be deleted in this prototype. Select the shape tool to add another.</p>'}</form>`, footer: `<button class="btn btn--danger" id="delete-canvas-object">Delete</button><button class="btn btn--outline" data-close-dialog>Cancel</button>${editable ? '<button class="btn btn--primary" id="save-canvas-object">Save locally</button>' : ''}`, onMount(dialog) {
    dialog.querySelector('#delete-canvas-object').addEventListener('click', () => { room.objects = room.objects.filter(item => item.id !== objectId); persistData(); closeDialog(); window.dispatchEvent(new CustomEvent('app:refresh')); });
    dialog.querySelector('#save-canvas-object')?.addEventListener('click', () => { const values = formValues(dialog.querySelector('#canvas-object-form')); if (!values.text?.trim()) return setFormError(dialog.querySelector('#canvas-object-form'), 'Text cannot be empty.', 'text'); object.text = values.text.trim(); persistData(); closeDialog(); window.dispatchEvent(new CustomEvent('app:refresh')); });
  } });
}

function openSnapshotDialog(projectId) {
  const room = state.data.coworking[projectId]; const user = currentUser();
  openDialog({ title: 'Save canvas snapshot', subtitle: 'Named browser-only restore point', content: `<form id="snapshot-form"><div class="field"><label for="snapshot-name">Snapshot name</label><input class="input" id="snapshot-name" name="name" value="Canvas checkpoint ${room.snapshots.length + 1}" required></div><p class="field-hint mt-1">Stores the current local objects, not an image or server snapshot.</p></form>`, footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="confirm-snapshot">Save snapshot</button>', onMount(dialog) {
    dialog.querySelector('#confirm-snapshot').addEventListener('click', () => { const form = dialog.querySelector('#snapshot-form'); const values = formValues(form); if (!values.name?.trim()) return setFormError(form, 'Name this snapshot.', 'name'); room.snapshots.unshift({ id: uid('snap'), name: values.name.trim(), at: new Date().toISOString(), by: user.id, objects: structuredClone(room.objects) }); addAudit('coworking_snapshot_local', `room:${room.roomId} snapshot:${values.name.trim()}`, 'coworking'); persistData(); closeDialog(); toast('Canvas snapshot saved locally.', 'info'); window.dispatchEvent(new CustomEvent('app:refresh')); });
  } });
}
