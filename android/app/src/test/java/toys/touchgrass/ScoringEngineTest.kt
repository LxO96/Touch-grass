package toys.touchgrass

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mozilla.javascript.Context as RhinoContext
import org.mozilla.javascript.ScriptableObject
import java.io.File
import java.util.Locale

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
        val scoringPath = System.getProperty("touchgrass.scoring.js")
            ?: error("touchgrass.scoring.js system property not set by Gradle")
        val blendPath = System.getProperty("touchgrass.blend.js")
            ?: error("touchgrass.blend.js system property not set by Gradle")
        val scoring = File(scoringPath)
        val blend = File(blendPath)
        assertTrue("scoring.js not found at $scoringPath", scoring.exists())
        assertTrue("blend.js not found at $blendPath", blend.exists())
        Scoring.init { Scoring.join(scoring.readText(), blend.readText()) }
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

    /* ---------------- the cross-runtime invariant ---------------- */

    /**
     * blend.js exists in one copy so the page and the home-screen widget
     * cannot disagree. That was assumed rather than checked: the old
     * version of this test asserted a source count, the presence of
     * `isDay`, an hour and a sunset — every one of which a blend that
     * disagreed with the browser on every reading and every weather code
     * would have passed. It did disagree. `for…in` over an integer-keyed
     * tally enumerates numerically under V8 and in insertion order under
     * Rhino, so a tied code vote picked a different winner in each engine,
     * and with MET absent (a timeout, a 429, met.no down) that tie is on
     * the ordinary degraded path.
     *
     * So: the whole document, field by field, against what real V8 produced
     * from these same committed fixtures — with object keys sorted on both
     * sides first, since key order is exactly the thing the two engines are
     * allowed to disagree on. expected-blend.json is written by
     * `node web/make-blend-expectation.js` — regenerate it with that, never
     * by pasting in what Rhino said.
     */
    private fun expected(name: String): JSONObject {
        val all = JSONObject(File("../web/expected-blend.json").readText())
        return all.getJSONObject(name)
    }

    /**
     * Recursively sorts object keys (arrays keep their order — only object
     * property enumeration differs between V8 and Rhino) so the comparison
     * tests the *data*, not the serialisation. Comparing raw JSON text was
     * exactly the bug: V8 and Rhino enumerate integer-like object keys in
     * different orders, so two documents that agree on every field produce
     * different strings and a plain string-equals fails on formatting that
     * has nothing to do with correctness.
     */
    private fun canonicalize(value: Any?): Any? = when (value) {
        is JSONObject -> {
            val sorted = JSONObject()
            value.keys().asSequence().sorted().forEach { k -> sorted.put(k, canonicalize(value.get(k))) }
            sorted
        }
        is JSONArray -> {
            val arr = JSONArray()
            for (i in 0 until value.length()) arr.put(canonicalize(value.get(i)))
            arr
        }
        else -> value
    }

    private fun canonicalJson(value: JSONObject): String =
        (canonicalize(value) as JSONObject).toString(2)

    private fun canonicalJson(json: String): String = canonicalJson(JSONObject(json))

    @Test
    fun `Rhino blends all three sources exactly as the browser does`() {
        val out = Scoring.blend(
            File("../web/fixtures-om.json").readText(),
            File("../web/fixtures-met.json").readText(),
            File("../web/fixtures-smhi.json").readText()
        )
        assertNotNull(out)
        assertEquals(canonicalJson(expected("allThree")), canonicalJson(out!!))
    }

    @Test
    fun `Rhino blends without MET exactly as the browser does`() {
        // The degraded path, and the one that used to diverge: with MET
        // gone the other two renormalise to 0.5/0.5, so 22:00Z — SMHI's
        // light rain against Open-Meteo's rain — ties on total weight and
        // on heaviest source, and the winner came down to key order.
        val out = Scoring.blend(
            File("../web/fixtures-om.json").readText(),
            null,
            File("../web/fixtures-smhi.json").readText()
        )
        assertNotNull(out)
        assertEquals(canonicalJson(expected("metMissing")), canonicalJson(out!!))
    }

    @Test
    fun `the forecast is anchored to the current hour, not to local midnight`() {
        // Open-Meteo's hourly block starts at local midnight; the fixture's
        // first row is local 19:00 and current.time is 23:00. Taking row
        // zero would report 19:00 as "now" and aim the chart at hours that
        // have already been.
        val out = Scoring.blend(
            File("../web/fixtures-om.json").readText(),
            null,
            File("../web/fixtures-smhi.json").readText()
        )
        val json = JSONObject(out!!)
        assertEquals(23, json.getJSONObject("now").getInt("hour"))
        assertEquals("2026-09-08T21:00:00Z", json.getJSONObject("now").getString("time"))

        val ahead = json.getJSONArray("ahead")
        for (i in 0 until ahead.length()) {
            val t = ahead.getJSONObject(i).getString("time")
            assertTrue("$t precedes the current hour", t >= "2026-09-08T21:00:00Z")
        }
        assertEquals(19 * 60 + 41, json.getInt("sunsetMin"))
    }

    @Test
    fun `a blend with nothing in it is null`() {
        assertNull(Scoring.blend(null, null, null))
    }

    @Test
    fun `the shared files are joined so a trailing comment cannot eat the next`() {
        // They used to be concatenated with nothing between them, which
        // worked only because scoring.js happens to end in a newline.
        val cx = RhinoContext.enter()
        try {
            cx.optimizationLevel = -1
            val s = cx.initSafeStandardObjects()
            cx.evaluateString(
                s,
                Scoring.join("var a = 1; // a trailing comment", "var b = 2;"),
                "joined", 1, null
            )
            assertEquals(2.0, RhinoContext.toNumber(ScriptableObject.getProperty(s, "b")), 0.0)
        } finally {
            RhinoContext.exit()
        }
    }

    /* ---------------- Weather's nullable contract ---------------- */

    private fun bodies(om: String?, met: String?, smhi: String?) =
        { _: Double, _: Double -> Triple(om, met, smhi) }

    private fun fixtureBodies() = bodies(
        File("../web/fixtures-om.json").readText(),
        File("../web/fixtures-met.json").readText(),
        File("../web/fixtures-smhi.json").readText()
    )

    @Test
    fun `a failed refresh falls back to a forecast that is still recent`() {
        Weather.forget()
        val t0 = 1_000_000_000L
        val first = Weather.fetch(59.329, 18.069, t0, fixtureBodies())
        assertNotNull(first)

        // Past the 45-minute reuse window, so it really does try to refresh;
        // nothing answers. A forecast an hour old beats no forecast at all,
        // which is the same policy web/app.js's MAX_STALE_MS states.
        val stale = Weather.fetch(59.329, 18.069, t0 + 60 * 60 * 1000L, bodies(null, null, null))
        assertEquals(first, stale)

        // Past six hours it is no longer worth showing.
        assertNull(Weather.fetch(59.329, 18.069, t0 + 7 * 60 * 60 * 1000L, bodies(null, null, null)))
    }

    @Test
    fun `a cached forecast is not reused for a different place`() {
        Weather.forget()
        val t0 = 2_000_000_000L
        assertNotNull(Weather.fetch(59.329, 18.069, t0, fixtureBodies()))
        assertNull(Weather.fetch(57.708, 11.974, t0 + 60_000L, bodies(null, null, null)))
    }

    @Test
    fun `a 200 carrying an HTML error page returns null instead of throwing`() {
        Weather.forget()
        val html = "<!doctype html><html><body>Sign in to the network</body></html>"
        // Weather.fetch's contract is null on any failure. Scoring.call has
        // no try of its own, so without a guard this travels out of
        // CheckWorker.doWork and turns a retry into a silent failure.
        assertNull(Weather.fetch(59.329, 18.069, 3_000_000_000L, bodies(html, null, null)))
    }

    /* ---------------- the day you owe is today ---------------- */

    /** One forecast hour: either lovely or soaked, day or night. */
    private fun hr(hour: Int, from: Int, fine: Boolean, day: Boolean) = Scoring.Hour(
        hour = hour,
        feels = if (fine) 18.0 else 4.0,
        pop = if (fine) 0.0 else 100.0,
        precip = if (fine) 0.0 else 3.0,
        wind = if (fine) 4.0 else 20.0,
        isDay = day,
        code = if (fine) 0 else 65,
        hoursFromNow = from,
        label = Weather.label(hour)
    )

    @Test
    fun `the nudge never names an hour that is past midnight`() {
        // 21:00, soaked, not been out — the only decent hour in the forecast
        // is 06:00 tomorrow. The widget's verdict refuses to look past
        // midnight while the day is owed; a nudge saying "6am looks better"
        // contradicts it from the same forecast.
        val now = hr(21, 0, fine = false, day = false)
        val ahead = (1..9).map {
            val h = (21 + it) % 24
            hr(h, it, fine = h == 6, day = h == 6)
        }
        val text = CheckWorker.nudgeText(Weather.Forecast(now, ahead, null), Scoring.Dials(), 21)

        assertTrue("named tomorrow: $text", !text.contains("6am"))
        assertTrue(text, text.startsWith("Today never really gets good"))
    }

    @Test
    fun `the nudge still names a good hour that is later today`() {
        // The other half of the same rule: today's hours must survive it.
        val now = hr(10, 0, fine = false, day = true)
        val ahead = (1..9).map { hr(10 + it, it, fine = 10 + it == 14, day = true) }
        val text = CheckWorker.nudgeText(Weather.Forecast(now, ahead, null), Scoring.Dials(), 10)

        assertTrue("did not name this afternoon: $text", text.contains("2pm"))
    }

    /* ---------------- the device's language is not ours --------------- */

    /**
     * Runs `body` as if the phone were set to `tag`, and puts the default
     * back whatever happens — a leaked default locale would quietly change
     * the meaning of every other test in the JVM.
     */
    private fun <T> asDeviceLocale(tag: String, body: () -> T): T {
        val previous = Locale.getDefault()
        Locale.setDefault(Locale.forLanguageTag(tag))
        return try {
            body()
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test
    fun `SMHI's URL carries decimal points on a Swedish device`() {
        // sv-SE writes 18,0690. SMHI answers that with a 404, Weather maps
        // the 404 to null, and the widget silently blends two sources where
        // the page blends three — on exactly the devices SMHI is for.
        val url = asDeviceLocale("sv-SE") { Weather.smhiUrl(59.3290, 18.0690) }
        assertTrue("locale-formatted coordinates in $url", !url.contains(","))
        assertTrue(url, url.endsWith("/geotype/point/lon/18.0690/lat/59.3290/data.json"))
    }

    @Test
    fun `the forecast cache key carries decimal points on a Swedish device`() {
        assertEquals(
            "59.329,18.069",
            asDeviceLocale("sv-SE") { Weather.cacheKey(59.3290, 18.0690) }
        )
    }

    @Test
    fun `changing the device language does not change the cache key`() {
        // The consequence that matters: two calls in different locales must
        // still name the same cached forecast.
        assertEquals(
            asDeviceLocale("en-US") { Weather.cacheKey(59.3290, 18.0690) },
            asDeviceLocale("sv-SE") { Weather.cacheKey(59.3290, 18.0690) }
        )
    }

    @Test
    fun `an Open-Meteo payload missing is_day degrades instead of throwing`() {
        Weather.forget()
        val om = JSONObject(File("../web/fixtures-om.json").readText())
        om.getJSONObject("hourly").remove("is_day")
        val f = Weather.fetch(59.329, 18.069, 4_000_000_000L, bodies(om.toString(), null, null))
        assertNotNull(f)
        assertEquals(23, f!!.now.hour)
    }
}
