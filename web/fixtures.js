/* Real responses, recorded 2026-09-08: SMHI and Open-Meteo for
   Stockholm (59.3293, 18.0686), MET for Oslo (59.91, 10.75).
   Loaded by test.html only. */

var FIXTURE_SMHI = {
  "referenceTime": "2026-09-08T20:00:00Z",
  "timeSeries": [
    { "time": "2026-09-08T21:00:00Z", "data": { "air_temperature": 16.1,
      "wind_speed": 2.4, "relative_humidity": 87,
      "probability_of_precipitation": 83, "precipitation_amount_mean": 0.3,
      "symbol_code": 18 } },
    { "time": "2026-09-08T22:00:00Z", "data": { "air_temperature": 15.6,
      "wind_speed": 2.7, "relative_humidity": 90,
      "probability_of_precipitation": 93, "precipitation_amount_mean": 0.4,
      "symbol_code": 18 } },
    { "time": "2026-09-08T23:00:00Z", "data": { "air_temperature": 14.9,
      "wind_speed": 2.6, "relative_humidity": 90,
      "probability_of_precipitation": 83, "precipitation_amount_mean": 0.4,
      "symbol_code": 18 } }
  ]
};

var FIXTURE_MET = {
  "properties": { "timeseries": [
    { "time": "2026-09-08T20:00:00Z",
      "data": { "instant": { "details": { "air_temperature": 15.8,
        "apparent_air_temperature": 15.8, "wind_speed": 3.1 } },
        "next_1_hours": { "summary": { "symbol_code": "partlycloudy_night" },
          "details": { "precipitation_amount": 0,
            "probability_of_precipitation": 0 } } } },
    { "time": "2026-09-08T21:00:00Z",
      "data": { "instant": { "details": { "air_temperature": 15.3,
        "apparent_air_temperature": 15.3, "wind_speed": 2.8 } },
        "next_1_hours": { "summary": { "symbol_code": "partlycloudy_night" },
          "details": { "precipitation_amount": 0,
            "probability_of_precipitation": 0 } } } },
    { "time": "2026-09-08T22:00:00Z",
      "data": { "instant": { "details": { "air_temperature": 14.7,
        "apparent_air_temperature": 14.3, "wind_speed": 2.6 } },
        "next_1_hours": { "summary": { "symbol_code": "partlycloudy_night" },
          "details": { "precipitation_amount": 0,
            "probability_of_precipitation": 0 } } } }
  ] }
};

/* Open-Meteo's times are local (Europe/Stockholm, UTC+2 in September);
   utc_offset_seconds is what lines them up with the other two.

   The hourly block deliberately begins four hours BEFORE current.time,
   which is the shape the real API sends at every hour except midnight:
   `hourly` runs from local 00:00 and `current` says where in it you are.
   The earlier fixture had the two equal, so a forecast anchored to the
   first row instead of to the current hour looked correct to every test.
   Byte-identical in content to fixtures-om.json. */
var FIXTURE_OM = {
  "utc_offset_seconds": 7200,
  "current": { "time": "2026-09-08T23:00", "temperature_2m": 16.4,
    "apparent_temperature": 16.0, "precipitation": 0.2, "weather_code": 61,
    "wind_speed_10m": 9.0, "is_day": 0 },
  "hourly": {
    "time": ["2026-09-08T19:00", "2026-09-08T20:00", "2026-09-08T21:00",
             "2026-09-08T22:00", "2026-09-08T23:00", "2026-09-09T00:00",
             "2026-09-09T01:00", "2026-09-09T02:00", "2026-09-09T03:00",
             "2026-09-09T04:00"],
    "temperature_2m": [18.9, 18.1, 17.5, 16.9, 16.4, 15.8, 15.4, 15.1, 14.8, 14.6],
    "apparent_temperature": [18.5, 17.7, 17.1, 16.5, 16.0, 15.4, 15.0, 14.7, 14.4, 14.2],
    "precipitation_probability": [35, 45, 60, 70, 80, 90, 85, 75, 60, 45],
    "precipitation": [0.0, 0.0, 0.1, 0.1, 0.2, 0.5, 0.4, 0.3, 0.1, 0.0],
    "weather_code": [2, 3, 3, 61, 61, 63, 61, 61, 3, 3],
    "wind_speed_10m": [7.2, 7.6, 8.1, 8.5, 9.0, 9.4, 9.0, 8.6, 8.2, 7.9],
    "is_day": [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  "daily": { "sunset": ["2026-09-08T19:41"] }
};
