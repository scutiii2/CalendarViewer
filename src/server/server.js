// Local server: serves the web page and fetches ICS links server-side (browsers block them via CORS).
// Feed links are stored in data/feeds.json (gitignored). Listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeJsonAtomic, readJson } = require('./json-store');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.CALENDAR_DATA_DIR || path.join(ROOT, 'data'); // the override is for tests
const FEEDS_FILE = path.join(DATA_DIR, 'feeds.json');
// Read once at start, so run.bat can tell when a running server is older than the files on disk.
const VERSION = (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } })();

fs.mkdirSync(DATA_DIR, { recursive: true });

const STATIC_ROOTS = [
  ['/shared/', path.join(ROOT, 'src', 'shared')],
  ['/vendor/', path.join(ROOT, 'vendor')],
  ['/', path.join(ROOT, 'src', 'web')]
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Only files inside the three public folders are served; anything that escapes them is refused.
function staticFile(pathname) {
  const wanted = pathname === '/' ? '/index.html' : pathname;
  for (const [prefix, dir] of STATIC_ROOTS) {
    if (!wanted.startsWith(prefix)) continue;
    const file = path.resolve(dir, decodeURIComponent(wanted.slice(prefix.length)));
    const type = TYPES[path.extname(file)];
    if (type && file.startsWith(dir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return { file, type };
    return null;
  }
  return null;
}
const { createAlertService } = require('./alerts');
const { createStartupService } = require('./startup');
const { createBackupService } = require('./backups');
const { createMcpHandler } = require('./mcp'); // after ./alerts, which defines the global ICAL

const readFeeds = () => readJson(FEEDS_FILE, []);
const writeFeeds = feeds => {
  writeJsonAtomic(FEEDS_FILE, feeds, { space: 2 });
};

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');

const readBody = (req, limit = 1e5) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', c => { data += c; if (data.length > limit) req.destroy(); });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

async function fetchFeedText(feed) {
  const r = await fetch(feed.url, { redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

const alerts = createAlertService({
  readFeeds,
  fetchText: fetchFeedText,
  stateFile: path.join(DATA_DIR, 'alerts-state.json'),
  firedFile: path.join(DATA_DIR, 'alerts-fired.json'),
  snoozeBaseUrl: `http://localhost:${PORT}`
});
const mcp = createMcpHandler({ sources: alerts.sources });
const MCP_TOKEN = process.env.INTERNAL_API_TOKEN || ''; // Citadel's shared token; when set, /mcp callers must send it as X-Internal-Token
const backups = createBackupService({ readFeeds, writeFeeds, alerts, recoveryFile: path.join(DATA_DIR, 'backup-recovery.json') });

const startup = createStartupService();

// Actions that change the machine must come from this page: block other websites and DNS rebinding.
const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
const ORIGINS = HOSTS.map(h => 'http://' + h);
const isLocalAction = req => {
  return req.headers['x-calendar-action'] === '1' && HOSTS.includes(req.headers.host) &&
    (!req.headers.origin || ORIGINS.includes(req.headers.origin));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET') {
      const asset = staticFile(url.pathname);
      if (asset) return send(res, 200, fs.readFileSync(asset.file), asset.type);
    }

    // MCP clients are not browsers: refuse any request carrying an Origin, and foreign Host headers (DNS rebinding).
    if (url.pathname === '/mcp') {
      const given = String(req.headers['x-internal-token'] || '');
      const tokenOk = !MCP_TOKEN || (given.length === MCP_TOKEN.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(MCP_TOKEN)));
      if (!HOSTS.includes(req.headers.host) || req.headers.origin || !tokenOk) return send(res, 403, 'Forbidden');
      if (req.method !== 'POST') return send(res, 405, 'Use POST');
      let message;
      try { message = JSON.parse(await readBody(req, 1e6)); }
      catch { return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }); }
      const reply = await mcp.handle(message);
      return reply === null ? send(res, 202, '') : sendJson(res, 200, reply);
    }

    if (url.pathname === '/api/version' && req.method === 'GET') return sendJson(res, 200, { version: VERSION });

    if (url.pathname.startsWith('/api/backup/')) {
      if (!isLocalAction(req)) return send(res, 403, 'Forbidden');
      try {
        if (url.pathname === '/api/backup/export' && req.method === 'POST') return sendJson(res, 200, backups.exportBackup(JSON.parse(await readBody(req, 42e6))));
        if (url.pathname === '/api/backup/restore' && req.method === 'POST') return sendJson(res, 200, backups.restoreBackup(JSON.parse(await readBody(req, 42e6))));
        if (url.pathname === '/api/backup/recovery' && req.method === 'GET') return sendJson(res, 200, backups.recoveryBackup());
      } catch (e) { return send(res, 400, e.message); }
    }

    if (url.pathname === '/api/alerts/snooze' && req.method === 'POST') {
      if (!isLocalAction(req)) return send(res, 403, 'Forbidden');
      try { return sendJson(res, 200, await alerts.snooze(JSON.parse(await readBody(req)))); }
      catch (e) { return send(res, 400, e.message); }
    }
    const snoozeAction = url.pathname.match(/^\/alerts\/snooze\/([a-f0-9]{48})$/);
    if (snoozeAction && req.method === 'GET') {
      if (!HOSTS.includes(req.headers.host)) return send(res, 403, 'Forbidden');
      try {
        await alerts.snoozeTicket(snoozeAction[1]);
        res.setHeader('Referrer-Policy', 'no-referrer');
        return send(res, 200, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Reminder snoozed</title><h1>Reminder snoozed for 5 minutes</h1><p>You can close this tab. The background server will send the reminder.</p><a href="/">Open calendar</a></html>', 'text/html; charset=utf-8');
      } catch (e) { return send(res, 400, e.message); }
    }

    if (url.pathname === '/api/startup') {
      if (req.method === 'GET') return sendJson(res, 200, startup.status());
      if (req.method === 'POST') {
        if (!isLocalAction(req)) return send(res, 403, 'Forbidden');
        const { enabled } = JSON.parse(await readBody(req));
        return sendJson(res, 200, await startup.set(!!enabled));
      }
    }

    if (url.pathname === '/api/alerts/status' && req.method === 'GET') return sendJson(res, 200, alerts.status());
    if (url.pathname === '/api/alerts/state' && req.method === 'POST') {
      alerts.setState(JSON.parse(await readBody(req, 2e7)));
      return sendJson(res, 200, alerts.status());
    }

    if (url.pathname === '/api/feeds') {
      if (req.method === 'GET') {
        return sendJson(res, 200, readFeeds().map(({ id, name, color }) => ({ id, name, color })));
      }
      if (req.method === 'POST') {
        const { name, url: link, color } = JSON.parse(await readBody(req));
        const href = String(link || '').trim().replace(/^webcal:/i, 'https:');
        if (!/^https?:\/\//i.test(href)) return send(res, 400, 'Link must start with https:// or webcal://');
        const feed = { id: crypto.randomUUID(), name: String(name || 'Calendar').trim(), color, url: href };
        writeFeeds([...readFeeds(), feed]);
        return sendJson(res, 201, { id: feed.id, name: feed.name, color: feed.color });
      }
    }

    const m = url.pathname.match(/^\/api\/(feeds|ics)\/([\w-]+)$/);
    if (m) {
      const feeds = readFeeds();
      const feed = feeds.find(f => f.id === m[2]);
      if (!feed) return send(res, 404, 'Unknown feed');
      if (m[1] === 'feeds' && req.method === 'DELETE') {
        writeFeeds(feeds.filter(f => f.id !== feed.id));
        return send(res, 204, '');
      }
      if (m[1] === 'ics' && req.method === 'GET') {
        try { return send(res, 200, await fetchFeedText(feed), 'text/calendar; charset=utf-8'); }
        catch (e) { return send(res, 502, /^HTTP \d+$/.test(e.message) ? `Upstream returned ${e.message}` : e.message); }
      }
    }

    send(res, 404, 'Not found');
  } catch (e) {
    send(res, 500, e.message);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`ICS viewer: http://localhost:${PORT}`);
  alerts.start();
});
