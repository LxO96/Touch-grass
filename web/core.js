/* ==========================================================
   TOUCH GRASS — shared core
   Scoring, the verdict, and everything that gets remembered.
   Loaded by both index.html and settings.html.
   ========================================================== */

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* ---------- weather descriptions come from lang.js ---------- */

const skyName = (c) => {
  const sky = T().sky;
  return sky[c] || sky.fallback;
};

/* ==========================================================
   SETTINGS
   Every dial is a multiplier on one penalty. 1 = default,
   0 = "that doesn't bother me", 2 = "that really bothers me".
   ========================================================== */

const DEFAULTS = {
  rain: 1,    // drizzle, downpours, wet weather codes
  cold: 1,    // everything below comfortable
  heat: 1,    // everything above comfortable
  wind: 1,    // gusts
  dark: 1,    // darkness, and the small hours
  twilight: 1, // dusk and dawn: 0 just dark, 1 no dark penalty, 2 a bonus
  sky: Object.assign({}, TG_SKY_DEFAULTS),  // 0 love it .. 4 hate it, per kind
  novelty: true,  // firsts earn a bonus
  bar: 60     // the score a moment must beat to count as "good"
};

// The dials, described once so the settings page can build itself.
const DIALS = [
  { key: 'rain', label: 'Rain', low: "I like the rain",
    high: 'I melt', blurb: 'How much wet weather counts against an hour.' },
  { key: 'cold', label: 'Cold', low: 'I run warm',
    high: 'I feel the cold', blurb: 'How hard hours below comfortable are marked down.' },
  { key: 'heat', label: 'Heat', low: 'I love the heat',
    high: 'I wilt', blurb: 'How hard hours above comfortable are marked down.' },
  { key: 'wind', label: 'Wind', low: "Doesn't bother me",
    high: 'Hate the wind', blurb: 'How much a stiff breeze puts you off.' },
  { key: 'dark', label: 'Darkness', low: 'Happy in the dark',
    high: 'Daylight only', blurb: 'How much darkness — and 3am especially — counts against.' },
  // The one dial that runs the other way: right means you like it more.
  { key: 'twilight', label: 'Dusk & dawn', low: 'Just more dark',
    high: 'The best light', blurb: 'The half-light hour after sunset and before sunrise.' }
];

function getSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('touchgrass.settings') || '{}');
    const s = Object.assign({}, DEFAULTS);
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof raw[k] === 'number' && isFinite(raw[k])) s[k] = raw[k];
    }
    // Keep whatever is stored inside sane bounds.
    for (const d of DIALS) s[d.key] = clamp(s[d.key], 0, 2);
    s.bar = clamp(s.bar, 25, 90);
    // Each kind of weather keeps a valid stored rating or its default —
    // tgSkyRating is the one place that decides what "valid" means.
    s.sky = {};
    for (const k of TG_SKY_ORDER) s.sky[k] = tgSkyRating(raw.sky, k);
    s.novelty = raw.novelty !== false;
    return s;
  } catch { return freshDefaults(); }
}

/* DEFAULTS holds an object (sky); a shallow copy would let a later edit
   write through into the defaults themselves. */
function freshDefaults() {
  return Object.assign({}, DEFAULTS, { sky: Object.assign({}, DEFAULTS.sky) });
}

/* ---------- ranking the skies into bands ----------

   The settings card shows five bands, Love it .. Hate it, and each kind
   of weather sits in one. A band is just a rating, so the card needs only
   these two: which kinds are in which band, and what moving one does. */

const SKY_ICONS = {
  clear: '☀️', mostlyClear: '🌤️', partly: '⛅', overcast: '☁️', fog: '🌫️',
  drizzle: '🌦️', rain: '🌧️', snow: '🌨️', freezing: '🧊'
};

const SKY_BAND_FACES = ['😍', '🙂', '😐', '😕', '😖'];

// Five lists of kinds, one per rating, each in the usual order.
function skyBands(sky) {
  const bands = [[], [], [], [], []];
  for (const k of TG_SKY_ORDER) bands[tgSkyRating(sky, k)].push(k);
  return bands;
}

// A new ratings object with `kind` in band `rating`, clamped to the ends.
function moveSky(sky, kind, rating) {
  const out = Object.assign({}, sky);
  if (TG_SKY_ORDER.indexOf(kind) < 0) return out;
  out[kind] = clamp(Math.round(rating), 0, 4);
  return out;
}

function saveSettings(s) {
  try { localStorage.setItem('touchgrass.settings', JSON.stringify(s)); } catch {}
  syncToAndroid();
}

/* ==========================================================
   THE SCORE
   0 = do not open the door. 100 = why are you reading this.
   ========================================================== */

// The formula itself lives in scoring.js, which the Android background
// worker evaluates too — one definition, no second copy to drift.
// TOO_HOT, TOO_COLD, tgIsDeepNight and tgScoreHour all come from there.

const isDeepNight = (hr) => tgIsDeepNight(hr);

function scoreHour(h, s) {
  return tgScoreHour(h, s || getSettings());
}

/* ==========================================================
   THE VERDICT

   tgDecide() in scoring.js picks the outcome and the facts; this
   turns that into sentences in the chosen language. The Android
   widget and notifications call the same tgDecide and render their
   own, much shorter, wording from the identical verdict.
   ========================================================== */

const cap = (str) => String(str).charAt(0).toUpperCase() + String(str).slice(1);


// Everything the sentence builders need that isn't in the decision.
function phrasebook() {
  const L = T();
  const u = getUnits();
  return {
    sky: (code) => skyName(code),
    tempNum: (c) => tempNum(c, u),
    temp: (c) => fmtTemp(c, u),
    wind: (k) => fmtWind(k, u),
    cap,
    soon: (n) => L.soon(n),
    why: (kind, feels) => L.why[kind](tempNum(feels, u))
  };
}

function decide(now, ahead, visits, s) {
  s = s || getSettings();
  const d = tgDecide(now, ahead, visits, s);
  const L = T();
  const build = L.verdict[d.state] || L.verdict.anyways;
  const words = build(d, phrasebook());

  return {
    state: stateToStyle(d.state),
    tag: words.tag,
    line: words.line,
    sub: words.sub,
    score: d.score,
    decision: d
  };
}

// Several outcomes share a look; the CSS only knows four.
function stateToStyle(state) {
  switch (state) {
    case 'go':
    case 'goAgain':
      return 'go';
    case 'anyways':
    case 'anywaysBest':
      return 'anyways';
    case 'stayin':
      return 'stayin';
    default:
      return 'wait';
  }
}



/* ==========================================================
   STATIC TEXT

   Anything in the markup carrying data-t is filled in from the
   language bundle, so switching language re-labels both pages
   without a reload.
   ========================================================== */

function applyStatic(root) {
  const L = T();
  const scope = root || document;

  scope.querySelectorAll('[data-t]').forEach((el) => {
    const v = L.ui[el.dataset.t];
    if (typeof v === 'string') el.textContent = v;
  });

  scope.querySelectorAll('[data-t-aria]').forEach((el) => {
    const v = L.ui[el.dataset.tAria];
    if (typeof v === 'string') el.setAttribute('aria-label', v);
  });

  scope.querySelectorAll('[data-t-ph]').forEach((el) => {
    const v = L.ui[el.dataset.tPh];
    if (typeof v === 'string') el.placeholder = v;
  });

  document.documentElement.lang = L.code;
}

/* A one-line note under the search box — "Looking…", "Nothing by that
   name". Lives here rather than with the calendar because both pages
   need it and only this file is loaded by both. */
function hintPara(text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

/* ==========================================================
   THE LOG — one number per day, kept in localStorage.

   Cookies would be the wrong tool: they cap out around 4KB and
   ride along on every request to a server that doesn't exist here.
   ========================================================== */

const LOG_KEY = 'touchgrass.log';

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dayKey(new Date());

// Shape alone isn't enough: "2026-13-99" and "2026-02-30" both look right.
// Round-tripping through Date is what actually rules them out.
function validKey(k) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  const [y, m, d] = k.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function getLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) || '{}');
    const out = {};
    // Keep only well-formed entries, so a corrupt value can't poison the year.
    for (const [k, v] of Object.entries(raw)) {
      if (validKey(k) && Number.isFinite(+v) && +v > 0) {
        out[k] = Math.min(99, Math.round(+v));
      }
    }
    return out;
  } catch { return {}; }
}

function saveLog(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch {}
}

/* The most a day can be set to from the year page. The Today button is
   not capped, so a day can hold more; the popup then lets it come down
   but never pushes it further up. */
const TRIPS_MAX = 5;

/* The month `delta` away from year/month, or null if that month has not
   happened yet — there is nothing to log in the future. */
function shiftMonth(year, month, delta, now) {
  const d = new Date(year, month + delta, 1);
  const n = now || new Date();
  if (d.getFullYear() > n.getFullYear() ||
      (d.getFullYear() === n.getFullYear() && d.getMonth() > n.getMonth())) return null;
  return { year: d.getFullYear(), month: d.getMonth() };
}

function stepTrips(n, delta) {
  if (delta > 0) return n >= TRIPS_MAX ? n : n + 1;
  return Math.max(0, n - 1);
}

function visitsOn(key) { return getLog()[key] || 0; }
function visitsToday() { return visitsOn(todayKey()); }

function setVisits(key, n) {
  const log = getLog();
  if (n > 0) log[key] = Math.min(99, n); else delete log[key];
  saveLog(log);
  syncToAndroid();      // so a reminder doesn't fire after you've been out
  return log;
}

function addVisit(key) {
  key = key || todayKey();
  // The log counts trips per day, which the calendar and streaks need.
  // "2 hours ago" needs an actual clock time, so note that separately —
  // it's a nicety, and the log stays the source of truth.
  if (!key || key === todayKey()) {
    try { localStorage.setItem('touchgrass.lastout', String(Date.now())); } catch {}
  }
  return setVisits(key, visitsOn(key) + 1);
}

function removeVisit(key) {
  key = key || todayKey();
  return setVisits(key, Math.max(0, visitsOn(key) - 1));
}


/* ----------------------------------------------------------
   How long since you were last outside.

   Precise when we noted the time, coarse when all we have is
   the log — an older log, or a day corrected in the calendar,
   only knows which day, not which hour. Better to say
   "yesterday" than to invent an hour.
   ---------------------------------------------------------- */

function lastOut(log) {
  log = log || getLog();
  const keys = Object.keys(log).sort();
  if (!keys.length) return null;

  const lastDay = keys[keys.length - 1];
  let stamp = null;
  try {
    const raw = localStorage.getItem('touchgrass.lastout');
    if (raw && isFinite(+raw)) stamp = +raw;
  } catch { /* no stamp, fall back to the day */ }

  // Only trust the stamp if it belongs to the most recent logged day.
  if (stamp !== null && dayKey(new Date(stamp)) === lastDay) {
    return { exact: true, at: stamp, day: lastDay };
  }

  const days = Math.round(
    (new Date(todayKey() + 'T00:00:00') - new Date(lastDay + 'T00:00:00')) / 86400000
  );
  return { exact: false, days, day: lastDay };
}

// Words for it, in the chosen language.
function lastOutText(info) {
  const L = T().ui;
  if (!info) return L.neverOut;

  if (info.exact) {
    const mins = Math.max(0, Math.round((Date.now() - info.at) / 60000));
    if (mins < 45) return L.agoMinutes(mins);
    const hours = Math.round(mins / 60);
    if (hours < 24) return L.agoHours(hours);
    return L.agoDays(Math.round(hours / 24));
  }

  if (info.days <= 0) return L.agoToday;
  if (info.days === 1) return L.agoYesterday;
  return L.agoDays(info.days);
}

/* ---------- streaks ---------- */

// A streak stays alive through today even before you've been out —
// today hasn't failed until it's over.
function streakInfo(log) {
  log = log || getLog();
  const d = new Date();
  if (!log[dayKey(d)]) d.setDate(d.getDate() - 1);  // today still pending

  let current = 0;
  while (log[dayKey(d)]) { current++; d.setDate(d.getDate() - 1); }

  // Longest run anywhere in the log.
  const keys = Object.keys(log).sort();
  let longest = 0, run = 0, prev = null;
  for (const k of keys) {
    const day = new Date(k + 'T00:00:00');
    if (prev && (day - prev) === 86400000) run++; else run = 1;
    if (run > longest) longest = run;
    prev = day;
  }

  const year = String(new Date().getFullYear());
  const daysThisYear = keys.filter((k) => k.startsWith(year)).length;
  const tripsThisYear = keys
    .filter((k) => k.startsWith(year))
    .reduce((sum, k) => sum + log[k], 0);

  return { current, longest, daysThisYear, tripsThisYear };
}


/* ==========================================================
   TRENDS

   tgTrends() in scoring.js works out the directions; this puts
   words to them. The widget reads the same tgTrends and draws
   arrows instead, so the two can never disagree about whether
   the day is improving.
   ========================================================== */

const ARROW = { up: '\u2191', down: '\u2193', flat: '\u2192' };

function trends(now, ahead, s) {
  s = s || getSettings();
  const t = tgTrends(now, ahead, s);
  if (!t) return null;

  const L = T().ui;
  const word = (part, up, down) =>
    ({ dir: part.dir, mood: part.mood,
       text: part.dir === 'up' ? up : part.dir === 'down' ? down : L.steady });

  return {
    label: t.kind === 'restOfToday' ? L.restOfToday : L.nextFewHours,
    outlook: {
      dir: t.outlook.dir,
      mood: t.outlook.mood,
      text: t.outlook.mood === 'better' ? L.gettingBetter
          : t.outlook.mood === 'worse' ? L.goingDownhill
          : L.stayingSame,
      best: t.outlook.best,
      now: t.outlook.now
    },
    sky:  { dir: 'flat', mood: 'same', text: '' },
    temp: word(t.temp, L.warmer, L.colder),
    rain: word(t.rain, L.wetter, L.drying),
    wind: word(t.wind, L.windier, L.calmer)
  };
}

/* ==========================================================
   UNITS

   The forecast is always fetched and scored in Celsius and km/h —
   the whole formula is calibrated in those, and re-tuning it per
   unit system would be madness. These convert for display only.
   ========================================================== */

const UNIT_DEFAULTS = { temp: 'c', wind: 'kmh' };

const WIND_UNITS = [
  { key: 'kmh', label: 'km/h', from: (k) => k },
  { key: 'ms',  label: 'm/s',  from: (k) => k / 3.6 },
  { key: 'mph', label: 'mph',  from: (k) => k / 1.609344 }
];

function getUnits() {
  try {
    const raw = JSON.parse(localStorage.getItem('touchgrass.units') || '{}');
    const u = Object.assign({}, UNIT_DEFAULTS);
    if (raw.temp === 'c' || raw.temp === 'f') u.temp = raw.temp;
    if (WIND_UNITS.some((w) => w.key === raw.wind)) u.wind = raw.wind;
    return u;
  } catch { return Object.assign({}, UNIT_DEFAULTS); }
}

function saveUnits(u) {
  try { localStorage.setItem('touchgrass.units', JSON.stringify(u)); } catch {}
}

const cToF = (c) => c * 9 / 5 + 32;

// Rounded number only — for sentences that add their own degree sign.
function tempNum(c, u) {
  u = u || getUnits();
  return Math.round(u.temp === 'f' ? cToF(c) : c);
}

function fmtTemp(c, u) {
  u = u || getUnits();
  return `${tempNum(c, u)}°${u.temp === 'f' ? 'F' : 'C'}`;
}

function fmtWind(kmh, u) {
  u = u || getUnits();
  const w = WIND_UNITS.find((x) => x.key === u.wind) || WIND_UNITS[0];
  const v = w.from(kmh);
  // m/s is small enough that a whole number loses too much.
  const n = w.key === 'ms' ? Math.round(v * 10) / 10 : Math.round(v);
  return `${n} ${w.label}`;
}

/* ==========================================================
   NOTIFICATION PREFERENCES
   Read by the settings page, and mirrored to the Android side
   so the background check can use them. Harmless in a browser.
   ========================================================== */

const NOTIFY_DEFAULTS = {
  enabled: false,     // the daily nudge
  mode: 'clock',      // 'clock' = a fixed time, 'sunset' = before sundown
  hour: 17,           // when that nudge lands, if you haven't been out
  minute: 0,
  beforeSunset: 2,    // hours before sundown, when mode is 'sunset'
  watch: false,       // watch for a genuinely good window
  windowStart: 9,     // ...but only between these hours
  windowEnd: 20,
  greatBar: 75,       // what counts as worth interrupting you for
  alarm: false        // ring like an alarm rather than a quiet notification
};

function getNotify() {
  try {
    const raw = JSON.parse(localStorage.getItem('touchgrass.notify') || '{}');
    const n = Object.assign({}, NOTIFY_DEFAULTS);
    for (const k of Object.keys(NOTIFY_DEFAULTS)) {
      if (typeof raw[k] === typeof NOTIFY_DEFAULTS[k]) n[k] = raw[k];
    }
    n.hour = clamp(Math.round(n.hour), 0, 23);
    n.minute = clamp(Math.round(n.minute), 0, 59);
    n.windowStart = clamp(Math.round(n.windowStart), 0, 23);
    n.windowEnd = clamp(Math.round(n.windowEnd), 0, 23);
    n.greatBar = clamp(Math.round(n.greatBar), 40, 100);
    if (n.mode !== 'sunset') n.mode = 'clock';
    // Half-hour steps, and never so early it lands before lunch.
    n.beforeSunset = clamp(Math.round(n.beforeSunset * 2) / 2, 0, 6);
    // An inverted window would silently never fire.
    if (n.windowEnd <= n.windowStart) n.windowEnd = Math.min(23, n.windowStart + 1);
    return n;
  } catch { return Object.assign({}, NOTIFY_DEFAULTS); }
}

function saveNotify(n) {
  try { localStorage.setItem('touchgrass.notify', JSON.stringify(n)); } catch {}
  syncToAndroid();
}

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/* ----------------------------------------------------------
   When the daily nudge is due, in minutes since midnight.

   A fixed clock time is wrong half the year: 5pm is mid-afternoon
   in June and long dark in December. "Two hours before sunset"
   tracks the actual daylight instead.
   ---------------------------------------------------------- */
function reminderMinutes(n, sunsetMin) {
  if (n.mode === 'sunset' && typeof sunsetMin === 'number' && isFinite(sunsetMin)) {
    return clamp(Math.round(sunsetMin - n.beforeSunset * 60), 0, 24 * 60 - 1);
  }
  return clamp(n.hour * 60 + n.minute, 0, 24 * 60 - 1);
}

const minutesToHhmm = (m) =>
  hhmm(Math.floor(clamp(m, 0, 24 * 60 - 1) / 60), clamp(m, 0, 24 * 60 - 1) % 60);

// "19:58" -> minutes since midnight
function clockToMinutes(str) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(str || ''));
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/* ==========================================================
   THE BRIDGE

   The background worker runs in Kotlin and cannot read this
   page's localStorage, so everything it needs is pushed across
   whenever it changes. In a plain browser TouchGrassAndroid
   simply isn't there and this does nothing.
   ========================================================== */

function syncToAndroid() {
  try {
    if (typeof TouchGrassAndroid === 'undefined') return;
    const place = loadPlace();
    TouchGrassAndroid.syncState(JSON.stringify({
      notify: getNotify(),
      settings: getSettings(),
      lang: getLang(),
      units: getUnits(),
      visitsToday: visitsToday(),
      today: todayKey(),
      log: getLog(),
      place: place ? { lat: place.lat, lon: place.lon, label: place.label } : null
    }));
  } catch { /* the app still works without notifications */ }
}

/* ==========================================================
   WHY AN HOUR SCORES WHAT IT DOES

   tgExplainHour in scoring.js itemises the penalties as keys and
   numbers. This puts the reading behind each one into words — the
   53% that cost you 29 points — in your language and your units.
   ========================================================== */

function factorFact(key, h) {
  const u = getUnits();
  switch (key) {
    case 'rain':
      return T().ui.chanceOf(Math.round(tgNum(h.pop, 0)));
    case 'cold':
    case 'heat':
      return fmtTemp(tgNum(h.feels, 16), u);
    case 'wind':
      return fmtWind(tgNum(h.wind, 0), u);
    case 'code':
    case 'sky':
      return skyName(h.code);
    case 'firstRain':
      return h.noveltyDays ? T().ui.dryDays(h.noveltyDays) : '';
    case 'firstSun':
      return h.noveltyDays ? T().ui.greyDays(h.noveltyDays) : '';
    case 'firstWarm':
      return fmtTemp(tgNum(h.feels, 16), u);
    // Dark is dark, and 3am is 3am. Neither needs a number.
    default:
      return '';
  }
}

/* ==========================================================
   FINDING YOU

   Asking for a location is two questions, not one. The cheap one —
   "do you already know where I am?" — answers instantly when the
   device has a recent fix, which on a phone in daily use it usually
   does. When it doesn't, that request does not fall back to the GPS;
   it simply times out. So the expensive question has to be asked
   separately, and only then.

   A refusal is different: it will still be a refusal in twenty
   seconds, so it is never asked twice.
   ========================================================== */

const GEO_DENIED = 1;        // PositionError.PERMISSION_DENIED
const GEO_UNAVAILABLE = 2;   // PositionError.POSITION_UNAVAILABLE
const GEO_TIMEOUT = 3;       // PositionError.TIMEOUT

const GEO_ATTEMPTS = [
  // Whatever the device already knows, if it is fresh enough.
  { timeout: 8000, maximumAge: 600000 },
  // Nothing cached: wake the GPS and give it time to see the sky.
  { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
];

// The options for attempt n, or null when there is nothing left to try.
function nextGeoAttempt(n, code) {
  if (n > 0 && code === GEO_DENIED) return null;
  return GEO_ATTEMPTS[n] || null;
}

function geoFailMessage(code) {
  return code === GEO_DENIED ? T().ui.geoDenied : T().ui.geoNoFix;
}

/* Close enough that one forecast answers for both. The same box the
   cached forecast is reused across, and the same one a chosen place name
   survives — one number, so those three cannot drift apart. */
const SAME_PLACE_DEG = 0.4;

function nearPlace(p, lat, lon) {
  return !!p && Math.abs(p.lat - lat) < SAME_PLACE_DEG
             && Math.abs(p.lon - lon) < SAME_PLACE_DEG;
}

/* How long a forecast on screen stands before a fresh fix is worth
   spending three more requests on. The 45 minutes Weather.kt reuses its
   cache for, deliberately: the same policy on both sides. */
const GEO_REUSE_MS = 45 * 60 * 1000;

/* Whether a position fix should trigger a real reload.

   Every open asks for a location on top of the remembered place it has
   already started loading, and the first attempt accepts a ten-minute-old
   cached fix — so on a phone in daily use it answers instantly with
   coordinates inside the box already being loaded. Reloading there is
   three more HTTP requests each to Open-Meteo, MET and SMHI for an answer
   that is on its way or already on the screen, and MET Norway's terms ask
   clients not to repeat requests they do not need.

   What must still reload: a genuinely different place, a forecast old
   enough to be worth replacing, and a stale one — that one is showing
   only because the last fetch failed, so a fresh chance at the network is
   exactly what it wants. */
function geoNeedsReload(state, lat, lon, nowMs) {
  if (!state || !nearPlace(state.place, lat, lon)) return true;
  if (state.loading) return false;    // the same box is already on its way
  if (!state.data || state.stale) return true;
  return nowMs - state.fetchedAt >= GEO_REUSE_MS;
}

/* ---------- remembered place ---------- */

function savePlace(p) {
  try { localStorage.setItem('touchgrass.place', JSON.stringify(p)); } catch {}
  syncToAndroid();
}

function loadPlace() {
  try { return JSON.parse(localStorage.getItem('touchgrass.place') || 'null'); }
  catch { return null; }
}


/* ==========================================================
   THE HEADER

   The big title fades as you scroll down and the tabs stay pinned
   at the top, so the pages keep their name at rest and give the
   screen back once you are reading. Pages only — the test runner
   has no real document.
   ========================================================== */

(function collapseHeader() {
  if (typeof window === 'undefined' || typeof document.querySelector !== 'function') return;
  const title = document.querySelector('h1');
  if (!title) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const h = title.offsetHeight || 1;
    const y = window.scrollY || 0;
    title.style.opacity = String(Math.max(0, 1 - y / (h * 0.8)));
    // Solid just before the tabs pin, never after content has reached them.
    document.body.classList.toggle('scrolled', y > h * 0.75);
  };
  window.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
  paint();
})();
