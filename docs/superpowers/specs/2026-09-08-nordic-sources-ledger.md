# SDD ledger — plan: docs/superpowers/plans/2026-09-08-nordic-sources.md

Spec: docs/superpowers/specs/2026-09-08-nordic-sources-design.md (read, binding)
Branch: nordic-sources. Merge base: 6451915.
Plan: 12 tasks, 61 steps.

## Pre-flight conflict scan

### Pairs sharing a file or an interface

| Tasks | Produced vs consumed | Finding |
|---|---|---|
| T1 → T2 | `tgWeigh(present)` → used per hour in `tgBlend` | Clean |
| T2 → T3 | T2 defines a stub `tgVoteCode`, T3 replaces it | Clean — T2's own tests all use the default `code: 0`, so the stub's behaviour is never asserted. T2 says "Replaced properly in Task 3". |
| T2 → T8 | `tgBlend(bySource)` → consumed by `tgForecast` | Clean — shape `{time, sources, feels, temp, pop, precip, wind, code}` matches |
| T4 → T5 | `tgApparent(16.1, 87, 2.4)` → SMHI feels-like | Clean — both tasks assert 15.7 from the same worked example |
| T5 → T6, T7 | `fixtures.js` holds FIXTURE_SMHI + FIXTURE_MET + FIXTURE_OM | Clean — T5 creates all three up front; T6 and T7 only read |
| T5,T6,T7 → T8 | three normalisers → `tgForecast` | Clean — all three return the same hour shape |
| T7 → T8 | `daylight.byTime` / `localHourByTime` keyed by UTC | Clean — verified by hand: OM local 23:00 @ UTC+2 → `2026-09-08T21:00:00Z`, localHour 23; local 00:00 → `...22:00:00Z`, localHour 0 |
| T8 → T9 | `tgForecast` → `getWeather` | Clean on shape. See Ruling 1 — `now` changes meaning. |
| T8 → T11 | `tgForecastJson` → `Scoring.blend` | Clean — T11's Kotlin assertions (`hour == 23`, `sunsetMin == 1181`, 2 sources) trace to the same fixtures |
| T9 → T10 | `data.sources` → attribution card | Clean — T10 guards with `|| []`, which also covers a forecast cached before this change |
| T11 → T12 | `Scoring.blend(om, met, smhi)` → `Weather.fetch` | Clean |
| T12 → unchanged code | `Weather.fetch(lat, lon): Forecast?` | Verified: CheckWorker.kt:45,65 are the only callers and use exactly this signature. No edits needed there. |
| T5 ↔ T11 | `fixtures.js` objects vs `fixtures-*.json` files | Duplication. See Ruling 2. |

### Each task against itself

| Task | Finding |
|---|---|
| T1 | Clean |
| T2 | Clean — `tgVoteCode` is called before its declaration; ES5 function hoisting covers it |
| T3 | Clean — traced all five vote cases by hand against the tally/heaviest logic, including both ties |
| T4 | Clean |
| T5 | Clean — 2.4 × 3.6 = 8.64 survives the 2-dp rounding the test uses |
| T6 | Clean — 3.1 × 3.6 = 11.16 likewise |
| T7 | Clean |
| T8 | Clean — the "hour Open-Meteo does not cover" case works because MET's 20:00Z precedes OM's first hour |
| T9 | Clean — `AbortController`, `??` and `catch {}` are all fine; `web/app.js` already uses the latter two in 8 places, so the WebView baseline is modern |
| T10 | Clean |
| T11 | Clean — 5 existing + 2 new = the 7 it asserts |
| T12 | Clean |

### Rulings made before execution

Ruling 1: `now` changes meaning, and that is accepted. Today `now` comes from
Open-Meteo's `current` block — actual current conditions. After the blend it is
the current *hourly* row, because SMHI and MET publish no "current". Readings
will shift slightly (an hourly average rather than an observation). Accepted:
blending is impossible otherwise, and the spec's whole premise is that the
hourly grids are what get merged. Cost if wrong: the "Right now" card reads a
degree or two off the true current conditions; the fix would be to keep
Open-Meteo's `current` unblended for display only, which would then disagree
with the score.

Ruling 2: the fixture duplication between `web/fixtures.js` and
`web/fixtures-om.json` / `web/fixtures-met.json` / `web/fixtures-smhi.json`
stands. A browser page cannot
read local JSON without a server (the project ships as static files opened
directly), and the Kotlin test cannot parse a JS file. Each copy must carry a
comment naming the other so drift is visible. Cost if wrong: two copies of a
fixture drift apart and the Kotlin and browser suites silently stop testing the
same thing — mitigated by T11 asserting values that would break loudly.

## Progress

Ruling 3: batching. The plan's 12 tasks are dispatched as 5 units, not 12.
A: T1-4 (pure maths, one new file, complete code given — same shape).
B: T5-7 (three normalisers, same file, same shape).
C: T8 alone (the integration seam every later task consumes).
D: T9-10 (web wiring + attribution, both small, both need the emulator).
E: T11-12 (Kotlin, both need Weather.kt/Scoring.kt context in one head).
Each unit keeps its own review gate. Cost if wrong: a failed review covers a
wider surface, so a fix round is bigger than it would have been at 1:1.

Ruling 4: `web/run-tests.js` committed as project tooling before Task 1
(commit 2fbc49a). The suite lived only in a browser page, so no subagent
could verify its own work. It loads whatever test.html's script tags name, so
it needs no maintenance as files are added. Cost if wrong: a second test
harness to keep working — mitigated by it running the same file test.html
does, so they cannot disagree about what the tests say.

Setup: base for batch A = 4db3e40. Suite green at 136 before dispatch.

Ruling 5: plan defect found before batch E, corrected here. Task 11 says to
evaluate blend.js "in the existing script-loading path", but that path is
`Scoring.Source`, a `fun interface` with a single `read(): String` supplying
scoring.js alone (Scoring.kt:44,62). Two callers exist: CheckWorker.kt:31
(from assets) and ScoringEngineTest.kt:27 (from the file). Decision: keep one
Source and have it return **both files concatenated, scoring.js first** —
blend.js depends on tgNum from scoring.js, and Rhino evaluates a concatenated
string exactly as it would two, so one `evaluateString` still works and the
seam stays a single "the shared JS" concept rather than growing a list.
Both callers change by one line each. Cost if wrong: a stack trace from
inside blend.js reports a line number offset by scoring.js's length, which
would make a Rhino syntax error harder to locate; the alternative (a second
Source and a second evaluateString) costs an interface change in three files
and buys only that.

Batch A (T1-4): implemented, commits 4db3e40..225b7e6 (33f324e, 623cb9e,
9fa53b2, 225b7e6). Suite 136 -> 157, 0 failed. blend.js 131 lines, ES5 check
clean (no =>, backticks, let/const, ??). Review dispatched.

Batch A review: spec OK, quality Approved, 0 Critical/Important, 2 minor.
Batch A: minor (deferred): tgVoteCode skips a non-numeric `code` with no test
  covering that branch (blend.js:166-171).
Batch A: minor (deferred): run-tests.js is modern JS — correct, it is node
  tooling outside the Rhino constraint. No action.

Batch A: controller finding the review missed (Important). Replaced
tgVoteCode with the Task 2 stub ("return the first source's code") in a
scratch copy of web/ and ran the suite: 157 passed, 0 failed. All five vote
tests pass against a function that ignores weights entirely, because every
fixture lists the winning code's source first. The weighted vote — and the
no-lightning-override decision it is supposed to pin — is therefore
unproven. The implementer's own report flagged the symptom ("did not
actually fail... by chance"); the reviewer read that as candour and did not
chase it. Fix round 1 dispatched: reorder/extend the vote fixtures so a
losing code comes first, and prove it by running against the stub and
watching it FAIL before restoring.

Batch A: fix round 1/5 (commit 9f02960). Controller verified independently
before dispatching the re-review: stubbed tgVoteCode in a scratch copy of
web/ and the suite now FAILS 3 tests by name — "a code carried by more
weight beats one carried by less", "a tied vote is broken by the heaviest
single source", "an outvoted thunderstorm does not survive the vote" —
155 passed, 3 failed. Real implementation: 158 passed, 0 failed. The vote is
now genuinely covered. Scoped re-review dispatched.

Batch A (T1-4): complete (commits 4db3e40..9f02960, review clean after 1 fix
round). Suite 158 passed, 0 failed.

Batch B (T5-7) base = 9f02960.

Batch B (T5-7): implemented, commits 9f02960..4a73166 (4184ea0, 23c83ec,
4a73166). Suite 158 -> 190, 0 failed. Controller mutation battery run before
review — all five plausible wrong implementations are caught: drop the
m/s->km/h factor (2 fail), SMHI feels = air temp (1), keep MET's _day suffix
(1), tgLocalToUtc ignoring the offset (3), tgLocalToUtc with the sign
flipped (3). The discriminating-tests requirement carried from batch A held.
Review dispatched.

Batch B review: spec OK, quality Approved, 0 Critical/Important, 2 minor.
Reviewer independently re-derived both symbol tables entry-by-entry against
lang.js's sky map and re-computed the arithmetic; no mismatches.
Batch B: minor (deferred): tgNormaliseOm reads H.is_day[i] raw rather than
  through tgNum, so a partially-malformed Open-Meteo payload (time present,
  is_day absent) throws instead of degrading (blend.js:165). app.js's load()
  catches and falls to the cached forecast, so not fatal. Inconsistent with
  the other two normalisers, which guard field by field.
Batch B: minor (deferred): sunset.length >= 16 sanity check untested
  (blend.js:170).
Batch B (T5-7): complete (commits 9f02960..4a73166, review clean, no fix
rounds). Suite 190 passed, 0 failed.

Batch C (T8) base = 4a73166.

Batch C (T8): implemented, commit f48bcb5. Suite 190 -> 199, 0 failed.
Controller mutation battery found 2 Important gaps BEFORE review (3 of 5
mutations were caught; 2 survived):
  - isDay taken from the code vote instead of the Open-Meteo spine passes
    199/199. Every FIXTURE_OM hour is night and no code is 0, so correct and
    mutant both return false everywhere. The spec's load-bearing property —
    daylight comes from the spine — was untested.
  - hoursFromNow numbered from the wrong end passes 199/199. Nothing asserts
    the sequence, and tgDecide uses it for "N hours off" in the verdict.
Fix round 1 dispatched (tests only; blend.js to stay identical to f48bcb5).

Batch C: fix round 1/5 (commit 6aa82aa, tests only; blend.js verified
byte-identical to f48bcb5). Controller re-ran both mutations: each now fails
by name — "daylight is read from the Open-Meteo spine, not derived from the
vote" and "hoursFromNow counts up from now, not down". Suite 201 passed.
Full task review dispatched over 4a73166..6aa82aa.

Batch C review: spec OK, quality Approved, 0 Critical/Important, 3 minor.
Batch C: minor (deferred): output hours carry `time` and `contributors`
  beyond the required shape (blend.js:308-311). `time` is used by a test;
  `contributors` has no consumer — trim candidate for the final review.
Batch C: minor (deferred): the doorway's shape test asserts typeof for only
  5 of 9 fields (test.html:121-127).
Batch C: minor (deferred): no test for a source hour AFTER Open-Meteo's last
  hour; only the "MET hour precedes OM's first" case is covered.
Batch C (T8): complete (commits 4a73166..6aa82aa, review clean after 1 fix
round). Suite 201 passed, 0 failed.

Batch D (T9-10) base = 6aa82aa.

Batch D (T9-10): implemented, commits 6aa82aa..d636635 (f08050d, d636635).
DONE_WITH_CONCERNS — implementer found a plan defect on device.

Ruling 6: the plan never mentioned android/app/build.gradle.kts's explicit
`webAppFiles` copy list, so blend.js would not have reached the APK and the
first on-device build failed with "tgForecast is not defined". Implementer
added "blend.js" to the list; accepted. Verified myself: blend.js is now in
mergeDebugAssets, and fixtures.js / test.html / run-tests.js are correctly
NOT in the list, so test-only files still do not ship. This also settles the
same requirement for Task 11, which needs blend.js in assets for Rhino.
Cost if wrong: none identified — the alternative was a broken build.

Controller verified on device independently: Lisbon renders a real blended
verdict (22C, feels 24, 6 km/h, 3% chance, 35/100) and the card reads
"Blended from Open-Meteo 33%, MET Norway (YR) 67%" — SMHI absent outside its
coverage, weights renormalised. Console clean (0 lines). Suite 201.
Review dispatched.

Batch D review: spec OK, quality Approved, 0 Critical/Important, 1 minor,
1 warn-item.
Batch D: warn-item RESOLVED by controller, not a gap. Reviewer observed that
Open-Meteo failing alone makes getWeather throw, reading as inconsistent
with "one source failing must not cost the other two". That is the spec's
documented decision, corrected into the spec before execution began: OM is
load-bearing, not merely weighted, because it is the only source of
utc_offset_seconds (the local hour) and is_day. A forecast with no OM is no
forecast, and the page falls through to its cached-forecast path. No action.
Batch D: minor (deferred): index.html's static srclist still lists only
  Open-Meteo under "Weather and forecast" while the new blended line below
  names all contributors — reads as two overlapping attribution statements.
  Copy polish; candidate for the final review's fix wave.
Batch D: minor (deferred): README.md still says "no second data provider in
  the loop" and credits Open-Meteo alone. Now false. Plan's executor notes
  already flag this for the final commit.
Batch D (T9-10): complete (commits 6aa82aa..d636635, review clean, no fix
rounds). Suite 201.

Batch E (T11-12) base = d636635.

Batch E (T11-12): implemented, commits d636635..3bb50f1 (0a03e08, 3bb50f1).
DONE_WITH_CONCERNS. Suites: 201 web, 7 Kotlin (was 5), tree clean.
Controller verified independently:
  - The architectural rule holds. grep for SMHI/MET payload field names in
    android/ finds only Open-Meteo names inside the request URL query
    string (Weather.kt:60-63) — naming what to ask for, not parsing a
    response. No timeSeries, symbol_code or next_1_hours anywhere in Kotlin.
  - Ruling 5 implemented as ruled: CheckWorker.kt:31-34 concatenates
    scoring.js then blend.js into one Source.
  - No leftover instrumentation in main sources.

Ruling 7: the widget-vs-page pixel comparison is accepted as unproven, and
that is judged acceptable. The implementer could not place a home-screen
widget by synthetic touch and said so plainly rather than claiming it. The
invariant itself — same inputs produce the same forecast in both runtimes —
IS tested: ScoringEngineTest now evaluates blend.js through Rhino against
the same fixtures the browser suite uses. Widget *rendering* is downstream
of that and untouched by this branch. Cost if wrong: a rendering-layer bug
in Widget.kt could still make the widget disagree, and no test would catch
it; the cheap manual check is to add the widget to a home screen once by
hand and compare it with the Today page.

Ruling 8: two out-of-brief deviations in batch E accepted — workingDir set
on the Test task (the brief's relative fixture path resolved wrong without
it) and a real org.json:json test dependency (Android's bundled org.json is
a stub that throws in JVM tests, and this is the first JVM test to call it
directly). Both are build-plumbing corrections the plan should have
specified. Cost if wrong: a JVM-only dependency that could mask a real
device-side org.json difference — low, since the same JSON is parsed by
Rhino, not org.json, on device.

Batch E (T11-12): complete (commits d636635..3bb50f1, review clean).

FINAL WHOLE-BRANCH REVIEW: NOT MERGEABLE. 2 Critical, 4 Important, 8 Minor.
Both Criticals are defects in the PLAN — it specified the wrong code and the
implementers wrote it faithfully. Both reproduced independently by the
controller before acting:

  C1 (verified 2026-09-09 08:45 against the live API): tgForecast takes
  rows[0] as "now", but Open-Meteo's hourly array starts at 00:00 local.
  The deleted code found the current hour via findIndex on current.time;
  nothing replaced it. Result: now.hour = 0 at 08:45, score 0, verdict
  "wait until 07:00" — an hour two hours past. Chart always reads 01-12.
  Widget takes the same now, so both agree on the wrong hour. Every test
  missed it because the fixtures set hourly.time[0] == current.time, a
  shape real Open-Meteo produces only at midnight.

  C2 (verified under V8; reviewer verified under Rhino 1.7.15): tgVoteCode
  iterates `for k in tally` over integer-like keys. V8 enumerates ascending
  numeric (0,3,95); Rhino uses insertion order (95,3,0). On an exact tie
  no comparison fires and the first key wins — a different one per runtime.
  Reachable whenever MET is absent: tgWeigh(['smhi','om']) = 0.5/0.5.
  {smhi:95, om:0} gives 0 (clear) in V8 and 95 (thunderstorm) in Rhino, so
  page and widget give opposite verdicts from identical data through the
  same shared file. The exact divergence the architecture exists to prevent.
  The Rhino test that should have caught it asserts only sources.length,
  isDay presence, hour and sunsetMin — it would pass against a blend that
  disagreed on every reading and every code.

Also Important: two MET symbols (lightssleetshowersandthunder,
lightssnowshowersandthunder — MET's own double-s typo, which the API really
emits) are unmapped and default to overcast, so thundersnow has its 0.50
voter reporting calm and the no-override decision then votes the storm away;
is_day read raw throws out of Weather.fetch and doWork into Result.failure
instead of retry; a failed refresh discards a usable cache; the licence-bound
attribution card still credits Open-Meteo alone on first paint.

ONE fix wave dispatched (opus) with all nine findings.

Final fix wave: the opus agent hit a session rate limit mid-task and died
before committing. Work survived in the working tree (nothing committed).
Controller assessed the state rather than re-dispatching blind:
  - C1 verified FIXED against the live API at 19:00 Stockholm: now.hour = 19,
    chart 20,21,22,23,0,1,... (was 0 and 1..12 at any time of day).
  - C2 verified FIXED: {smhi:95,om:0} and {om:0,smhi:95} both give 95, so the
    vote is order-independent; ties break toward the rougher sky.
  - Important 3 verified FIXED: both double-s MET symbols map to 95.
  - Web suite 201 -> 230 passed.
  - Kotlin 14 tests, 2 failing — the new cross-runtime test.

Ruling 9: the two failing Kotlin tests are a test defect, not a data
divergence, and the fix is to the test. Extracted both sides of the
comparison: expected (node) and actual (Rhino) are both exactly 1812 chars,
and once object keys are sorted recursively they parse to IDENTICAL values —
every reading, every code, every field. The test compares serialised JSON
strings, and V8 and Rhino emit object keys in different orders. That is the
same property-enumeration difference that caused Critical 2, which makes it
a good reason for the test to be order-insensitive rather than a reason to
doubt the result. Cost if wrong: if the canonicalisation is written too
loosely it could mask a genuine cross-runtime disagreement — mitigated by
requiring the finisher to perturb the committed expectation and watch the
test fail before restoring it.

Finisher dispatched (sonnet): make the comparison order-insensitive without
weakening it, commit in logical pieces, verify on device.

Fix wave: complete (commits 3bb50f1..f046751 — f64daf2, ee56ed1, 8ea6648,
368d2d8, f046751). Scoped re-review: all 9 findings ADDRESSED, no new
Critical/Important, mergeable YES. Re-reviewer independently confirmed
fixture parity between fixtures.js and fixtures-om.json, that the dependent
expectations were strengthened not weakened (hours.length 3->10, plus an
explicit anchor-moves-with-current.time test), and that the cross-runtime
canonicalisation sorts object keys only, leaves array order intact, swallows
nothing, and asserts on the full document.

PLAN COMPLETE. 12/12 tasks. Web 230 passed, Android 14 passed, tree clean.
