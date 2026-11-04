const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAssistantRoute } = require('../src/server/assistant-route');

async function fixture(t, enabled = true, answer) {
  let healthCalls = 0;
  const route = createAssistantRoute({ config: { enabled, url: 'http://127.0.0.1:9130' }, client: { offline: false, health: async () => { healthCalls++; return { ready: true, model: 'fake' }; } },
    assistant: { answer: answer || (async (q, { emit }) => { emit({ type: 'content', text: 'hello' }); emit({ type: 'done' }); }) },
    refuseUnlessLocalAction(req, res) {
      if (req.headers['x-calendar-action'] === '1' && req.headers.host === `127.0.0.1:${server.address().port}` && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)) return false;
      res.writeHead(403).end('Forbidden'); return true;
    } });
  const server = http.createServer((req, res) => route(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = async (path, options = {}) => {
    if (options.headers?.Host) return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method: options.method || 'GET', headers: { 'X-Calendar-Action': '1', ...options.headers } }, res => { res.resume(); resolve({ status: res.statusCode }); });
      req.on('error', reject); req.end(options.body);
    });
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options, headers: { 'X-Calendar-Action': '1', ...options.headers } });
  };
  return { request, healthCalls: () => healthCalls };
}
test('assistant route refuses foreign origin/host and missing action header', async t => {
  const { request } = await fixture(t);
  for (const headers of [{ Origin: 'https://evil.example' }, { Host: 'evil.example' }, { 'X-Calendar-Action': '' }]) {
    for (const [path, method] of [['/api/assistant/status', 'GET'], ['/api/assistant', 'POST']]) assert.equal((await request(path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) })).status, 403);
  }
});
test('disabled route makes no model calls; enabled status and stream work', async t => {
  const off = await fixture(t, false);
  assert.equal((await (await off.request('/api/assistant/status')).json()).enabled, false);
  assert.equal((await off.request('/api/assistant', { method: 'POST', body: '{"question":"x"}' })).status, 404);
  assert.equal(off.healthCalls(), 0);
  const on = await fixture(t);
  assert.equal((await (await on.request('/api/assistant/status')).json()).model, 'fake');
  const response = await on.request('/api/assistant', { method: 'POST', body: '{"question":"Thursday?"}' });
  assert.match(response.headers.get('content-type'), /ndjson/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await response.text(), /"type":"done"/);
});
test('invalid/oversized bodies and unsupported methods are rejected', async t => {
  const { request } = await fixture(t);
  for (const body of ['{', '{}', '{"question":4}', '{"question":""}', JSON.stringify({ question: 'x'.repeat(2001) })]) assert.equal((await request('/api/assistant', { method: 'POST', body })).status, 400);
  assert.equal((await request('/api/assistant', { method: 'POST', body: 'x'.repeat(9000) })).status, 413);
  assert.equal((await request('/api/assistant')).status, 405);
});
test('busy requests are refused and disconnect aborts upstream work', async t => {
  let aborted; const didAbort = new Promise(resolve => { aborted = resolve; });
  const { request } = await fixture(t, true, async (q, { emit, signal }) => {
    emit({ type: 'content', text: 'starting' });
    await new Promise(resolve => signal.addEventListener('abort', () => { aborted(); resolve(); }, { once: true }));
  });
  const controller = new AbortController();
  const response = await request('/api/assistant', { method: 'POST', body: '{"question":"x"}', signal: controller.signal });
  assert.equal((await request('/api/assistant', { method: 'POST', body: '{"question":"y"}' })).status, 429);
  controller.abort(); await didAbort;
  assert.equal(response.status, 200);
});

test('normal stream backpressure preserves larger source records and final done', async t => {
  const { request } = await fixture(t, true, async (q, { emit, signal }) => {
    for (let i = 0; i < 10; i++) emit({ type: 'sources', data: 'x'.repeat(12000) });
    assert.equal(signal.aborted, false);
    emit({ type: 'content', text: 'Finished' }); emit({ type: 'done' });
  });
  const response = await request('/api/assistant', { method: 'POST', body: '{"question":"x"}' });
  const body = await response.text();
  assert.equal(body.split('\n').filter(s => s.includes('"type":"sources"')).length, 10);
  assert.match(body, /"type":"done"/);
});

test('real server wiring shares calendar data, protects routes and tolerates model outage', async t => {
  const { spawn } = require('node:child_process');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const bodies = [];
  const fake = http.createServer((req, res) => {
    if (req.url === '/health') return res.end(JSON.stringify({ ready: true, model: 'fake-local' }));
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      const payload = JSON.parse(body); bodies.push(payload);
      const result = payload.messages.at(-1);
      if (result.role === 'user') return res.end(JSON.stringify({ type: 'done', finish_reason: 'tool_calls', tool_calls: [{ name: 'list_events', arguments: { start: '2026-11-05' } }] }) + '\n');
      const data = JSON.parse(result.content).untrusted_data;
      res.end(JSON.stringify({ type: 'content', text: data.events[0].title }) + '\n' + JSON.stringify({ type: 'done', content: data.events[0].title, finish_reason: 'stop' }) + '\n');
    });
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => { fake.closeAllConnections(); fake.close(); });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-integration-'));
  const child = spawn(process.execPath, [path.resolve('src/server/server.js')], { env: { ...process.env, PORT: '3992', CALENDAR_BIND: '127.0.0.1', CALENDAR_ASSISTANT_ENABLED: '1', MINICPM_URL: `http://127.0.0.1:${fake.address().port}`, MINICPM_TOKEN: '', CALENDAR_DATA_DIR: dataDir }, stdio: 'pipe' });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('ICS viewer')) resolve(); }); child.on('error', reject); child.on('exit', code => reject(new Error('Server exited ' + code))); });
  const request = (route, method = 'GET', body, extra = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 3992, path: route, method, headers: { 'X-Calendar-Action': '1', ...extra } }, res => { let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text })); });
    req.on('error', reject); req.end(body);
  });
  for (const headers of [{ Host: 'evil.example' }, { Origin: 'https://evil.example' }, { 'X-Calendar-Action': '' }]) assert.equal((await request('/api/assistant/status', 'GET', undefined, headers)).status, 403);
  assert.equal(JSON.parse((await request('/api/assistant/status')).text).model, 'fake-local');
  const icsText = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\nBEGIN:VEVENT\r\nUID:test-only\r\nDTSTART:20261105T090000Z\r\nDTEND:20261105T100000Z\r\nSUMMARY:Test meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  assert.equal((await request('/api/alerts/state', 'POST', JSON.stringify({ sources: [{ alertKey: 'l:test', name: 'Test calendar', enabled: true, icsText }], rules: {} }))).status, 200);
  const stream = await request('/api/assistant', 'POST', JSON.stringify({ question: 'What is on my plate Thursday?' }));
  assert.equal(stream.status, 200); assert.match(stream.text, /Test meeting/); assert.match(stream.text, /"type":"done"/);
  assert.equal(bodies.length, 2);
  assert.equal((await request('/api/assistant', 'POST', 'x'.repeat(9000))).status, 413);
  await new Promise(resolve => { fake.closeAllConnections(); fake.close(resolve); });
  assert.equal(JSON.parse((await request('/api/assistant/status')).text).reachable, false);
  assert.equal((await request('/api/health')).status, 200);
});
