package toys.touchgrass

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Trips tapped on the widget while the app is closed.
 *
 * The bug these pin: the widget kept one count for one day, so a trip
 * tapped late last night, not yet picked up by the app, was thrown away
 * the moment today's first tap reset the count.
 */
class PendingTripsTest {

    @Test
    fun `a tap counts for the day it was made`() {
        val raw = PendingTrips.add(null, "2026-10-01")
        assertEquals(1, PendingTrips.on(raw, "2026-10-01"))
        assertEquals(0, PendingTrips.on(raw, "2026-10-02"))
    }

    @Test
    fun `a new day keeps yesterday's taps`() {
        var raw = PendingTrips.add(null, "2026-10-01")
        raw = PendingTrips.add(raw, "2026-10-02")
        raw = PendingTrips.add(raw, "2026-10-02")
        assertEquals(1, PendingTrips.on(raw, "2026-10-01"))
        assertEquals(2, PendingTrips.on(raw, "2026-10-02"))
    }

    @Test
    fun `a day stops counting where the page does`() {
        var raw: String? = null
        repeat(120) { raw = PendingTrips.add(raw, "2026-10-02") }
        assertEquals(99, PendingTrips.on(raw, "2026-10-02"))
    }

    @Test
    fun `what the old widget kept is carried over`() {
        val raw = PendingTrips.fromLegacy("2026-10-01", 2)
        assertEquals(2, PendingTrips.on(raw, "2026-10-01"))
        assertEquals("{}", PendingTrips.fromLegacy("", 3))
        assertEquals("{}", PendingTrips.fromLegacy("2026-10-01", 0))
    }

    @Test
    fun `a broken store starts again rather than crashing`() {
        assertEquals(0, PendingTrips.on("{broken", "2026-10-02"))
        val raw = PendingTrips.add("{broken", "2026-10-02")
        assertEquals(1, PendingTrips.on(raw, "2026-10-02"))
    }

    @Test
    fun `the page is handed every day at once`() {
        var raw = PendingTrips.add(null, "2026-10-01")
        raw = PendingTrips.add(raw, "2026-10-02")
        val o = JSONObject(raw)
        assertEquals(setOf("2026-10-01", "2026-10-02"), o.keys().asSequence().toSet())
    }
}
