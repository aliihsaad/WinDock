package com.windock.app
import org.junit.Assert.*
import org.junit.Test

class UpdatePolicyTest {
    private fun update(release: String = "0.2.4-preview.1", apk: String = "0.2.4-preview.1", code: Int = 5, installed: Int = 5,
                       url: String = UpdatePolicy.RELEASES + "/download/v" + release + "/WinDock-android-debug.apk") =
        UpdatePolicy.evaluate(release, apk, code, url, installed)
    @Test fun installedApkAndPcOnlyReleaseStayCurrent() {
        assertEquals("current", update().status)
        assertEquals("current", update(release = "0.2.5-preview.1").status)
        assertEquals("current", update(installed = 6).status)
    }
    @Test fun aHigherApkCodeOffersItsOwnVersionAndOfficialRelease() {
        val result = update(release = "0.2.6-preview.1", apk = "0.2.5-preview.1", code = 6)
        assertEquals("available", result.status)
        assertEquals("0.2.5-preview.1", result.version)
        assertEquals(UpdatePolicy.RELEASES + "/tag/v0.2.6-preview.1", result.releasePage)
    }
    @Test fun untrustedOrMalformedDownloadsAreRejected() {
        for (url in listOf("http://github.com/aliihsaad/WinDock/releases/download/v0.2.4-preview.1/WinDock-android-debug.apk",
            "https://evil.example/update.apk", UpdatePolicy.RELEASES + "/download/v0.2.4-preview.1/other.apk")) {
            assertThrows(IllegalArgumentException::class.java) { update(url = url) }
        }
        for (release in listOf("", "v0.2.4", "0.2.4/../../elsewhere", "0.2.4\n", "1".repeat(101))) {
            assertNull(UpdatePolicy.releasePage(release))
        }
        assertThrows(IllegalArgumentException::class.java) { update(code = 0) }
    }
}
