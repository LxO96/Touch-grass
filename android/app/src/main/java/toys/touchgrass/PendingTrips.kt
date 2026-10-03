package toys.touchgrass

import org.json.JSONObject

/**
 * Trips tapped on the widget while the page wasn't running, kept as
 * {"YYYY-MM-DD": n} until the page opens and folds them into its log.
 *
 * Per day, because a trip tapped late at night and picked up tomorrow
 * still belongs to the night it was made. Pure string in, string out, so
 * it can be tested without a phone; Prefs does the storing.
 */
object PendingTrips {

    /** The page's own ceiling for a day. */
    private const val MAX_PER_DAY = 99

    private fun parse(raw: String?): JSONObject =
        try {
            if (raw.isNullOrEmpty()) JSONObject() else JSONObject(raw)
        } catch (_: Exception) {
            JSONObject()
        }

    fun add(raw: String?, day: String): String {
        val o = parse(raw)
        o.put(day, minOf(MAX_PER_DAY, o.optInt(day, 0) + 1))
        return o.toString()
    }

    fun on(raw: String?, day: String): Int = parse(raw).optInt(day, 0)

    /** What the widget kept before it counted per day: one count, one day. */
    fun fromLegacy(day: String?, count: Int): String {
        val o = JSONObject()
        if (!day.isNullOrEmpty() && count > 0) o.put(day, count)
        return o.toString()
    }
}
