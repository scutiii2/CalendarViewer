# ICS Calendar Viewer

A read-only calendar that combines ICS links and imported `.ics` files in a Teams-inspired interface.

## Requirements

- Windows with Node.js 18 or newer on PATH. A currently supported Node.js LTS release is recommended.
- A browser and an internet connection for the CDN libraries and remote calendar feeds.
- Python 3.8 or newer only if you want to create a distribution ZIP.

No dependency installation or build step is required.

## Launcher reference

Keep the BAT files and their PowerShell helpers together in the application folder.

| File | Action |
| --- | --- |
| `run.bat` | Start or restart the server and open the calendar in your browser. |
| `stop.bat` | Stop this application's background server. |
| `install_startup.bat` | Enable automatic server startup and browser opening at Windows sign-in. |
| `remove_startup.bat` | Disable automatic startup for your Windows account. |
| `make_zip.bat` | Create a clean distribution ZIP using Python 3. |

## Start, restart, and stop

Extract the entire application into a permanent folder, then double-click `run.bat`.
It starts the server in the background and opens <http://localhost:3000>.
The launcher window closes after startup; closing the browser does not stop the server.

- Run `run.bat` again to restart the server and reopen the calendar.
- Run `stop.bat` to stop this application's server.
- Alternatively, run `node server.js` in a terminal and use Ctrl+C to stop it.

If an older launcher started the server using a relative path, close that server manually once.
The launchers deliberately avoid stopping processes they cannot identify as this application.

## Start automatically with Windows

Double-click `install_startup.bat`. It adds one shortcut to your account's Windows Startup folder.
The server starts and the calendar opens in your browser when you next sign in after booting Windows.
It runs as your account, without administrator privileges; it does not run before sign-in.
Running the installer again updates the same shortcut.

To disable automatic startup, double-click `remove_startup.bat`, or open a terminal in this folder and run:

```bat
install_startup.bat -Remove
```

You can also press Win+R, enter `shell:startup`, and delete only `ICS Calendar Viewer.lnk`.
Disabling startup does not stop an already-running server; use `stop.bat` for that.
To disable startup and shut down the application completely, run `remove_startup.bat`, then `stop.bat`.
You can enable startup again later with `install_startup.bat`.
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
- The server must be running: use `run.bat` or `install_startup.bat`. If the server is stopped, no alert fires; alerts that came due while it was stopped fire when it starts, if the event has not started.
- If the server cannot show Windows notifications, or is not reachable, the page falls back to browser notifications (needs browser permission) while it is open.
- The in-app toast still appears while the page is open. Windows Focus Assist / Do Not Disturb can hide Windows notifications.
- The first notification registers an app name "ICS Calendar Viewer" for your Windows account (`HKCU\Software\Classes\AppUserModelId`).
- Alert settings are kept in browser local storage and copied to `alerts-state.json` next to the server (private, gitignored, excluded from ZIPs). `alerts-fired.json` remembers which alerts were sent.

Cached events display while remote calendars refresh. Skeleton placeholders appear when the calendar is empty.
The interface follows your system's light/dark preference.

## Data and privacy

Remote feed links are saved locally in `feeds.json`, which the server creates as needed.
Imported files, cached feed snapshots, and the auto-refresh preference are stored in your browser's local storage.
Use the same browser profile and address to retain that browser data; clearing site data removes it.
The server listens only on `127.0.0.1`. This application does not edit the source calendars.

Treat `feeds.json`, `alerts-state.json` and calendar data as private. They are excluded from distribution ZIPs.
Calendar sources and browser caches are not transferred by the ZIP packager.

## Package the application

Double-click `make_zip.bat`, or run:

```bat
python make_zip.py
```

The archive is created at `dist/ics-calendar-viewer.zip` and includes the app, all five BAT launchers, their PowerShell helpers, the ZIP script, and this README.
All application `.bat` files are included. Generated `.zip` files are excluded wherever they appear in the project, including the output archive itself.
Git files, dependencies, build output, caches, local settings, secret files, `feeds.json`, and `.ics` files are excluded.
The previous archive is replaced after packaging succeeds.
Recipients should extract the ZIP before running the launchers and add their own calendars.
Node.js and Python are not bundled; Python is needed only for packaging.

## Troubleshooting

- **Node.js not found:** install Node.js and reopen the launcher.
- **Port already in use:** stop the previous calendar server or the other application using port 3000.
- **Feed refresh fails:** confirm the server is running and the ICS link is accessible. Cached events remain available.
- **Startup does not work:** check that the application folder has not moved and rerun `install_startup.bat`.
- **Custom port:** set the `PORT` environment variable before launching. Browser storage is separate for each port.
