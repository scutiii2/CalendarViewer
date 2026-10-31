// Read-only MCP server (JSON-RPC over streamable HTTP, POST /mcp) so Citadel's armory can bind it as an extension.
// Needs a global ICAL before alert-logic loads; alerts.js sets it, so require this file after alerts.js.
const logic = require('../shared/alert-logic.js');
const Search = require('../shared/search.js');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const { DAY_MS } = logic;
const MAX_SPAN_MS = 93 * DAY_MS;
const MAX_EVENTS = 200;
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
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

function createMcpHandler({ sources, now = Date.now }) {
  function range(args, defaultFrom = now(), defaultSpan = 7 * DAY_MS) {
    const start = args.start === undefined ? defaultFrom : Date.parse(args.start);
    const end = args.end === undefined ? start + defaultSpan : Date.parse(args.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail('start and end must be ISO 8601 dates with end after start.');
    if (end - start > MAX_SPAN_MS) fail('The range may be at most 93 days.');
    return [new Date(start), new Date(end)];
  }
  const merged = (list, from, to) => logic.markConflicts(logic.deduplicateEvents(list.filter(s => s.enabled).flatMap(s => logic.expand(s, from, to))))
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
      return logic.pickUpNext(logic.collectOccurrences(await sources(), t, 7 * DAY_MS), t, limit).map(o => ({
        title: o.title, start: new Date(o.start).toISOString(), allDay: !!o.allDay, location: o.location || '',
        calendars: o.sourceDetails.map(s => s.name), meetingUrl: o.join || null
      }));
    },
    async conflicts(args) {
      const [from, to] = range(args);
      return merged(await sources(), from, to).filter(e => e.extendedProps.conflicts.length).slice(0, MAX_EVENTS).map(summary);
    }
  };

  async function call(params) {
    const handler = params && Object.hasOwn(handlers, params.name) && handlers[params.name];
    if (!handler) return { error: { code: -32602, message: 'Unknown tool.' } };
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: { code: -32602, message: 'arguments must be an object.' } };
    try { return { result: text(await handler(args)) }; }
    catch (e) { return { result: { ...text(e.tool ? e.message : 'Tool failed: ' + e.message), isError: true } }; }
  }

  // Returns the JSON-RPC response, or null when the message is a notification.
  async function handleOne(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } };
    }
    const { id, method, params } = message;
    if (id === undefined) return null;
    let outcome;
    if (method === 'initialize') {
      const wanted = params && params.protocolVersion;
      outcome = { result: { protocolVersion: PROTOCOLS.includes(wanted) ? wanted : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: 'ics-calendar-viewer', version: '1' } } };
    } else if (method === 'ping') outcome = { result: {} };
    else if (method === 'tools/list') outcome = { result: { tools: TOOLS } };
    else if (method === 'tools/call') outcome = await call(params);
    else outcome = { error: { code: -32601, message: 'Method not found.' } };
    return { jsonrpc: '2.0', id, ...outcome };
  }

  async function handle(message) {
    if (!Array.isArray(message)) return handleOne(message);
    const replies = (await Promise.all(message.map(handleOne))).filter(Boolean);
    return replies.length ? replies : null;
  }

  return { handle };
}

module.exports = { createMcpHandler };
