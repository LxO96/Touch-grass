package toys.touchgrass

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

/** One coming hour as the widget keeps it: when it starts, its clock hour, score and sky. */
data class HourCell(val t: Long, val hour: Int, val score: Int, val code: Int)

/**
 * The rest of the day, for the taller widgets.
 *
 * The cache holds the next twelve hours as they stood when it was
 * written, which may be a while ago. Each hour carries its own start
 * time, so the widget can work out which of them are still to come.
 */
object WidgetHours {

    private const val HOUR_MS = 3_600_000L

    /** The hours that start after [now] and before midnight, at most [max]. */
    fun restOfDay(hours: List<HourCell>, now: Long, tz: TimeZone, max: Int): List<HourCell> {
        val midnight = Calendar.getInstance(tz).apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            add(Calendar.DAY_OF_MONTH, 1)
        }.timeInMillis
        return hours.filter { it.t > now && it.t < midnight }.sortedBy { it.t }.take(max)
    }

    /** Index of the hour worth waiting for: the highest score, the earliest of a tie. */
    fun best(hours: List<HourCell>): Int? {
        if (hours.isEmpty()) return null
        var best = 0
        for (i in hours.indices) if (hours[i].score > hours[best].score) best = i
        return best
    }

    /**
     * The worker's forecast, placed on the clock. It has just been fetched,
     * so "n hours from now" counts from the start of the current hour.
     */
    fun fromAhead(
        ahead: List<Scoring.Hour>,
        now: Long,
        tz: TimeZone,
        score: (Scoring.Hour) -> Int
    ): List<HourCell> {
        val thisHour = Calendar.getInstance(tz).apply {
            timeInMillis = now
            set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        return ahead.map { HourCell(thisHour + it.hoursFromNow * HOUR_MS, it.hour, score(it), it.code) }
    }

    fun toJson(hours: List<HourCell>): JSONArray = JSONArray().apply {
        for (h in hours) put(JSONObject().put("t", h.t).put("h", h.hour).put("s", h.score).put("c", h.code))
    }

    /** Anything malformed is skipped; an old cache without hours reads as none. */
    fun fromJson(a: JSONArray?): List<HourCell> {
        if (a == null) return emptyList()
        val out = ArrayList<HourCell>()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            if (!o.has("t") || !o.has("h") || !o.has("s")) continue
            out.add(HourCell(o.optLong("t"), o.optInt("h"), o.optInt("s"), o.optInt("c", 3)))
        }
        return out
    }
}
