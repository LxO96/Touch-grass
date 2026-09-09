# Nordic Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blend MET Norway (YR), SMHI and Open-Meteo into one forecast — YR 0.50, SMHI 0.25, Open-Meteo 0.25, renormalised per hour over whoever covers it.

**Architecture:** Fetching stays per-runtime; everything else is one shared ES5 file. `web/blend.js` holds the symbol tables, the normalisers, the apparent-temperature formula and the merge, and is loaded by the pages *and* evaluated by Rhino on Android — exactly as `scoring.js` already is. Kotlin therefore performs three HTTP GETs and hands the raw response bodies to Rhino as strings; it never parses a forecast or owns a mapping table. That is what keeps the widget and the page from drifting.

**Tech Stack:** Plain ES5 JavaScript (no build step), Rhino on Android, Kotlin `HttpURLConnection`, the `check()` harness in `web/test.html`, JUnit in `ScoringEngineTest.kt`.

**Spec:** `docs/superpowers/specs/2026-09-08-nordic-sources-design.md`

## Global Constraints

- `web/blend.js` is evaluated by Rhino. **Plain ES5 only**: `var` and `function`, no arrow functions, no template literals, no `??`, no `let`/`const`, no `Array.prototype.find`, no DOM, no `localStorage`, no `fetch`. Same rule as `scoring.js`, stated at the top of that file.
- Weights: **YR 0.50, SMHI 0.25, Open-Meteo 0.25.** Renormalised per hour over the sources that have that hour.
- Wind is scored in **km/h**. SMHI and MET both publish **m/s**; multiply by 3.6.
- Timestamps from SMHI and MET are **UTC** (`Z`) and are the merge key. Open-Meteo's are already in the location's timezone; its offset is what lines them up, and it is also the only source of each hour's **local** hour.
- Weather codes are **WMO integers**, restricted to the set `lang.js` describes: 0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99. Never emit a code outside it.
- The code vote has **no lightning override** (spec decision). A test pins this.
- Page fetch timeout: **10 seconds**. Background cache reuse window: **45 minutes**.
- MET Norway's terms require identification: every Kotlin request sends `User-Agent: TouchGrass/1.0 github.com/LxO96/Touch-grass`. The browser sends its own and needs nothing added.
- Run the web suite by opening `web/test.html` in a browser and reading the count at the foot, or headlessly with the node runner if it has been committed. Run the Kotlin suite with `cd android && ./gradlew test` (needs `ANDROID_HOME`).

## File Structure

| File | Responsibility |
|---|---|
| `web/blend.js` **(new)** | Everything pure and shared: symbol tables, normalisers, apparent temperature, weights, merge, JSON doorway. Rhino-safe ES5. |
| `web/fixtures.js` **(new)** | Real recorded API responses as globals, for tests only. Loaded by `test.html`, by nothing else. |
| `web/test.html` | Add tests; load `blend.js` and `fixtures.js`. |
| `web/index.html`, `web/settings.html` | Add `<script src="blend.js">` after `scoring.js`. |
| `web/app.js` | Fetch three sources in parallel, hand them to the blend, render attribution. |
| `web/lang.js` | Attribution strings, en + sv. |
| `android/.../Scoring.kt` | Evaluate `blend.js` alongside `scoring.js`; expose the doorway. |
| `android/.../Weather.kt` | Three GETs, hand the bodies to Rhino, cache for 45 minutes. |
| `android/.../ScoringEngineTest.kt` | Assert Rhino and the browser blend identically. |

---

### Task 1: Weights that renormalise

**Files:**
- Create: `web/blend.js`
- Modify: `web/test.html` — add `<script src="blend.js"></script>` after the `scoring.js` tag, and add the tests below before the `report` section.

**Interfaces:**
- Consumes: `tgNum` from `scoring.js` (already loaded).
- Produces: `TG_WEIGHTS` (object), `tgWeigh(present)` → object mapping source key to a weight, summing to 1.

- [ ] **Step 1: Write the failing tests**

```js
/* ================= blending sources ================= */

check('all three sources carry their stated weights', (() => {
  const w = tgWeigh(['met', 'smhi', 'om']);
  return w.met === 0.5 && w.smhi === 0.25 && w.om === 0.25;
})(), true);

check('a missing source has its weight shared out proportionally', (() => {
  const w = tgWeigh(['met', 'om']);
  return Math.abs(w.met - 2 / 3) < 1e-9 && Math.abs(w.om - 1 / 3) < 1e-9;
})(), true);

check('weights always sum to one', (() => {
  const sets = [['met'], ['smhi'], ['om'], ['met', 'smhi'],
                ['smhi', 'om'], ['met', 'smhi', 'om']];
  return sets.every((s) => {
    const w = tgWeigh(s);
    const total = Object.keys(w).reduce((t, k) => t + w[k], 0);
    return Math.abs(total - 1) < 1e-9;
  });
})(), true);

check('one source on its own carries all the weight', tgWeigh(['om']).om, 1);

check('no sources yields no weights', Object.keys(tgWeigh([])).length, 0);
```

- [ ] **Step 2: Run to verify it fails**

Expected: `THREW: tgWeigh is not defined`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/blend.js`:

```js
/* ==========================================================
   TOUCH GRASS — blending several forecasts into one

   Three services disagree about the same hour. This decides what
   to believe: a weighted mean of the numbers, a weighted vote on
   the weather code.

   Like scoring.js, Rhino evaluates this file on the Android side,
   so keep it plain ES5: var and function only, no arrow functions,
   no template literals, no DOM, no fetch.
   ========================================================== */

/* YR is the best model for the Nordics and carries half the weight;
   the other two split the rest. */
var TG_WEIGHTS = { met: 0.5, smhi: 0.25, om: 0.25 };

/* The stated weights, renormalised over the sources that actually
   answered for this hour, so they always sum to 1. */
function tgWeigh(present) {
  var out = {};
  var total = 0;
  var i;
  for (i = 0; i < present.length; i++) {
    total += TG_WEIGHTS[present[i]] || 0;
  }
  if (total <= 0) return out;
  for (i = 0; i < present.length; i++) {
    out[present[i]] = (TG_WEIGHTS[present[i]] || 0) / total;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: 5 new PASS lines, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add web/blend.js web/test.html
git commit -m "Blend: weights that renormalise over the sources present"
```

---

### Task 2: The weighted mean, hour by hour

**Files:**
- Modify: `web/blend.js`, `web/test.html`

**Interfaces:**
- Consumes: `tgWeigh` (Task 1).
- Produces: `tgBlend(bySource)` where `bySource` is `{ met: [hour...], smhi: [...], om: [...] }`, each hour `{ time, feels, temp, pop, precip, wind, code }`. Returns blended hours sorted by `time`, each also carrying `sources` (array of contributing keys).

- [ ] **Step 1: Write the failing tests**

```js
const hr = (time, o) => Object.assign(
  { time: time, feels: 10, temp: 10, pop: 0, precip: 0, wind: 0, code: 0 }, o || {});

check('one source blends to itself', (() => {
  const out = tgBlend({ om: [hr('2026-09-08T21:00:00Z', { feels: 12.5, pop: 40 })] });
  return out.length === 1 && out[0].feels === 12.5 && out[0].pop === 40;
})(), true);

check('two sources average by weight', (() => {
  // met 0.5 / om 0.25 renormalises to 2/3 and 1/3.
  const out = tgBlend({
    met: [hr('2026-09-08T21:00:00Z', { feels: 12 })],
    om:  [hr('2026-09-08T21:00:00Z', { feels: 18 })]
  });
  return Math.abs(out[0].feels - 14) < 1e-9;   // 12*(2/3) + 18*(1/3)
})(), true);

check('all three average by weight', (() => {
  const out = tgBlend({
    met:  [hr('2026-09-08T21:00:00Z', { pop: 80 })],
    smhi: [hr('2026-09-08T21:00:00Z', { pop: 40 })],
    om:   [hr('2026-09-08T21:00:00Z', { pop: 20 })]
  });
  return Math.abs(out[0].pop - 55) < 1e-9;     // 80*.5 + 40*.25 + 20*.25
})(), true);

check('an hour only one source has still appears', (() => {
  const out = tgBlend({
    met: [hr('2026-09-08T21:00:00Z'), hr('2026-09-08T22:00:00Z', { feels: 9 })],
    om:  [hr('2026-09-08T21:00:00Z')]
  });
  return out.length === 2 && out[1].feels === 9;
})(), true);

check('a blended hour names the sources behind it', (() => {
  const out = tgBlend({
    met: [hr('2026-09-08T21:00:00Z')],
    om:  [hr('2026-09-08T21:00:00Z')]
  });
  return out[0].sources.sort().join(',');
})(), 'met,om');

check('blended hours come back in time order', (() => {
  const out = tgBlend({
    om: [hr('2026-09-08T23:00:00Z'), hr('2026-09-08T21:00:00Z'),
         hr('2026-09-08T22:00:00Z')]
  });
  return out.map((h) => h.time.slice(11, 13)).join(',');
})(), '21,22,23');

check('an empty blend is empty, not a crash', tgBlend({}).length, 0);
```

- [ ] **Step 2: Run to verify it fails**

Expected: `THREW: tgBlend is not defined`.

- [ ] **Step 3: Write the minimal implementation**

Append to `web/blend.js`:

```js
var TG_MEAN_FIELDS = ['feels', 'temp', 'pop', 'precip', 'wind'];

/* bySource: { met: [hour...], smhi: [...], om: [...] }
   Each hour: { time, feels, temp, pop, precip, wind, code }
   Returns one array of blended hours, in time order. */
function tgBlend(bySource) {
  var keys = [];
  var k;
  for (k in bySource) {
    if (bySource.hasOwnProperty(k) && bySource[k] && bySource[k].length) keys.push(k);
  }

  // Gather every hour any source knows about, keyed by its UTC stamp.
  var byTime = {};
  var i, j, h;
  for (i = 0; i < keys.length; i++) {
    var hours = bySource[keys[i]];
    for (j = 0; j < hours.length; j++) {
      h = hours[j];
      if (!byTime[h.time]) byTime[h.time] = {};
      byTime[h.time][keys[i]] = h;
    }
  }

  var times = [];
  for (k in byTime) {
    if (byTime.hasOwnProperty(k)) times.push(k);
  }
  times.sort();

  var out = [];
  for (i = 0; i < times.length; i++) {
    var at = byTime[times[i]];
    var present = [];
    for (k in at) {
      if (at.hasOwnProperty(k)) present.push(k);
    }
    var w = tgWeigh(present);

    var blended = { time: times[i], sources: present };
    for (j = 0; j < TG_MEAN_FIELDS.length; j++) {
      var field = TG_MEAN_FIELDS[j];
      var sum = 0;
      var m;
      for (m = 0; m < present.length; m++) {
        sum += tgNum(at[present[m]][field], 0) * w[present[m]];
      }
      blended[field] = sum;
    }
    blended.code = tgVoteCode(at, w);
    out.push(blended);
  }
  return out;
}

/* Replaced properly in Task 3. */
function tgVoteCode(at, w) {
  var k;
  for (k in at) {
    if (at.hasOwnProperty(k)) return at[k].code;
  }
  return 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: 7 new PASS lines, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add web/blend.js web/test.html
git commit -m "Blend: weighted mean of the readings, hour by hour"
```

---

### Task 3: The code vote

**Files:**
- Modify: `web/blend.js` (replace the Task 2 stub), `web/test.html`

**Interfaces:**
- Produces: `tgVoteCode(at, weights)` → one WMO integer.

- [ ] **Step 1: Write the failing tests**

```js
check('a code carried by more weight beats one carried by less', (() => {
  // met 0.5 clear; smhi 0.25 + om 0.25 overcast. Tie on 0.5 each,
  // broken by the heaviest single source behind a code: met.
  const out = tgBlend({
    met:  [hr('2026-09-08T21:00:00Z', { code: 0 })],
    smhi: [hr('2026-09-08T21:00:00Z', { code: 3 })],
    om:   [hr('2026-09-08T21:00:00Z', { code: 3 })]
  });
  return out[0].code;
})(), 0);

check('two agreeing sources settle it between themselves', (() => {
  const out = tgBlend({
    smhi: [hr('2026-09-08T21:00:00Z', { code: 61 })],
    om:   [hr('2026-09-08T21:00:00Z', { code: 61 })]
  });
  return out[0].code;
})(), 61);

check('a lone source supplies its own code',
  tgBlend({ smhi: [hr('2026-09-08T21:00:00Z', { code: 45 })] })[0].code, 45);

// The spec decision, pinned so it cannot change by accident:
// there is no safety override on the vote.
check('an outvoted thunderstorm does not survive the vote', (() => {
  const out = tgBlend({
    met:  [hr('2026-09-08T21:00:00Z', { code: 0 })],
    smhi: [hr('2026-09-08T21:00:00Z', { code: 95 })],
    om:   [hr('2026-09-08T21:00:00Z', { code: 0 })]
  });
  return out[0].code;
})(), 0);

check('a thunderstorm with the weight behind it does survive', (() => {
  const out = tgBlend({
    met:  [hr('2026-09-08T21:00:00Z', { code: 95 })],
    smhi: [hr('2026-09-08T21:00:00Z', { code: 0 })],
    om:   [hr('2026-09-08T21:00:00Z', { code: 3 })]
  });
  return out[0].code;
})(), 95);
```

- [ ] **Step 2: Run to verify it fails**

Expected: the first test FAILs — the stub returns whichever code it reaches first, not the heaviest.

- [ ] **Step 3: Replace the stub**

```js
/* Codes cannot be averaged — the mean of fog and thunder is nothing.
   So they vote, weighted. A tie goes to the heaviest single source
   behind a code, which keeps the outcome independent of key order.

   Deliberately no safety override: a thunderstorm carried by a
   minority of the weight loses, and tgIsRisky therefore never sees
   it. Decided in the design doc; this comment is the reminder, and
   the test above is the lock. */
function tgVoteCode(at, w) {
  var tally = {};
  var heaviest = {};
  var k, code;

  for (k in at) {
    if (!at.hasOwnProperty(k)) continue;
    code = at[k].code;
    if (typeof code !== 'number') continue;
    tally[code] = (tally[code] || 0) + w[k];
    if (!heaviest[code] || w[k] > heaviest[code]) heaviest[code] = w[k];
  }

  var best = null;
  for (k in tally) {
    if (!tally.hasOwnProperty(k)) continue;
    code = parseInt(k, 10);
    if (best === null ||
        tally[code] > tally[best] ||
        (tally[code] === tally[best] && heaviest[code] > heaviest[best])) {
      best = code;
    }
  }
  return best === null ? 0 : best;
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: 5 new PASS lines, and Task 2's tests still green.

- [ ] **Step 5: Commit**

```bash
git add web/blend.js web/test.html
git commit -m "Blend: weighted vote for the weather code"
```

---

### Task 4: Apparent temperature, for the source that lacks one

**Files:**
- Modify: `web/blend.js`, `web/test.html`

**Interfaces:**
- Produces: `tgApparent(tempC, humidityPct, windMs)` → °C.

SMHI publishes no feels-like temperature and `tgScoreHour` is built on one. This is the Australian Bureau of Meteorology apparent temperature — the same definition behind Open-Meteo's `apparent_temperature` and MET's `apparent_air_temperature`, so a blended feels-like never mixes two meanings of the same word.

- [ ] **Step 1: Write the failing tests**

```js
check('apparent temperature matches the worked example', (() => {
  // SMHI Stockholm 2026-09-08T21:00Z: 16.1 C, 87% RH, 2.4 m/s.
  // e  = 0.87 * 6.105 * exp(17.27*16.1/(237.7+16.1)) = 15.885
  // AT = 16.1 + 0.33*15.885 - 0.70*2.4 - 4.00        = 15.662
  return Math.round(tgApparent(16.1, 87, 2.4) * 10) / 10;
})(), 15.7);

check('wind makes it feel colder',
  tgApparent(10, 70, 10) < tgApparent(10, 70, 0), true);

check('humidity makes a warm day feel hotter',
  tgApparent(30, 90, 2) > tgApparent(30, 30, 2), true);

check('a missing humidity does not produce nonsense',
  isFinite(tgApparent(16, null, 2)), true);
```

- [ ] **Step 2: Run to verify it fails**

Expected: `THREW: tgApparent is not defined`.

- [ ] **Step 3: Write the implementation**

```js
/* Australian BOM apparent temperature.
   t degrees C, rh percent, ws metres per second. */
function tgApparent(t, rh, ws) {
  var temp = tgNum(t, 16);
  var hum = tgNum(rh, 50);
  var wind = tgNum(ws, 0);
  // Water vapour pressure, hPa.
  var e = (hum / 100) * 6.105 * Math.exp((17.27 * temp) / (237.7 + temp));
  return temp + 0.33 * e - 0.70 * wind - 4.00;
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: 4 new PASS lines.

- [ ] **Step 5: Commit**

```bash
git add web/blend.js web/test.html
git commit -m "Blend: apparent temperature for SMHI, BOM formula"
```

---

### Task 5: SMHI's symbols, and its normaliser

**Files:**
- Create: `web/fixtures.js`
- Modify: `web/blend.js`, `web/test.html`

**Interfaces:**
- Consumes: `tgApparent` (Task 4).
- Produces: `TG_SMHI_WMO` (1–27 → WMO), `tgNormaliseSmhi(json)` → array of hours in the Task 2 shape.

SMHI's 1–27 vocabulary is unchanged from the retired PMP3g API — verified against a live response where code 18 arrived with 0.3 mm and 83% probability, i.e. light rain. WMO has no sleet code, so sleet maps to the snow family: nearer the truth for dressing purposes than freezing rain, and `lang.js` already describes the snow codes in both languages.

- [ ] **Step 1: Create the fixture file**

Create `web/fixtures.js` — real responses recorded 2026-09-08, trimmed to three hours:

```js
/* Real responses, recorded 2026-09-08: SMHI and Open-Meteo for
   Stockholm (59.3293, 18.0686), MET for Oslo (59.91, 10.75).
   Loaded by test.html only. */

var FIXTURE_SMHI = {
  "referenceTime": "2026-09-08T20:00:00Z",
  "timeSeries": [
    { "time": "2026-09-08T21:00:00Z", "data": { "air_temperature": 16.1,
      "wind_speed": 2.4, "relative_humidity": 87,
      "probability_of_precipitation": 83, "precipitation_amount_mean": 0.3,
      "symbol_code": 18 } },
    { "time": "2026-09-08T22:00:00Z", "data": { "air_temperature": 15.6,
      "wind_speed": 2.7, "relative_humidity": 90,
      "probability_of_precipitation": 93, "precipitation_amount_mean": 0.4,
      "symbol_code": 18 } },
    { "time": "2026-09-08T23:00:00Z", "data": { "air_temperature": 14.9,
      "wind_speed": 2.6, "relative_humidity": 90,
      "probability_of_precipitation": 83, "precipitation_amount_mean": 0.4,
      "symbol_code": 18 } }
  ]
};

var FIXTURE_MET = {
  "properties": { "timeseries": [
    { "time": "2026-09-08T20:00:00Z",
      "data": { "instant": { "details": { "air_temperature": 15.8,
        "apparent_air_temperature": 15.8, "wind_speed": 3.1 } },
        "next_1_hours": { "summary": { "symbol_code": "partlycloudy_night" },
          "details": { "precipitation_amount": 0,
            "probability_of_precipitation": 0 } } } },
    { "time": "2026-09-08T21:00:00Z",
      "data": { "instant": { "details": { "air_temperature": 15.3,
        "apparent_air_temperature": 15.3, "wind_speed": 2.8 } },
        "next_1_hours": { "summary": { "symbol_code": "partlycloudy_night" },
          "details": { "precipitation_amount": 0,
            "probability_of_precipitation": 0 } } } },
    { "time": "2026-09-08T22:00:00Z",
      "data": { "instant": { "details": { "air_temperature": 14.7,
        "apparent_air_temperature": 14.3, "wind_speed": 2.6 } },
        "next_1_hours": { "summary": { "symbol_code": "partlycloudy_night" },
          "details": { "precipitation_amount": 0,
            "probability_of_precipitation": 0 } } } }
  ] }
};

/* Open-Meteo's times are local (Europe/Stockholm, UTC+2 in September);
   utc_offset_seconds is what lines them up with the other two. */
var FIXTURE_OM = {
  "utc_offset_seconds": 7200,
  "current": { "time": "2026-09-08T23:00", "temperature_2m": 16.4,
    "apparent_temperature": 16.0, "precipitation": 0.2, "weather_code": 61,
    "wind_speed_10m": 9.0, "is_day": 0 },
  "hourly": {
    "time": ["2026-09-08T23:00", "2026-09-09T00:00", "2026-09-09T01:00"],
    "temperature_2m": [16.4, 15.8, 15.4],
    "apparent_temperature": [16.0, 15.4, 15.0],
    "precipitation_probability": [80, 90, 85],
    "precipitation": [0.2, 0.5, 0.4],
    "weather_code": [61, 63, 61],
    "wind_speed_10m": [9.0, 9.4, 9.0],
    "is_day": [0, 0, 0]
  },
  "daily": { "sunset": ["2026-09-08T19:41"] }
};
```

Add `<script src="fixtures.js"></script>` to `web/test.html`, after `blend.js`.

- [ ] **Step 2: Write the failing tests**

```js
check('SMHI light rain is WMO light rain', TG_SMHI_WMO[18], 61);
check('SMHI clear sky is WMO clear', TG_SMHI_WMO[1], 0);
check('SMHI overcast is WMO overcast', TG_SMHI_WMO[6], 3);
check('SMHI thunderstorm is WMO thunderstorm', TG_SMHI_WMO[11], 95);
check('SMHI has all 27 symbols mapped', Object.keys(TG_SMHI_WMO).length, 27);

check('every SMHI symbol maps to a code the app can describe', (() => {
  const sky = T().sky;
  return Object.keys(TG_SMHI_WMO).every((k) => typeof sky[TG_SMHI_WMO[k]] === 'string');
})(), true);

check('the SMHI fixture normalises to three hours',
  tgNormaliseSmhi(FIXTURE_SMHI).length, 3);

check('SMHI wind is converted to km/h',
  Math.round(tgNormaliseSmhi(FIXTURE_SMHI)[0].wind * 100) / 100, 8.64);

check('SMHI gets a computed feels-like',
  Math.round(tgNormaliseSmhi(FIXTURE_SMHI)[0].feels * 10) / 10, 15.7);

check('SMHI rain probability carries through',
  tgNormaliseSmhi(FIXTURE_SMHI)[0].pop, 83);

check('SMHI symbol 18 normalises to WMO 61',
  tgNormaliseSmhi(FIXTURE_SMHI)[0].code, 61);

check('a broken SMHI payload normalises to nothing, not a throw',
  tgNormaliseSmhi({ nonsense: true }).length, 0);
```

- [ ] **Step 3: Run to verify it fails**

Expected: `THREW: TG_SMHI_WMO is not defined`.

- [ ] **Step 4: Write the implementation**

```js
/* SMHI's own 1–27 scale onto the WMO codes the rest of the app
   speaks. WMO has no sleet, so sleet joins the snow family. */
var TG_SMHI_WMO = {
  1: 0, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3,      // clear -> overcast
  7: 45,                                    // fog
  8: 80, 9: 81, 10: 82,                     // rain showers
  11: 95,                                   // thunderstorm
  12: 85, 13: 85, 14: 86,                   // sleet showers
  15: 85, 16: 85, 17: 86,                   // snow showers
  18: 61, 19: 63, 20: 65,                   // rain
  21: 95,                                   // thunder
  22: 71, 23: 73, 24: 75,                   // sleet
  25: 71, 26: 73, 27: 75                    // snow
};

function tgNormaliseSmhi(d) {
  var out = [];
  if (!d || !d.timeSeries || !d.timeSeries.length) return out;
  var i;
  for (i = 0; i < d.timeSeries.length; i++) {
    var t = d.timeSeries[i];
    var v = t && t.data;
    if (!v) continue;
    var temp = tgNum(v.air_temperature, 16);
    var windMs = tgNum(v.wind_speed, 0);
    out.push({
      time: t.time,
      temp: temp,
      feels: tgApparent(temp, v.relative_humidity, windMs),
      pop: tgNum(v.probability_of_precipitation, 0),
      precip: tgNum(v.precipitation_amount_mean, 0),
      wind: windMs * 3.6,
      code: TG_SMHI_WMO[v.symbol_code] === undefined ? 3 : TG_SMHI_WMO[v.symbol_code]
    });
  }
  return out;
}
```

- [ ] **Step 5: Run to verify it passes**

Expected: 12 new PASS lines.

- [ ] **Step 6: Commit**

```bash
git add web/blend.js web/fixtures.js web/test.html
git commit -m "Blend: SMHI symbols and normaliser"
```

---

### Task 6: MET Norway's symbols, and its normaliser

**Files:**
- Modify: `web/blend.js`, `web/test.html`

**Interfaces:**
- Produces: `TG_MET_WMO` (symbol stem → WMO), `tgMetCode(symbol)`, `tgNormaliseMet(json)` → array of hours.

MET's `symbol_code` carries a `_day` / `_night` / `_polartwilight` suffix. It is stripped: daylight comes from Open-Meteo, per the spec.

- [ ] **Step 1: Write the failing tests**

```js
check('MET clear sky is WMO clear', TG_MET_WMO.clearsky, 0);
check('MET fair is WMO mostly clear', TG_MET_WMO.fair, 1);
check('MET partlycloudy is WMO partly cloudy', TG_MET_WMO.partlycloudy, 2);
check('MET cloudy is WMO overcast', TG_MET_WMO.cloudy, 3);
check('MET heavy rain is WMO heavy rain', TG_MET_WMO.heavyrain, 65);

check('every MET thunder variant is a thunderstorm', (() => {
  return Object.keys(TG_MET_WMO)
    .filter((k) => k.indexOf('thunder') >= 0)
    .every((k) => TG_MET_WMO[k] === 95);
})(), true);

check('every MET symbol maps to a code the app can describe', (() => {
  const sky = T().sky;
  return Object.keys(TG_MET_WMO).every((k) => typeof sky[TG_MET_WMO[k]] === 'string');
})(), true);

check('the day suffix is stripped before mapping',
  tgNormaliseMet(FIXTURE_MET)[0].code, 2);     // partlycloudy_night -> 2

check('the MET fixture normalises to three hours',
  tgNormaliseMet(FIXTURE_MET).length, 3);

check('MET feels-like comes straight from the API',
  tgNormaliseMet(FIXTURE_MET)[2].feels, 14.3);

check('MET wind is converted to km/h',
  Math.round(tgNormaliseMet(FIXTURE_MET)[0].wind * 100) / 100, 11.16);

check('an hour past the hourly horizon is skipped, not half-read', (() => {
  const trimmed = { properties: { timeseries: [
    { time: '2026-09-09T06:00:00Z',
      data: { instant: { details: { air_temperature: 9, wind_speed: 1 } } } }
  ] } };
  return tgNormaliseMet(trimmed).length;
})(), 0);

check('a broken MET payload normalises to nothing, not a throw',
  tgNormaliseMet({ nonsense: true }).length, 0);
```

- [ ] **Step 2: Run to verify it fails**

Expected: `THREW: TG_MET_WMO is not defined`.

- [ ] **Step 3: Write the implementation**

```js
/* MET Norway's symbol stems onto WMO. The _day / _night /
   _polartwilight suffix is dropped: daylight comes from Open-Meteo,
   not from a symbol name. MET draws no hail distinction, so every
   thunder variant is plain WMO 95. */
var TG_MET_WMO = {
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,

  lightrain: 61, rain: 63, heavyrain: 65,
  lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,

  lightsleet: 71, sleet: 73, heavysleet: 75,
  lightsleetshowers: 85, sleetshowers: 85, heavysleetshowers: 86,

  lightsnow: 71, snow: 73, heavysnow: 75,
  lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,

  lightrainandthunder: 95, rainandthunder: 95, heavyrainandthunder: 95,
  lightrainshowersandthunder: 95, rainshowersandthunder: 95,
  heavyrainshowersandthunder: 95,
  lightsleetandthunder: 95, sleetandthunder: 95, heavysleetandthunder: 95,
  lightsleetshowersandthunder: 95, sleetshowersandthunder: 95,
  heavysleetshowersandthunder: 95,
  lightsnowandthunder: 95, snowandthunder: 95, heavysnowandthunder: 95,
  lightsnowshowersandthunder: 95, snowshowersandthunder: 95,
  heavysnowshowersandthunder: 95
};

function tgMetCode(symbol) {
  if (!symbol) return 3;
  var stem = String(symbol).split('_')[0];
  return TG_MET_WMO[stem] === undefined ? 3 : TG_MET_WMO[stem];
}

function tgNormaliseMet(d) {
  var out = [];
  if (!d || !d.properties || !d.properties.timeseries) return out;
  var series = d.properties.timeseries;
  var i;
  for (i = 0; i < series.length; i++) {
    var t = series[i];
    var inst = t && t.data && t.data.instant && t.data.instant.details;
    var next = t && t.data && t.data.next_1_hours;
    // Past the hourly horizon MET coarsens to six-hour blocks, which
    // carry no single hour's rain. Those are left out rather than
    // smeared across six hours.
    if (!inst || !next || !next.details) continue;
    var temp = tgNum(inst.air_temperature, 16);
    var windMs = tgNum(inst.wind_speed, 0);
    out.push({
      time: t.time,
      temp: temp,
      feels: tgNum(inst.apparent_air_temperature, temp),
      pop: tgNum(next.details.probability_of_precipitation, 0),
      precip: tgNum(next.details.precipitation_amount, 0),
      wind: windMs * 3.6,
      code: tgMetCode(next.summary && next.summary.symbol_code)
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: 13 new PASS lines.

- [ ] **Step 5: Commit**

```bash
git add web/blend.js web/test.html
git commit -m "Blend: MET Norway symbols and normaliser"
```

---

### Task 7: Open-Meteo's normaliser, and the daylight spine

**Files:**
- Modify: `web/blend.js`, `web/test.html`

**Interfaces:**
- Produces: `tgLocalToUtc(local, offsetSeconds)` → UTC stamp string; `tgNormaliseOm(json)` → `{ hours: [...], daylight: { byTime, localHourByTime, sunsetMin } }`.

Open-Meteo is the spine: the only source publishing `is_day` and `sunset`, and the only one whose timestamps are already in the location's own timezone — which is where every blended hour's local hour comes from.

- [ ] **Step 1: Write the failing tests**

```js
check('Open-Meteo normalises to its hourly rows',
  tgNormaliseOm(FIXTURE_OM).hours.length, 3);

check('Open-Meteo local times are converted to UTC for merging',
  tgNormaliseOm(FIXTURE_OM).hours[0].time, '2026-09-08T21:00:00Z');

check('Open-Meteo wind is already km/h and passes through',
  tgNormaliseOm(FIXTURE_OM).hours[0].wind, 9.0);

check('daylight is recorded against the UTC stamp',
  tgNormaliseOm(FIXTURE_OM).daylight.byTime['2026-09-08T21:00:00Z'], false);

check('the local hour is recorded against the UTC stamp',
  tgNormaliseOm(FIXTURE_OM).daylight.localHourByTime['2026-09-08T22:00:00Z'], 0);

check('sunset comes through as minutes since local midnight',
  tgNormaliseOm(FIXTURE_OM).daylight.sunsetMin, 19 * 60 + 41);

check('a broken Open-Meteo payload yields no hours, not a throw',
  tgNormaliseOm({ nonsense: true }).hours.length, 0);
```

- [ ] **Step 2: Run to verify it fails**

Expected: `THREW: tgNormaliseOm is not defined`.

- [ ] **Step 3: Write the implementation**

```js
/* "2026-09-08T23:00" local, plus the offset, as a UTC stamp matching
   what SMHI and MET publish. Built by hand rather than through a
   local Date so a visitor's own timezone can never leak into it. */
function tgLocalToUtc(local, offsetSeconds) {
  var y = parseInt(local.slice(0, 4), 10);
  var mo = parseInt(local.slice(5, 7), 10);
  var d = parseInt(local.slice(8, 10), 10);
  var h = parseInt(local.slice(11, 13), 10);
  var mi = parseInt(local.slice(14, 16), 10);
  var t = new Date(Date.UTC(y, mo - 1, d, h, mi) - (offsetSeconds * 1000));
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' +
         p(t.getUTCDate()) + 'T' + p(t.getUTCHours()) + ':' +
         p(t.getUTCMinutes()) + ':00Z';
}

function tgNormaliseOm(d) {
  var res = { hours: [],
              daylight: { byTime: {}, localHourByTime: {}, sunsetMin: null } };
  if (!d || !d.hourly || !d.hourly.time) return res;

  var off = tgNum(d.utc_offset_seconds, 0);
  var H = d.hourly;
  var i;
  for (i = 0; i < H.time.length; i++) {
    var utc = tgLocalToUtc(H.time[i], off);
    res.hours.push({
      time: utc,
      temp: tgNum(H.temperature_2m[i], 16),
      feels: tgNum(H.apparent_temperature[i], 16),
      pop: tgNum(H.precipitation_probability[i], 0),
      precip: tgNum(H.precipitation[i], 0),
      wind: tgNum(H.wind_speed_10m[i], 0),
      code: tgNum(H.weather_code[i], 3)
    });
    res.daylight.byTime[utc] = H.is_day[i] === 1;
    res.daylight.localHourByTime[utc] = parseInt(H.time[i].slice(11, 13), 10);
  }

  var sunset = d.daily && d.daily.sunset && d.daily.sunset[0];
  if (sunset && sunset.length >= 16) {
    res.daylight.sunsetMin = parseInt(sunset.slice(11, 13), 10) * 60 +
                             parseInt(sunset.slice(14, 16), 10);
  }
  return res;
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: 7 new PASS lines.

- [ ] **Step 5: Commit**

```bash
git add web/blend.js web/test.html
git commit -m "Blend: Open-Meteo normaliser and the daylight spine"
```

---

### Task 8: The doorway — three payloads, one forecast

**Files:**
- Modify: `web/blend.js`, `web/test.html`

**Interfaces:**
- Consumes: every normaliser and `tgBlend`.
- Produces: `tgForecast(raw)` where `raw` is `{ om, met, smhi }` of parsed JSON (any may be null) → `{ now, ahead, sunsetMin, sources }`, exactly the shape `app.js` and `Weather.kt` already hand to `tgDecide`; `null` when nothing usable arrived. Also `tgForecastJson(omJson, metJson, smhiJson)`, the string doorway for Rhino.

This is the seam the rest of the app sees. Everything above it is internal to the blend; everything below it already exists.

- [ ] **Step 1: Write the failing tests**

```js
check('a forecast from all three names all three sources', (() => {
  const f = tgForecast({ om: FIXTURE_OM, met: FIXTURE_MET, smhi: FIXTURE_SMHI });
  return f.sources.sort().join(',');
})(), 'met,om,smhi');

check('a forecast carries the shape the decision expects', (() => {
  const f = tgForecast({ om: FIXTURE_OM, smhi: FIXTURE_SMHI });
  const h = f.ahead[0];
  return typeof h.hour === 'number' && typeof h.feels === 'number' &&
         typeof h.isDay === 'boolean' && typeof h.hoursFromNow === 'number' &&
         typeof h.code === 'number';
})(), true);

check('daylight always comes from Open-Meteo, never from the vote', (() => {
  const f = tgForecast({ om: FIXTURE_OM, met: FIXTURE_MET, smhi: FIXTURE_SMHI });
  return f.ahead.every((h) => h.isDay === false) && f.now.isDay === false;
})(), true);

check('an hour Open-Meteo does not cover is dropped, not guessed', (() => {
  // MET's 20:00Z precedes Open-Meteo's first hour (21:00Z), so it has
  // no daylight and must not appear.
  const f = tgForecast({ om: FIXTURE_OM, met: FIXTURE_MET });
  return f.now.time;
})(), '2026-09-08T21:00:00Z');

check('sunset survives the blend',
  tgForecast({ om: FIXTURE_OM, smhi: FIXTURE_SMHI }).sunsetMin, 19 * 60 + 41);

check('Open-Meteo alone still produces a forecast', (() => {
  const f = tgForecast({ om: FIXTURE_OM });
  return f.ahead.length > 0 && f.sources.join(',') === 'om';
})(), true);

check('no sources at all produces nothing, not a crash',
  tgForecast({}), null);

check('without Open-Meteo there is no daylight, so no forecast',
  tgForecast({ met: FIXTURE_MET, smhi: FIXTURE_SMHI }), null);

check('the string doorway agrees with the object one', (() => {
  const a = tgForecast({ om: FIXTURE_OM, smhi: FIXTURE_SMHI });
  const b = JSON.parse(tgForecastJson(
    JSON.stringify(FIXTURE_OM), null, JSON.stringify(FIXTURE_SMHI)));
  return JSON.stringify(a) === JSON.stringify(b);
})(), true);
```

- [ ] **Step 2: Run to verify it fails**

Expected: `THREW: tgForecast is not defined`.

- [ ] **Step 3: Write the implementation**

```js
/* The one call the rest of the app makes. Raw parsed payloads in
   (any of them null), one forecast out, in the shape tgDecide and
   tgTrends already read.

   Hours with no Open-Meteo daylight are dropped rather than guessed:
   an hour with no is_day scores as night, and night is the
   second-largest penalty there is. */
function tgForecast(raw) {
  var bySource = {};
  var spine = null;

  if (raw.om) {
    spine = tgNormaliseOm(raw.om);
    if (spine.hours.length) bySource.om = spine.hours;
  }
  if (raw.met) {
    var met = tgNormaliseMet(raw.met);
    if (met.length) bySource.met = met;
  }
  if (raw.smhi) {
    var smhi = tgNormaliseSmhi(raw.smhi);
    if (smhi.length) bySource.smhi = smhi;
  }

  if (!spine || !spine.hours.length) return null;
  var blended = tgBlend(bySource);
  if (!blended.length) return null;

  var seen = {};
  var rows = [];
  var i, m;
  for (i = 0; i < blended.length; i++) {
    var b = blended[i];
    var isDay = spine.daylight.byTime[b.time];
    var localHour = spine.daylight.localHourByTime[b.time];
    if (isDay === undefined || localHour === undefined) continue;

    for (m = 0; m < b.sources.length; m++) seen[b.sources[m]] = true;

    rows.push({
      time: b.time, hour: localHour, feels: b.feels, temp: b.temp,
      pop: b.pop, precip: b.precip, wind: b.wind, code: b.code,
      isDay: isDay, hoursFromNow: 0, contributors: b.sources
    });
  }
  if (!rows.length) return null;

  // The first blended hour is "now"; the next twelve are what is coming.
  var now = rows[0];
  var ahead = rows.slice(1, 13);
  for (i = 0; i < ahead.length; i++) ahead[i].hoursFromNow = i + 1;

  var names = [];
  for (i in seen) {
    if (seen.hasOwnProperty(i)) names.push(i);
  }

  return { now: now, ahead: ahead, sunsetMin: spine.daylight.sunsetMin,
           sources: names };
}

/* JSON doorway, so Rhino callers can hand over three response bodies
   without marshalling object graphs field by field. */
function tgForecastJson(omJson, metJson, smhiJson) {
  return JSON.stringify(tgForecast({
    om: omJson ? JSON.parse(omJson) : null,
    met: metJson ? JSON.parse(metJson) : null,
    smhi: smhiJson ? JSON.parse(smhiJson) : null
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Expected: 9 new PASS lines, and every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add web/blend.js web/test.html
git commit -m "Blend: one doorway from three payloads to one forecast"
```

---

### Task 9: The page fetches three sources

**Files:**
- Modify: `web/index.html`, `web/settings.html`, `web/app.js` (replace `getWeather`, currently at `web/app.js:46-104`)

**Interfaces:**
- Consumes: `tgForecast` (Task 8).
- Produces: `getWeather(lat, lon)` — unchanged signature, still returning `{ now, ahead, sunsetMin }`, now with `sources` alongside.

- [ ] **Step 1: Load the blend on both pages**

In `web/index.html` and `web/settings.html`, after the `scoring.js` tag and before `core.js`:

```html
<script src="blend.js"></script>
```

`blend.js` uses `tgNum` from `scoring.js`, so the order matters.

- [ ] **Step 2: Replace getWeather**

In `web/app.js`, replace the whole `getWeather` function with:

```js
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
```

- [ ] **Step 3: Verify on the emulator**

```bash
cd android && ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb emu geo fix 18.0686 59.3293
adb shell am force-stop toys.touchgrass
adb shell monkey -p toys.touchgrass -c android.intent.category.LAUNCHER 1
adb logcat -d | grep -i "chromium.*CONSOLE"
```

Expected: a verdict with real readings, and no console output. Tap an hour — the breakdown panel still adds up to the number on the bar.

- [ ] **Step 4: Commit**

```bash
git add web/app.js web/index.html web/settings.html
git commit -m "Blend: the page fetches all three sources in parallel"
```

---

### Task 10: Say who actually answered

**Files:**
- Modify: `web/lang.js`, `web/index.html`, `web/app.js`

Licence terms require attribution, and the spec requires that the card never claims a source that did not contribute.

- [ ] **Step 1: Add the strings**

`web/lang.js`, English `ui` block:

```js
    blendedFrom: 'Blended from',
    sourceWeight: (name, pct) => `${name} ${pct}%`,
```

Swedish `ui` block:

```js
    blendedFrom: 'Sammanvägt från',
    sourceWeight: (name, pct) => `${name} ${pct} %`,
```

- [ ] **Step 2: Add the container**

In `web/index.html`, inside the "Where this comes from" card, after the existing source list:

```html
    <p class="hint" id="blend-sources"></p>
```

- [ ] **Step 3: Render it**

In `web/app.js`, inside `renderVerdict`, next to the existing `fetched-at` block:

```js
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
```

- [ ] **Step 4: Verify on the emulator**

Rebuild and install as in Task 9. Scroll to "Where this comes from".

Expected in Stockholm: `Blended from MET Norway (YR) 50%, SMHI 25%, Open-Meteo 25%`. Then search for Lisbon and confirm SMHI is **not** listed and the two remaining read 67% and 33%.

- [ ] **Step 5: Commit**

```bash
git add web/lang.js web/index.html web/app.js
git commit -m "Blend: name the sources that actually answered"
```

---

### Task 11: Rhino evaluates the blend too

**Files:**
- Create: `web/fixtures-om.json`, `web/fixtures-smhi.json`
- Modify: `android/app/src/main/java/toys/touchgrass/Scoring.kt`, `android/app/src/test/java/toys/touchgrass/ScoringEngineTest.kt`

**Interfaces:**
- Consumes: `tgForecastJson` (Task 8).
- Produces: `Scoring.blend(omJson: String?, metJson: String?, smhiJson: String?): String?`

- [ ] **Step 1: Write the shared fixture files**

Create `web/fixtures-om.json` and `web/fixtures-smhi.json` holding exactly the JSON inside `FIXTURE_OM` and `FIXTURE_SMHI` from Task 5. Both runtimes then assert against identical bytes.

- [ ] **Step 2: Write the failing test**

In `ScoringEngineTest.kt`, following the existing pattern for loading `scoring.js` from the web directory:

```kotlin
@Test
fun `blends the same way the browser does`() {
    val om = File("../web/fixtures-om.json").readText()
    val smhi = File("../web/fixtures-smhi.json").readText()

    val out = Scoring.blend(om, null, smhi)
    assertNotNull(out)

    val json = JSONObject(out!!)
    assertEquals(2, json.getJSONArray("sources").length())

    // Open-Meteo alone supplies daylight, so every hour must carry it.
    val now = json.getJSONObject("now")
    assertTrue(now.has("isDay"))
    assertEquals(23, now.getInt("hour"))       // 21:00Z is 23:00 local
    assertEquals(19 * 60 + 41, json.getInt("sunsetMin"))
}

@Test
fun `a blend with nothing in it is null`() {
    assertNull(Scoring.blend(null, null, null))
}
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd android && ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ./gradlew test
```

Expected: FAIL — `Scoring.blend` unresolved.

- [ ] **Step 4: Implement it**

In `Scoring.kt`, evaluate `blend.js` immediately after `scoring.js` in the existing script-loading path (it depends on `tgNum`), then add:

```kotlin
/** The blend, evaluated by the web app's own blend.js. */
fun blend(omJson: String?, metJson: String?, smhiJson: String?): String? =
    call(
        "tgForecastJson",
        arrayOf<Any?>(omJson, metJson, smhiJson)
    ) { RhinoContext.toString(it) }
        .takeIf { it != "null" && it.isNotBlank() }
```

Use the existing `call` helper and the existing Rhino context — do not open a second one.

- [ ] **Step 5: Run to verify it passes**

```bash
cd android && ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ./gradlew test
```

Expected: 7 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add android/ web/fixtures-om.json web/fixtures-smhi.json
git commit -m "Blend: Rhino evaluates blend.js alongside scoring.js"
```

---

### Task 12: The background worker blends, and caches

**Files:**
- Modify: `android/app/src/main/java/toys/touchgrass/Weather.kt`

**Interfaces:**
- Consumes: `Scoring.blend` (Task 11).
- Produces: `Weather.fetch(lat, lon): Forecast?` — signature unchanged, so `CheckWorker` and `Widget` need no edits.

- [ ] **Step 1: Fetch three bodies instead of parsing one**

Keep the existing `Forecast` data class. Extract the current single-GET code into a `body(url, ua)` helper returning `String?`, then replace `fetch`:

```kotlin
/** MET Norway's terms require an identifying User-Agent. */
private const val USER_AGENT = "TouchGrass/1.0 github.com/LxO96/Touch-grass"

private const val CACHE_MS = 45 * 60 * 1000L   // the spec's reuse window

private var cachedAt = 0L
private var cachedKey = ""
private var cached: Forecast? = null

fun fetch(lat: Double, lon: Double): Forecast? {
    val key = "%.3f,%.3f".format(lat, lon)
    // Three services per background check is a lot. A check that lands
    // early, or a widget redraw off-schedule, reuses what we have.
    if (cached != null && cachedKey == key &&
        System.currentTimeMillis() - cachedAt < CACHE_MS) return cached

    val om = body(openMeteoUrl(lat, lon))
    val met = body(metUrl(lat, lon), USER_AGENT)
    val smhi = body(smhiUrl(lat, lon))
    if (om == null && met == null && smhi == null) return null

    val blended = Scoring.blend(om, met, smhi) ?: return null
    val parsed = try {
        parseBlended(JSONObject(blended))
    } catch (_: Exception) {
        null
    } ?: return null

    cached = parsed
    cachedAt = System.currentTimeMillis()
    cachedKey = key
    return parsed
}
```

The three URL builders, alongside `fetch` in the same object:

```kotlin
private fun openMeteoUrl(lat: Double, lon: Double) =
    "https://api.open-meteo.com/v1/forecast" +
        "?latitude=$lat&longitude=$lon" +
        "&current=temperature_2m,apparent_temperature,precipitation," +
        "weather_code,wind_speed_10m,is_day" +
        "&hourly=temperature_2m,apparent_temperature," +
        "precipitation_probability,precipitation,weather_code," +
        "wind_speed_10m,is_day" +
        "&daily=sunset&forecast_days=2&timezone=auto"

private fun metUrl(lat: Double, lon: Double) =
    "https://api.met.no/weatherapi/locationforecast/2.0/complete" +
        "?lat=$lat&lon=$lon"

private fun smhiUrl(lat: Double, lon: Double) =
    "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1" +
        "/geotype/point/lon/%.4f/lat/%.4f/data.json".format(lon, lat)
```

And `body`, which is the existing single-GET code with the User-Agent
made settable and the return type changed from `Forecast?` to `String?`:

```kotlin
private fun body(url: String, ua: String? = null): String? = try {
    (URL(url).openConnection() as HttpURLConnection).run {
        connectTimeout = 15_000
        readTimeout = 15_000
        requestMethod = "GET"
        if (ua != null) setRequestProperty("User-Agent", ua)
        try {
            if (responseCode != 200) null
            else inputStream.bufferedReader().readText()
        } finally {
            disconnect()
        }
    }
} catch (_: Exception) {
    null    // offline, DNS, timeout, or a 404 outside SMHI's area
}
```

- [ ] **Step 2: Parse the blended JSON**

`parseBlended` reads what `tgForecastJson` produced. It replaces the existing Open-Meteo-specific `parse`, which is deleted: field names now come from the blend, not from any one API.

```kotlin
private fun parseBlended(d: JSONObject): Forecast? {
    fun hour(o: JSONObject, k: Int) = Scoring.Hour(
        hour = o.getInt("hour"),
        feels = o.getDouble("feels"),
        pop = o.optDouble("pop", 0.0),
        precip = o.optDouble("precip", 0.0),
        wind = o.getDouble("wind"),
        isDay = o.getBoolean("isDay"),
        code = o.getInt("code"),
        hoursFromNow = k,
        label = label(o.getInt("hour"))
    )

    val now = hour(d.optJSONObject("now") ?: return null, 0)
    val arr = d.optJSONArray("ahead") ?: return null
    val ahead = ArrayList<Scoring.Hour>(arr.length())
    for (i in 0 until arr.length()) ahead += hour(arr.getJSONObject(i), i + 1)

    val sunset = if (d.isNull("sunsetMin")) null else d.getInt("sunsetMin")
    return Forecast(now, ahead, sunset)
}
```

- [ ] **Step 3: Run both suites**

```bash
cd android && ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" ./gradlew test
```

plus the web suite. Expected: both green.

- [ ] **Step 4: Verify on the emulator**

Rebuild and install. Add the widget to the home screen, then:

```bash
adb shell am force-stop toys.touchgrass
adb shell monkey -p toys.touchgrass -c android.intent.category.LAUNCHER 1
adb exec-out screencap -p > widget-check.png
```

Expected: the widget's score and the Today page's score are the **same number**. They now come from one blend, so any difference is a bug worth stopping for.

- [ ] **Step 5: Commit**

```bash
git add android/
git commit -m "Blend: the background worker blends and caches for 45 minutes"
```

---

## Notes for the executor

- **Never reimplement the blend in Kotlin.** If Task 11 or 12 tempts you into parsing SMHI or MET JSON on the Kotlin side, stop — that drift is the whole reason this design exists.
- **A weather code outside the described set is a bug.** `lang.js` has no words for it and the sky will read "Weather".
- Task 9 changes the Open-Meteo query: `temperature_2m` joins the `hourly` list, because the blend carries `temp` per hour and the old query only asked for it under `current`.
- `README.md` still says "no second data provider in the loop" and credits Open-Meteo alone. Update it in the final commit — it is now wrong on both counts.
