package com.windock.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WakeWordTest {
    @Test fun findsTheCommandAfterTheWakeWord() {
        assertEquals("volume down", WakeWord.command("Hey Dock, volume down"))
        assertEquals("open blender", WakeWord.command("okay dock open blender"))
    }
    @Test fun wakeWordAloneGivesAnEmptyCommand() { assertEquals("", WakeWord.command("hey dock")) }
    @Test fun ignoresEverythingElse() {
        assertNull(WakeWord.command("volume down"))
        assertNull(WakeWord.command("hey docker compose"))
        assertNull(WakeWord.command("they dock"))
    }
}
