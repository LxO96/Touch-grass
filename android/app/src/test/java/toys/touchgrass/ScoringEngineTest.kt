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

    // Rhino must see the twilight flag and the dial, or the widget would
    // punish dusk as night while the page does not.
    @Test
    fun `dusk is not punished as dark through Rhino at the default dial`() {
        val dusk = Scoring.Hour(hour = 20, feels = 13.0, pop = 40.0, precip = 0.0,
            wind = 8.0, isDay = false, code = 2, twilight = "dusk")
        val light = dusk.copy(isDay = true, twilight = null)
        assertEquals(Scoring.score(light, Scoring.Dials()), Scoring.score(dusk, Scoring.Dials()))
    }

    @Test
    fun `the dusk dial reaches Rhino`() {
        val dusk = Scoring.Hour(hour = 20, feels = 13.0, pop = 40.0, precip = 0.0,
            wind = 8.0, isDay = false, code = 2, twilight = "dusk")
        assertEquals(10,
            Scoring.score(dusk, Scoring.Dials(twilight = 2.0)) -
                Scoring.score(dusk, Scoring.Dials(twilight = 1.0)))
    }

    @Test
    fun `the verdict sees twilight too`() {
        // tgDecide gets hours as JSON; a dusk hour must arrive as dusk.
        val now = Scoring.Hour(hour = 19, feels = 13.0, pop = 90.0, precip = 2.0,
            wind = 8.0, isDay = true, code = 63)
        // Comfortable, dry, calm: 100 unless it is wrongly scored as night (62).
        val dusk = Scoring.Hour(hour = 20, feels = 20.0, pop = 0.0, precip = 0.0,
            wind = 5.0, isDay = false, code = 0, twilight = "dusk", hoursFromNow = 1, label = "8pm")
        val v = Scoring.decide(now, listOf(dusk), 0, Scoring.Dials())
        assertEquals(100, v.targetScore)
    }

    // The ratings must reach Rhino, or the widget scores a grey sky with
    // the defaults while the page uses yours.
    @Test
    fun `sky ratings reach Rhino`() {
        val grey = Scoring.Hour(hour = 14, feels = 20.0, pop = 0.0, precip = 0.0,
            wind = 5.0, isDay = true, code = 3)
        assertEquals(90, Scoring.score(grey, Scoring.Dials()))
        assertEquals(100, Scoring.score(grey, Scoring.Dials(sky = mapOf("overcast" to 0))))
        assertEquals(65, Scoring.score(grey, Scoring.Dials(sky = mapOf("overcast" to 4))))
    }

    // A first must reach Rhino, or the widget would miss the first snow
    // of the season that the page celebrates.
    @Test
    fun `a first earns its bonus through Rhino, and can be switched off`() {
        val wet = Scoring.Hour(hour = 14, feels = 14.0, pop = 60.0, precip = 0.0,
            wind = 5.0, isDay = true, code = 63)
        val first = wet.copy(novelty = "rain", noveltyDays = 16)
        assertEquals(15, Scoring.score(first, Scoring.Dials()) - Scoring.score(wet, Scoring.Dials()))
        assertEquals(Scoring.score(wet, Scoring.Dials()),
            Scoring.score(first, Scoring.Dials(novelty = false)))
    }

    @Test
    fun `a likely aurora earns its bonus through Rhino, and can be switched off`() {
        val dark = Scoring.Hour(hour = 22, feels = 18.0, pop = 0.0, precip = 0.0,
            wind = 5.0, isDay = false, code = 0)
        val likely = dark.copy(aurora = "likely", auroraSource = "kp", auroraValue = 5.0)
        val possible = dark.copy(aurora = "possible", auroraSource = "kp", auroraValue = 3.5)
        assertEquals(20, Scoring.score(likely, Scoring.Dials()) - Scoring.score(dark, Scoring.Dials()))
        assertEquals(10, Scoring.score(possible, Scoring.Dials()) - Scoring.score(dark, Scoring.Dials()))
        assertEquals(Scoring.score(dark, Scoring.Dials()),
            Scoring.score(likely, Scoring.Dials(aurora = false)))
    }

    @Test
    fun `Kp reaches the blend through Rhino and marks a dark clear hour`() {
        // Stockholm on a dark, clear evening: 21:00 local onwards, UTC+2.
        val hours = (0 until 8).map { "2026-09-28T${"%02d".format(21 + it - if (21 + it > 23) 24 else 0)}:00" }
            .mapIndexed { i, t -> if (i >= 3) t.replace("2026-09-28", "2026-09-29") else t }
        fun col(v: Any) = hours.joinToString(",", "[", "]") { "$v" }
        val om = """{"latitude":59.33,"longitude":18.07,"utc_offset_seconds":7200,
            "current":{"time":"2026-09-28T21:10"},
            "hourly":{"time":${hours.joinToString(",", "[", "]") { "\"$it\"" }},
              "is_day":${col(0)},"weather_code":${col(0)},"temperature_2m":${col(8)},
              "apparent_temperature":${col(6)},"precipitation_probability":${col(0)},
              "precipitation":${col(0)},"wind_speed_10m":${col(6)}},
            "daily":{"time":["2026-09-28"],"sunset":["2026-09-28T18:40"]}}"""
        val kp = """[{"time_tag":"2026-09-28T18:00:00","kp":6},{"time_tag":"2026-09-28T21:00:00","kp":6},
            {"time_tag":"2026-09-29T00:00:00","kp":6}]"""
        fun marked(json: String?): Int {
            val o = JSONObject(json!!)
            val rows = listOf(o.getJSONObject("now")) +
                (0 until o.getJSONArray("ahead").length()).map { o.getJSONArray("ahead").getJSONObject(it) }
            return rows.count { it.optString("aurora") == "likely" }
        }
        assertEquals(0, marked(Scoring.blend(om, null, null)))
        assertEquals(8, marked(Scoring.blend(om, null, null, kp)))
    }

    @Test
    fun `the aurora night runs from evening to the next morning`() {
        val z = java.util.TimeZone.getTimeZone("Europe/Stockholm")
        fun at(d: Int, h: Int) = java.util.Calendar.getInstance(z).apply {
            clear(); set(2026, 8, d, h, 0, 0)
        }.timeInMillis
        assertEquals("2026-09-28", NudgeTiming.auroraNight(at(28, 22), z))
        assertEquals("2026-09-28", NudgeTiming.auroraNight(at(29, 2), z))
        assertEquals("2026-09-29", NudgeTiming.auroraNight(at(29, 21), z))
    }

    @Test
    fun `the aurora alarm wakes at the start of the likely hour`() {
        val z = java.util.TimeZone.getTimeZone("Europe/Stockholm")
        val now = java.util.Calendar.getInstance(z).apply { clear(); set(2026, 8, 28, 20, 40, 0) }.timeInMillis
        val at = java.util.Calendar.getInstance(z).apply { timeInMillis = NudgeTiming.hourStart(now, 2, z) }
        assertEquals(22, at.get(java.util.Calendar.HOUR_OF_DAY))
        assertEquals(0, at.get(java.util.Calendar.MINUTE))
    }

    @Test
    fun `the aurora alert says which reading earned it`() {
        val h = Scoring.Hour(hour = 22, feels = 5.0, pop = 0.0, precip = 0.0,
            wind = 5.0, isDay = false, code = 0, aurora = "likely")
        assertTrue(CheckWorker.auroraText(h.copy(auroraSource = "kp", auroraValue = 5.0)).contains("Kp 5"))
        assertTrue(CheckWorker.auroraText(h.copy(auroraSource = "oval", auroraValue = 41.0)).contains("41% chance"))
    }
}
