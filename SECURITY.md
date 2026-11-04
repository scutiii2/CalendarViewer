# Security policy

Only the latest released version is supported. Please update before reporting a vulnerability.

Report vulnerabilities privately through GitHub private vulnerability reporting (the repository's Security tab, "Report a vulnerability"). Do not include feed tokens or private calendar data in public issues.

## Threat model

The server listens on `127.0.0.1` only (the Docker image binds inside its container, publishes loopback by default; `/mcp` has no token, so do not publish it to an untrusted network) and is intended for one trusted local user, not network hosting or untrusted local users.
Machine-changing actions require the local Host, an absent or local Origin, and the app's action header; these checks are not authentication for local processes.
Feed URLs may contain secret tokens. Keep `data/` and browser storage private; adding a feed lets the server contact that URL and follow redirects.

## Optional local model assistant

Disabled by default. When enabled, questions and bounded read-only calendar results (including event titles, descriptions, locations and potentially meeting links) are sent by the server to the configured MiniCPM loopback HTTP service. That service controls its own logging and retention. CalendarViewer does not persist chat. The browser receives answers and source records through same-origin NDJSON, never the model token. `MINICPM_TOKEN` is accepted only from the process environment, not application files. Model URLs must be loopback origins without credentials; redirects are refused.

Both assistant routes use the local Host/Origin/action-header guard. Requests, responses, tool calls and iteration counts are bounded, and cancellation aborts model fetches. Three consecutive transport failures disable the client until restart. Feed text is untrusted data, truncated and labelled in prompts. The model has no write or network tools. These measures limit prompt-injection impact but do not make a small model's statements reliable: users must check visible calendar sources. Output is rendered as text; model links never become executable navigation. Source-derived event buttons verify the uid and occurrence against the current page calendar before opening it.
