# Web and server restructure: design spec

Date: 2026-11-02. Implements: `docs/superpowers/plans/2026-11-02-web-server-restructure.md`.

## Goal

Split the two oversized files into focused files in tidy folders, with **no behaviour change** except one bug fix (below). The page stays dependency-free: no bundler, no build step, no new packages.

## Why

- `src/web/app.js` is 1280 lines. Everything shares one scope, so every change risks everything else.
- `src/server/server.js` is 250 lines that mix routing, response helpers, static files and feed fetching.
- `src/shared/` and the rest of `src/server/` are small and focused. They stay as they are.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Page module format | **Classic `<script>` files** that share one global scope, exactly like today. Not ES modules. | Four tests read page code as text and run it in `vm` (`web-refresh`, `search`, `backup-ui`, `globals`). ES modules would break them and force a rewrite. Classic scripts let us move code verbatim. |
| Split `src/shared/alert-logic.js` | **No** | It loads as a global script in the browser and with `require` on the server. Splitting a dual-mode file costs more than it saves at 277 lines. |
| Move `feed-guard.js` | **No** | `test/feed-guard.test.js` requires it by path and it is already focused. |
| Where the plan and spec live | `docs/`, excluded from the release ZIP | Keeps them out of `dist/*.zip`. `docs/` is not in `publish_live.py`'s `DEPLOY_PATHS`, so it never reaches the `live` branch. |

## Known bug fixed on the way

`loadStartup()` runs at app.js line ~754 but `apiJson` is a `const` declared at line ~1041. The call hits the temporal dead zone, the `catch {}` swallows the ReferenceError, and the **Start with Windows** row never appears even though `/api/startup` reports `supported: true`. Confirmed in the browser on 2026-11-02: `startup-row.hidden === true` after load, `false` after calling `loadStartup()` by hand. Task 1 fixes it before any move; the split keeps it fixed because `apiJson` lives in the first script.

## Target layout

```text
src/
  web/
    index.html
    css/styles.css
    js/
      theme-init.js        saved theme before first paint (unchanged code)
      backup-ui.js         backup dialog (unchanged code)
      core.js              store, create, externalLink, setStatus, api, apiJson, apiAction
      state.js             storage keys and shared page state
      sources-store.js     save and restore calendars, feed cache, feed preferences
      event-format.js      event time, status, description text helpers
      event-cards.js       event card, bell, source dots, conflict badge, agenda card
      working-hours.js     working hours state, shading rules, sidebar inputs
      calendar.js          FullCalendar instance and its options
      search-ui.js         event search box
      event-dialog.js      event details dialog (showEventDialog), copy link, show more
      up-next.js           Day view "Up next" rail
      alert-sync.js        alert state sync with the server, status, fired alerts
      alert-editors.js     per-calendar and per-event alert editors
      alert-delivery.js    alert check loop, toasts, browser notifications
      sidebar-settings.js  mute all, hide cancelled, notify panel, start with Windows
      sources-ui.js        sidebar calendar list and its menu
      feeds.js             loadFeeds and fetchFeeds
      refresh-controls.js  Refresh now button and auto-refresh
      theme.js             theme buttons
      add-calendar.js      add link form, add file, drag and drop
      backup-glue.js       connects backup-ui.js to the page
      main.js              render the calendar, restore saved state, first refresh
  shared/                  unchanged
  server/
    server.js              wiring and routes only
    http.js                send, sendJson, sendError, readBody, security headers
    static-files.js        staticFile, sendStatic
    feed-fetch.js          createFeedFetcher (timeouts, size cap, redirects, private-address guard)
    (alerts, backups, feed-guard, json-store, mcp, powershell, reminders, startup: unchanged)
```

## Script load order in `index.html`

Order matters. Each file may run top-level statements only against files loaded before it.

Head, in this order:
`/js/theme-init.js`, `/vendor/ical.min.js`, `/vendor/fullcalendar.min.js`, `/shared/alert-logic.js`, `/shared/search.js`, `/shared/backup.js`, `/shared/storage.js`, `/js/backup-ui.js`, then `<link rel="stylesheet" href="/css/styles.css">`.

End of body, in this order:
`/js/core.js`, `/js/state.js`, `/js/sources-store.js`, `/js/event-format.js`, `/js/event-cards.js`, `/js/working-hours.js`, `/js/calendar.js`, `/js/search-ui.js`, `/js/event-dialog.js`, `/js/up-next.js`, `/js/alert-sync.js`, `/js/alert-editors.js`, `/js/alert-delivery.js`, `/js/sidebar-settings.js`, `/js/sources-ui.js`, `/js/feeds.js`, `/js/refresh-controls.js`, `/js/theme.js`, `/js/add-calendar.js`, `/js/backup-glue.js`, `/js/main.js`.

## Rules for moving page code

1. **Move code verbatim.** Do not rename, reformat or "improve" a moved function. Only the edits named in the plan are allowed.
2. Functions and `const`/`let` are visible across classic scripts at call time. Only code that runs **while the script loads** needs the dependency to be loaded earlier. The plan lists, per file, which load-time statements it keeps.
3. No top-level name may be declared in two page scripts (a duplicate `const` stops the later script). `test/web-scripts.test.js` enforces this.
4. Each page file starts with a one-line `//` comment saying what it owns.
5. `calendar.render()` runs only in `main.js`, after every function it can reach has loaded.

## Server rules

- Move code verbatim into `http.js`, `static-files.js`, `feed-fetch.js`. `server.js` keeps the route table, `GUARD_PRIVATE`, the token and Host checks, and the startup and shutdown code.
- Public behaviour must not change: same status codes, headers, error text, CSP string and environment variables.

## Not changing

`src/shared/*`, `vendor/`, the other server files, `Dockerfile`, `docker-compose.yml`, `.github/workflows/test.yml`, `scripts/calendar.ps1` (its staleness check already scans `src/` recursively), `tools/publish_live.py` (`src` covers new subfolders), `VERSION`. No release, no tag, no push.

## Acceptance

1. `node --test` passes on Node 18 and 22 with no skipped test added.
2. `index.html` references only existing files, in the order above; no top-level name is declared twice.
3. Names check: the sorted top-level names of the old `app.js` equal the sorted top-level names of the new page scripts plus exactly one new name, `showEventDialog`.
4. Browser check (done by the reviewer, not by Codex), on `http://localhost:<port>` with the server started from the new tree:
   - Browser console has no errors on load.
   - **Start with Windows** row is visible (the bug fix).
   - Add a link feed and an imported `.ics`; both show events.
   - Work week, Week, Month, Agenda and Day views render; Day shows the Up next rail.
   - Open an event: details, Join and Copy link, alert mode radios and custom offsets work.
   - Open a calendar bell: default offsets editor works.
   - Search filters events; Escape clears it.
   - Theme buttons, working hours, hide cancelled, mute all, auto-refresh and Refresh now work.
   - Backup export, then restore preview, works.
5. README layout block and `THIRD-PARTY-NOTICES.md` path match the new tree.
