# Calendar improvements implementation plan

Goal: implement the three improvements selected in chat: cancellation display, conflict indicators, and sync health.

Design: extend the existing shared logic and vanilla JavaScript UI without dependencies. Keep cancellation detection consistent with existing title matching and ICS status filtering. Remember the hide-cancelled preference without changing alert rules. Detect overlaps after event deduplication, excluding cancelled and all-day events; touching endpoints do not overlap. Show conflicting titles in details. Show per-feed page and background refresh timestamps, failures and stale data; imported files are labelled local. Retain the last successful snapshot after refresh failure.

Approach: use shared pure functions for cancellation, overlap annotation and sync-state classification, rather than independent UI-only checks. Keep page and background timestamps separate because their refresh schedules differ. The page becomes stale after twice its configured refresh interval, with a ten-minute minimum; background data becomes stale after ten minutes. No background refresh is expected when no alert offsets are configured.

- [x] Add regression tests for cancellation filtering, overlap boundaries, and sync-state classification; observe failures and implement shared functions.
- [x] Add tests for background refresh failure/recovery and implement status reporting without losing cached events.
- [x] Connect the hide switch, disabled cancelled-event alert UI, conflict badges/details and per-source sync labels.
- [x] Update README, run the full Node test suite, check JavaScript syntax and inspect the UI using synthetic calendars.

Verification: 23 Node tests pass, JavaScript syntax and diff whitespace checks pass. Browser checks with synthetic calendars confirm cancelled controls, restored active controls, overlap details, retained failed-feed data and hide-preference persistence. Review identified batch-completion timestamps and overlapping refresh races; feed results now update individually and concurrent refresh requests queue one follow-up batch, with regression coverage.

Review focus: duplicate events must not conflict with themselves; back-to-back meetings remain unmarked; cancelled events never affect conflicts or alerts; refresh failures preserve successful timestamps; failed new feeds remain visible and polling does not disturb active source menus.
