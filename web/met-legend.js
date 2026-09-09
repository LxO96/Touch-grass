/* ==========================================================
   MET Norway's published weather-symbol vocabulary.

   Copied from the "legend" column of weather/legend.csv in
   metno/weathericons, with the _day / _night / _polartwilight
   variants collapsed to the stems tgMetCode actually looks up.

   This exists so a test can check TG_MET_WMO against what MET really
   sends, rather than against itself. A missing key does not fail
   loudly — tgMetCode quietly returns its overcast default, and MET
   carries half the weight, so an unmapped thunderstorm has the
   heaviest voter reporting a grey lid and the storm is voted away.

   "lightssleetshowersandthunder" and "lightssnowshowersandthunder"
   really are spelled with a double s. It is a long-standing typo in
   MET's own IDs and it is what the API emits. Do not correct them.

   Loaded by test.html only.
   ========================================================== */

var MET_LEGEND_SYMBOLS = [
  'clearsky',
  'cloudy',
  'fair',
  'fog',
  'heavyrain',
  'heavyrainandthunder',
  'heavyrainshowers',
  'heavyrainshowersandthunder',
  'heavysleet',
  'heavysleetandthunder',
  'heavysleetshowers',
  'heavysleetshowersandthunder',
  'heavysnow',
  'heavysnowandthunder',
  'heavysnowshowers',
  'heavysnowshowersandthunder',
  'lightrain',
  'lightrainandthunder',
  'lightrainshowers',
  'lightrainshowersandthunder',
  'lightsleet',
  'lightsleetandthunder',
  'lightsleetshowers',
  'lightssleetshowersandthunder',
  'lightsnow',
  'lightsnowandthunder',
  'lightsnowshowers',
  'lightssnowshowersandthunder',
  'partlycloudy',
  'rain',
  'rainandthunder',
  'rainshowers',
  'rainshowersandthunder',
  'sleet',
  'sleetandthunder',
  'sleetshowers',
  'sleetshowersandthunder',
  'snow',
  'snowandthunder',
  'snowshowers',
  'snowshowersandthunder'
];
