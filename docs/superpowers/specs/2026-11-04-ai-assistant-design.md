# Local calendar assistant

Date: 2026-11-04. Implements the AI assistant prompt in `docs/superpowers/prompts/`.

## Goal and constraints

An opt-in, read-only calendar chat answers schedule and availability questions through MiniCPM. Off by default; outages must not interfere with calendar rendering, feeds or alerts. No dependencies, build step, extra listener, VERSION change, push or merge. Stay on `feat/ai-assistant`.

## Approach

Reuse the existing server, local-action guard and calendar expansion logic. Extract MCP definitions and handlers into `calendar-tools.js`; MCP retains its existing five-tool public contract, while the assistant also exposes `find_free_time`. A separate implementation would risk different calendar answers. A browser-to-model connection would expose credentials and bypass the server protections, so it is rejected.

The model client uses injected fetch, bounded HTTP requests and NDJSON parsing, retries only bare 502/503/504, and latches offline after three consecutive failed operations. Cancellation does not count as failure. URL precedence: MINICPM_URL, data/assistant-config.json url, loopback port 9130. Enable with CALENDAR_ASSISTANT_ENABLED=1 or config enabled=true; explicit environment flag overrides config. MINICPM_TOKEN is read only from the process environment. Config never supplies credentials. Only HTTP loopback model URLs without credentials/query/fragment are accepted to keep calendar contents local.

## Tools and dates

Shared tools retain recurrence expansion, cancellation exclusion, enabled calendars, deduplication and conflict handling. Relative dates use the server's local timezone, made explicit in the prompt and UI; today/tomorrow/weekdays/this week/next week and strict ISO dates are supported. Date-only ranges end exclusively; weekdays mean the next occurrence including today. Weeks begin Monday. Ranges are limited to 93 days. Free time clips merged busy intervals to daily working windows (default weekdays 09:00–17:00), includes all-day events, excludes past time, supports overnight hours and returns at most 20 slots. Code performs all arithmetic.

Assistant arguments are strictly checked against flat schemas. Each request is independent, with a worked example and fresh current time. At most five model turns and four calls per turn; at most 30 events and 12KB of data per tool reply; strings capped at 400 characters. Tool text is JSON labelled untrusted data. No network or write tools. Model text is advisory and cannot be guaranteed factual; visible source records accompany answers. Never expose thinking or upstream error details that might contain private inputs.

## HTTP and UI

GET /api/assistant/status and POST /api/assistant require the existing local Host/Origin/action header checks, including when disabled. POST accepts one question up to 2000 characters in an 8KB body. Responses are NDJSON content/sources/done/error records with existing security headers, no caching. Stop/disconnect aborts model work. One concurrent request is allowed to protect the local service.

The initially hidden launcher is revealed only when status says enabled. A responsive native modal dialog supplies labelled question, send, stop and close controls, a live answer region, offline/retry state, and a disclosure naming the model URL and server timezone. Closing or stopping cancels the request. Plain text only; model Markdown/URLs remain inert. Trusted tool-derived date/event buttons are checked against the displayed calendar before opening; no model-provided URL becomes a link. No chat persistence. Disabled mode makes no model requests.

## Acceptance and scope

Dependency-free node:test coverage for transport retries/streaming/failures/circuit/cancellation, date boundaries, availability, multi-turn calls/caps/errors/length, route protection/body limits/disabled behavior and UI contracts. Existing MCP tests remain unchanged and pass. README and SECURITY describe the explicit local-model data transfer. Phase 2 alert drafts and Laya tagging are deferred to preserve Phase 1 verification quality.
