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

/* Which services the last forecast actually came from, and when — read
   from the forecast the Today page cached, so nothing is fetched here. */
function creditName(key) {
  for (const c of TG_CREDITS) if (c.key === key) return c.name;
  return key;
}

function renderSources() {
  const blend = $('blend-sources');
  const at = $('fetched-at');
  if (!blend || !at) return;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('touchgrass.forecast') || 'null'); } catch {}
  const sources = cached && cached.data && cached.data.sources;
  if (!sources || !sources.length) { blend.textContent = ''; at.innerHTML = '&nbsp;'; return; }
  const w = tgWeigh(sources);
  blend.textContent = `${T().ui.blendedFrom} ` + tgCreditOrder(sources)
    .map((k) => T().ui.sourceWeight(creditName(k), Math.round(w[k] * 100)))
    .join(', ');
  at.textContent = T().ui.updated(new Date(cached.at)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
}

// Language touches every label on the page, including ones built by JS.
function relabelEverything() {
  applyStatic();
  buildLangPicker();
  buildDials();
  paintNotify();
  paintUnits();
  renderPreview();
  refreshBackup();
  renderSources();
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
  buildSkies();
}

/* ---------- ranking the skies ----------

   Five bands, Love it down to Hate it, and each kind of weather sits in
   one. Drag a kind by its grip into another band; or tap it, then tap the
   band it belongs in — dragging inside a WebView can be fiddly, and a tap
   always works. Arrow keys move a focused kind one band up or down. */

let skyPicked = null;   // a kind tapped and waiting for a band

function buildSkies() {
  const host = $('skies');
  if (!host) return;
  host.innerHTML = '';
  const L = T().ui;
  paintNovelty();

  const hint = document.createElement('p');
  hint.className = 'hint small sky-hint';
  hint.setAttribute('aria-live', 'polite');
  hint.textContent = skyPicked ? L.skyPickHint(L.skyKinds[skyPicked]) : '';
  host.append(hint);

  skyBands(SETTINGS.sky).forEach((kinds, rating) => {
    const band = document.createElement('section');
    band.className = 'sky-band' + (skyPicked ? ' can-drop' : '');
    band.dataset.rating = String(rating);

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'sky-band-head';
    const face = document.createElement('span');
    face.textContent = SKY_BAND_FACES[rating];
    const name = document.createElement('span');
    name.className = 'sky-band-name';
    name.textContent = L.skyRatings[rating];
    const pts = TG_SKY_POINTS[rating];
    const score = document.createElement('span');
    score.className = 'sky-band-pts';
    score.textContent = pts ? '\u2212' + pts : '0';
    head.append(face, name, score);
    head.addEventListener('click', () => {
      if (skyPicked) placeSky(skyPicked, rating, true);
    });

    const list = document.createElement('ul');
    list.className = 'sky-list';
    if (!kinds.length) {
      const empty = document.createElement('li');
      empty.className = 'sky-empty';
      empty.textContent = L.skyEmpty;
      list.append(empty);
    }

    for (const kind of kinds) {
      const li = document.createElement('li');
      li.className = 'sky-item' + (skyPicked === kind ? ' picked' : '');
      li.dataset.kind = kind;

      const grip = document.createElement('span');
      grip.className = 'sky-grip';
      grip.textContent = '\u2261';
      grip.setAttribute('aria-hidden', 'true');

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sky-chip';
      chip.textContent = SKY_ICONS[kind] + '  ' + L.skyKinds[kind];
      chip.setAttribute('aria-pressed', String(skyPicked === kind));
      chip.addEventListener('click', () => {
        skyPicked = skyPicked === kind ? null : kind;
        buildSkies();
        focusSky(kind);
      });
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          placeSky(kind, rating + (e.key === 'ArrowUp' ? -1 : 1), true);
        } else if (e.key === 'Escape' && skyPicked) {
          skyPicked = null;
          buildSkies();
          focusSky(kind);
        }
      });

      dragSky(grip, li, kind);
      li.append(grip, chip);
      list.append(li);
    }

    band.append(head, list);
    host.append(band);
  });
}

/* The firsts switch lives on the same card; built with it so a restore or
   a reset leaves it showing the truth. */
function paintNovelty() {
  const box = $('novelty');
  if (box) box.checked = SETTINGS.novelty !== false;
  const aur = $('aurora');
  if (aur) aur.checked = SETTINGS.aurora !== false;
  const rad = $('radar');
  if (rad) rad.checked = SETTINGS.radar === true;
}

if ($('aurora')) {
  $('aurora').addEventListener('change', () => {
    SETTINGS.aurora = $('aurora').checked;
    saveSettings(SETTINGS);
    renderPreview();
  });
}

if ($('radar')) {
  $('radar').addEventListener('change', () => {
    SETTINGS.radar = $('radar').checked;
    saveSettings(SETTINGS);
  });
}

if ($('novelty')) {
  $('novelty').addEventListener('change', () => {
    SETTINGS.novelty = $('novelty').checked;
    saveSettings(SETTINGS);
    renderPreview();
  });
}

function focusSky(kind) {
  const chip = document.querySelector('.sky-item[data-kind="' + kind + '"] .sky-chip');
  if (chip) chip.focus();
}

function placeSky(kind, rating, keepFocus) {
  SETTINGS.sky = moveSky(SETTINGS.sky, kind, rating);
  skyPicked = null;
  saveSettings(SETTINGS);
  buildSkies();
  renderPreview();
  if (keepFocus) focusSky(kind);
}

/* Pointer events cover touch and mouse alike. The grip alone takes the
   gesture (touch-action: none in the CSS), so swiping anywhere else on
   the card still scrolls the page. */
function dragSky(grip, li, kind) {
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startScroll = window.scrollY;
    let over = null;
    li.classList.add('dragging');

    const move = (ev) => {
      li.style.transform = 'translateY(' + (ev.clientY - startY + window.scrollY - startScroll) + 'px)';
      // Look through the dragged item for the band underneath it.
      li.style.visibility = 'hidden';
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      li.style.visibility = '';
      const band = under && under.closest('.sky-band');
      if (band !== over) {
        if (over) over.classList.remove('drop-here');
        over = band;
        if (over) over.classList.add('drop-here');
      }
      // Near the top or bottom of the screen, keep the page moving.
      const edge = 70;
      if (ev.clientY < edge) window.scrollBy(0, -14);
      else if (ev.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
    };

    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      li.classList.remove('dragging');
      li.style.transform = '';
      if (over) {
        over.classList.remove('drop-here');
        const rating = Number(over.dataset.rating);
        if (rating !== tgSkyRating(SETTINGS.sky, kind)) placeSky(kind, rating);
      }
    };

    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });
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
  $('n-aurora').checked = NOTIFY.aurora;
  $('n-great').value = NOTIFY.greatBar;
  $('n-great-val').textContent = NOTIFY.greatBar;
  $('n-from').value = hhmm(NOTIFY.windowStart, 0);
  $('n-to').value = hhmm(NOTIFY.windowEnd, 0);
  $('n-alarm').checked = NOTIFY.alarm;

  $('notify-card').classList.toggle('off-1', !NOTIFY.enabled);
  // By the switch each option belongs to, not by position: a new option
  // inserted above would otherwise fold the wrong one.
  $('n-enabled').closest('.opt').classList.toggle('collapsed', !NOTIFY.enabled);
  $('n-watch').closest('.opt').classList.toggle('collapsed', !NOTIFY.watch);
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

$('n-aurora').addEventListener('change', () => {
  NOTIFY.aurora = $('n-aurora').checked;
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
  return JSON.stringify(backupData(), null, 2);
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

  $('auto-backup').hidden = typeof TouchGrassAndroid === 'undefined';
  const at = lastExported();
  $('last-export').textContent = at ? T().ui.lastExported(shortDate(at)) : T().ui.neverExported;
}

const shortDate = (iso) => new Date(iso)
  .toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: 'numeric' });

const backupFilename = () => `touch-grass-${todayKey()}.json`;

/* ----------------------------------------------------------
   Sharing.

   The Android share sheet already reaches Drive, email, Files
   and everything else, so it does the job a bespoke Drive
   integration would — without an OAuth flow or a Google Cloud
   project to keep alive.
   ---------------------------------------------------------- */

// A file in the downloads folder: the browser's way of saving.
function downloadBackup(text, name) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    markExported(); refreshBackup();
    note(T().ui.downloaded);
  } catch {
    note(T().ui.saveFailed);
  }
}

/* SAVE. In the app the system's save dialog lets you pick where, and
   the app calls back with the outcome: true saved, false failed, null
   cancelled. Only a real file counts as a saved copy. */
window.tgBackupSaved = (ok) => {
  if (ok === null) return;
  if (ok) { markExported(); refreshBackup(); note(T().ui.savedFile); }
  else note(T().ui.saveFailed);
};

$('btn-save').addEventListener('click', () => {
  const text = dumpData();
  const name = backupFilename();
  try {
    if (typeof TouchGrassAndroid !== 'undefined' && TouchGrassAndroid.saveBackup) {
      TouchGrassAndroid.saveBackup(text, name);
      return;
    }
  } catch { /* fall through */ }
  downloadBackup(text, name);
});

/* SHARE / EMAIL IT. Where the copy ends up is the other app's business,
   so opening the share sheet is not counted as a saved copy. */
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
  downloadBackup(text, name);
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

/* ----------------------------------------------------------
   Restoring: from a file, or from pasted text. Either way the
   panel says what it would do first, and nothing changes until
   RESTORE is pressed.
   ---------------------------------------------------------- */

let PENDING = null;

function offerRestore(text) {
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  const r = readBackup(data);
  if (!r) { closeRestore(); note(T().ui.notValid); return; }
  PENDING = data;
  $('restore-what').textContent =
    T().ui.restoreWhat(r.savedAt ? shortDate(r.savedAt) : null, r.days, r.added);
  $('restore-settings').checked = false;
  $('restore-settings-row').hidden = !r.hasSettings;
  $('restore-panel').hidden = false;
  $('restore-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function closeRestore() {
  PENDING = null;
  $('restore-panel').hidden = true;
}

$('btn-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';                    // so the same file can be picked again
  if (!f) return;
  try { offerRestore(await f.text()); } catch { note(T().ui.notValid); }
});

$('btn-restore').addEventListener('click', () => offerRestore($('backup').value));
$('btn-restore-cancel').addEventListener('click', closeRestore);

$('btn-restore-go').addEventListener('click', () => {
  if (!PENDING) return;
  const withSettings = $('restore-settings').checked;
  const r = applyBackup(PENDING, withSettings);
  closeRestore();
  if (!r) { note(T().ui.notValid); return; }
  // Everything on the page was drawn from what may just have changed.
  if (withSettings) location.reload();
  else { refreshBackup(); note(T().ui.restoredDays(r.added)); }
});

let noteTimer = null;
function note(msg) {
  $('backup-note').textContent = msg;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { $('backup-note').innerHTML = '&nbsp;'; }, 4000);
}

/* ---------- reset ---------- */

$('btn-reset').addEventListener('click', () => {
  SETTINGS = freshDefaults();
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

renderSources();
