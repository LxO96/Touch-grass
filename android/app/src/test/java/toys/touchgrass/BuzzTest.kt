package toys.touchgrass

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertSame
import org.junit.Test
import java.io.File

/** The widget's trip button buzzes the same as the app's. */
class BuzzTest {

    @Test
    fun `the first trip of the day gets the fanfare`() {
        assertSame(Buzz.FIRST, Buzz.forTrip(0))
    }

    @Test
    fun `later trips get the lighter buzz`() {
        assertSame(Buzz.AGAIN, Buzz.forTrip(1))
        assertSame(Buzz.AGAIN, Buzz.forTrip(4))
    }

    /** The page's BUZZ in core.js is the source; this keeps the two in step. */
    @Test
    fun `the buzzes match the page's`() {
        val js = File("../web/core.js").readText()
        fun fromJs(name: String): IntArray {
            val body = Regex("""\b$name: (\[\[.*?\]\]),""", RegexOption.DOT_MATCHES_ALL)
                .find(js)!!.groupValues[1]
            return Regex("""\d+""").findAll(body).map { it.value.toInt() }.toList().toIntArray()
        }
        fun flat(p: Buzz.Pattern) = p.ms.indices.flatMap { listOf(p.ms[it].toInt(), p.strength[it]) }.toIntArray()
        assertArrayEquals(fromJs("first"), flat(Buzz.FIRST))
        assertArrayEquals(fromJs("again"), flat(Buzz.AGAIN))
    }
}
