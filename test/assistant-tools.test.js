const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const { resolveDateRange } = require('../src/shared/assistant-dates');
const { findFreeTime } = require('../src/shared/free-time');
const { createCalendarTools, TOOLS } = require('../src/server/calendar-tools');
const now = new Date(2026, 10, 4, 8).getTime();

test('relative dates use calendar days, weekdays and Monday weeks', () => {
  const [thu, fri] = resolveDateRange('thursday', undefined, now);
  assert.equal(thu.getDate(), 5); assert.equal(fri.getDate(), 6);
  const [mon, end] = resolveDateRange('next week', undefined, now);
  assert.equal(mon.getDate(), 9); assert.equal(end.getDate(), 16);
  assert.equal(resolveDateRange('today', undefined, now)[0].getHours(), 0);
  for (const date of ['2026-02-30', 'garbage', '2026-13-01']) assert.throws(() => resolveDateRange(date, undefined, now));
  assert.throws(() => resolveDateRange('2026-01-01', '2027-01-01', now));
  assert.throws(() => resolveDateRange('today', 'today', now));
});

test('free time unions busy events, clips range, respects all-day and excludes the past', () => {
  const d = h => new Date(2026, 10, 4, h);
  const events = [{ start: d(9), end: d(10) }, { start: d(9), end: d(11) }, { start: d(12), end: d(13) }];
  const slots = findFreeTime(events, [d(0), new Date(2026, 10, 5)], 60, {}, d(10).getTime());
  assert.equal(slots[0].start, d(11).toISOString());
  assert.equal(slots[1].start, d(13).toISOString());
  assert.equal(findFreeTime([{ start: d(0), end: new Date(2026, 10, 5), allDay: true }], [d(0), new Date(2026, 10, 5)], 60, {}, now).length, 0);
  assert.throws(() => findFreeTime([], [d(0), d(23)], 0, {}, now));
  assert.throws(() => findFreeTime([], [d(0), d(23)], 60, { start: '29:00' }, now));
  const night = findFreeTime([], [d(0), new Date(2026, 10, 5, 6)], 60, { start: '22:00', end: '06:00' }, now);
  assert.equal(night[0].start, d(22).toISOString());
});

test('shared tools validate flat arguments and expose assistant-only availability', async () => {
  const tools = createCalendarTools({ sources: async () => [], now: () => now });
  assert.equal(TOOLS.length, 5);
  assert.equal((await tools.execute('list_events', { start: 'thursday' })).events.length, 0);
  assert.ok((await tools.execute('find_free_time', { start: 'this week', minutes: 60 })).slots.length);
  for (const [name, args] of [['list_events', { query: {} }], ['up_next', { limit: '2' }], ['list_events', { unexpected: 1 }], ['toString', {}]]) {
    await assert.rejects(tools.execute(name, args));
  }
});
