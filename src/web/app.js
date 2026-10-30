const PALETTE = ['#2563eb', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777'];
const LOCAL_SOURCES_KEY = 'ics-calendar-viewer.localSources.v1';
const FEED_CACHE_KEY = 'ics-calendar-viewer.feedSnapshots.v1';
const FEED_PREFERENCES_KEY = 'ics-calendar-viewer.feedPreferences.v1';
let restoringBackup = false;
const snoozedOccurrences = new Map();
const sources = []; // {id, name, color, enabled, events: ICAL.Event[]}
let nextId = 1;
const HIDE_CANCELLED_KEY = 'ics-calendar-viewer.hideCancelled.v1';
const VIEW_KEY = 'ics-calendar-viewer.view.v1';
const ALLOWED_VIEWS = ['timeGridDay', 'timeGridWorkWeek', 'timeGridWeek', 'dayGridMonth', 'listWeek'];
let initialView = 'timeGridWorkWeek';
try {
  const savedView = localStorage.getItem(VIEW_KEY);
  if (ALLOWED_VIEWS.includes(savedView)) initialView = savedView;
} catch { }
let searchQuery = '';
const searchInput = document.getElementById('event-search');
const clearSearch = document.getElementById('clear-search');
const searchStatus = document.getElementById('search-status');
let hideCancelled = false;
try { hideCancelled = localStorage.getItem(HIDE_CANCELLED_KEY) === 'true'; } catch { }
let backgroundFeedHealth = new Map();
let backgroundReachable = false;

const ALERT_RULES_KEY = 'ics-calendar-viewer.alertRules.v1';
const ALERT_FIRED_KEY = 'ics-calendar-viewer.alertsFired.v1';
let alertRules, firedAlerts;
try { alertRules = sanitizeRules(JSON.parse(localStorage.getItem(ALERT_RULES_KEY))); } catch { alertRules = sanitizeRules(null); }
try { firedAlerts = JSON.parse(localStorage.getItem(ALERT_FIRED_KEY)) || {}; } catch { firedAlerts = {}; }
const BELL_PATH = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
const BELL_OFF_PATH = BELL_PATH + '<path d="M3 3l18 18"/>';

// A bell on every card that will alert, and a crossed bell on upcoming cards that will not.
function alertIndicator(key, sourceKeys, finishMs, cancelled = false) {
  const rules = alertRules;
  const event = rules.events[key];
  let state = 'on', label = 'Alert set';
  if (cancelled) { state = 'muted'; label = 'Cancelled — alerts disabled'; }
  else if (event && event.mode === 'muted') { state = 'muted'; label = 'Alerts muted for this event'; }
  else if (rules.global.muted) { state = 'muted'; label = 'All alerts muted'; }
  else if (!resolveOffsets(rules, key, sourceKeys).length) { state = 'none'; label = 'No alert set'; }
  if (state !== 'on' && finishMs <= Date.now()) return null;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'event-bell ' + state);
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', label);
  icon.innerHTML = '<title>' + label + '</title>' + (state === 'on' ? BELL_PATH : BELL_OFF_PATH);
  return icon;
}
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
  saveFeedPreferences();
  scheduleAlertSync();
}

function readFeedPreferences() {
  try { const saved = JSON.parse(localStorage.getItem(FEED_PREFERENCES_KEY) || '[]'); return Array.isArray(saved) ? saved : []; }
  catch { return []; }
}

function saveFeedPreferences() {
  const prefs = new Map(readFeedPreferences().filter(s => s && typeof s.feedId === 'string').map(s => [s.feedId, s]));
  sources.filter(s => s.feedId).forEach(s => prefs.set(s.feedId, { feedId: s.feedId, name: s.name, color: s.color, enabled: s.enabled }));
  try { localStorage.setItem(FEED_PREFERENCES_KEY, JSON.stringify([...prefs.values()])); }
  catch (e) { setStatus('Could not save calendar preferences: ' + e.message); }
}

function feedPreference(feedId) {
  return readFeedPreferences().find(s => s && s.feedId === feedId) || {};
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
        events: parseIcs(s.icsText), fetchedAt: s.fetchedAt, ...feedPreference(s.feedId)
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

// The sync strip lives in <main> in the markup; move it once so it sits directly under FullCalendar's toolbar.
const syncStrip = document.getElementById('sync-strip');
function placeSyncStrip() {
  const toolbar = document.querySelector('#cal .fc-header-toolbar');
  if (toolbar && toolbar.nextElementSibling !== syncStrip) toolbar.after(syncStrip);
}
const setSyncState = state => { syncStrip.dataset.state = state; };
const upNext = document.getElementById('up-next');
const calBox = document.getElementById('cal');

// Hours outside this range, and weekends, are shaded in every view. A start later than the end (22:00 to 06:00)
// is an overnight shift: the early-morning part belongs to the day after the shift starts.
const HOURS_KEY = 'ics-calendar-viewer.workingHours.v1';
const endOfDay = time => (time === '00:00' ? '24:00' : time); // an end of 12 AM means midnight at the end of the day
function loadWorkingHours() {
  try {
    const h = JSON.parse(localStorage.getItem(HOURS_KEY));
    if (h && /^\d\d:\d\d$/.test(h.start) && /^\d\d:\d\d$/.test(h.end) && h.start !== h.end) return h;
  } catch { /* Use the default when storage is blocked or the saved value is invalid. */ }
  return { start: '08:00', end: '18:00' };
}
let workingHours = loadWorkingHours();
function businessHours() {
  const { start, end } = workingHours;
  if (start < endOfDay(end)) return { daysOfWeek: [1, 2, 3, 4, 5], startTime: start, endTime: endOfDay(end) };
  return [
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: start, endTime: '24:00' },
    { daysOfWeek: [2, 3, 4, 5, 6], startTime: '00:00', endTime: end }
  ];
}

const calendar = new FullCalendar.Calendar(document.getElementById('cal'), {
  initialView,
  height: '100%',
  nowIndicator: true,
  nowIndicatorContent(arg) {
    if (!arg.isAxis) return undefined;
    const chip = document.createElement('span');
    chip.className = 'now-chip';
    chip.textContent = arg.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
    return { domNodes: [chip] };
  },
  businessHours: businessHours(),
  eventDisplay: 'block',
  dayMaxEvents: 3,
  moreLinkClick: 'popover',
  moreLinkContent: arg => '+' + arg.num + ' more',
  fixedWeekCount: false,
  firstDay: 0,
  slotDuration: '00:30:00',
  scrollTime: currentScrollTime(),
  allDaySlot: false, // switched on in eventsSet only when the visible range has all-day events
  headerToolbar: { left: 'today prev,next title', center: '', right: 'timeGridDay,timeGridWorkWeek,timeGridWeek,dayGridMonth,listWeek' },
  buttonText: { today: 'Today', timeGridDay: 'Day', timeGridWorkWeek: 'Work week', timeGridWeek: 'Week', dayGridMonth: 'Month', listWeek: 'Agenda' },
  noEventsContent: () => searchQuery.trim() ? 'No events match your search in this date range.' : 'No events in this date range.',
  views: { timeGridWorkWeek: { type: 'timeGridWeek', weekends: false } },
  datesSet(arg) {
    try { localStorage.setItem(VIEW_KEY, arg.view.type); } catch { }
    if (arg.view.type.startsWith('timeGrid')) focusCurrentTime();
    showUpNext(arg.view.type === 'timeGridDay');
  },
  eventsSet(events) {
    const hasAllDay = events.some(e => e.allDay);
    if (calendar.getOption('allDaySlot') !== hasAllDay) {
      calendar.setOption('allDaySlot', hasAllDay);
      if (calendar.view.type.startsWith('timeGrid')) focusCurrentTime();
    }
    renderUpNext();
  },
  dayHeaderContent(arg) {
    const weekday = arg.date.toLocaleDateString(undefined, { weekday: 'short' });
    if (arg.view.type === 'dayGridMonth') return { html: weekday };
    return { html: weekday + '<span class="header-date">' + arg.date.getDate() + '</span>' };
  },
  eventContent(arg) {
    if (arg.view.type === 'listWeek') return agendaEventContent(arg);
    if (arg.view.type === 'dayGridMonth') {
      const chip = document.createElement('div');
      chip.className = 'event-card month-chip' + (isCancelledTitle(arg.event.title) ? ' canceled' : '');
      chip.title = arg.event.title;
      chip.dataset.finish = eventFinishTime(arg.event);
      chip.classList.toggle('completed', Number(chip.dataset.finish) <= Date.now());
      if (!arg.event.allDay && arg.timeText) {
        const time = document.createElement('span');
        time.className = 'mc-time';
        time.textContent = arg.timeText;
        chip.append(time);
      }
      const title = document.createElement('span');
      title.className = 'mc-title';
      title.textContent = arg.event.title;
      chip.append(title);
      const p = arg.event.extendedProps;
      appendConflictBadge(chip, p.conflicts);
      const bell = alertIndicator(eventAlertKey(p.uid, arg.event.title), eventSourceKeys(p), Number(chip.dataset.finish), isCancelledTitle(arg.event.title));
      if (bell) chip.append(bell);
      return { domNodes: [chip] };
    }
    const card = document.createElement('div');
    card.className = 'event-card' + (arg.event.allDay ? ' all-day-card' : '') + (isCancelledTitle(arg.event.title) ? ' canceled' : '');
    card.style.setProperty('--event-color', arg.event.backgroundColor || arg.event.borderColor || '#5b5fc7');
    card.title = arg.event.title; // titles are cut to one line, so the full text is on hover
    card.dataset.finish = eventFinishTime(arg.event);
    card.classList.toggle('completed', Number(card.dataset.finish) <= Date.now());
    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = arg.event.title;
    card.append(title);
    const p = arg.event.extendedProps;
    const bell = alertIndicator(eventAlertKey(p.uid, arg.event.title), eventSourceKeys(p), Number(card.dataset.finish), isCancelledTitle(arg.event.title));
    if (bell) {
      card.classList.add('has-alert');
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
    appendConflictBadge(card, p.conflicts);
    return { domNodes: [card] };
  },
  events(info, ok, fail) {
    try {
      const events = deduplicateEvents(sources.filter(s => s.enabled).flatMap(s => expand(s, info.start, info.end)));
      const eligible = markConflicts(visibleEvents(events, hideCancelled));
      const matches = eligible.filter(event => CalendarSearch.matches(event, searchQuery));
      updateSearchStatus(matches.length, eligible.length);
      ok(matches);
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
    document.getElementById('event-time').textContent = event.allDay ? 'All day' : event.start.toLocaleTimeString(undefined, timeOptions) + (event.end ? ' – ' + event.end.toLocaleTimeString(undefined, timeOptions) + durationText(event.end - event.start) : '');
    const canceled = isCancelledTitle(event.title);
    const conflicts = document.getElementById('event-conflicts');
    conflicts.hidden = !p.conflicts?.length;
    conflicts.textContent = p.conflicts?.length ? 'Overlaps with: ' + p.conflicts.join(', ') : '';
    const status = eventStatus(event, canceled);
    const statusEl = document.getElementById('event-status');
    statusEl.textContent = status.text;
    statusEl.dataset.state = status.state;
    statusEl.hidden = !status.text;
    document.getElementById('dlg-bar').dataset.state = status.state === 'upcoming' || status.state === 'live' ? 'active' : 'done';
    document.getElementById('location-row').hidden = !p.location;
    renderDetailText(document.getElementById('event-location'), p.location);
    const description = splitDescription(p.description);
    const dd = document.getElementById('dd');
    renderDetailText(dd, description.description || 'No additional description.');
    dd.classList.add('clamped');
    const ddToggle = document.getElementById('dd-toggle');
    ddToggle.hidden = true;
    ddToggle.textContent = 'Show more';
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
    const copyLink = document.getElementById('copy-link');
    copyLink.hidden = !meeting;
    copyLink.dataset.href = meeting ? meeting.href : '';
    copyLink.lastElementChild.textContent = 'Copy link';
    document.getElementById('dlg').showModal();
    ddToggle.hidden = dd.scrollHeight <= dd.clientHeight + 1;
  }
});
calendar.render();
placeSyncStrip();

function updateSearchStatus(count, total) {
  if (clearSearch) clearSearch.disabled = !searchQuery;
  if (!searchStatus) return;
  searchStatus.textContent = searchQuery.trim()
    ? (count ? count + ' of ' + total + ' events match in this date range.' : 'No matching events in this date range. Clear search or change dates.')
    : 'Search titles and locations in the displayed date range.';
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    calendar.refetchEvents();
  });
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchInput.value) {
      event.preventDefault();
      resetSearch();
    }
  });
}
function resetSearch() {
  searchQuery = '';
  if (searchInput) { searchInput.value = ''; searchInput.focus(); }
  calendar.refetchEvents();
}
if (clearSearch) clearSearch.addEventListener('click', resetSearch);

function agendaEventContent(arg) {
  const event = arg.event, p = event.extendedProps;
  const card = document.createElement('div');
  card.className = 'event-card agenda-card' + (isCancelledTitle(event.title) ? ' canceled' : '');
  card.title = event.title;
  card.dataset.finish = eventFinishTime(event);
  card.classList.toggle('completed', Number(card.dataset.finish) <= Date.now());
  const heading = document.createElement('div');
  heading.className = 'agenda-heading';
  const title = document.createElement('span');
  title.className = 'event-title';
  title.textContent = event.title;
  heading.append(title);
  appendConflictBadge(heading, p.conflicts);
  const bell = alertIndicator(eventAlertKey(p.uid, event.title), eventSourceKeys(p), Number(card.dataset.finish), isCancelledTitle(event.title));
  if (bell) heading.append(bell);
  card.append(heading);
  const details = [p.location, (p.sourceDetails || []).map(source => source.name).join(', ')].filter(Boolean);
  if (details.length) {
    const detail = document.createElement('div');
    detail.className = 'agenda-detail';
    detail.textContent = details.join(' · ');
    card.append(detail);
  }
  return { domNodes: [card] };
}

function appendConflictBadge(card, conflicts) {
  if (!conflicts?.length) return;
  const badge = document.createElement('span');
  badge.className = 'conflict-badge';
  badge.textContent = 'Overlap';
  badge.title = 'Overlaps with: ' + conflicts.join(', ');
  badge.setAttribute('aria-label', badge.title);
  card.classList.add('has-conflict');
  card.append(badge);
  card.title += '\n' + badge.title;
}

function durationText(ms) {
  const minutes = Math.round(ms / 60000);
  if (!(minutes > 0)) return '';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return ' · ' + (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
}

function eventStatus(event, canceled) {
  if (canceled) return { state: 'canceled', text: 'Canceled' };
  if (event.allDay) return { state: 'upcoming', text: '' };
  const now = Date.now();
  const start = event.start.getTime();
  if (Number(eventFinishTime(event)) <= now) return { state: 'ended', text: 'Ended' };
  if (start <= now) return { state: 'live', text: 'In progress' };
  return { state: 'upcoming', text: 'Starts in ' + formatRemaining(start - now) };
}

document.getElementById('dd-toggle').onclick = e => {
  const dd = document.getElementById('dd');
  const open = dd.classList.toggle('clamped') === false;
  e.currentTarget.textContent = open ? 'Show less' : 'Show more';
};
document.getElementById('copy-link').onclick = async e => {
  const button = e.currentTarget;
  try { await navigator.clipboard.writeText(button.dataset.href); button.lastElementChild.textContent = 'Copied'; }
  catch { button.lastElementChild.textContent = 'Copy failed'; }
  setTimeout(() => { button.lastElementChild.textContent = 'Copy link'; }, 1500);
};

// ---- Day view "Up next" rail (lives outside #cal, which FullCalendar owns) ----
function showUpNext(show) {
  upNext.hidden = !show;
  calBox.classList.toggle('show-rail', show);
  calendar.updateSize();
  positionUpNext();
  renderUpNext();
}

function positionUpNext() {
  const harness = document.querySelector('#cal .fc-view-harness');
  if (!harness || upNext.hidden || !upNext.offsetParent) return; // offsetParent is null while the rail is display:none (phones)
  const main = upNext.offsetParent.getBoundingClientRect();
  const cal = calBox.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(calBox).paddingRight) || 0;
  const box = harness.getBoundingClientRect();
  upNext.style.top = (box.top - main.top) + 'px';
  upNext.style.height = box.height + 'px';
  upNext.style.left = (cal.right - pad - upNext.offsetWidth - main.left) + 'px';
}
new ResizeObserver(positionUpNext).observe(calBox);
new ResizeObserver(positionUpNext).observe(syncStrip);

function renderUpNext() {
  if (upNext.hidden) return;
  const now = Date.now();
  let items = [];
  try { items = pickUpNext(collectOccurrences(sources, now, 7 * 86400000), now, 3); } catch { /* Keep the rail empty if a calendar cannot be read. */ }
  upNext.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'Up next';
  upNext.append(heading);
  if (!items.length) {
    const none = document.createElement('p');
    none.className = 'up-empty';
    none.textContent = 'Nothing in the next 7 days.';
    upNext.append(none);
    return;
  }
  const clock = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  items.forEach((o, i) => {
    const item = document.createElement('div');
    item.className = 'up-item' + (i === 0 ? ' first' : '');
    const title = document.createElement('div');
    title.className = 'up-title';
    title.textContent = o.title;
    item.append(title);
    const dots = document.createElement('div');
    dots.className = 'event-sources';
    (o.sourceDetails || []).forEach(source => {
      const dot = document.createElement('span');
      dot.className = 'source-dot';
      dot.style.setProperty('--detail-color', source.color);
      dot.title = source.name;
      dots.append(dot);
    });
    item.append(dots);
    const bell = alertIndicator(o.key, o.sourceKeys, Infinity);
    if (bell) item.append(bell);
    const day = new Date(o.start).toDateString() === new Date(now).toDateString() ? '' : new Date(o.start).toLocaleDateString(undefined, { weekday: 'short' }) + ' ';
    const when = document.createElement('div');
    when.className = 'up-when';
    when.textContent = o.allDay ? (day || 'Today ') + 'all day'
      : (i === 0 ? 'in ' + formatRemaining(o.start - now) + ' · ' : '') + day + clock(o.start);
    item.append(when);
    if (i === 0 && o.join) {
      const join = document.createElement('a');
      join.className = 'up-join';
      join.href = o.join;
      join.target = '_blank';
      join.rel = 'noopener noreferrer';
      join.textContent = 'Join';
      item.append(join);
    }
    upNext.append(item);
  });
}
setInterval(renderUpNext, 30000);

// ---- Working hours ----
const hoursStart = document.getElementById('hours-start');
const hoursEnd = document.getElementById('hours-end');
hoursStart.value = workingHours.start;
hoursEnd.value = workingHours.end;
function applyWorkingHours() {
  if (hoursStart.value && hoursEnd.value && hoursStart.value !== hoursEnd.value) {
    workingHours = { start: hoursStart.value, end: hoursEnd.value };
    try { localStorage.setItem(HOURS_KEY, JSON.stringify(workingHours)); } catch { /* The change still applies for this visit. */ }
    calendar.setOption('businessHours', businessHours());
  } else {
    hoursStart.value = workingHours.start;
    hoursEnd.value = workingHours.end;
    setStatus('Working hours: the start and end must be different.');
  }
}
hoursStart.onchange = applyWorkingHours;
hoursEnd.onchange = applyWorkingHours;
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
  if (restoringBackup) return;
  const body = JSON.stringify({
    rules: alertRules,
    sources: sources.filter(s => s.alertKey).map(s => ({ alertKey: s.alertKey, name: s.name, enabled: s.enabled, icsText: s.feedId ? undefined : s.icsText }))
  });
  try {
    const status = await (await api('/api/alerts/state', { method: 'POST', body })).json();
    applyServerStatus(status);
  } catch { backgroundReachable = false; serverToasts = false; updateSourceHealth(); }
  updateNotifyPanel();
}

async function refreshServerStatus() {
  try { applyServerStatus(await (await api('/api/alerts/status')).json()); }
  catch { serverToasts = false; backgroundReachable = false; updateSourceHealth(); }
  updateNotifyPanel();
}

function applyServerStatus(status) {
  serverToasts = !!status.serverToasts;
  backgroundReachable = true;
  backgroundFeedHealth = new Map((status.feeds || []).map(f => [f.id, f]));
  (status.snoozes?.pending || []).forEach(s => snoozedOccurrences.set(s.key + '|' + s.start, s.dueAt));
  for (const reminder of status.snoozes?.deliveries || []) {
    const id = 'snooze|' + reminder.id;
    if (!(id in firedAlerts) && !restoringBackup) {
      firedAlerts[id] = reminder.occ.start;
      snoozedOccurrences.set(reminder.occ.key + '|' + reminder.occ.start, reminder.deliveredAt);
      deliverAlert(reminder.occ, Date.now());
      saveFiredAlerts();
    }
  }
  updateSourceHealth();
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
  alertEventCtx = { key: eventAlertKey(p.uid, event.title), sourceKeys: eventSourceKeys(p), cancelled: isCancelledTitle(event.title) };
  renderEventAlerts();
}

function renderEventAlerts() {
  const { key, sourceKeys, cancelled } = alertEventCtx;
  const override = alertRules.events[key];
  const mode = override ? override.mode : 'default';
  document.querySelectorAll('input[name=alert-mode]').forEach(r => { r.checked = r.value === mode; r.disabled = cancelled; });
  const defaults = calendarDefaultOffsets(alertRules, sourceKeys);
  const effective = alertRules.global.muted ? [] : mode === 'muted' ? [] : mode === 'custom' ? override.offsets : defaults;
  document.getElementById('alert-summary').textContent = cancelled ? 'Cancelled — alerts disabled' : alertRules.global.muted ? 'All alerts muted' :
    mode === 'muted' ? 'Muted' : effective.length ? effective.map(formatOffset).join(', ') : 'No alerts';
  const custom = document.getElementById('alert-custom');
  custom.replaceChildren();
  if (mode === 'custom' && !cancelled) {
    custom.append(buildOffsetEditor(override.offsets, list => {
      alertRules.events[key] = { mode: 'custom', offsets: list };
      alertRulesChanged(list.length > 0);
    }));
  }
  document.getElementById('alert-note').textContent = cancelled ? 'Cancelled events never send alerts. Saved settings apply if the event becomes active again.' : (alertRules.global.muted ? 'All alerts are muted in the sidebar. ' : '') +
    (mode === 'default' ? '' : 'Applies to every occurrence of this event.');
}

document.querySelectorAll('input[name=alert-mode]').forEach(radio => {
  radio.onchange = () => {
    if (!radio.checked || !alertEventCtx || alertEventCtx.cancelled) return;
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
const hideCancelledToggle = document.getElementById('hide-cancelled');
hideCancelledToggle.checked = hideCancelled;
hideCancelledToggle.onchange = () => {
  hideCancelled = hideCancelledToggle.checked;
  try { localStorage.setItem(HIDE_CANCELLED_KEY, String(hideCancelled)); } catch { }
  calendar.refetchEvents();
};
muteAll.checked = alertRules.global.muted;
muteAll.onchange = () => { alertRules.global.muted = muteAll.checked; alertRulesChanged(false); if (alertEventCtx) renderEventAlerts(); };

function updateNotifyPanel() {
  const status = document.getElementById('notify-status');
  const enable = document.getElementById('notify-enable');
  const show = (text, detail, on) => { status.textContent = text; status.title = detail; status.parentElement.classList.toggle('on', on); };
  enable.hidden = true;
  if (serverToasts) show('Windows notifications on', 'Windows notifications are sent by the background server, even when this page is closed.', true);
  else if (!('Notification' in window)) show('Notifications not supported', 'System notifications are not supported here. In-app alerts only.', false);
  else if (Notification.permission === 'granted') show('Browser notifications on', 'System notifications on. They fire only while this page is open.', true);
  else if (Notification.permission === 'denied') show('Notifications blocked', 'System notifications are blocked in browser settings. In-app alerts only.', false);
  else { show('Notifications off', 'System notifications are off.', false); enable.hidden = false; }
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
  if (restoringBackup) return;
  const now = Date.now();
  const horizon = maxConfiguredOffset(alertRules) * 60000;
  if (!horizon) return;
  let due;
  try { due = findDueAlerts(alertRules, collectOccurrences(sources, now, horizon), firedAlerts, now); }
  catch { return; }
  due.forEach(a => {
    firedAlerts[a.id] = a.occ.start;
    const deferredUntil = snoozedOccurrences.get(a.occ.key + '|' + a.occ.start);
    if (!silent && !a.superseded && !(deferredUntil && now <= deferredUntil + 30000)) deliverAlert(a.occ, now);
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
  if (Date.now() + 5 * 60000 < occ.start) {
    const snooze = document.createElement('button');
    snooze.type = 'button';
    snooze.textContent = 'Snooze 5 min';
    snooze.onclick = async () => {
      snooze.disabled = true;
      try {
        const deferred = await (await api('/api/alerts/snooze', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Calendar-Action': '1' },
          body: JSON.stringify({ key: occ.key, start: occ.start })
        })).json();
        snoozedOccurrences.set(occ.key + '|' + occ.start, deferred.dueAt);
        toast.remove();
        setStatus('Reminder snoozed for 5 minutes.');
      } catch (e) {
        snooze.disabled = false;
        text.textContent = 'Could not snooze. The background server must be running. ' + e.message;
      }
    };
    actions.append(snooze);
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

const BELL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' + BELL_PATH + '</svg>';
const MORE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';

function renderSources() {
  const box = document.getElementById('sources');
  closeSourceMenu(false);
  box.replaceChildren();
  if (!sources.length) {
    const empty = document.createElement('p');
    empty.className = 'sb-empty';
    empty.textContent = 'No calendars yet. Use + to add a link or an .ics file.';
    box.append(empty);
    return;
  }
  sources.forEach(s => {
    if (isReservedGreen(s.color)) s.color = PALETTE[(s.id - 1) % PALETTE.length];
    const el = document.createElement('div');
    el.className = 'src' + (s.enabled ? '' : ' off');
    el.setAttribute('role', 'listitem');
    el.style.setProperty('--source-color', s.color);
    el.innerHTML = '<input type="checkbox" class="src-check" aria-label="Show or hide calendar" title="Show or hide"><span class="src-labels"><span class="src-name"></span><small class="src-health"></small></span><button type="button" class="icon-button bell-button" aria-label="Default alerts" title="Default alerts">' + BELL_ICON + '</button><button type="button" class="icon-button more-button" aria-label="Calendar options" aria-haspopup="menu" aria-expanded="false" title="Options">' + MORE_ICON + '</button><input type="color" class="src-color" tabindex="-1" aria-hidden="true">';
    const [chk, labels, bell, more, col] = el.children;
    const name = labels.querySelector('.src-name');
    el.dataset.sourceId = s.id;
    const calRule = alertRules.calendars[s.alertKey];
    bell.classList.toggle('active', !!(calRule && calRule.enabled && calRule.offsets.length));
    bell.onclick = () => openCalendarAlerts(s);
    name.textContent = s.name;
    name.title = s.name;
    chk.checked = s.enabled;
    chk.onchange = () => { s.enabled = chk.checked; el.classList.toggle('off', !s.enabled); saveLocalSources(); calendar.refetchEvents(); };
    col.value = s.color;
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
    more.onclick = () => openSourceMenu(s, el, more, col);
    box.append(el);
  });
  updateSourceHealth();
}

function updateSourceHealth() {
  const now = Date.now();
  const minutes = Number(document.getElementById('auto-refresh').value);
  const staleAfter = Math.max(10, minutes * 2) * 60000;
  const describe = health => {
    const at = health.fetchedAt;
    const time = at == null ? '' : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const labels = { current: 'Updated', refreshing: 'Refreshing…', error: 'Failed', stale: 'Stale', pending: 'Not fetched', inactive: 'Not needed', offline: 'Server offline' };
    return labels[health.state] + (time ? ' · ' + time : '');
  };
  document.querySelectorAll('.src[data-source-id]').forEach(row => {
    const source = sources.find(s => s.id === Number(row.dataset.sourceId));
    const label = row.querySelector('.src-health');
    if (!source || !label) return;
    label.replaceChildren();
    if (!source.feedId) { label.textContent = 'Local file'; return; }
    const page = syncHealth(source, now, staleAfter);
    const background = backgroundReachable ? backgroundFeedHealth.get(source.feedId) || { state: 'pending' } :
      { ...backgroundFeedHealth.get(source.feedId), state: 'offline' };
    for (const [name, health] of [['Page', page], ['Alerts', background]]) {
      const line = document.createElement('span');
      line.className = 'source-sync';
      line.dataset.state = health.state;
      line.textContent = name + ': ' + describe(health);
      line.title = name + ': ' + describe(health) + (health.fetchedAt == null ? '' : '\nLast successful refresh: ' + new Date(health.fetchedAt).toLocaleString());
      label.append(line);
    }
  });
}

async function removeSource(s) {
  if (s.feedId) {
    try { await api('/api/feeds/' + s.feedId, { method: 'DELETE' }); }
    catch (e) { return setStatus('Remove failed: ' + e.message); }
  }
  sources.splice(sources.indexOf(s), 1);
  if (alertRules.calendars[s.alertKey]) { delete alertRules.calendars[s.alertKey]; saveAlertRules(); }
  saveLocalSources();
  renderSources();
  calendar.refetchEvents();
}

function startRename(s, row) {
  const span = row.querySelector('.src-name');
  const more = row.querySelector('.more-button');
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'src-rename';
  field.value = s.name;
  field.setAttribute('aria-label', 'Calendar name');
  let finished = false;
  const finish = (save, refocus) => {
    if (finished) return;
    finished = true;
    const next = field.value.trim();
    if (save && next && next !== s.name) { s.name = next; saveLocalSources(); calendar.refetchEvents(); }
    span.textContent = s.name;
    span.title = s.name;
    field.replaceWith(span);
    if (refocus) more.focus();
  };
  field.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false, true); }
  };
  field.onblur = () => finish(true, false);
  span.replaceWith(field);
  field.focus();
  field.select();
}

// One shared options menu for every calendar row (Rename, Colour, Remove).
const sourceMenu = document.createElement('div');
sourceMenu.className = 'src-menu';
sourceMenu.setAttribute('role', 'menu');
sourceMenu.hidden = true;
document.body.append(sourceMenu);
let menuOwner = null; // { button, confirmTimer }

function closeSourceMenu(refocus) {
  if (!menuOwner) return;
  clearTimeout(menuOwner.confirmTimer);
  menuOwner.button.setAttribute('aria-expanded', 'false');
  if (refocus) menuOwner.button.focus();
  menuOwner = null;
  sourceMenu.hidden = true;
  sourceMenu.replaceChildren();
}

function openSourceMenu(s, row, button, colorInput) {
  if (menuOwner && menuOwner.button === button) return closeSourceMenu(true);
  closeSourceMenu(false);
  menuOwner = { button, confirmTimer: 0 };
  button.setAttribute('aria-expanded', 'true');
  const item = (label, onClick, className) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    if (className) b.className = className;
    b.onclick = onClick;
    sourceMenu.append(b);
    return b;
  };
  item('Rename', () => { closeSourceMenu(false); startRename(s, row); });
  item('Colour', () => {
    closeSourceMenu(false);
    if (colorInput.showPicker) colorInput.showPicker(); else colorInput.click();
  });
  const remove = item('Remove', () => {
    if (!remove.dataset.confirm) {
      remove.dataset.confirm = '1';
      remove.textContent = 'Confirm remove';
      menuOwner.confirmTimer = setTimeout(() => { delete remove.dataset.confirm; remove.textContent = 'Remove'; }, 4000);
      return;
    }
    closeSourceMenu(false);
    removeSource(s);
  }, 'danger');
  sourceMenu.hidden = false;
  const rect = button.getBoundingClientRect();
  const width = sourceMenu.offsetWidth, height = sourceMenu.offsetHeight;
  sourceMenu.style.left = Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)) + 'px';
  sourceMenu.style.top = (rect.bottom + 4 + height > innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4) + 'px';
  sourceMenu.querySelector('button').focus();
}

sourceMenu.addEventListener('keydown', e => {
  const items = [...sourceMenu.querySelectorAll('button')];
  const at = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeSourceMenu(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Tab') closeSourceMenu(false);
});
document.addEventListener('pointerdown', e => {
  if (menuOwner && !sourceMenu.contains(e.target) && !menuOwner.button.contains(e.target)) closeSourceMenu(false);
});
window.addEventListener('resize', () => closeSourceMenu(false));
document.getElementById('sources').addEventListener('scroll', () => closeSourceMenu(false));

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
      setStatus('Could not read ' + f.name + ': ' + e.message);
    }
  }
  saveLocalSources();
  renderSources();
  calendar.refetchEvents();
  setAddCardOpen(false);
}

const setStatus = msg => {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.title = msg; // The strip truncates long messages; the full text stays available on hover.
};

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.text()) || 'HTTP ' + r.status);
  return r;
}

let pendingRefreshes = 0;
let refreshQueued = false;
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
  if (restoringBackup) return;
  if (pendingRefreshes) { refreshQueued = true; return; }
  pendingRefreshes++;
  const main = document.querySelector('main');
  main.classList.add('is-refreshing');
  document.getElementById('cal').setAttribute('aria-busy', 'true');
  skeleton.hidden = !!document.querySelector('.fc-event');
  setStatus('Refreshing…');
  setSyncState('busy');
  try { await fetchFeeds(); }
  finally {
    pendingRefreshes--;
    if (!pendingRefreshes) {
      if (syncStrip.dataset.state === 'busy') setSyncState('error');
      skeleton.hidden = true;
      main.classList.remove('is-refreshing');
      document.getElementById('cal').setAttribute('aria-busy', 'false');
      if (refreshQueued) { refreshQueued = false; await loadFeeds(); }
    }
  }
}

async function fetchFeeds() {
  let feeds;
  try { feeds = await (await api('/api/feeds')).json(); }
  catch {
    sources.filter(s => s.feedId).forEach(s => { s.failed = true; s.fetching = false; });
    updateSourceHealth();
    setSyncState('error');
    return setStatus('Server not running. Start it with calendar.bat. Link feeds are off.');
  }
  setStatus('Refreshing…');
  feeds.forEach(f => {
    let source = sources.find(s => s.feedId === f.id);
    if (!source) {
      source = { id: nextId++, feedId: f.id, alertKey: 'f:' + f.id, name: f.name, color: f.color, enabled: true, events: [], ...feedPreference(f.id) };
      sources.push(source);
    }
    source.fetching = true;
  });
  renderSources();
  const results = await Promise.allSettled(feeds.map(async f => {
    const source = sources.find(s => s.feedId === f.id);
    try {
      const icsText = await (await api('/api/ics/' + f.id)).text();
      const events = parseIcs(icsText);
      if (!sources.includes(source)) return;
      source.events = events;
      source.fetchedAt = Date.now();
      source.failed = false;
      cacheFeedSnapshot(f, icsText);
    } catch (error) {
      if (sources.includes(source)) source.failed = true;
      throw error;
    } finally {
      if (sources.includes(source)) source.fetching = false;
      updateSourceHealth();
      calendar.refetchEvents();
    }
  }));
  const errors = [];
  feeds.forEach((f, i) => {
    const r = results[i];
    if (r.status === 'rejected') errors.push(f.name + ': ' + r.reason.message);
  });
  for (let i = sources.length - 1; i >= 0; i--) {
    if (sources[i].feedId && !feeds.some(f => f.id === sources[i].feedId)) sources.splice(i, 1);
  }
  writeFeedCache(readFeedCache().filter(s => feeds.some(f => f.id === s.feedId)));
  renderSources();
  calendar.refetchEvents();
  runAlertCheck(false);
  scheduleAlertSync();
  setSyncState(errors.length ? 'error' : 'ok');
  setStatus(errors.length ? 'Errors – ' + errors.join('; ') : 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
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
  updateSourceHealth();
};
configureAutoRefresh();
const THEME_KEY = 'calendar-theme';
function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll('[data-theme-choice]').forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === (choice === 'light' || choice === 'dark' ? choice : 'system'))));
}
let savedTheme = 'system';
try { savedTheme = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* Follow the system theme if storage is blocked. */ }
applyTheme(savedTheme);
document.querySelectorAll('[data-theme-choice]').forEach(button => {
  button.onclick = () => {
    const choice = button.dataset.themeChoice;
    try { localStorage.setItem(THEME_KEY, choice); } catch { }
    applyTheme(choice);
  };
});
document.getElementById('add').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/feeds', {
      method: 'POST',
      body: JSON.stringify({ name: f.name.value, url: f.url.value, color: PALETTE[sources.length % PALETTE.length] })
    });
    f.reset();
    setAddCardOpen(false);
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
setInterval(refreshServerStatus, 30000);
loadFeeds();

// ---- Add card ----
const addToggle = document.getElementById('add-toggle');
const addCard = document.getElementById('add-card');
const addForm = document.getElementById('add');
const dropZone = document.getElementById('drop');
function setAddMode(mode) {
  addForm.hidden = mode !== 'link';
  dropZone.hidden = mode !== 'file';
  document.getElementById('mode-link').setAttribute('aria-pressed', String(mode === 'link'));
  document.getElementById('mode-file').setAttribute('aria-pressed', String(mode === 'file'));
}
function setAddCardOpen(open) {
  addCard.hidden = !open;
  addToggle.setAttribute('aria-expanded', String(open));
  addToggle.setAttribute('aria-label', open ? 'Close add calendar' : 'Add calendar');
  addToggle.title = addToggle.getAttribute('aria-label');
  addToggle.classList.toggle('open', open);
  if (open) { setAddMode('link'); addForm.elements.name.focus(); }
}
addToggle.onclick = () => setAddCardOpen(addCard.hidden);
document.getElementById('mode-link').onclick = () => setAddMode('link');
document.getElementById('mode-file').onclick = () => setAddMode('file');

// ---- .ics files: choose them in the File tab, or drop them anywhere on the sidebar ----
const fileInput = document.getElementById('file');
function acceptFiles(files) {
  const accepted = [], skipped = [];
  files.forEach(f => (/\.ics$/i.test(f.name) || f.type === 'text/calendar' ? accepted : skipped).push(f));
  if (skipped.length) setStatus('Skipped ' + skipped.map(f => f.name).join(', ') + ': not an .ics file');
  if (accepted.length) addFiles(accepted);
}
fileInput.onchange = () => { acceptFiles([...fileInput.files]); fileInput.value = ''; };

const sidebar = document.getElementById('sidebar');
const dropOverlay = document.getElementById('drop-overlay');
const hasFiles = e => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
let dragDepth = 0; // dragenter/dragleave also fire for child elements, so count them
sidebar.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropOverlay.hidden = false; });
sidebar.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
sidebar.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
sidebar.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  acceptFiles([...e.dataTransfer.files]);
});

// The backup service owns feed URLs; the page supplies its imported files and preferences.
function getBackupClientState() {
  if (pendingRefreshes) throw new Error('Wait for the current calendar refresh to finish, then try again.');
  return {
    localSources: sources.filter(s => !s.feedId && s.icsText).map(s => ({ name: s.name, color: s.color, enabled: s.enabled, icsText: s.icsText, alertKey: s.alertKey })),
    feedPreferences: sources.filter(s => s.feedId).map(s => ({ feedId: s.feedId, name: s.name, color: s.color, enabled: s.enabled })),
    alertRules,
    preferences: {
      theme: localStorage.getItem(THEME_KEY) || 'system', workingHours,
      autoRefreshMinutes: Number(autoRefresh.value), hideCancelled, view: calendar.view.type
    }
  };
}

function applyBackupClientState(backup, { validateOnly = false } = {}) {
  const next = CalendarBackup.validateBackup(backup), p = next.preferences;
  CalendarStorage.write(localStorage, {
    [LOCAL_SOURCES_KEY]: JSON.stringify(next.localSources),
    [FEED_PREFERENCES_KEY]: JSON.stringify(next.feedPreferences),
    [FEED_CACHE_KEY]: '[]',
    [ALERT_RULES_KEY]: JSON.stringify(next.alertRules),
    [THEME_KEY]: p.theme,
    [HOURS_KEY]: JSON.stringify(p.workingHours),
    [AUTO_REFRESH_KEY]: String(p.autoRefreshMinutes),
    [HIDE_CANCELLED_KEY]: String(p.hideCancelled),
    [VIEW_KEY]: p.view
  }, validateOnly);
}

CalendarBackupUI.init({
  getClientState: getBackupClientState,
  applyClientState: applyBackupClientState,
  api: async (path, opts) => (await api(path, opts)).json(),
  onRestoreStart: () => { restoringBackup = true; clearTimeout(alertSyncTimer); },
  onRestoreFailure: ({ uncertain = false } = {}) => {
    restoringBackup = uncertain;
    if (uncertain) setStatus('Restore outcome is uncertain. Reconnect and use the recovery backup before resuming.');
    else scheduleAlertSync();
  },
  onRestored: () => window.location.reload()
});
