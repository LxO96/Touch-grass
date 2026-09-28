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
    h.textContent = L.months[m];
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

   A quick tap used to change a day, which made it far too easy to edit
   the year by scrolling past it. Now a tap only says what the day holds;
   holding it for half a second cycles it none -> 1 -> 2 -> 3 -> none,
   with a buzz so you know it took. From the keyboard, Enter still edits:
   there is no long-press on a keyboard. */

const HOLD_MS = 500;

function dayNote(key) {
  const n = visitsOn(key);
  const L = T().ui;
  const note = $('day-note');
  if (note) note.textContent = `${key} — ${L.tripsOn(n)}. ${L.holdToChange}`;
}

function bumpDay(key) {
  setVisits(key, (visitsOn(key) + 1) % 4);
  try { if (navigator.vibrate) navigator.vibrate(25); } catch {}
  renderRecord();
  dayNote(key);
}

function wireDayTaps(hostId) {
  const host = $(hostId);
  let timer = null, startX = 0, startY = 0, held = false;

  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

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
      bumpDay(cell.dataset.key);
    }, HOLD_MS);
  });

  // A finger that moves is scrolling, not holding.
  host.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
      cancel();
      host.querySelectorAll('.holding').forEach((c) => c.classList.remove('holding'));
    }
  });

  const release = () => {
    cancel();
    host.querySelectorAll('.holding').forEach((c) => c.classList.remove('holding'));
  };
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);
  host.addEventListener('pointerleave', release);

  // Long-press would otherwise open the phone's own menu.
  host.addEventListener('contextmenu', (e) => e.preventDefault());

  host.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-key]');
    if (!cell || cell.disabled) return;
    if (held) { held = false; return; }          // the hold already changed it
    if (e.detail === 0) bumpDay(cell.dataset.key); // Enter / Space
    else dayNote(cell.dataset.key);                // a tap only reports
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
