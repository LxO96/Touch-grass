# Nordic data sources: a weighted forecast blend

**Date:** 2026-09-08
**Status:** design, awaiting review

## Why

Touch Grass asks Open-Meteo what the weather is doing, everywhere. In the
Nordics there are two national services with open APIs and better local
models — MET Norway (YR) and SMHI. Using them should make the verdict
better where the user actually is, without making it worse anywhere else.

The chosen shape is not "pick a source" but **blend them**: YR at 0.50,
SMHI at 0.25, Open-Meteo at 0.25.

## What was verified, not assumed

Probed on 2026-09-08 with real requests:

| | CORS | Browser User-Agent | Coverage |
|---|---|---|---|
| MET Norway `locationforecast/2.0/complete` | `access-control-allow-origin: *` | HTTP 200 | global |
| SMHI `snow1g/version/1` point forecast | `access-control-allow-origin: *` | HTTP 200 | Nordic only |

Both are callable from the page and from the WebView. No proxy is needed
and none will be added.

Two findings that shaped the design:

1. **SMHI's PMP3g API was retired on 31 March 2026** and now 404s. Every
   tutorial still points at it. The live endpoint is SNOW1gv1, which —
   unlike PMP3g — publishes `probability_of_precipitation`. That matters:
   rain probability drives the single largest penalty in `tgScoreHour`.
2. **MET's `complete` product publishes `apparent_air_temperature`**, so
   the feels-like temperature the score is built on comes straight from
   the API. Only SMHI lacks it.

### What each source gives

```
Open-Meteo   feels ✓  temp ✓  pop ✓  precip ✓  wind (km/h)  WMO code ✓  is_day ✓  sunset ✓
MET complete feels ✓  temp ✓  pop ✓  precip ✓  wind (m/s)   symbol_code string    —      —
SMHI SNOW1g  feels ✗  temp ✓  pop ✓  precip ✓  wind (m/s)   symbol_code 1–27      —      —
```

## Architecture

Three layers, each independently testable.

### 1. Fetchers — one per source

Each takes `(lat, lon)` and returns raw JSON, or `null` on any failure
(offline, 404 outside coverage, timeout, malformed). A fetcher never
throws and never knows about the others.

### 2. Normalisers — one per source

Each turns raw JSON into the shape the rest of the app already speaks:

```js
{ time: "2026-09-08T21:00:00Z",   // UTC, the merge key
  feels, temp, pop, precip,       // numbers
  wind,                           // km/h, converted from m/s where needed
  code }                          // WMO, mapped from the source vocabulary
```

Normalising is pure — JSON in, array out — so it is testable against
saved fixtures with no network.

Two mappings have to be built and checked against the published
vocabularies — SMHI's parameter table at
<https://opendata.smhi.se/metfcst/snow1gv1/parameters> and MET's symbol
list at <https://github.com/metno/weathericons> — targeting the WMO codes
`lang.js` already describes
(0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99):

- **SMHI** `symbol_code` 1–27 → WMO
- **MET** `symbol_code` strings (`partlycloudy_night`, `lightrainshowers_day`, …) → WMO.
  The `_day`/`_night` suffix is dropped; daylight does not come from here.

Anything unmapped becomes the nearest documented WMO code, never a guess
that would read as a different sky.

### 3. The merge — shared, and shared the way scoring already is

`tgBlend(sources, weights)` in a new **`web/blend.js`**, written in the
same plain ES5 as `scoring.js` and evaluated by Rhino on the Android side
alongside it. This is the point of the whole design: the widget, the
notifications and the page must not disagree, and the project already
solves that by having exactly one definition that both runtimes execute.
A second implementation in Kotlin would be the thing this codebase most
consistently refuses to do.

**Algorithm**

1. Index every source's hours by UTC timestamp.
2. For each timestamp, take the sources that have it.
3. Renormalise the weights over just those sources, so they sum to 1.
   Outside the Nordics that is YR 0.667 / Open-Meteo 0.333; with only
   Open-Meteo it is 1.0 and the blend is a pass-through.
4. Numeric fields (`feels`, `temp`, `pop`, `precip`, `wind`) — weighted mean.
5. `code` — **weighted vote**: the WMO code carrying the most total weight
   wins; ties go to the higher-weighted source.
6. `is_day` and `sunset` are not blended — see below.

**Open-Meteo is the spine.** It is the only globally-covering source and
the only one publishing daylight and sunset outright. Keeping it in every
blend means no solar-position maths and no inferring daylight from a
symbol string. When the Nordic sources are absent the blend degrades to
exactly today's behaviour.

**Daylight when the spine is missing.** Darkness is the second-largest
penalty in the score (`-38 x dark`, plus `-25 x dark` in the small
hours), and an hour with no `is_day` at all would read as dark and score
every daytime hour as night. So daylight has a defined fallback chain,
and it is the one part of the merge that does not simply drop a missing
source:

**Open-Meteo is therefore load-bearing, not merely weighted.** An earlier
draft of this spec had daylight fall back to MET's `symbol_code` suffix
(`_day` / `_night`) when Open-Meteo was missing. Writing the
implementation plan showed that this does not work, and the reason is
worth recording so nobody tries it again:

- The suffix supplies `is_day`, but not the **local hour**. The score
  penalises the small hours separately (`-25 x dark` for 23:00–05:00),
  and every bar in the chart is labelled with an hour.
- The local hour requires the location's UTC offset. MET publishes
  timestamps in UTC and no offset; SMHI likewise. **Open-Meteo's
  `utc_offset_seconds` is the only source of it** — which is also what
  lines the three time grids up in the first place.

So an hour with no Open-Meteo row is dropped, and a forecast with no
Open-Meteo at all is no forecast: the page falls through to its existing
cached-forecast path, exactly as it does today when the one source it
has is unreachable. Open-Meteo being globally covering and highly
available is what makes this acceptable; if that ever stops being true,
the fix is a timezone lookup, not a cleverer daylight guess.

Daylight is the only field whose absence changes the score's *meaning*
rather than its precision, which is why it gets this treatment instead
of a weight.

### Decided: no safety override on the code vote

A weighted vote can discard a minority thunderstorm: if YR alone reports
lightning at 0.5 against two calm sources at 0.25 each, lightning wins;
if *SMHI* alone reports it at 0.25, it does not. Because `tgIsRisky()`
reads the blended code, the safety path will not fire on an outvoted
storm.

This was raised and chosen deliberately, for consistency — the alternative
was "any source reporting lightning makes it lightning". It is recorded
here so it reads as a decision rather than an oversight, and a test
asserts the behaviour so it cannot change by accident.

## Fetch and cache

The page fetches all covering sources in parallel and blends whatever
comes back within **10 seconds**; a slow source is simply absent from
that blend rather than delaying the verdict. One source answering is
enough to render.

The background worker blends too, so the widget cannot drift from the
page — but it caches aggressively. The merged result is cached with its
fetch time and **reused while under 45 minutes old**, against a worker
that runs roughly hourly: a check that lands early, or a widget redraw
prompted by something other than the schedule, costs nothing. Past 45
minutes it refetches. The existing 6-hour stale-forecast rule in
`app.js` establishes the pattern and the vocabulary for this; this is a
tighter window for a fresher purpose.

## Attribution

Non-negotiable and licence-bound. The "Where this comes from" card lists
the sources that actually contributed to the forecast on screen, with
their weights, and names MET Norway and SMHI under their required
attribution. When a source is absent — outside coverage, or down — it is
not listed, so the card never claims a number it did not produce. This is
also what makes the silent fallback honest.

## Settings

A source picker is **out of scope**. The blend is automatic and always
uses whatever covers the location. If a picker is wanted later it is
additive and does not disturb this design.

## Testing

Test-first, in the existing harnesses.

**`web/test.html`** (pure, no network):
- weights renormalise to 1 when a source is missing
- a single source blends to itself, unchanged
- a weighted mean is exactly that, on hand-checked numbers
- the code vote picks the heaviest code; ties resolve to the heavier source
- an outvoted thunderstorm loses (the decision above, pinned)
- hours present in only one source still appear, at weight 1
- each normaliser maps saved fixture JSON to the right readings and codes
- both symbol vocabularies map to codes `lang.js` can describe

**`ScoringEngineTest.kt`**: Rhino evaluates `blend.js` and produces
the same blend as the browser for the same fixtures — the invariant that
the widget and page agree, asserted rather than assumed.

**On the emulator**: the real app against the real APIs, checking the
verdict, the breakdown panel and the attribution card.

## Out of scope

- A manual source picker.
- Historical or observed data; this is forecast only.
- Any server component.
