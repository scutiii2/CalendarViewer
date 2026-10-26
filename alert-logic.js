// Shared by the page (index.html loads it as a script) and the server (alerts.js requires it).
// Needs a global ICAL (ical.js). Pure functions; no DOM access.
const MAX_OCCURRENCES = 2000;
const MAX_OFFSET_MIN = 60 * 24 * 30;
const eventAlertKey = (uid, title) => uid || 'fb:' + title;

function normalizeOffsets(list) {
  const valid = (Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= MAX_OFFSET_MIN);
  return [...new Set(valid)].sort((a, b) => b - a);
}

function formatOffset(min) {
  if (min % 1440 === 0) return min / 1440 + (min === 1440 ? ' day' : ' days') + ' before';
  if (min % 60 === 0) return min / 60 + (min === 60 ? ' hour' : ' hours') + ' before';
  return min + (min === 1 ? ' minute' : ' minutes') + ' before';
}

function sanitizeRules(raw) {
  const rules = { global: { muted: false }, calendars: {}, events: {} };
  if (!raw || typeof raw !== 'object') return rules;
  rules.global.muted = !!(raw.global && raw.global.muted);
  Object.entries(raw.calendars || {}).forEach(([key, c]) => {
    if (c && typeof c === 'object') rules.calendars[key] = { enabled: c.enabled !== false, offsets: normalizeOffsets(c.offsets) };
  });
  Object.entries(raw.events || {}).forEach(([key, e]) => {
    if (e && e.mode === 'muted') rules.events[key] = { mode: 'muted', offsets: [] };
    else if (e && e.mode === 'custom') rules.events[key] = { mode: 'custom', offsets: normalizeOffsets(e.offsets) };
  });
  return rules;
}

function calendarDefaultOffsets(rules, sourceKeys) {
  return normalizeOffsets(sourceKeys.flatMap(k => {
    const c = rules.calendars[k];
    return c && c.enabled ? c.offsets : [];
  }));
}

// Event override wins over the calendar default; a global mute silences everything.
function resolveOffsets(rules, eventKey, sourceKeys) {
  if (rules.global.muted) return [];
  const override = rules.events[eventKey];
  if (override) return override.mode === 'muted' ? [] : normalizeOffsets(override.offsets);
  return calendarDefaultOffsets(rules, sourceKeys);
}

function maxConfiguredOffset(rules) {
  const all = [...Object.values(rules.calendars), ...Object.values(rules.events)].flatMap(r => r.offsets);
  return all.length ? Math.max(...all) : 0;
}

// occurrences: [{key, title, start (ms), sourceKeys}]. Returns alerts whose time has passed for events not yet started.
// When several offsets of one occurrence are due at once, only the nearest one is shown; the rest are marked superseded.
function findDueAlerts(rules, occurrences, fired, now) {
  const due = [];
  occurrences.forEach(occ => {
    if (occ.start <= now) return;
    const alerts = resolveOffsets(rules, occ.key, occ.sourceKeys)
      .map(offset => ({ id: occ.key + '|' + occ.start + '|' + offset, offset, occ }))
      .filter(a => !(a.id in fired) && occ.start - a.offset * 60000 <= now);
    alerts.forEach((a, i) => due.push({ id: a.id, offset: a.offset, occ, superseded: i < alerts.length - 1 }));
  });
  return due;
}

function formatRemaining(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  if (min >= 1440) return Math.round(min / 1440) + ' d';
  if (min >= 60) return Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
  return min + ' min';
}

function alertBody(occ, now) {
  const when = new Date(occ.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (occ.allDay ? 'All day today' : 'Starts at ' + when + ' (in ' + formatRemaining(occ.start - now) + ')') +
    (occ.location && !/^https?:/i.test(occ.location) ? ' · ' + occ.location : '');
}

// ---- ICS parsing and expansion ----
function parseIcs(text) {
  const root = new ICAL.Component(ICAL.parse(text));
  root.getAllSubcomponents('vtimezone').forEach(tz => {
    const tzid = tz.getFirstPropertyValue('tzid');
    if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(tz);
  });
  const byUid = new Map();
  root.getAllSubcomponents('vevent').forEach(c => {
    const uid = c.getFirstPropertyValue('uid') || String(Math.random());
    if (!byUid.has(uid)) byUid.set(uid, { master: null, exceptions: [] });
    const g = byUid.get(uid);
    if (c.hasProperty('recurrence-id')) g.exceptions.push(c); else g.master = c;
  });
  const events = [];
  byUid.forEach(g => {
    const base = g.master || g.exceptions.shift();
    if (!base) return;
    const ev = new ICAL.Event(base);
    g.exceptions.forEach(x => ev.relateException(new ICAL.Event(x)));
    events.push(ev);
  });
  return events;
}

function toFc(src, detail, startT, endT) {
  if (String(detail.item.component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') return null;
  const allDay = startT.isDate;
  return {
    title: detail.item.summary || '(no title)',
    start: startT.toJSDate(),
    end: endT ? endT.toJSDate() : undefined,
    allDay,
    color: src.color,
    extendedProps: {
      source: src.name,
      sourceDetails: [{ id: src.id, key: src.alertKey, name: src.name, color: src.color }],
      uid: detail.item.uid || '',
      location: detail.item.location,
      description: detail.item.description
    }
  };
}

function expand(src, rangeStart, rangeEnd) {
  const out = [];
  for (const ev of src.events) {
    if (ev.isRecurring()) {
      const it = ev.iterator();
      let next, n = 0;
      while ((next = it.next()) && n++ < MAX_OCCURRENCES) {
        const d = ev.getOccurrenceDetails(next);
        if (d.startDate.toJSDate() > rangeEnd) break;
        if (d.endDate.toJSDate() < rangeStart) continue;
        const e = toFc(src, d, d.startDate, d.endDate);
        if (e) out.push(e);
      }
    } else {
      const s = ev.startDate;
      if (!s) continue;
      const e = ev.endDate || s;
      if (s.toJSDate() > rangeEnd || e.toJSDate() < rangeStart) continue;
      const fc = toFc(src, { item: ev }, s, e);
      if (fc) out.push(fc);
    }
  }
  return out;
}

function deduplicateEvents(events) {
  const grouped = new Map();
  events.forEach(event => {
    const p = event.extendedProps;
    const start = event.start ? event.start.toISOString() : '';
    const end = event.end ? event.end.toISOString() : '';
    const key = p.uid
      ? ['uid', p.uid, start, end].join('|')
      : ['fallback', event.title, start, end, p.location || ''].join('|');
    const existing = grouped.get(key);
    if (!existing) {
      p.sources = [p.source];
      grouped.set(key, event);
    } else if (!existing.extendedProps.sources.includes(p.source)) {
      existing.extendedProps.sources.push(p.source);
    }
    if (existing) {
      p.sourceDetails.forEach(source => {
        if (!existing.extendedProps.sourceDetails.some(s => s.id === source.id)) existing.extendedProps.sourceDetails.push(source);
      });
    }
  });
  return [...grouped.values()];
}

// ---- Links ----
function readableUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (url.hostname.endsWith('.safelinks.protection.outlook.com')) {
      const target = url.searchParams.get('url');
      if (target) {
        const decoded = new URL(target);
        if (['https:', 'http:'].includes(decoded.protocol)) return decoded;
      }
    }
    return url;
  } catch { return null; }
}

function isTeamsMeeting(url) {
  return url && url.hostname === 'teams.microsoft.com' && /^\/(?:l\/meetup-join\/|meet\/)/i.test(url.pathname);
}

function findMeetingUrl(p) {
  return [...[p.description, p.location].filter(Boolean).join(' ').matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map(match => readableUrl(match[0])).find(isTeamsMeeting);
}

// Upcoming occurrences of enabled sources within the next horizonMs, ready for findDueAlerts.
function collectOccurrences(sources, now, horizonMs) {
  return deduplicateEvents(sources.filter(s => s.enabled).flatMap(s => expand(s, new Date(now), new Date(now + horizonMs))))
    .filter(e => e.start)
    .map(e => {
      const p = e.extendedProps;
      const meeting = findMeetingUrl(p);
      return {
        key: eventAlertKey(p.uid, e.title), title: e.title, start: e.start.getTime(), allDay: e.allDay,
        location: p.location, join: meeting && meeting.href,
        sourceKeys: (p.sourceDetails || []).map(s => s.key).filter(Boolean)
      };
    });
}

if (typeof module !== 'undefined') {
  module.exports = {
    MAX_OFFSET_MIN, eventAlertKey, normalizeOffsets, formatOffset, sanitizeRules, calendarDefaultOffsets, resolveOffsets,
    maxConfiguredOffset, findDueAlerts, formatRemaining, alertBody, parseIcs, expand, deduplicateEvents,
    readableUrl, isTeamsMeeting, findMeetingUrl, collectOccurrences
  };
}
