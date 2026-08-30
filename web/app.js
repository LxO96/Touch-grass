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

async function getWeather(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day'
    + '&hourly=apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day'
    + '&daily=sunset'
    + '&forecast_days=2&timezone=auto';

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather service said ${res.status}`);
  const d = await res.json();

  const now = {
    temp:   d.current.temperature_2m,
    feels:  d.current.apparent_temperature,
    precip: d.current.precipitation,
    code:   d.current.weather_code,
    wind:   d.current.wind_speed_10m,
    isDay:  d.current.is_day === 1,
    // Local hour at the location, not in the visitor's own timezone.
    hour:   parseInt(d.current.time.slice(11, 13), 10),
    pop:    0
  };

  // Line the hourly array up with the current local hour.
  const H = d.hourly;
  const stamp = d.current.time.slice(0, 13);            // "YYYY-MM-DDTHH"
  let i = H.time.findIndex((t) => t.slice(0, 13) === stamp);
  if (i < 0) i = 0;

  // Give "now" the current hour's rain probability — the API
  // doesn't hand one out for the current conditions.
  now.pop = H.precipitation_probability[i] ?? 0;

  const ahead = [];
  for (let k = 1; k <= 12 && i + k < H.time.length; k++) {
    const j = i + k;
    // Read the hour straight off the string: these timestamps are already
    // in the location's timezone, and Date() would drag in the visitor's.
    const hr = parseInt(H.time[j].slice(11, 13), 10);
    ahead.push({
      time:  H.time[j],
      hour:  hr,
      label: T().hourLabel(hr),
      feels: H.apparent_temperature[j],
      pop:   H.precipitation_probability[j] ?? 0,
      precip: H.precipitation[j] ?? 0,
      code:  H.weather_code[j],
      wind:  H.wind_speed_10m[j],
      isDay: H.is_day[j] === 1,
      hoursFromNow: k
    });
  }

  const sunsetStr = d.daily && d.daily.sunset ? d.daily.sunset[0] : null;
  const sunsetMin = sunsetStr ? clockToMinutes(sunsetStr.slice(11)) : null;

  return { now, ahead, sunsetMin };
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

function renderChart(data, s) {
  const chart = $('chart');
  chart.innerHTML = '';
  const cols = [{ label: T().ui.notYet === 'Not yet' ? 'now' : 'nu',
                  score: scoreHour(data.now, s), isNow: true }]
    .concat(data.ahead.slice(0, 11).map((h) => ({
      label: String(h.hour).padStart(2, '0'), score: h.score, isNow: false
    })));

  for (const c of cols) {
    const col = document.createElement('div');
    col.className = 'bar-col';

    const bar = document.createElement('div');
    bar.className = 'bar ' + (c.score >= s.bar ? 'good' : c.score >= 35 ? 'meh' : 'bad')
                  + (c.isNow ? ' now' : '');
    bar.style.height = Math.max(4, c.score) + '%';
    bar.title = `${c.label}: ${c.score}/100`;

    const lbl = document.createElement('span');
    lbl.className = 'bar-hr';
    lbl.textContent = c.label;

    col.append(bar, lbl);
    chart.append(col);
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
  $('verdict-sub').textContent = msg + ' Try searching for a town below — that always works.';
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
    () => {
      if (!STATE.data) {
        fail(T().ui.geoBlocked);
      }
    },
    { timeout: 8000, maximumAge: 600000 }
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
