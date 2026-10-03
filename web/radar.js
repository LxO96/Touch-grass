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

// The tiles at zoom tz that cover the view; a coarser tz means fewer,
// bigger tiles, each `size` view pixels a side.
function tilesFor(v, tz = v.z) {
  const size = RADAR_TILE * 2 ** (v.z - tz), out = [];
  for (let ty = Math.floor(v.y0 / size); ty * size < v.y0 + v.size; ty++) {
    for (let tx = Math.floor(v.x0 / size); tx * size < v.x0 + v.size; tx++) {
      out.push({ z: tz, x: tx, y: ty, size, dx: tx * size - v.x0, dy: ty * size - v.y0 });
    }
  }
  return out;
}

/* OpenFreeMap: OpenStreetMap as vector tiles, free and without a key.
   Only their water is drawn, so no roads or names cover Stockholm's
   sounds. The address names the tiles' current build. */
const VECTOR_TILES = 'https://tiles.openfreemap.org/planet';
const vectorTileUrl = (template, z, x, y) =>
  template.replace('{z}', z).replace('{x}', x).replace('{y}', y);

/* The water polygons of a Mapbox vector tile (protobuf): layer 3 of the
   tile, name 1, features 2, extent 5; a feature's type 3 (3 = polygon)
   and geometry 4, packed commands with zigzag deltas. Each ring is a
   list of [x, y] in tile units, 0..extent. */
function mvtWater(buf) {
  let p = 0;
  const varint = () => {
    let n = 0, shift = 0, b;
    do { b = buf[p++]; n += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return n;
  };
  // Each field of a message ending at `end`: [number, value] for a varint,
  // [number, start, end] for anything length-delimited.
  const fields = (end) => {
    const out = [];
    while (p < end) {
      const key = varint(), f = Math.floor(key / 8), type = key & 7;
      if (type === 0) out.push([f, varint()]);
      else if (type === 2) { const n = varint(); out.push([f, p, p + n]); p += n; }
      else p += type === 1 ? 8 : 4;
    }
    return out;
  };
  const read = (start, end) => { p = start; return fields(end); };
  const out = [];
  for (const [f, s, e] of read(0, buf.length)) {
    if (f !== 3) continue;
    const layer = read(s, e), name = layer.find((x) => x[0] === 1);
    if (!name || new TextDecoder().decode(buf.subarray(name[1], name[2])) !== 'water') continue;
    const ext = layer.find((x) => x[0] === 5), extent = ext ? ext[1] : 4096;
    for (const [g, fs, fe] of layer) {
      if (g !== 2) continue;
      const feat = read(fs, fe), type = feat.find((x) => x[0] === 3), geom = feat.find((x) => x[0] === 4);
      if (!type || type[1] !== 3 || !geom) continue;
      p = geom[1];
      const rings = [];
      let x = 0, y = 0, ring = null;
      while (p < geom[2]) {
        const cmd = varint(), id = cmd & 7, count = cmd >> 3;
        if (id === 7) { if (ring) rings.push(ring); ring = null; continue; }
        for (let k = 0; k < count; k++) {
          const dx = varint(), dy = varint();
          x += dx % 2 ? -(dx + 1) / 2 : dx / 2;
          y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
          if (id === 1) ring = [];
          ring.push([x, y]);
        }
      }
      if (rings.length) out.push({ extent, rings });
    }
  }
  return out;
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

/* ---------- our colours on SMHI's rain, and a plainer map ---------- */

/* SMHI paints strength as a rainbow: grey, blue, green, yellow to orange,
   red to purple. Read back by hue, that is a strength from 0 (grey, weak
   echoes that are mostly noise) to 4 (red and purple, a downpour). */
function smhiLevel(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < 0.25) return 0;
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 180 && h < 260) return 1;
  if (h >= 75 && h < 180) return 2;
  if (h >= 20 && h < 75) return 3;
  return 4;
}

// Pale green, the app's grass, its sun, and a deeper gold for a downpour.
const RAIN_RGB = [null, [207, 230, 189], [127, 176, 105], [234, 198, 69], [201, 150, 30]];

// In place: every rain pixel takes our colour; grey echoes go.
function recolourSmhi(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) continue;
    const c = RAIN_RGB[smhiLevel(data[i], data[i + 1], data[i + 2])];
    if (c) { data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; }
    else data[i + 3] = 0;
  }
}

/* OpenStreetMap's tiles carry every road, wood and name. Under the radar
   only the coast and the lakes help, so a tile is repainted in two tones:
   anything near OSM's water colour is water, the rest is land. */
const MAP_LAND = [246, 243, 234], MAP_WATER = [211, 220, 227];

/* The water drawn over land, soft edges and all, settled into the two
   colours, then smoothed and stripped of small lakes and islands. */
function plainMap(data, w = data.length / 4, q = {}) {
  const mid = (MAP_LAND[0] + MAP_WATER[0]) / 2, water = [];
  for (let i = 0; i < data.length; i += 4) water.push(data[i] < mid);
  const h = water.length / w;
  if (q.smooth) smoothMask(water, w, h, q.smooth, q.share);
  if (q.min) dropSmall(water, w, h, q.min);
  for (let p = 0, i = 0; p < water.length; p++, i += 4) {
    const c = water[p] ? MAP_WATER : MAP_LAND;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
  }
}

/* Each pixel becomes water if more than `share` of the square around it
   (r pixels each way, clipped at the edges) is: coasts round off and
   specks vanish. Below a half it leans to water, so a narrow sound stays
   open. Counted from a summed table, so the radius costs nothing. */
function smoothMask(water, w, h, r, share = 0.5) {
  const W = w + 1, sum = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0, row = 0; x < w; x++) {
      row += water[y * w + x] ? 1 : 0;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  for (let y = 0; y < h; y++) {
    const t = Math.max(0, y - r), b = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - r), rr = Math.min(w, x + r + 1);
      const n = sum[b * W + rr] - sum[t * W + rr] - sum[b * W + l] + sum[t * W + l];
      const all = (b - t) * (rr - l);
      if (n !== share * all) water[y * w + x] = n > share * all;
    }
  }
}

/* Lakes and islands under `min` pixels are filled in or sunk: at a glance
   the map says where the coast and the big lakes are, nothing more. */
function dropSmall(water, w, h, min) {
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h), part = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (seen[p0]) continue;
    const kind = water[p0];
    let top = 0;
    part.length = 0;
    stack[top++] = p0; seen[p0] = 1;
    while (top) {
      const p = stack[--top], x = p % w;
      part.push(p);
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || water[q] !== kind) continue;
        seen[q] = 1; stack[top++] = q;
      }
    }
    if (part.length < min) for (const p of part) water[p] = !kind;
  }
}

/* ---------- zooming out ---------- */

// About 100, 200 and 400 km across on a 640 px map.
const RADAR_ZOOMS = [9, 8, 7];

// Each step out doubles a cell's ground size, so double the cells a side
// to keep every fit within a third of a pixel.
const cellsFor = (z) => 4 * 2 ** (9 - z);

/* How plain the map is at each of RADAR_ZOOMS: tiles dz zooms coarser
   (OpenFreeMap leaves out ever more small water the coarser it goes, and
   downloads less), smoothed leaning to water, and lakes and islands
   under `min` map pixels dropped. */
const RADAR_PLAIN = RADAR_ZOOMS.map(() => ({ dz: 2, smooth: 1, share: 0.4, min: 300 }));
