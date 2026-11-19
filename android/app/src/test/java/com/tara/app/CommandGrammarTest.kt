package com.tara.app

import org.junit.Assert.*
import org.junit.Test

class CommandGrammarTest {
    @Test fun grammarHasCommandWordsNamesAndDockApps() {
        val g = CommandGrammar.grammar(listOf("tara"), listOf("Blender", "DaVinci Resolve", "weird!!name"))
        assertTrue(g.startsWith("[\"") && g.endsWith("\"]"))
        val words = Regex("\"([^\"]+)\"").findAll(g).map { it.groupValues[1] }.toList()
        for (w in listOf("open", "volume", "tara", "tarah", "hey", "blender", "davinci", "resolve", "weird", "[unk]")) assertTrue(w, w in words)
        assertEquals(words.size, words.toSet().size)
    }
    @Test fun unknownWordsAreNotTrusted() {
        assertTrue(CommandGrammar.trusted("open blender"))
        assertFalse(CommandGrammar.trusted("open [unk] blender"))
        assertFalse(CommandGrammar.trusted(" "))
        assertEquals("open blender", CommandGrammar.clean("open [unk]  blender [unk]"))
    }
}
