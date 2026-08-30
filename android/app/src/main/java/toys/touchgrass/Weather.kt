package toys.touchgrass

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The same Open-Meteo call the page makes, from Kotlin, for the background
 * check. No extra dependency — one GET and some JSON.
 */
object Weather {

    data class Forecast(
        val now: Scoring.Hour,
        val ahead: List<Scoring.Hour>,
        /** Today's sunset as minutes since local midnight, or null. */
        val sunsetMinutes: Int?
    )

    fun fetch(lat: Double, lon: Double): Forecast? {
        val url = URL(
            "https://api.open-meteo.com/v1/forecast" +
                "?latitude=$lat&longitude=$lon" +
                "&current=temperature_2m,apparent_temperature,precipitation," +
                "weather_code,wind_speed_10m,is_day" +
                "&hourly=apparent_temperature,precipitation_probability,precipitation," +
                "weather_code,wind_speed_10m,is_day" +
                "&daily=sunset" +
                "&forecast_days=2&timezone=auto"
        )

        val body = try {
            (url.openConnection() as HttpURLConnection).run {
                connectTimeout = 15_000
                readTimeout = 15_000
                requestMethod = "GET"
                try {
                    if (responseCode != 200) return null
                    inputStream.bufferedReader().readText()
                } finally {
                    disconnect()
                }
            }
        } catch (_: Exception) {
            return null   // offline, DNS, timeout — the worker just tries again later
        }

        return try {
            parse(JSONObject(body))
        } catch (_: Exception) {
            null
        }
    }

    private fun parse(d: JSONObject): Forecast? {
        val cur = d.optJSONObject("current") ?: return null
        val h = d.optJSONObject("hourly") ?: return null

        val times = h.getJSONArray("time")
        val curTime = cur.getString("time")
        val stamp = curTime.substring(0, 13)          // yyyy-MM-ddTHH

        var i = 0
        for (k in 0 until times.length()) {
            if (times.getString(k).substring(0, 13) == stamp) { i = k; break }
        }

        // Hours come back in the location's own timezone, so read the hour
        // straight off the string rather than through a local calendar.
        val nowHour = curTime.substring(11, 13).toInt()

        val now = Scoring.Hour(
            hour = nowHour,
            feels = cur.getDouble("apparent_temperature"),
            pop = h.getJSONArray("precipitation_probability").optDouble(i, 0.0).orZero(),
            precip = cur.getDouble("precipitation"),
            wind = cur.getDouble("wind_speed_10m"),
            isDay = cur.getInt("is_day") == 1,
            code = cur.getInt("weather_code")
        )

        val ahead = ArrayList<Scoring.Hour>(12)
        var k = 1
        while (k <= 12 && i + k < times.length()) {
            val j = i + k
            val hr = times.getString(j).substring(11, 13).toInt()
            ahead += Scoring.Hour(
                hour = hr,
                feels = h.getJSONArray("apparent_temperature").getDouble(j),
                pop = h.getJSONArray("precipitation_probability").optDouble(j, 0.0).orZero(),
                precip = h.getJSONArray("precipitation").optDouble(j, 0.0).orZero(),
                wind = h.getJSONArray("wind_speed_10m").getDouble(j),
                isDay = h.getJSONArray("is_day").getInt(j) == 1,
                code = h.getJSONArray("weather_code").getInt(j),
                hoursFromNow = k,
                label = label(hr)
            )
            k++
        }

        // "2026-08-29T19:58" -> 19*60+58, in the location's own timezone.
        val sunset = try {
            d.optJSONObject("daily")?.optJSONArray("sunset")?.optString(0)
                ?.takeIf { it.length >= 16 }
                ?.let { it.substring(11, 13).toInt() * 60 + it.substring(14, 16).toInt() }
        } catch (_: Exception) {
            null
        }

        return Forecast(now, ahead, sunset)
    }

    private fun Double.orZero() = if (isNaN()) 0.0 else this

    fun label(hr: Int) = when {
        hr == 0 -> "midnight"
        hr < 12 -> "${hr}am"
        hr == 12 -> "noon"
        else -> "${hr - 12}pm"
    }
}
