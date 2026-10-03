package toys.touchgrass

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * How many readings the one-row widget shows. The bug these pin: it was
 * cut to the sky and temperature for a narrow widget, which left a wide
 * one mostly empty space between the temperature and the + button.
 */
class ReadingsFitTest {

    private val readings = listOf("Cloudy", "15°C", "13 km/h", "0%", "19:42")

    @Test
    fun `no limit shows everything`() {
        assertEquals(ReadingsFit.Fit(true, 5), ReadingsFit.fit(readings, null))
    }

    @Test
    fun `a wide widget fills its width, in order`() {
        // 435dp wide (five columns on a Galaxy): all but the sunset.
        assertEquals(ReadingsFit.Fit(true, 4), ReadingsFit.fit(readings, ReadingsFit.budget(435)))
    }

    @Test
    fun `a narrow widget keeps the sky as an icon and the temperature`() {
        assertEquals(ReadingsFit.Fit(false, 2), ReadingsFit.fit(readings, ReadingsFit.budget(262)))
    }

    @Test
    fun `the temperature always stays, however narrow`() {
        assertEquals(ReadingsFit.Fit(false, 2), ReadingsFit.fit(readings, 10))
    }

    @Test
    fun `an unknown width is treated as no limit`() {
        assertEquals(null, ReadingsFit.budget(0))
    }
}
