/* ==========================================================
   TOUCH GRASS — what "good weather" means

   This file is the single definition of the score. The web pages
   load it directly, and the Android background worker evaluates
   this exact file through Rhino, so there is no second copy to
   drift out of step.

   Because Rhino has to read it, keep this file plain ES5: var and
   function only, no arrow functions, no template literals, no
   `??`, no DOM, no localStorage. Everything it needs is passed in.
   ========================================================== */

/* Genuinely don't-go-out-there territory. Not user-tunable:
   a slider should change your comfort, never your safety. */
var TOO_HOT = 38;
var TOO_COLD = -15;

var TG_LIGHTNING = [95, 96, 99];
var TG_ICE = [56, 57, 66, 67];
var TG_HEAVY = [65, 75, 82, 86];
var TG_FOG = [45, 48];

/* ----------------------------------------------------------
   Kinds of weather, and how much each is liked.

   Clear blue sky and a grey lid used to score the same. Now each kind
   carries a rating from 0 (love it) to 4 (hate it), worth the points in
   TG_SKY_POINTS. This is about how the sky feels; getting wet is still
   scored separately, by rain chance and amount under the rain dial, so
   the rain rating is modest on top of it.

   Thunder is deliberately absent: it is safety, a fixed -45 that no
   rating softens.
   ---------------------------------------------------------- */
var TG_SKY_ORDER = ['clear', 'mostlyClear', 'partly', 'overcast', 'fog',
                    'drizzle', 'rain', 'snow', 'freezing'];

var TG_SKY_KINDS = {
  clear: [0], mostlyClear: [1], partly: [2], overcast: [3],
  fog: [45, 48],
  drizzle: [51, 53, 55],
  rain: [61, 63, 65, 80, 81, 82],
  snow: [71, 73, 75, 77, 85, 86],
  freezing: [56, 57, 66, 67]
};

// Love it, Like it, Fine, Not keen, Hate it.
var TG_SKY_POINTS = [0, 5, 10, 20, 35];

var TG_SKY_DEFAULTS = {
  clear: 0, mostlyClear: 0, partly: 1, overcast: 2, fog: 2,
  drizzle: 2, rain: 3, snow: 1, freezing: 4
};

function tgSkyKind(code) {
  for (var i = 0; i < TG_SKY_ORDER.length; i++) {
    if (tgHas(TG_SKY_KINDS[TG_SKY_ORDER[i]], code)) return TG_SKY_ORDER[i];
  }
  return null;
}

/* The rating the user gave this kind, or the default if they gave none
   or something unusable. */
function tgSkyRating(sky, kind) {
  var v = sky && sky[kind];
  if (typeof v === 'number' && v >= 0 && v <= 4 && Math.floor(v) === v) return v;
  return TG_SKY_DEFAULTS[kind];
}

function tgClamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/* 11pm–5am. Dark is one thing; the small hours are another. */
function tgIsDeepNight(hour) {
  return hour >= 23 || hour < 5;
}

function tgHas(list, v) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] === v) return true;
  }
  return false;
}

function tgNum(v, fallback) {
  return (typeof v === 'number' && isFinite(v)) ? v : fallback;
}

/* ----------------------------------------------------------
   The score. 0 = do not open the door. 100 = why are you
   reading this.

   h     — one hour: hour, feels, pop, precip, wind, isDay, code
   dials — rain, cold, heat, wind, dark (multipliers, 1 = default)
   ---------------------------------------------------------- */
function tgExplainHour(h, dials) {
  var out = 100;
  var parts = [];

  var rain = tgNum(dials.rain, 1);
  var cold = tgNum(dials.cold, 1);
  var heat = tgNum(dials.heat, 1);
  var wind = tgNum(dials.wind, 1);
  var dark = tgNum(dials.dark, 1);

  /* Each penalty is taken off the running total exactly as it always
     was, and noted on the way past. Rows are rounded against the
     running total rather than one by one, so the column the page
     prints adds up to the number at the bottom of it. */
  var shown = 100;
  function take(key, amount, fixed) {
    out -= amount;
    var next = Math.round(out);
    var step = next - shown;
    shown = next;
    if (step !== 0) parts.push({ key: key, amount: step, fixed: !!fixed });
  }

  // --- wet stuff: usually the single biggest deterrent
  take('rain',
    Math.min(55, tgNum(h.pop, 0) * 0.55) * rain +
    Math.min(30, tgNum(h.precip, 0) * 25) * rain, false);

  // --- comfort curve on apparent temp (the "feels like").
  //     Heat bites harder than cold: you can add a coat, you
  //     can't take off your skin.
  var t = tgNum(h.feels, 16);
  if (t < 16) {
    take('cold', Math.min(60, (16 - t) * 2.8) * cold, false);
  } else if (t > 26) {
    take('heat', Math.min(75, (t - 26) * 4.5) * heat, false);
  }

  // --- wind, forgiving until it starts pushing you around
  var w = tgNum(h.wind, 0);
  if (w > 22) take('wind', Math.min(28, (w - 22) * 1.3) * wind, false);

  // --- dark is a big deal, and 3am is a bigger one
  // Twilight is not the dead of night. The dusk-and-dawn dial runs from
  // 0 (it is just more darkness) through 1 (no dark penalty — the default)
  // to 2 (the best light of the day, worth a bonus on top).
  if (!h.isDay && (h.twilight === 'dusk' || h.twilight === 'dawn')) {
    var tw = tgClamp(tgNum(dials.twilight, 1), 0, 2);
    take('dark', 38 * dark * Math.max(0, 1 - tw), false);
    if (tw > 1) take(h.twilight, -10 * (tw - 1), false);
  } else if (!h.isDay) {
    take('dark', 38 * dark, false);
  }
  if (tgIsDeepNight(h.hour)) take('night', 25 * dark, false);

  // --- the kind of weather: thunder is safety and never discounted;
  //     everything else is however much you like that sky.
  var c = h.code;
  if (tgHas(TG_LIGHTNING, c)) {
    take('code', 45, true);
  } else {
    var kind = tgSkyKind(c);
    if (kind) take('sky', TG_SKY_POINTS[tgSkyRating(dials.sky, kind)], false);
  }

  return {
    start: 100,
    parts: parts,
    total: Math.round(tgClamp(out, 0, 100)),
    floored: out < 0
  };
}

/* The score is the explanation, added up. One formula, so the number
   on the bar and the sum in the panel can never disagree. */
function tgScoreHour(h, dials) {
  return tgExplainHour(h, dials).total;
}

/* Weather that can hurt you, whatever the dials say. */
function tgIsRisky(h) {
  var t = tgNum(h.feels, 16);
  return t >= TOO_HOT || t <= TOO_COLD || tgHas(TG_LIGHTNING, h.code);
}

/* ----------------------------------------------------------
   Primitive-argument doorway, for callers that would rather not
   marshal objects across a language boundary (i.e. Rhino).
   Same formula — it goes through tgScoreHour like everyone else.
   ---------------------------------------------------------- */
function tgScoreArgs(hour, feels, pop, precip, wind, isDay, code,
                     dRain, dCold, dHeat, dWind, dDark, twilight, dTwilight) {
  return tgScoreHour(
    { hour: hour, feels: feels, pop: pop, precip: precip,
      wind: wind, isDay: !!isDay, code: code,
      twilight: twilight ? String(twilight) : null },
    { rain: dRain, cold: dCold, heat: dHeat, wind: dWind, dark: dDark,
      twilight: dTwilight }
  );
}

/* JSON doorway for the score, now that the dials carry the sky ratings
   as an object rather than a flat list of numbers. */
function tgScoreJson(hourJson, dialsJson) {
  return tgScoreHour(JSON.parse(hourJson), JSON.parse(dialsJson));
}

function tgIsRiskyArgs(feels, code) {
  return tgIsRisky({ feels: feels, code: code });
}

/* ==========================================================
   THE DECISION

   Which of the outcomes applies, and the facts behind it — but
   no words. Wording is the caller's business, so the page can
   render full prose in your language and the widget can render
   four words from the same verdict.

   House rule, enforced here: if you have not been out today,
   the state is never 'stayin'. There is always something to do
   and a time attached to it.
   ========================================================== */

function tgDecide(now, ahead, visits, dials) {
  var bar = tgNum(dials.bar, 60);
  var beenOut = visits > 0;
  var nowScore = tgScoreHour(now, dials);

  var scored = [];
  var i;
  for (i = 0; i < ahead.length; i++) {
    var h = ahead[i];
    scored.push({
      hour: h.hour,
      label: h.label,
      hoursFromNow: h.hoursFromNow,
      isDay: !!h.isDay,
      feels: h.feels,
      code: h.code,
      score: tgScoreHour(h, dials),
      risky: tgIsRisky(h)
    });
  }

  // The first hour that clears the bar AND genuinely beats now.
  function windowIn(list) {
    var j;
    for (j = 0; j < list.length; j++) {
      if (list[j].score >= bar && list[j].score >= nowScore + 12) return list[j];
    }
    return null;
  }

  // The least-bad hour, for when nothing clears the bar at all.
  function bestIn(list) {
    var j, b = null;
    for (j = 0; j < list.length; j++) {
      if (b === null || list[j].score > b.score) b = list[j];
    }
    return b;
  }

  function dawnIn(list) {
    var j;
    for (j = 0; j < list.length; j++) {
      if (list[j].isDay) return list[j];
    }
    return null;
  }

  /* An evening forecast reaches into tomorrow morning, and "go at seven"
     is no answer to "have you been outside today". So while the day is
     still owed, only today's remaining hours can be named. Once you have
     been out, the day is settled and tomorrow is fair game again.

     The local hour is what wraps at midnight, and ahead never spans more
     than twelve hours, so it can only wrap once: any hour numbered above
     the current one is still today. */
  var candidates = scored;
  if (!beenOut) {
    candidates = [];
    for (i = 0; i < scored.length; i++) {
      if (scored[i].hour > now.hour) candidates.push(scored[i]);
    }
  }

  var window = windowIn(candidates);
  var best = bestIn(candidates);
  var dawn = dawnIn(candidates);

  var out = {
    score: nowScore,
    bar: bar,
    beenOut: beenOut,
    visits: visits,
    nowFeels: tgNum(now.feels, 0),
    nowCode: now.code,
    target: null,
    risk: null,
    hours: scored
  };

  /* --- weather that can actually hurt you ----------------------- */
  var t = tgNum(now.feels, 16);
  if (tgIsRisky(now)) {
    out.risk = t >= TOO_HOT ? 'hot' : (t <= TOO_COLD ? 'cold' : 'storm');
    // Danger reads the full window, today or not: telling someone to
    // pick the least-bad hour of a thunderstorm is the one thing this
    // rule must never do.
    var riskBest = bestIn(scored);
    var safer = windowIn(scored) ||
                (riskBest && riskBest.score > nowScore ? riskBest : null);
    if (safer) {
      out.state = 'waitRisky';
      out.target = safer;
    } else {
      out.state = 'waitRiskyNoGap';
    }
    return out;
  }

  /* --- it's good out right now ---------------------------------- */
  if (nowScore >= bar) {
    out.state = beenOut ? 'goAgain' : 'go';
    return out;
  }

  /* --- already been out: now it's genuinely optional ------------- */
  if (beenOut) {
    if (window) {
      out.state = 'waitAgain';
      out.target = window;
    } else {
      out.state = 'stayin';
    }
    return out;
  }

  /* --- not been out yet: there is always a time ------------------ */
  if (window) {
    out.state = 'wait';
    out.target = window;
    return out;
  }

  if (!now.isDay && dawn) {
    out.state = 'waitDark';
    out.target = dawn;
    return out;
  }

  /* Small hours with no dawn in sight. Three shapes, and they get
     different answers:

       - hours still left of today: name the least-bad one;
       - a forecast that only reaches into tomorrow (23:00, the day spent):
         nothing today is left to name, so the answer is now — hence the
         fall-through past this branch to 'anyways';
       - no forecast at all: nothing to point at either way, and 'waitNight'
         with a null target is what lang.js has purpose-written copy for
         ("get some sleep, then go out at the first reasonable hour").

     So: a candidate, or an empty `ahead`. */
  if (tgIsDeepNight(now.hour) && (best !== null || !scored.length)) {
    out.state = 'waitNight';
    out.target = best;
    return out;
  }

  if (best && best.score > nowScore + 8) {
    out.state = 'anywaysBest';
    out.target = best;
    return out;
  }

  out.state = 'anyways';
  return out;
}

/* JSON doorway, so Rhino callers can hand over arrays without
   marshalling object graphs field by field. */
function tgDecideJson(nowJson, aheadJson, visits, dialsJson) {
  return JSON.stringify(tgDecide(
    JSON.parse(nowJson), JSON.parse(aheadJson), visits, JSON.parse(dialsJson)
  ));
}

/* ==========================================================
   TRENDS

   Where the numbers are heading for the rest of the local day.
   Directions and moods only — no words, same as tgDecide — so
   the page can write a sentence and the widget can draw an
   arrow from the identical reading.
   ========================================================== */

function tgMean(xs) {
  var total = 0;
  for (var i = 0; i < xs.length; i++) total += xs[i];
  return xs.length ? total / xs.length : 0;
}

/* How far outside the comfortable band a temperature sits. Used so a
   falling temperature reads as "better" in a heatwave and "worse" in
   the cold, rather than always meaning the same thing. */
function tgDiscomfort(t) {
  if (t < 16) return 16 - t;
  if (t > 26) return t - 26;
  return 0;
}

function tgTrends(now, ahead, dials) {
  if (!ahead || !ahead.length) return null;

  // The rest of the local day, unless there's too little of it left
  // to mean anything.
  var untilMidnight = 24 - now.hour;
  var hours = [];
  var i;
  for (i = 0; i < ahead.length; i++) {
    if (ahead[i].hoursFromNow <= untilMidnight) hours.push(ahead[i]);
  }
  var kind = 'restOfToday';
  if (hours.length < 3) {
    hours = ahead.slice(0, 6);
    kind = 'nextFewHours';
  }
  if (!hours.length) return null;

  var nowScore = tgScoreHour(now, dials);
  var scores = [], feels = [], pops = [], winds = [], discomforts = [];
  for (i = 0; i < hours.length; i++) {
    scores.push(tgScoreHour(hours[i], dials));
    feels.push(tgNum(hours[i].feels, 16));
    pops.push(tgNum(hours[i].pop, 0));
    winds.push(tgNum(hours[i].wind, 0));
    discomforts.push(tgDiscomfort(tgNum(hours[i].feels, 16)));
  }

  // The outlook leans on the best hour still to come, not the average:
  // one good window is what actually matters for getting out.
  var bestAhead = Math.max.apply(null, scores);
  var outlook = tgDir(bestAhead - nowScore, 8, true);

  var t = tgDir(tgMean(feels) - tgNum(now.feels, 16), 2, true);
  var tempMood = tgDir(
    tgDiscomfort(tgNum(now.feels, 16)) - tgMean(discomforts), 1.5, true
  ).mood;

  var rain = tgDir(tgMean(pops) - tgNum(now.pop, 0), 12, false);
  var wind = tgDir(tgMean(winds) - tgNum(now.wind, 0), 6, false);

  return {
    kind: kind,
    outlook: { dir: outlook.dir, mood: outlook.mood, best: bestAhead, now: nowScore },
    temp: { dir: t.dir, mood: tempMood },
    rain: { dir: rain.dir, mood: rain.mood },
    wind: { dir: wind.dir, mood: wind.mood }
  };
}

function tgDir(delta, tol, higherIsBetter) {
  if (!isFinite(delta) || Math.abs(delta) < tol) {
    return { dir: 'flat', mood: 'same' };
  }
  var up = delta > 0;
  return {
    dir: up ? 'up' : 'down',
    mood: (up === higherIsBetter) ? 'better' : 'worse'
  };
}

function tgTrendsJson(nowJson, aheadJson, dialsJson) {
  var out = tgTrends(JSON.parse(nowJson), JSON.parse(aheadJson), JSON.parse(dialsJson));
  return JSON.stringify(out);
}
