// Opt-in local model dialog; answers are plain text and actions come only from tool records.
function assistantValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}
function initAssistantUI() {
  const launcher = document.getElementById('assistant-open');
  if (!launcher) return;
  const dialog = document.getElementById('assistant-dialog');
  const input = document.getElementById('assistant-question');
  const answer = document.getElementById('assistant-answer');
  const state = document.getElementById('assistant-state');
  const send = document.getElementById('assistant-send');
  const stop = document.getElementById('assistant-stop');
  const records = document.getElementById('assistant-sources');
  const refresh = document.getElementById('assistant-retry');
  let active = null, reachable = false;
  const headers = { 'X-Calendar-Action': '1', 'Content-Type': 'application/json' };
  async function status() {
    refresh.disabled = true;
    try {
      const response = await fetch('/api/assistant/status', { headers });
      if (!response.ok) throw new Error('status');
      const data = await response.json();
      launcher.hidden = !data.enabled;
      reachable = data.reachable;
      document.getElementById('assistant-privacy').textContent = `Questions and event details go to the configured local model service at ${data.url}. Dates use ${data.timezone}. Answers can be wrong; check the calendar sources below.`;
      state.textContent = reachable ? `Ready${data.model ? ' · ' + data.model : ''}` : 'Assistant offline. Check the model service and refresh status. After three failures, restart the calendar server.';
      send.disabled = !reachable || !!active;
    } catch { reachable = false; send.disabled = true; if (dialog.open) state.textContent = 'Assistant offline: calendar server unavailable.'; }
    finally { refresh.disabled = false; }
  }
  function stopAnswer() { active?.abort(); }
  launcher.onclick = () => { dialog.showModal(); input.focus(); status(); };
  document.getElementById('assistant-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { stopAnswer(); launcher.focus(); });
  dialog.addEventListener('cancel', stopAnswer);
  stop.onclick = stopAnswer;
  refresh.onclick = status;
  function addRecords(item) {
    const group = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Calendar source data (fields may be truncated)'; group.append(summary);
    const data = document.createElement('pre'); data.textContent = JSON.stringify(item.data, null, 2); group.append(data);
    for (const record of (item.records || []).slice(0, 30)) {
      if (!assistantValidDate(record.start)) continue;
      const button = document.createElement('button'); button.type = 'button';
      const date = new Date(record.start);
      button.textContent = `${record.uid ? 'Open event' : 'Jump to date'}: ${record.title} · ${date.toLocaleString()}`;
      button.onclick = () => {
        if (!assistantValidDate(record.start)) return;
        let event;
        if (record.uid) {
          const from = new Date(date); from.setHours(0, 0, 0, 0);
          const to = new Date(from); to.setDate(to.getDate() + 1);
          event = expandSources(sources, from, to).find(e => e.extendedProps.uid === record.uid && +e.start === +date);
          if (!event) { state.textContent = 'This event is no longer in the page calendar. Refresh your calendars.'; return; }
        }
        dialog.close(); calendar.gotoDate(date);
        if (event) showEventDialog(event);
      };
      group.append(button);
    }
    records.append(group);
  }
  document.getElementById('assistant-form').onsubmit = async event => {
    event.preventDefault();
    if (active || !reachable || !input.value.trim()) return;
    const controller = new AbortController(); active = controller;
    send.disabled = true; stop.disabled = false; refresh.disabled = true;
    answer.textContent = ''; records.replaceChildren(); state.textContent = 'Reading the calendar…';
    const readerState = { done: false, failed: false };
    const consume = line => {
      if (!line.trim()) return;
      const item = JSON.parse(line);
      if (item.type === 'content') answer.textContent += item.text;
      else if (item.type === 'sources') addRecords(item);
      else if (item.type === 'done') readerState.done = true;
      else if (item.type === 'error') { readerState.failed = true; state.textContent = item.message; if (item.offline) reachable = false; }
    };
    let reader;
    try {
      const response = await fetch('/api/assistant', { method: 'POST', headers, body: JSON.stringify({ question: input.value.trim() }), signal: controller.signal });
      if (!response.ok) throw new Error(await response.text());
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = '', bytes = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > 1024 * 1024) throw new Error('Assistant response too large.');
        buffer += decoder.decode(chunk.value, { stream: true });
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
      }
      buffer += decoder.decode(); consume(buffer);
      if (!readerState.failed) state.textContent = readerState.done ? 'Answer complete. Check the calendar source data.' : 'Answer interrupted. Please try again.';
    } catch (e) { state.textContent = controller.signal.aborted ? 'Answer stopped.' : 'Assistant error: ' + e.message; }
    finally {
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      active = null; stop.disabled = true; send.disabled = !reachable; refresh.disabled = false;
    }
  };
  status();
}
initAssistantUI();
