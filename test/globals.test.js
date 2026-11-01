const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Classic scripts on index.html share one global scope, so a duplicate top-level name stops the later script from loading.
const topLevelNames = file => [...fs.readFileSync(path.join(__dirname, '..', file), 'utf8').matchAll(/^(?:async\s+)?(?:function\s+|const\s+|let\s+)(\w+)/gm)].map(m => m[1]);

test('app.js declares no top-level name that alert-logic.js already declares', () => {
  const shared = new Set(topLevelNames('src/shared/alert-logic.js'));
  const clashes = topLevelNames('src/web/app.js').filter(name => shared.has(name));
  assert.deepStrictEqual(clashes, []);
});
