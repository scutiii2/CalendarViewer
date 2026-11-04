// Same-origin assistant routes, with independent limits and disconnect cancellation.
const { readBody, send, sendJson, SECURITY_HEADERS } = require('./http');
const { ServiceError, ServiceUnreachable } = require('./model-client');
function createAssistantRoute({ config, client, assistant, refuseUnlessLocalAction }) {
  let busy = false, lastStatus = { reachable: false, model: null };
  async function handle(req, res) {
    if (refuseUnlessLocalAction(req, res)) return;
    const statusRoute = req.url.split('?')[0] === '/api/assistant/status';
    if (statusRoute && req.method === 'GET') {
      if (config.enabled && !busy && !client.offline) {
        try { const health = await client.health(); lastStatus = { reachable: health.ready === true, model: String(health.model || '').slice(0, 120) || null }; }
        catch { lastStatus = { reachable: false, model: null }; }
      }
      return sendJson(res, 200, { enabled: config.enabled, reachable: config.enabled && !client.offline && lastStatus.reachable, model: lastStatus.model, url: config.url, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, offline: client.offline });
    }
    if (statusRoute || req.method !== 'POST') return send(res, 405, 'Use GET for status or POST for a question.');
    if (!config.enabled) return send(res, 404, 'Assistant disabled.');
    if (busy) return send(res, 429, 'Assistant is busy. Stop the current answer first.');
    let question;
    try {
      const body = JSON.parse(await readBody(req, 8192));
      question = body?.question;
      if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw new Error('invalid');
    } catch (e) { return send(res, e.status === 413 ? 413 : 400, 'Send a question of 1–2000 characters in a JSON object.'); }
    if (busy) return send(res, 429, 'Assistant is busy.');
    busy = true;
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    let pending = Promise.resolve(), queuedBytes = 0;
    const emit = value => {
      if (controller.signal.aborted || res.destroyed) return;
      const line = JSON.stringify(value) + '\n';
      const size = Buffer.byteLength(line);
      queuedBytes += size;
      if (queuedBytes > 1024 * 1024) { controller.abort(); return; }
      // A false write return is normal backpressure. Await its callback before the next write.
      pending = pending.then(() => new Promise(resolve => {
        if (controller.signal.aborted || res.destroyed) { queuedBytes -= size; resolve(); return; }
        res.write(line, error => { queuedBytes -= size; if (error) controller.abort(); resolve(); });
      })).catch(() => controller.abort());
    };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.flushHeaders();
    try { await assistant.answer(question.trim(), { emit, signal: controller.signal }); lastStatus.reachable = true; }
    catch (e) {
      if (!controller.signal.aborted) {
        const offline = e instanceof ServiceUnreachable || client.offline;
        if (offline) lastStatus.reachable = false;
        const message = offline ? 'Assistant offline. Check the local model service; after three failures restart the calendar server.' :
          e instanceof ServiceError ? `Model service error (${e.status}). Check the service and token configuration.` :
            /token|empty|calendar|limit|invalid tool/i.test(e.message) ? e.message : 'Assistant could not finish this answer. Please try again.';
        emit({ type: 'error', message, offline });
      }
    } finally { await pending; res.removeListener('close', cancel); busy = false; res.end(); }
  }
  return handle;
}
module.exports = { createAssistantRoute };
