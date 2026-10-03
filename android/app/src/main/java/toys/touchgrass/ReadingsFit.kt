package toys.touchgrass

/**
 * How many readings fit on the one-row widget, which shares its width
 * with the score and the + button. RemoteViews can't measure text before
 * drawing it, so this estimates: a narrow widget gets the sky as an icon
 * and the temperature, a wide one as many as fit, never cut mid-word.
 */
object ReadingsFit {

    /** Whether the sky keeps its word, and how many readings to show. */
    data class Fit(val skyWord: Boolean, val count: Int)

    // A chip is a 15dp icon, 3dp gap and 12dp margin, plus its text at
    // 12sp, about 6.5dp a character. The sky alone is icon and margin.
    private const val CHIP = 30.0
    private const val PER_CHAR = 6.5
    private const val ICON_ONLY = 27.0

    // Padding both sides, the score and "/100" with their margin, and the
    // + button with its own: what the readings can't have.
    private const val TAKEN_DP = 180

    private fun width(text: String) = CHIP + PER_CHAR * text.length

    /** Room for readings in a widget [widthDp] wide; null when the launcher didn't say. */
    fun budget(widthDp: Int): Int? = if (widthDp <= 0) null else widthDp - TAKEN_DP

    /**
     * [texts] in display order, the sky's word first. The sky and the next
     * reading (the temperature) always show; the rest only while they fit.
     */
    fun fit(texts: List<String>, budgetDp: Int?): Fit {
        if (budgetDp == null || texts.isEmpty()) return Fit(true, texts.size)
        val rest = texts.drop(1).map(::width)
        val withWord = width(texts[0]) + (rest.firstOrNull() ?: 0.0) <= budgetDp
        var used = if (withWord) width(texts[0]) else ICON_ONLY
        var count = 1
        for ((i, w) in rest.withIndex()) {
            if (i > 0 && used + w > budgetDp) break
            used += w
            count++
        }
        return Fit(withWord, count)
    }
}
