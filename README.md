# ICS Calendar Viewer

A read-only calendar that combines ICS links and imported `.ics` files in a Teams-inspired interface.

## Project layout

```text
calendar.bat        double-click launcher (menu), or: calendar.bat start|stop|startup-on|startup-off|zip
run.bat             one-click: start the server if needed, restart it after an update, open the calendar
VERSION             application version, reported by the server at /api/version
scripts/            calendar.ps1 (start, stop, startup, toast) and make_zip.py
tools/              deploy.bat (menu) and publish_live.py: put the app on the Zima server
Dockerfile, docker-compose.yml, .env.example   the server image
src/server/         server.js (entry point), alerts.js (background alerts), reminders.js (snoozes), backups.js,
                    mcp.js (read-only MCP server), json-store.js (atomic JSON files), startup.js, powershell.js
src/shared/         alert-logic.js, backup.js and search.js (page and server), storage.js (page only)
src/web/            index.html, styles.css, app.js (the calendar page), backup-ui.js
vendor/             FullCalendar, ical.js and third-party licences
test/               run with: node --test
data/               your feeds and alert state (created at run time, private)
```

## Requirements

- Windows with Node.js 18 or newer on PATH. A currently supported Node.js LTS release is recommended.
- A browser; an internet connection is needed only for remote calendar feeds and links you open.
- Python 3.8 or newer only if you want to create a distribution ZIP or publish to the server.
- Docker only on the server that runs the container image (see [Deploy to the server](#deploy-to-the-server)).

No dependency installation or build step is required.

## Launcher reference

Keep the application folder together: `calendar.bat` and `run.bat` run `scripts\calendar.ps1`.
Double-click `calendar.bat` for a menu; press Enter to choose the default, option 1.

| Menu option | Command | Action |
| --- | --- | --- |
| 1 | `calendar.bat start` | Start or restart the server and open the calendar in your browser. |
| 2 | `calendar.bat stop` | Stop this application's background server. |
| 3 | `calendar.bat startup-on` | Start the server automatically at Windows sign-in. Add `-Browser` to open the calendar too. |
| 4 | `calendar.bat startup-off` | Turn off automatic startup for your Windows account. |
| 5 | `calendar.bat zip` | Create a clean distribution ZIP using Python 3. |

## Quick start with run.bat

Double-click `run.bat` (or run `run.bat -NoBrowser` to skip the browser). It does the right thing without a menu:

- Server stopped: starts it and opens the calendar.
- Server running and up to date: leaves it running and opens the calendar.
- Server running but older than the files on disk (the `VERSION` differs, or a file in `src/` or `vendor/` is newer than the server process): restarts it, then opens the calendar.

To update, extract the new version over the application folder (keep `data/`), then double-click `run.bat`. Maintainers: see [Releasing](#releasing).

## Start, restart, and stop

Extract the entire application into a permanent folder, then double-click `calendar.bat` and choose option 1.
It starts the server in the background and opens <http://localhost:3000>.
After startup, press Enter to return to the menu, then choose Q. Closing the launcher or the browser does not stop the server.

- Choose option 1 again (or run `calendar.bat start`) to restart the server and reopen the calendar.
- Choose option 2 (or run `calendar.bat stop`) to stop this application's server.
- Alternatively, run `node src/server/server.js` in a terminal and use Ctrl+C to stop it.

The launchers deliberately avoid stopping processes they cannot identify as this application.

## Start automatically with Windows

Choose option 3 in `calendar.bat` (or run `calendar.bat startup-on -Browser` to also open the calendar at sign-in). It adds one shortcut to your account's Windows Startup folder.
The server starts when you next sign in after booting Windows, and the calendar opens in your browser only with `-Browser`.
It runs as your account, without administrator privileges; it does not run before sign-in.
Running the installer again updates the same shortcut.

You can also turn startup on or off from the calendar page with the **Start with Windows** checkbox in the sidebar. The checkbox starts only the server at sign-in and does not open a browser, which is enough for Windows alert notifications. It makes the same shortcut as option 3. The checkbox is available only when the page is served by this application's server on `localhost`.

To disable automatic startup, choose option 4 in `calendar.bat`, or open a terminal in this folder and run:

```bat
calendar.bat startup-off
```

You can also press Win+R, enter `shell:startup`, and delete only `ICS Calendar Viewer.lnk`.
Disabling startup does not stop an already-running server; use option 2 for that.
If you move the application folder, run the startup installer again from the new location.

## Use the calendar

- Add an ICS link and a label in the sidebar, or drop/select `.ics` files.
- Toggle calendars, edit their labels, change source colors, or remove them in the sidebar.
- Use Today, the navigation arrows, and Day / Work week / Week / Month / Agenda to navigate. The selected view is remembered. Agenda is a compact weekly list with times, locations, source labels, alert indicators and overlap badges.
- **Search events** filters titles and locations in the displayed date range, ignoring capitalization. Clear or press Escape to reset it; navigate dates to search another range. Search changes the display, while alert scheduling and overlap detection continue to consider all eligible events.
- Open an event for dates, location, description, and a Join button when a Teams meeting link is available.
- Matching events from multiple sources are merged and display their source badges and dots.
- Use **Hide cancelled events** in the sidebar to hide events whose titles start with Canceled or Cancelled. The choice is remembered. Events explicitly marked `STATUS:CANCELLED` in the feed are always excluded.
- Overlapping timed meetings show an **Overlap** badge; open a meeting to see the conflicting titles. Cancelled events, all-day events, hidden calendars and back-to-back meetings do not count. Matching events are merged before checking overlaps.
- Each linked calendar shows separate **Page** and **Alerts** refresh states with its last successful refresh time. Failed refreshes retain cached events and their original timestamps. Page data is marked stale after twice the selected auto-refresh interval (at least 10 minutes); background alert data after 10 minutes. **Not needed** means no alert offsets are configured. Imported calendars are labelled **Local file**.
- Upcoming and ongoing events are green; finished events turn gray. Green is reserved for event status.
- Refresh manually or select an auto-refresh interval (off, or every 1, 5, 10, 15, 30 or 60 minutes) in the sync strip under the calendar toolbar, which also shows the update status. The interval is remembered between visits.
- **Working hours** in the sidebar shade the hours outside them, and weekends, in every view. A start later than the end (for example 22:00 to 06:00) is an overnight shift. The choice is remembered.
- Day view shows an **Up next** list of the next three upcoming events in the coming 7 days, with a Join button for the first when it has a Teams link.

## Alerts

Get an in-app toast and a system notification a set time before an event starts.

- **Calendar default:** click the bell next to a calendar in the sidebar, then add offsets such as 15 minutes or 1 hour. They apply to every event in that calendar.
- **Single event:** open an event and choose *Calendar default*, *Custom*, or *Muted*. The setting applies to every occurrence of a recurring event and replaces the calendar default.
- **Mute everything:** tick *Mute all alerts* in the sidebar. Settings are kept.
- Events with an active alert show a bell icon. Hidden calendars do not alert.
- Cancelled events never alert, including events with custom reminders. Their bell is muted and their reminder controls are disabled; saved rules are kept in case the event becomes active again.
- In-app toasts stay until dismissed and include a Join button for Teams meetings. Windows notification banners disappear automatically after the normal short display duration controlled by your Windows settings; their actions remain available in Notification Center.
- **Snooze 5 min** defers an upcoming reminder for five minutes, provided that ends before the meeting starts. In-app snooze requires the background server; failure leaves the original alert visible. The Windows Snooze button opens a small local confirmation tab that you can close. Both buttons use the same saved background queue, so snoozes survive a server restart. The server checks current event details, cancellation, calendar visibility and alert rules before sending again; a failed remote refresh keeps the snooze pending until fresh data arrives or the meeting starts.
- **Windows notifications come from the background server**, so they appear even when the browser is closed. The page sends its alert settings and imported calendars to the server, which re-fetches feed links every 5 minutes and checks every 30 seconds.
- The server must be running: use `calendar.bat` (option 1 or 3). If the server is stopped, no alert fires; alerts that came due while it was stopped fire when it starts, if the event has not started.
- If the server cannot show Windows notifications, or is not reachable, the page falls back to browser notifications (needs browser permission) while it is open.
- Windows Focus Assist / Do Not Disturb can hide Windows notifications.
- The first notification registers an app name "ICS Calendar Viewer" for your Windows account (`HKCU\Software\Classes\AppUserModelId`).
- Alert settings are kept in browser local storage and copied to `data/alerts-state.json` (private, gitignored, excluded from ZIPs). `data/alerts-fired.json` remembers which alerts were sent.

Cached events display while remote calendars refresh. Skeleton placeholders appear when the calendar is empty.
The interface follows your system's light/dark preference unless you pick Light or Dark under **Theme** in the sidebar.

## Privacy

Calendar data stays on your machine. Remote feed links are saved in `data/feeds.json`, which the server creates as needed. Imported files, cached feed snapshots, and preferences are stored in your browser's local storage; use the same browser profile and address to retain them, because clearing site data removes them.
The server listens only on `127.0.0.1` (the Docker image listens inside its container and refuses to start without `INTERNAL_API_TOKEN`). This application does not edit the source calendars.
The [MCP endpoint](#mcp-server) returns event titles, locations and descriptions to any local program that calls it. Set `INTERNAL_API_TOKEN` to require a token.

The app contacts only the calendar hosts you add (including redirects); opening a meeting or description link contacts its destination. All libraries are bundled locally: there is no CDN request and no telemetry.

## Backup and restore

Open **Backup & restore** in the sidebar to export a local JSON backup. It includes linked calendar URLs, imported ICS files, calendar labels/colors/visibility, alert rules, theme, working hours, refresh interval, hide-cancelled choice and selected view. It does not transfer the Windows startup setting, cached feed snapshots, already-fired alerts or pending snoozes.

Choose **Restore backup** to validate a file and preview the calendar/rule counts before replacing your current configuration. Restore checks browser storage first and saves the previous configuration in `data/backup-recovery.json`. **Recovery backup** previews that saved configuration for restoring it. Failed writes roll back; if an interrupted connection prevents confirming recovery, synchronization pauses and the page explains how to recover. Wait for any active calendar refresh to finish before exporting or restoring.

Backup files and recovery snapshots contain private calendar links and event contents, and are not encrypted. ICS links may contain secret access tokens. Keep backups, `data/`, imported calendars and browser storage private, and do not share feed links.

## MCP server

The same server exposes a read-only [MCP](https://modelcontextprotocol.io) endpoint at `http://127.0.0.1:3000/mcp` (streamable HTTP, POST only, no extra install). Tools, all marked `readOnlyHint`: `list_calendars`, `list_events` (date range and text search, overlaps marked), `get_event`, `up_next` and `conflicts`. It reads linked calendars (fetched with a 5-minute cache) and the imported files the page has synced for alerts, so open the calendar page once to make imported files visible. Cancelled events are left out.

To bind it to Citadel's armory as an extension, add this to armory's `configs/config_extensions.json` and restart armory (start this server first):

```json
"calendar_viewer": {
  "label": "Calendar Viewer",
  "description": "Read-only view of your ICS calendars: events, overlaps and what is up next.",
  "url": "http://127.0.0.1:3000/mcp",
  "headers": { "X-Internal-Token": "${INTERNAL_API_TOKEN}" }
}
```

If `INTERNAL_API_TOKEN` is set in this server's environment, `/mcp` requires that value in `X-Internal-Token`; unset, it accepts any local caller. Requests with an `Origin` header (browsers) or a foreign `Host` are always refused. A custom `PORT` changes the URL.

## Deploy to the server

The Zima box runs the app in Docker beside Citadel, as Scribe and Bard do. Run `tools\deploy.bat` (or `deploy.bat` one folder up) and pick an option:

| Option | Action |
| --- | --- |
| 1 | **Publish:** copy only the files the image needs (`Dockerfile`, `docker-compose.yml`, `VERSION`, `src/`, `vendor/`, `README.md`) to the `live` branch, without touching your working tree. Use it for test deploys. |
| 2 | **Push .env:** send the git-ignored `.env` over ssh (copy `.env.example` and set `INTERNAL_API_TOKEN` to Citadel's value). |
| 3 | Both of the above. |
| 4, 5 | Dry runs of publish and push. |
| 6 | Copy the one-time `chown` command and open the server's web terminal, if the copy cannot write. |
| R | **Release:** publish, then tag the `main` commit `vX.Y.Z` and the live commit `live-vX.Y.Z` (see [Releasing](#releasing)). |

Then, on the server in `/media/ZimaOS-HD/Apps/CalendarViewer`, run `git pull` and `docker compose up -d --build`.

In the container:

- Armory reaches the MCP endpoint at `http://calendar:3000/mcp` with the same `X-Internal-Token` header as above. The web page is published on the server's loopback only by default (`CALENDAR_PORT`, default 3000). To open it from the network, for example as a ZimaOS app link, set `CALENDAR_BIND_HOST=0.0.0.0` in `.env`; the page has no sign-in, so anyone on the network can read the calendars. Backup, restore and snooze buttons are refused unless the page is opened as `localhost` or `127.0.0.1`, so use an ssh tunnel for those.
- Data lives in the `calendar_data` volume.
- Windows notifications are not available, so alerts fire only in the browser.
- `INTERNAL_API_TOKEN` is required: the server refuses a `CALENDAR_BIND` other than `127.0.0.1` without it. `CALENDAR_MCP_HOSTS` lists extra `Host` values accepted on `/mcp` (compose sets `calendar:3000`).

### Releasing

1. Change the number in `VERSION` and commit.
2. Run option **R**. It tags `vX.Y.Z` on `main` and `live-vX.Y.Z` on `live`, pushes both with the `live` branch, and refuses a version already released with different files. When the live files are unchanged it only tags the current `live` tip.
3. Create the desktop ZIP with `python scripts/make_zip.py`.

## Package the application

Choose option 5 in `calendar.bat`, or run:

```bat
python scripts/make_zip.py
```

The archive is created at `dist/CalendarViewer.zip` and includes everything outside the exclusions below: the app, launchers, `scripts/`, `tools/`, the Docker files, the tests, and this README.
Generated `.zip` files are excluded wherever they appear in the project, including the output archive itself.
Git files, dependencies, build output, caches, local settings, secret files, the `data/` folder, and `.ics` files are excluded.
The previous archive is replaced after packaging succeeds.
Recipients should extract the ZIP before running the launchers and add their own calendars. Node.js is not bundled.

## Troubleshooting

- **Node.js not found:** install Node.js and reopen the launcher.
- **Port already in use:** stop the previous calendar server or the other application using port 3000.
- **Feed refresh fails:** confirm the server is running and the ICS link is accessible. Cached events remain available.
- **Startup does not work:** check that the application folder has not moved and turn startup off and on again from `calendar.bat`.
- **Armory cannot connect to the MCP server (401/403):** the URL must use `127.0.0.1:3000` or `localhost:3000` (your port if changed) and the `X-Internal-Token` header must match this server's `INTERNAL_API_TOKEN`. Start this server before armory.
- **MCP tools miss an imported file:** open the calendar page once so it syncs imported files to the server.
- **Custom port:** set the `PORT` environment variable before launching. Browser storage is separate for each port.
- **Container exits at start:** `INTERNAL_API_TOKEN` is missing from the server's `.env`. Push it again (option 2) and rerun `docker compose up -d --build`.

## Accessibility

- Interface text and controls in the default light and dark themes meet WCAG 2.1 AA contrast (4.5:1 for text), checked by calculation on the theme colours.
- Buttons, switches and form fields have text labels or `aria-label`s, and status messages use `role="status"` with `aria-live`.
- Every control shows a visible focus outline, and animations stop under `prefers-reduced-motion`.
- Known gaps: calendar colours you choose yourself are not checked for contrast, and the page has not been tested with a screen reader. Reports are welcome.

## Disclaimer

Alerts are best effort and must not be used for safety-critical purposes.
This project is not affiliated with Microsoft, Google or DXC. "Teams-inspired" describes the layout only.

## Licences and security

See [third-party notices](THIRD-PARTY-NOTICES.md) for bundled components and their licences, and [the security policy](SECURITY.md) for private vulnerability reporting.
