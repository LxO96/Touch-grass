/* ==========================================================
   TOUCH GRASS — the Settings page
   Needs core.js loaded first.
   ========================================================== */

let SETTINGS = getSettings();
let SAMPLE = null;   // real weather, so the preview means something


/* ==========================================================
   LANGUAGE AND UNITS
   ========================================================== */

let UNITS = getUnits();

function buildLangPicker() {
  const host = $('lang-picker');
  host.innerHTML = '';
  for (const l of LANGS_AVAILABLE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'modebtn' + (getLang() === l.code ? ' on' : '');
    b.textContent = l.label;
    b.addEventListener('click', () => {
      saveLang(l.code);
      relabelEverything();
    });
    host.append(b);
  }
}

function paintUnits() {
  $('unit-c').classList.toggle('on', UNITS.temp === 'c');
  $('unit-f').classList.toggle('on', UNITS.temp === 'f');
  $('unit-kmh').classList.toggle('on', UNITS.wind === 'kmh');
  $('unit-ms').classList.toggle('on', UNITS.wind === 'ms');
  $('unit-mph').classList.toggle('on', UNITS.wind === 'mph');
}

function pickTemp(t) { UNITS.temp = t; saveUnits(UNITS); paintUnits(); renderPreview(); }
function pickWind(w) { UNITS.wind = w; saveUnits(UNITS); paintUnits(); renderPreview(); }

$('unit-c').addEventListener('click', () => pickTemp('c'));
$('unit-f').addEventListener('click', () => pickTemp('f'));
$('unit-kmh').addEventListener('click', () => pickWind('kmh'));
$('unit-ms').addEventListener('click', () => pickWind('ms'));
$('unit-mph').addEventListener('click', () => pickWind('mph'));

// Language touches every label on the page, including ones built by JS.
function relabelEverything() {
  applyStatic();
  buildLangPicker();
  buildDials();
  paintNotify();
  paintUnits();
  renderPreview();
  refreshBackup();
  $('btn-toggle-raw').textContent =
    $('raw-wrap').hidden ? T().ui.showTheData : T().ui.hideTheData;
  document.title = T().ui.settings + ' | Touch Grass';
}

/* ---------- build the dials from the shared description ---------- */

function buildDials() {
  const host = $('dials');
  host.innerHTML = '';

  const L = T().ui;
  const labels = {
    rain: [L.dialRain, L.dialRainLow, L.dialRainHigh, L.dialRainBlurb],
    cold: [L.dialCold, L.dialColdLow, L.dialColdHigh, L.dialColdBlurb],
    heat: [L.dialHeat, L.dialHeatLow, L.dialHeatHigh, L.dialHeatBlurb],
    wind: [L.dialWind, L.dialWindLow, L.dialWindHigh, L.dialWindBlurb],
    dark: [L.dialDark, L.dialDarkLow, L.dialDarkHigh, L.dialDarkBlurb],
    twilight: [L.dialTwilight, L.dialTwilightLow, L.dialTwilightHigh, L.dialTwilightBlurb]
  };

  for (const d of DIALS) {
    const [dLabel, dLow, dHigh, dBlurb] = labels[d.key];
    const wrap = document.createElement('div');
    wrap.className = 'dial';

    const head = document.createElement('div');
    head.className = 'dial-head';

    const name = document.createElement('label');
    name.className = 'dial-name';
    name.setAttribute('for', 'dial-' + d.key);
    name.textContent = dLabel;

    const val = document.createElement('output');
    val.className = 'dial-val';
    val.id = 'val-' + d.key;

    head.append(name, val);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = 'dial-' + d.key;
    input.min = '0';
    input.max = '2';
    input.step = '0.1';
    input.value = SETTINGS[d.key];

    const blurb = document.createElement('p');
    blurb.className = 'hint small';
    blurb.textContent = dBlurb;

    const ends = document.createElement('div');
    ends.className = 'dial-ends';
    const lo = document.createElement('span'); lo.textContent = dLow;
    const hi = document.createElement('span'); hi.textContent = dHigh;
    ends.append(lo, hi);

    input.addEventListener('input', () => {
      SETTINGS[d.key] = parseFloat(input.value);
      saveSettings(SETTINGS);
      paintDial(d.key);
      renderPreview();
    });

    wrap.append(head, input, ends, blurb);
    host.append(wrap);
  }

  for (const d of DIALS) paintDial(d.key);
}

// Turn 0–2 into words, because "1.3" means nothing on its own.
function dialWord(v, key) {
  const w = key === 'twilight' ? T().ui.dialTwilightWords : T().ui.dialWords;
  if (v < 0.15) return w[0];
  if (v < 0.6)  return w[1];
  if (v < 0.9)  return w[2];
  if (v <= 1.1) return w[3];
  if (v <= 1.5) return w[4];
  if (v <= 1.8) return w[5];
  return w[6];
}

function paintDial(key) {
  const v = SETTINGS[key];
  $('val-' + key).textContent = dialWord(v, key);
  $('dial-' + key).classList.toggle('off', v < 0.15);
}

/* ---------- the bar ---------- */

const barInput = $('bar');
barInput.value = SETTINGS.bar;
$('bar-val').textContent = SETTINGS.bar;

barInput.addEventListener('input', () => {
  SETTINGS.bar = parseInt(barInput.value, 10);
  saveSettings(SETTINGS);
  $('bar-val').textContent = SETTINGS.bar;
  renderPreview();
});

/* ==========================================================
   LIVE PREVIEW — the real verdict, with the dials as they stand
   ========================================================== */

function renderPreview() {
  if (!SAMPLE) return;

  const visits = visitsToday();
  const v = decide(SAMPLE.now, rescored(SAMPLE.ahead), visits, SETTINGS);

  const card = $('preview');
  card.classList.remove('go', 'wait', 'anyways', 'stayin');
  card.classList.add(v.state);
  $('banner-tag').textContent = v.tag;
  $('verdict-line').textContent = v.line;
  $('verdict-sub').textContent = v.sub;
  $('meter-fill').style.width = v.score + '%';
  $('meter-label').textContent =
    `${T().ui.outsideAbility} ${v.score}/100 — ${T().ui.barIs} ${SETTINGS.bar}`;
}

function rescored(ahead) {
  for (const h of ahead) h.score = scoreHour(h, SETTINGS);
  return ahead;
}

/* ---------- fetch a real forecast to preview against ---------- */

async function loadSample() {
  const place = loadPlace();
  if (!place) {
    $('verdict-line').textContent = T().ui.noWeatherYet;
    $('verdict-sub').textContent = T().ui.noWeatherSub;
    return;
  }

  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${place.lat}&longitude=${place.lon}`
      + '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day'
      + '&hourly=apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day'
      + '&daily=sunset&forecast_days=2&timezone=auto';

    const d = await (await fetch(url)).json();
    const H = d.hourly;
    const stamp = d.current.time.slice(0, 13);
    let i = H.time.findIndex((t) => t.slice(0, 13) === stamp);
    if (i < 0) i = 0;

    const now = {
      temp: d.current.temperature_2m,
      feels: d.current.apparent_temperature,
      precip: d.current.precipitation,
      code: d.current.weather_code,
      wind: d.current.wind_speed_10m,
      isDay: d.current.is_day === 1,
      hour: parseInt(d.current.time.slice(11, 13), 10),
      pop: H.precipitation_probability[i] ?? 0
    };

    const ahead = [];
    for (let k = 1; k <= 12 && i + k < H.time.length; k++) {
      const j = i + k;
      const hr = parseInt(H.time[j].slice(11, 13), 10);
      ahead.push({
        hour: hr,
        label: hr === 0 ? 'midnight' : hr < 12 ? `${hr}am` : hr === 12 ? 'noon' : `${hr - 12}pm`,
        feels: H.apparent_temperature[j],
        pop: H.precipitation_probability[j] ?? 0,
        precip: H.precipitation[j] ?? 0,
        code: H.weather_code[j],
        wind: H.wind_speed_10m[j],
        isDay: H.is_day[j] === 1,
        hoursFromNow: k
      });
    }

    const sunsetStr = d.daily && d.daily.sunset ? d.daily.sunset[0] : null;
    SAMPLE = {
      now, ahead, label: place.label,
      sunsetMin: sunsetStr ? clockToMinutes(sunsetStr.slice(11)) : null
    };
    renderPreview();
    paintWhen();
  } catch {
    $('verdict-line').textContent = T().ui.noWeatherYet;
    $('verdict-sub').textContent = T().ui.noWeatherReach;
  }
}


/* ==========================================================
   NUDGES
   Saved here, mirrored to the Android side by core.js.
   ========================================================== */

const NOTIFY = getNotify();
const onAndroid = typeof TouchGrassAndroid !== 'undefined';

function parseTime(v, fallbackH, fallbackM) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  if (!m) return { h: fallbackH, m: fallbackM };
  return { h: clamp(+m[1], 0, 23), m: clamp(+m[2], 0, 59) };
}

function paintNotify() {
  $('n-enabled').checked = NOTIFY.enabled;
  $('n-time').value = hhmm(NOTIFY.hour, NOTIFY.minute);

  const bySunset = NOTIFY.mode === 'sunset';
  $('mode-clock').classList.toggle('on', !bySunset);
  $('mode-sunset').classList.toggle('on', bySunset);
  $('mode-clock-body').style.display = bySunset ? 'none' : '';
  $('mode-sunset-body').style.display = bySunset ? '' : 'none';
  $('n-before').value = NOTIFY.beforeSunset;
  $('n-before-val').textContent =
    NOTIFY.beforeSunset === 0 ? T().ui.atSunset : T().ui.hBefore(NOTIFY.beforeSunset);
  paintWhen();
  $('n-watch').checked = NOTIFY.watch;
  $('n-great').value = NOTIFY.greatBar;
  $('n-great-val').textContent = NOTIFY.greatBar;
  $('n-from').value = hhmm(NOTIFY.windowStart, 0);
  $('n-to').value = hhmm(NOTIFY.windowEnd, 0);
  $('n-alarm').checked = NOTIFY.alarm;

  $('notify-card').classList.toggle('off-1', !NOTIFY.enabled);
  document.querySelectorAll('#notify-card .opt')[0]
    .classList.toggle('collapsed', !NOTIFY.enabled);
  document.querySelectorAll('#notify-card .opt')[1]
    .classList.toggle('collapsed', !NOTIFY.watch);
}

function pushNotify() {
  saveNotify(NOTIFY);          // core.js mirrors it to Android
  if (!onAndroid) $('test-row').style.display = 'none';

paintNotify();
  refreshBackup();
  if (onAndroid) {
    // Ask for the OS permissions the chosen options actually need.
    try {
      TouchGrassAndroid.requestNotificationSetup(NOTIFY.alarm && NOTIFY.watch);
    } catch {}
  }
}


// Spell out what the setting means today, so "2 hours before sunset"
// isn't an abstraction.
function paintWhen() {
  const el = $('n-when');
  if (!el) return;
  const sunset = SAMPLE && typeof SAMPLE.sunsetMin === 'number' ? SAMPLE.sunsetMin : null;

  if (NOTIFY.mode === 'sunset') {
    if (sunset === null) {
      el.textContent = 'Sunset time will show once the weather has loaded.';
      return;
    }
    el.textContent = `Sunset today is ${minutesToHhmm(sunset)}, so today's nudge `
      + `would land at ${minutesToHhmm(reminderMinutes(NOTIFY, sunset))}.`;
  } else {
    el.textContent = sunset === null ? ' '
      : `For reference, sunset today is ${minutesToHhmm(sunset)}.`;
  }
}

$('mode-clock').addEventListener('click', () => {
  NOTIFY.mode = 'clock';
  pushNotify();
});

$('mode-sunset').addEventListener('click', () => {
  NOTIFY.mode = 'sunset';
  pushNotify();
});

$('n-before').addEventListener('input', () => {
  NOTIFY.beforeSunset = parseFloat($('n-before').value);
  $('n-before-val').textContent =
    NOTIFY.beforeSunset === 0 ? T().ui.atSunset : T().ui.hBefore(NOTIFY.beforeSunset);
  paintWhen();
  saveNotify(NOTIFY);
});

$('n-enabled').addEventListener('change', () => {
  NOTIFY.enabled = $('n-enabled').checked;
  pushNotify();
});

$('n-time').addEventListener('change', () => {
  const t = parseTime($('n-time').value, NOTIFY.hour, NOTIFY.minute);
  NOTIFY.hour = t.h; NOTIFY.minute = t.m;
  pushNotify();
});

$('n-watch').addEventListener('change', () => {
  NOTIFY.watch = $('n-watch').checked;
  pushNotify();
});

$('n-great').addEventListener('input', () => {
  NOTIFY.greatBar = parseInt($('n-great').value, 10);
  $('n-great-val').textContent = NOTIFY.greatBar;
  saveNotify(NOTIFY);
});

$('n-from').addEventListener('change', () => {
  NOTIFY.windowStart = parseTime($('n-from').value, 9, 0).h;
  if (NOTIFY.windowEnd <= NOTIFY.windowStart) {
    NOTIFY.windowEnd = Math.min(23, NOTIFY.windowStart + 1);
  }
  pushNotify();
});

$('n-to').addEventListener('change', () => {
  NOTIFY.windowEnd = parseTime($('n-to').value, 20, 0).h;
  if (NOTIFY.windowEnd <= NOTIFY.windowStart) {
    NOTIFY.windowStart = Math.max(0, NOTIFY.windowEnd - 1);
  }
  pushNotify();
});

$('n-alarm').addEventListener('change', () => {
  NOTIFY.alarm = $('n-alarm').checked;
  pushNotify();
});

$('btn-test').addEventListener('click', () => {
  if (!onAndroid) {
    note(T().ui.testBrowser);
    return;
  }
  try {
    TouchGrassAndroid.testNudge();
    note(T().ui.testSent);
  } catch {
    note(T().ui.testFailed);
  }
});

if (onAndroid) {
  $('notify-avail').textContent = T().ui.nudgesAndroid;
}

paintNotify();

/* ==========================================================
   BACKUP / RESTORE
   ========================================================== */

function dumpData() {
  return JSON.stringify(
    { settings: getSettings(), notify: getNotify(), log: getLog() }, null, 2);
}

function refreshBackup() {
  $('backup').value = dumpData();

  // A count means more at a glance than a wall of JSON.
  const log = getLog();
  const days = Object.keys(log).length;
  const trips = Object.values(log).reduce((a, b) => a + b, 0);
  $('data-summary').textContent = days
    ? T().ui.dataSummary(days, trips)
    : T().ui.dataSummaryEmpty;
}

const backupFilename = () => `touch-grass-${todayKey()}.json`;

/* ----------------------------------------------------------
   Sharing.

   The Android share sheet already reaches Drive, email, Files
   and everything else, so it does the job a bespoke Drive
   integration would — without an OAuth flow or a Google Cloud
   project to keep alive.
   ---------------------------------------------------------- */

$('btn-share').addEventListener('click', async () => {
  const text = dumpData();
  const name = backupFilename();

  // 1. the app's own bridge: a real file, in the real share sheet
  try {
    if (typeof TouchGrassAndroid !== 'undefined' && TouchGrassAndroid.shareBackup) {
      TouchGrassAndroid.shareBackup(text, name);
      note(T().ui.shared);
      return;
    }
  } catch { /* fall through */ }

  // 2. a browser that can share files
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Touch Grass' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // they changed their mind
  }

  // 3. anywhere else: save it to disk
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    note(T().ui.downloaded);
  } catch {
    note(T().ui.shareFailed);
  }
});

$('btn-toggle-raw').addEventListener('click', () => {
  const wrap = $('raw-wrap');
  wrap.hidden = !wrap.hidden;
  $('btn-toggle-raw').textContent =
    wrap.hidden ? T().ui.showTheData : T().ui.hideTheData;
});

$('btn-copy').addEventListener('click', async () => {
  const ta = $('backup');
  try {
    await navigator.clipboard.writeText(ta.value);
    note(T().ui.copied);
  } catch {
    ta.select();
    note(T().ui.pressCtrlC);
  }
});

$('btn-restore').addEventListener('click', () => {
  let parsed;
  try {
    parsed = JSON.parse($('backup').value);
  } catch {
    note(T().ui.notValid);
    return;
  }
  if (!parsed || typeof parsed !== 'object') {
    note(T().ui.notValid);
    return;
  }

  if (parsed.log && typeof parsed.log === 'object') saveLog(parsed.log);
  if (parsed.settings && typeof parsed.settings === 'object') saveSettings(parsed.settings);
  if (parsed.notify && typeof parsed.notify === 'object') {
    try { localStorage.setItem('touchgrass.notify', JSON.stringify(parsed.notify)); } catch {}
  }

  // Re-read through the validators rather than trusting what was pasted.
  SETTINGS = getSettings();
  buildDials();
  barInput.value = SETTINGS.bar;
  $('bar-val').textContent = SETTINGS.bar;
  refreshBackup();
  renderPreview();
  note(T().ui.restored);
});

let noteTimer = null;
function note(msg) {
  $('backup-note').textContent = msg;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { $('backup-note').innerHTML = '&nbsp;'; }, 4000);
}

/* ---------- reset ---------- */

$('btn-reset').addEventListener('click', () => {
  SETTINGS = Object.assign({}, DEFAULTS);
  saveSettings(SETTINGS);
  buildDials();
  barInput.value = SETTINGS.bar;
  $('bar-val').textContent = SETTINGS.bar;
  refreshBackup();
  renderPreview();
});

/* ---------- go ---------- */

applyStatic();
buildLangPicker();
paintUnits();
buildDials();
refreshBackup();
loadSample();
