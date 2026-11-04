const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = () => fs.readFileSync('src/web/js/assistant-ui.js', 'utf8');
test('assistant dialog is opt-in, labelled and text-only with stop and native focus', () => {
  const html = fs.readFileSync('src/web/index.html', 'utf8');
  assert.match(html, /id="assistant-open"[^>]*hidden/);
  assert.match(html, /<dialog id="assistant-dialog" aria-labelledby="assistant-title"/);
  assert.match(html, /id="assistant-answer"[^>]*aria-live="polite"/);
  const js = script();
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|\.href\s*=/);
  assert.match(js, /showModal\(/); assert.match(js, /\.abort\(/);
  assert.match(js, /launcher\.focus\(/);
});
test('navigation validates trusted dates and uid against actual expanded events', () => {
  const context = vm.createContext({ document: { getElementById: () => null }, Date, console });
  vm.runInContext(script(), context);
  assert.equal(vm.runInContext("assistantValidDate('2026-02-30T09:00:00Z')", context), false);
  assert.equal(vm.runInContext("assistantValidDate('javascript:alert(1)')", context), false);
  assert.equal(vm.runInContext("assistantValidDate('2026-11-05T09:00:00Z')", context), true);
});

test('disabled UI stays hidden; enabled UI streams inert text, navigates known events and restores focus', async () => {
  class Element {
    constructor() { this.hidden = true; this.disabled = false; this.textContent = ''; this.value = ''; this.children = []; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    focus() { this.focused = true; }
  }
  const ids = ['open', 'dialog', 'question', 'answer', 'state', 'send', 'stop', 'sources', 'retry', 'privacy', 'close', 'form'];
  const elements = Object.fromEntries(ids.map(id => ['assistant-' + id, new Element()]));
  let enabled = false, calls = 0, navigated = false, opened = false;
  const known = { start: new Date('2026-11-05T09:00:00Z'), extendedProps: { uid: 'a' } };
  const context = vm.createContext({
    document: { getElementById: id => elements[id], createElement: () => new Element() },
    Date, AbortController, TextDecoder,
    calendar: { gotoDate() { navigated = true; } }, sources: [], expandSources: () => [known], showEventDialog() { opened = true; },
    fetch: async (url, opts) => {
      calls++;
      if (url.endsWith('/status')) return new Response(JSON.stringify({ enabled, reachable: true, model: 'test', url: 'http://127.0.0.1:9130', timezone: 'Asia/Manila' }));
      assert.equal(JSON.parse(opts.body).question, 'Thursday?');
      return new Response([
        { type: 'sources', data: { title: '<script>bad</script>' }, records: [{ uid: 'a', start: known.start.toISOString(), title: 'Known event' }] },
        { type: 'content', text: '<img src=x onerror=bad()>[evil](javascript:bad())' }, { type: 'done' }
      ].map(JSON.stringify).join('\n'));
    }
  });
  vm.runInContext(script(), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['assistant-open'].hidden, true); assert.equal(calls, 1);
  enabled = true; await elements['assistant-retry'].onclick();
  assert.equal(elements['assistant-open'].hidden, false);
  elements['assistant-open'].onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['assistant-question'].focused, true);
  elements['assistant-question'].value = 'Thursday?';
  await elements['assistant-form'].onsubmit({ preventDefault() {} });
  assert.match(elements['assistant-answer'].textContent, /<img src=x/);
  assert.match(elements['assistant-state'].textContent, /complete/);
  const action = elements['assistant-sources'].children[0].children.at(-1);
  action.onclick();
  assert.equal(navigated, true); assert.equal(opened, true);
  assert.equal(elements['assistant-open'].focused, true);
});
