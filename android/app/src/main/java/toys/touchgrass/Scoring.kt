package toys.touchgrass

import org.mozilla.javascript.Context as RhinoContext
import org.mozilla.javascript.Function as RhinoFunction
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.ScriptableObject

/**
 * The score, evaluated by running the web app's own `scoring.js`.
 *
 * The background worker can't reach the WebView, but it doesn't need to:
 * Rhino is a plain-Java JavaScript engine, so the worker loads the exact
 * same file the pages load. There is one definition of what "good
 * weather" means, and no Kotlin copy of the formula to drift away from
 * it.
 *
 * Rhino must run interpreted on Android — it can't generate bytecode
 * there — hence the optimisation level below.
 */
object Scoring {

    data class Dials(
        val rain: Double = 1.0,
        val cold: Double = 1.0,
        val heat: Double = 1.0,
        val wind: Double = 1.0,
        val dark: Double = 1.0,
        val bar: Int = 60
    )

    data class Hour(
        val hour: Int,
        val feels: Double,
        val pop: Double,
        val precip: Double,
        val wind: Double,
        val isDay: Boolean,
        val code: Int,
        val hoursFromNow: Int = 0,
        val label: String = ""
    )

    /**
     * Reads the shared JS: scoring.js and blend.js, concatenated,
     * scoring.js first (blend.js depends on tgNum). Supplied by the app;
     * swapped for the web/ files directly in tests.
     */
    fun interface Source {
        fun read(): String
    }

    /**
     * The shared JS files, in evaluation order, separated so they cannot
     * run into each other. Plain concatenation worked only because
     * scoring.js happens to end in a newline; the day one of these files
     * ends in a `//` comment it would swallow the next file's first line,
     * silently, with the error surfacing somewhere else entirely.
     */
    fun join(vararg parts: String): String = parts.joinToString("\n;\n")

    private var scope: ScriptableObject? = null
    private var source: Source? = null

    // Filled in from scoring.js so the two can't disagree about safety either.
    var tooHot = 38.0; private set
    var tooCold = -15.0; private set

    fun init(src: Source) {
        if (source == null) source = src
    }

    private fun scope(): ScriptableObject {
        scope?.let { return it }

        val js = requireNotNull(source) { "Scoring.init() was never called" }.read()
        val cx = RhinoContext.enter()
        try {
            // Android has no bytecode generation available to Rhino.
            cx.optimizationLevel = -1
            val s = cx.initSafeStandardObjects()
            cx.evaluateString(s, js, "scoring.js", 1, null)

            tooHot = numberOf(s, "TOO_HOT", 38.0)
            tooCold = numberOf(s, "TOO_COLD", -15.0)

            scope = s
            return s
        } finally {
            RhinoContext.exit()
        }
    }

    private fun numberOf(s: Scriptable, name: String, fallback: Double): Double {
        val v = ScriptableObject.getProperty(s, name)
        return if (v is Number) v.toDouble() else fallback
    }

    private fun <T> call(fn: String, args: Array<Any?>, coerce: (Any?) -> T): T {
        val s = scope()
        val cx = RhinoContext.enter()
        try {
            cx.optimizationLevel = -1
            val f = ScriptableObject.getProperty(s, fn) as RhinoFunction
            return coerce(f.call(cx, s, s, args))
        } finally {
            RhinoContext.exit()
        }
    }

    fun score(h: Hour, d: Dials): Int = call(
        "tgScoreArgs",
        arrayOf(
            h.hour, h.feels, h.pop, h.precip, h.wind, h.isDay, h.code,
            d.rain, d.cold, d.heat, d.wind, d.dark
        )
    ) { RhinoContext.toNumber(it).toInt() }

    fun isRisky(h: Hour): Boolean = call(
        "tgIsRiskyArgs", arrayOf(h.feels, h.code)
    ) { RhinoContext.toBoolean(it) }

    fun isDeepNight(hour: Int): Boolean = call(
        "tgIsDeepNight", arrayOf<Any?>(hour)
    ) { RhinoContext.toBoolean(it) }

    /** The blend, evaluated by the web app's own blend.js. */
    fun blend(omJson: String?, metJson: String?, smhiJson: String?): String? =
        call(
            "tgForecastJson",
            arrayOf<Any?>(omJson, metJson, smhiJson)
        ) { RhinoContext.toString(it) }
            .takeIf { it != "null" && it.isNotBlank() }

    /** One outcome, decided by the same tgDecide() the page uses. */
    data class Verdict(
        val state: String,
        val score: Int,
        val targetLabel: String?,
        val targetHours: Int,
        val targetScore: Int
    )

    /**
     * Hands the forecast over as JSON rather than building a JS object
     * graph field by field — far less to get wrong, and the arrays cross
     * the boundary in one piece.
     */
    fun decide(now: Hour, ahead: List<Hour>, visits: Int, d: Dials): Verdict {
        val nowJson = hourJson(now)
        val aheadJson = ahead.joinToString(",", "[", "]") { hourJson(it) }
        val raw = call(
            "tgDecideJson",
            arrayOf<Any?>(nowJson, aheadJson, visits, dialsJson(d))
        ) { RhinoContext.toString(it) }

        val o = org.json.JSONObject(raw)
        val target = o.optJSONObject("target")
        return Verdict(
            state = o.optString("state", "anyways"),
            score = o.optInt("score", 0),
            targetLabel = target?.optString("label"),
            targetHours = target?.optInt("hoursFromNow", 0) ?: 0,
            targetScore = target?.optInt("score", 0) ?: 0
        )
    }

    /** One trend reading: which way, and whether that is good news. */
    data class Move(val dir: String, val mood: String)

    data class Trends(
        val kind: String,
        val outlook: Move,
        val best: Int,
        val temp: Move,
        val rain: Move,
        val wind: Move
    )

    /** Where the day is heading, from the same tgTrends() the page uses. */
    fun trends(now: Hour, ahead: List<Hour>, d: Dials): Trends? {
        if (ahead.isEmpty()) return null

        val raw = call(
            "tgTrendsJson",
            arrayOf<Any?>(hourJson(now), ahead.joinToString(",", "[", "]") { hourJson(it) }, dialsJson(d))
        ) { RhinoContext.toString(it) }

        if (raw.isBlank() || raw == "null") return null

        return try {
            val o = org.json.JSONObject(raw)
            Trends(
                kind = o.optString("kind", "restOfToday"),
                outlook = move(o.optJSONObject("outlook")),
                best = o.optJSONObject("outlook")?.optInt("best", 0) ?: 0,
                temp = move(o.optJSONObject("temp")),
                rain = move(o.optJSONObject("rain")),
                wind = move(o.optJSONObject("wind"))
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun move(o: org.json.JSONObject?): Move =
        Move(o?.optString("dir", "flat") ?: "flat", o?.optString("mood", "same") ?: "same")

    private fun dialsJson(d: Dials): String =
        """{"rain":${d.rain},"cold":${d.cold},"heat":${d.heat},""" +
        """"wind":${d.wind},"dark":${d.dark},"bar":${d.bar}}"""

    private fun hourJson(h: Hour): String =
        """{"hour":${h.hour},"feels":${h.feels},"pop":${h.pop},"precip":${h.precip},""" +
        """"wind":${h.wind},"isDay":${h.isDay},"code":${h.code},""" +
        """"hoursFromNow":${h.hoursFromNow},"label":${quote(h.label)}}"""

    private fun quote(s: String): String = org.json.JSONObject.quote(s)
}
