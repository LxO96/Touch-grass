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

/* A fixed order to walk the sources in. Rhino enumerates object keys in
   insertion order and V8 enumerates integer-like keys numerically, so any
   loop whose outcome depends on key order gives the page and the widget
   different answers from identical data. Everything order-sensitive in
   this file iterates this array instead. */
var TG_SOURCE_ORDER = ['met', 'smhi', 'om'];

/* Array.prototype.indexOf exists in both engines, but a plain loop keeps
   this file's ES5 floor obvious. Missing sorts to the end. */
function tgIndexOf(list, want) {
  var i;
  for (i = 0; i < list.length; i++) {
    if (list[i] === want) return i;
  }
  return list.length;
}

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

var TG_MEAN_FIELDS = ['feels', 'temp', 'pop', 'precip', 'wind'];

/* bySource: { met: [hour...], smhi: [...], om: [...] }
   Each hour: { time, feels, temp, pop, precip, wind, code }
   Returns one array of blended hours, in time order. */
function tgBlend(bySource) {
  // In TG_SOURCE_ORDER, not enumeration order: the `sources` list on each
  // hour, and the `sources` list on the forecast, are derived from this,
  // and both engines have to name them the same way round.
  var order = tgOrderedSources(bySource);
  var keys = [];
  var k;
  for (var n = 0; n < order.length; n++) {
    k = order[n];
    if (bySource[k] && bySource[k].length) keys.push(k);
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
    var present = tgOrderedSources(at);
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

/* Codes cannot be averaged — the mean of fog and thunder is nothing.
   So they vote, weighted. A tie goes to the heaviest single source
   behind a code; a tie that survives even that goes to the higher WMO
   number, which is also the rougher sky.

   Every loop here walks TG_SOURCE_ORDER rather than `for…in`, and that
   is load-bearing rather than tidiness. V8 enumerates integer-like keys
   in ascending numeric order and Rhino enumerates them in insertion
   order, so a for…in over the tally lets the two engines pick different
   winners from the same data. That is reachable in ordinary running:
   with MET timed out the other two renormalise to 0.5/0.5, and
   {smhi:95, om:0} tied on weight and on heaviest source gave the page
   "clear sky" and the widget a thunderstorm. The page and the widget
   share this file precisely so they cannot disagree; enumeration order
   has to be ours, not the engine's.

   Deliberately no safety override: a thunderstorm carried by a
   minority of the weight loses, and tgIsRisky therefore never sees
   it. Decided in the design doc; this comment is the reminder, and
   the test above is the lock. */
function tgVoteCode(at, w) {
  var tally = {};
  var heaviest = {};
  var codes = [];        // in fixed source order, first appearance only
  var order = tgOrderedSources(at);
  var i, k, code, weight;

  for (i = 0; i < order.length; i++) {
    k = order[i];
    if (!at[k]) continue;
    code = at[k].code;
    if (typeof code !== 'number') continue;
    weight = tgNum(w[k], 0);
    if (tally[code] === undefined) {
      tally[code] = 0;
      heaviest[code] = 0;
      codes.push(code);
    }
    tally[code] += weight;
    if (weight > heaviest[code]) heaviest[code] = weight;
  }

  var best = null;
  for (i = 0; i < codes.length; i++) {
    code = codes[i];
    if (best === null ||
        tally[code] > tally[best] ||
        (tally[code] === tally[best] && heaviest[code] > heaviest[best]) ||
        (tally[code] === tally[best] && heaviest[code] === heaviest[best] &&
         code > best)) {
      best = code;
    }
  }
  // Nobody offered a number. "Clear sky" is the worst thing to invent out
  // of an unknown, so this says overcast, as the normalisers already do.
  return best === null ? 3 : best;
}

/* The sources of one hour, in TG_SOURCE_ORDER, with anything unexpected
   appended in sorted order so the walk stays total and still ordered. */
function tgOrderedSources(at) {
  var out = [];
  var extra = [];
  var k, i;
  for (i = 0; i < TG_SOURCE_ORDER.length; i++) {
    if (at.hasOwnProperty(TG_SOURCE_ORDER[i])) out.push(TG_SOURCE_ORDER[i]);
  }
  for (k in at) {
    if (at.hasOwnProperty(k) && tgIndexOf(TG_SOURCE_ORDER, k) === TG_SOURCE_ORDER.length) {
      extra.push(k);
    }
  }
  extra.sort();
  for (i = 0; i < extra.length; i++) out.push(extra[i]);
  return out;
}

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

/* "2026-09-08T23:00" local, plus the offset, as a UTC stamp matching
   what SMHI and MET publish. Built by hand rather than through a
   local Date so a visitor's own timezone can never leak into it.

   Null for anything that is not a stamp. A 200 carrying an HTML error
   page or a captive portal's login screen must degrade to "no forecast",
   never to a throw: on Android this runs inside a worker whose contract
   is null on failure, and a throw there costs the retry. */
function tgLocalToUtc(local, offsetSeconds) {
  if (typeof local !== 'string' || local.length < 16) return null;
  var y = parseInt(local.slice(0, 4), 10);
  var mo = parseInt(local.slice(5, 7), 10);
  var d = parseInt(local.slice(8, 10), 10);
  var h = parseInt(local.slice(11, 13), 10);
  var mi = parseInt(local.slice(14, 16), 10);
  if (isNaN(y) || isNaN(mo) || isNaN(d) || isNaN(h) || isNaN(mi)) return null;
  var t = new Date(Date.UTC(y, mo - 1, d, h, mi) - (tgNum(offsetSeconds, 0) * 1000));
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' +
         p(t.getUTCDate()) + 'T' + p(t.getUTCHours()) + ':' +
         p(t.getUTCMinutes()) + ':00Z';
}

/* One column of Open-Meteo's hourly block. Missing columns come back as
   an empty array rather than undefined, so a payload that is short a
   field yields a fallback value instead of a TypeError. */
function tgColumn(H, name) {
  var v = H[name];
  return v && typeof v.length === 'number' ? v : [];
}

function tgNormaliseOm(d) {
  var res = { hours: [],
              daylight: { byTime: {}, localHourByTime: {},
                          sunsetMin: null, nowUtc: null } };
  if (!d || !d.hourly || !d.hourly.time || !d.hourly.time.length) return res;

  var off = tgNum(d.utc_offset_seconds, 0);
  var H = d.hourly;
  var times = tgColumn(H, 'time');
  var temps = tgColumn(H, 'temperature_2m');
  var feels = tgColumn(H, 'apparent_temperature');
  var pops = tgColumn(H, 'precipitation_probability');
  var precips = tgColumn(H, 'precipitation');
  var winds = tgColumn(H, 'wind_speed_10m');
  var codes = tgColumn(H, 'weather_code');
  var isDays = tgColumn(H, 'is_day');
  var i;

  /* The hour the user is actually standing in. Open-Meteo's hourly block
     starts at local midnight, so its first row is "now" only at midnight;
     current.time is the only thing in the payload that says which hour is
     the present one. It carries real minutes ("...T08:45"), and the hourly
     rows are all on the local hour, so it is truncated to the hour it
     falls inside — 08:45 belongs to the 08:00 row, not the 09:00 one.
     Recorded here and honoured in tgForecast. */
  var cur = d.current && typeof d.current.time === 'string' &&
            d.current.time.length >= 13 ? d.current.time.slice(0, 13) + ':00' : null;
  res.daylight.nowUtc = cur === null ? null : tgLocalToUtc(cur, off);

  for (i = 0; i < times.length; i++) {
    var utc = tgLocalToUtc(times[i], off);
    if (utc === null) continue;
    res.hours.push({
      time: utc,
      temp: tgNum(temps[i], 16),
      feels: tgNum(feels[i], 16),
      pop: tgNum(pops[i], 0),
      precip: tgNum(precips[i], 0),
      wind: tgNum(winds[i], 0),
      code: tgNum(codes[i], 3)
    });
    res.daylight.byTime[utc] = tgNum(isDays[i], 0) === 1;
    res.daylight.localHourByTime[utc] = parseInt(times[i].slice(11, 13), 10);
  }

  var sunset = d.daily && d.daily.sunset && d.daily.sunset[0];
  if (sunset && sunset.length >= 16) {
    res.daylight.sunsetMin = parseInt(sunset.slice(11, 13), 10) * 60 +
                             parseInt(sunset.slice(14, 16), 10);
  }
  return res;
}

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

  /* Open-Meteo's hourly array runs from local midnight, so blended[0] is
     the first hour of the day, not the hour it is now. Anything before
     current.time is already over: at a quarter to nine it would make
     "now" midnight, score it as the small hours in the dark, and point
     the whole twelve-hour chart at hours that have been and gone. These
     stamps are all fixed-width UTC, so a string compare is an ordering
     compare, and it stays Rhino-safe. */
  var nowUtc = spine.daylight.nowUtc;

  var seen = {};
  var rows = [];
  var i, m;
  for (i = 0; i < blended.length; i++) {
    var b = blended[i];
    if (nowUtc && b.time < nowUtc) continue;
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

  var names = tgOrderedSources(seen);

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
