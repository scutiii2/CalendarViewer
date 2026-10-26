// Background alert scheduler: sends Windows toasts for upcoming events even when the web page is closed.
// The page pushes its alert rules and imported calendars here; feed links are fetched by this process.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

global.ICAL = require('./vendor/ical.min.js');
const logic = require('./alert-logic.js');

const FEED_REFRESH_MS = 5 * 60000;
const TICK_MS = 30000;

const b64 = text => Buffer.from(String(text || ''), 'utf8').toString('base64');

function windowsToast(occ, body, onResult) {
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'alert_toast.ps1'),
    '-Title', b64(occ.title), '-Body', b64(body), '-Url', b64(occ.join)
  ], { windowsHide: true, stdio: 'ignore' });
  child.on('error', e => onResult(e.message));
  child.on('exit', code => onResult(code ? 'powershell exited with code ' + code : null));
}

function createAlertService({ readFeeds, fetchText, notify = windowsToast, stateFile, firedFile, now = Date.now, log = console.log }) {
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const writeJson = (file, value) => { try { fs.writeFileSync(file, JSON.stringify(value)); } catch (e) { log('Could not save ' + path.basename(file) + ': ' + e.message); } };

  let state = readJson(stateFile, {});
  state = { rules: logic.sanitizeRules(state.rules), sources: Array.isArray(state.sources) ? state.sources : [] };
  const fired = readJson(firedFile, {});
  const feedCache = new Map();  // feedId -> { events, fetchedAt }
  const localCache = new Map(); // alertKey -> { text, events }
  let toastError = null;
  let running = null;

  async function refreshFeeds(feeds) {
    await Promise.all(feeds.map(async feed => {
      const cached = feedCache.get(feed.id);
      if (cached && now() - cached.fetchedAt < FEED_REFRESH_MS) return;
      try { feedCache.set(feed.id, { events: logic.parseIcs(await fetchText(feed)), fetchedAt: now() }); }
      catch (e) { log('Alert feed refresh failed for ' + feed.name + ': ' + e.message); }
    }));
  }

  function currentSources(feeds) {
    const flags = new Map(state.sources.map(s => [s.alertKey, s]));
    const out = [];
    feeds.forEach(feed => {
      const cached = feedCache.get(feed.id);
      if (!cached) return;
      const key = 'f:' + feed.id;
      const flag = flags.get(key);
      out.push({ id: out.length + 1, alertKey: key, name: feed.name, color: feed.color, enabled: flag ? flag.enabled !== false : true, events: cached.events });
    });
    state.sources.forEach(s => {
      if (typeof s.icsText !== 'string' || s.alertKey.startsWith('f:')) return;
      let cached = localCache.get(s.alertKey);
      if (!cached || cached.text !== s.icsText) {
        try { cached = { text: s.icsText, events: logic.parseIcs(s.icsText) }; } catch { return; }
        localCache.set(s.alertKey, cached);
      }
      out.push({ id: out.length + 1, alertKey: s.alertKey, name: s.name, color: '#5b5fc7', enabled: s.enabled !== false, events: cached.events });
    });
    return out;
  }

  // Marks due alerts as fired; shows them unless silent. Uses cached feed data only.
  function check(silent) {
    const t = now();
    const horizon = logic.maxConfiguredOffset(state.rules) * 60000;
    if (!horizon) return 0;
    let due;
    try { due = logic.findDueAlerts(state.rules, logic.collectOccurrences(currentSources(readFeeds()), t, horizon), fired, t); }
    catch (e) { log('Alert check failed: ' + e.message); return 0; }
    due.forEach(a => {
      fired[a.id] = a.occ.start;
      if (silent || a.superseded) return;
      notify(a.occ, logic.alertBody(a.occ, t), err => { toastError = err; if (err) log('Windows toast failed: ' + err); });
    });
    Object.keys(fired).forEach(id => { if (fired[id] < t - 86400000) delete fired[id]; });
    if (due.length) writeJson(firedFile, fired);
    return due.length;
  }

  function tick() {
    if (running) return running;
    running = (async () => {
      try {
        if (logic.maxConfiguredOffset(state.rules)) await refreshFeeds(readFeeds());
        check(false);
      } finally { running = null; }
    })();
    return running;
  }

  function setState(body) {
    const next = {
      rules: logic.sanitizeRules(body && body.rules),
      sources: (Array.isArray(body && body.sources) ? body.sources : [])
        .filter(s => s && typeof s.alertKey === 'string')
        .map(s => ({ alertKey: s.alertKey, name: String(s.name || ''), enabled: s.enabled !== false, icsText: typeof s.icsText === 'string' ? s.icsText : undefined }))
    };
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    state = next;
    if (!changed) return;
    writeJson(stateFile, state);
    for (const key of localCache.keys()) if (!state.sources.some(s => s.alertKey === key)) localCache.delete(key);
    // Edits must not announce alerts that were already past; the next tick also fetches any new feeds.
    check(true);
    tick();
  }

  const status = () => ({ serverToasts: process.platform === 'win32' && !toastError });

  function start() {
    tick();
    return setInterval(tick, TICK_MS);
  }

  return { setState, status, start, tick, check };
}

module.exports = { createAlertService };
