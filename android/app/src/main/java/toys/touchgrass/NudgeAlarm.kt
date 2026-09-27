package toys.touchgrass

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.AlarmManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import java.util.TimeZone

/**
 * The daily nudge's own alarm.
 *
 * `setAndAllowWhileIdle` fires through Doze without the exact-alarm
 * permission — within minutes of the time rather than to the second, which
 * is all a "still inside?" needs — and, unlike the hourly check, is not held
 * back until the app is next opened.
 *
 * Re-armed from Scheduler.sync (app open, any settings change, boot) and at
 * the end of every check, so it always points at the next nudge owed.
 */
object NudgeAlarm {

    private const val REQUEST = 4201

    private fun pending(c: Context): PendingIntent = PendingIntent.getBroadcast(
        c, REQUEST, Intent(c, NudgeReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    fun arm(c: Context) {
        val am = c.getSystemService(AlarmManager::class.java) ?: return
        if (!Prefs.remindersOn(c)) {
            am.cancel(pending(c))
            return
        }

        val zone = TimeZone.getDefault()
        val now = System.currentTimeMillis()
        val today = NudgeTiming.dayKey(now, zone)
        // Sunset comes from the last forecast the widget saw; if there is
        // none yet the clock time stands in, and the next check re-arms.
        val due = Prefs.reminderDueMinutes(c, Prefs.widgetCache(c)?.sunsetMinutes)
        val owed = !Prefs.alreadyNudged(c, today) && Prefs.visitsOn(c, today) == 0

        AlarmManagerCompat.setAndAllowWhileIdle(
            am, AlarmManager.RTC_WAKEUP,
            NudgeTiming.nextTrigger(now, due, owed, zone),
            pending(c)
        )
    }
}

/**
 * The alarm going off. The work itself — a weather fetch and a notification —
 * runs as expedited work, which the alarm's brief allowance lets start even
 * in Doze.
 */
class NudgeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "touchgrass-nudge",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<CheckWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
        )
    }
}
