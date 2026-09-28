package toys.touchgrass

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Home-screen widget: today's score, what to do about it, and the readings
 * behind it.
 *
 * The recommendation and the trends come from tgDecide()/tgTrends() in
 * scoring.js — the same functions the page uses — so the widget can never
 * contradict the app. Only the wording is its own, because a widget has
 * room for four words and the page has room for a paragraph.
 *
 * It grows with the space it is given: readings always, a log button once
 * there is room for one, and the recent weeks once there is room for those.
 */
class Widget : AppWidgetProvider() {

    override fun onUpdate(c: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) render(c, mgr, id)
        // updatePeriodMillis is capped at 30 minutes and doesn't run in doze,
        // so the worker is what really keeps this fresh.
        Scheduler.schedule(c)
    }

    override fun onEnabled(c: Context) {
        Scheduler.schedule(c)
    }

    /** Resized on the home screen: pick a layout that suits the new size. */
    override fun onAppWidgetOptionsChanged(
        c: Context,
        mgr: AppWidgetManager,
        id: Int,
        options: Bundle
    ) {
        render(c, mgr, id)
    }

    override fun onReceive(c: Context, intent: Intent) {
        if (intent.action == ACTION_LOG) {
            // The page owns the log and it isn't running, so note the trip
            // here and let the page fold it in the next time it opens.
            Prefs.addPendingVisit(c)
            refreshAll(c)
            return
        }
        super.onReceive(c, intent)
    }

    companion object {

        const val ACTION_LOG = "toys.touchgrass.LOG_VISIT"

        // Height in dp at which each extra piece earns its place, measured
        // against the height the widget really has (see render). Two rows
        // of a phone's grid fit the log button, three fit the weeks too.
        private const val MEDIUM_AT = 150
        private const val LARGE_AT = 280

        fun hasAny(c: Context): Boolean {
            val mgr = AppWidgetManager.getInstance(c) ?: return false
            val ids = mgr.getAppWidgetIds(ComponentName(c, Widget::class.java))
            return ids != null && ids.isNotEmpty()
        }

        fun refreshAll(c: Context) {
            val mgr = AppWidgetManager.getInstance(c) ?: return
            val ids = mgr.getAppWidgetIds(ComponentName(c, Widget::class.java)) ?: return
            for (id in ids) render(c, mgr, id)
        }

        private fun render(c: Context, mgr: AppWidgetManager, id: Int) {
            /* The launcher reports two sizes: MAX_HEIGHT is the widget's
               height in portrait, MIN_HEIGHT its height in landscape. Using
               MIN_HEIGHT on a portrait home screen sized the widget as
               barely half its real height, so a tall widget never got its
               heatmap and was mostly empty space. */
            val portrait = c.resources.configuration.orientation !=
                android.content.res.Configuration.ORIENTATION_LANDSCAPE
            val heightDp = try {
                mgr.getAppWidgetOptions(id)?.getInt(
                    if (portrait) AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT
                    else AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0
                ) ?: 0
            } catch (_: Exception) {
                0
            }

            val layout = when {
                heightDp >= LARGE_AT -> R.layout.widget_large
                heightDp >= MEDIUM_AT -> R.layout.widget_medium
                else -> R.layout.widget
            }

            val v = RemoteViews(c.packageName, layout)
            val s = WidgetStrings.of(Prefs.lang(c))
            val cached = Prefs.widgetCache(c)
            val visits = Prefs.visitsOn(c, todayKey()) + Prefs.pendingVisits(c)

            v.setTextViewText(R.id.w_score, cached?.score?.toString() ?: "--")
            v.setTextViewText(
                R.id.w_line,
                if (cached == null) s.tapToLog else s.line(cached.state, cached.targetLabel)
            )

            val visitLine = if (visits > 0) s.beenOut(visits) else s.notOut
            val place = cached?.place.orEmpty()
            v.setTextViewText(
                R.id.w_visits,
                if (place.isBlank()) visitLine else "$visitLine  ·  $place"
            )

            v.removeAllViews(R.id.w_readings)
            if (cached != null) addReadings(c, v, cached, s)

            if (layout != R.layout.widget) {
                v.setTextViewText(R.id.w_log, s.logATrip)
                v.setOnClickPendingIntent(R.id.w_log, logIntent(c))
            }

            if (layout == R.layout.widget_large) {
                v.removeAllViews(R.id.w_cal)
                addRecentWeeks(c, v)
            }

            // Tapping anywhere else opens the app.
            v.setOnClickPendingIntent(R.id.widget_root, openIntent(c))

            try {
                mgr.updateAppWidget(id, v)
            } catch (e: Exception) {
                // A widget that fails to draw just goes blank with no
                // explanation, which is a miserable thing to debug. Say why,
                // then fall back to the layout that is known to work.
                Log.e("TouchGrass", "widget update failed (layout=$layout, h=$heightDp)", e)
                if (layout != R.layout.widget) {
                    try {
                        mgr.updateAppWidget(id, minimal(c, cached, s, visitLine))
                    } catch (e2: Exception) {
                        Log.e("TouchGrass", "even the small layout failed", e2)
                    }
                }
            }
        }

        /** The simplest thing that can possibly draw. */
        private fun minimal(
            c: Context,
            cached: WidgetState?,
            s: WidgetStrings,
            visitLine: String
        ): RemoteViews {
            val v = RemoteViews(c.packageName, R.layout.widget)
            v.setTextViewText(R.id.w_score, cached?.score?.toString() ?: "--")
            v.setTextViewText(
                R.id.w_line,
                if (cached == null) s.tapToLog else s.line(cached.state, cached.targetLabel)
            )
            v.setTextViewText(R.id.w_visits, visitLine)
            v.setOnClickPendingIntent(R.id.widget_root, openIntent(c))
            return v
        }

        /* ---------------------------------------------------------- */

        private fun addReadings(
            c: Context,
            v: RemoteViews,
            w: WidgetState,
            s: WidgetStrings
        ) {
            fun chip(icon: Int, text: String) {
                val r = RemoteViews(c.packageName, R.layout.widget_readings)
                r.setImageViewResource(R.id.r_icon, icon)
                r.setTextViewText(R.id.r_value, text)
                v.addView(R.id.w_readings, r)
            }

            chip(skyIcon(w.code), s.skyWord(w.code))
            if (w.tempC != null) chip(R.drawable.ic_temp, temp(c, w.tempC) + arrow(w.tempDir))
            if (w.windKmh != null) chip(R.drawable.ic_wind, wind(c, w.windKmh) + arrow(w.windDir))
            if (w.pop != null) chip(R.drawable.ic_rain, "${w.pop}%" + arrow(w.rainDir))
            if (w.sunsetMinutes != null) chip(R.drawable.ic_sun, clock(w.sunsetMinutes))
        }

        /** Only mark a reading that is actually moving. */
        private fun arrow(dir: String?): String = when (dir) {
            "up" -> " ↑"
            "down" -> " ↓"
            else -> ""
        }

        private fun temp(c: Context, celsius: Double): String =
            if (Prefs.unitTemp(c) == "f") "${(celsius * 9 / 5 + 32).roundToInt()}°F"
            else "${celsius.roundToInt()}°C"

        private fun wind(c: Context, kmh: Double): String = when (Prefs.unitWind(c)) {
            "ms" -> String.format(Locale.US, "%.1f m/s", kmh / 3.6)
            "mph" -> "${(kmh / 1.609344).roundToInt()} mph"
            else -> "${kmh.roundToInt()} km/h"
        }

        private fun clock(minutes: Int): String =
            String.format(Locale.US, "%02d:%02d", minutes / 60, minutes % 60)

        private fun skyIcon(code: Int?): Int = when (code) {
            null -> R.drawable.ic_w_cloud
            0 -> R.drawable.ic_w_clear
            1, 2 -> R.drawable.ic_w_partly
            45, 48 -> R.drawable.ic_w_fog
            71, 73, 75, 77, 85, 86 -> R.drawable.ic_w_snow
            95, 96, 99 -> R.drawable.ic_w_storm
            in 51..67 -> R.drawable.ic_w_rain
            in 80..82 -> R.drawable.ic_w_rain
            else -> R.drawable.ic_w_cloud
        }

        /** The last five weeks, Monday-first, as a small heatmap. */
        private fun addRecentWeeks(c: Context, v: RemoteViews) {
            val log = Prefs.logSnapshot(c)
            val cursor = Calendar.getInstance()
            // Wind back to this week's Monday, then back four more weeks.
            val backToMonday = (cursor.get(Calendar.DAY_OF_WEEK) + 5) % 7
            cursor.add(Calendar.DAY_OF_MONTH, -backToMonday - 28)

            val todayK = todayKey()
            repeat(5) {
                val row = RemoteViews(c.packageName, R.layout.widget_cal_row)
                repeat(7) {
                    val key = keyOf(cursor)
                    val n = log[key] ?: 0
                    val cell = RemoteViews(c.packageName, R.layout.widget_cal_cell)
                    // Today gets an outline, but keeps its shade — otherwise
                    // the one day you care most about hides its own count.
                    val today = key == todayK
                    cell.setInt(
                        R.id.cell, "setBackgroundResource",
                        when {
                            n >= 3 -> if (today) R.drawable.day_today_lv3 else R.drawable.day_lv3
                            n == 2 -> if (today) R.drawable.day_today_lv2 else R.drawable.day_lv2
                            n == 1 -> if (today) R.drawable.day_today_lv1 else R.drawable.day_lv1
                            else -> if (today) R.drawable.day_today else R.drawable.day_lv0
                        }
                    )
                    row.addView(R.id.cal_row, cell)
                    cursor.add(Calendar.DAY_OF_MONTH, 1)
                }
                v.addView(R.id.w_cal, row)
            }
        }

        private fun openIntent(c: Context): PendingIntent {
            val i = Intent(c, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            return PendingIntent.getActivity(
                c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun logIntent(c: Context): PendingIntent {
            val i = Intent(c, Widget::class.java).setAction(ACTION_LOG)
            return PendingIntent.getBroadcast(
                c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun keyOf(cal: Calendar) = String.format(
            Locale.US, "%d-%02d-%02d",
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH)
        )

        private fun todayKey() = keyOf(Calendar.getInstance())
    }
}

/* ==========================================================
   The short wording. Mirrors lang.js `widget`, kept here
   because a background process can't read the page's bundle.
   ========================================================== */

class WidgetStrings(
    val tapToLog: String,
    val notOut: String,
    val logATrip: String,
    private val beenOutOnce: String,
    private val beenOutMany: (Int) -> String,
    private val lines: Map<String, (String?) -> String>,
    private val sky: Map<String, String>
) {
    fun beenOut(n: Int) = if (n == 1) beenOutOnce else beenOutMany(n)

    fun line(state: String, target: String?): String =
        (lines[state] ?: lines["anyways"]!!)(target)

    /** A one-word sky, since the icon carries most of the meaning. */
    fun skyWord(code: Int?): String = when (code) {
        null -> ""
        0, 1 -> sky.getValue("clear")
        2, 3 -> sky.getValue("cloudy")
        45, 48 -> sky.getValue("fog")
        71, 73, 75, 77, 85, 86 -> sky.getValue("snow")
        95, 96, 99 -> sky.getValue("storm")
        in 51..57 -> sky.getValue("drizzle")
        in 61..67 -> sky.getValue("rain")
        in 80..82 -> sky.getValue("rain")
        else -> sky.getValue("cloudy")
    }

    companion object {
        fun of(lang: String): WidgetStrings = if (lang == "sv") sv() else en()

        private fun en() = WidgetStrings(
            tapToLog = "Tap to log a trip",
            notOut = "Not out yet today",
            logATrip = "+ I WENT OUT",
            beenOutOnce = "Out once today",
            beenOutMany = { n -> "Out $n times today" },
            lines = mapOf(
                "go" to { _ -> "Go outside" },
                "goAgain" to { _ -> "Go out again" },
                "wait" to { t -> "Wait — go at ${t ?: "later"}" },
                "waitAgain" to { t -> "Optional — ${t ?: "later"} looks good" },
                "waitDark" to { t -> "Go when it's light, ${t ?: "later"}" },
                "waitNight" to { t -> if (t != null) "Go later — $t" else "Go later today" },
                "waitRisky" to { t -> "Not yet — try ${t ?: "later"}" },
                "waitRiskyNoGap" to { _ -> "Wait for a gap" },
                "anywaysBest" to { t -> "Go anyway — ${t ?: "now"} is least bad" },
                "anyways" to { _ -> "Go out anyways" },
                "stayin" to { _ -> "Stay in. You've earned it." }
            ),
            sky = mapOf(
                "clear" to "Clear", "cloudy" to "Cloudy", "fog" to "Fog",
                "drizzle" to "Drizzle", "rain" to "Rain", "snow" to "Snow",
                "storm" to "Storm"
            )
        )

        private fun sv() = WidgetStrings(
            tapToLog = "Tryck för att notera en tur",
            notOut = "Inte ute än idag",
            logATrip = "+ JAG VAR UTE",
            beenOutOnce = "Ute en gång idag",
            beenOutMany = { n -> "Ute $n gånger idag" },
            lines = mapOf(
                "go" to { _ -> "Gå ut" },
                "goAgain" to { _ -> "Gå ut igen" },
                "wait" to { t -> "Vänta — gå ${t ?: "senare"}" },
                "waitAgain" to { t -> "Frivilligt — ${t ?: "senare"} ser fint ut" },
                "waitDark" to { t -> "Gå när det är ljust, ${t ?: "senare"}" },
                "waitNight" to { t -> if (t != null) "Gå senare — $t" else "Gå senare idag" },
                "waitRisky" to { t -> "Inte än — prova ${t ?: "senare"}" },
                "waitRiskyNoGap" to { _ -> "Vänta på en lucka" },
                "anywaysBest" to { t -> "Gå ändå — ${t ?: "nu"} är minst dålig" },
                "anyways" to { _ -> "Gå ut ändå" },
                "stayin" to { _ -> "Stanna inne. Du förtjänar det." }
            ),
            sky = mapOf(
                "clear" to "Klart", "cloudy" to "Molnigt", "fog" to "Dimma",
                "drizzle" to "Duggregn", "rain" to "Regn", "snow" to "Snö",
                "storm" to "Åska"
            )
        )
    }
}

/** What the widget draws, computed once and cached. */
data class WidgetState(
    val score: Int,
    val state: String,
    val targetLabel: String?,
    val place: String,
    val outlook: String? = null,
    val best: Int = 0,
    val tempDir: String? = null,
    val rainDir: String? = null,
    val windDir: String? = null,
    // The readings themselves, always metric — formatted per the unit setting.
    val code: Int? = null,
    val tempC: Double? = null,
    val windKmh: Double? = null,
    val pop: Int? = null,
    val sunsetMinutes: Int? = null
) {
    fun toJson(): String = JSONObject()
        .put("score", score)
        .put("state", state)
        .put("target", targetLabel ?: JSONObject.NULL)
        .put("place", place)
        .put("outlook", outlook ?: JSONObject.NULL)
        .put("best", best)
        .put("tempDir", tempDir ?: JSONObject.NULL)
        .put("rainDir", rainDir ?: JSONObject.NULL)
        .put("windDir", windDir ?: JSONObject.NULL)
        .put("code", code ?: JSONObject.NULL)
        .put("tempC", tempC ?: JSONObject.NULL)
        .put("windKmh", windKmh ?: JSONObject.NULL)
        .put("pop", pop ?: JSONObject.NULL)
        .put("sunset", sunsetMinutes ?: JSONObject.NULL)
        .toString()

    companion object {
        fun fromJson(s: String): WidgetState? = try {
            val o = JSONObject(s)
            WidgetState(
                score = o.getInt("score"),
                state = o.getString("state"),
                targetLabel = o.str("target"),
                place = o.optString("place", ""),
                outlook = o.str("outlook"),
                best = o.optInt("best", 0),
                tempDir = o.str("tempDir"),
                rainDir = o.str("rainDir"),
                windDir = o.str("windDir"),
                code = o.num("code")?.toInt(),
                tempC = o.num("tempC"),
                windKmh = o.num("windKmh"),
                pop = o.num("pop")?.toInt(),
                sunsetMinutes = o.num("sunset")?.toInt()
            )
        } catch (_: Exception) {
            null
        }

        private fun JSONObject.str(key: String): String? =
            if (isNull(key)) null else optString(key, null)

        private fun JSONObject.num(key: String): Double? =
            if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }
    }
}
