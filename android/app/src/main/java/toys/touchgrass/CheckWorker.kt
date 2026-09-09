package toys.touchgrass

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.util.Calendar
import java.util.Locale

/**
 * The hourly background check.
 *
 * Two jobs, and both are deliberately stingy about interrupting you:
 *
 *  - the daily nudge, once, only if the day is still empty, at either a
 *    fixed time or a chosen stretch before sunset;
 *  - the opportunity alert, once a day at most, only inside your waking
 *    hours, and only for weather that clears a bar you set higher than
 *    your everyday one.
 *
 * Scoring runs the web app's own scoring.js through Rhino, so the app and
 * the pages can never disagree about what counts as good weather.
 */
class CheckWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    companion object {
        const val FORCE = "force"

        /**
         * Whether `h` still falls today.
         *
         * `ahead` reaches into tomorrow morning, and both jobs here only run
         * while the day is still owed — the same condition under which
         * tgDecide refuses to look past midnight. Without this the widget
         * says "go out anyways" while the notification built from the very
         * same forecast says "6am looks better". One predicate, so the two
         * callers cannot drift apart.
         */
        internal fun stillToday(h: Scoring.Hour, nowHour: Int) =
            nowHour + h.hoursFromNow < 24

        /**
         * The nudge's wording, with the dials and the clock passed in so it
         * can be read without a Context.
         */
        internal fun nudgeText(
            f: Weather.Forecast?,
            dials: Scoring.Dials,
            nowHour: Int
        ): String {
            if (f == null) return "You haven't been out yet today. There's still time."

            val nowScore = Scoring.score(f.now, dials)
            val best = f.ahead
                .filter { !Scoring.isRisky(it) }
                .filter { stillToday(it, nowHour) }
                .maxByOrNull { Scoring.score(it, dials) }
            val bestScore = best?.let { Scoring.score(it, dials) } ?: 0

            return when {
                nowScore >= dials.bar ->
                    "It's $nowScore/100 out there right now. Go on — even ten minutes counts."
                best != null && bestScore >= dials.bar && bestScore > nowScore + 12 ->
                    "Not much out there now, but ${best.label} looks better ($bestScore/100). " +
                        "That's your window."
                else ->
                    "Today never really gets good, which makes now as fine a time as any. " +
                        "Coat on, twenty minutes."
            }
        }
    }

    override suspend fun doWork(): Result {
        val c = applicationContext
        Scoring.init {
            Scoring.join(
                c.assets.open("scoring.js").bufferedReader().use { it.readText() },
                c.assets.open("blend.js").bufferedReader().use { it.readText() }
            )
        }

        val cal = Calendar.getInstance()
        val today = String.format(
            Locale.US, "%d-%02d-%02d",
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH)
        )
        val nowHour = cal.get(Calendar.HOUR_OF_DAY)
        val nowMinutes = nowHour * 60 + cal.get(Calendar.MINUTE)

        // A test run from the settings screen: send the nudge you would
        // actually get, real weather and all, ignoring time of day and
        // the once-a-day guard.
        if (inputData.getBoolean(FORCE, false)) {
            val f = if (Prefs.hasPlace(c)) Weather.fetch(Prefs.lat(c), Prefs.lon(c)) else null
            Notifier.nudge(c, nudgeText(c, f, nowHour))
            return Result.success()
        }

        val visits = Prefs.visitsOn(c, today)
        val wantNudge = Prefs.remindersOn(c) && !Prefs.alreadyNudged(c, today) && visits == 0
        val wantWatch = Prefs.watchOn(c) && !Prefs.alreadyAlerted(c, today) && visits == 0
        val widgetLive = Widget.hasAny(c)

        if (!wantNudge && !wantWatch && !widgetLive) return Result.success()

        // The alert never fires outside your waking hours. Checked before
        // anything is fetched — this is what stops an alarm at 3am.
        val watchNow = wantWatch && Prefs.hasPlace(c) && inWindow(c, nowHour)

        // One fetch serves both jobs: the nudge needs it for its wording
        // (and for sunset, if timing is set that way), the alert for the
        // forecast itself.
        val forecast = if (Prefs.hasPlace(c) && (wantNudge || watchNow || widgetLive)) {
            Weather.fetch(Prefs.lat(c), Prefs.lon(c)) ?: return Result.retry()
        } else {
            null
        }

        // Refresh the widget from the same verdict the app would show.
        if (forecast != null) updateWidget(c, forecast, visits)

        if (wantNudge) {
            val due = Prefs.reminderDueMinutes(c, forecast?.sunsetMinutes)
            if (nowMinutes >= due) {
                Notifier.nudge(c, nudgeText(c, forecast, nowHour))
                Prefs.markNudged(c, today)
            }
        }

        if (watchNow && forecast != null) checkForAWindow(c, today, nowHour, forecast)

        return Result.success()
    }

    /* ---------------------------------------------------------------- */

    private fun checkForAWindow(
        c: Context,
        today: String,
        nowHour: Int,
        forecast: Weather.Forecast
    ) {
        val dials = Prefs.dials(c)
        val great = Prefs.greatBar(c)
        val nowScore = Scoring.score(forecast.now, dials)

        // Right now is already good enough — the best case, so say so.
        if (!Scoring.isRisky(forecast.now) && nowScore >= great) {
            Notifier.window(
                c,
                "It's good out right now",
                "$nowScore/100 out there — better than you'll usually get. " +
                    "This is the one. Shoes, door.",
                Prefs.alarmStyle(c)
            )
            Prefs.markAlerted(c, today)
            return
        }

        val best = forecast.ahead
            .filter { !Scoring.isRisky(it) }
            .filter { inWindow(c, it.hour) }
            .filter { stillToday(it, nowHour) }
            .maxByOrNull { Scoring.score(it, dials) }
            ?: return

        val score = Scoring.score(best, dials)
        if (score >= great && score >= nowScore + 12) {
            Notifier.window(
                c,
                "A good window is coming",
                "${best.label} looks properly good — $score/100, " +
                    "against $nowScore right now. Worth planning around.",
                Prefs.alarmStyle(c)
            )
            Prefs.markAlerted(c, today)
        }
    }

    private fun updateWidget(c: Context, f: Weather.Forecast, visits: Int) {
        val dials = Prefs.dials(c)
        val v = Scoring.decide(f.now, f.ahead, visits, dials)
        val t = Scoring.trends(f.now, f.ahead, dials)
        Prefs.saveWidget(
            c,
            WidgetState(
                score = v.score,
                state = v.state,
                targetLabel = v.targetLabel,
                place = Prefs.placeLabel(c),
                outlook = t?.outlook?.mood,
                best = t?.best ?: 0,
                tempDir = t?.temp?.dir,
                rainDir = t?.rain?.dir,
                windDir = t?.wind?.dir,
                code = f.now.code,
                tempC = f.now.feels,
                windKmh = f.now.wind,
                pop = f.now.pop.toInt(),
                sunsetMinutes = f.sunsetMinutes
            ).toJson()
        )
        Widget.refreshAll(c)
    }

    private fun inWindow(c: Context, hour: Int) =
        hour >= Prefs.windowStart(c) && hour < Prefs.windowEnd(c)

    private fun nudgeText(c: Context, f: Weather.Forecast?, nowHour: Int): String =
        nudgeText(f, Prefs.dials(c), nowHour)
}
