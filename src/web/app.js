const PALETTE = ['#2563eb', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777'];
const LOCAL_SOURCES_KEY = 'ics-calendar-viewer.localSources.v1';
const FEED_CACHE_KEY = 'ics-calendar-viewer.feedSnapshots.v1';
const sources = []; // {id, name, color, enabled, events: ICAL.Event[]}
let nextId = 1;

const ALERT_RULES_KEY = 'ics-calendar-viewer.alertRules.v1';
const ALERT_FIRED_KEY = 'ics-calendar-viewer.alertsFired.v1';
let alertRules, firedAlerts;
try { alertRules = sanitizeRules(JSON.parse(localStorage.getItem(ALERT_RULES_KEY))); } catch { alertRules = sanitizeRules(null); }
try { firedAlerts = JSON.parse(localStorage.getItem(ALERT_FIRED_KEY)) || {}; } catch { firedAlerts = {}; }
const BELL_PATH = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
const eventSourceKeys = p => (p.sourceDetails || []).map(s => s.key).filter(Boolean);

function isReservedGreen(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!hex) return false;
  const [r, g, b] = hex[1].match(/../g).map(v => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < .05) return false;
  let hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return hue >= 75 && hue <= 170;
}

function eventFinishTime(event) {
  if (event.end) return event.end.getTime();
  const end = new Date(event.start);
  if (event.allDay) end.setDate(end.getDate() + 1);
  else end.setHours(end.getHours() + 1);
  return end.getTime();
}

function updateEventStatus() {
  document.querySelectorAll('.event-card[data-finish]').forEach(card => {
    card.classList.toggle('completed', Number(card.dataset.finish) <= Date.now());
  });
}

function saveLocalSources() {
  const saved = sources.filter(s => !s.feedId && s.icsText).map(s => ({
    name: s.name, color: s.color, enabled: s.enabled, icsText: s.icsText, alertKey: s.alertKey
  }));
  try { localStorage.setItem(LOCAL_SOURCES_KEY, JSON.stringify(saved)); }
  catch (e) { setStatus('Could not save local calendars: ' + e.message); }
  scheduleAlertSync();
}

function restoreLocalSources() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(LOCAL_SOURCES_KEY) || '[]'); }
  catch { localStorage.removeItem(LOCAL_SOURCES_KEY); return; }
  if (!Array.isArray(saved)) return;
  saved.forEach(s => {
    if (!s || typeof s.icsText !== 'string') return;
    try {
      sources.push({
        id: nextId++, name: String(s.name || 'Local calendar'), color: s.color || PALETTE[sources.length % PALETTE.length],
        enabled: s.enabled !== false, events: parseIcs(s.icsText), icsText: s.icsText,
        alertKey: s.alertKey || 'l:' + crypto.randomUUID()
      });
    } catch { /* Ignore a saved calendar that can no longer be read. */ }
  });
}

function readFeedCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch { return []; }
}

function writeFeedCache(cached) {
  try { localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(cached)); }
  catch (e) { setStatus('Could not save calendar cache: ' + e.message); }
}

function cacheFeedSnapshot(feed, icsText) {
  const cached = readFeedCache().filter(s => s.feedId !== feed.id);
  cached.push({ feedId: feed.id, name: feed.name, color: feed.color, icsText, fetchedAt: Date.now() });
  writeFeedCache(cached);
}

function restoreFeedCache() {
  readFeedCache().forEach(s => {
    if (!s || !s.feedId || typeof s.icsText !== 'string') return;
    try {
      sources.push({
        id: nextId++, feedId: s.feedId, alertKey: 'f:' + s.feedId, name: String(s.name || 'Calendar'),
        color: s.color || PALETTE[sources.length % PALETTE.length], enabled: true,
        events: parseIcs(s.icsText)
      });
    } catch { /* Ignore an obsolete or malformed cached snapshot. */ }
  });
}

function currentScrollTime() {
  const now = new Date();
  // Leave room above "now" so it lands near the middle of the visible grid.
  now.setMinutes(now.getMinutes() - 210, 0, 0);
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':00';
}

function focusCurrentTime() {
  const scrollTime = currentScrollTime();
  // The second frame waits for FullCalendar to finish sizing its scroller.
  requestAnimationFrame(() => requestAnimationFrame(() => calendar.scrollToTime(scrollTime)));
}

function renderDetailText(element, text) {
  const value = String(text || '');
  element.replaceChildren();
  let offset = 0;
  for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    element.append(document.createTextNode(value.slice(offset, match.index)));
    const url = readableUrl(match[0]);
    if (url) {
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = isTeamsMeeting(url) ? 'Join Teams meeting' : 'Open link';
      element.append(link);
    } else element.append(document.createTextNode('[Link unavailable]'));
    offset = match.index + match[0].length;
  }
  element.append(document.createTextNode(value.slice(offset)));
}

function splitDescription(text) {
  const value = String(text || '').replace(/\r\n/g, '\n');
  const footer = /^\s*(?:Microsoft Teams(?: meeting)?\s*$|Join (?:the )?meeting(?: now)?\s*$|_{5,}|-{10,})/im.exec(value);
  if (!footer) return { description: value.trim(), footer: '' };
  return { description: value.slice(0, footer.index).trim(), footer: value.slice(footer.index).replace(/^\s*[_-]{5,}\s*/g, '').trim() };
}

const refreshControls = document.querySelector('.top-actions');
function placeRefreshControls() {
  const right = document.querySelector('.fc-header-toolbar .fc-toolbar-chunk:last-child');
  if (right && refreshControls.parentElement !== right) right.append(refreshControls);
}

const calendar = new FullCalendar.Calendar(document.getElementById('cal'), {
  initialView: 'timeGridWorkWeek',
  height: '100%',
  nowIndicator: true,
  firstDay: 1,
  slotDuration: '00:30:00',
  scrollTime: currentScrollTime(),
  allDaySlot: true,
  headerToolbar: { left: 'today prev,next timeGridDay,timeGridWorkWeek,timeGridWeek,dayGridMonth', center: 'title', right: '' },
  buttonText: { today: 'Today', timeGridDay: 'Day', timeGridWorkWeek: 'Work week', timeGridWeek: 'Week', dayGridMonth: 'Month' },
  views: { timeGridWorkWeek: { type: 'timeGridWeek', weekends: false } },
  datesSet(arg) {
    requestAnimationFrame(placeRefreshControls);
    if (arg.view.type.startsWith('timeGrid')) focusCurrentTime();
  },
  dayHeaderContent(arg) {
    const weekday = arg.date.toLocaleDateString(undefined, { weekday: 'short' });
    return { html: weekday + '<span class="header-date">' + arg.date.getDate() + '</span>' };
  },
  eventContent(arg) {
    const card = document.createElement('div');
    card.className = 'event-card' + (arg.event.allDay ? ' all-day-card' : '') + (/^\s*cancell?ed\b/i.test(arg.event.title) ? ' canceled' : '');
    card.style.setProperty('--event-color', arg.event.backgroundColor || arg.event.borderColor || '#5b5fc7');
    card.dataset.finish = eventFinishTime(arg.event);
    card.classList.toggle('completed', Number(card.dataset.finish) <= Date.now());
    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = arg.event.title;
    card.append(title);
    const p = arg.event.extendedProps;
    if (resolveOffsets(alertRules, eventAlertKey(p.uid, arg.event.title), eventSourceKeys(p)).length) {
      card.classList.add('has-alert');
      const bell = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      bell.setAttribute('class', 'event-bell');
      bell.setAttribute('viewBox', '0 0 24 24');
      bell.setAttribute('aria-label', 'Alert set');
      bell.innerHTML = BELL_PATH;
      card.append(bell);
    }
    const memberships = arg.event.extendedProps.sourceDetails || [];
    if (memberships.length) {
      const dots = document.createElement('div');
      dots.className = 'event-sources';
      dots.setAttribute('aria-label', memberships.map(s => s.name).join(', '));
      memberships.forEach(source => {
        const dot = document.createElement('span');
        dot.className = 'source-dot';
        dot.style.setProperty('--detail-color', source.color);
        dot.title = source.name;
        dots.append(dot);
      });
      card.append(dots);
    }
    if (!arg.event.allDay && arg.timeText) {
      const time = document.createElement('div');
      time.className = 'event-time';
      time.textContent = arg.timeText;
      card.append(time);
    }
    return { domNodes: [card] };
  },
  events(info, ok, fail) {
    try {
      ok(deduplicateEvents(sources.filter(s => s.enabled).flatMap(s => expand(s, info.start, info.end))));
    } catch (e) { fail(e); }
  },
  eventClick({ event }) {
    const p = event.extendedProps;
    document.getElementById('dt').textContent = event.title;
    const badges = document.getElementById('dm');
    badges.replaceChildren();
    (p.sourceDetails || [{ name: p.source, color: event.backgroundColor }]).forEach(source => {
      const badge = document.createElement('span');
      badge.className = 'source-badge';
      badge.style.setProperty('--detail-color', source.color);
      badge.textContent = source.name;
      badges.append(badge);
    });
    document.getElementById('dlg').style.setProperty('--detail-color', event.backgroundColor || '#5b5fc7');
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    const lastDay = event.allDay && event.end ? new Date(event.end.getTime() - 1) : event.end;
    const spansDays = lastDay && lastDay.toDateString() !== event.start.toDateString();
    document.getElementById('event-date').textContent = event.start.toLocaleDateString(undefined, dateOptions) + (spansDays ? ' – ' + lastDay.toLocaleDateString(undefined, dateOptions) : '');
    const timeOptions = { hour: 'numeric', minute: '2-digit' };
    document.getElementById('event-time').textContent = event.allDay ? 'All day' : event.start.toLocaleTimeString(undefined, timeOptions) + (event.end ? ' – ' + event.end.toLocaleTimeString(undefined, timeOptions) : '');
    document.getElementById('location-row').hidden = !p.location;
    renderDetailText(document.getElementById('event-location'), p.location);
    const description = splitDescription(p.description);
    renderDetailText(document.getElementById('dd'), description.description || 'No additional description.');
    const footer = document.getElementById('meeting-footer');
    footer.hidden = !description.footer;
    footer.open = false;
    renderDetailText(document.getElementById('meeting-footer-text'), description.footer);
    document.querySelector('.description-section').scrollTop = 0;
    const meeting = findMeetingUrl(p);
    openEventAlerts(event);
    const join = document.getElementById('join');
    join.hidden = !meeting;
    join.removeAttribute('href');
    if (meeting) join.href = meeting.href;
    document.getElementById('dlg').showModal();
  }
});
calendar.render();
placeRefreshControls();
// Update finished-event styling even when the page stays open without navigation.
setInterval(updateEventStatus, 30000);

// ---- Alerts: persistence, editors, scheduler, delivery ----
function saveAlertRules() {
  try { localStorage.setItem(ALERT_RULES_KEY, JSON.stringify(alertRules)); }
  catch (e) { setStatus('Could not save alert settings: ' + e.message); }
  scheduleAlertSync();
}

// The background server sends Windows toasts even when this page is closed, so it needs the rules and calendars.
let serverToasts = null; // null = unknown, true = server shows Windows toasts, false = it cannot
let alertSyncTimer;
function scheduleAlertSync() {
  clearTimeout(alertSyncTimer);
  alertSyncTimer = setTimeout(syncAlertState, 500);
}

async function syncAlertState() {
  const body = JSON.stringify({
    rules: alertRules,
    sources: sources.filter(s => s.alertKey).map(s => ({ alertKey: s.alertKey, name: s.name, enabled: s.enabled, icsText: s.feedId ? undefined : s.icsText }))
  });
  try {
    const status = await (await api('/api/alerts/state', { method: 'POST', body })).json();
    serverToasts = !!status.serverToasts;
  } catch { /* Server unreachable: the page falls back to browser notifications. */ }
  updateNotifyPanel();
}

async function refreshServerStatus() {
  try { serverToasts = !!(await (await api('/api/alerts/status')).json()).serverToasts; } catch { serverToasts = false; }
  updateNotifyPanel();
}

function saveFiredAlerts() {
  try { localStorage.setItem(ALERT_FIRED_KEY, JSON.stringify(firedAlerts)); } catch { }
}

// Called after any rule edit. Alerts already past due are marked fired silently so editing never pops a burst of toasts.
function alertRulesChanged(requestPermission) {
  saveAlertRules();
  runAlertCheck(true);
  renderSources();
  calendar.refetchEvents();
  if (requestPermission) askNotificationPermission();
}

function buildOffsetEditor(offsets, onChange) {
  const root = document.createElement('div');
  root.className = 'offset-editor';
  let list = normalizeOffsets(offsets);
  const set = next => { list = normalizeOffsets(next); onChange(list); draw(); };
  function draw() {
    root.replaceChildren();
    const chips = document.createElement('div');
    chips.className = 'offset-chips';
    if (!list.length) {
      const none = document.createElement('span');
      none.className = 'alert-hint';
      none.textContent = 'No alerts set.';
      chips.append(none);
    }
    list.forEach(min => {
      const chip = document.createElement('span');
      chip.className = 'offset-chip';
      chip.textContent = formatOffset(min);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.setAttribute('aria-label', 'Remove alert ' + formatOffset(min));
      rm.onclick = () => set(list.filter(m => m !== min));
      chip.append(rm);
      chips.append(chip);
    });
    const add = document.createElement('div');
    add.className = 'offset-add';
    add.innerHTML = '<input type="number" min="1" value="15" aria-label="Alert amount"><select aria-label="Alert unit"><option value="1">minutes</option><option value="60">hours</option><option value="1440">days</option></select><button type="button" class="primary">Add</button>';
    const [amount, unit, addBtn] = add.children;
    addBtn.onclick = () => {
      const min = Math.round(Number(amount.value) * Number(unit.value));
      if (!Number.isFinite(min) || min < 1 || min > MAX_OFFSET_MIN) return setStatus('Alert must be between 1 minute and 30 days before.');
      set([...list, min]);
    };
    root.append(chips, add);
  }
  draw();
  return root;
}

// -- Per-calendar defaults --
const calAlertDlg = document.getElementById('cal-alert-dlg');
const calAlertEnabled = document.getElementById('cal-alert-enabled');
function openCalendarAlerts(src) {
  const rule = () => alertRules.calendars[src.alertKey] || (alertRules.calendars[src.alertKey] = { enabled: true, offsets: [] });
  document.getElementById('cal-alert-title').textContent = 'Default alerts: ' + src.name;
  calAlertEnabled.checked = rule().enabled;
  calAlertEnabled.onchange = () => { rule().enabled = calAlertEnabled.checked; alertRulesChanged(calAlertEnabled.checked); };
  document.getElementById('cal-alert-editor').replaceChildren(buildOffsetEditor(rule().offsets, list => {
    rule().offsets = list;
    alertRulesChanged(list.length > 0);
  }));
  calAlertDlg.showModal();
}

// -- Per-event override (keyed by UID, so it covers every occurrence of a recurring event) --
let alertEventCtx = null;
function openEventAlerts(event) {
  const p = event.extendedProps;
  alertEventCtx = { key: eventAlertKey(p.uid, event.title), sourceKeys: eventSourceKeys(p) };
  renderEventAlerts();
}

function renderEventAlerts() {
  const { key, sourceKeys } = alertEventCtx;
  const override = alertRules.events[key];
  const mode = override ? override.mode : 'default';
  document.querySelectorAll('input[name=alert-mode]').forEach(r => { r.checked = r.value === mode; });
  const defaults = calendarDefaultOffsets(alertRules, sourceKeys);
  document.getElementById('alert-default-text').textContent = defaults.length ? '(' + defaults.map(formatOffset).join(', ') + ')' : '(none)';
  const custom = document.getElementById('alert-custom');
  custom.replaceChildren();
  if (mode === 'custom') {
    custom.append(buildOffsetEditor(override.offsets, list => {
      alertRules.events[key] = { mode: 'custom', offsets: list };
      alertRulesChanged(list.length > 0);
    }));
  }
  document.getElementById('alert-note').textContent = (alertRules.global.muted ? 'All alerts are muted in the sidebar. ' : '') +
    (mode === 'default' ? '' : 'Applies to every occurrence of this event.');
}

document.querySelectorAll('input[name=alert-mode]').forEach(radio => {
  radio.onchange = () => {
    if (!radio.checked || !alertEventCtx) return;
    const { key, sourceKeys } = alertEventCtx;
    if (radio.value === 'default') delete alertRules.events[key];
    else if (radio.value === 'muted') alertRules.events[key] = { mode: 'muted', offsets: [] };
    else alertRules.events[key] = { mode: 'custom', offsets: calendarDefaultOffsets(alertRules, sourceKeys) };
    renderEventAlerts();
    alertRulesChanged(radio.value === 'custom');
  };
});

// -- Sidebar panel: global mute and system notification permission --
const muteAll = document.getElementById('mute-all');
muteAll.checked = alertRules.global.muted;
muteAll.onchange = () => { alertRules.global.muted = muteAll.checked; alertRulesChanged(false); if (alertEventCtx) renderEventAlerts(); };

function updateNotifyPanel() {
  const status = document.getElementById('notify-status');
  const enable = document.getElementById('notify-enable');
  enable.hidden = true;
  if (serverToasts) status.textContent = 'Windows notifications are sent by the background server, even when this page is closed.';
  else if (!('Notification' in window)) status.textContent = 'System notifications are not supported here. In-app alerts only.';
  else if (Notification.permission === 'granted') status.textContent = 'System notifications on. They fire only while this page is open.';
  else if (Notification.permission === 'denied') status.textContent = 'System notifications are blocked in browser settings. In-app alerts only.';
  else { status.textContent = 'System notifications are off.'; enable.hidden = false; }
}

function askNotificationPermission() {
  if (serverToasts || !('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().then(updateNotifyPanel, updateNotifyPanel);
}
document.getElementById('notify-enable').onclick = askNotificationPermission;
updateNotifyPanel();

// -- Start with Windows --
const startupToggle = document.getElementById('startup-toggle');
function showStartup(status) {
  document.getElementById('startup-row').hidden = !status.supported;
  document.getElementById('startup-note').hidden = !status.supported;
  startupToggle.checked = !!status.enabled;
}

async function loadStartup() {
  try { showStartup(await (await api('/api/startup')).json()); } catch { /* No server: the toggle stays hidden. */ }
}

// Shows progress next to the checkbox: a spinner while working, then a check (fades away) or an error that stays.
const startupState = document.getElementById('startup-state');
let startupStateTimer;
function setStartupState(kind, text) {
  clearTimeout(startupStateTimer);
  startupState.className = 'startup-state' + (kind ? ' ' + kind : '');
  startupState.hidden = !kind;
  document.getElementById('startup-state-text').textContent = text || '';
  if (kind === 'ok') {
    startupStateTimer = setTimeout(() => {
      startupState.classList.add('fading');
      startupStateTimer = setTimeout(() => setStartupState(null), 400);
    }, 3000);
  }
}

startupToggle.onchange = async () => {
  const wanted = startupToggle.checked;
  startupToggle.disabled = true;
  setStartupState('busy', wanted ? 'Turning on…' : 'Turning off…');
  try {
    const r = await api('/api/startup', { method: 'POST', headers: { 'X-Calendar-Action': '1' }, body: JSON.stringify({ enabled: wanted }) });
    showStartup(await r.json());
    setStartupState('ok', wanted ? 'Turned on' : 'Turned off');
    setStatus(wanted ? 'Server will start with Windows.' : 'Automatic startup turned off.');
  } catch (e) {
    startupToggle.checked = !wanted;
    setStartupState('error', 'Failed: ' + e.message);
    setStatus('Startup change failed: ' + e.message);
  }
  startupToggle.disabled = false;
};
loadStartup();

// -- Scheduler --
function runAlertCheck(silent) {
  const now = Date.now();
  const horizon = maxConfiguredOffset(alertRules) * 60000;
  if (!horizon) return;
  let due;
  try { due = findDueAlerts(alertRules, collectOccurrences(sources, now, horizon), firedAlerts, now); }
  catch { return; }
  due.forEach(a => {
    firedAlerts[a.id] = a.occ.start;
    if (!silent && !a.superseded) deliverAlert(a.occ, now);
  });
  Object.keys(firedAlerts).forEach(id => { if (firedAlerts[id] < now - 86400000) delete firedAlerts[id]; });
  if (due.length) saveFiredAlerts();
}

function deliverAlert(occ, now) {
  const body = alertBody(occ, now);
  showToast(occ, body);
  if (serverToasts) return; // The server already shows the Windows toast.
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(occ.title, { body, tag: occ.key + '|' + occ.start });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* Some contexts block the constructor; the in-app toast already fired. */ }
  }
}

function showToast(occ, body) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'alert');
  const title = document.createElement('div');
  title.className = 'toast-title';
  title.textContent = occ.title;
  const text = document.createElement('div');
  text.className = 'toast-body';
  text.textContent = body;
  const actions = document.createElement('div');
  actions.className = 'toast-actions';
  if (occ.join) {
    const join = document.createElement('a');
    join.className = 'primary';
    join.href = occ.join;
    join.target = '_blank';
    join.rel = 'noopener noreferrer';
    join.textContent = 'Join';
    actions.append(join);
  }
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.onclick = () => toast.remove();
  actions.append(dismiss);
  toast.append(title, text, actions);
  document.getElementById('toasts').append(toast);
}

setInterval(() => runAlertCheck(false), 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) runAlertCheck(false); });

function renderSources() {
  const box = document.getElementById('sources');
  box.replaceChildren();
  sources.forEach(s => {
    if (isReservedGreen(s.color)) s.color = PALETTE[(s.id - 1) % PALETTE.length];
    const el = document.createElement('div');
    el.className = 'src';
    el.style.setProperty('--source-color', s.color);
    el.innerHTML = '<input type="checkbox" aria-label="Show or hide calendar" title="Show/hide"><input type="color" aria-label="Calendar color" title="Color"><input type="text" aria-label="Calendar label" title="Label"><button class="icon-button bell-button" aria-label="Default alerts" title="Default alerts"><svg viewBox="0 0 24 24" aria-hidden="true">' + BELL_PATH + '</svg></button><button class="icon-button" aria-label="Remove calendar" title="Remove">×</button>';
    const [chk, col, name, bell, rm] = el.children;
    const calRule = alertRules.calendars[s.alertKey];
    bell.classList.toggle('active', !!(calRule && calRule.enabled && calRule.offsets.length));
    bell.onclick = () => openCalendarAlerts(s);
    chk.checked = s.enabled;
    col.value = s.color;
    name.value = s.name;
    chk.onchange = () => { s.enabled = chk.checked; saveLocalSources(); calendar.refetchEvents(); };
    col.title = 'Calendar color (green is reserved for active events)';
    col.oninput = () => {
      if (isReservedGreen(col.value)) {
        col.value = s.color;
        setStatus('Green is reserved for upcoming and ongoing events. Choose another calendar color.');
        return;
      }
      s.color = col.value;
      el.style.setProperty('--source-color', s.color);
      saveLocalSources();
      calendar.refetchEvents();
    };
    name.oninput = () => { s.name = name.value; saveLocalSources(); };
    rm.onclick = async () => {
      if (s.feedId) {
        try { await api('/api/feeds/' + s.feedId, { method: 'DELETE' }); }
        catch (e) { return setStatus('Remove failed: ' + e.message); }
      }
      sources.splice(sources.indexOf(s), 1);
      if (alertRules.calendars[s.alertKey]) { delete alertRules.calendars[s.alertKey]; saveAlertRules(); }
      saveLocalSources();
      renderSources();
      calendar.refetchEvents();
    };
    box.append(el);
  });
}

async function addFiles(files) {
  for (const f of files) {
    try {
      const icsText = await f.text();
      const events = parseIcs(icsText);
      sources.push({
        id: nextId++,
        alertKey: 'l:' + crypto.randomUUID(),
        name: f.name.replace(/\.ics$/i, ''),
        color: PALETTE[sources.length % PALETTE.length],
        enabled: true,
        events,
        icsText
      });
    } catch (e) {
      alert('Could not read ' + f.name + ': ' + e.message);
    }
  }
  saveLocalSources();
  renderSources();
  calendar.refetchEvents();
}

const setStatus = msg => { document.getElementById('status').textContent = msg; };

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.text()) || 'HTTP ' + r.status);
  return r;
}

let pendingRefreshes = 0;
const skeleton = document.getElementById('calendar-loading');
for (let i = 0; i < 5; i++) {
  const column = document.createElement('div');
  column.className = 'skeleton-column';
  for (let j = 0; j < 3; j++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'skeleton-event';
    column.append(placeholder);
  }
  skeleton.append(column);
}

async function loadFeeds() {
  pendingRefreshes++;
  const main = document.querySelector('main');
  main.classList.add('is-refreshing');
  document.getElementById('cal').setAttribute('aria-busy', 'true');
  skeleton.hidden = !!document.querySelector('.fc-event');
  setStatus('Refreshing…');
  try { await fetchFeeds(); }
  finally {
    pendingRefreshes--;
    if (!pendingRefreshes) {
      skeleton.hidden = true;
      main.classList.remove('is-refreshing');
      document.getElementById('cal').setAttribute('aria-busy', 'false');
    }
  }
}

async function fetchFeeds() {
  let feeds;
  try { feeds = await (await api('/api/feeds')).json(); }
  catch { return setStatus('Server not running (npm start / node server.js). Link feeds off.'); }
  setStatus('Refreshing…');
  const results = await Promise.allSettled(feeds.map(async f => {
    const icsText = await (await api('/api/ics/' + f.id)).text();
    return { events: parseIcs(icsText), icsText };
  }));
  const errors = [];
  feeds.forEach((f, i) => {
    const r = results[i];
    const existing = sources.find(s => s.feedId === f.id);
    if (r.status === 'rejected') return errors.push(f.name + ': ' + r.reason.message);
    if (existing) existing.events = r.value.events;
    else sources.push({ id: nextId++, feedId: f.id, alertKey: 'f:' + f.id, name: f.name, color: f.color, enabled: true, events: r.value.events });
    cacheFeedSnapshot(f, r.value.icsText);
  });
  for (let i = sources.length - 1; i >= 0; i--) {
    if (sources[i].feedId && !feeds.some(f => f.id === sources[i].feedId)) sources.splice(i, 1);
  }
  writeFeedCache(readFeedCache().filter(s => feeds.some(f => f.id === s.feedId)));
  renderSources();
  calendar.refetchEvents();
  runAlertCheck(false);
  scheduleAlertSync();
  setStatus((errors.length ? 'Errors – ' + errors.join('; ') : 'Updated') + ' ' + new Date().toLocaleTimeString() + '.');
}

document.getElementById('refresh').onclick = loadFeeds;
const AUTO_REFRESH_KEY = 'ics-calendar-viewer.autoRefreshMinutes.v1';
const autoRefresh = document.getElementById('auto-refresh');
let autoRefreshTimer;
function configureAutoRefresh() {
  clearInterval(autoRefreshTimer);
  const minutes = Number(autoRefresh.value);
  if (minutes > 0) {
    autoRefreshTimer = setInterval(() => {
      if (!pendingRefreshes) loadFeeds();
    }, minutes * 60000);
  }
}
try {
  const saved = localStorage.getItem(AUTO_REFRESH_KEY);
  if ([...autoRefresh.options].some(option => option.value === saved)) autoRefresh.value = saved;
} catch { /* Keep manual refresh available if storage is blocked. */ }
autoRefresh.onchange = () => {
  try { localStorage.setItem(AUTO_REFRESH_KEY, autoRefresh.value); } catch { }
  configureAutoRefresh();
};
configureAutoRefresh();
document.getElementById('add').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/feeds', {
      method: 'POST',
      body: JSON.stringify({ name: f.name.value, url: f.url.value, color: PALETTE[sources.length % PALETTE.length] })
    });
    f.reset();
    await loadFeeds();
  } catch (err) { setStatus('Add failed: ' + err.message); }
};
restoreLocalSources();
saveLocalSources(); // persists alertKey for calendars saved before alerts existed
restoreFeedCache();
renderSources();
calendar.refetchEvents();
// Learn whether the server shows Windows toasts before the first check, so no alert is announced twice.
refreshServerStatus().then(() => { runAlertCheck(false); scheduleAlertSync(); });
loadFeeds();

const drop = document.getElementById('drop');
const input = document.getElementById('file');
input.onchange = () => { addFiles([...input.files]); input.value = ''; };
['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
