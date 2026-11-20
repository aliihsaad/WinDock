package com.tara.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PhoneActionsTest {
    @Test fun unknownActionsAreRefused() { assertNull(PhoneActions.normalize(PhoneAction("uninstall"))) }
    @Test fun fractionsAndDurationAreClamped() {
        val a = PhoneActions.normalize(PhoneAction("swipe", -1f, 2f, 0.5f, Float.NaN, 99999L))!!
        assertEquals(listOf(0f, 1f, 0.5f, 0f), listOf(a.x1, a.y1, a.x2, a.y2)); assertEquals(1500L, a.ms)
    }
    @Test fun globalButtonsAreAllowed() { for (t in listOf("back", "home", "recents", "notifications")) assertEquals(t, PhoneActions.normalize(PhoneAction(t))!!.type) }
}
