# Responsive Calendar Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. User authorized implementation of the approved mockup in this chat; execute in the current workspace.

**Goal:** Support portrait and mobile screens with the approved responsive calendar design.

**Architecture:** Reuse FullCalendar's timeGrid and list views, add compact navigation and an accessible sidebar drawer. A dependency-free layout policy supplies consistent breakpoints and allowed/default views; preferences remain separate per layout.

**Tech Stack:** Classic browser JavaScript, CSS, FullCalendar, Node test runner.

**Spec:** docs/superpowers/specs/2026-11-04-responsive-calendar-design.md

## Global Constraints

- No new dependencies or server behavior.
- Reuse live calendar sources and existing search, alerts, dialogs and settings.
- Preserve desktop behavior and the selected date when rotating/resizing.

## Review Focus

- Rotation must preserve dates and desktop view preferences.
- Empty days, all-day and overlapping events remain usable.
- Disabled sources and cancelled events must not appear in Up next.
- Drawer focus, Escape and backdrop dismissal must work, including source menus.
- At 320px and in dark mode, content and dialogs must fit.

### Task 1: Layout policy and calendar views

**Files:** src/shared/calendar-layout.js, src/shared/alert-logic.js, src/web/js/state.js, src/web/js/calendar.js, test/responsive.test.js

**Interfaces:** CalendarLayout.mode(width, height), profile(mode), view(mode, saved), viewKey(mode, base), week(date). Shared browser/CommonJS module.

- [x] Write and run failing policy tests for boundaries, saved-view isolation, unsupported preferences, and weeks crossing a year boundary.
- [x] Implement policy and integrate calendar initialization/view persistence; add timeGridThreeDay and listDay to supported views.
- [x] Run responsive and script-order tests.

### Task 2: Compact interface and drawer

**Files:** src/web/index.html, src/web/css/responsive.css, src/web/js/responsive-ui.js, src/web/js/up-next.js, src/web/js/main.js, README.md

**Interfaces:** initResponsiveUI(), renderCompactCalendar(), renderCompactNext(); consume CalendarLayout and the existing calendar instance.

- [x] Add compact chrome, week navigation, view controls and upcoming card using real calendar data.
- [x] Reuse the existing sidebar as a modal drawer with focus restoration, Escape/backdrop dismissal, and sources/settings navigation.
- [x] Add theme-aware responsive styles and phone event sheets; remove unsupported-screen blocker.
- [x] Verify with node --test and a browser at desktop, portrait, mobile and 320px widths; inspect resize, search, source visibility and details.
- [x] Update README with supported layouts and record final verification.

## Final verification

- `node --test`: 70 passed, 0 failed, 1 platform-specific skip. Run outside the sandbox because its temporary-file rename and loopback HTTP restrictions prevent server tests from working.
- Browser: 320×740 and 390×844 mobile, 768×1024 portrait, 1366×900 desktop; light and dark appearance; selected date and independent views preserved across resizing; empty days; search; enabled-source filtering; all-day and overlapping events; event details by click and Enter; drawer focus wrap, Escape, and source-menu Escape.
- Independent review found a backup view restore regression. Added a failing regression test using the real validator and storage writer, then fixed restore to atomically replace each layout's preference with an appropriate restored view. Final suite passed afterward.
- `git diff --check`: clean. No dependencies added, deployment or commit performed.
