# Web and Server Restructure Implementation Plan

> **For agentic workers (Codex):** Execute task by task, in order. Steps use checkbox (`- [ ]`) syntax. Commit at the end of each task. Stop and report at every **CHECKPOINT** so the reviewer can check the page in a browser.

**Goal:** Split `src/web/app.js` (1280 lines) into 21 focused page scripts under `src/web/js/`, move styles to `src/web/css/`, and pull response helpers, static files and feed fetching out of `src/server/server.js`. No behaviour change except the Start with Windows fix.

**Architecture:** Classic `<script>` files sharing one global scope (as today). Code moves verbatim. `main.js` loads last and starts the page. Server helpers become three small CommonJS modules.

**Tech Stack:** Node 18+ (CI runs 18 and 22), plain browser JavaScript, FullCalendar and ical.js in `vendor/`, `node --test`. No new dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-11-02-web-server-restructure-design.md`. Read it first: it holds the target layout and the script load order.

## Global Constraints

- Move code **verbatim**. Allowed edits are only those written in this plan.
- No new dependency, bundler, build step or ES module (`import`/`export`) in page code.
- No inline `<script>` in `index.html` (the CSP is `script-src 'self'`).
- No top-level name may be declared in two page scripts.
- Do not change `src/shared/*`, `vendor/*`, `VERSION`, `Dockerfile`, `docker-compose.yml`, `.github/`, `scripts/calendar.ps1`, `tools/publish_live.py`.
- Do not push, tag or release. Do not bump `VERSION`.
- Commit messages: Conventional Commits (`refactor:`, `fix:`, `test:`, `docs:`, `chore:`), body in plain English. Never use `git add -A`; add the files you changed by name.
- Run commands from the repository root. Windows host; use forward slashes in `git` paths.
- After every task run `node --test` and expect: `fail 0` (the SIGTERM test is skipped on Windows; that is normal).

## Reference: how the old `app.js` is divided

Top-level names in the current `src/web/app.js`, grouped by the file that will own them. Every name appears exactly once.

| New file | Names it owns | Load-time statements it keeps |
| --- | --- | --- |
| `core.js` | `store`, `create`, `externalLink`, `setStatus`, `api`, `apiJson`, `apiAction` | none |
| `state.js` | `PALETTE`, `LOCAL_SOURCES_KEY`, `FEED_CACHE_KEY`, `FEED_PREFERENCES_KEY`, `restoringBackup`, `snoozedOccurrences`, `sources`, `nextId`, `HIDE_CANCELLED_KEY`, `VIEW_KEY`, `initialView`, `savedView`, `searchQuery`, `searchInput`, `clearSearch`, `searchStatus`, `hideCancelled`, `backgroundFeedHealth`, `backgroundReachable`, `ALERT_RULES_KEY`, `ALERT_FIRED_KEY`, `alertRules`, `firedAlerts`, `BELL_PATH`, `BELL_OFF_PATH` | the `if (VIEWS.includes(savedView)) initialView = savedView;` line |
| `sources-store.js` | `localSourceSnapshots`, `feedPreferenceSnapshots`, `saveLocalSources`, `saveFeedPreferences`, `feedPreference`, `restoreLocalSources`, `readFeedCache`, `writeFeedCache`, `cacheFeedSnapshot`, `restoreFeedCache` | none |
| `event-format.js` | `eventFinishTime`, `updateEventStatus`, `renderDetailText`, `splitDescription`, `durationText`, `eventStatus` | none |
| `event-cards.js` | `alertIndicator`, `createEventCard`, `createSourceDots`, `appendEventBell`, `agendaEventContent`, `appendConflictBadge` | none |
| `working-hours.js` | `HOURS_KEY`, `endOfDay`, `loadWorkingHours`, `workingHours`, `businessHours`, `hoursStart`, `hoursEnd`, `applyWorkingHours` | the `hoursStart.value =` / `hoursEnd.value =` lines and the two `onchange` assignments |
| `calendar.js` | `currentScrollTime`, `focusCurrentTime`, `syncStrip`, `placeSyncStrip`, `setSyncState`, `upNextRail`, `calBox`, `CLOCK`, `calendar` | `new FullCalendar.Calendar(...)` (but **not** `calendar.render()`) |
| `search-ui.js` | `updateSearchStatus`, `resetSearch` | the three search `addEventListener` calls and the clear-button `addEventListener` |
| `event-dialog.js` | `showEventDialog` (new) | the `dd-toggle` and `copy-link` `onclick` assignments |
| `up-next.js` | `showUpNext`, `positionUpNext`, `railObserver`, `renderUpNext` | the two `railObserver.observe(...)` calls |
| `alert-sync.js` | `saveAlertRules`, `serverToasts`, `alertSyncTimer`, `scheduleAlertSync`, `syncAlertState`, `refreshServerStatus`, `serverUnreachable`, `applyServerStatus`, `saveFiredAlerts`, `alertRulesChanged` | none |
| `alert-editors.js` | `buildOffsetEditor`, `calAlertDlg`, `calAlertEnabled`, `openCalendarAlerts`, `alertEventCtx`, `openEventAlerts`, `renderEventAlerts` | the `document.querySelectorAll('input[name=alert-mode]').forEach(...)` block |
| `alert-delivery.js` | `runAlertCheck`, `deliverAlert`, `showToast` | the `setInterval(...30000)` and `visibilitychange` lines |
| `sidebar-settings.js` | `muteAll`, `hideCancelledToggle`, `updateNotifyPanel`, `askNotificationPermission`, `startupToggle`, `showStartup`, `loadStartup`, `startupState`, `startupStateTimer`, `setStartupState` | `hideCancelledToggle.checked/onchange`, `muteAll.checked/onchange`, `notify-enable` `onclick`, the `updateNotifyPanel();` call, `startupToggle.onchange`, the `loadStartup();` call |
| `sources-ui.js` | `BELL_ICON`, `MORE_ICON`, `isReservedGreen`, `renderSources`, `updateSourceHealth`, `removeSource`, `startRename`, `sourceMenu`, `menuOwner`, `closeSourceMenu`, `openSourceMenu` | `sourceMenu` creation lines (`create`, `setAttribute`, `hidden`, `document.body.append`), the `sourceMenu` `keydown` listener, the `pointerdown`, `resize` and `sources` `scroll` listeners |
| `feeds.js` | `pendingRefreshes`, `refreshQueued`, `skeleton`, `loadFeeds`, `fetchFeeds` | the `for (let i = 0; i < 5; i++)` skeleton loop |
| `refresh-controls.js` | `AUTO_REFRESH_KEY`, `autoRefresh`, `autoRefreshTimer`, `configureAutoRefresh`, `savedRefresh` | the `refresh` `onclick`, the `savedRefresh` check, the `autoRefresh.onchange`, the `configureAutoRefresh();` call |
| `theme.js` | `THEME_KEY`, `applyTheme` | the `applyTheme(store.get(...))` call and the theme button `forEach` |
| `add-calendar.js` | `addFiles`, `addToggle`, `addCard`, `addForm`, `dropZone`, `setAddMode`, `setAddCardOpen`, `fileInput`, `acceptFiles`, `sidebar`, `dropOverlay`, `hasFiles`, `dragDepth` | the `add` form `onsubmit`, add-card `onclick`s, `fileInput.onchange`, the four `sidebar.addEventListener` drag and drop calls |
| `backup-glue.js` | `getBackupClientState`, `applyBackupClientState` | the `CalendarBackupUI.init({...})` call |
| `main.js` | none | see Task 8 |

---

### Task 1: Fix Start with Windows and keep `docs/` out of the ZIP

Two small commits. Neither moves any file.

**Files:**
- Modify: `src/web/app.js` (two lines)
- Modify: `tools/make_zip.py`
- Modify: `README.md` (the "Package the application" paragraph)

**Interfaces:**
- Consumes: nothing.
- Produces: `loadStartup()` runs after `apiJson` exists; `make_zip.py` skips `docs/`.

- [ ] **Step 1: Confirm the bug by reading**

Run: `grep -n "loadStartup();" src/web/app.js` and `grep -n "^const apiJson" src/web/app.js`
Expected: the `loadStartup();` call line number is smaller than the `const apiJson` line number.

- [ ] **Step 2: Move the call**

In `src/web/app.js`:
1. Delete the line `loadStartup();` that sits directly above the comment `// -- Scheduler --`.
2. Add `loadStartup();` on a new line directly after the line `loadFeeds();` that follows `setInterval(refreshServerStatus, 30000);` (the block that starts with `restoreLocalSources();`).

- [ ] **Step 3: Verify**

Run: `node --check src/web/app.js` then `node --test`
Expected: no syntax error; `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add src/web/app.js
git commit -m "fix: show the Start with Windows row (loadStartup ran before apiJson existed)"
```

- [ ] **Step 5: Exclude `docs/` from the ZIP**

In `tools/make_zip.py` change

```python
        if line and not line.startswith("tools/") and not line.endswith(".zip")
```

to

```python
        if line and not line.startswith(("tools/", "docs/")) and not line.endswith(".zip")
```

and change the docstring sentence `tools/ (maintainer\nscripts) and older zips are left out` to `tools/ (maintainer\nscripts), docs/ (design notes) and older zips are left out`.

In `README.md`, in the "Package the application" section, change ``; `tools/` (deploy and release tooling) is excluded.`` to ``; `tools/` (deploy and release tooling) and `docs/` (design notes) are excluded.``

- [ ] **Step 6: Verify**

Run: `python tools/make_zip.py --output "$TMPDIR/cv-check.zip"` (on Windows PowerShell use `$env:TEMP\cv-check.zip`), then
`python -c "import zipfile,sys; n=zipfile.ZipFile(sys.argv[1]).namelist(); print(any('/docs/' in x for x in n), any('/tools/' in x for x in n))" "$TMPDIR/cv-check.zip"`
Expected: `False False`. Delete the temp ZIP.

- [ ] **Step 7: Commit**

```bash
git add tools/make_zip.py README.md
git commit -m "chore: keep docs/ out of the release ZIP"
```

---

### Task 2: Guard test for the page scripts

Replaces `test/globals.test.js`. It reads `index.html`, so it keeps working as scripts are added and moved.

**Files:**
- Create: `test/web-scripts.test.js`
- Delete: `test/globals.test.js`

**Interfaces:**
- Consumes: `src/web/index.html` (`<script src>` and `<link rel="stylesheet" href>` tags).
- Produces: two tests, "index.html references only files the server serves" and "page scripts declare no top-level name twice".

- [ ] **Step 1: Write the test**

Create `test/web-scripts.test.js`:

```js
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
```

- [ ] **Step 2: Run it**

Run: `node --test test/web-scripts.test.js`
Expected: both tests PASS against the current tree.

- [ ] **Step 3: Delete the old test and run everything**

Run: `git rm test/globals.test.js` then `node --test`
Expected: `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add test/web-scripts.test.js
git commit -m "test: check index.html scripts exist and share no top-level names"
```

---

### Task 3: Move files into `css/` and `js/` (no split yet)

**Files:**
- Move: `src/web/styles.css` to `src/web/css/styles.css`
- Move: `src/web/app.js`, `src/web/backup-ui.js`, `src/web/theme-init.js` to `src/web/js/`
- Modify: `src/web/index.html`, `test/backup-ui.test.js:6`, `test/web-refresh.test.js:8`, `test/search.test.js:40`, `test/server.test.js` (the `/theme-init.js` request), `README.md` (layout line), `THIRD-PARTY-NOTICES.md` (the `src/web/styles.css` path)

**Interfaces:**
- Consumes: nothing.
- Produces: URLs `/css/styles.css`, `/js/theme-init.js`, `/js/backup-ui.js`, `/js/app.js`.

- [ ] **Step 1: Move with git**

```bash
mkdir -p src/web/css src/web/js
git mv src/web/styles.css src/web/css/styles.css
git mv src/web/app.js src/web/js/app.js
git mv src/web/backup-ui.js src/web/js/backup-ui.js
git mv src/web/theme-init.js src/web/js/theme-init.js
```

- [ ] **Step 2: Update `index.html`**

Change these four tags (nothing else):
- `<script src="/theme-init.js"></script>` to `<script src="/js/theme-init.js"></script>`
- `<script src="/backup-ui.js"></script>` to `<script src="/js/backup-ui.js"></script>`
- `<link rel="stylesheet" href="/styles.css">` to `<link rel="stylesheet" href="/css/styles.css">`
- `<script src="/app.js"></script>` to `<script src="/js/app.js"></script>`

- [ ] **Step 3: Update test paths**

- `test/backup-ui.test.js:6`: `'../src/web/backup-ui.js'` to `'../src/web/js/backup-ui.js'`
- `test/web-refresh.test.js:8`: `'../src/web/app.js'` to `'../src/web/js/app.js'`
- `test/search.test.js:40`: `'../src/web/app.js'` to `'../src/web/js/app.js'`
- `test/server.test.js`: change `request('GET', '/theme-init.js')` to `request('GET', '/js/theme-init.js')`. In the same test add a line right after it: `assert.equal((await request('GET', '/css/styles.css')).status, 200);`

- [ ] **Step 4: Update docs**

- `README.md` layout block: replace the line starting `src/web/            index.html, styles.css, app.js ...` with
  `src/web/            index.html, css/styles.css, js/ (the calendar page: app.js, backup-ui.js, theme-init.js)`
- `THIRD-PARTY-NOTICES.md`: change `` `src/web/styles.css` `` to `` `src/web/css/styles.css` ``.

- [ ] **Step 5: Verify**

Run: `node --test`
Expected: `fail 0`; the "index.html references only files the server serves" test passes with the new paths.

- [ ] **Step 6: Commit**

```bash
git add -A src/web test/backup-ui.test.js test/web-refresh.test.js test/search.test.js test/server.test.js README.md THIRD-PARTY-NOTICES.md
git commit -m "refactor: move page styles and scripts into css/ and js/ folders"
```

(`git add -A src/web` is allowed here because it only contains the renames from Step 1 and the `index.html` edit.)

**CHECKPOINT 1.** Stop and report. The reviewer starts the server and checks the page loads with no console errors and the Start with Windows row is visible.

---

### Task 4: Extract helpers, state and rendering helpers

New files: `core.js`, `state.js`, `sources-store.js`, `event-format.js`, `event-cards.js`. All live in `src/web/js/`.

**Files:**
- Create: the five files above
- Modify: `src/web/js/app.js` (cut the moved names), `src/web/index.html` (add script tags)

**Interfaces:**
- Consumes: the ownership table above.
- Produces: the names listed for these five files, as globals.

- [ ] **Step 1: Record the baseline names**

Run (it writes outside the repo):

```bash
node -e "const fs=require('fs'),os=require('os'),path=require('path');const re=/^(?:async\s+)?(?:function\s+|const\s+|let\s+)(\w+)/gm;const names=[...fs.readFileSync('src/web/js/app.js','utf8').matchAll(re)].map(m=>m[1]).sort();fs.writeFileSync(path.join(os.tmpdir(),'cv-names-before.json'),JSON.stringify(names));console.log(names.length,'names saved')"
```

Expected: prints a count (about 140).

- [ ] **Step 2: Create `core.js`**

Create `src/web/js/core.js` starting with the comment line `// Browser helpers with no page state: safe storage, element factory, links, status text and fetch wrappers.` Then paste, in this order and unchanged:
1. `store` (the object at the top of app.js) and `create`
2. `externalLink`
3. `setStatus`
4. `api`, `apiJson`, `apiAction` (with its two comment lines)

Cut each from `app.js`.

- [ ] **Step 3: Create `state.js`**

`src/web/js/state.js`, first line `// Storage keys and the page state shared by every other script.` Paste from the top of `app.js` (unchanged, same order): `PALETTE` through `BELL_OFF_PATH`, including the `savedView` / `initialView` lines. Cut them from `app.js`. Note `alertIndicator` sits between `BELL_OFF_PATH` and the next group; it does **not** go here.

- [ ] **Step 4: Create `sources-store.js`**

First line `// Saving and restoring calendars, feed preferences and the feed cache in localStorage.` Paste `localSourceSnapshots`, `feedPreferenceSnapshots`, `saveLocalSources`, `saveFeedPreferences`, `feedPreference`, `restoreLocalSources`, `readFeedCache`, `writeFeedCache`, `cacheFeedSnapshot`, `restoreFeedCache`. Cut from `app.js`.

- [ ] **Step 5: Create `event-format.js`**

First line `// Text and time helpers for events and their detail dialog.` Paste `eventFinishTime`, `updateEventStatus`, `renderDetailText`, `splitDescription`, `durationText`, `eventStatus`. Cut from `app.js`.

- [ ] **Step 6: Create `event-cards.js`**

First line `// Event card, alert bell, source dots, conflict badge and agenda card for FullCalendar.` Paste `alertIndicator`, `createEventCard`, `createSourceDots`, `appendEventBell` (with its comment), `agendaEventContent`, `appendConflictBadge`. Cut from `app.js`.

- [ ] **Step 7: Add script tags**

In `src/web/index.html`, replace the single line `<script src="/js/app.js"></script>` with:

```html
<script src="/js/core.js"></script>
<script src="/js/state.js"></script>
<script src="/js/sources-store.js"></script>
<script src="/js/event-format.js"></script>
<script src="/js/event-cards.js"></script>
<script src="/js/app.js"></script>
```

- [ ] **Step 8: Verify**

Run: `node --check src/web/js/core.js src/web/js/state.js src/web/js/sources-store.js src/web/js/event-format.js src/web/js/event-cards.js src/web/js/app.js` (check each file separately if your shell rejects several), then `node --test`.
Expected: no syntax errors; `fail 0`. The "no top-level name twice" test proves nothing was left behind or pasted twice.

- [ ] **Step 9: Commit**

```bash
git add src/web/js src/web/index.html
git commit -m "refactor: extract core helpers, page state and event rendering from app.js"
```

---

### Task 5: Extract the calendar, search, event dialog and Up next

New files: `working-hours.js`, `calendar.js`, `search-ui.js`, `event-dialog.js`, `up-next.js`. One new function: `showEventDialog`.

**Files:**
- Create: the five files above
- Modify: `src/web/js/app.js`, `src/web/index.html`, `test/search.test.js:40`

**Interfaces:**
- Consumes: Task 4 globals.
- Produces: `showEventDialog(event)` (global function, no return value); `calendar` (global `const`, a FullCalendar instance that is **not yet rendered**).

- [ ] **Step 1: Create `working-hours.js`**

First line `// Working hours: saved range, shaded business hours, and the two sidebar time inputs.` Paste, in this order: `HOURS_KEY` (with the two comment lines above it), `endOfDay`, `loadWorkingHours`, `let workingHours = loadWorkingHours();`, `businessHours`, then the `// ---- Working hours ----` block (`hoursStart`, `hoursEnd`, the two `.value =` lines, `applyWorkingHours`, the two `onchange` lines). Cut from `app.js`.

- [ ] **Step 2: Create `calendar.js`**

First line `// The FullCalendar instance and its options. It is rendered by main.js.` Paste, in this order: `currentScrollTime`, `focusCurrentTime`, the `// The sync strip lives in <main>...` comment with `syncStrip`, `placeSyncStrip`, `setSyncState`, `upNextRail`, `calBox`, `CLOCK`, then the whole `const calendar = new FullCalendar.Calendar(calBox, { ... });` statement.

Make exactly one edit inside it: replace the entire body of `eventClick({ event }) { ... }` with

```js
  eventClick({ event }) {
    showEventDialog(event);
  }
```

Do **not** move `calendar.render();` or `placeSyncStrip();`. Leave those two lines in `app.js` for now (Task 8 moves them to `main.js`). Cut everything else from `app.js`.

- [ ] **Step 3: Create `event-dialog.js`**

First line `// The event details dialog.` Create `showEventDialog` by moving the **old body of `eventClick`** into it verbatim, so the file contains:

```js
function showEventDialog(event) {
  <the old eventClick body here, from `const p = event.extendedProps;` through `ddToggle.hidden = dd.scrollHeight <= dd.clientHeight + 1;`, unchanged>
}
```

Then paste the two handler assignments `document.getElementById('dd-toggle').onclick = ...` and `document.getElementById('copy-link').onclick = ...` after it, unchanged. Cut them from `app.js`.

- [ ] **Step 4: Create `search-ui.js`**

First line `// The event search box.` Paste `updateSearchStatus`, the `searchInput.addEventListener('input', ...)` and `keydown` listeners, `resetSearch`, and `clearSearch.addEventListener('click', resetSearch);`. Cut from `app.js`.

- [ ] **Step 5: Create `up-next.js`**

First line `// The Day view "Up next" rail (it lives outside #cal, which FullCalendar owns).` Paste the `// ---- Day view "Up next" rail ... ----` section: `showUpNext`, `positionUpNext`, `railObserver` and its two `observe` calls, `renderUpNext`. Cut from `app.js`.

- [ ] **Step 6: Update `index.html`**

Replace the Task 4 script block with this (app.js stays last):

```html
<script src="/js/core.js"></script>
<script src="/js/state.js"></script>
<script src="/js/sources-store.js"></script>
<script src="/js/event-format.js"></script>
<script src="/js/event-cards.js"></script>
<script src="/js/working-hours.js"></script>
<script src="/js/search-ui.js"></script>
<script src="/js/calendar.js"></script>
<script src="/js/event-dialog.js"></script>
<script src="/js/up-next.js"></script>
<script src="/js/app.js"></script>
```

FullCalendar calls `events()` during construction, so `search-ui.js` must load before `calendar.js` to define `updateSearchStatus` for the first fetch. The search handlers use `calendar` only when invoked later.

- [ ] **Step 7: Point the search test at `calendar.js`**

`test/search.test.js:40`: change `'../src/web/js/app.js'` to `'../src/web/js/calendar.js'`. The slice markers `'  events(info, ok, fail) {'` and `'  eventClick({ event })'` still exist, in that order, in `calendar.js`.

- [ ] **Step 8: Verify**

Run: `node --test`
Expected: `fail 0`, including "real calendar event pipeline honors calendar and cancellation filters before searching".

- [ ] **Step 9: Commit**

```bash
git add src/web/js src/web/index.html test/search.test.js
git commit -m "refactor: extract calendar, working hours, search, event dialog and up next"
```

---

### Task 6: Extract the alert scripts and sidebar settings

New files: `alert-sync.js`, `alert-editors.js`, `alert-delivery.js`, `sidebar-settings.js`.

**Files:**
- Create: the four files above
- Modify: `src/web/js/app.js`, `src/web/index.html`

**Interfaces:**
- Consumes: Tasks 4 and 5 globals.
- Produces: the names in the ownership table for these four files.

Load order matters here: `sidebar-settings.js` calls `updateNotifyPanel()` and `loadStartup()` while loading. `updateNotifyPanel` reads `serverToasts` (declared in `alert-sync.js`) and `loadStartup` calls `apiJson` (declared in `core.js`). So `alert-sync.js` must load before `sidebar-settings.js`.

- [ ] **Step 1: Create `alert-sync.js`**

First line `// Alert settings sync with the background server, its status, and fired-alert memory.` Paste from the `// ---- Alerts ... ----` section: `saveAlertRules`, the `// The background server sends Windows toasts...` comment with `serverToasts` and `alertSyncTimer`, `scheduleAlertSync`, `syncAlertState`, `refreshServerStatus`, `serverUnreachable`, `applyServerStatus`, `saveFiredAlerts`, `alertRulesChanged` (with its comment). Cut from `app.js`.

- [ ] **Step 2: Create `alert-editors.js`**

First line `// Alert editors: per-calendar defaults and per-event overrides.` Paste `buildOffsetEditor`, the `// -- Per-calendar defaults --` part (`calAlertDlg`, `calAlertEnabled`, `openCalendarAlerts`), the `// -- Per-event override ... --` part (`alertEventCtx`, `openEventAlerts`, `renderEventAlerts`), and the `document.querySelectorAll('input[name=alert-mode]').forEach(...)` block. Cut from `app.js`.

- [ ] **Step 3: Create `alert-delivery.js`**

First line `// Checking for due alerts and showing them: in-app toasts and browser notifications.` Paste the `// -- Scheduler --` part: `runAlertCheck`, `deliverAlert`, `showToast`, then the `// One 30-second tick...` comment with its `setInterval` and `document.addEventListener('visibilitychange', ...)` lines. Cut from `app.js`.

- [ ] **Step 4: Create `sidebar-settings.js`**

First line `// Sidebar switches: hide cancelled, mute all, notification status, and Start with Windows.` Paste the `// -- Sidebar panel ... --` part (`muteAll`, `hideCancelledToggle`, their init and handlers, `updateNotifyPanel`, `askNotificationPermission`, the `notify-enable` `onclick` and the `updateNotifyPanel();` call), then the `// -- Start with Windows --` part (`startupToggle`, `showStartup`, `loadStartup`, `startupState`, `startupStateTimer`, `setStartupState`, `startupToggle.onchange`, and the `loadStartup();` call that Task 1 left **after `loadFeeds();`**: move that call here and remove it from `app.js`). Cut from `app.js`.

- [ ] **Step 5: Update `index.html`**

Insert these four tags directly before `<script src="/js/app.js"></script>`, in this order:

```html
<script src="/js/alert-sync.js"></script>
<script src="/js/alert-editors.js"></script>
<script src="/js/alert-delivery.js"></script>
<script src="/js/sidebar-settings.js"></script>
```

- [ ] **Step 6: Verify**

Run: `node --test`
Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/web/js src/web/index.html
git commit -m "refactor: extract alert sync, editors, delivery and sidebar settings"
```

---

### Task 7: Extract calendar list, feeds, refresh, theme, add and backup glue

New files: `sources-ui.js`, `feeds.js`, `refresh-controls.js`, `theme.js`, `add-calendar.js`, `backup-glue.js`. After this task `app.js` holds only the last statements, which Task 8 moves.

**Files:**
- Create: the six files above
- Modify: `src/web/js/app.js`, `src/web/index.html`, `test/web-refresh.test.js`

**Interfaces:**
- Consumes: Tasks 4 to 6 globals.
- Produces: `loadFeeds()` and `fetchFeeds()` in `feeds.js` with `fetchFeeds` as the **last** declaration in that file (the test slices to the end of the file).

- [ ] **Step 1: Create `sources-ui.js`**

First line `// The sidebar calendar list: rows, health labels, rename, remove and the options menu.` Paste `BELL_ICON`, `MORE_ICON`, `isReservedGreen`, `renderSources`, `updateSourceHealth`, `removeSource`, `startRename`, the `// One shared options menu...` part (`sourceMenu` creation, `menuOwner`, `closeSourceMenu`, `openSourceMenu`), and the `sourceMenu` `keydown`, `pointerdown`, `resize` and `sources` `scroll` listeners. Cut from `app.js`.

- [ ] **Step 2: Create `feeds.js`**

First line `// Loading linked calendars from the server and refreshing them.` Paste, in this order: `pendingRefreshes`, `refreshQueued`, `skeleton` with its `for (let i = 0; i < 5; i++)` loop, `loadFeeds`, `fetchFeeds`. `fetchFeeds` must stay last. Cut from `app.js`.

- [ ] **Step 3: Create `refresh-controls.js`**

First line `// The Refresh now button and the auto-refresh interval.` Paste `document.getElementById('refresh').onclick = loadFeeds;`, `AUTO_REFRESH_KEY`, `autoRefresh`, `autoRefreshTimer`, `configureAutoRefresh`, `savedRefresh`, the `savedRefresh` check, `autoRefresh.onchange`, and the `configureAutoRefresh();` call. Cut from `app.js`.

- [ ] **Step 4: Create `theme.js`**

First line `// Theme buttons (the saved theme is applied earlier by theme-init.js).` Paste `THEME_KEY`, `applyTheme`, the `applyTheme(store.get(THEME_KEY) || 'system');` call and the button `forEach`. Cut from `app.js`.

- [ ] **Step 5: Create `add-calendar.js`**

First line `// Adding calendars: link form, .ics files, and drag and drop onto the sidebar.` Paste `addFiles`, the `document.getElementById('add').onsubmit = ...` handler, then the `// ---- Add card ----` section and the `// ---- .ics files ... ----` section (through the `sidebar.addEventListener('drop', ...)` block). Cut from `app.js`.

- [ ] **Step 6: Create `backup-glue.js`**

First line `// Connects backup-ui.js to the page: what to export and how to apply a restore.` Paste the `// The backup service owns feed URLs...` comment, `getBackupClientState`, `applyBackupClientState`, and the `CalendarBackupUI.init({ ... });` call. Cut from `app.js`.

- [ ] **Step 7: Update `index.html`**

Insert these six tags directly before `<script src="/js/app.js"></script>`, after the Task 6 tags, in this order:

```html
<script src="/js/sources-ui.js"></script>
<script src="/js/feeds.js"></script>
<script src="/js/refresh-controls.js"></script>
<script src="/js/theme.js"></script>
<script src="/js/add-calendar.js"></script>
<script src="/js/backup-glue.js"></script>
```

- [ ] **Step 8: Point the refresh test at `feeds.js`**

In `test/web-refresh.test.js`:
- Line 8: change `'../src/web/js/app.js'` to `'../src/web/js/feeds.js'`.
- Change the `functionCode` helper to allow a missing end marker:

```js
const functionCode = (start, end) => app.slice(app.indexOf(start), end === undefined ? undefined : app.indexOf(end, app.indexOf(start)));
```

- Change the first test's call from `functionCode('async function fetchFeeds()', '\ndocument.getElementById(\'refresh\')')` to `functionCode('async function fetchFeeds()')`.
- The second test's call `functionCode('async function loadFeeds()', '\nasync function fetchFeeds()')` stays as it is.

- [ ] **Step 9: Verify**

Run: `node --test`
Expected: `fail 0`, including both `web-refresh` tests.

- [ ] **Step 10: Commit**

```bash
git add src/web/js src/web/index.html test/web-refresh.test.js
git commit -m "refactor: extract calendar list, feeds, refresh, theme, add and backup glue"
```

---

### Task 8: Add `main.js`, delete `app.js`, prove nothing was lost

**Files:**
- Create: `src/web/js/main.js`
- Delete: `src/web/js/app.js`
- Modify: `src/web/index.html`

**Interfaces:**
- Consumes: everything above.
- Produces: the running page. `main.js` declares no names.

- [ ] **Step 1: Look at what is left**

Run: `cat src/web/js/app.js`
Expected: only these statements remain: `calendar.render();`, `placeSyncStrip();`, `restoreLocalSources();`, `restoreFeedCache();`, `renderSources();`, `calendar.refetchEvents();`, the `// Learn whether the server shows Windows toasts...` comment, `refreshServerStatus().then(...)`, `setInterval(refreshServerStatus, 30000);`, `loadFeeds();`. If anything else is left, it belongs in a file from the ownership table: move it there before continuing.

- [ ] **Step 2: Create `main.js`**

`src/web/js/main.js`:

```js
// Last page script: every file above has loaded, so the calendar can render and the saved state can load.
calendar.render();
placeSyncStrip();
restoreLocalSources();
restoreFeedCache();
renderSources();
calendar.refetchEvents();
// Learn whether the server shows Windows toasts before the first check, so no alert is announced twice.
refreshServerStatus().then(() => { runAlertCheck(false); scheduleAlertSync(); });
setInterval(refreshServerStatus, 30000);
loadFeeds();
```

- [ ] **Step 3: Delete `app.js` and finish `index.html`**

```bash
git rm src/web/js/app.js
```

In `index.html` replace `<script src="/js/app.js"></script>` with `<script src="/js/main.js"></script>`.

- [ ] **Step 4: Names check**

Run:

```bash
node -e "const fs=require('fs'),os=require('os'),path=require('path');const re=/^(?:async\s+)?(?:function\s+|const\s+|let\s+)(\w+)/gm;const before=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'cv-names-before.json'),'utf8'));const after=fs.readdirSync('src/web/js').flatMap(f=>[...fs.readFileSync('src/web/js/'+f,'utf8').matchAll(re)].map(m=>m[1])).sort();const missing=before.filter(n=>!after.includes(n));const extra=after.filter(n=>!before.includes(n));console.log(JSON.stringify({missing,extra}))"
```

Expected exactly: `{"missing":[],"extra":["showEventDialog"]}`.

- [ ] **Step 5: Verify the script list matches the spec**

Run: `grep -o 'src="[^"]*"' src/web/index.html`
Expected: the head list then the body list in the exact order given in the spec section "Script load order in `index.html`".

- [ ] **Step 6: Verify**

Run: `node --test`
Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/web/js/main.js src/web/index.html
git commit -m "refactor: replace app.js with focused page scripts and a main.js entry point"
```

**CHECKPOINT 2.** Stop and report. The reviewer runs the full browser acceptance list from the spec. Do not start Task 9 until the reviewer confirms.

---

### Task 9: Server: `http.js` and `static-files.js`

**Files:**
- Create: `src/server/http.js`, `src/server/static-files.js`
- Modify: `src/server/server.js`, `test/web-scripts.test.js` (comment only)

**Interfaces:**
- Produces from `http.js`: `SECURITY_HEADERS` (object), `send(res, code, body, type?)`, `sendJson(res, code, obj)`, `sendError(res, e)`, `readBody(req, limit = 1e5)` (returns a Promise of the text).
- Produces from `static-files.js`: `staticFile(pathname)` (async; resolves `{ file, type, etag }` or `null`), `sendStatic(req, res, asset)`.

- [ ] **Step 1: Create `http.js`**

```js
// Response helpers shared by the route table and the static file server.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const SECURITY_HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
};
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');
const sendError = (res, e) => send(res, e.status || 400, e.message);

// Over the limit, stop collecting and fail with 413; the request is drained so the reply can still be sent.
const readBody = (req, limit = 1e5) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0, over = false;
  req.on('data', c => {
    if (over) return;
    size += c.length;
    if (size > limit) { over = true; req.resume(); return reject(Object.assign(new Error('Request body too large'), { status: 413 })); }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  req.on('error', reject);
});

module.exports = { SECURITY_HEADERS, send, sendJson, sendError, readBody };
```

Before saving, compare each function with the current text in `server.js`. If any differs from the block above, **keep the `server.js` version** (the block above was copied from it; `server.js` is the source of truth).

- [ ] **Step 2: Create `static-files.js`**

```js
// Serves the page, shared scripts and vendor libraries from three public folders.
const fs = require('fs');
const path = require('path');
const { SECURITY_HEADERS } = require('./http');

const ROOT = path.join(__dirname, '..', '..');
const STATIC_ROOTS = [
  ['/shared/', path.join(ROOT, 'src', 'shared')],
  ['/vendor/', path.join(ROOT, 'vendor')],
  ['/', path.join(ROOT, 'src', 'web')]
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Only files inside the three public folders are served; anything that escapes them is refused.
async function staticFile(pathname) {
  const wanted = pathname === '/' ? '/index.html' : pathname;
  for (const [prefix, dir] of STATIC_ROOTS) {
    if (!wanted.startsWith(prefix)) continue;
    const file = path.resolve(dir, decodeURIComponent(wanted.slice(prefix.length)));
    const type = TYPES[path.extname(file)];
    if (!type || !file.startsWith(dir + path.sep)) return null;
    const info = await fs.promises.stat(file).catch(() => null);
    return info && info.isFile() ? { file, type, etag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"` } : null;
  }
  return null;
}

// Files are revalidated on every load (no-cache), but an unchanged one costs a 304 instead of a re-download.
const sendStatic = (req, res, { file, type, etag }) => {
  const headers = { 'Cache-Control': 'no-cache', ETag: etag, ...SECURITY_HEADERS };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, { 'Content-Type': type, ...headers });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
};

module.exports = { staticFile, sendStatic };
```

Same rule as Step 1: if `server.js` differs from this text, keep the `server.js` version.

- [ ] **Step 3: Edit `server.js`**

- Delete from `server.js`: `STATIC_ROOTS`, `TYPES`, `staticFile`, `CSP`, `SECURITY_HEADERS`, `send`, `sendStatic`, `sendJson`, `sendError`, `readBody` (and their comments).
- Add near the other requires: 

```js
const { send, sendJson, sendError, readBody } = require('./http');
const { staticFile, sendStatic } = require('./static-files');
```

- Keep `ROOT`, `DATA_DIR`, `FEEDS_FILE`, `VERSION`, and `fs`, `path`, `crypto` requires (still used).

- [ ] **Step 4: Update the test comment**

In `test/web-scripts.test.js` change the comment `// Same URL-to-folder mapping as STATIC_ROOTS in src/server/static-files.js (server.js before Task 9).` to `// Same URL-to-folder mapping as STATIC_ROOTS in src/server/static-files.js.`

- [ ] **Step 5: Verify**

Run: `node --check src/server/server.js src/server/http.js src/server/static-files.js` (separately if needed), then `node --test`
Expected: `fail 0`. `test/server.test.js` already checks CSP and nosniff headers, 304 ETag, path-escape 404s and the 413 body cap against the running server.

- [ ] **Step 6: Commit**

```bash
git add src/server test/web-scripts.test.js
git commit -m "refactor: move response helpers and static files out of server.js"
```

---

### Task 10: Server: `feed-fetch.js`

**Files:**
- Create: `src/server/feed-fetch.js`
- Modify: `src/server/server.js`

**Interfaces:**
- Consumes: `assertPublicUrl(url)` from `./feed-guard` (async, throws for a private address).
- Produces: `createFeedFetcher({ guardPrivate })` returning `async fetchFeedText(feed)` where `feed` is `{ url }`; resolves the response text; rejects with `Error('Feed timed out')`, `Error('Feed redirects too many times')`, `Error('HTTP <status>')` or `Error('Feed is larger than 10 MB')`.

- [ ] **Step 1: Create `feed-fetch.js`**

```js
// Fetches calendar feeds with a timeout, a size cap, hand-followed redirects and an optional private-address guard.
const { assertPublicUrl } = require('./feed-guard');

const FEED_TIMEOUT_MS = Number(process.env.CALENDAR_FEED_TIMEOUT_MS) || 20000; // the override is for tests
const FEED_MAX_BYTES = 10e6;
const MAX_REDIRECTS = 5;

// A hung or endless feed must not stall alert refreshes or MCP calls. Redirects are followed by hand so each hop can be checked.
function createFeedFetcher({ guardPrivate }) {
  return async function fetchFeedText(feed) {
    const signal = AbortSignal.timeout(FEED_TIMEOUT_MS);
    let r, link = feed.url;
    try {
      for (let hops = 0; ; hops++) {
        if (guardPrivate) await assertPublicUrl(link);
        r = await fetch(link, { redirect: 'manual', signal });
        const next = r.status >= 300 && r.status < 400 && r.headers.get('location');
        if (!next) break;
        if (hops >= MAX_REDIRECTS) throw new Error('Feed redirects too many times');
        await r.body?.cancel();
        link = new URL(next, link).href;
      }
    } catch (e) { throw e.name === 'TimeoutError' ? new Error('Feed timed out') : e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const chunks = [];
    let size = 0;
    try {
      for await (const c of r.body) {
        size += c.length;
        if (size > FEED_MAX_BYTES) { r.body.cancel().catch(() => {}); throw new Error('Feed is larger than 10 MB'); }
        chunks.push(c);
      }
    } catch (e) { throw e.name === 'TimeoutError' ? new Error('Feed timed out') : e; }
    return Buffer.concat(chunks).toString();
  };
}

module.exports = { createFeedFetcher };
```

Compare with the current `fetchFeedText` in `server.js`. If the logic differs in any way other than `GUARD_PRIVATE` becoming `guardPrivate`, **keep the `server.js` logic**.

- [ ] **Step 2: Edit `server.js`**

- Delete `FEED_TIMEOUT_MS`, `FEED_MAX_BYTES`, `MAX_REDIRECTS`, the `fetchFeedText` function, and the now unused `const { assertPublicUrl } = require('./feed-guard');`.
- Keep the `GUARD_PRIVATE` constant and its comment.
- Add `const { createFeedFetcher } = require('./feed-fetch');` with the other requires and, directly after `GUARD_PRIVATE`:

```js
const fetchFeedText = createFeedFetcher({ guardPrivate: GUARD_PRIVATE });
```

- Everything that used `fetchFeedText` (the alert service options and the `/api/ics/` route) keeps working unchanged.

- [ ] **Step 3: Verify**

Run: `node --check src/server/server.js src/server/feed-fetch.js` (separately if needed), then `node --test`
Expected: `fail 0`, including "oversized request bodies get 413 and bad feeds fail fast" and "feed fetches follow redirects, and a network-facing server refuses private addresses".

- [ ] **Step 4: Check the size goal**

Run: `wc -l src/server/server.js`
Expected: under 180 lines. If it is not, report it; do not cut more code to hit the number.

- [ ] **Step 5: Commit**

```bash
git add src/server
git commit -m "refactor: move feed fetching out of server.js"
```

---

### Task 11: Docs and final verification

**Files:**
- Modify: `README.md` (layout block)

**Interfaces:**
- Consumes: the final tree.
- Produces: a README layout block that matches it.

- [ ] **Step 1: Update the README layout block**

In the "Project layout" code block, replace the `src/server/`, `src/shared/` and `src/web/` lines with:

```text
src/server/         server.js (routes and startup), http.js, static-files.js, feed-fetch.js, feed-guard.js, alerts.js (background alerts),
                    reminders.js (snoozes), backups.js, mcp.js (read-only MCP server), json-store.js (atomic JSON files), startup.js, powershell.js
src/shared/         alert-logic.js, backup.js and search.js (page and server), storage.js (page only)
src/web/            index.html, css/styles.css, js/ (the calendar page: one script per feature, loaded in order by index.html, main.js last)
```

- [ ] **Step 2: Final checks**

Run:
- `node --test` (expect `fail 0`)
- `git status --short` (expect clean after the commit below)
- `grep -rn "src/web/app.js\|/app.js\|web/styles.css" README.md THIRD-PARTY-NOTICES.md src test scripts tools Dockerfile docker-compose.yml` (expect no matches)
- `wc -l src/web/js/*.js | sort -n | tail -5` (report the five largest; none should be near 1280)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the new web and server layout"
```

**CHECKPOINT 3.** Stop and report: commit list (`git log --oneline` since the start), test totals, the five largest page scripts, and any place where you departed from the plan and why.

---

## Self-review (done by the plan author)

- **Spec coverage:** layout (Tasks 3 to 10), load order (Tasks 4 to 8 and the spec list), bug fix (Task 1), ZIP exclusion (Task 1), guard test (Task 2), names check (Tasks 4 and 8), README and notices (Tasks 3 and 11), no-change list (Global Constraints). Browser acceptance is the reviewer's, at Checkpoints 1 and 2.
- **Placeholders:** none. Every moved name is listed; new code (`main.js`, `showEventDialog` wrapper, `web-scripts.test.js`, three server modules, `functionCode` change) is written out.
- **Name consistency:** `showEventDialog(event)`, `createFeedFetcher({ guardPrivate })`, `fetchFeedText(feed)`, `staticFile`, `sendStatic`, `send`, `sendJson`, `sendError`, `readBody`, `SECURITY_HEADERS` match across tasks.
- **Risk to watch:** a load-time statement that reads a name from a later script. The ownership table lists each file's load-time statements and the script order satisfies them (`alert-sync.js` before `sidebar-settings.js`; `working-hours.js` and `search-ui.js` before `calendar.js` (the constructor calls `events()` immediately); `calendar.js` before `up-next.js` because of `calBox` and `syncStrip`).
