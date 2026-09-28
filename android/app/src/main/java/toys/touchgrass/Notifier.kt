package toys.touchgrass

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Notifier {

    const val CHANNEL_NUDGE = "nudge"
    const val CHANNEL_WINDOW = "window"
    const val CHANNEL_ALARM = "window_alarm"

    private const val ID_NUDGE = 1001
    private const val ID_WINDOW = 1002
    const val ID_CHECKING = 1003
    private const val ID_AURORA = 1004

    fun ensureChannels(c: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = c.getSystemService(NotificationManager::class.java)

        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_NUDGE, "Daily reminder",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "A nudge if you haven't been outside yet today." }
        )

        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_WINDOW, "Good weather",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "When a genuinely good window opens up." }
        )

        // Separate channel, because a channel's importance can't be raised
        // after it's created — the loud one has to be its own thing.
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ALARM, "Good weather (alarm)",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Rings when a rare good window opens up."
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                enableVibration(true)
            }
        )
    }

    private fun openApp(c: Context): PendingIntent {
        val i = Intent(c, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun post(c: Context, id: Int, n: Notification) {
        // Posting without permission throws on API 33+; the check keeps a
        // missing permission from taking the whole worker down.
        try {
            if (NotificationManagerCompat.from(c).areNotificationsEnabled()) {
                NotificationManagerCompat.from(c).notify(id, n)
            }
        } catch (_: SecurityException) {
        }
    }

    fun nudge(c: Context, text: String) {
        ensureChannels(c)
        post(
            c, ID_NUDGE,
            NotificationCompat.Builder(c, CHANNEL_NUDGE)
                .setSmallIcon(R.drawable.ic_stat_grass)
                .setContentTitle("Still inside?")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp(c))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
        )
    }

    fun aurora(c: Context, text: String) {
        ensureChannels(c)
        post(
            c, ID_AURORA,
            NotificationCompat.Builder(c, CHANNEL_WINDOW)
                .setSmallIcon(R.drawable.ic_stat_grass)
                .setContentTitle("Aurora likely now")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp(c))
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
        )
    }

    /** Opening the app answers whatever these were saying. */
    fun clearAll(c: Context) {
        NotificationManagerCompat.from(c).cancel(ID_NUDGE)
        NotificationManagerCompat.from(c).cancel(ID_WINDOW)
        NotificationManagerCompat.from(c).cancel(ID_AURORA)
    }

    /**
     * Before Android 12, expedited work runs as a foreground service and
     * needs a notification for the few seconds it takes. Quiet and brief.
     */
    fun checking(c: Context): Notification {
        ensureChannels(c)
        return NotificationCompat.Builder(c, CHANNEL_NUDGE)
            .setSmallIcon(R.drawable.ic_stat_grass)
            .setContentTitle("Checking the weather")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .build()
    }

    fun window(c: Context, title: String, text: String, loud: Boolean) {
        ensureChannels(c)
        val channel = if (loud) CHANNEL_ALARM else CHANNEL_WINDOW
        val b = NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_grass)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openApp(c))
            .setAutoCancel(true)
            .setCategory(if (loud) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (loud) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)

        if (loud) {
            b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
            b.setVibrate(longArrayOf(0, 400, 200, 400))
        }

        post(c, ID_WINDOW, b.build())
    }
}
