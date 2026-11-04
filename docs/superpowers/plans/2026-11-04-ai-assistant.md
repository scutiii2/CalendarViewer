# Local Calendar Assistant Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. The user explicitly delegated planning and execution; no approval pause or worktree/branch switch.

**Goal:** An opt-in local read-only calendar assistant with bounded model calls and accessible streamed answers.

**Architecture:** Shared CommonJS calendar tools, deterministic shared date/free-time logic, injected-fetch model client, guarded NDJSON route, classic page script and native dialog.

**Tech Stack:** Node 18+, browser JavaScript, existing bundled ICAL/FullCalendar, node --test; no packages.

**Spec:** `docs/superpowers/specs/2026-11-04-ai-assistant-design.md`.

## Global constraints

Stay on feat/ai-assistant; no push, merge, dependencies or VERSION change. Never read .env files or secrets. The explicitly requested .env.example is updated by appending documented names without reading existing content. Run node --test before each commit; stage only named task files.

## Review focus

- Invalid/overflow dates and DST: reject invalid dates and use calendar-day arithmetic.
- Overlapping, all-day and overnight events: union busy intervals and clip working windows.
- Interrupted streams and Stop: bounded stream size, final done required, cancellation propagated.
- Invented model calls/links: strict argument validation; only trusted result buttons become actions.
- Disabled/offline model: no model contact when disabled; calendar remains independent.

### Task 1: Shared calendar tools and deterministic dates

Files: src/server/calendar-tools.js, src/server/mcp.js, src/shared/assistant-dates.js, src/shared/free-time.js, test/assistant-tools.test.js.

- [x] Write and run failing tests for date validation, weekdays/week ranges, merged busy/free intervals, working hours, schema checks and shared tools.
- [x] Extract existing definitions/handlers unchanged into createCalendarTools({sources, now}); expose definitions and execute(name,args). Keep MCP's five-tool list unchanged; add find_free_time for assistant use.
- [x] Implement resolveDateRange(start,end,now) and findFreeTime(events,range,minutes,hours,now) with 93-day and 20-slot bounds.
- [x] Run node --test and commit feat: share calendar tools and compute availability.

### Task 2: MiniCPM transport and assistant loop

Files: src/server/model-client.js, src/server/assistant.js, src/server/assistant-config.js, test/model-client.test.js, test/assistant.test.js.

- [x] Write failing tests for bare gateway retries, detailed errors, chunked UTF-8 NDJSON, missing done, three-failure circuit and cancellation.
- [x] Implement createModelClient({url,token,fetch,timeoutMs}) with health/chat methods, time/size bounds and sanitized public errors.
- [x] Write failing loop tests for multi-turn tool_calls, invalid arguments, caps, token exhaustion and ungrounded answers.
- [x] Implement createAssistant({client,tools,now}) with worked example, bounded sanitized results, streamed text and trusted sources. Config uses environment precedence and loopback-only URL validation.
- [x] Run node --test and commit feat: add bounded local model assistant.

### Task 3: Route, UI and documentation

Files: src/server/assistant-route.js, src/server/server.js, src/web/js/assistant-ui.js, src/web/css/assistant.css, src/web/index.html, test/assistant-route.test.js, test/assistant-ui.test.js, README.md, SECURITY.md, .env.example.

- [x] Write failing route tests for disabled mode, Origin/Host/header rejection, oversized/invalid questions, streamed answers, cancellation and busy state.
- [x] Implement guarded routes using readBody and existing security headers; wire shared sources without another listener.
- [x] Add native dialog launcher hidden until enabled, live plain-text streaming, status refresh, stop/close cancellation and trusted calendar navigation. Follow existing script order, main.js last.
- [x] Verify UI script/style references and safe rendering/focus contracts; document flags, privacy, timezone, layout and limits.
- [x] Run node --test, review diff, commit feat: expose accessible opt-in calendar chat.

## Execution ledger

- Planning: repository read; existing prompt is user-owned untracked input and will not be staged. No project dependencies or package-manager changes needed.
- Ruling: retain exactly five MCP tools while sharing definitions/handlers; find_free_time is assistant-only to preserve the existing MCP public contract and tests.
- Ruling: no model-emitted hyperlinks are activated. Tool-derived buttons provide navigation and are checked against known dates/uids, avoiding a model link parser attack surface.
- Ruling: loopback-only model URL prevents accidental calendar export to a remote host. Phase 2 deferred.

- Task 1 complete: shared tools, strict dates and deterministic availability; original MCP suite unchanged. Full suite at first commit: 88 pass, 1 existing Windows skip.
- Task 2 complete: injected fetch, NDJSON/final-done parsing, gateway-only retries, timeout/cancellation, circuit breaker and bounded tool loop. Full suite at second commit: 96 pass, 1 existing Windows skip.
- Task 3 complete: guarded routes, responsive native dialog, inert streamed output, trusted source navigation, README/SECURITY/config template. Real-server test uses disposable calendar data and fake MiniCPM, then stops that fake service and confirms calendar health.
- Independent review: fixed half-open range boundaries, cancelled-title filtering and invalid ISO end dates. Added red-to-green regressions for writable backpressure (queued output now waits for write callbacks) and MCP UTC date-only/seven-day compatibility in the protocol adapter. No original test changed.
- Final verification: node --test, 110 tests: 109 pass, 0 fail, 1 existing Windows SIGTERM skip. Sandbox localhost restrictions require an elevated test run. No dependencies added.
- Manual limitations: MiniCPM health at the default loopback URL was unreachable from this execution environment; actual 1B/2B answers were not verified. The in-app browser timed out opening the disposable loopback preview, so visual/real screen-reader checks remain unverified. VM behavior tests cover hidden disabled UI, inert text, source navigation and focus restoration. Preview server stopped after checks.
- Phase 2 intentionally skipped: no alert draft parsing or Laya tagging. Small-model hallucinations remain possible despite tool grounding; visible source data is the verification path.
