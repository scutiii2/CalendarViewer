# Security policy

Only the latest released version is supported. Please update before reporting a vulnerability.

Report vulnerabilities privately through GitHub private vulnerability reporting (the repository's Security tab, "Report a vulnerability"). Do not include feed tokens or private calendar data in public issues.

## Threat model

The server listens on `127.0.0.1` only and is intended for one trusted local user, not network hosting or untrusted local users.
Machine-changing actions require the local Host, an absent or local Origin, and the app's action header; these checks are not authentication for local processes.
Feed URLs may contain secret tokens. Keep `data/` and browser storage private; adding a feed lets the server contact that URL and follow redirects.
