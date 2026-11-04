// Dependency-free MiniCPM transport. No request bodies or credentials are logged.
class ServiceError extends Error {
  constructor(status, detail = '') { super(`Model service error (${status})${detail ? ': ' + detail : ''}`); this.status = status; this.detail = detail; }
}
class ServiceUnreachable extends Error {
  constructor(message = 'Model service unreachable.') { super(message); }
}
const detailText = value => String(typeof value === 'object' && value ? value.message || '' : value || '').slice(0, 200);
async function readReply(response, streaming, onContent) {
  const reader = response.body?.getReader();
  if (!reader) throw new ServiceUnreachable('Model stream ended before final reply.');
  const decoder = new TextDecoder(); let buffer = '', bytes = 0, done;
  const line = raw => {
    if (!raw.trim()) return;
    const item = JSON.parse(raw);
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid model reply.');
    if (item.type === 'error') throw new ServiceError(item.status || 502, detailText(item.detail || item.message));
    if (item.type === 'content' && typeof item.text === 'string') onContent(item.text);
    if (item.type === 'done' || item.type === undefined) done = item;
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 256 * 1024) throw new Error('Model response too large.');
      buffer += decoder.decode(chunk.value, { stream: true });
      if (streaming) {
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, index)); buffer = buffer.slice(index + 1); if (done) return done; }
      }
    }
    buffer += decoder.decode();
    line(buffer);
    if (!done) throw new ServiceUnreachable('Model stream ended before final reply.');
    return done;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function createModelClient({ url = 'http://127.0.0.1:9130', token = '', fetch: fetchImpl = global.fetch, timeoutMs = 90000, pauseMs = 250 } = {}) {
  let failures = 0;
  async function request(path, payload, { signal, onContent = () => {}, deadlineMs = timeoutMs } = {}) {
    if (failures >= 3) throw new ServiceUnreachable('Assistant offline until the calendar server restarts.');
    signal?.throwIfAborted();
    const abort = new AbortController();
    const cancel = () => abort.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => abort.abort(), deadlineMs);
    try {
      for (let attempt = 0; ; attempt++) {
        let response;
        try {
          response = await fetchImpl(url + path, { method: payload ? 'POST' : 'GET', redirect: 'error', signal: abort.signal,
            headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Internal-Token': token } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
        } catch (e) { if (signal?.aborted) throw e; throw new ServiceUnreachable(); }
        if (!response.ok) {
          let detail = '';
          try { detail = detailText((await readReply(response, false, () => {})).detail); } catch { /* bare gateway */ }
          if ([502, 503, 504].includes(response.status) && !detail && attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, pauseMs));
            abort.signal.throwIfAborted(); continue;
          }
          throw new ServiceError(response.status, detail);
        }
        const reply = await readReply(response, !!payload?.stream, onContent);
        failures = 0; return reply;
      }
    } catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
      failures++;
      throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  return {
    get offline() { return failures >= 3; },
    health: options => request('/health', undefined, { deadlineMs: Math.min(timeoutMs, 3000), ...options }),
    chat: (payload, options) => {
      if (payload.tools !== undefined && payload.schema !== undefined) return Promise.reject(new Error('tools and schema cannot be combined.'));
      return request('/v1/chat', payload, options);
    }
  };
}
module.exports = { createModelClient, ServiceError, ServiceUnreachable };
