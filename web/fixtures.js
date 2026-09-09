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
   utc_offset_seconds is what lines them up with the other two. */
var FIXTURE_OM = {
  "utc_offset_seconds": 7200,
  "current": { "time": "2026-09-08T23:00", "temperature_2m": 16.4,
    "apparent_temperature": 16.0, "precipitation": 0.2, "weather_code": 61,
    "wind_speed_10m": 9.0, "is_day": 0 },
  "hourly": {
    "time": ["2026-09-08T23:00", "2026-09-09T00:00", "2026-09-09T01:00"],
    "temperature_2m": [16.4, 15.8, 15.4],
    "apparent_temperature": [16.0, 15.4, 15.0],
    "precipitation_probability": [80, 90, 85],
    "precipitation": [0.2, 0.5, 0.4],
    "weather_code": [61, 63, 61],
    "wind_speed_10m": [9.0, 9.4, 9.0],
    "is_day": [0, 0, 0]
  },
  "daily": { "sunset": ["2026-09-08T19:41"] }
};
