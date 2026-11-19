package com.windock.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeGrammarTest {
    @Test fun emptyNamesFallBackToDefaults() {
        assertEquals(listOf("dock", "sid"), WakeGrammar.cleanNames(""))
        assertEquals(listOf("dock", "sid"), WakeGrammar.cleanNames(null))
        assertEquals(listOf("dock", "sid"), WakeGrammar.cleanNames("!!, 1, x"))
    }
    @Test fun namesAreCleanedAndLimited() {
        assertEquals(listOf("jarvis", "nova"), WakeGrammar.cleanNames("Jarvis!, NOVA; jarvis"))
        assertEquals(WakeGrammar.MAX_NAMES, WakeGrammar.cleanNames("aa,bb,cc,dd,ee,ff,gg").size)
    }
    @Test fun grammarHasGreetingsTimesNamesAndAnUnknownBucket() {
        val g = WakeGrammar.grammar(listOf("dock"))
        assertTrue(g.startsWith("[") && g.endsWith("]"))
        assertTrue(g.contains("\"hey dock\"") && g.contains("\"okay doc\"") && g.contains("\"[unk]\""))
    }
    @Test fun findsTheWakePhraseForAnyName() {
        val names = listOf("dock", "sid")
        assertEquals("", WakeGrammar.command("hey sid", names))
        assertEquals("volume down", WakeGrammar.command("Hey Dock, volume down", names))
        assertEquals("", WakeGrammar.command("ok doc", names))
    }
    @Test fun ignoresEverythingElse() {
        val names = listOf("dock", "sid")
        assertNull(WakeGrammar.command("volume down", names))
        assertNull(WakeGrammar.command("hey docker", names))
        assertNull(WakeGrammar.command("hey sidney", names))
        assertNull(WakeGrammar.command("[unk]", names))
    }
}
