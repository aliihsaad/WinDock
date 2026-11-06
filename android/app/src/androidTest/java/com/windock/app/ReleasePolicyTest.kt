package com.windock.app

import android.content.pm.ApplicationInfo
import android.security.NetworkSecurityPolicy
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.runner.RunWith

/** Run explicitly against a release APK signed with a test-only key matching this test APK. */
@RunWith(AndroidJUnit4::class)
class ReleasePolicyTest {
    @Test fun releaseOffersPlayUpdatesWithoutExternalApkFlow() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyRelease") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { it.findViewById<android.widget.Button>(R.id.app_updates).performClick() }
            val device = androidx.test.uiautomator.UiDevice.getInstance(instrumentation)
            assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(
                androidx.test.uiautomator.By.textContains(context.getString(R.string.play_update_install))), 5000))
            assertTrue(device.hasObject(androidx.test.uiautomator.By.textContains("Google Play")))
            assertFalse(device.hasObject(androidx.test.uiautomator.By.res("com.windock.app", "update_check")))
            assertFalse(device.hasObject(androidx.test.uiautomator.By.res("com.windock.app", "update_download")))
        }
    }
    @Test fun releaseRejectsRememberedLegacyHostWithoutSendingCredentials() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyRelease") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // This test must fail if accidentally run against a debug build.
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)
        assertFalse(NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("10.0.2.2"))
        ServerUrl.save(context, "http://10.0.2.2:18622")
        SecurePairing(context).select(null)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val deadline = android.os.SystemClock.uptimeMillis() + 20000
            var rejected = false
            while (!rejected && android.os.SystemClock.uptimeMillis() < deadline) {
                scenario.onActivity { rejected = it.findViewById<TextView>(R.id.status).text == it.getString(R.string.secure_host_required) }
                if (!rejected) android.os.SystemClock.sleep(100)
            }
            assertTrue("A remembered HTTP host must fail closed with upgrade guidance", rejected)
        }
    }
}
