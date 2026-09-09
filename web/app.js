/* ==========================================================
   TOUCH GRASS — the Today page
   Needs core.js loaded first.
   ========================================================== */

const STATE = { place: null, data: null, stale: null, fetchedAt: null };

/* ----------------------------------------------------------
   A phone loses signal in ways a laptop doesn't, and opening
   the app in a dead zone to be told "no idea" is useless. Keep
   the last forecast so there's still an answer — but only for a
   few hours, and always say when it was fetched. A stale verdict
   presented as live would be worse than no verdict.
   ---------------------------------------------------------- */

const FORECAST_KEY = 'touchgrass.forecast';
const MAX_STALE_MS = 6 * 60 * 60 * 1000;

function cacheForecast(place, data) {
  try {
    localStorage.setItem(FORECAST_KEY,
      JSON.stringify({ at: Date.now(), place, data }));
  } catch {}
}

function loadCachedForecast(place) {
  try {
    const c = JSON.parse(localStorage.getItem(FORECAST_KEY) || 'null');
    if (!c || !c.data || !c.data.now) return null;
    if (Date.now() - c.at > MAX_STALE_MS) return null;
    // Don't answer for Gothenburg using yesterday's Lisbon.
    if (place && c.place &&
        (Math.abs(c.place.lat - place.lat) > 0.4 ||
         Math.abs(c.place.lon - place.lon) > 0.4)) return null;
    return c;
  } catch { return null; }
}

const clockTime = (ms) => new Date(ms)
  .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/* ==========================================================
   DATA
   ========================================================== */

const OM_URL = (lat, lon) => 'https://api.open-meteo.com/v1/forecast'
  + `?latitude=${lat}&longitude=${lon}`
  + '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day'
  + '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day'
  + '&daily=sunset&forecast_days=2&timezone=auto';

const MET_URL = (lat, lon) =>
  `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`;

const SMHI_URL = (lat, lon) =>
  'https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1'
  + `/geotype/point/lon/${lon.toFixed(4)}/lat/${lat.toFixed(4)}/data.json`;

/* One source failing must not cost us the other two, so each is
   allowed to come back null. SMHI answers only for the Nordics and
   404s elsewhere, which is not an error worth reporting — it is the
   blend degrading exactly as designed. */
async function fetchOrNull(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getWeather(lat, lon) {
  const [om, met, smhi] = await Promise.all([
    fetchOrNull(OM_URL(lat, lon)),
    fetchOrNull(MET_URL(lat, lon)),
    fetchOrNull(SMHI_URL(lat, lon))
  ]);

  const f = tgForecast({ om, met, smhi });
  if (!f) throw new Error('No weather service answered');

  // hourLabel is the page's business, not the blend's.
  for (const h of f.ahead) h.label = T().hourLabel(h.hour);
  return f;
}

// Scores depend on settings, so they're recomputed on every render
// rather than baked in when the forecast arrives.
function rescore(data, s) {
  for (const h of data.ahead) h.score = scoreHour(h, s);
}

async function geocode(name) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Search is down');
  const d = await res.json();
  return d.results || [];
}

// Open-Meteo's geocoder is forward-only — there is no reverse lookup to ask
// for a town name, and sending coordinates to some other company's API just
// to print a label isn't a trade worth making. Coordinates it is; the search
// box below names the spot properly if you'd rather see a name.
function coordLabel(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/* ==========================================================
   RENDER — the verdict half
   ========================================================== */

function renderVerdict() {
  const { data, place } = STATE;
  const visits = visitsToday();

  if (!data) { renderToday(visits); return; }

  const s = getSettings();
  rescore(data, s);
  const v = decide(data.now, data.ahead, visits, s);

  const card = $('verdict');
  card.classList.remove('go', 'wait', 'anyways', 'stayin');
  card.classList.add(v.state);
  $('banner-tag').textContent = v.tag;
  $('verdict-line').textContent = v.line;
  $('verdict-sub').textContent = v.sub;
  $('meter-fill').style.width = v.score + '%';
  $('meter-label').textContent =
    `${T().ui.outsideAbility} ${v.score}/100 — ${T().ui.barIs} ${s.bar}`;

  const n = data.now;
  $('place').textContent = (place ? place.label : T().ui.somewhere)
    + (STATE.stale ? ` — ${T().ui.lastChecked(clockTime(STATE.stale))}` : '');
  $('place').classList.toggle('stale', !!STATE.stale);
  const u = getUnits();
  $('s-sky').textContent   = skyName(n.code);
  $('s-temp').textContent  = fmtTemp(n.temp, u);
  $('s-feels').textContent = fmtTemp(n.feels, u);
  $('s-wind').textContent  = fmtWind(n.wind, u);
  $('s-rain').textContent  = T().ui.chanceOf(Math.round(n.pop));

  renderTrends(data, s);

  renderToday(visits);
  renderChart(data, s);
  pushWidget(v, place);

  const credit = $('fetched-at');
  if (credit) {
    credit.textContent = T().ui.updated(clockTime(STATE.stale || STATE.fetchedAt || Date.now()));
  }

  const blend = $('blend-sources');
  if (blend) {
    const NAMES = { met: 'MET Norway (YR)', smhi: 'SMHI', om: 'Open-Meteo' };
    const list = data.sources || [];
    const w = tgWeigh(list);
    blend.textContent = list.length
      ? `${T().ui.blendedFrom} ` + list
          .map((k) => T().ui.sourceWeight(NAMES[k], Math.round(w[k] * 100)))
          .join(', ')
      : '';
  }
}

/* The page has just worked out the verdict; hand it to the widget so it
   refreshes the moment you open the app or log a trip, rather than
   waiting up to an hour for the next background check. */
function pushWidget(v, place) {
  try {
    if (typeof TouchGrassAndroid === 'undefined' ||
        !TouchGrassAndroid.syncWidget) return;
    const d = v.decision;
    const n = STATE.data ? STATE.data.now : {};
    const tr = STATE.data ? tgTrends(STATE.data.now, STATE.data.ahead, getSettings()) : null;
    TouchGrassAndroid.syncWidget(JSON.stringify({
      score: d.score,
      state: d.state,
      target: d.target ? d.target.label : null,
      place: place ? place.label : '',
      outlook: tr ? tr.outlook.mood : null,
      best: tr ? tr.outlook.best : 0,
      tempDir: tr ? tr.temp.dir : null,
      rainDir: tr ? tr.rain.dir : null,
      windDir: tr ? tr.wind.dir : null,
      // Raw readings: the widget formats them to your unit settings.
      code: n.code,
      tempC: n.feels,
      windKmh: n.wind,
      pop: Math.round(n.pop),
      sunset: STATE.data ? STATE.data.sunsetMin : null
    }));
  } catch { /* the page works fine without a widget */ }
}

function renderToday(visits) {
  const L = T().ui;
  $('count').textContent = visits === 0 ? L.notYet
    : visits === 1 ? L.onceSoFar : L.timesToday(visits);
  $('count').classList.toggle('zero', visits === 0);
  $('btn-undo').disabled = visits === 0;
  $('btn-undo').title = L.undoTitle;

  const st = streakInfo();
  $('streak-note').textContent = visits === 0
    ? (st.current > 0 ? L.streakRunning(st.current) : L.noStreak)
    : L.logged(st.current);

  const since = $('since');
  if (since) since.textContent = lastOutText(lastOut());
}

/* Which hour's breakdown is open, by its index in the chart, or null.
   Kept across re-renders so changing a dial in another tab doesn't
   slam the panel shut mid-read. */
let openHour = null;

function renderChart(data, s) {
  const chart = $('chart');
  chart.innerHTML = '';
  const cols = [{ label: T().ui.notYet === 'Not yet' ? 'now' : 'nu',
                  score: scoreHour(data.now, s), isNow: true, hour: data.now }]
    .concat(data.ahead.slice(0, 11).map((h) => ({
      label: String(h.hour).padStart(2, '0'), score: h.score, isNow: false, hour: h
    })));

  cols.forEach((c, i) => {
    const col = document.createElement('div');
    col.className = 'bar-col';

    // A button, not a div: the breakdown has to be reachable by
    // keyboard and readable to a screen reader, not just tappable.
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'bar ' + (c.score >= s.bar ? 'good' : c.score >= 35 ? 'meh' : 'bad')
                  + (c.isNow ? ' now' : '') + (i === openHour ? ' open' : '');
    bar.style.height = Math.max(4, c.score) + '%';
    bar.title = `${c.label}: ${c.score}/100`;
    bar.setAttribute('aria-expanded', String(i === openHour));
    bar.setAttribute('aria-label', `${c.label}: ${c.score}/100`);
    bar.addEventListener('click', () => {
      openHour = (openHour === i) ? null : i;
      renderChart(data, s);
      renderWhy(cols, s);
    });

    const lbl = document.createElement('span');
    lbl.className = 'bar-hr';
    lbl.textContent = c.label;

    col.append(bar, lbl);
    chart.append(col);
  });

  renderWhy(cols, s);
}

/* The panel under the chart: where an hour's 100 points went. */
function renderWhy(cols, s) {
  const box = $('why');
  if (!box) return;

  const col = openHour === null ? null : cols[openHour];
  if (!col) { box.hidden = true; box.innerHTML = ''; return; }

  const L = T().ui;
  const e = tgExplainHour(col.hour, s);
  box.hidden = false;
  box.innerHTML = '';

  const head = document.createElement('h3');
  head.className = 'why-h';
  head.textContent = `${col.label} — ${e.total}/100`;
  box.append(head);

  const rows = document.createElement('div');
  rows.className = 'why-rows';

  const row = (name, fact, amount, cls) => {
    const r = document.createElement('div');
    r.className = 'why-row' + (cls ? ' ' + cls : '');
    const n = document.createElement('span');
    n.className = 'why-name';
    n.textContent = name;
    const f = document.createElement('span');
    f.className = 'why-fact';
    f.textContent = fact;
    const a = document.createElement('span');
    a.className = 'why-amt';
    // A real minus sign, not a hyphen: this is a sum, and it is read aloud.
    a.textContent = amount < 0 ? `−${Math.abs(amount)}` : String(amount);
    r.append(n, f, a);
    return r;
  };

  rows.append(row(L.startedAt, '', e.start));
  for (const p of e.parts) {
    rows.append(row(L.factors[p.key] || p.key, factorFact(p.key, col.hour),
                    p.amount, p.fixed ? 'fixed' : ''));
  }
  rows.append(row('', '', e.total, 'total'));
  box.append(rows);

  const note = document.createElement('p');
  note.className = 'why-note';
  note.textContent = e.total >= s.bar ? L.aboveBar(s.bar) : L.belowBar(s.bar);
  box.append(note);

  if (e.parts.some((p) => p.fixed)) {
    const safety = document.createElement('p');
    safety.className = 'why-note fixed';
    safety.textContent = L.notTunable;
    box.append(safety);
  }

  if (e.floored) {
    const floored = document.createElement('p');
    floored.className = 'why-note';
    floored.textContent = L.flooredAt;
    box.append(floored);
  }
}


/* ---------- where each number is heading ---------- */

function paintTrend(id, t) {
  const el = $(id);
  if (!el) return;
  if (!t || !t.text) { el.textContent = ''; el.className = 't'; return; }
  el.textContent = `${ARROW[t.dir]} ${t.text}`;
  el.className = 't ' + t.mood;
}

function renderTrends(data, s) {
  const tr = trends(data.now, data.ahead, s);
  if (!tr) {
    ['t-sky','t-temp','t-feels','t-wind','t-rain'].forEach((id) => paintTrend(id, null));
    $('outlook').textContent = '';
    return;
  }

  paintTrend('t-sky', null);
  paintTrend('t-temp', tr.temp);
  paintTrend('t-feels', tr.temp);
  paintTrend('t-wind', tr.wind);
  paintTrend('t-rain', tr.rain);

  const o = tr.outlook;
  $('outlook').textContent =
    `${ARROW[o.dir]} ${cap(tr.label)}: ${o.text}` +
    (o.mood === 'better' ? ` — best hour still to come scores ${o.best}.`
     : o.mood === 'worse' ? ` — right now is about as good as it gets.`
     : '.');
  $('outlook').className = 'outlook ' + o.mood;
}

/* Trips tapped on the home-screen widget are parked on the Android side
   until the page next opens, because localStorage is the only real log. */
function absorbWidgetVisits() {
  try {
    if (typeof TouchGrassAndroid === 'undefined' ||
        !TouchGrassAndroid.takePendingVisits) return;
    let n = TouchGrassAndroid.takePendingVisits();
    while (n-- > 0) addVisit();
  } catch { /* nothing pending, or no bridge */ }
}

/* ==========================================================
   LOADING A PLACE
   ========================================================== */

function fail(msg) {
  $('verdict').classList.remove('go', 'wait', 'anyways', 'stayin');
  $('banner-tag').textContent = 'HMM';
  $('verdict-line').textContent = T().ui.noIdea;
  $('verdict-sub').textContent = msg + ' ' + T().ui.noIdeaSub;
  $('meter-fill').style.width = '0%';
  $('meter-label').textContent = 'OUTSIDE-ABILITY —';
}

async function load(place) {
  STATE.place = place;
  $('place').textContent = place.label;
  try {
    STATE.data = await getWeather(place.lat, place.lon);
    STATE.stale = null;
    STATE.fetchedAt = Date.now();
    savePlace(place);
    cacheForecast(place, STATE.data);
    renderVerdict();
  } catch (e) {
    // Offline, or the service is down. A recent forecast still beats nothing.
    const cached = loadCachedForecast(place);
    if (cached) {
      STATE.data = cached.data;
      STATE.stale = cached.at;
      renderVerdict();
    } else {
      fail(e.message + '.');
    }
  }
}

function askGeo() {
  if (!navigator.geolocation) {
    if (!STATE.data) fail(T().ui.noGeo);
    return;
  }
  tryGeo(0);
}

/* Attempt n of nextGeoAttempt's plan. The card keeps saying "Locating…"
   between attempts: a failure banner at eight seconds, while the GPS is
   still being asked, would be a lie we then have to take back. */
function tryGeo(n, prevCode) {
  const opts = nextGeoAttempt(n, prevCode);
  if (!opts) {
    if (!STATE.data) fail(geoFailMessage(prevCode));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      // Keep a name the user actually chose for roughly this spot, rather
      // than replacing "Gothenburg" with a pair of numbers on every open.
      // Only names picked from the search count — an auto-generated
      // coordinate label is not worth preserving.
      const saved = loadPlace();
      const keepName = saved && saved.named
        && Math.abs(saved.lat - lat) < 0.4
        && Math.abs(saved.lon - lon) < 0.4;
      load(keepName
        ? { lat, lon, label: saved.label, named: true }
        : { lat, lon, label: coordLabel(lat, lon) });
    },
    (err) => tryGeo(n + 1, err.code),
    opts
  );
}

/* ==========================================================
   WIRING
   ========================================================== */

$('btn-add').addEventListener('click', () => {
  addVisit();
  renderVerdict();
  renderToday(visitsToday());
});

$('btn-undo').addEventListener('click', () => {
  removeVisit();
  renderVerdict();
  renderToday(visitsToday());
});

$('btn-geo').addEventListener('click', askGeo);

$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('search-input').value.trim();
  const out = $('results');
  if (!q) return;
  out.innerHTML = '';
  out.append(hintPara(T().ui.looking));
  try {
    const hits = await geocode(q);
    out.innerHTML = '';
    if (!hits.length) {
      out.append(hintPara(T().ui.nothingByThatName));
      return;
    }
    for (const r of hits) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
      b.addEventListener('click', () => {
        out.innerHTML = '';
        $('search-input').value = '';
        load({ lat: r.latitude, lon: r.longitude, label: r.name, named: true });
      });
      out.append(b);
    }
  } catch {
    out.innerHTML = '';
    out.append(hintPara(T().ui.searchDown));
  }
});

// Settings changed in the other tab? Pick it up without a reload.
window.addEventListener('storage', (e) => {
  if (e.key === 'touchgrass.settings' || e.key === LOG_KEY ||
      e.key === 'touchgrass.lang' || e.key === 'touchgrass.units') {
    applyStatic();
    renderVerdict();
    renderToday(visitsToday());
  }
});

/* ---------- go ---------- */

applyStatic();
absorbWidgetVisits();
renderToday(visitsToday());

// ?lat=51.5&lon=-0.13&place=London pins the page to one spot, which makes
// it bookmarkable and stops it asking for your location at all.
const params = new URLSearchParams(location.search);
const pLat = parseFloat(params.get('lat'));
const pLon = parseFloat(params.get('lon'));

if (Number.isFinite(pLat) && Number.isFinite(pLon)) {
  load({ lat: pLat, lon: pLon,
         label: params.get('place') || 'Pinned spot', named: true });
} else {
  const remembered = loadPlace();
  if (remembered) load(remembered);   // instant answer on a repeat visit
  askGeo();                           // then refine with real coords
}
