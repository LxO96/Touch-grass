package toys.touchgrass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * When the daily nudge fires, and when it has no business firing.
 *
 * The bug these pin: the nudge rode on an hourly background job that
 * Android defers for an app you rarely open, so it only ran — and only
 * nudged — the moment you opened the app. It now has an alarm of its own,
 * and opening the app counts as having been reminded.
 */
class NudgeTimingTest {

    private val stockholm = TimeZone.getTimeZone("Europe/Stockholm")

    private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int): Long =
        Calendar.getInstance(stockholm).apply {
            clear()
            set(y, mo - 1, d, h, mi, 0)
        }.timeInMillis

    private fun localHourMinute(ms: Long): String {
        val cal = Calendar.getInstance(stockholm).apply { timeInMillis = ms }
        return "%02d-%02d %02d:%02d".format(
            cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH),
            cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE)
        )
    }

    private val FIVE_PM = 17 * 60

    /* ---------------- when the alarm is set for ---------------- */

    @Test
    fun `an owed nudge before its time is set for its time today`() {
        val now = at(2026, 9, 27, 9, 30)
        val next = NudgeTiming.nextTrigger(now, FIVE_PM, owedToday = true, zone = stockholm)
        assertEquals("09-27 17:00", localHourMinute(next))
    }

    @Test
    fun `an owed nudge whose time has passed fires soon, not tomorrow`() {
        // Phone was off at five, or the alarm was lost: the nudge is still owed.
        val now = at(2026, 9, 27, 18, 0)
        val next = NudgeTiming.nextTrigger(now, FIVE_PM, owedToday = true, zone = stockholm)
        assertEquals(now + NudgeTiming.RETRY_MS, next)
    }

    @Test
    fun `a day that owes nothing moves the alarm to tomorrow`() {
        // Already nudged, or already been out, or reminders off for today.
        val now = at(2026, 9, 27, 9, 30)
        val next = NudgeTiming.nextTrigger(now, FIVE_PM, owedToday = false, zone = stockholm)
        assertEquals("09-28 17:00", localHourMinute(next))
    }

    @Test
    fun `tomorrow means tomorrow on the clock, across a clock change`() {
        // Summer time ends overnight 24→25 October in Stockholm. Adding
        // 24 hours to today's five o'clock would land on 16:00.
        val now = at(2026, 10, 24, 18, 0)
        val next = NudgeTiming.nextTrigger(now, FIVE_PM, owedToday = false, zone = stockholm)
        assertEquals("10-25 17:00", localHourMinute(next))
    }

    @Test
    fun `the retry for a late nudge is not immediate`() {
        // Firing "now" in a loop would hammer the network while a fetch
        // keeps failing; the retry is a real gap.
        assertTrue(NudgeTiming.RETRY_MS >= 10 * 60 * 1000L)
    }

    /* ---------------- opening the app answers the nudge ---------------- */

    @Test
    fun `opening the app after the nudge came due answers it`() {
        val due = at(2026, 9, 27, 17, 0)
        val opened = at(2026, 9, 27, 17, 20)
        val now = at(2026, 9, 27, 17, 21)
        assertTrue(NudgeTiming.nudgeAnswered(opened, due, now))
    }

    @Test
    fun `opening the app in the morning does not answer the evening nudge`() {
        val due = at(2026, 9, 27, 17, 0)
        val opened = at(2026, 9, 27, 8, 0)
        val now = at(2026, 9, 27, 17, 1)
        assertFalse(NudgeTiming.nudgeAnswered(opened, due, now))
    }

    @Test
    fun `yesterday's visit to the app does not answer today's nudge`() {
        val due = at(2026, 9, 27, 17, 0)
        val opened = at(2026, 9, 26, 18, 0)
        val now = at(2026, 9, 27, 17, 1)
        assertFalse(NudgeTiming.nudgeAnswered(opened, due, now))
    }

    @Test
    fun `never having opened the app answers nothing`() {
        val due = at(2026, 9, 27, 17, 0)
        val now = at(2026, 9, 27, 17, 1)
        assertFalse(NudgeTiming.nudgeAnswered(0L, due, now))
    }

    /* ---------------- the good-window alert stays quiet after an open ---------------- */

    @Test
    fun `no window alert straight after you have looked at the app`() {
        val now = at(2026, 9, 27, 14, 0)
        assertTrue(NudgeTiming.alertQuiet(now - 30 * 60 * 1000L, now))
    }

    @Test
    fun `the window alert comes back once the app has been shut a while`() {
        val now = at(2026, 9, 27, 14, 0)
        assertFalse(NudgeTiming.alertQuiet(now - 3 * 60 * 60 * 1000L, now))
    }

    @Test
    fun `an app never opened never quiets the alert`() {
        assertFalse(NudgeTiming.alertQuiet(0L, at(2026, 9, 27, 14, 0)))
    }

    /* ---------------- today's date, for the once-a-day guards ---------------- */

    @Test
    fun `the day key is the local calendar day`() {
        // 00:30 local on the 28th is still the 27th in UTC.
        assertEquals("2026-09-28", NudgeTiming.dayKey(at(2026, 9, 28, 0, 30), stockholm))
    }
}
