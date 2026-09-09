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
