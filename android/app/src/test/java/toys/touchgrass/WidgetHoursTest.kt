package toys.touchgrass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * The rest of the day, as the taller widgets draw it: the hours still to
 * come, never past midnight, with the best of them picked out.
 */
class WidgetHoursTest {

    private val stockholm = TimeZone.getTimeZone("Europe/Stockholm")

    private fun at(d: Int, h: Int, mi: Int = 0): Long =
        Calendar.getInstance(stockholm).apply {
            clear()
            set(2026, Calendar.OCTOBER, d, h, mi, 0)
        }.timeInMillis

    /** Twelve hours from [fromHour] on 2 Oct, scored by [score]. */
    private fun forecast(fromHour: Int, score: (Int) -> Int = { 50 }): List<HourCell> =
        (0 until 12).map {
            val t = at(2, fromHour) + it * 3_600_000L
            val h = (fromHour + it) % 24
            HourCell(t, h, score(h), 0)
        }

    @Test
    fun `hours that have passed are dropped`() {
        // Cached at 13:00, drawn at 15:20: 13, 14 and 15 are gone.
        val shown = WidgetHours.restOfDay(forecast(13), at(2, 15, 20), stockholm, 6)
        assertEquals(listOf(16, 17, 18, 19, 20, 21), shown.map { it.hour })
    }

    @Test
    fun `the day ends at midnight`() {
        val shown = WidgetHours.restOfDay(forecast(20), at(2, 20, 10), stockholm, 6)
        assertEquals(listOf(21, 22, 23), shown.map { it.hour })
    }

    @Test
    fun `late at night there is nothing left to show`() {
        val shown = WidgetHours.restOfDay(forecast(20), at(2, 23, 30), stockholm, 6)
        assertEquals(emptyList<Int>(), shown.map { it.hour })
    }

    @Test
    fun `a forecast from yesterday shows nothing`() {
        val shown = WidgetHours.restOfDay(forecast(13), at(3, 10), stockholm, 6)
        assertEquals(emptyList<Int>(), shown.map { it.hour })
    }

    @Test
    fun `the widget takes only as many as it has room for`() {
        assertEquals(4, WidgetHours.restOfDay(forecast(10), at(2, 10, 5), stockholm, 4).size)
    }

    @Test
    fun `the best hour is the highest, and the earliest of a tie`() {
        val hours = WidgetHours.restOfDay(
            forecast(10) { h -> if (h == 13 || h == 15) 80 else 40 },
            at(2, 10, 5), stockholm, 6
        )
        assertEquals(13, hours[WidgetHours.best(hours)!!].hour)
        assertNull(WidgetHours.best(emptyList()))
    }

    @Test
    fun `the coming hours survive the cache`() {
        val cells = listOf(HourCell(at(2, 14), 14, 72, 3), HourCell(at(2, 15), 15, 40, 61))
        val back = WidgetState.fromJson(WidgetState(50, "go", null, "Kiruna", hours = cells).toJson())!!
        assertEquals(cells, back.hours)
    }

    @Test
    fun `a cache from before the hours existed reads as none`() {
        val old = """{"score":50,"state":"go","target":null,"place":"Kiruna"}"""
        assertEquals(emptyList<HourCell>(), WidgetState.fromJson(old)!!.hours)
    }

    @Test
    fun `the worker's hours are placed from the hour it ran`() {
        val now = at(2, 14, 25)
        fun hour(d: Int, h: Int, code: Int) =
            Scoring.Hour(h, 15.0, 0.0, 0.0, 5.0, true, code, hoursFromNow = d)
        val cells = WidgetHours.fromAhead(
            listOf(hour(1, 15, 0), hour(2, 16, 61)), now, stockholm
        ) { h -> 60 + h.hoursFromNow }
        assertEquals(listOf(at(2, 15), at(2, 16)), cells.map { it.t })
        assertEquals(listOf(15, 16), cells.map { it.hour })
        assertEquals(listOf(61, 62), cells.map { it.score })
        assertEquals(listOf(0, 61), cells.map { it.code })
    }
}
