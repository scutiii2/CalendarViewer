const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const { createStartupService } = require('../src/server/startup.js');

test('startup service reports and toggles the shortcut', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-'));
  const lnk = path.join(dir, 'x.lnk');
  const calls = [];
  const install = async args => { calls.push(args); if (args[0] === 'startup-off') fs.rmSync(lnk, { force: true }); else fs.writeFileSync(lnk, ''); };
  const svc = createStartupService({ platform: 'win32', shortcutPath: lnk, install });
  assert.deepEqual(svc.status(), { supported: true, enabled: false });
  assert.deepEqual(await svc.set(true), { supported: true, enabled: true });
  assert.deepEqual(await svc.set(false), { supported: true, enabled: false });
  assert.deepEqual(calls, [['startup-on'], ['startup-off']]);
  const other = createStartupService({ platform: 'linux', shortcutPath: lnk, install });
  assert.equal(other.status().supported, false);
  await assert.rejects(other.set(true), /only available on Windows/);
});

// Runs the real server on a spare port to check static files and the startup endpoint guards.
test('server serves the web files safely and guards the startup endpoint', async t => {
  const port = 3987;
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), CALENDAR_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-data-')) }, stdio: 'pipe' });
  t.after(() => server.kill());
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => String(d).includes('ICS viewer') && resolve());
    server.on('exit', code => reject(new Error('server exited with ' + code)));
  });
  const request = (method, url, headers = {}, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], data }));
    });
    req.on('error', reject);
    req.end(body);
  });

  for (const [url, type] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.js', 'text/javascript'], ['/shared/alert-logic.js', 'text/javascript'], ['/vendor/ical.min.js', 'text/javascript']]) {
    const r = await request('GET', url);
    assert.equal(r.status, 200, url);
    assert.ok(r.type.startsWith(type), url);
  }
  for (const url of ['/shared/..%2f..%2fserver%2Fserver.js', '/..%2f..%2fREADME.md', '/missing.js', '/data/feeds.json', '/src/server/server.js']) {
    assert.equal((await request('GET', url)).status, 404, url);
  }

  const version = await request('GET', '/api/version');
  assert.equal(version.status, 200);
  assert.equal(JSON.parse(version.data).version, fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim());

  const body = JSON.stringify({ enabled: false });
  const post = headers => request('POST', '/api/startup', { 'Content-Type': 'application/json', ...headers }, body).then(r => r.status);
  assert.equal(await post({}), 403, 'missing header');
  assert.equal(await post({ 'X-Calendar-Action': '1', Origin: 'https://evil.example' }), 403, 'foreign origin');
  assert.equal(await post({ 'X-Calendar-Action': '1', Host: 'evil.example:' + port }), 403, 'foreign host');
});
