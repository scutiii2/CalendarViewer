const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Same URL-to-folder mapping as STATIC_ROOTS in src/server/static-files.js (server.js before Task 9).
const ROOTS = [['/shared/', path.join(ROOT, 'src', 'shared')], ['/vendor/', path.join(ROOT, 'vendor')], ['/', path.join(ROOT, 'src', 'web')]];
const html = fs.readFileSync(path.join(ROOT, 'src', 'web', 'index.html'), 'utf8');
const urls = pattern => [...html.matchAll(pattern)].map(m => m[1]);
const scripts = () => urls(/<script src="([^"]+)"/g);
const fileFor = url => { const [prefix, dir] = ROOTS.find(([p]) => url.startsWith(p)); return path.join(dir, url.slice(prefix.length)); };
// Top-level declarations start in column 0. Classic scripts share one global scope, so a duplicate const stops the later script.
const topLevelNames = file => [...fs.readFileSync(file, 'utf8').matchAll(/^(?:async\s+)?(?:function\s+|const\s+|let\s+)(\w+)/gm)].map(m => m[1]);

test('index.html references only files the server serves', () => {
  for (const url of [...scripts(), ...urls(/<link rel="stylesheet" href="([^"]+)"/g)]) {
    assert.ok(fs.statSync(fileFor(url)).isFile(), url);
  }
});

test('page scripts declare no top-level name twice', () => {
  const seen = new Map();
  for (const url of scripts().filter(u => !u.startsWith('/vendor/'))) {
    for (const name of topLevelNames(fileFor(url))) {
      assert.ok(!seen.has(name), `${name} is declared in both ${seen.get(name)} and ${url}`);
      seen.set(name, url);
    }
  }
});
