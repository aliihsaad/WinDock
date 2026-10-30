package com.windock.app

import android.app.AlertDialog
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class UpdatesTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val context = instrumentation.targetContext
    private fun button(id: String) = device.wait(Until.findObject(By.res("com.windock.app", id)), 5000).also { assertNotNull(id, it) }
    private fun manifest(code: String = "5", version: String = "0.2.4-preview.1", url: String = UpdatePolicy.RELEASES + "/download/v0.2.4-preview.1/WinDock-android-debug.apk") =
        """{"available":true,"version":"0.2.4-preview.1","android":{"versionCode":$code,"versionName":"$version","url":"$url"}}"""
    @Test fun apkManifestRejectsMalformedMetadataAndDistinguishesVersions() {
        assertEquals("current", AppUpdates.parseManifest(manifest(), 5).status)
        assertEquals("available", AppUpdates.parseManifest(manifest("6", "0.2.5-preview.1"), 5).status)
        for (invalid in listOf("invalid json",manifest("5.5"),manifest("0"),manifest(url="https://evil.example/app.apk"),manifest().replace("true", "false"))) {
            assertThrows(Exception::class.java) { AppUpdates.parseManifest(invalid,5) }
        }
    }
    private fun assertLiveStatus() {
        val deadline = SystemClock.uptimeMillis() + 20000
        var result = ""
        while (SystemClock.uptimeMillis() < deadline) {
            result = device.findObject(By.res("com.windock.app", "update_status"))?.text.orEmpty()
            if (result == "You’re up to date." || result.matches(Regex("WinDock .+ is available\\."))) break
            SystemClock.sleep(100)
        }
        assertTrue("Expected a valid live result, got: $result", result == "You’re up to date." || result.matches(Regex("WinDock .+ is available\\.")))
        assertEquals(result != "You’re up to date.", device.hasObject(By.res("com.windock.app", "update_download")))
    }
    @Test fun legacyPublicFeedUsesTheActualShippedApkCode() {
        val body = """{"available":true,"version":"0.2.4-preview.1","android":{"url":"${UpdatePolicy.RELEASES}/download/v0.2.4-preview.1/WinDock-android-debug.apk"}}"""
        assertEquals("current", AppUpdates.parseManifest(body, 7).status)
        assertEquals("available", AppUpdates.parseManifest(body, 4).status)
        assertThrows(Exception::class.java) { AppUpdates.parseManifest(body.replace("0.2.4-preview.1", "9.0.0"), 7) }
    }
    @Test fun screenShowsCheckingFailureRetryAvailableAndCurrent() {
        assumeTrue("Never alter a personal phone", Build.MODEL.contains("sdk"))
        device.wakeUp()
        var calls=0
        val finish=CountDownLatch(1)
        lateinit var updates: AppUpdates
        lateinit var dialog: AlertDialog
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                updates=AppUpdates(activity) {
                    when (++calls) {
                        1 -> { finish.await(5,TimeUnit.SECONDS); throw IllegalStateException("Offline") }
                        2 -> AppUpdateResult("available","0.2.5-preview.1",UpdatePolicy.releasePage("0.2.5-preview.1"))
                        else -> AppUpdateResult("current")
                    }
                }
                dialog=updates.dialog();dialog.show()
            }
            try {
                assertTrue(device.wait(Until.hasObject(By.text("Installed on this phone: " + BuildConfig.VERSION_NAME)),5000))
                button("update_check").click()
                assertTrue(device.wait(Until.hasObject(By.text("Checking for updates…")),5000))
                assertFalse(button("update_check").isEnabled)
                finish.countDown()
                assertTrue(device.wait(Until.hasObject(By.textContains("Couldn’t check for updates")),5000))
                button("update_check").click()
                assertTrue(device.wait(Until.hasObject(By.text("WinDock 0.2.5-preview.1 is available.")),5000))
                assertNotNull(button("update_download"))
                button("update_check").click()
                assertTrue(device.wait(Until.hasObject(By.text("You’re up to date.")),5000))
                assertFalse(device.hasObject(By.res("com.windock.app","update_download")))
                val image=instrumentation.uiAutomation.takeScreenshot()
                File(context.getExternalFilesDir(null),"updates-current.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG,100,it) };image.recycle()
                scenario.onActivity { dialog.dismiss() }
                scenario.onActivity { dialog=updates.dialog();dialog.show() }
                assertTrue(device.wait(Until.hasObject(By.text("You’re up to date.")),5000))
            } finally { finish.countDown();scenario.onActivity { dialog.dismiss();updates.close() } }
        }
    }
    private fun js(web: WebView, expression: String): String? {
        val done=CountDownLatch(1); var result: String?=null
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result=it;done.countDown() } }
        return if(done.await(2,TimeUnit.SECONDS)) result else null
    }
    private fun awaitJs(web: WebView, expression: String) {
        val deadline=SystemClock.uptimeMillis()+30000
        while(js(web,expression)!="true") {
            assertTrue("Timed out: $expression",SystemClock.uptimeMillis()<deadline);SystemClock.sleep(100)
        }
    }
    @Test fun connectedDockOpensNativeAndroidUpdates() {
        assumeTrue("Never alter a personal phone",Build.MODEL.contains("sdk"))
        PhonePreferences.setUsbOnly(context,false)
        PhonePreferences.saveDisplay(context,DisplayPolicy(0,-1))
        ServerUrl.save(context,"http://10.0.2.2:18622")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView
            scenario.onActivity { web=it.findViewById(R.id.web) }
            awaitJs(web,"!!document.getElementById('drawer-updates')")
            awaitJs(web,"!document.getElementById('pair').hidden || !document.getElementById('app').hidden")
            js(web,"if(!document.getElementById('pair').hidden){document.getElementById('pin').value='864213';document.getElementById('pair-form').requestSubmit()}")
            awaitJs(web,"document.getElementById('pair').hidden && !document.getElementById('app').hidden")
            js(web,"document.getElementById('drawer-open').click();document.getElementById('drawer-updates').click()")
            awaitJs(web,"document.getElementById('updates').open && !document.getElementById('updates-android').hidden")
            assertTrue(js(web,"document.getElementById('updates-android-version').textContent").orEmpty().contains(BuildConfig.VERSION_NAME))
            js(web,"document.getElementById('updates-android-check').click()")
            button("update_check").click()
            assertLiveStatus()
            device.wait(Until.findObject(By.res("android","button2")),5000).click()
            awaitJs(web,"document.getElementById('updates').open")
        }
    }
    @Test fun actualHomeEntryCanCheckThePublishedFeed() {
        assumeTrue("Never alter a personal phone", Build.MODEL.contains("sdk"))
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { it.findViewById<android.widget.Button>(R.id.app_updates).performClick() }
            button("update_check").click()
            assertLiveStatus()
            device.wait(Until.findObject(By.res("android", "button2")), 5000).click()
        }
    }
}
