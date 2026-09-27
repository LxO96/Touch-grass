package toys.touchgrass

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * When the daily nudge fires, and when it has no business firing.
 *
 * The nudge used to ride on the hourly background check. Android defers
 * background work for an app you rarely open — for hours, or until the next
 * time you open it — so the overdue check ran, and the nudge arrived, the
 * moment you opened the app: exactly when it was least use. It now has an
 * alarm of its own, and opening the app counts as having been reminded.
 *
 * Everything here is pure, clock and timezone passed in, so it can be
 * tested without a device.
 */
object NudgeTiming {

    /** How long to wait before trying an owed nudge again. */
    const val RETRY_MS = 15 * 60 * 1000L

    /** How long after you last looked at the app a window alert stays quiet. */
    const val QUIET_AFTER_OPEN_MS = 2 * 60 * 60 * 1000L

    /** `minutes` past local midnight, `daysAhead` days from the day of `now`. */
    fun dueAt(now: Long, minutes: Int, daysAhead: Int, zone: TimeZone): Long =
        Calendar.getInstance(zone).apply {
            timeInMillis = now
            // Add calendar days, not 24-hour blocks: across a clock change
            // "tomorrow at five" is 23 or 25 hours away, not 24.
            add(Calendar.DAY_OF_MONTH, daysAhead)
            set(Calendar.HOUR_OF_DAY, minutes / 60)
            set(Calendar.MINUTE, minutes % 60)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

    /**
     * When the nudge alarm should next go off.
     *
     * `owedToday` means reminders are on, today has not been nudged, and you
     * have not been out. An owed nudge whose time has passed is still owed —
     * the phone was off, or the alarm was lost — so it is tried again shortly
     * rather than skipped to tomorrow. Not immediately, though: a fetch that
     * keeps failing must not turn into a loop.
     */
    fun nextTrigger(now: Long, dueMinutes: Int, owedToday: Boolean, zone: TimeZone): Long {
        val today = dueAt(now, dueMinutes, 0, zone)
        return when {
            owedToday && today > now -> today
            owedToday -> now + RETRY_MS
            else -> dueAt(now, dueMinutes, 1, zone)
        }
    }

    /**
     * Opening the app once the nudge came due is the reminder, already
     * delivered: the screen says the same thing the notification would.
     */
    fun nudgeAnswered(openedAt: Long, dueAt: Long, now: Long): Boolean =
        openedAt in dueAt..now

    /**
     * Someone who has just been looking at the verdict does not need a
     * notification repeating it.
     */
    fun alertQuiet(openedAt: Long, now: Long): Boolean =
        openedAt > 0 && now - openedAt in 0 until QUIET_AFTER_OPEN_MS

    /** Local calendar day, as the once-a-day guards and the log key it. */
    fun dayKey(now: Long, zone: TimeZone): String {
        val cal = Calendar.getInstance(zone).apply { timeInMillis = now }
        return String.format(
            Locale.US, "%d-%02d-%02d",
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH)
        )
    }
}
