const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const L = require('../src/shared/alert-logic.js');

const M = 60000, now = 1e12;
const rules = o => L.sanitizeRules(o);
const occ = start => ({ key: 'k', title: 't', start, sourceKeys: ['a'] });

test('normalizeOffsets keeps valid whole minutes, sorted and unique', () => {
  assert.deepEqual(L.normalizeOffsets([5, '15', 15, 0, -1, 1.5, 99999999]), [15, 5]);
});

test('formatOffset picks the largest exact unit', () => {
  assert.equal(L.formatOffset(1), '1 minute before');
  assert.equal(L.formatOffset(120), '2 hours before');
  assert.equal(L.formatOffset(1440), '1 day before');
});

test('calendar defaults combine, skipping disabled calendars', () => {
  const r = rules({ calendars: { a: { enabled: true, offsets: [15] }, b: { enabled: true, offsets: [60] }, c: { enabled: false, offsets: [5] } } });
  assert.deepEqual(L.resolveOffsets(r, 'e', ['a', 'b', 'c']), [60, 15]);
});

test('an event override replaces the calendar default; mute silences it', () => {
  const r = rules({ calendars: { a: { enabled: true, offsets: [15] } } });
  r.events.e = { mode: 'custom', offsets: [10] };
  assert.deepEqual(L.resolveOffsets(r, 'e', ['a']), [10]);
  r.events.e = { mode: 'muted', offsets: [] };
  assert.deepEqual(L.resolveOffsets(r, 'e', ['a']), []);
});

test('global mute silences everything', () => {
  const r = rules({ global: { muted: true }, calendars: { a: { enabled: true, offsets: [15] } } });
  assert.deepEqual(L.resolveOffsets(r, 'x', ['a']), []);
});

test('maxConfiguredOffset is the largest offset in any rule', () => {
  assert.equal(L.maxConfiguredOffset(rules({ calendars: { a: { offsets: [15, 90] } } })), 90);
});

test('findDueAlerts fires once the offset has passed and the event has not started', () => {
  const r = rules({ calendars: { a: { enabled: true, offsets: [15] } } });
  assert.equal(L.findDueAlerts(r, [occ(now + 20 * M)], {}, now).length, 0);
  assert.equal(L.findDueAlerts(r, [occ(now - M)], {}, now).length, 0);
  const due = L.findDueAlerts(r, [occ(now + 10 * M)], {}, now);
  assert.equal(due.length, 1);
  assert.equal(L.findDueAlerts(r, [occ(now + 10 * M)], { [due[0].id]: 1 }, now).length, 0);
});

test('when several offsets are due only the nearest is shown', () => {
  const r = rules({ calendars: { a: { enabled: true, offsets: [60, 15] } } });
  const due = L.findDueAlerts(r, [occ(now + 10 * M)], {}, now);
  assert.deepEqual(due.map(d => [d.offset, d.superseded]), [[60, true], [15, false]]);
});

test('pickUpNext returns the next non-cancelled events that have not started', () => {
  const o = (title, mins) => ({ title, start: now + mins * M });
  const list = [o('Later', 90), o('Started', -5), o('Canceled: Sync', 10), o('cancelled weekly', 20), o('Soon', 15), o('Middle', 45), o('Last', 200)];
  assert.deepEqual(L.pickUpNext(list, now).map(e => e.title), ['Soon', 'Middle', 'Later']);
  assert.deepEqual(L.pickUpNext(list, now, 1).map(e => e.title), ['Soon']);
  assert.deepEqual(L.pickUpNext([], now), []);
});
