# Search, backup and snooze implementation plan

Goal: finish the three improvements selected in chat without adding dependencies or changing the read-only source calendars.

Design: search titles/locations in the displayed date range, preserve real overlap annotations before filtering, and add FullCalendar's bundled weekly list view as Agenda. Remember the selected view.

Backups contain versioned JSON with feed registrations, imported ICS files, source preferences, alert rules, theme, working hours, refresh interval, hide-cancelled choice and selected view. Validate and preview before replacement. Preserve a recovery snapshot and rollback on failure. Private feed URLs belong only in the downloaded local backup and existing private runtime storage. Do not include fired or pending notifications in exported backups.

Snooze is a five-minute deferred reminder owned by the background server and saved across restarts. In-app buttons call the same scheduler as Windows buttons. Windows uses a single-use random capability URL opening a local confirmation page; no custom protocol registration is required. Revalidate the current event, source visibility, cancellation and alert rules before redelivery; never snooze past an event's start. The page displays delivered snoozes once and suppresses ordinary alerts while that occurrence is snoozed. An unavailable server produces a visible failure without dismissing the original toast.

- [x] Implement and test search/agenda independently.
- [x] Implement and test backup validation, export, replacement and recovery.
- [x] Implement and test persistent snoozes, single-use Windows actions, cancellation, mute and restart behavior.
- [x] Wire server routes and browser controls, including guarded private backup endpoints and restore storage rollback.
- [x] Run all tests, inspect synthetic UI, review changes and update README.

Verification: all 51 Node tests pass. JavaScript, PowerShell syntax and diff whitespace checks pass. Synthetic browser verification covered location search, no matches, clearing search, remembered Agenda view, backup download/import/preview/apply/reload and in-app snooze confirmation. Native notification delivery was suppressed in the preview; Windows protocol-action generation and single-use handling are covered through the scheduler and local HTTP tests.

Review corrections: atomically replace alert state on disk, compensate lost restore responses without overwriting recovery, pause synchronization if recovery cannot be confirmed, build deferred occurrences from fresh sources before deduplication, and allow an initially idle scheduler to refresh after alert rules are configured.

Approach: use the bundled list view and shared pure matching/validation helpers, a focused backup service and a persistent reminder queue. This keeps scheduling on the existing server and avoids platform installation work.
