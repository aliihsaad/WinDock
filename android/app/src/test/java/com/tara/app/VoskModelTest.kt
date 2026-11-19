package com.tara.app

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class VoskModelTest {
    private val base = "https://github.com/yeshwanthkumardomala/Tara/releases/download/voicepack-v1/"
    private val sha = "a".repeat(64)

    @Test fun acceptsOnlyThePublishedModel() {
        assertEquals(40_000L, VoskModel.validate(base + "vosk-model.zip", sha.uppercase(), 40_000).size)
        for (bad in listOf("https://evil.com/vosk-model.zip", base + "../x.zip", base + "model.exe", "http://github.com/x.zip"))
            try { VoskModel.validate(bad, sha, 10); fail("accepted $bad") } catch (_: IllegalArgumentException) {}
        try { VoskModel.validate(base + "m.zip", "short", 10); fail() } catch (_: IllegalArgumentException) {}
        try { VoskModel.validate(base + "m.zip", sha, VoskModel.MAX_ZIP_BYTES + 1); fail() } catch (_: IllegalArgumentException) {}
        try { VoskModel.validate(base + "m.zip", sha, 0); fail() } catch (_: IllegalArgumentException) {}
    }

    @Test fun zipEntriesCannotEscapeTheTargetFolder() {
        val root = java.nio.file.Files.createTempDirectory("vm").toFile()
        assertNotNull(VoskModel.safeTarget(root, "am/final.mdl"))
        for (evil in listOf("../x", "a/../../x", "/etc/passwd", "\\windows\\x", "C:\\x", "", "a\u0000b")) assertNull("allowed $evil", VoskModel.safeTarget(root, evil))
        assertTrue(VoskModel.safeTarget(root, "model/am/final.mdl")!!.path.startsWith(root.canonicalPath + File.separator))
    }

    @Test fun recognisesAnInstalledModel() {
        val dir = java.nio.file.Files.createTempDirectory("vm").toFile()
        assertTrue(!VoskModel.installed(dir))
        File(dir, "am").mkdirs(); File(dir, "conf").mkdirs()
        assertTrue(VoskModel.installed(dir))
    }
}
