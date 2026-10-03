# Rain Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in card to Today with three parts:
- a one-sentence summary of the next hour's rain;
- a line of 5-minute rain bars;
- an animated radar map of the last hour.

The map uses SMHI's radar under a dot for you in Sweden, and MET's regional picture in Norway.

**Architecture:** The code is split across two new files.
- **`web/radar.js`** holds all the logic that doesn't need a page:
  - working out where a place falls on SMHI's radar picture;
  - map maths;
  - choosing frames;
  - reading the nowcast;
  - turning it into a sentence.

  `test.html` loads this file, so `node web/run-tests.js` covers all of it.
- **`web/radar-card.js`** builds the card itself: fetching, canvas drawing and the slider.

`app.js` only calls `loadRadarCard(place)`. The setting is `radar` in the existing settings object.

**Tech Stack:**
- Plain browser JavaScript (ES2017, the same as `core.js`), with no libraries.
- Canvas 2D.
- The page runs in the Android WebView through WebViewAssetLoader.
- Tests use the in-house `check()` harness in `web/test.html`, run headless by `web/run-tests.js`.

**Spec:** `docs/superpowers/specs/2026-10-03-rain-radar-design.md`

## Global Constraints

- **Commits.** The user handles commits. Every "Stage" step runs `git add` only. Never `git commit` or `git push`.
- **Tests.** The command is `node web/run-tests.js`, run from the repo root. It starts at 408 passed and 0 failed, and must end every task with 0 failed.
- **No new dependencies.** No npm packages and no CDN scripts.
- **Shipping new files.** New web files must be added to `webAppFiles` in `android/app/build.gradle.kts`, or they won't be in the APK.
- **Settings default.** `DEFAULTS.radar = false`. Nothing is fetched for the card while it's off.
- **Text.** Every user-facing string goes in `web/lang.js` under `ui`, in both `en` and `sv`.
- **Endpoints**, copied exactly:
  - MET Nowcast: `https://api.met.no/weatherapi/nowcast/2.0/complete?lat=..&lon=..`. Use it when `properties.meta.radar_coverage === "ok"`.
  - Open-Meteo fallback: `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&minutely_15=precipitation&forecast_minutely_15=5&timezone=GMT`
  - SMHI day list: `https://opendata-download-radar.smhi.se/api/version/latest/area/sweden/product/comp/YYYY/MM/DD`, by UTC date.
  - MET radar list: `https://api.met.no/weatherapi/radar/2.0/available.json?area=<area>&type=5level_reflectivity&content=image`
  - Map tiles: `https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`
- **SMHI composite.** 471×887 px in SWEREF 99 TM (Transverse Mercator, GRS80, central meridian 15°, k0 0.9996, false easting 500 000). The origin is E 126648.404, N 7771252.876, and a pixel is 2014.9581656050955 m.
- **Rain thresholds.** Below 0.1 mm/h is dry. Light is below 1 mm/h, moderate is 1 to 4 mm/h, and heavy is above 4 mm/h.
- **Credits.** SMHI (CC BY 4.0), MET Norway, © OpenStreetMap contributors, © CARTO.

## Review Focus

These are the five ways the feature is most likely to break that the unit tests don't cover. Each one has a check in the task that owns it.

1. **Changing place while the card loads.** The page often loads a remembered place and then the GPS fix a second later. The card must end up showing the newest place, never the older answer arriving late. Task 6 has a sequence-number guard and a manual check.
2. **Offline.** In airplane mode, with a cached forecast, the card must say the radar can't be reached rather than staying blank or spinning. Task 6 has a manual check.
3. **The setting toggled in Settings.** Back on Today, the card must appear or disappear without a reload. Task 6 has a manual check.
4. **New files missing from the APK.** Missing JS shows up in the browser as nothing, and in the app as a `ReferenceError`. Task 6 checks the APK's contents.
5. **SMHI's list falling behind, or the hour after UTC midnight.** The card must never animate old rain as if it were now. Task 3 has unit tests for both.

---

### Task 1: Where you are on the radar picture

**Files:**
- Create: `web/radar.js`
- Modify: `web/test.html` (add a `<script>` tag after `core.js`, and tests before the `BK.forEach` restore block near the end)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Constants `SMHI_W = 471` and `SMHI_H = 887`
  - `sweref99(lat, lon) → {e, n}`
  - `smhiPixel(lat, lon) → {x, y}`
  - `metArea(lat, lon) → string | null`
  - `radarSource(lat, lon) → {kind:'smhi', x, y} | {kind:'met', area} | null`
  - `smhiCovered(data, w, x, y) → boolean`
  - `cleanSmhi(data, w) → void`

- [ ] **Step 1: Write the failing tests**

In `web/test.html`, add `<script src="radar.js"></script>` on the line after `<script src="core.js"></script>`. `run-tests.js` loads whatever `test.html` loads.

Then insert this block just before the `BK.forEach((k, i) => {` restore block at the end of the tests:

```js
/* ---------- the rain radar: where you are on SMHI's picture ---------- */

const near = (a, b, tol) => Math.abs(a - b) <= tol;

check('Stockholm in SWEREF 99 TM', (() => {
  const p = sweref99(59.3293, 18.0686);
  return near(p.e, 674571.9, 1) && near(p.n, 6580743.0, 1);
})(), true);

check('Kiruna in SWEREF 99 TM, far north and east of the central meridian', (() => {
  const p = sweref99(67.8558, 20.2253);
  return near(p.e, 719583.1, 1) && near(p.n, 7536070.0, 1);
})(), true);

check('Stockholm lands on its pixel of the composite', (() => {
  const p = smhiPixel(59.3293, 18.0686);
  return near(p.x, 271.93, 0.05) && near(p.y, 590.84, 0.05);
})(), true);

check('the radar source: SMHI for Stockholm, MET for Bergen, none for London', [
  radarSource(59.3293, 18.0686).kind,
  radarSource(60.3913, 5.3221).kind + ':' + radarSource(60.3913, 5.3221).area,
  radarSource(51.5072, -0.1276)
].join(','), 'smhi,met:western_norway,');

check('MET areas: Tromsø, Trondheim, and Helsinki falls back to the Nordic picture',
  [metArea(69.6492, 18.9553), metArea(63.4305, 10.3951),
   metArea(60.1699, 24.9384), metArea(51.5, -0.13)].join(','),
  'troms,central_norway,nordic,');

check("outside the radars' reach is the faint veil; inside is clear or rain", (() => {
  // A 3×1 picture: dry and covered, the veil, green rain.
  const d = new Uint8ClampedArray([0, 0, 0, 0,  0, 0, 0, 15,  0, 178, 0, 255]);
  return [smhiCovered(d, 3, 0, 0), smhiCovered(d, 3, 1, 0),
          smhiCovered(d, 3, 2, 0), smhiCovered(d, 3, 7, 0)].join(',');
})(), 'true,false,true,false');

check('the SMHI logo is wiped, the rain kept', (() => {
  const w = 200, d = new Uint8ClampedArray(w * 100 * 4);
  const px = (x, y) => (y * w + x) * 4;
  d.set([0, 0, 0, 255], px(30, 30));     // logo
  d.set([0, 178, 0, 255], px(150, 30));  // rain beside it
  d.set([0, 178, 0, 255], px(30, 80));   // rain below it
  cleanSmhi(d, w);
  return [d[px(30, 30) + 3], d[px(150, 30) + 3], d[px(30, 80) + 3]].join(',');
})(), '0,255,255');
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node web/run-tests.js`
Expected: the run fails, either with `THREW` / `ENOENT` because `radar.js` doesn't exist yet, or with `sweref99 is not defined`.

- [ ] **Step 3: Write `web/radar.js`**

```js
/* ==========================================================
   TOUCH GRASS — the rain radar's arithmetic
   Where you are on SMHI's radar picture, which frames to show,
   and what the next hour's rain comes to in words. Nothing here
   touches the page, so test.html checks all of it; radar-card.js
   does the drawing.
   ========================================================== */

/* ---------- SMHI's composite: SWEREF 99 TM, 2 km a pixel ---------- */

const SMHI_W = 471, SMHI_H = 887;
const SMHI_E0 = 126648.404, SMHI_N0 = 7771252.876;
const SMHI_PX = 2014.9581656050955;

/* Transverse Mercator on GRS 80, by Krüger's series as Lantmäteriet
   gives it. Checked against Snyder's formulas to a tenth of a metre. */
function sweref99(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = 15, FE = 500000;
  const e2 = f * (2 - f), n = f / (2 - f);
  const ah = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
  const A = e2, B = (5 * e2 ** 2 - e2 ** 3) / 6,
        C = (104 * e2 ** 3 - 45 * e2 ** 4) / 120, D = 1237 * e2 ** 4 / 1260;
  const b = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180,
             13 * n * n / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440,
             61 * n ** 3 / 240 - 103 * n ** 4 / 140,
             49561 * n ** 4 / 161280];
  const phi = lat * Math.PI / 180, dl = (lon - lon0) * Math.PI / 180;
  const s = Math.sin(phi);
  const phis = phi - s * Math.cos(phi) * (A + B * s * s + C * s ** 4 + D * s ** 6);
  const xi = Math.atan(Math.tan(phis) / Math.cos(dl));
  const eta = Math.atanh(Math.cos(phis) * Math.sin(dl));
  let x = xi, y = eta;
  for (let j = 0; j < 4; j++) {
    const k = 2 * (j + 1);
    x += b[j] * Math.sin(k * xi) * Math.cosh(k * eta);
    y += b[j] * Math.cos(k * xi) * Math.sinh(k * eta);
  }
  return { e: k0 * ah * y + FE, n: k0 * ah * x };
}

function smhiPixel(lat, lon) {
  const p = sweref99(lat, lon);
  return { x: (p.e - SMHI_E0) / SMHI_PX, y: (SMHI_N0 - p.n) / SMHI_PX };
}

/* MET's regional pictures. The boxes are rough on purpose: each
   picture reaches well past its region's edge. Anywhere else in
   Scandinavia and Finland gets the coarse Nordic picture. */
const MET_AREAS = [
  ['southwestern_norway', 57.9, 59.9, 4.5, 8.0],
  ['southeastern_norway', 58.5, 60.0, 8.0, 12.0],
  ['western_norway',      59.9, 62.2, 4.5, 8.5],
  ['eastern_norway',      60.0, 62.7, 8.5, 12.8],
  ['northwestern_norway', 62.2, 63.6, 5.0, 9.5],
  ['central_norway',      62.7, 65.1, 8.5, 14.5],
  ['southern_nordland',   65.1, 67.0, 11.0, 16.5],
  ['northern_nordland',   67.0, 68.8, 12.0, 17.8],
  ['troms',               68.8, 70.4, 15.5, 22.5],
  ['finnmark',            69.2, 71.3, 21.5, 31.2]
];

function metArea(lat, lon) {
  for (const [area, s, n, w, e] of MET_AREAS) {
    if (lat >= s && lat < n && lon >= w && lon < e) return area;
  }
  return (lat >= 54.5 && lat < 71.5 && lon >= 4 && lon < 32) ? 'nordic' : null;
}

/* SMHI first whenever you're on its picture: it's the one we can put
   you on. Whether its radars actually reach you is only known once a
   frame is loaded (smhiCovered); radar-card.js falls back to metArea. */
function radarSource(lat, lon) {
  const p = smhiPixel(lat, lon);
  if (p.x >= 0 && p.x < SMHI_W && p.y >= 0 && p.y < SMHI_H) return { kind: 'smhi', x: p.x, y: p.y };
  const area = metArea(lat, lon);
  return area ? { kind: 'met', area } : null;
}

/* Outside the radars' reach SMHI paints a faint black veil (alpha 15);
   inside it, where it's dry, the picture is fully clear. */
function smhiCovered(data, w, x, y) {
  const h = data.length / 4 / w, cx = Math.round(x), cy = Math.round(y);
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
  const i = (cy * w + cx) * 4;
  return !(data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 15);
}

// SMHI's logo sits in the top-left corner, over the sea off Norway.
function cleanSmhi(data, w) {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 120; x++) data[(y * w + x) * 4 + 3] = 0;
  }
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node web/run-tests.js`
Expected: `=== 415 passed, 0 failed ===`

- [ ] **Step 5: Stage**

```bash
git add web/radar.js web/test.html
```

---

### Task 2: The map around you

**Files:**
- Modify: `web/radar.js` (append)
- Modify: `web/test.html` (append to the radar block)

**Interfaces:**
- Consumes: `smhiPixel` from Task 1.
- Produces:
  - `RADAR_TILE = 256`
  - `toWorld(lat, lon, z) → {x, y}` (Web Mercator world pixels)
  - `fromWorld(x, y, z) → {lat, lon}`
  - `mapView(lat, lon, z, size) → {z, size, x0, y0}`
  - `tilesFor(view) → [{x, y, dx, dy}]`
  - `tileUrl(z, x, y) → string`
  - `cellAffine(view, l, t, r, b) → [a, b, c, d, e, f]`, in the same order as `ctx.setTransform`, mapping SMHI pixels to canvas pixels; fitted at the centre of that canvas rectangle
  - `smhiCells(view, n = 4) → [{l, t, r, b, m}]`, an n×n grid of rectangles covering the canvas, each with its own `m` from `cellAffine`
  - `applyAffine(m, x, y) → {x, y}`

- [ ] **Step 1: Write the failing tests** (append after the Task 1 block)

```js
/* ---------- the rain radar: the map around you ---------- */

check('Web Mercator round trip', (() => {
  const w = toWorld(59.3293, 18.0686, 8), b = fromWorld(w.x, w.y, 8);
  return near(b.lat, 59.3293, 1e-9) && near(b.lon, 18.0686, 1e-9);
})(), true);

check('the map is centred on you', (() => {
  const v = mapView(59.3293, 18.0686, 8, 320), c = toWorld(59.3293, 18.0686, 8);
  return near(v.x0 + 160, c.x, 1e-9) && near(v.y0 + 160, c.y, 1e-9) && v.z === 8 && v.size === 320;
})(), true);

check('the tiles cover the whole map and nothing more', (() => {
  const v = mapView(59.3293, 18.0686, 8, 320), ts = tilesFor(v);
  const covers = Math.min(...ts.map((t) => t.dx)) <= 0 && Math.min(...ts.map((t) => t.dy)) <= 0
    && Math.max(...ts.map((t) => t.dx + 256)) >= 320 && Math.max(...ts.map((t) => t.dy + 256)) >= 320;
  const noneWasted = ts.every((t) => t.dx < 320 && t.dx + 256 > 0 && t.dy < 320 && t.dy + 256 > 0);
  return covers && noneWasted && ts.length <= 9;
})(), true);

check("tile urls spread over CARTO's hosts", tileUrl(8, 144, 73),
  'https://b.basemaps.cartocdn.com/light_all/8/144/73.png');

const cellAt = (cells, x, y) => cells.find((q) => x >= q.l && x < q.r && y >= q.t && y < q.b);

check('the cells tile the map exactly', (() => {
  const cells = smhiCells(mapView(59.3293, 18.0686, 8, 320));
  const area = cells.reduce((sum, q) => sum + (q.r - q.l) * (q.b - q.t), 0);
  return cells.length + ' ' + area;
})(), '16 102400');

check('the radar lines up under you', (() => {
  const v = mapView(59.3293, 18.0686, 8, 320), cells = smhiCells(v);
  const s = smhiPixel(59.3293, 18.0686), c = applyAffine(cellAt(cells, 160, 160).m, s.x, s.y);
  return near(c.x, 160, 0.2) && near(c.y, 160, 0.2);
})(), true);

check('and everywhere on the map it is within a quarter pixel, Malmö to Kiruna', [
  [59.3293, 18.0686], [67.8558, 20.2253], [55.6050, 13.0038]
].every(([lat, lon]) => {
  const v = mapView(lat, lon, 8, 320), cells = smhiCells(v);
  for (let cy = 0; cy < 320; cy += 8) {
    for (let cx = 0; cx < 320; cx += 8) {
      const g = fromWorld(v.x0 + cx, v.y0 + cy, 8), s = smhiPixel(g.lat, g.lon);
      const c = applyAffine(cellAt(cells, cx, cy).m, s.x, s.y);
      if (Math.hypot(c.x - cx, c.y - cy) > 0.25) return false;
    }
  }
  return true;
}), true);
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node web/run-tests.js`
Expected: THREW `toWorld is not defined`

- [ ] **Step 3: Append to `web/radar.js`**

```js
/* ---------- the map: Web Mercator tiles, the radar laid over them ---------- */

const RADAR_TILE = 256;

function toWorld(lat, lon, z) {
  const scale = RADAR_TILE * 2 ** z, s = Math.sin(lat * Math.PI / 180);
  return { x: (lon + 180) / 360 * scale,
           y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}

function fromWorld(x, y, z) {
  const scale = RADAR_TILE * 2 ** z;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI,
           lon: x / scale * 360 - 180 };
}

// A square of `size` world pixels with you in the middle.
function mapView(lat, lon, z, size) {
  const c = toWorld(lat, lon, z);
  return { z, size, x0: c.x - size / 2, y0: c.y - size / 2 };
}

function tilesFor(v) {
  const out = [];
  for (let ty = Math.floor(v.y0 / RADAR_TILE); ty * RADAR_TILE < v.y0 + v.size; ty++) {
    for (let tx = Math.floor(v.x0 / RADAR_TILE); tx * RADAR_TILE < v.x0 + v.size; tx++) {
      out.push({ x: tx, y: ty, dx: tx * RADAR_TILE - v.x0, dy: ty * RADAR_TILE - v.y0 });
    }
  }
  return out;
}

function tileUrl(z, x, y) {
  return `https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
}

/* SMHI's picture is in SWEREF 99 TM, the map in Web Mercator. Across
   the whole map one is not quite a stretched, rotated copy of the
   other (two pixels out at the edges), but across a quarter of it it
   is, to a seventh of a pixel. So the map is cut into a 4×4 grid and
   each cell gets its own fit, taken at its centre; the canvas draws
   each through setTransform and a clip. */
function cellAffine(v, l, t, r, b) {
  const at = (cx, cy) => {
    const g = fromWorld(v.x0 + cx, v.y0 + cy, v.z);
    return smhiPixel(g.lat, g.lon);
  };
  const mx = (l + r) / 2, my = (t + b) / 2, hx = (r - l) / 2, hy = (b - t) / 2;
  const S = at(mx, my), E = at(mx + hx, my), W = at(mx - hx, my);
  const N = at(mx, my - hy), D = at(mx, my + hy);
  // smhi ≈ S + U·(cx − mx) + V·(cy − my); invert it to get canvas from smhi.
  const U = { x: (E.x - W.x) / (2 * hx), y: (E.y - W.y) / (2 * hx) };
  const V = { x: (D.x - N.x) / (2 * hy), y: (D.y - N.y) / (2 * hy) };
  const det = U.x * V.y - V.x * U.y;
  const a = V.y / det, c = -V.x / det, b2 = -U.y / det, d = U.x / det;
  return [a, b2, c, d, mx - (a * S.x + c * S.y), my - (b2 * S.x + d * S.y)];
}

function smhiCells(v, n = 4) {
  const edge = (i) => Math.round(i * v.size / n), out = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const l = edge(i), t = edge(j), r = edge(i + 1), b = edge(j + 1);
      out.push({ l, t, r, b, m: cellAffine(v, l, t, r, b) });
    }
  }
  return out;
}

function applyAffine(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node web/run-tests.js`
Expected: `=== 422 passed, 0 failed ===`

- [ ] **Step 5: Stage**

```bash
git add web/radar.js web/test.html
```

---

### Task 3: Which frames to show

**Files:**
- Modify: `web/radar.js` (append)
- Modify: `web/test.html` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `smhiDayUrls(now) → string[]` (yesterday's list comes first when it's needed)
  - `smhiFrames(listings, now, n = 13) → [{t, url}]`, oldest first
  - `metRadarUrl(area) → string`
  - `metFrames(list, now, n = 13) → [{t, url}]`, oldest first

  Both frame functions return `[]` when the newest frame is more than 30 minutes old.

- [ ] **Step 1: Write the failing tests** (append)

```js
/* ---------- the rain radar: which frames ---------- */

const smhiFile = (valid, png = true) => ({ key: 'radar_x', valid,
  formats: png ? [{ key: 'png', link: 'P' + valid }, { key: 'tif', link: 'T' }]
               : [{ key: 'h5', link: 'H' }] });
const fiveMin = (startUtcMs, count) => Array.from({ length: count }, (_, i) =>
  new Date(startUtcMs + i * 300000).toISOString().slice(0, 16).replace('T', ' '));

check('SMHI: the newest 13 PNG frames, oldest first, none from the future', (() => {
  const now = Date.UTC(2026, 9, 3, 9, 32);
  const day = { files: fiveMin(Date.UTC(2026, 9, 3, 7, 0), 40).map((v) => smhiFile(v))
                     .concat([smhiFile('2026-10-03 09:35', false)]) };
  const fr = smhiFrames([day], now);
  return fr.length + ' ' + fr[0].url + ' ' + fr[12].url;
})(), '13 P2026-10-03 08:30 P2026-10-03 09:30');

check("SMHI just after midnight: yesterday's list fills the hour", (() => {
  const now = Date.UTC(2026, 9, 3, 0, 12);
  const urls = smhiDayUrls(now);
  const y = { files: fiveMin(Date.UTC(2026, 9, 2, 22, 0), 24).map((v) => smhiFile(v)) };
  const t = { files: fiveMin(Date.UTC(2026, 9, 3, 0, 0), 3).map((v) => smhiFile(v)) };
  const fr = smhiFrames([y, t], now);
  return urls.map((u) => u.slice(-10)).join(',') + ' ' + fr.length + ' ' + fr[0].url + ' ' + fr[12].url;
})(), '2026/10/02,2026/10/03 13 P2026-10-02 23:10 P2026-10-03 00:10');

check('SMHI at midday needs only today', smhiDayUrls(Date.UTC(2026, 9, 3, 12, 0)).length, 1);

check('SMHI: a list that stopped long ago shows nothing', (() => {
  const now = Date.UTC(2026, 9, 3, 9, 32);
  const day = { files: fiveMin(Date.UTC(2026, 9, 3, 7, 0), 13).map((v) => smhiFile(v)) };
  return smhiFrames([day, null], now).length;
})(), 0);

check('MET: still images only, newest 13, oldest first', (() => {
  const now = Date.UTC(2026, 9, 3, 9, 32);
  const list = fiveMin(Date.UTC(2026, 9, 3, 7, 0), 31).map((v) => ({
    params: { area: 'western_norway', content: 'image', type: '5level_reflectivity',
              time: v.replace(' ', 'T') + ':00Z' },
    uri: 'U' + v.slice(11) }))
    .concat([{ params: { content: 'animation', time: '2026-10-03T09:30:00Z' }, uri: 'ANIM' }]);
  const fr = metFrames(list, now);
  return fr.length + ' ' + fr[0].url + ' ' + fr[12].url + ' ' + metFrames(null, now).length;
})(), '13 U08:30 U09:30 0');

check('MET radar list url asks for one area only', metRadarUrl('troms'),
  'https://api.met.no/weatherapi/radar/2.0/available.json?area=troms&type=5level_reflectivity&content=image');
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node web/run-tests.js`
Expected: THREW `smhiFrames is not defined`

- [ ] **Step 3: Append to `web/radar.js`**

```js
/* ---------- frames: the last hour, five minutes apart ---------- */

const RADAR_STALE_MS = 30 * 60000;
const SMHI_LIST = 'https://opendata-download-radar.smhi.se/api/version/latest/area/sweden/product/comp/';

/* SMHI files its frames by UTC day; just after midnight the last hour
   is mostly in yesterday's list. */
function smhiDayUrls(now) {
  const two = (n) => String(n).padStart(2, '0');
  const day = (t) => {
    const d = new Date(t);
    return SMHI_LIST + d.getUTCFullYear() + '/' + two(d.getUTCMonth() + 1) + '/' + two(d.getUTCDate());
  };
  return new Date(now).getUTCHours() < 1 ? [day(now - 86400000), day(now)] : [day(now)];
}

// Oldest first, the newest n, and nothing if the newest is long gone:
// a list that stopped an hour ago would animate old rain as if it were now.
function lastFrames(frames, now, n) {
  const kept = frames.filter((f) => Number.isFinite(f.t) && f.t <= now).sort((a, b) => a.t - b.t).slice(-n);
  return kept.length && now - kept[kept.length - 1].t <= RADAR_STALE_MS ? kept : [];
}

function smhiFrames(listings, now, n = 13) {
  const all = [];
  for (const l of listings) {
    if (!l || !Array.isArray(l.files)) continue;
    for (const f of l.files) {
      const png = (f.formats || []).find((x) => x.key === 'png');
      // "valid" is "2026-10-03 09:25", in UTC.
      if (png && png.link) all.push({ t: Date.parse(String(f.valid).replace(' ', 'T') + 'Z'), url: png.link });
    }
  }
  return lastFrames(all, now, n);
}

const metRadarUrl = (area) => 'https://api.met.no/weatherapi/radar/2.0/available.json'
  + `?area=${area}&type=5level_reflectivity&content=image`;

function metFrames(list, now, n = 13) {
  if (!Array.isArray(list)) return [];
  return lastFrames(list.filter((e) => e && e.params && e.params.content === 'image' && e.uri)
    .map((e) => ({ t: Date.parse(e.params.time), url: e.uri })), now, n);
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node web/run-tests.js`
Expected: `=== 428 passed, 0 failed ===`

- [ ] **Step 5: Stage**

```bash
git add web/radar.js web/test.html
```

---

### Task 4: The next hour's rain, read and said

**Files:**
- Modify: `web/radar.js` (append)
- Modify: `web/lang.js`, in the `ui:` block of `en` (after `tapAnHour`, near line 155) and of `sv` (after `tapAnHour`, near line 519)
- Modify: `web/test.html` (append)

**Interfaces:**
- Consumes: `T()` from `lang.js`.
- Produces:
  - `NOWCAST_URL(lat, lon)` and `MINUTELY_URL(lat, lon)`
  - `parseNowcast(json, now) → {source:'met', step:5, steps:[{t, mmh}]} | null`
  - `parseMinutely(json, now) → {source:'om', step:15, steps} | null`
  - `rainLevel(mmh) → 0..3`
  - `rainBar(mmh) → 0..100`, a height in percent
  - `rainSummary(nc, now) → string`
  - New `ui` keys in `lang.js`: `radarTitle`, `radarDown`, `radarModel`, `radarPlay`, `radarCreditSmhi`, `radarCreditMet`, `rainNow`, `rainLevels`, `rainDry`, `rainAll`, `rainStops`, `rainStarts`, `rainStartsStays`

- [ ] **Step 1: Write the failing tests** (append)

```js
/* ---------- the rain radar: the next hour, read and said ---------- */

const NOW_RAIN = Date.UTC(2026, 9, 3, 9, 32);
const metNow = (coverage, rates, start) => ({ properties: { meta: { radar_coverage: coverage },
  timeseries: rates.map((r, i) => ({ time: new Date(start + i * 300000).toISOString().replace('.000', ''),
    data: { instant: { details: { precipitation_rate: r } } } })) } });

check('MET nowcast: from the step in progress to 90 minutes on', (() => {
  const nc = parseNowcast(metNow('ok', new Array(25).fill(0.2), Date.UTC(2026, 9, 3, 9, 20)), NOW_RAIN);
  return nc.source + ' ' + nc.step + ' ' + nc.steps.length + ' '
    + new Date(nc.steps[0].t).toISOString().slice(11, 16);
})(), 'met 5 19 09:30');

check('MET nowcast without radar here is no nowcast',
  parseNowcast(metNow('temporarily unavailable', [0, 0, 0], NOW_RAIN), NOW_RAIN), null);

check('MET nowcast that has gone stale is no nowcast',
  parseNowcast(metNow('ok', [0, 0, 0], Date.UTC(2026, 9, 3, 7, 0)), NOW_RAIN), null);

check('garbage in, no nowcast out',
  [parseNowcast(null, NOW_RAIN), parseNowcast({}, NOW_RAIN),
   parseMinutely(null, NOW_RAIN), parseMinutely({ minutely_15: {} }, NOW_RAIN)].join(','), ',,,');

check('Open-Meteo quarters: mm per 15 min becomes mm/h, the next hour only', (() => {
  const t0 = Date.UTC(2026, 9, 3, 9, 15);
  const om = { minutely_15: {
    time: [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(t0 + i * 900000).toISOString().slice(0, 16)),
    precipitation: [0, 0.25, 0.5, 0, 0, 0, 1] } };
  const nc = parseMinutely(om, NOW_RAIN);
  return nc.source + ' ' + nc.step + ' ' + nc.steps.map((s) => s.mmh).join('/');
})(), 'om 15 1/2/0/0/0');

check('rain levels: dry, light, moderate, heavy',
  [0, 0.1, 0.99, 1, 4, 4.1].map(rainLevel).join(','), '0,1,1,2,2,3');

check('rain bars on a fixed scale, so drizzle never looks like a downpour',
  [0, 0.05, 0.1, 1, 10, 50].map(rainBar).join(','), '0,0,20,60,100,100');

const ncOf = (rates, step = 5) => ({ source: 'met', step,
  steps: rates.map((r, i) => ({ t: NOW_RAIN + i * step * 60000, mmh: r })) });
const zeros = (n) => new Array(n).fill(0);

check('said: dry', rainSummary(ncOf(zeros(19)), NOW_RAIN), 'Dry for the next 90 min.');
check('said: a trace is still dry', rainSummary(ncOf(new Array(19).fill(0.05)), NOW_RAIN),
  'Dry for the next 90 min.');
check('said: a shower coming',
  rainSummary(ncOf([0, 0, 0, 0, 0.5, 0.8, 0.6].concat(zeros(12))), NOW_RAIN),
  'Rain in about 20 min, light, for about 15 min.');
check('said: raining now, stopping',
  rainSummary(ncOf([2, 2, 2].concat(zeros(16))), NOW_RAIN),
  'Raining now, moderate. Stops in about 15 min.');
check('said: raining all along', rainSummary(ncOf(new Array(19).fill(5)), NOW_RAIN),
  'Raining for the next 90 min, heavy.');
check('said: rain coming that stays',
  rainSummary(ncOf(zeros(6).concat(new Array(13).fill(0.3))), NOW_RAIN),
  'Rain in about 30 min, light, and it keeps on.');
check('said: from quarter hours', rainSummary(ncOf([0, 1, 2, 0, 0], 15), NOW_RAIN),
  'Rain in about 15 min, moderate, for about 30 min.');
check('said in Swedish', (() => {
  localStorage.setItem('touchgrass.lang', 'sv'); LANG_CACHE = null;
  const out = rainSummary(ncOf([0, 0, 0, 0, 0.5, 0.8, 0.6].concat(zeros(12))), NOW_RAIN);
  localStorage.setItem('touchgrass.lang', 'en'); LANG_CACHE = null;
  return out;
})(), 'Regn om ungefär 20 min, lätt, i ungefär 15 min.');
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `node web/run-tests.js`
Expected: THREW `parseNowcast is not defined`

- [ ] **Step 3: Add the strings to `web/lang.js`**

In the `en` `ui:` block, directly after the `tapAnHour: ...` line:

```js
    radarTitle: 'Rain, next hour',
    radarDown: "The radar can't be reached right now.",
    radarModel: 'No radar here, so this line is from the forecast model.',
    radarPlay: 'Play the last hour of radar',
    radarCreditSmhi: 'Radar: SMHI · Map: © OpenStreetMap, © CARTO',
    radarCreditMet: 'Radar: MET Norway',
    rainNow: 'now',
    rainLevels: ['', 'light', 'moderate', 'heavy'],
    rainDry: (m) => `Dry for the next ${m} min.`,
    rainAll: (m, lvl) => `Raining for the next ${m} min, ${lvl}.`,
    rainStops: (m, lvl) => `Raining now, ${lvl}. Stops in about ${m} min.`,
    rainStarts: (m, d, lvl) => `Rain in about ${m} min, ${lvl}, for about ${d} min.`,
    rainStartsStays: (m, lvl) => `Rain in about ${m} min, ${lvl}, and it keeps on.`,
```

In the `sv` `ui:` block, directly after its `tapAnHour: ...` line:

```js
    radarTitle: 'Regn, närmaste timmen',
    radarDown: 'Radarn går inte att nå just nu.',
    radarModel: 'Ingen radar här, så linjen kommer från prognosmodellen.',
    radarPlay: 'Spela upp senaste timmens radar',
    radarCreditSmhi: 'Radar: SMHI · Karta: © OpenStreetMap, © CARTO',
    radarCreditMet: 'Radar: Meteorologisk institutt',
    rainNow: 'nu',
    rainLevels: ['', 'lätt', 'måttligt', 'kraftigt'],
    rainDry: (m) => `Uppehåll de närmaste ${m} min.`,
    rainAll: (m, lvl) => `Regn de närmaste ${m} min, ${lvl}.`,
    rainStops: (m, lvl) => `Regnar nu, ${lvl}. Slutar om ungefär ${m} min.`,
    rainStarts: (m, d, lvl) => `Regn om ungefär ${m} min, ${lvl}, i ungefär ${d} min.`,
    rainStartsStays: (m, lvl) => `Regn om ungefär ${m} min, ${lvl}, och det håller i sig.`,
```

- [ ] **Step 4: Append to `web/radar.js`**

```js
/* ---------- the next hour's rain ---------- */

const NOWCAST_URL = (lat, lon) => 'https://api.met.no/weatherapi/nowcast/2.0/complete'
  + `?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

// Open-Meteo's quarter hours, for where MET has no radar. Model, not radar.
const MINUTELY_URL = (lat, lon) => 'https://api.open-meteo.com/v1/forecast'
  + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
  + '&minutely_15=precipitation&forecast_minutely_15=5&timezone=GMT';

const RAIN_WET = 0.1;   // mm/h; less than this is dry

// Keeps the step in progress, drops the past, stops at `ahead` minutes.
function rainSteps(raw, now, stepMin, aheadMin) {
  const steps = raw.filter((x) => Number.isFinite(x.t) && typeof x.mmh === 'number' && isFinite(x.mmh)
    && x.t > now - stepMin * 60000 && x.t <= now + aheadMin * 60000);
  return steps.length >= 2 ? steps : null;
}

function parseNowcast(j, now) {
  const p = j && j.properties;
  if (!p || !p.meta || p.meta.radar_coverage !== 'ok' || !Array.isArray(p.timeseries)) return null;
  const steps = rainSteps(p.timeseries.map((e) => {
    const d = e && e.data && e.data.instant && e.data.instant.details;
    return { t: Date.parse(e && e.time), mmh: d ? d.precipitation_rate : undefined };
  }), now, 5, 90);
  return steps && { source: 'met', step: 5, steps };
}

function parseMinutely(j, now) {
  const m = j && j.minutely_15;
  if (!m || !Array.isArray(m.time) || !Array.isArray(m.precipitation)) return null;
  // Asked for in GMT, written without the Z.
  const steps = rainSteps(m.time.map((t, i) => ({
    t: Date.parse(t + 'Z'),
    mmh: typeof m.precipitation[i] === 'number' ? m.precipitation[i] * 4 : undefined
  })), now, 15, 60);
  return steps && { source: 'om', step: 15, steps };
}

function rainLevel(mmh) {
  return mmh < RAIN_WET ? 0 : mmh < 1 ? 1 : mmh <= 4 ? 2 : 3;
}

// 0.1 mm/h is a fifth of the bar, 1 mm/h three fifths, 10 mm/h the lot.
function rainBar(mmh) {
  return mmh < RAIN_WET ? 0 : Math.min(100, Math.round(20 + 40 * Math.log10(mmh / RAIN_WET)));
}

function rainSummary(nc, now) {
  const L = T().ui, s = nc.steps;
  const mins = (ms) => Math.max(5, Math.round(ms / 60000 / 5) * 5);
  const wet = s.map((x) => x.mmh >= RAIN_WET);
  const first = wet.indexOf(true);
  if (first < 0) return L.rainDry(mins(s[s.length - 1].t - now));
  const dry = wet.indexOf(false, first);
  const run = s.slice(first, dry < 0 ? s.length : dry);
  const lvl = L.rainLevels[Math.max(...run.map((x) => rainLevel(x.mmh)))];
  if (first === 0) {
    return dry < 0 ? L.rainAll(mins(s[s.length - 1].t - now), lvl)
                   : L.rainStops(mins(s[dry].t - now), lvl);
  }
  const start = mins(s[first].t - now);
  return dry < 0 ? L.rainStartsStays(start, lvl)
                 : L.rainStarts(start, mins(s[dry].t - s[first].t), lvl);
}
```

- [ ] **Step 5: Run the tests to check they pass**

Run: `node web/run-tests.js`
Expected: `=== 443 passed, 0 failed ===`. If the repo has a check that `en` and `sv` share the same keys, it passes too, because both blocks get the same keys.

- [ ] **Step 6: Stage**

```bash
git add web/radar.js web/lang.js web/test.html
```

---

### Task 5: The setting

**Files:**
- Modify: `web/core.js:23-34` (`DEFAULTS`) and `web/core.js:53-72` (`getSettings`)
- Modify: `web/settings.html:85-89` (after the novelty toggle)
- Modify: `web/settings.js:251-271` (`paintNovelty` and a change handler)
- Modify: `web/lang.js` (`ui` in `en` and `sv`, after `noveltyBlurb`)
- Modify: `web/test.html` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getSettings().radar`, a boolean that's `false` unless it was stored as `true`.

- [ ] **Step 1: Write the failing test** (append)

```js
check('the rain radar stays off until asked for', (() => {
  const real = localStorage.getItem('touchgrass.settings');
  localStorage.removeItem('touchgrass.settings');
  const off = getSettings().radar;
  localStorage.setItem('touchgrass.settings', JSON.stringify({ radar: true }));
  const on = getSettings().radar;
  localStorage.setItem('touchgrass.settings', JSON.stringify({ radar: 'yes' }));
  const junk = getSettings().radar;
  if (real === null) localStorage.removeItem('touchgrass.settings');
  else localStorage.setItem('touchgrass.settings', real);
  return [off, on, junk, freshDefaults().radar].join(',');
})(), 'false,true,false,false');
```

- [ ] **Step 2: Run it to check it fails**

Run: `node web/run-tests.js`
Expected: `FAIL  the rain radar stays off until asked for`, with got=`,,,`

- [ ] **Step 3: Implement**

In `web/core.js` `DEFAULTS`, after the `aurora: true,` line:

```js
  radar: false,   // the rain radar card on Today
```

In `getSettings()`, after `s.aurora = raw.aurora !== false;`:

```js
    s.radar = raw.radar === true;
```

In `web/settings.html`, after the novelty `<p class="hint small" data-t="noveltyBlurb">…</p>`:

```html

    <label class="switch">
      <input type="checkbox" id="radar">
      <span data-t="radarToggle">Rain radar on Today</span>
    </label>
    <p class="hint small" data-t="radarBlurb">A radar map of the last hour and the next hour's rain.</p>
```

In `web/settings.js` `paintNovelty()`, add after the aurora lines:

```js
  const rad = $('radar');
  if (rad) rad.checked = SETTINGS.radar === true;
```

Then, after the `if ($('aurora')) { ... }` block:

```js
if ($('radar')) {
  $('radar').addEventListener('change', () => {
    SETTINGS.radar = $('radar').checked;
    saveSettings(SETTINGS);
  });
}
```

In `web/lang.js` `en` `ui`, after `noveltyBlurb: ...`:

```js
    radarToggle: 'Rain radar on Today',
    radarBlurb: "A radar map of the last hour and the next hour's rain, five minutes at a time. SMHI's radar in Sweden, MET's in Norway.",
```

In `sv` `ui`, after its `noveltyBlurb: ...`:

```js
    radarToggle: 'Regnradar på Idag',
    radarBlurb: 'En radarkarta över den senaste timmen och nästa timmes regn, fem minuter i taget. SMHI:s radar i Sverige, MET:s i Norge.',
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `node web/run-tests.js`
Expected: `=== 444 passed, 0 failed ===`

- [ ] **Step 5: Stage**

```bash
git add web/core.js web/settings.html web/settings.js web/lang.js web/test.html
```

---

### Task 6: The card on Today

**Files:**
- Create: `web/radar-card.js`
- Modify: `web/index.html` (the card after `#now-card`; script tags before `app.js`)
- Modify: `web/style.css` (append a `/* ---------- rain radar ---------- */` section)
- Modify: `web/app.js` (`load()` near line 418; the `storage` listener near line 561)
- Modify: `android/app/build.gradle.kts:100-106` (`webAppFiles`)

**Interfaces:**
- Consumes:
  - from `radar.js`: everything produced in Tasks 1–4;
  - from `app.js` and `core.js`: `fetchOrNull(url)`, `$`, `T()` and `getSettings()`.
- Produces: `loadRadarCard(place)`, which `app.js` calls.

- [ ] **Step 1: Add the markup to `web/index.html`**, right after the closing `</section>` of `#now-card`:

```html

  <!-- ============ RAIN RADAR (opt-in) ============ -->
  <section class="card" id="radar-card" hidden>
    <h2 data-t="radarTitle">Rain, next hour</h2>
    <p class="rain-say" id="rain-say"></p>
    <div class="rain-line" id="rain-line"></div>
    <div class="rain-axis" id="rain-axis"></div>
    <p class="hint small" id="rain-model" data-t="radarModel" hidden></p>
    <div class="radar-map" id="radar-map" hidden>
      <canvas id="radar-canvas" width="320" height="320"></canvas>
      <img id="radar-img" alt="" hidden>
    </div>
    <div class="radar-controls" id="radar-controls" hidden>
      <button type="button" class="btn" id="radar-play" data-t-aria="radarPlay">&#9654;</button>
      <input type="range" id="radar-slider" min="0" max="12" value="12" aria-label="Radar time">
      <span class="radar-time" id="radar-time"></span>
    </div>
    <p class="hint small" id="radar-credit"></p>
    <p class="hint small" id="radar-down" data-t="radarDown" hidden></p>
  </section>
```

Change the script tags so the two new files load before `app.js`:

```html
<script src="core.js"></script>
<script src="radar.js"></script>
<script src="radar-card.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 2: Append the styles to `web/style.css`**

```css
/* ---------- rain radar ---------- */

.rain-say { font-size: 20px; margin: 4px 0 12px; }

.rain-line {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 60px;
  border-bottom: 3px solid var(--ink);
}

.rain-bar { flex: 1 1 0; min-width: 0; background: var(--ink); }
.rain-bar.lv1 { opacity: 0.4; }
.rain-bar.lv2 { opacity: 0.75; }
.rain-bar.lv3 { background: var(--rose); }

.rain-axis {
  display: flex;
  justify-content: space-between;
  font-size: 15px;
  margin-top: 2px;
}

.radar-map { margin-top: 14px; border: 3px solid var(--ink); line-height: 0; }
.radar-map canvas, .radar-map img { display: block; width: 100%; height: auto; }

.radar-controls { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.radar-controls input[type=range] { flex: 1; accent-color: var(--ink); }
.radar-time { font-size: 18px; min-width: 3.5em; text-align: right; }
```

`[hidden] { display: none !important; }` already exists at `style.css:15`, so `display: flex` here won't override `hidden`.

- [ ] **Step 3: Write `web/radar-card.js`**

```js
/* ==========================================================
   TOUCH GRASS — the rain radar card on Today
   Opt-in (Settings → Rain radar). The line and the map load side
   by side and either can fail alone. The sums are in radar.js.
   ========================================================== */

const RADAR_Z = 8, RADAR_SIZE = 320;   // about 100 km across in Sweden
const RADAR = { seq: 0, at: 0, place: null, drawn: [], i: 0, timer: null };

const radarWanted = () => getSettings().radar === true;

function radarClock(t) {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function loadImage(url, cors) {
  return new Promise((done) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
  });
}

async function loadRadarCard(place) {
  const card = $('radar-card');
  if (!card) return;
  stopRadar();
  if (!radarWanted() || !place) { card.hidden = true; return; }
  card.hidden = false;
  $('radar-down').hidden = true;
  // A newer place or refresh bumps seq; anything older that arrives late is dropped.
  const seq = ++RADAR.seq;
  RADAR.place = place;
  RADAR.at = Date.now();
  const now = Date.now();
  const [lineOk, mapOk] = await Promise.all([
    loadRainLine(place, now, seq), loadRadarMap(place, now, seq)]);
  if (seq === RADAR.seq) $('radar-down').hidden = lineOk || mapOk;
}

/* ---------- the line ---------- */

async function loadRainLine(place, now, seq) {
  let nc = parseNowcast(await fetchOrNull(NOWCAST_URL(place.lat, place.lon)), now);
  if (!nc && seq === RADAR.seq) nc = parseMinutely(await fetchOrNull(MINUTELY_URL(place.lat, place.lon)), now);
  if (seq !== RADAR.seq) return false;
  const ok = !!nc;
  for (const id of ['rain-say', 'rain-line', 'rain-axis']) $(id).hidden = !ok;
  $('rain-model').hidden = !ok || nc.source === 'met';
  if (!ok) return false;

  $('rain-say').textContent = rainSummary(nc, now);
  $('rain-line').replaceChildren(...nc.steps.map((x) => {
    const b = document.createElement('span');
    b.className = 'rain-bar lv' + rainLevel(x.mmh);
    b.style.height = rainBar(x.mmh) + '%';
    return b;
  }));
  const reach = nc.steps[nc.steps.length - 1].t - now >= 85 * 60000 ? 90 : 60;
  $('rain-axis').replaceChildren(...[T().ui.rainNow, '+30', '+60'].concat(reach === 90 ? ['+90'] : [])
    .map((s) => Object.assign(document.createElement('span'), { textContent: s })));
  return true;
}

/* ---------- the map ---------- */

async function loadRadarMap(place, now, seq) {
  const src = radarSource(place.lat, place.lon);
  let ok = false, area = src && src.kind === 'met' ? src.area : null;
  if (src && src.kind === 'smhi') {
    ok = await showSmhi(place, src, now, seq);
    // On SMHI's picture but outside its radars' reach: try MET's.
    if (!ok) area = metArea(place.lat, place.lon);
  }
  if (!ok && area && seq === RADAR.seq) ok = await showMet(area, now, seq);
  if (seq !== RADAR.seq) return false;
  $('radar-map').hidden = $('radar-controls').hidden = !ok;
  if (!ok) $('radar-credit').textContent = '';
  return ok;
}

// SMHI's picture with the logo gone, and its pixels to ask about coverage.
function cleanFrame(img) {
  const c = document.createElement('canvas');
  c.width = SMHI_W; c.height = SMHI_H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, SMHI_W, SMHI_H);
  cleanSmhi(id.data, SMHI_W);
  ctx.putImageData(id, 0, 0);
  return { canvas: c, data: id.data };
}

function drawYou(ctx) {
  ctx.beginPath();
  ctx.arc(RADAR_SIZE / 2, RADAR_SIZE / 2, 6, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgb(48, 62, 78)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

async function showSmhi(place, src, now, seq) {
  const frames = smhiFrames(await Promise.all(smhiDayUrls(now).map(fetchOrNull)), now);
  if (!frames.length || seq !== RADAR.seq) return false;
  const view = mapView(place.lat, place.lon, RADAR_Z, RADAR_SIZE);
  const [tiles, imgs] = await Promise.all([
    Promise.all(tilesFor(view).map(async (t) => ({ t, img: await loadImage(tileUrl(view.z, t.x, t.y), true) }))),
    Promise.all(frames.map((f) => loadImage(f.url, true)))]);
  if (seq !== RADAR.seq) return false;
  const kept = frames.map((f, i) => ({ t: f.t, img: imgs[i] })).filter((f) => f.img);
  if (!kept.length) return false;

  // Do SMHI's radars reach you? Ask the newest frame.
  const newest = cleanFrame(kept[kept.length - 1].img);
  if (!smhiCovered(newest.data, SMHI_W, src.x, src.y)) return false;

  const base = document.createElement('canvas');
  base.width = base.height = RADAR_SIZE;
  const bctx = base.getContext('2d');
  bctx.fillStyle = '#f2f0eb';
  bctx.fillRect(0, 0, RADAR_SIZE, RADAR_SIZE);
  for (const { t, img } of tiles) if (img) bctx.drawImage(img, t.dx, t.dy);

  const cells = smhiCells(view);
  RADAR.drawn = kept.map((f, i) => {
    const radar = i === kept.length - 1 ? newest.canvas : cleanFrame(f.img).canvas;
    const c = document.createElement('canvas');
    c.width = c.height = RADAR_SIZE;
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    ctx.imageSmoothingEnabled = false;   // 2 km squares, honestly drawn
    for (const q of cells) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(q.l, q.t, q.r - q.l, q.b - q.t);
      ctx.clip();
      ctx.setTransform(q.m[0], q.m[1], q.m[2], q.m[3], q.m[4], q.m[5]);
      ctx.drawImage(radar, 0, 0);
      ctx.restore();
    }
    drawYou(ctx);
    return { t: f.t, canvas: c };
  });
  $('radar-img').hidden = true;
  $('radar-canvas').hidden = false;
  $('radar-credit').textContent = T().ui.radarCreditSmhi;
  startSlider();
  return true;
}

// MET's pictures come with their own map, cities and legend: shown as they are.
async function showMet(area, now, seq) {
  const frames = metFrames(await fetchOrNull(metRadarUrl(area)), now);
  if (!frames.length || seq !== RADAR.seq) return false;
  const imgs = await Promise.all(frames.map((f) => loadImage(f.url, false)));
  if (seq !== RADAR.seq) return false;
  RADAR.drawn = frames.filter((f, i) => imgs[i]).map((f) => ({ t: f.t, src: f.url }));
  if (!RADAR.drawn.length) return false;
  $('radar-canvas').hidden = true;
  $('radar-img').hidden = false;
  $('radar-credit').textContent = T().ui.radarCreditMet;
  startSlider();
  return true;
}

/* ---------- the slider ---------- */

function startSlider() {
  const last = RADAR.drawn.length - 1;
  $('radar-slider').max = String(last);
  $('radar-slider').value = String(last);
  showFrame(last);
}

function showFrame(i) {
  const f = RADAR.drawn[i];
  if (!f) return;
  RADAR.i = i;
  if (f.canvas) $('radar-canvas').getContext('2d').drawImage(f.canvas, 0, 0);
  else $('radar-img').src = f.src;
  $('radar-time').textContent = radarClock(f.t);
}

function stopRadar() {
  clearInterval(RADAR.timer);
  RADAR.timer = null;
  if ($('radar-play')) $('radar-play').textContent = '▶';
}

if ($('radar-play')) {
  $('radar-play').addEventListener('click', () => {
    if (RADAR.timer) return stopRadar();
    $('radar-play').textContent = '❚❚';
    RADAR.timer = setInterval(() => {
      const n = RADAR.drawn.length;
      if (!n) return stopRadar();
      const i = (RADAR.i + 1) % n;
      $('radar-slider').value = String(i);
      showFrame(i);
    }, 400);
  });
  $('radar-slider').addEventListener('input', () => {
    stopRadar();
    showFrame(Number($('radar-slider').value));
  });
  // Back to the app after a while: the radar has moved on.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return stopRadar();
    if (RADAR.place && Date.now() - RADAR.at > 5 * 60000) loadRadarCard(RADAR.place);
  });
}
```

- [ ] **Step 4: Hook it into `web/app.js`**

In `load(place)`, directly after `$('place').textContent = place.label;`:

```js
  loadRadarCard(place);   // its own fetches; never waits for the forecast
```

In the `storage` listener, inside the `if (...)` block, after `renderToday(visitsToday());`:

```js
    // Turned on or off in Settings, or a new language: redo the card.
    if (e.key === 'touchgrass.lang' || radarWanted() === $('radar-card').hidden) loadRadarCard(STATE.place);
```

- [ ] **Step 5: Ship the new files in the APK.** In `android/app/build.gradle.kts`, change the `webAppFiles` list to:

```kotlin
val webAppFiles = listOf(
    "index.html", "settings.html", "style.css",
    // scoring.js is not just a page asset: the background worker evaluates
    // it directly, so it must be in the APK.
    "scoring.js", "blend.js", "lang.js", "core.js", "app.js", "settings.js",
    "radar.js", "radar-card.js",
    "calendar.html", "record.js"
)
```

- [ ] **Step 6: Run the logic suite**

Run: `node web/run-tests.js`
Expected: `=== 444 passed, 0 failed ===`, unchanged. `test.html` doesn't load `radar-card.js`.

- [ ] **Step 7: Check it in a browser**

Run: `cd web && python -m http.server 8000`, then:

1. Open `http://127.0.0.1:8000/settings.html` and turn on **Rain radar on Today**.
2. Open `http://127.0.0.1:8000/?lat=59.3293&lon=18.0686&place=Stockholm`.
3. Check that the card shows a sentence, bars and the axis `now +30 +60 +90`.
4. Check the map shows Stockholm's surroundings with the dot in the middle and the SMHI credit.
5. Check the slider moves through 13 frames and ▶ loops them.
6. Check radar shapes line up with the coast. Compare with smhi.se's radar if it's raining anywhere.
7. Check `?lat=60.3913&lon=5.3221&place=Bergen` shows MET's western Norway picture with no dot and the MET credit.
8. Check `?lat=51.5072&lon=-0.1276&place=London` shows only the line, with the "forecast model" note.
9. Check the DevTools console shows no errors on any of the three.

Expected: all of the above. Any console error means the step fails.

- [ ] **Step 8: Manual checks for the Review Focus items**

1. **Changing place.** Pin Stockholm, then search for "Bergen" and pick it before the map appears. The card must end on Bergen's MET picture.
2. **Offline.** In DevTools, set Network to Offline and reload with the radar on. If a cached forecast exists, the page still renders and the card says "The radar can't be reached right now."
3. **The setting.** With Today open in one tab, turn the setting off in a Settings tab. Today's card disappears without a reload. Turn it back on and the card comes back.

- [ ] **Step 9: Build the APK and check the new files are inside**

Run:
```bash
cd android && export ANDROID_HOME=/c/Users/Leo/AppData/Local/Android/Sdk && ./gradlew assembleRelease && unzip -l app/build/outputs/apk/release/app-release.apk | grep -E "assets/radar(-card)?\.js"
```
Expected: two lines, `assets/radar.js` and `assets/radar-card.js`.

Install it on the emulator with `adb -s emulator-5554 install -r app/build/outputs/apk/release/app-release.apk`, then:

1. Turn the setting on.
2. Check the card in Stockholm the same way as in Step 7.
3. Check that leaving the app for more than 5 minutes and coming back reloads the radar.

- [ ] **Step 10: Stage**

```bash
git add web/radar-card.js web/index.html web/style.css web/app.js android/app/build.gradle.kts
```

---

### Task 7: README

**Files:**
- Modify: `README.md` (the "What's in it" list and Credits)

**Interfaces:** none.

- [ ] **Step 1: Add the feature bullet.** After the `- **The aurora.** …` bullet:

```markdown
- **Rain radar**, if you want it: the next hour's rain minute by minute, and
  the last hour of radar around you, from SMHI in Sweden and MET in Norway.
```

- [ ] **Step 2: Extend Credits.** Replace the Credits paragraph with:

```markdown
Forecasts are blended from [MET Norway](https://www.met.no/) (NLOD / CC BY 4.0),
[SMHI](https://www.smhi.se/) (CC BY 4.0) and [Open-Meteo](https://open-meteo.com/)
(CC BY 4.0). Radar comes from SMHI and MET Norway, and its map from
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors and
[CARTO](https://carto.com/attributions). Aurora data comes from
[NOAA SWPC](https://www.swpc.noaa.gov/).
The look is a homage to [optical.toys](https://optical.toys/).
```

- [ ] **Step 3: Stage**

```bash
git add README.md
```
