// Local server: serves the web page and fetches ICS links server-side (browsers block them via CORS).
// Feed links are stored in data/feeds.json (gitignored). Listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.CALENDAR_DATA_DIR || path.join(ROOT, 'data'); // the override is for tests
const FEEDS_FILE = path.join(DATA_DIR, 'feeds.json');
// Read once at start, so run.bat can tell when a running server is older than the files on disk.
const VERSION = (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } })();

// Earlier versions kept runtime files in the application root. Move them once; never overwrite or lose data.
function migrateData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (process.env.CALENDAR_DATA_DIR) return;
  for (const name of ['feeds.json', 'alerts-state.json', 'alerts-fired.json']) {
    const from = path.join(ROOT, name), to = path.join(DATA_DIR, name);
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) { console.log(`Both ${name} and data/${name} exist; leaving the old one in place.`); continue; }
    fs.copyFileSync(from, to);
    if (fs.statSync(to).size === fs.statSync(from).size) fs.unlinkSync(from);
  }
}
migrateData();

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

const readFeeds = () => {
  try { return JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf8')); } catch { return []; }
};
const writeFeeds = feeds => fs.writeFileSync(FEEDS_FILE, JSON.stringify(feeds, null, 2));

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

const alerts = createAlertService({
  readFeeds,
  fetchText: async feed => {
    const r = await fetch(feed.url, { redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  },
  stateFile: path.join(DATA_DIR, 'alerts-state.json'),
  firedFile: path.join(DATA_DIR, 'alerts-fired.json')
});

const startup = createStartupService();

// Actions that change the machine must come from this page: block other websites and DNS rebinding.
const isLocalAction = req => {
  const origins = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
  const hosts = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  return req.headers['x-calendar-action'] === '1' && hosts.includes(req.headers.host) &&
    (!req.headers.origin || origins.includes(req.headers.origin));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET') {
      const asset = staticFile(url.pathname);
      if (asset) return send(res, 200, fs.readFileSync(asset.file), asset.type);
    }

    if (url.pathname === '/api/version' && req.method === 'GET') return sendJson(res, 200, { version: VERSION });

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
        const r = await fetch(feed.url, { redirect: 'follow' });
        if (!r.ok) return send(res, 502, `Upstream returned HTTP ${r.status}`);
        return send(res, 200, await r.text(), 'text/calendar; charset=utf-8');
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
