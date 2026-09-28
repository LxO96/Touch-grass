/* ==========================================================
   TOUCH GRASS — the record page
   Needs scoring.js, lang.js and core.js loaded first.
   ========================================================== */

/* ==========================================================
   RENDER — the record

   Two views of the same log. The month grid is the one you
   actually tap: a year of 365 squares can never give a finger
   a fair target, so it is the overview and the month is the
   instrument.
   ========================================================== */

const level = (n) => (n >= 3 ? 3 : n === 2 ? 2 : n === 1 ? 1 : 0);

const CAL = { view: loadCalView(), month: new Date().getMonth(), year: new Date().getFullYear() };

function loadCalView() {
  try {
    const v = localStorage.getItem('touchgrass.calview');
    if (v === 'month' || v === 'year') return v;
  } catch { /* fall through */ }
  // Default to whichever suits the screen you're on.
  return window.matchMedia('(max-width: 700px)').matches ? 'month' : 'year';
}

function saveCalView(v) {
  CAL.view = v;
  try { localStorage.setItem('touchgrass.calview', v); } catch {}
}

function renderRecord() {
  const log = getLog();
  const L = T().ui;
  const st = streakInfo(log);

  $('cal-year').textContent = new Date().getFullYear();
  $('st-streak').textContent = st.current;
  $('st-days').textContent   = st.daysThisYear;
  $('st-trips').textContent  = st.tripsThisYear;
  $('st-best').textContent   = st.longest;

  const since = $('since');
  if (since) since.textContent = lastOutText(lastOut(log));

  $('view-month').classList.toggle('on', CAL.view === 'month');
  $('view-year').classList.toggle('on', CAL.view === 'year');
  $('month-view').style.display = CAL.view === 'month' ? '' : 'none';
  $('year-view').style.display  = CAL.view === 'year' ? '' : 'none';

  if (CAL.view === 'month') renderMonth(log, L);
  else renderYear(log, L);
}

/* ---------- month: thumb-sized targets ---------- */

function renderMonth(log, L) {
  const todayK = todayKey();
  $('month-name').textContent = `${L.monthsLong[CAL.month]} ${CAL.year}`;

  const head = $('mgrid-head');
  head.innerHTML = '';
  for (const d of L.weekdays) {
    const s = document.createElement('span');
    s.textContent = d;
    head.append(s);
  }

  const grid = $('mgrid');
  grid.innerHTML = '';

  const first = new Date(CAL.year, CAL.month, 1);
  const lead = (first.getDay() + 6) % 7;           // Monday-first
  const days = new Date(CAL.year, CAL.month + 1, 0).getDate();

  for (let i = 0; i < lead; i++) {
    const blank = document.createElement('span');
    blank.className = 'mcell blank';
    grid.append(blank);
  }

  for (let day = 1; day <= days; day++) {
    const key = dayKey(new Date(CAL.year, CAL.month, day));
    const n = log[key] || 0;

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `mcell lv${level(n)}`;
    cell.dataset.key = key;
    if (key === todayK) cell.classList.add('today');
    if (key > todayK) { cell.classList.add('future'); cell.disabled = true; }

    const num = document.createElement('span');
    num.className = 'mnum';
    num.textContent = day;
    cell.append(num);

    if (n > 0) {
      const dots = document.createElement('span');
      dots.className = 'mdots';
      dots.textContent = '•'.repeat(Math.min(n, 3)) + (n > 3 ? '+' : '');
      cell.append(dots);
    }

    cell.title = `${key} — ${L.tripsOn(n)}`;
    grid.append(cell);
  }
}

/* ---------- year: the whole thing at a glance ---------- */

function renderYear(log, L) {
  const year = new Date().getFullYear();
  const todayK = todayKey();
  const cal = $('cal');
  cal.innerHTML = '';

  // Twelve columns, one per month; thirty-one rows, one per day of the
  // month. Reads like a wall calendar, and fits a phone without scrolling.
  const corner = document.createElement('span');
  corner.className = 'yc-corner';
  cal.append(corner);
  for (let m = 0; m < 12; m++) {
    const h = document.createElement('span');
    h.className = 'yc-month';
    // Initials: three letters would overlap at this size. The full name
    // is still there for a hover or a screen reader.
    h.textContent = L.months[m].charAt(0);
    h.title = L.monthsLong[m];
    h.setAttribute('aria-label', L.monthsLong[m]);
    cal.append(h);
  }

  for (let d = 1; d <= 31; d++) {
    const num = document.createElement('span');
    num.className = 'yc-day';
    num.textContent = d % 5 === 0 || d === 1 ? String(d) : '';
    cal.append(num);

    for (let m = 0; m < 12; m++) {
      const date = new Date(year, m, d);
      if (date.getMonth() !== m) {           // 30 February and the like
        const blank = document.createElement('span');
        blank.className = 'cell blank';
        cal.append(blank);
        continue;
      }
      const key = dayKey(date);
      const n = log[key] || 0;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `cell lv${level(n)}`;
      cell.dataset.key = key;
      if (key === todayK) cell.classList.add('today');
      if (key > todayK) { cell.classList.add('future'); cell.disabled = true; }
      cell.title = `${key} — ${L.tripsOn(n)}`;
      cal.append(cell);
    }
  }
}

/* ---------- press and hold a day to change it ----------

   A quick tap only says what the day holds — scrolling past the grid
   must never edit the year. Pressing and holding for half a second opens
   a small popup to set the day's trips, with a buzz so you know it took.
   From the keyboard, Enter opens it: there is no long-press on a
   keyboard. */

const HOLD_MS = 500;
let dayOpen = null;   // the key the popup is showing

function dayNote(key) {
  const L = T().ui;
  const note = $('day-note');
  if (note) note.textContent = `${key} — ${L.tripsOn(visitsOn(key))}. ${L.holdToChange}`;
}

function paintDayDialog() {
  const L = T().ui;
  const n = visitsOn(dayOpen);
  const d = new Date(dayOpen + 'T00:00:00');
  $('day-title').textContent = `${d.getDate()} ${L.monthsLong[d.getMonth()]}`;
  $('day-count').textContent = String(n);
  $('day-words').textContent = L.tripsOn(n);
  $('day-less').disabled = n <= 0;
  $('day-more').disabled = n >= TRIPS_MAX;
}

function openDay(key) {
  dayOpen = key;
  // The app buzzes natively: Chrome refuses navigator.vibrate before a tap,
  // and a long-press is not one. In a browser, try anyway.
  try {
    if (typeof TouchGrassAndroid !== 'undefined' && TouchGrassAndroid.buzz) TouchGrassAndroid.buzz();
    else if (navigator.vibrate) navigator.vibrate(25);
  } catch {}
  paintDayDialog();
  const dlg = $('day-dialog');
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  $('day-done').focus();
}

function stepDay(delta) {
  if (!dayOpen) return;
  setVisits(dayOpen, stepTrips(visitsOn(dayOpen), delta));
  renderRecord();
  paintDayDialog();
  dayNote(dayOpen);
}

function closeDay() {
  const dlg = $('day-dialog');
  if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
}

$('day-less').addEventListener('click', () => stepDay(-1));
$('day-more').addEventListener('click', () => stepDay(+1));
$('day-done').addEventListener('click', closeDay);
// A tap on the dimmed backdrop, outside the box, closes it too.
$('day-dialog').addEventListener('click', (e) => {
  if (e.target === $('day-dialog')) closeDay();
});
$('day-dialog').addEventListener('close', () => { dayOpen = null; });

function wireDayTaps(hostId) {
  const host = $(hostId);
  let timer = null, startX = 0, startY = 0, held = false;

  const clearHold = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    host.querySelectorAll('.holding').forEach((c) => c.classList.remove('holding'));
  };

  host.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('[data-key]');
    if (!cell || cell.disabled) return;
    held = false;
    startX = e.clientX; startY = e.clientY;
    cell.classList.add('holding');
    timer = setTimeout(() => {
      timer = null;
      held = true;
      cell.classList.remove('holding');
      openDay(cell.dataset.key);
    }, HOLD_MS);
  });

  // A finger that moves is scrolling, not holding.
  host.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) clearHold();
  });
  host.addEventListener('pointerup', clearHold);
  host.addEventListener('pointercancel', clearHold);
  host.addEventListener('pointerleave', clearHold);

  // Long-press would otherwise open the phone's own menu.
  host.addEventListener('contextmenu', (e) => e.preventDefault());

  host.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-key]');
    if (!cell || cell.disabled) return;
    if (held) { held = false; return; }            // the hold already opened it
    if (e.detail === 0) openDay(cell.dataset.key);  // Enter / Space
    else dayNote(cell.dataset.key);                 // a tap only reports
  });
}

wireDayTaps('mgrid');
wireDayTaps('cal');

$('view-month').addEventListener('click', () => { saveCalView('month'); renderRecord(); });
$('view-year').addEventListener('click', () => { saveCalView('year'); renderRecord(); });

$('prev-month').addEventListener('click', () => {
  CAL.month--;
  if (CAL.month < 0) { CAL.month = 11; CAL.year--; }
  renderRecord();
});

$('next-month').addEventListener('click', () => {
  const now = new Date();
  // No point walking into months that haven't happened.
  if (CAL.year > now.getFullYear() ||
      (CAL.year === now.getFullYear() && CAL.month >= now.getMonth())) return;
  CAL.month++;
  if (CAL.month > 11) { CAL.month = 0; CAL.year++; }
  renderRecord();
});

/* ---------- go ---------- */

applyStatic();
renderRecord();

// Logged a trip on the other page, or in another tab? Catch up.
window.addEventListener('storage', (e) => {
  if (e.key === LOG_KEY || e.key === 'touchgrass.lang') {
    applyStatic();
    renderRecord();
  }
});
