

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








calendar.render();
placeSyncStrip();











const BELL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' + BELL_PATH + '</svg>';
const MORE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';

function renderSources() {
  const box = document.getElementById('sources');
  closeSourceMenu(false);
  box.replaceChildren();
  if (!sources.length) {
    box.append(create('p', 'sb-empty', 'No calendars yet. Use + to add a link or an .ics file.'));
    return;
  }
  sources.forEach(s => {
    if (isReservedGreen(s.color)) s.color = PALETTE[(s.id - 1) % PALETTE.length];
    const el = create('div', 'src' + (s.enabled ? '' : ' off'));
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
    const time = at == null ? '' : new Date(at).toLocaleTimeString([], CLOCK);
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
      const line = create('span', 'source-sync');
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
  const field = create('input', 'src-rename');
  field.type = 'text';
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
const sourceMenu = create('div', 'src-menu');
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
    const b = create('button', className, label);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
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


let pendingRefreshes = 0;
let refreshQueued = false;
const skeleton = document.getElementById('calendar-loading');
for (let i = 0; i < 5; i++) {
  const column = create('div', 'skeleton-column');
  for (let j = 0; j < 3; j++) column.append(create('div', 'skeleton-event'));
  skeleton.append(column);
}

async function loadFeeds() {
  if (restoringBackup) return;
  if (pendingRefreshes) { refreshQueued = true; return; }
  pendingRefreshes++;
  const main = document.querySelector('main');
  main.classList.add('is-refreshing');
  calBox.setAttribute('aria-busy', 'true');
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
      calBox.setAttribute('aria-busy', 'false');
      if (refreshQueued) { refreshQueued = false; await loadFeeds(); }
    }
  }
}

async function fetchFeeds() {
  let feeds;
  try { feeds = await apiJson('/api/feeds'); }
  catch {
    sources.filter(s => s.feedId).forEach(s => { s.failed = true; s.fetching = false; });
    updateSourceHealth();
    setSyncState('error');
    return setStatus('Server not running. Start it with run.bat. Link feeds are off.');
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
  setStatus(errors.length ? 'Errors – ' + errors.join('; ') : 'Updated ' + new Date().toLocaleTimeString([], CLOCK));
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
const savedRefresh = store.get(AUTO_REFRESH_KEY);
if ([...autoRefresh.options].some(option => option.value === savedRefresh)) autoRefresh.value = savedRefresh;
autoRefresh.onchange = () => {
  store.set(AUTO_REFRESH_KEY, autoRefresh.value);
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
applyTheme(store.get(THEME_KEY) || 'system');
document.querySelectorAll('[data-theme-choice]').forEach(button => {
  button.onclick = () => {
    const choice = button.dataset.themeChoice;
    store.set(THEME_KEY, choice);
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
    localSources: localSourceSnapshots(),
    feedPreferences: feedPreferenceSnapshots(),
    alertRules,
    preferences: {
      theme: store.get(THEME_KEY) || 'system', workingHours,
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
  api: apiAction,
  onRestoreStart: () => { restoringBackup = true; clearTimeout(alertSyncTimer); },
  onRestoreFailure: ({ uncertain = false } = {}) => {
    restoringBackup = uncertain;
    if (uncertain) setStatus('Restore outcome is uncertain. Reconnect and use the recovery backup before resuming.');
    else scheduleAlertSync();
  },
  onRestored: () => window.location.reload()
});
