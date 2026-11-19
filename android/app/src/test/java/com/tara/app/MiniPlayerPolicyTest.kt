package com.tara.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MiniPlayerPolicyTest {
    @Test fun acceptsPlainWatchLinks() {
        assertTrue(MiniPlayerPolicy.isPlayable("https://m.youtube.com/watch?v=dQw4w9WgXcQ"))
        assertTrue(MiniPlayerPolicy.isPlayable("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
    }
    @Test fun refusesEverythingElse() {
        for (bad in listOf(null, "", "http://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://evil.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ", "https://user@m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://m.youtube.com/watch?v=short", "javascript:alert(1)", "https://m.youtube.com/results?v=dQw4w9WgXcQ"))
            assertFalse("should refuse $bad", MiniPlayerPolicy.isPlayable(bad))
    }
    @Test fun navigationStaysOnGoogleHosts() {
        assertTrue(MiniPlayerPolicy.mayNavigate("https", "m.youtube.com"))
        assertTrue(MiniPlayerPolicy.mayNavigate("https", "accounts.google.com"))
        assertFalse(MiniPlayerPolicy.mayNavigate("http", "m.youtube.com"))
        assertFalse(MiniPlayerPolicy.mayNavigate("https", "youtube.com.evil.com"))
        assertFalse(MiniPlayerPolicy.mayNavigate("https", null))
    }
    @Test fun embedPageHoldsOnlyTheVideo() {
        assertTrue(MiniPlayerPolicy.videoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ")
        val html = MiniPlayerPolicy.embedHtml("dQw4w9WgXcQ")
        assertTrue(html.contains("youtube-nocookie.com/embed/dQw4w9WgXcQ"))
        assertFalse(html.contains("<script"))
        assertTrue(MiniPlayerPolicy.videoId("https://evil.com/watch?v=dQw4w9WgXcQ") == null)
    }
}
