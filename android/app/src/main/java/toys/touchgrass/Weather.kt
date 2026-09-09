package toys.touchgrass

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Three GETs — Open-Meteo, MET Norway, SMHI — handed to the web app's own
 * blend.js as raw response bodies. Kotlin never parses a forecast payload
 * or owns a symbol-mapping table; the blend has exactly one definition,
 * shared with the page, evaluated through Rhino in Scoring.blend.
 */
object Weather {

    data class Forecast(
        val now: Scoring.Hour,
        val ahead: List<Scoring.Hour>,
        /** Today's sunset as minutes since local midnight, or null. */
        val sunsetMinutes: Int?
    )

    /** MET Norway's terms require an identifying User-Agent. */
    private const val USER_AGENT = "TouchGrass/1.0 github.com/LxO96/Touch-grass"

    private const val CACHE_MS = 45 * 60 * 1000L   // the spec's reuse window

    private var cachedAt = 0L
    private var cachedKey = ""
    private var cached: Forecast? = null

    fun fetch(lat: Double, lon: Double): Forecast? {
        val key = "%.3f,%.3f".format(lat, lon)
        // Three services per background check is a lot. A check that lands
        // early, or a widget redraw off-schedule, reuses what we have.
        if (cached != null && cachedKey == key &&
            System.currentTimeMillis() - cachedAt < CACHE_MS
        ) return cached

        val om = body(openMeteoUrl(lat, lon))
        val met = body(metUrl(lat, lon), USER_AGENT)
        val smhi = body(smhiUrl(lat, lon))
        if (om == null && met == null && smhi == null) return null

        val blended = Scoring.blend(om, met, smhi) ?: return null
        val parsed = try {
            parseBlended(JSONObject(blended))
        } catch (_: Exception) {
            null
        } ?: return null

        cached = parsed
        cachedAt = System.currentTimeMillis()
        cachedKey = key
        return parsed
    }

    private fun openMeteoUrl(lat: Double, lon: Double) =
        "https://api.open-meteo.com/v1/forecast" +
            "?latitude=$lat&longitude=$lon" +
            "&current=temperature_2m,apparent_temperature,precipitation," +
            "weather_code,wind_speed_10m,is_day" +
            "&hourly=temperature_2m,apparent_temperature," +
            "precipitation_probability,precipitation,weather_code," +
            "wind_speed_10m,is_day" +
            "&daily=sunset&forecast_days=2&timezone=auto"

    private fun metUrl(lat: Double, lon: Double) =
        "https://api.met.no/weatherapi/locationforecast/2.0/complete" +
            "?lat=$lat&lon=$lon"

    private fun smhiUrl(lat: Double, lon: Double) =
        "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1" +
            "/geotype/point/lon/%.4f/lat/%.4f/data.json".format(lon, lat)

    private fun body(url: String, ua: String? = null): String? = try {
        (URL(url).openConnection() as HttpURLConnection).run {
            connectTimeout = 15_000
            readTimeout = 15_000
            requestMethod = "GET"
            if (ua != null) setRequestProperty("User-Agent", ua)
            try {
                if (responseCode != 200) null
                else inputStream.bufferedReader().readText()
            } finally {
                disconnect()
            }
        }
    } catch (_: Exception) {
        null    // offline, DNS, timeout, or a 404 outside SMHI's area
    }

    private fun parseBlended(d: JSONObject): Forecast? {
        fun hour(o: JSONObject, k: Int) = Scoring.Hour(
            hour = o.getInt("hour"),
            feels = o.getDouble("feels"),
            pop = o.optDouble("pop", 0.0),
            precip = o.optDouble("precip", 0.0),
            wind = o.getDouble("wind"),
            isDay = o.getBoolean("isDay"),
            code = o.getInt("code"),
            hoursFromNow = k,
            label = label(o.getInt("hour"))
        )

        val now = hour(d.optJSONObject("now") ?: return null, 0)
        val arr = d.optJSONArray("ahead") ?: return null
        val ahead = ArrayList<Scoring.Hour>(arr.length())
        for (i in 0 until arr.length()) ahead += hour(arr.getJSONObject(i), i + 1)

        val sunset = if (d.isNull("sunsetMin")) null else d.getInt("sunsetMin")
        return Forecast(now, ahead, sunset)
    }

    fun label(hr: Int) = when {
        hr == 0 -> "midnight"
        hr < 12 -> "${hr}am"
        hr == 12 -> "noon"
        else -> "${hr - 12}pm"
    }
}
