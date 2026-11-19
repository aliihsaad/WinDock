package com.tara.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeGrammarTest {
    @Test fun emptyNamesFallBackToTara() {
        assertEquals(listOf("tara"), WakeGrammar.cleanNames(""))
        assertEquals(listOf("tara"), WakeGrammar.cleanNames(null))
        assertEquals(listOf("tara"), WakeGrammar.cleanNames("!!, 1, x"))
    }
    @Test fun namesAreCleanedAndLimited() {
        assertEquals(listOf("jarvis", "nova"), WakeGrammar.cleanNames("Jarvis!, NOVA; jarvis"))
        assertEquals(WakeGrammar.MAX_NAMES, WakeGrammar.cleanNames("aa,bb,cc,dd,ee,ff,gg").size)
    }
    @Test fun grammarHasTheBareNameGreetingsAndAnUnknownBucket() {
        val g = WakeGrammar.grammar(listOf("tara"))
        assertTrue(g.startsWith("[") && g.endsWith("]"))
        assertTrue(g.contains("\"tara\"") && g.contains("\"hey tara\"") && g.contains("\"okay tera\"") && g.contains("\"[unk]\""))
    }
    @Test fun findsTheWakePhraseWithOrWithoutAGreeting() {
        val names = listOf("tara", "sid")
        assertEquals("", WakeGrammar.command("tara", names))
        assertEquals("", WakeGrammar.command("hey tara", names))
        assertEquals("", WakeGrammar.command("hey sid", names))
        assertEquals("volume down", WakeGrammar.command("Hey Tara, volume down", names))
        assertEquals("open blender", WakeGrammar.command("tara open blender", names))
        assertEquals("", WakeGrammar.command("ok tera", names))
    }
    @Test fun ignoresEverythingElse() {
        val names = listOf("tara", "sid")
        assertNull(WakeGrammar.command("volume down", names))
        assertNull(WakeGrammar.command("tarantula", names))
        assertNull(WakeGrammar.command("hey sidney", names))
        assertNull(WakeGrammar.command("they tara", names))
        assertNull(WakeGrammar.command("[unk]", names))
    }
    @Test fun strictModeNeedsAGreeting() {
        val names = listOf("tara")
        assertNull(WakeGrammar.command("tara", names, strict = true))
        assertNull(WakeGrammar.command("tara open blender", names, strict = true))
        assertEquals("open blender", WakeGrammar.command("hey tara open blender", names, strict = true))
        val g = WakeGrammar.grammar(names, strict = true)
        assertTrue(!g.contains("\"tara\",") && g.contains("\"hey tara\""))
    }
}
