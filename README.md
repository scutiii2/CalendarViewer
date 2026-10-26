# ICS Calendar Viewer

A read-only calendar that combines ICS links and imported `.ics` files in a Teams-inspired interface.

## Project layout

```text
calendar.bat        double-click launcher (menu), or: calendar.bat start|stop|startup-on|startup-off|zip
scripts/            calendar.ps1 (start, stop, startup, toast) and make_zip.py
src/server/         server.js (entry point), alerts.js (background alerts), startup.js
src/shared/         alert-logic.js, used by both the page and the server
src/web/            index.html, styles.css, app.js (the calendar page)
vendor/             FullCalendar, ical.js and third-party licences
test/               run with: node --test
data/               your feeds and alert state (created at run time, private)
```

## Requirements

- Windows with Node.js 18 or newer on PATH. A currently supported Node.js LTS release is recommended.
- A browser; an internet connection is needed only for remote calendar feeds and links you open.
- Python 3.8 or newer only if you want to create a distribution ZIP.

No dependency installation or build step is required.

## Launcher reference

Keep the application folder together: `calendar.bat` runs `scripts\calendar.ps1`.
Double-click `calendar.bat` for a menu; press Enter to choose the default, option 1.

| Menu option | Command | Action |
| --- | --- | --- |
| 1 | `calendar.bat start` | Start or restart the server and open the calendar in your browser. |
| 2 | `calendar.bat stop` | Stop this application's background server. |
| 3 | `calendar.bat startup-on` | Start the server automatically at Windows sign-in. Add `-Browser` to open the calendar too. |
| 4 | `calendar.bat startup-off` | Turn off automatic startup for your Windows account. |
| 5 | `calendar.bat zip` | Create a clean distribution ZIP using Python 3. |

## Start, restart, and stop

Extract the entire application into a permanent folder, then double-click `calendar.bat` and choose option 1.
It starts the server in the background and opens <http://localhost:3000>.
After startup, press any key to return to the menu, then choose Q. Closing the launcher or the browser does not stop the server.

- Choose option 1 again (or run `calendar.bat start`) to restart the server and reopen the calendar.
- Choose option 2 (or run `calendar.bat stop`) to stop this application's server.
- Alternatively, run `node src/server/server.js` in a terminal and use Ctrl+C to stop it.

If an older launcher started the server using a relative path, close that server manually once.
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
To disable startup and shut down the application completely, choose option 4, then option 2.
You can enable startup again later with option 3.
If you move the application folder, run the startup installer again from the new location.

## Use the calendar

- Add an ICS link and a label in the sidebar, or drop/select `.ics` files.
- Toggle calendars, edit their labels, change source colors, or remove them in the sidebar.
- Use Today, the navigation arrows, and Day / Work week / Week / Month to navigate.
- Open an event for dates, location, description, and a Join button when a Teams meeting link is available.
- Matching events from multiple sources are merged and display their source badges and dots.
- Upcoming and ongoing events are green; finished events turn gray. Green is reserved for event status.
- Refresh manually or select an auto-refresh interval: 1, 5, 10, 15, 30, or 60 minutes. Off disables automatic polling.
- Auto-refresh, Refresh, and the update status are in the upper-right calendar toolbar. The selected interval is remembered between visits.

## Alerts

Get an in-app toast and a system notification a set time before an event starts.

- **Calendar default:** click the bell next to a calendar in the sidebar, then add offsets such as 15 minutes or 1 hour. They apply to every event in that calendar.
- **Single event:** open an event and choose *Use calendar default*, *Custom alerts for this event*, or *Mute this event*. The setting applies to every occurrence of a recurring event and replaces the calendar default.
- **Mute everything:** tick *Mute all alerts* in the sidebar. Settings are kept.
- Events with an active alert show a bell icon. Hidden calendars do not alert.
- Toasts stay until dismissed and include a Join button for Teams meetings.
- **Windows notifications come from the background server**, so they appear even when the browser is closed. The page sends its alert settings and imported calendars to the server, which re-fetches feed links every 5 minutes and checks every 30 seconds. They stay on screen until dismissed, and the Join button opens a Teams meeting link.
- The server must be running: use `calendar.bat` (option 1 or 3). If the server is stopped, no alert fires; alerts that came due while it was stopped fire when it starts, if the event has not started.
- If the server cannot show Windows notifications, or is not reachable, the page falls back to browser notifications (needs browser permission) while it is open.
- The in-app toast still appears while the page is open. Windows Focus Assist / Do Not Disturb can hide Windows notifications.
- The first notification registers an app name "ICS Calendar Viewer" for your Windows account (`HKCU\Software\Classes\AppUserModelId`).
- Alert settings are kept in browser local storage and copied to `data/alerts-state.json` (private, gitignored, excluded from ZIPs). `data/alerts-fired.json` remembers which alerts were sent.

Cached events display while remote calendars refresh. Skeleton placeholders appear when the calendar is empty.
The interface follows your system's light/dark preference.

## Privacy

Remote feed links are saved locally in `data/feeds.json`, which the server creates as needed. Files from an older version (`feeds.json` and `alerts-*.json` in the application folder) are moved into `data/` the first time the new server starts.
Imported files, cached feed snapshots, and the auto-refresh preference are stored in your browser's local storage.
Use the same browser profile and address to retain that browser data; clearing site data removes it.
The server listens only on `127.0.0.1`. This application does not edit the source calendars.

Calendar data stays on your machine, in `data/` and browser storage. The app contacts only the calendar hosts you add (including redirects); opening a meeting or description link contacts its destination. All libraries are bundled locally: there is no CDN request and no telemetry.
ICS links may contain secret access tokens. Keep `data/`, imported calendars and browser storage private; do not publish or share feed links.

Treat the `data/` folder and calendar data as private. They are excluded from distribution ZIPs.
Calendar sources and browser caches are not transferred by the ZIP packager.

## Package the application

Choose option 5 in `calendar.bat`, or run:

```bat
python scripts/make_zip.py
```

The archive is created at `dist/ics-calendar-viewer.zip` and includes the app, the `calendar.bat` launcher, `scripts/`, the tests, and this README.
Generated `.zip` files are excluded wherever they appear in the project, including the output archive itself.
Git files, dependencies, build output, caches, local settings, secret files, the `data/` folder, and `.ics` files are excluded.
The previous archive is replaced after packaging succeeds.
Recipients should extract the ZIP before running the launchers and add their own calendars.
Node.js and Python are not bundled; Python is needed only for packaging.

## Troubleshooting

- **Node.js not found:** install Node.js and reopen the launcher.
- **Port already in use:** stop the previous calendar server or the other application using port 3000.
- **Feed refresh fails:** confirm the server is running and the ICS link is accessible. Cached events remain available.
- **Startup does not work:** check that the application folder has not moved and turn startup off and on again from `calendar.bat`.
- **Custom port:** set the `PORT` environment variable before launching. Browser storage is separate for each port.

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
