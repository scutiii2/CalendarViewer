// Text and time helpers for events and their detail dialog.
function eventFinishTime(event) {
  if (event.end) return event.end.getTime();
  const end = new Date(event.start);
  if (event.allDay) end.setDate(end.getDate() + 1);
  else end.setHours(end.getHours() + 1);
  return end.getTime();
}

function updateEventStatus() {
  document.querySelectorAll('.event-card[data-finish]').forEach(card => {
    card.classList.toggle('completed', Number(card.dataset.finish) <= Date.now());
  });
}

function renderDetailText(element, text) {
  const value = String(text || '');
  element.replaceChildren();
  let offset = 0;
  for (const match of value.matchAll(URL_PATTERN)) {
    element.append(document.createTextNode(value.slice(offset, match.index)));
    const url = readableUrl(match[0]);
    if (url) {
      element.append(externalLink(url.href, isTeamsMeeting(url) ? 'Join Teams meeting' : 'Open link'));
    } else element.append(document.createTextNode('[Link unavailable]'));
    offset = match.index + match[0].length;
  }
  element.append(document.createTextNode(value.slice(offset)));
}

function splitDescription(text) {
  const value = String(text || '').replace(/\r\n/g, '\n');
  const footer = /^\s*(?:Microsoft Teams(?: meeting)?\s*$|Join (?:the )?meeting(?: now)?\s*$|_{5,}|-{10,})/im.exec(value);
  if (!footer) return { description: value.trim(), footer: '' };
  return { description: value.slice(0, footer.index).trim(), footer: value.slice(footer.index).replace(/^\s*[_-]{5,}\s*/g, '').trim() };
}

function durationText(ms) {
  const minutes = Math.round(ms / 60000);
  if (!(minutes > 0)) return '';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return ' · ' + (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
}

function eventStatus(event, canceled) {
  if (canceled) return { state: 'canceled', text: 'Canceled' };
  if (event.allDay) return { state: 'upcoming', text: '' };
  const now = Date.now();
  const start = event.start.getTime();
  if (eventFinishTime(event) <= now) return { state: 'ended', text: 'Ended' };
  if (start <= now) return { state: 'live', text: 'In progress' };
  return { state: 'upcoming', text: 'Starts in ' + formatRemaining(start - now) };
}
