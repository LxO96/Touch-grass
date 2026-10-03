/* ==========================================================
   TOUCH GRASS — the rain radar card on Today
   Opt-in (Settings → Rain radar). The line and the map load side
   by side and either can fail alone. The sums are in radar.js.
   ========================================================== */

// Twice the pixels a phone card needs, so the map stays sharp on a
// high-density screen. RADAR.z steps through RADAR_ZOOMS (radar.js).
const RADAR_SIZE = 640;
const RADAR = { seq: 0, at: 0, place: null, drawn: [], i: 0, timer: null,
                z: RADAR_ZOOMS[0], smhi: null, zseq: 0, tiles: null };

const radarWanted = () => getSettings().radar === true;

function radarClock(t) {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* Images have no timeout of their own, and on a weak signal a stalled
   tile would hold the whole card blank for minutes; ten seconds, as
   fetchOrNull allows, then it counts as failed. */
function loadImage(url, cors) {
  return new Promise((done) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; done(null); }, 10000);
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => { clearTimeout(timer); done(img); };
    img.onerror = () => { clearTimeout(timer); done(null); };
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
  RADAR.smhi = null;      // the old place's frames are no use to a zoom now
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

// SMHI's picture with the logo gone and the rain in our colours, and its
// pixels to ask about coverage (recolourSmhi leaves the veil alone).
function cleanFrame(img) {
  const c = document.createElement('canvas');
  c.width = SMHI_W; c.height = SMHI_H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, SMHI_W, SMHI_H);
  cleanSmhi(id.data, SMHI_W);
  recolourSmhi(id.data);
  ctx.putImageData(id, 0, 0);
  return { canvas: c, data: id.data };
}

function drawYou(ctx) {
  ctx.beginPath();
  ctx.arc(RADAR_SIZE / 2, RADAR_SIZE / 2, 10, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgb(48, 62, 78)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

async function showSmhi(place, src, now, seq) {
  const frames = smhiFrames(await Promise.all(smhiDayUrls(now).map(fetchOrNull)), now);
  if (!frames.length || seq !== RADAR.seq) return false;
  const imgs = await Promise.all(frames.map((f) => loadImage(f.url, true)));
  if (seq !== RADAR.seq) return false;
  const kept = frames.map((f, i) => ({ t: f.t, img: imgs[i] })).filter((f) => f.img);
  if (!kept.length) return false;

  // Do SMHI's radars reach you? Ask the newest frame.
  const newest = cleanFrame(kept[kept.length - 1].img);
  if (!smhiCovered(newest.data, SMHI_W, src.x, src.y)) return false;

  // Cleaned once; every zoom draws from these.
  RADAR.smhi = { place, frames: kept.map((f, i) => ({
    t: f.t, canvas: i === kept.length - 1 ? newest.canvas : cleanFrame(f.img).canvas })) };
  if (!(await drawSmhi()) || seq !== RADAR.seq) return false;
  $('radar-img').hidden = true;
  $('radar-canvas').hidden = false;
  $('radar-credit').textContent = T().ui.radarCreditSmhi;
  startSlider();
  return true;
}

// A vector tile's bytes, or null; ten seconds, as fetchOrNull allows.
async function fetchTile(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The two-tone map for one zoom: OpenFreeMap's water on plain land.
// Without the tiles it is all land, and the radar still shows.
async function plainBase(view) {
  const q = RADAR_PLAIN[RADAR_ZOOMS.indexOf(view.z)];
  if (!RADAR.tiles) {
    const tj = await fetchOrNull(VECTOR_TILES);
    RADAR.tiles = tj && Array.isArray(tj.tiles) ? tj.tiles[0] : null;
  }
  const tiles = !RADAR.tiles ? [] : await Promise.all(tilesFor(view, view.z - q.dz).map(async (t) =>
    ({ t, buf: await fetchTile(vectorTileUrl(RADAR.tiles, t.z, t.x, t.y)) })));
  const base = document.createElement('canvas');
  base.width = base.height = RADAR_SIZE;
  const ctx = base.getContext('2d');
  ctx.fillStyle = 'rgb(' + MAP_LAND.join(',') + ')';
  ctx.fillRect(0, 0, RADAR_SIZE, RADAR_SIZE);
  ctx.fillStyle = 'rgb(' + MAP_WATER.join(',') + ')';
  for (const { t, buf } of tiles) {
    if (!buf) continue;
    for (const { extent, rings } of mvtWater(buf)) {
      const k = t.size / extent;
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](t.dx + x * k, t.dy + y * k));
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }
  const id = ctx.getImageData(0, 0, RADAR_SIZE, RADAR_SIZE);
  plainMap(id.data, RADAR_SIZE, q);
  ctx.putImageData(id, 0, 0);
  return base;
}

/* Lays the cleaned frames over the map at RADAR.z. A newer zoom or place
   started meanwhile wins (zseq), so a slow render never lands late. */
async function drawSmhi() {
  const sm = RADAR.smhi;
  if (!sm) return false;
  const zseq = ++RADAR.zseq;
  const view = mapView(sm.place.lat, sm.place.lon, RADAR.z, RADAR_SIZE);
  const base = await plainBase(view);
  if (zseq !== RADAR.zseq || sm !== RADAR.smhi) return false;
  const cells = smhiCells(view, cellsFor(RADAR.z));
  RADAR.drawn = sm.frames.map((f) => {
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
      ctx.drawImage(f.canvas, 0, 0);
      ctx.restore();
    }
    drawYou(ctx);
    return { t: f.t, canvas: c };
  });
  paintZoom();
  return true;
}

function paintZoom() {
  const i = RADAR_ZOOMS.indexOf(RADAR.z);
  $('radar-out').hidden = $('radar-in').hidden = !RADAR.smhi;
  $('radar-out').disabled = i >= RADAR_ZOOMS.length - 1;
  $('radar-in').disabled = i <= 0;
}

async function zoomRadar(step) {
  const i = RADAR_ZOOMS.indexOf(RADAR.z) + step;
  if (!RADAR.smhi || i < 0 || i >= RADAR_ZOOMS.length) return;
  RADAR.z = RADAR_ZOOMS[i];
  paintZoom();
  if (await drawSmhi()) showFrame(Math.min(RADAR.i, RADAR.drawn.length - 1));
}

// MET's pictures come with their own map, cities and legend: shown as they are.
async function showMet(area, now, seq) {
  const frames = metFrames(await fetchOrNull(metRadarUrl(area)), now);
  if (!frames.length || seq !== RADAR.seq) return false;
  const imgs = await Promise.all(frames.map((f) => loadImage(f.url, false)));
  if (seq !== RADAR.seq) return false;
  RADAR.drawn = frames.filter((f, i) => imgs[i]).map((f) => ({ t: f.t, src: f.url }));
  if (!RADAR.drawn.length) return false;
  RADAR.smhi = null;   // MET's pictures can't be zoomed
  paintZoom();
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
  $('radar-out').addEventListener('click', () => zoomRadar(1));
  $('radar-in').addEventListener('click', () => zoomRadar(-1));
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
