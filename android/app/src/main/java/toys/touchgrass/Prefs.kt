package toys.touchgrass

import android.content.Context
import org.json.JSONObject

/**
 * The page's state, mirrored where Kotlin can reach it.
 *
 * localStorage lives inside the WebView and is invisible to a background
 * worker, so the page pushes what the worker needs across the JS bridge
 * and it lands here. localStorage stays the source of truth; this is a
 * copy that only ever gets written by the page.
 */
object Prefs {

    private const val FILE = "touchgrass"

    private fun sp(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    // --- what the page told us -------------------------------------------

    fun store(c: Context, json: String) {
        val o = JSONObject(json)
        val n = o.optJSONObject("notify") ?: JSONObject()
        val s = o.optJSONObject("settings") ?: JSONObject()
        val p = o.optJSONObject("place")

        sp(c).edit().apply {
            putBoolean("enabled", n.optBoolean("enabled", false))
            putInt("hour", n.optInt("hour", 17))
            putInt("minute", n.optInt("minute", 0))
            putString("mode", n.optString("mode", "clock"))
            putFloat("beforeSunset", n.optDouble("beforeSunset", 2.0).toFloat())
            putBoolean("watch", n.optBoolean("watch", false))
            putInt("windowStart", n.optInt("windowStart", 9))
            putInt("windowEnd", n.optInt("windowEnd", 20))
            putInt("greatBar", n.optInt("greatBar", 75))
            putBoolean("alarm", n.optBoolean("alarm", false))

            putString("lang", o.optString("lang", "en"))
            // The whole log, so the widget can draw recent weeks offline.
            o.optJSONObject("log")?.let { putString("log", it.toString()) }

            val u = o.optJSONObject("units")
            putString("unitTemp", u?.optString("temp", "c") ?: "c")
            putString("unitWind", u?.optString("wind", "kmh") ?: "kmh")

            putFloat("rain", s.optDouble("rain", 1.0).toFloat())
            putFloat("cold", s.optDouble("cold", 1.0).toFloat())
            putFloat("heat", s.optDouble("heat", 1.0).toFloat())
            putFloat("windDial", s.optDouble("wind", 1.0).toFloat())
            putFloat("dark", s.optDouble("dark", 1.0).toFloat())
            putInt("bar", s.optInt("bar", 60))

            putInt("visitsToday", o.optInt("visitsToday", 0))
            putString("today", o.optString("today", ""))

            if (p != null) {
                putFloat("lat", p.optDouble("lat", 0.0).toFloat())
                putFloat("lon", p.optDouble("lon", 0.0).toFloat())
                putString("placeLabel", p.optString("label", ""))
                putBoolean("hasPlace", true)
            }
        }.apply()
    }

    fun dials(c: Context) = Scoring.Dials(
        rain = sp(c).getFloat("rain", 1f).toDouble(),
        cold = sp(c).getFloat("cold", 1f).toDouble(),
        heat = sp(c).getFloat("heat", 1f).toDouble(),
        wind = sp(c).getFloat("windDial", 1f).toDouble(),
        dark = sp(c).getFloat("dark", 1f).toDouble(),
        bar = sp(c).getInt("bar", 60)
    )

    fun remindersOn(c: Context) = sp(c).getBoolean("enabled", false)
    fun reminderHour(c: Context) = sp(c).getInt("hour", 17)
    fun reminderMinute(c: Context) = sp(c).getInt("minute", 0)
    fun reminderBySunset(c: Context) = sp(c).getString("mode", "clock") == "sunset"
    fun hoursBeforeSunset(c: Context) = sp(c).getFloat("beforeSunset", 2f)

    /**
     * Minutes past midnight at which the nudge is due.
     * Mirrors reminderMinutes() in core.js; falls back to the clock time
     * when sunset is unknown, so a missing forecast can't silence it.
     */
    fun reminderDueMinutes(c: Context, sunsetMinutes: Int?): Int {
        if (reminderBySunset(c) && sunsetMinutes != null) {
            val m = sunsetMinutes - (hoursBeforeSunset(c) * 60f).toInt()
            return m.coerceIn(0, 24 * 60 - 1)
        }
        return (reminderHour(c) * 60 + reminderMinute(c)).coerceIn(0, 24 * 60 - 1)
    }

    /** The language chosen in the app, for notifications and the widget. */
    fun lang(c: Context) = sp(c).getString("lang", "en") ?: "en"

    fun placeLabel(c: Context) = sp(c).getString("placeLabel", "") ?: ""

    /** The day-count log, as the page last left it. */
    fun logSnapshot(c: Context): Map<String, Int> {
        val raw = sp(c).getString("log", null) ?: return emptyMap()
        return try {
            val o = org.json.JSONObject(raw)
            val out = HashMap<String, Int>()
            for (k in o.keys()) out[k] = o.optInt(k, 0)
            out
        } catch (_: Exception) {
            emptyMap()
        }
    }

    /* ---- trips logged from the widget, while the page wasn't running ---- */

    fun addPendingVisit(c: Context) {
        val day = sp(c).getString("pendingDay", "")
        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            .format(java.util.Date())
        // A pending trip belongs to the day it was made, not to whenever the
        // page finally opens.
        val n = if (day == today) sp(c).getInt("pending", 0) else 0
        sp(c).edit().putString("pendingDay", today).putInt("pending", n + 1).apply()
    }

    fun pendingVisits(c: Context): Int {
        val day = sp(c).getString("pendingDay", "")
        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            .format(java.util.Date())
        return if (day == today) sp(c).getInt("pending", 0) else 0
    }

    fun clearPendingVisits(c: Context) {
        sp(c).edit().putInt("pending", 0).apply()
    }

    fun unitTemp(c: Context) = sp(c).getString("unitTemp", "c") ?: "c"
    fun unitWind(c: Context) = sp(c).getString("unitWind", "kmh") ?: "kmh"

    /** What the widget last drew, so it can redraw without a network call. */
    fun saveWidget(c: Context, json: String) =
        sp(c).edit().putString("widget", json).apply()

    fun widgetCache(c: Context): WidgetState? =
        sp(c).getString("widget", null)?.let { WidgetState.fromJson(it) }

    /** True the first time it is asked after the app version changed. */
    fun consumeVersionChange(c: Context, version: Long): Boolean {
        val seen = sp(c).getLong("seenVersion", -1L)
        if (seen == version) return false
        sp(c).edit().putLong("seenVersion", version).apply()
        return seen != -1L      // not a fresh install, an actual update
    }

    fun watchOn(c: Context) = sp(c).getBoolean("watch", false)
    fun windowStart(c: Context) = sp(c).getInt("windowStart", 9)
    fun windowEnd(c: Context) = sp(c).getInt("windowEnd", 20)
    fun greatBar(c: Context) = sp(c).getInt("greatBar", 75)
    fun alarmStyle(c: Context) = sp(c).getBoolean("alarm", false)

    fun hasPlace(c: Context) = sp(c).getBoolean("hasPlace", false)
    fun lat(c: Context) = sp(c).getFloat("lat", 0f).toDouble()
    fun lon(c: Context) = sp(c).getFloat("lon", 0f).toDouble()

    /** Visits logged for [today], or 0 if the stored day has since rolled over. */
    fun visitsOn(c: Context, today: String): Int =
        if (sp(c).getString("today", "") == today) sp(c).getInt("visitsToday", 0) else 0

    // --- our own bookkeeping ---------------------------------------------

    /** So a day gets at most one nudge and one opportunity alert. */
    /** When the app was last brought on screen, epoch millis; 0 if never. */
    fun lastOpened(c: Context) = sp(c).getLong("openedAt", 0L)
    fun markOpened(c: Context, at: Long) = sp(c).edit().putLong("openedAt", at).apply()

    fun alreadyNudged(c: Context, day: String) = sp(c).getString("nudgedOn", "") == day
    fun markNudged(c: Context, day: String) = sp(c).edit().putString("nudgedOn", day).apply()

    fun alreadyAlerted(c: Context, day: String) = sp(c).getString("alertedOn", "") == day
    fun markAlerted(c: Context, day: String) = sp(c).edit().putString("alertedOn", day).apply()
}
