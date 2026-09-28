package toys.touchgrass

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

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
        val sunsetMinutes: Int?,
        /** When it was fetched. A reused forecast's "now" is this hour, not
            necessarily the current one. */
        val fetchedAt: Long = 0L
    )

    /** MET Norway's terms require an identifying User-Agent. */
    private const val USER_AGENT = "TouchGrass/1.0 github.com/LxO96/Touch-grass"

    internal const val CACHE_MS = 45 * 60 * 1000L   // the spec's reuse window

    /**
     * How old a forecast may be and still be worth showing when a refresh
     * comes back with nothing. The same six hours as `MAX_STALE_MS` in
     * web/app.js, deliberately: one policy, that a recent answer beats no
     * answer, and the two constants should be read together.
     */
    internal const val MAX_STALE_MS = 6 * 60 * 60 * 1000L

    internal data class Cache(val key: String, val at: Long, val forecast: Forecast?)

    private var cache = Cache("", 0L, null)

    /** The cached forecast, if it is for this place and inside `withinMs`. */
    internal fun reusable(c: Cache, key: String, nowMs: Long, withinMs: Long): Forecast? =
        c.forecast?.takeIf { c.key == key && nowMs - c.at < withinMs }

    private const val KP_URL =
        "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"
    private const val OVATION_URL =
        "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json"
    private const val OVATION_MS = 30 * 60 * 1000L

    // OVATION is almost a megabyte and refreshed about every half hour.
    private var ovation: Pair<Long, String>? = null

    private fun ovationNow(nowMs: Long): String? {
        ovation?.let { (at, body) -> if (nowMs - at < OVATION_MS) return body }
        return body(OVATION_URL)?.also { ovation = nowMs to it }
    }

    fun fetch(lat: Double, lon: Double): Forecast? =
        fetch(
            lat, lon, System.currentTimeMillis(),
            get = { la, lo ->
                Triple(
                    body(openMeteoUrl(la, lo)),
                    body(metUrl(la, lo), USER_AGENT),
                    body(smhiUrl(la, lo))
                )
            },
            kp = { body(KP_URL) },
            ovationGet = { ovationNow(System.currentTimeMillis()) }
        )

    /**
     * The real work, with the clock and the network passed in so a test can
     * drive the cache and the failure paths without waiting or dialling out.
     */
    internal fun fetch(
        lat: Double,
        lon: Double,
        nowMs: Long,
        /** The three response bodies, in the order blend.js wants them. */
        get: (Double, Double) -> Triple<String?, String?, String?>,
        /** NOAA's Kp forecast, or null. Off by default so tests stay offline. */
        kp: () -> String? = { null },
        /** NOAA's OVATION grid, fetched only when it could change the answer. */
        ovationGet: () -> String? = { null }
    ): Forecast? {
        val key = cacheKey(lat, lon)
        val c = cache
        // Three services per background check is a lot. A check that lands
        // early, or a widget redraw off-schedule, reuses what we have.
        reusable(c, key, nowMs, CACHE_MS)?.let { return it }

        // Whatever goes wrong from here — nothing answered, a 200 carrying a
        // captive portal's HTML, a payload short a field — the answer is the
        // forecast we already had, if it is recent enough to still mean
        // something. Returning null instead loses the widget an update and
        // costs CheckWorker its retry.
        fun fallback() = reusable(c, key, nowMs, MAX_STALE_MS)

        val (om, met, smhi) = try {
            get(lat, lon)
        } catch (_: Exception) {
            return fallback()
        }
        if (om == null && met == null && smhi == null) return fallback()

        // blend.js is written not to throw, but this object's contract is
        // "null on any failure" and it has to hold whatever the JS does:
        // Scoring.call has no try of its own, so an exception here would
        // travel all the way out of CheckWorker.doWork.
        val kpBody = try { kp() } catch (_: Exception) { null }
        val blended = try {
            val first = Scoring.blend(om, met, smhi, kpBody)
            // The megabyte of OVATION only when it could change "now".
            if (first != null && Scoring.wantsOvation(first)) {
                val ov = try { ovationGet() } catch (_: Exception) { null }
                if (ov != null) Scoring.blend(om, met, smhi, kpBody, ov) ?: first else first
            } else {
                first
            }
        } catch (_: Exception) {
            null
        } ?: return fallback()

        val parsed = try {
            parseBlended(JSONObject(blended), nowMs)
        } catch (_: Exception) {
            null
        } ?: return fallback()

        cache = Cache(key, nowMs, parsed)
        return parsed
    }

    /** Drops the cache. Tests only — nothing in the app needs it. */
    internal fun forget() {
        cache = Cache("", 0L, null)
    }

    /**
     * Which place the cached forecast is for.
     *
     * `Locale.US` for the same reason [smhiUrl] needs it: the default
     * locale decides the decimal separator, and a key of `59,329,18,069`
     * is not the key `59.329,18.069` that the next call would build if the
     * user changed language in between. Only ever compared for equality,
     * so nothing breaks today — but it is the identical defect, and a trap
     * left lying in the open is one somebody eventually stands on.
     */
    internal fun cacheKey(lat: Double, lon: Double): String =
        String.format(Locale.US, "%.3f,%.3f", lat, lon)

    private fun openMeteoUrl(lat: Double, lon: Double) =
        "https://api.open-meteo.com/v1/forecast" +
            "?latitude=$lat&longitude=$lon" +
            "&current=temperature_2m,apparent_temperature,precipitation," +
            "weather_code,wind_speed_10m,is_day" +
            "&hourly=temperature_2m,apparent_temperature," +
            "precipitation_probability,precipitation,weather_code," +
            "wind_speed_10m,is_day,cloud_cover" +
            "&daily=sunset,precipitation_sum,snowfall_sum,sunshine_duration," +
            "apparent_temperature_max&past_days=92&past_hours=1&forecast_hours=48" +
            "&forecast_days=2&timezone=auto"

    private fun metUrl(lat: Double, lon: Double) =
        "https://api.met.no/weatherapi/locationforecast/2.0/complete" +
            "?lat=$lat&lon=$lon"

    /**
     * `Locale.US`, and it is not cosmetic: `String.format` without one
     * formats through the *device's* locale, so a Swedish phone asks SMHI
     * for `lon/18,0690` and is answered 404. The page builds this same URL
     * with `toFixed(4)`, which never does that — which would leave the
     * page blending three sources and the widget two, on precisely the
     * devices SMHI was added for.
     */
    internal fun smhiUrl(lat: Double, lon: Double) =
        "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1" +
            String.format(Locale.US, "/geotype/point/lon/%.4f/lat/%.4f/data.json", lon, lat)

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

    private fun parseBlended(d: JSONObject, fetchedAt: Long): Forecast? {
        fun hour(o: JSONObject, k: Int) = Scoring.Hour(
            hour = o.getInt("hour"),
            feels = o.getDouble("feels"),
            pop = o.optDouble("pop", 0.0),
            precip = o.optDouble("precip", 0.0),
            wind = o.getDouble("wind"),
            isDay = o.getBoolean("isDay"),
            code = o.getInt("code"),
            twilight = if (o.isNull("twilight")) null else o.optString("twilight").ifEmpty { null },
            novelty = if (o.isNull("novelty")) null else o.optString("novelty").ifEmpty { null },
            noveltyDays = if (o.isNull("noveltyDays")) null else o.optInt("noveltyDays"),
            aurora = if (o.isNull("aurora")) null else o.optString("aurora").ifEmpty { null },
            auroraSource = if (o.isNull("auroraSource")) null else o.optString("auroraSource").ifEmpty { null },
            auroraValue = if (o.isNull("auroraValue")) null else o.optDouble("auroraValue"),
            hoursFromNow = k,
            label = label(o.getInt("hour"))
        )

        val now = hour(d.optJSONObject("now") ?: return null, 0)
        val arr = d.optJSONArray("ahead") ?: return null
        val ahead = ArrayList<Scoring.Hour>(arr.length())
        for (i in 0 until arr.length()) ahead += hour(arr.getJSONObject(i), i + 1)

        val sunset = if (d.isNull("sunsetMin")) null else d.getInt("sunsetMin")
        return Forecast(now, ahead, sunset, fetchedAt)
    }

    fun label(hr: Int) = when {
        hr == 0 -> "midnight"
        hr < 12 -> "${hr}am"
        hr == 12 -> "noon"
        else -> "${hr - 12}pm"
    }
}
