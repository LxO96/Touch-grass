package toys.touchgrass

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * WorkManager normally restores its own jobs after a reboot, but not on
 * every OEM build. Re-asserting the schedule is cheap insurance for a
 * feature whose whole point is firing without being opened.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.MY_PACKAGE_REPLACED"
        ) {
            Scheduler.sync(context)
        }
    }
}
