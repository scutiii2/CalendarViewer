const test = require('node:test');
const assert = require('node:assert/strict');
global.ICAL = require('../vendor/ical.min.js');
const { resolveDateRange } = require('../src/shared/assistant-dates');
const { findFreeTime } = require('../src/shared/free-time');
const { createCalendarTools, TOOLS } = require('../src/server/calendar-tools');
const logic = require('../src/shared/alert-logic');
const { createMcpHandler } = require('../src/server/mcp');
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

test('shared ranges exclude touching boundaries and cancelled titles', async () => {
  const events = [
    ['before', 'Before', '20261104T230000Z', '20261105T000000Z'],
    ['during', 'During', '20261105T090000Z', '20261105T100000Z'],
    ['after', 'After', '20261106T000000Z', '20261106T010000Z'],
    ['cancel', 'Cancelled: no meeting', '20261105T110000Z', '20261105T120000Z']
  ].flatMap(([uid, title, start, end]) => ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + title, 'DTSTART:' + start, 'DTEND:' + end, 'END:VEVENT']);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', ...events, 'END:VCALENDAR'].join('\r\n');
  const tools = createCalendarTools({ sources: async () => [{ alertKey: 'l:test', name: 'Test', enabled: true, events: logic.parseIcs(ics) }], now: () => now });
  const result = await tools.execute('list_events', { start: '2026-11-05T00:00:00Z', end: '2026-11-06T00:00:00Z' });
  assert.deepEqual(result.events.map(e => e.uid), ['during']);
  await assert.rejects(tools.execute('list_events', { start: '2026-02-20T00:00:00Z', end: '2026-02-30T00:00:00Z' }));
});

test('MCP retains its seven-day default for ISO date-only starts', async () => {
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', 'BEGIN:VEVENT', 'UID:nextday', 'SUMMARY:Next day', 'DTSTART:20261106T090000Z', 'DTEND:20261106T100000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const mcp = createMcpHandler({ sources: async () => [{ alertKey: 'l:test', name: 'Test', enabled: true, events: logic.parseIcs(ics) }], now: () => now });
  const response = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_events', arguments: { start: '2026-11-05' } } });
  assert.equal(JSON.parse(response.result.content[0].text).events[0].uid, 'nextday');
});

test('free time supports overnight carry-in, touching meetings, weekends and slot cap', () => {
  const d = (day, hour) => new Date(2026, 10, day, hour);
  const slots = findFreeTime([{ start: d(4, 9), end: d(4, 10) }, { start: d(4, 10), end: d(4, 11) }], [d(4, 9), d(4, 12)], 60, {}, d(4, 0));
  assert.equal(slots.length, 1); assert.equal(slots[0].start, d(4, 11).toISOString());
  const night = findFreeTime([], [d(5, 0), d(5, 6)], 60, { start: '22:00', end: '06:00' }, d(5, 0));
  assert.equal(night[0].start, d(5, 0).toISOString());
  assert.equal(findFreeTime([], [d(7, 0), d(9, 0)], 60, {}, d(7, 0)).length, 0);
  assert.equal(findFreeTime([], [d(4, 0), new Date(2027, 0, 1)], 60, {}, now).length, 20);
});
