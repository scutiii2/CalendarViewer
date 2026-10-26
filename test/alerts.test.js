const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createAlertService } = require('../src/server/alerts.js');

const M = 60000;
const fmt = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const ics = (uid, title, start) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${fmt(start)}\r\nDTEND:${fmt(start + 3600000)}\r\nSUMMARY:${title}\r\nDESCRIPTION:https://teams.microsoft.com/l/meetup-join/abc\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

function setup(feedStart) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-'));
  const files = { stateFile: path.join(dir, 's.json'), firedFile: path.join(dir, 'f.json') };
  const clock = { t: Date.UTC(2030, 0, 1, 9, 0, 0) };
  const shown = [];
  const feedAt = clock.t + feedStart; // fixed, so later refetches see the same event
  const options = {
    readFeeds: () => [{ id: 'F1', name: 'Work', color: '#2563eb' }],
    fetchText: async () => ics('feed-1', 'Feed meeting', feedAt),
    notify: (occ, body, done) => { shown.push({ title: occ.title, body, join: occ.join }); done(null); },
    now: () => clock.t, log: () => {}, ...files
  };
  // setState starts a background tick; wait twice so the one we asked for has completed.
  const settle = async svc => { await svc.tick(); await svc.tick(); };
  return { svc: createAlertService(options), options, clock, shown, settle };
}

test('feed alert fires once at the offset and never twice', async () => {
  const { svc, clock, shown, settle } = setup(20 * M);
  svc.setState({ rules: { calendars: { 'f:F1': { enabled: true, offsets: [15] } } }, sources: [{ alertKey: 'f:F1', name: 'Work', enabled: true }] });
  await settle(svc);
  assert.equal(shown.length, 0, '20 minutes away, 15 minute offset');
  clock.t += 6 * M; await settle(svc);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Feed meeting');
  assert.equal(new URL(shown[0].join).hostname, 'teams.microsoft.com');
  clock.t += M; await settle(svc);
  assert.equal(shown.length, 1);
});

test('editing rules marks already-past alerts silently', async () => {
  const { svc, clock, shown, settle } = setup(60 * M);
  const local = { alertKey: 'l:x', name: 'Local', enabled: true, icsText: ics('loc-1', 'Local thing', clock.t + 5 * M) };
  svc.setState({ rules: { calendars: { 'l:x': { enabled: true, offsets: [60] } } }, sources: [local] });
  await settle(svc);
  assert.equal(shown.length, 0);
});

test('muted events and disabled calendars stay silent', async () => {
  const { svc, clock, shown, settle } = setup(600 * M);
  svc.setState({ rules: { calendars: { 'l:x': { enabled: true, offsets: [60] } }, events: { 'loc-2': { mode: 'muted' } } },
    sources: [{ alertKey: 'l:x', name: 'Local', enabled: true, icsText: ics('loc-2', 'Muted', clock.t + 40 * M) }] });
  await settle(svc);
  svc.setState({ rules: { calendars: { 'l:y': { enabled: true, offsets: [60] } } },
    sources: [{ alertKey: 'l:y', name: 'Hidden', enabled: false, icsText: ics('h-1', 'Hidden', clock.t + 30 * M) }] });
  await settle(svc);
  assert.equal(shown.length, 0);
});

test('fired alerts and rules survive a restart', async () => {
  const { svc, options, clock, shown, settle } = setup(20 * M);
  svc.setState({ rules: { calendars: { 'f:F1': { enabled: true, offsets: [15] } } }, sources: [{ alertKey: 'f:F1', name: 'Work', enabled: true }] });
  clock.t += 6 * M; await settle(svc);
  assert.equal(shown.length, 1);
  const again = createAlertService({ ...options, notify: () => assert.fail('alert fired again after restart') });
  await settle(again);
});
