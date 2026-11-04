# Responsive Calendar Viewer

Approved direction: the portrait three-day calendar and mobile daily agenda mockups reviewed in this chat.

Use the existing purple Fluent-inspired palette, live ICS sources, search, event dialogs, alerts, refresh and settings. At widths up to 600px use a daily agenda with a week date picker. At widths up to 1100px, or in portrait orientation, use a three-day calendar with an agenda alternative. Wider landscape screens retain their existing desktop interface.

Compact layouts have an app header, date navigation, week picker, live Up next card and bottom navigation. Calendar sources and settings open the existing sidebar as a keyboard-accessible drawer. Event details remain native dialogs and become bottom sheets on phones. No sample content ships.

Approaches considered: squeezing the desktop week grid onto phones would make events unreadable; replacing the calendar with a separate custom engine would duplicate recurrence and filtering behavior. Extend the existing FullCalendar views and reuse the sidebar and event dialogs instead.

Each layout remembers its own view preference. Resize and rotation preserve the selected date and restore the destination layout's view. Both themes, all-day events, search, disabled sources and backup validation must continue to work. No new dependencies or server behavior.
