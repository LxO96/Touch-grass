package toys.touchgrass

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * The trip buzzes: buzz and pause lengths in ms, with a strength 0–255
 * for each (0 = pause). The page's BUZZ in core.js is the source; the
 * widget's copies are checked against it by BuzzTest.
 */
object Buzz {
    class Pattern(val ms: LongArray, val strength: IntArray)

    // A fanfare, ta-ta-ta TAAA, ta-TAAAA!
    val FIRST = Pattern(
        longArrayOf(50, 40, 50, 40, 50, 40, 200, 90, 60, 40, 340),
        intArrayOf(150, 0, 150, 0, 150, 0, 230, 0, 180, 0, 255),
    )

    // Ba-da-DUM, louder each time.
    val AGAIN = Pattern(
        longArrayOf(35, 60, 35, 60, 140),
        intArrayOf(90, 0, 160, 0, 255),
    )

    // The year page's press-and-hold: one short tap at the phone's own strength.
    val HOLD = Pattern(longArrayOf(25), intArrayOf(VibrationEffect.DEFAULT_AMPLITUDE))

    fun forTrip(before: Int): Pattern = if (before <= 0) FIRST else AGAIN

    /**
     * [background] is for the widget: the app isn't open then, and Android
     * drops an ordinary buzz from a background app ("ignored_background"),
     * but lets a notification's through.
     */
    fun play(c: Context, p: Pattern, background: Boolean = false) {
        try {
            val v = if (Build.VERSION.SDK_INT >= 31) {
                c.getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                c.getSystemService(Vibrator::class.java)
            }
            // Android's waveform starts with a pause, so lead with none.
            val timings = longArrayOf(0) + p.ms
            if (Build.VERSION.SDK_INT >= 26) {
                val effect = if (v?.hasAmplitudeControl() == true) {
                    VibrationEffect.createWaveform(timings, intArrayOf(0) + p.strength, -1)
                } else {
                    VibrationEffect.createWaveform(timings, -1)
                }
                when {
                    !background -> v?.vibrate(effect)
                    Build.VERSION.SDK_INT >= 33 -> v?.vibrate(effect,
                        VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION))
                    else -> @Suppress("DEPRECATION") v?.vibrate(effect,
                        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).build())
                }
            } else {
                @Suppress("DEPRECATION")
                v?.vibrate(timings, -1)
            }
        } catch (_: Exception) {
        }
    }
}
