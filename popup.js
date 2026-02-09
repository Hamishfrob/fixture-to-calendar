const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const eventsEl = document.getElementById('events');
const eventListEl = document.getElementById('eventList');
const eventCountEl = document.getElementById('eventCount');
const errorMessageEl = document.getElementById('errorMessage');
const downloadBtn = document.getElementById('downloadBtn');
const retryBtn = document.getElementById('retryBtn');

let currentEvents = [];

// Poll for parsing results from the background script
function pollForResults() {
  chrome.storage.local.get(['parsingState', 'parsedEvents', 'parseError'], (result) => {
    if (result.parsingState === 'loading') {
      setTimeout(pollForResults, 300);
      return;
    }

    if (result.parsingState === 'error') {
      showError(result.parseError || 'Something went wrong while parsing.');
      return;
    }

    if (result.parsingState === 'done' && result.parsedEvents) {
      currentEvents = result.parsedEvents;
      showEvents(currentEvents);
    }
  });
}

pollForResults();

function showError(message) {
  loadingEl.style.display = 'none';
  errorEl.style.display = 'block';
  eventsEl.style.display = 'none';
  errorMessageEl.textContent = message;
}

function showEvents(events) {
  loadingEl.style.display = 'none';
  errorEl.style.display = 'none';
  eventsEl.style.display = 'block';

  const plural = events.length === 1 ? 'event' : 'events';
  eventCountEl.textContent = `Found ${events.length} ${plural} — edit any details below before downloading.`;

  eventListEl.innerHTML = '';
  events.forEach((event, index) => {
    const card = createEventCard(event, index);
    eventListEl.appendChild(card);
  });
}

function createEventCard(event, index) {
  const card = document.createElement('div');
  card.className = 'event-card';
  card.dataset.index = index;

  card.innerHTML = `
    <button class="remove-btn" title="Remove this event" data-index="${index}">&times;</button>
    <div class="field">
      <label>Title</label>
      <input type="text" data-field="title" value="${escapeHtml(event.title || '')}">
    </div>
    <div class="row">
      <div class="field">
        <label>Date</label>
        <input type="text" data-field="date" value="${escapeHtml(event.date || '')}" placeholder="DD/MM/YYYY">
      </div>
      <div class="field">
        <label>Start Time</label>
        <input type="text" data-field="startTime" value="${escapeHtml(event.startTime || '')}" placeholder="HH:MM">
      </div>
      <div class="field">
        <label>End Time</label>
        <input type="text" data-field="endTime" value="${escapeHtml(event.endTime || '')}" placeholder="HH:MM">
      </div>
    </div>
    <div class="field">
      <label>Location</label>
      <input type="text" data-field="location" value="${escapeHtml(event.location || '')}" placeholder="Optional">
    </div>
  `;

  // Remove button
  card.querySelector('.remove-btn').addEventListener('click', () => {
    currentEvents.splice(index, 1);
    showEvents(currentEvents);
  });

  // Update event data when fields change
  card.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', () => {
      const field = input.dataset.field;
      currentEvents[index][field] = input.value;
    });
  });

  return card;
}

// Download .ics file
downloadBtn.addEventListener('click', () => {
  // Read latest values from inputs before generating
  document.querySelectorAll('.event-card').forEach((card) => {
    const idx = parseInt(card.dataset.index);
    card.querySelectorAll('input').forEach(input => {
      currentEvents[idx][input.dataset.field] = input.value;
    });
  });

  const icsContent = generateICS(currentEvents);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'fixtures.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Show success message
  const existing = document.querySelector('.download-success');
  if (existing) existing.remove();
  const msg = document.createElement('p');
  msg.className = 'download-success';
  msg.textContent = 'Downloaded! Open the file to add events to Outlook.';
  document.querySelector('.actions').appendChild(msg);
});

// Retry button — close window and let user try again
retryBtn.addEventListener('click', () => {
  window.close();
});

// Generate .ics file content
function generateICS(events) {
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FixtureToCalendar//EN\r\nCALSCALE:GREGORIAN\r\n';

  events.forEach(event => {
    const { dtStart, dtEnd } = parseDateTimes(event.date, event.startTime, event.endTime);
    const uid = generateUID();

    ics += 'BEGIN:VEVENT\r\n';
    ics += `UID:${uid}\r\n`;
    ics += `DTSTART:${dtStart}\r\n`;
    ics += `DTEND:${dtEnd}\r\n`;
    ics += `SUMMARY:${escapeICS(event.title)}\r\n`;
    if (event.location) {
      ics += `LOCATION:${escapeICS(event.location)}\r\n`;
    }
    ics += `DTSTAMP:${formatICSDate(new Date())}\r\n`;
    ics += 'END:VEVENT\r\n';
  });

  ics += 'END:VCALENDAR\r\n';
  return ics;
}

function parseDateTimes(dateStr, startTimeStr, endTimeStr) {
  // Parse DD/MM/YYYY
  const parts = dateStr.split('/');
  const day = parts[0].padStart(2, '0');
  const month = parts[1].padStart(2, '0');
  const year = parts[2];

  // Parse HH:MM
  const startParts = startTimeStr.split(':');
  const startHour = startParts[0].padStart(2, '0');
  const startMin = startParts[1].padStart(2, '0');

  const endParts = endTimeStr.split(':');
  const endHour = endParts[0].padStart(2, '0');
  const endMin = endParts[1].padStart(2, '0');

  // Format as iCalendar datetime (local time)
  const dtStart = `${year}${month}${day}T${startHour}${startMin}00`;
  const dtEnd = `${year}${month}${day}T${endHour}${endMin}00`;

  return { dtStart, dtEnd };
}

function formatICSDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

function generateUID() {
  return 'ftc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9) + '@fixture-to-calendar';
}

function escapeICS(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/"/g, '&quot;');
}
