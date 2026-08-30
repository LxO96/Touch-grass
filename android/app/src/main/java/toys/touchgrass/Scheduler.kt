package toys.touchgrass

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object Scheduler {

    private const val WORK = "touchgrass-check"

    /**
     * One check an hour. WorkManager batches this with other deferred work,
     * so it costs very little, and the worker itself bails out in a few
     * microseconds when there's nothing switched on.
     */
    fun schedule(c: Context) {
        val req = PeriodicWorkRequestBuilder<CheckWorker>(1, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()

        WorkManager.getInstance(c).enqueueUniquePeriodicWork(
            WORK,
            // KEEP would ignore a changed schedule; UPDATE keeps the existing
            // run history while picking up any changes.
            ExistingPeriodicWorkPolicy.UPDATE,
            req
        )
    }

    fun cancel(c: Context) {
        WorkManager.getInstance(c).cancelUniqueWork(WORK)
    }

    /** Fires one nudge right now, so you can see what it looks like. */
    fun testNow(c: Context) {
        WorkManager.getInstance(c).enqueue(
            OneTimeWorkRequestBuilder<CheckWorker>()
                .setInputData(Data.Builder().putBoolean(CheckWorker.FORCE, true).build())
                .build()
        )
    }

    /** Called whenever the page changes what it wants. */
    fun sync(c: Context) {
        if (Prefs.remindersOn(c) || Prefs.watchOn(c)) schedule(c) else cancel(c)
    }
}
