package toys.touchgrass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * The app and the web pages now run the *same* scoring.js, so there is no
 * port to keep in step. What still needs proving is that Rhino evaluates
 * that file exactly as a browser does — a subtly different `Math.round`
 * or a missing built-in would be just as damaging as a bad port, and far
 * harder to spot.
 *
 * scoring_fixtures.csv holds 1460 cases with expected scores produced by
 * running scoring.js in real Chrome. This replays them through Rhino.
 */
class ScoringEngineTest {

    @Before
    fun useTheRealFile() {
        val path = System.getProperty("touchgrass.scoring.js")
            ?: error("touchgrass.scoring.js system property not set by Gradle")
        val f = File(path)
        assertTrue("scoring.js not found at $path", f.exists())
        Scoring.init { f.readText() }
    }

    private fun fixtures(): List<String> =
        javaClass.classLoader!!
            .getResourceAsStream("scoring_fixtures.csv")!!
            .bufferedReader()
            .readLines()
            .filter { it.isNotBlank() && !it.startsWith("#") }

    @Test
    fun rhinoScoresIdenticallyToTheBrowser() {
        val rows = fixtures()
        assertTrue("expected a decent fixture set, got ${rows.size}", rows.size > 1000)

        val failures = mutableListOf<String>()

        for (line in rows) {
            val f = line.split(",")
            val h = Scoring.Hour(
                hour = f[0].toInt(),
                feels = f[1].toDouble(),
                pop = f[2].toDouble(),
                precip = f[3].toDouble(),
                wind = f[4].toDouble(),
                isDay = f[5] == "1",
                code = f[6].toInt()
            )
            val dials = Scoring.Dials(
                rain = f[7].toDouble(),
                cold = f[8].toDouble(),
                heat = f[9].toDouble(),
                wind = f[10].toDouble(),
                dark = f[11].toDouble()
            )
            val expected = f[12].toInt()
            val actual = Scoring.score(h, dials)
            if (actual != expected) failures += "$line -> rhino=$actual"
        }

        assertEquals(
            "Rhino disagreed with the browser on ${failures.size} case(s):\n" +
                failures.take(10).joinToString("\n"),
            0, failures.size
        )
    }

    @Test
    fun safetyLimitsComeFromTheSharedFile() {
        // Read out of scoring.js, not restated here, so they cannot diverge.
        assertEquals(38.0, Scoring.tooHot, 0.0001)
        assertEquals(-15.0, Scoring.tooCold, 0.0001)
    }

    @Test
    fun deepNightIsElevenPmToFiveAm() {
        assertEquals(
            listOf(0, 1, 2, 3, 4, 23),
            (0..23).filter { Scoring.isDeepNight(it) }
        )
    }

    @Test
    fun riskyWeatherIsFlaggedWhateverTheDials() {
        val fine = Scoring.Hour(14, 20.0, 0.0, 0.0, 0.0, true, 0)
        assertTrue(Scoring.isRisky(Scoring.Hour(14, 40.0, 0.0, 0.0, 0.0, true, 0)))
        assertTrue(Scoring.isRisky(Scoring.Hour(14, -20.0, 0.0, 0.0, 0.0, true, 0)))
        assertTrue(Scoring.isRisky(Scoring.Hour(14, 20.0, 0.0, 0.0, 0.0, true, 95)))
        assertTrue(!Scoring.isRisky(fine))
    }

    @Test
    fun scoresStayInRange() {
        val awful = Scoring.Hour(3, -40.0, 100.0, 9.0, 90.0, false, 96)
        val lovely = Scoring.Hour(14, 20.0, 0.0, 0.0, 2.0, true, 0)
        assertTrue(Scoring.score(awful, Scoring.Dials()) in 0..100)
        assertTrue(Scoring.score(lovely, Scoring.Dials()) in 0..100)
        assertTrue(Scoring.score(lovely, Scoring.Dials()) > Scoring.score(awful, Scoring.Dials()))
    }
}
