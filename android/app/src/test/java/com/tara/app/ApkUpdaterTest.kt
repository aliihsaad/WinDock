package com.tara.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ApkUpdaterTest {
    private val sha = "a".repeat(64)

    @Test fun downloadsMayOnlyComeFromGitHubOverHttps() {
        assertTrue(ApkUpdater.allowed(ApkUpdater.APK_URL))
        assertTrue(ApkUpdater.allowed("https://objects.githubusercontent.com/some/blob"))
        assertTrue(ApkUpdater.allowed("https://release-assets.githubusercontent.com/some/blob"))
        for (bad in listOf("http://github.com/x", "https://github.com.evil.example/x", "https://evil.example/github.com",
            "https://user:pw@github.com/x", "https://github.com:8443/x", "file:///etc/passwd", "not a url")) {
            assertFalse(bad, ApkUpdater.allowed(bad))
        }
    }

    @Test fun acceptsTheFeedsPublishedApk() {
        val release = ApkUpdater.validate(true, "0.4.12", 1012, ApkUpdater.APK_URL, sha.uppercase())
        assertEquals("0.4.12", release.version)
        assertEquals(1012, release.code)
        assertEquals(sha, release.sha256)
        assertTrue(ApkUpdater.isNewer(release, 12))
        assertFalse(ApkUpdater.isNewer(release, 1012))
    }

    @Test fun rejectsAnythingElse() {
        val cases = listOf<() -> Unit>(
            { ApkUpdater.validate(false, "0.4.1", 5, ApkUpdater.APK_URL, sha) },
            { ApkUpdater.validate(true, "0.4", 5, ApkUpdater.APK_URL, sha) },
            { ApkUpdater.validate(true, "0.4.1", 0, ApkUpdater.APK_URL, sha) },
            { ApkUpdater.validate(true, "0.4.1", 5, "https://evil.example/Tara-android-debug.apk", sha) },
            { ApkUpdater.validate(true, "0.4.1", 5, ApkUpdater.APK_URL, "abc") },
        )
        for (case in cases) {
            try { case(); fail("accepted an invalid release") } catch (_: IllegalArgumentException) {}
        }
    }

    @Test fun hexEncodesBytes() {
        assertEquals("00ff10", ApkUpdater.hex(byteArrayOf(0, -1, 16)))
    }
}
