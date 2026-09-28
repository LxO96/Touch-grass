package toys.touchgrass

/**
 * Whether the app is on screen right now. The worker runs in the same
 * process, so a plain volatile flag is enough — and it closes the race a
 * timestamp alone cannot: an overdue check released the instant the app
 * opens can run before onResume has written anything.
 */
object AppState {
    @Volatile
    var inForeground = false
}
