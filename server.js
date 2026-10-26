// Local server: serves index.html and fetches ICS links server-side (browsers block them via CORS).
// Feed links are stored in feeds.json (gitignored). Listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const FEEDS_FILE = path.join(__dirname, 'feeds.json');
const { createAlertService } = require('./alerts');

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
  stateFile: path.join(__dirname, 'alerts-state.json'),
  firedFile: path.join(__dirname, 'alerts-fired.json')
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/alert-logic.js') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'alert-logic.js')), 'text/javascript; charset=utf-8');
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
