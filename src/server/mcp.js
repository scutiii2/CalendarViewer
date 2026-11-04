// MCP protocol adapter; calendar behavior lives in calendar-tools.js.
const { createCalendarTools, TOOLS } = require('./calendar-tools');
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
function createMcpHandler(options) {
  const tools = createCalendarTools(options);
  async function call(params) {
    if (!params || !TOOLS.some(t => t.name === params.name)) return { error: { code: -32602, message: 'Unknown tool.' } };
    if (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments))) return { error: { code: -32602, message: 'arguments must be an object.' } };
    try { return { result: text(await tools.execute(params.name, params.arguments)) }; }
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
