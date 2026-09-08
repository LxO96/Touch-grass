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

  const gutter = document.createElement('div');
  gutter.className = 'cal-gutter';
  [L.weekdays[0], '', L.weekdays[2], '', L.weekdays[4], '', L.weekdays[6]].forEach((d) => {
    const s = document.createElement('span');
    s.textContent = d;
    gutter.append(s);
  });

  const grid = document.createElement('div');
  grid.className = 'cal-grid';

  const jan1 = new Date(year, 0, 1);
  const lead = (jan1.getDay() + 6) % 7;
  const dec31 = new Date(year, 11, 31);
  const totalDays = Math.round((dec31 - jan1) / 86400000) + 1;
  const weeks = Math.ceil((lead + totalDays) / 7);

  grid.style.gridTemplateColumns = `repeat(${weeks}, var(--cell))`;

  const months = document.createElement('div');
  months.className = 'cal-months';
  months.style.gridTemplateColumns = `repeat(${weeks}, var(--cell))`;
  for (let m = 0; m < 12; m++) {
    const firstOfMonth = new Date(year, m, 1);
    const col = Math.floor((lead + Math.round((firstOfMonth - jan1) / 86400000)) / 7) + 1;
    const s = document.createElement('span');
    s.textContent = L.months[m];
    s.style.gridColumn = `${col} / span 4`;
    months.append(s);
  }

  for (let i = 0; i < lead; i++) {
    const blank = document.createElement('span');
    blank.className = 'cell blank';
    grid.append(blank);
  }

  for (let i = 0; i < totalDays; i++) {
    const key = dayKey(new Date(year, 0, 1 + i));
    const n = log[key] || 0;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `cell lv${level(n)}`;
    cell.dataset.key = key;
    if (key === todayK) cell.classList.add('today');
    if (key > todayK) { cell.classList.add('future'); cell.disabled = true; }
    cell.title = `${key} — ${L.tripsOn(n)}`;
    grid.append(cell);
  }

  const stack = document.createElement('div');
  stack.className = 'cal-stack';
  stack.append(months, grid);
  cal.append(gutter, stack);
}

/* ---------- tapping a day cycles it: none -> 1 -> 2 -> 3 -> none ---------- */

function wireDayTaps(hostId) {
  $(hostId).addEventListener('click', (e) => {
    const cell = e.target.closest('[data-key]');
    if (!cell || cell.disabled) return;
    const key = cell.dataset.key;
    setVisits(key, (visitsOn(key) + 1) % 4);
    renderRecord();
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
