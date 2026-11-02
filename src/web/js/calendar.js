// The FullCalendar instance and its options. It is rendered by main.js.
function currentScrollTime() {
  const now = new Date();
  // Leave room above "now" so it lands near the middle of the visible grid.
  now.setMinutes(now.getMinutes() - 210, 0, 0);
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':00';
}

function focusCurrentTime() {
  const scrollTime = currentScrollTime();
  // The second frame waits for FullCalendar to finish sizing its scroller.
  requestAnimationFrame(() => requestAnimationFrame(() => calendar.scrollToTime(scrollTime)));
}

// The sync strip lives in <main> in the markup; move it once so it sits directly under FullCalendar's toolbar.
const syncStrip = document.getElementById('sync-strip');
function placeSyncStrip() {
  const toolbar = document.querySelector('#cal .fc-header-toolbar');
  if (toolbar && toolbar.nextElementSibling !== syncStrip) toolbar.after(syncStrip);
}
const setSyncState = state => { syncStrip.dataset.state = state; };
const upNextRail = document.getElementById('up-next');
const calBox = document.getElementById('cal');
const CLOCK = { hour: 'numeric', minute: '2-digit' };

const calendar = new FullCalendar.Calendar(calBox, {
  initialView,
  height: '100%',
  nowIndicator: true,
  nowIndicatorContent(arg) {
    if (!arg.isAxis) return undefined;
    return { domNodes: [create('span', 'now-chip', arg.date.toLocaleTimeString([], CLOCK).replace(/\s?[AP]M$/i, ''))] };
  },
  businessHours: businessHours(),
  eventDisplay: 'block',
  dayMaxEvents: 3,
  moreLinkClick: 'popover',
  moreLinkContent: arg => '+' + arg.num + ' more',
  fixedWeekCount: false,
  firstDay: 0,
  slotDuration: '00:30:00',
  scrollTime: currentScrollTime(),
  allDaySlot: false, // switched on in eventsSet only when the visible range has all-day events
  headerToolbar: { left: 'today prev,next title', center: '', right: 'timeGridDay,timeGridWorkWeek,timeGridWeek,dayGridMonth,listWeek' },
  buttonText: { today: 'Today', timeGridDay: 'Day', timeGridWorkWeek: 'Work week', timeGridWeek: 'Week', dayGridMonth: 'Month', listWeek: 'Agenda' },
  noEventsContent: () => searchQuery.trim() ? 'No events match your search in this date range.' : 'No events in this date range.',
  views: { timeGridWorkWeek: { type: 'timeGridWeek', weekends: false } },
  datesSet(arg) {
    store.set(VIEW_KEY, arg.view.type);
    if (arg.view.type.startsWith('timeGrid')) focusCurrentTime();
    showUpNext(arg.view.type === 'timeGridDay');
  },
  eventsSet(events) {
    const hasAllDay = events.some(e => e.allDay);
    if (calendar.getOption('allDaySlot') !== hasAllDay) {
      calendar.setOption('allDaySlot', hasAllDay);
      if (calendar.view.type.startsWith('timeGrid')) focusCurrentTime();
    }
    renderUpNext();
  },
  dayHeaderContent(arg) {
    const weekday = arg.date.toLocaleDateString(undefined, { weekday: 'short' });
    if (arg.view.type === 'dayGridMonth') return { html: weekday };
    return { html: weekday + '<span class="header-date">' + arg.date.getDate() + '</span>' };
  },
  eventContent(arg) {
    if (arg.view.type === 'listWeek') return agendaEventContent(arg);
    if (arg.view.type === 'dayGridMonth') {
      const chip = createEventCard(arg.event, 'month-chip');
      if (!arg.event.allDay && arg.timeText) chip.append(create('span', 'mc-time', arg.timeText));
      chip.append(create('span', 'mc-title', arg.event.title));
      appendConflictBadge(chip, arg.event.extendedProps.conflicts);
      appendEventBell(chip, arg.event);
      return { domNodes: [chip] };
    }
    const card = createEventCard(arg.event, arg.event.allDay ? 'all-day-card' : '');
    card.append(create('div', 'event-title', arg.event.title));
    if (appendEventBell(card, arg.event)) card.classList.add('has-alert');
    const memberships = arg.event.extendedProps.sourceDetails;
    if (memberships.length) {
      const dots = createSourceDots(memberships);
      dots.setAttribute('aria-label', memberships.map(s => s.name).join(', '));
      card.append(dots);
    }
    if (!arg.event.allDay && arg.timeText) card.append(create('div', 'event-time', arg.timeText));
    appendConflictBadge(card, arg.event.extendedProps.conflicts);
    return { domNodes: [card] };
  },
  events(info, ok, fail) {
    try {
      const events = expandSources(sources, info.start, info.end);
      const eligible = markConflicts(visibleEvents(events, hideCancelled));
      const matches = eligible.filter(event => CalendarSearch.matches(event, searchQuery));
      updateSearchStatus(matches.length, eligible.length);
      ok(matches);
    } catch (e) { fail(e); }
  },
  eventClick({ event }) {
    showEventDialog(event);
  }
});
