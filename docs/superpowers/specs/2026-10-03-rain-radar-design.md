# Rain radar on Today — design

## Intent

The user said:
- They want an optional section on Today with a weather radar and a rain forecast for the next 30–60 minutes.
- It should show both a map and a line.
- It should be opt-in.
- It should use SMHI's and Yr's radars first, then grow to the rest of the world later.
- They're mostly in Stockholm.

I've assumed:
- The question it answers is "will I get wet if I go now, and if so, when?" That's the same job as the rest of Today.
- Success means one of two things. Either a glance at the line answers that question, or the map shows a shower coming towards the dot.

Out of scope:
- The widget and notifications.
- Radar outside Sweden and Norway.
- Forecast radar frames (no source offers them for free).

## What the user sees

The new card sits right after "Now". It only shows when **Settings → Rain radar** is on, and the setting is off by default.

```
 RAIN, NEXT HOUR
 Rain starts in about 20 min, light, for about 15 min.
 ▁▁▁▁▃▅▅▃▁▁▁▁▁▁▁▁▁   now · +30 · +60 · +90
 ┌──────────────────────────┐
 │  map around you, ~100 km │
 │         radar  ●         │
 └──────────────────────────┘
 ▶  ─────────────●  11:30      SMHI · © OpenStreetMap, CARTO
```

- **The summary line** is one sentence.
- **The rain line** has a bar for each 5-minute step over the next 90 minutes, or for each 15-minute step when the data comes from the fallback. The bars use the same style as "The next 12 hours". Bar height shows rain intensity on a fixed scale, so drizzle never looks like a downpour.
- **The map** depends on where you are:
  - **In Sweden:** SMHI radar drawn over a light map at zoom 8, 320 map pixels or about 100 km across, with a dot for you.
  - **In Norway:** Yr's ready-made picture for your region, shown as it comes. There's no dot, because MET doesn't publish where its pictures sit on the map.
  - **Anywhere else:** no map.
- **The slider** covers the last 60 minutes in 5-minute steps, 13 frames in all. It opens on the newest frame, and ▶ loops through them.

## Data

| Part | Source | Note |
|---|---|---|
| Rain line | MET Nowcast 2.0, `/nowcast/2.0/complete` | 5 min steps, about 90 min. Used when `meta.radar_coverage == "ok"` |
| Rain line, fallback | Open-Meteo `minutely_15=precipitation` | mm per 15 min ×4 gives mm/h. Next 60 min. Model-based, not radar |
| Radar, Sweden | SMHI `.../area/sweden/product/comp/YYYY/MM/DD` listing, then the `png` frames | CORS `*`. SWEREF99 TM (UTM 33N, GRS80), 2 km/px, origin E 126648.404, N 7771252.876, 471×887 |
| Radar, Norway | MET `/radar/2.0/available.json`, filtered to one area with `type=5level_reflectivity`, `content=image` | Shown in an `<img>`; no canvas work |
| Map | CARTO `light_all` tiles | Light style that suits the card. Attribution: © OpenStreetMap contributors, © CARTO |

I checked all of this today:
- Every source responded.
- SMHI and MET Nowcast both send `access-control-allow-origin: *`, on the JSON and on SMHI's PNGs.
- Neither SMHI nor RainViewer publishes forecast radar frames.

## Components

Pure logic goes in `web/core.js`, so `test.html` can cover it:

- `radarSource(lat, lon)` returns one of:
  - `{kind:'smhi'}` when the point falls inside the SMHI composite and its pixel isn't in the masked border;
  - `{kind:'met', area}` from a table of rough boxes for MET's Norwegian regions, falling back to the `nordic` picture inside Scandinavia and Finland;
  - `null`.
- `sweref99(lat, lon)` gives `{e, n}`, using the standard Transverse Mercator forward formulas (central meridian 15°, k0 0.9996, false easting 500 000).
- `smhiPixel(lat, lon)` gives `{x, y}` in the composite.
- `smhiFrames(listing, now)` returns the newest 13 PNG links with their times, up to now. Before 01:00 it combines today's listing with yesterday's.
- `parseNowcast(metJson)` and `parseMinutely(omJson)` each return `[{t, mmh}]` from now onwards.
- `rainSummary(steps, lang)` returns the sentence.
  - Any rate below 0.1 mm/h counts as dry.
  - Intensity is light below 1 mm/h, moderate from 1 to 4, and heavy above 4.
  - The five cases are: dry the whole time; raining now and it stops in N min; raining the whole time; starts in N min and lasts M min; starts in N min and is still going at the end. Minutes are rounded to 5.

The page side goes in `web/app.js` (or `web/radar.js` if it grows past roughly 150 lines):

- `loadRadarCard()` runs with the normal refresh, but only when the setting is on. The line and the map load at the same time, and either one can fail without taking the other down.
- `drawSmhiMap(canvas, frames, here)`:
  1. Loads the 9 tiles and the 13 frames, with `crossOrigin='anonymous'`.
  2. For each frame, takes the radar crop around you and makes SMHI's white and grey background pixels transparent with `getImageData`.
  3. Draws the radar over the tiles through a 4×4 grid of local affine fits, one per cell, each taken at the cell's centre with `sweref99` and Web Mercator. Across Malmö, Stockholm and Kiruna every fit is within 0.15 px of a full reprojection. One fit for the whole map would be 2 px out at the edges.
  4. Caches the drawn frames so moving the slider is instant.
- For Norway, the slider swaps the `src` of an `<img>` instead.

## Settings and text

- `DEFAULTS.radar = false` in `core.js`.
- A toggle in `settings.html` after the Firsts toggle: "Rain radar" with the hint "A map and the next hour's rain on Today." In Swedish: "Regnradar" and "Karta och nästa timmes regn på Idag."
- Every new string goes into `lang.js` in English and Swedish, including the summary sentences.
- Credits in the card and the README: SMHI (CC BY 4.0), MET Norway, © OpenStreetMap contributors, © CARTO.

## When things go wrong

- **The line fails:** it's hidden, and the map still shows.
- **The map fails, or you're outside its coverage:** the map is hidden, and the line still shows.
- **Both fail:** the card shows one line saying the radar can't be reached right now.
- **An SMHI frame fails to load:** that frame is dropped from the slider.
- **The setting is off:** nothing is fetched at all.

## Testing

`node web/run-tests.js` gets new checks in `test.html`:

- `sweref99` turns Stockholm (59.3293, 18.0686) into E 674 571.9, N 6 580 743.0, within 1 m. Two independent formulas, Krüger's and Snyder's, agree on this to 0.1 m.
- `smhiPixel` lands inside the image for Stockholm and outside it for Bergen.
- `radarSource` gives Stockholm → smhi, Bergen → met (western_norway), Helsinki's fallback → nordic, and London → null.
- `parseNowcast` and `parseMinutely` work on small inline fixtures, and steps that have already passed are dropped.
- `rainSummary` covers all five cases in both languages, and checks that tiny rates count as dry.
- `smhiFrames` picks 13 frames, takes PNG links only, and handles yesterday plus today just after midnight.

Manual check on the emulator and the phone:
- the toggle;
- the card in Stockholm;
- a place set to Bergen;
- a place set to London (line only);
- airplane mode (the message saying the radar can't be reached).
