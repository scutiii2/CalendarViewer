// Shared read-only definitions and handlers for MCP and the local assistant.
const logic = require('../shared/alert-logic.js');
const Search = require('../shared/search.js');

const { resolveDateRange } = require('../shared/assistant-dates');
const { findFreeTime } = require('../shared/free-time');
const { DAY_MS, WEEK_MS } = logic;
const MAX_SPAN_MS = 93 * DAY_MS;
const MAX_EVENTS = 200;
const fail = message => { throw Object.assign(new Error(message), { tool: true }); };

const RANGE = {
  start: { type: 'string', description: 'ISO 8601 start of the range. Default: now.' },
  end: { type: 'string', description: 'ISO 8601 end of the range. Default: 7 days after start. At most 93 days.' }
};
const TOOLS = [
  { name: 'list_calendars', description: 'List the linked and imported calendars with their visibility and event counts.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_events', description: 'List events in a date range, merged across calendars and with overlaps marked. Cancelled events are left out.',
    inputSchema: { type: 'object', properties: { ...RANGE, query: { type: 'string', description: 'Only events whose title or location contains this text.' } } } },
  { name: 'get_event', description: 'Get full details of one event by uid (description, location, meeting link, occurrences in the range). Default range: 30 days back to 60 days ahead.',
    inputSchema: { type: 'object', properties: { uid: { type: 'string' }, ...RANGE }, required: ['uid'] } },
  { name: 'up_next', description: 'The next upcoming events within 7 days, soonest first.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Default 3.' } } } },
  { name: 'conflicts', description: 'Timed events that overlap another event in a date range.', inputSchema: { type: 'object', properties: RANGE } }
].map(tool => ({ ...tool, annotations: { readOnlyHint: true } }));

function createCalendarTools({ sources, now = Date.now }) {
  function range(args, defaultFrom = now(), defaultSpan = WEEK_MS) {
    if (args.start !== undefined && !/^\d{4}-\d{2}-\d{2}T/.test(args.start)) return resolveDateRange(args.start, args.end, now());
    const start = args.start === undefined ? defaultFrom : +require('../shared/assistant-dates').resolveDate(args.start, now());
    const end = args.end === undefined ? start + defaultSpan : Date.parse(args.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail('start and end must be ISO 8601 dates with end after start.');
    if (end - start > MAX_SPAN_MS) fail('The range may be at most 93 days.');
    return [new Date(start), new Date(end)];
  }
  const merged = (list, from, to) => logic.markConflicts(logic.expandSources(list, from, to))
    .sort((a, b) => a.start - b.start);
  const summary = e => {
    const p = e.extendedProps;
    return { uid: p.uid, title: e.title, start: e.start.toISOString(), end: e.end && e.end.toISOString(), allDay: e.allDay,
      location: p.location || '', calendars: p.sources, overlapsWith: p.conflicts };
  };

  const handlers = {
    async list_calendars() {
      return (await sources()).map(s => ({ name: s.name, kind: s.alertKey.startsWith('f:') ? 'link' : 'imported', enabled: s.enabled, events: s.events.length }));
    },
    async list_events(args) {
      const [from, to] = range(args);
      const events = merged(await sources(), from, to).filter(e => Search.matches(e, args.query));
      return { total: events.length, events: events.slice(0, MAX_EVENTS).map(summary) };
    },
    async get_event(args) {
      if (typeof args.uid !== 'string' || !args.uid) fail('uid is required.');
      const [from, to] = range(args, now() - 30 * DAY_MS, 90 * DAY_MS);
      const found = merged(await sources(), from, to).filter(e => e.extendedProps.uid === args.uid);
      if (!found.length) fail('No event with that uid in the range.');
      const p = found[0].extendedProps, meeting = logic.findMeetingUrl(p);
      return { ...summary(found[0]), description: p.description || '', meetingUrl: meeting ? meeting.href : null,
        occurrences: found.slice(0, 20).map(e => ({ start: e.start.toISOString(), end: e.end && e.end.toISOString() })) };
    },
    async up_next(args) {
      const limit = args.limit === undefined ? 3 : args.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) fail('limit must be an integer from 1 to 20.');
      const t = now();
      return logic.upNext(await sources(), t, limit).map(o => ({
        title: o.title, start: new Date(o.start).toISOString(), allDay: !!o.allDay, location: o.location || '',
        calendars: o.sourceDetails.map(s => s.name), meetingUrl: o.join || null
      }));
    },
    async conflicts(args) {
      const [from, to] = range(args);
      return merged(await sources(), from, to).filter(e => e.extendedProps.conflicts.length).slice(0, MAX_EVENTS).map(summary);
    }
  };


  async function execute(name, args = {}) {
    const definition = ASSISTANT_TOOLS.find(t => t.name === name);
    if (!definition) fail('Unknown tool.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('arguments must be an object.');
    for (const [key, value] of Object.entries(args)) {
      const schema = definition.inputSchema.properties[key];
      if (!schema || (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type)) fail('Invalid argument: ' + key);
      if (typeof value === 'string' && value.length > 2000) fail('Argument too long.');
    }
    for (const key of definition.inputSchema.required || []) if (args[key] === undefined) fail(key + ' is required.');
    if (name === 'find_free_time') {
      const dates = resolveDateRange(args.start || 'this week', args.end, now());
      const events = merged(await sources(), ...dates);
      return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, slots: findFreeTime(events, dates, args.minutes, { start: args.work_start, end: args.work_end }, now()) };
    }
    return handlers[name](args);
  }
  return { execute, definitions: ASSISTANT_TOOLS };
}
const ASSISTANT_TOOLS = [...TOOLS, { name: 'find_free_time', description: 'Find available time, computed by code. Default weekdays 09:00–17:00; range may be today, thursday, this week, next week or ISO dates. Ends are exclusive.', inputSchema: { type: 'object', properties: { ...RANGE, minutes: { type: 'integer' }, work_start: { type: 'string' }, work_end: { type: 'string' } }, required: ['minutes'] }, annotations: { readOnlyHint: true } }];
module.exports = { createCalendarTools, TOOLS, ASSISTANT_TOOLS };
