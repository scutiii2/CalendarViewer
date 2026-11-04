const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelClient, ServiceError } = require('../src/server/model-client');
const json = value => new Response(JSON.stringify(value));
test('only bare gateway failures retry; token sent only upstream', async () => {
  let calls = 0;
  const client = createModelClient({ token: 'test-only', fetch: async (url, opts) => {
    assert.equal(opts.headers['X-Internal-Token'], 'test-only');
    return ++calls < 3 ? new Response('', { status: 503 }) : json({ finish_reason: 'stop', content: 'ok' });
  }, pauseMs: 0 });
  assert.equal((await client.chat({ messages: [] })).content, 'ok'); assert.equal(calls, 3);
  calls = 0;
  const bad = createModelClient({ fetch: async () => { calls++; return new Response('{"detail":"bad input"}', { status: 502 }); } });
  await assert.rejects(bad.chat({}), e => e instanceof ServiceError && e.status === 502 && e.detail === 'bad input');
  assert.equal(calls, 1);
});
test('NDJSON handles split UTF-8, content and final done without exposing thinking', async () => {
  const bytes = new TextEncoder().encode('{"type":"thinking","text":"secret"}\n{"type":"content","text":"café"}\n{"type":"done","content":"café","finish_reason":"stop"}');
  const parts = [];
  const client = createModelClient({ fetch: async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } })) });
  assert.equal((await client.chat({ stream: true }, { onContent: s => parts.push(s) })).content, 'café');
  assert.deepEqual(parts, ['café']);
});
test('stream errors, premature EOF and invalid JSON count as failures; three latch offline', async () => {
  let calls = 0;
  const client = createModelClient({ fetch: async () => { calls++; return new Response('{"type":"content","text":"partial"}\n'); } });
  for (let i = 0; i < 3; i++) await assert.rejects(client.chat({ stream: true }), /final|ended/);
  await assert.rejects(client.health(), /offline/i); assert.equal(calls, 3);
  const error = createModelClient({ fetch: async () => new Response('{"type":"error","status":422,"detail":"wrong"}\n') });
  await assert.rejects(error.chat({ stream: true }), e => e.status === 422);
  const invalid = createModelClient({ fetch: async () => new Response('bad json') });
  await assert.rejects(invalid.health());
});
test('unreachable, health reset, caller cancellation and tools/schema exclusion', async () => {
  let fail = true;
  const client = createModelClient({ fetch: async () => { if (fail) throw new TypeError('network'); return json({ ready: true, model: 'small' }); } });
  await assert.rejects(client.health(), /unreachable/i);
  fail = false; assert.equal((await client.health()).model, 'small'); assert.equal(client.offline, false);
  await assert.rejects(client.chat({ tools: [], schema: {} }), /schema/);
  const c = new AbortController(); c.abort();
  await assert.rejects(client.health({ signal: c.signal }), e => e.name === 'AbortError');
  assert.equal(client.offline, false);
});

test('service statuses are preserved, HTTP timeout is bounded and cancellation does not open circuit', async () => {
  for (const status of [401, 422, 502, 504]) {
    let calls = 0;
    const client = createModelClient({ fetch: async () => { calls++; return new Response('{"detail":{"message":"service detail"}}', { status }); } });
    await assert.rejects(client.health(), e => e.status === status && e.detail === 'service detail');
    assert.equal(calls, 1);
  }
  const waitingFetch = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })), { once: true }));
  const timed = createModelClient({ fetch: waitingFetch, timeoutMs: 10 });
  await assert.rejects(timed.health(), /unreachable/i);
  const stopped = createModelClient({ fetch: waitingFetch });
  for (let i = 0; i < 4; i++) {
    const controller = new AbortController();
    const result = stopped.health({ signal: controller.signal }); controller.abort();
    await assert.rejects(result, e => e.name === 'AbortError');
  }
  assert.equal(stopped.offline, false);
});
