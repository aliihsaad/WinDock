package com.windock.app

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Button
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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

/** Emulator only: start scripts/android-smoke-host.mjs first. */
@RunWith(AndroidJUnit4::class)
class PhoneOptionsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val endpoint = "http://10.0.2.2:18622"

    private fun prepare() {
        assumeTrue("This fixture must not change a personal phone", Build.MODEL.contains("sdk"))
        device.wakeUp()
        PhonePreferences.setUsbOnly(context, false)
        PhonePreferences.saveDisplay(context, DisplayPolicy(0, -1))
        ServerUrl.save(context, endpoint)
    }

    private fun js(web: WebView, expression: String): String {
        val done = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; done.countDown() } }
        assertTrue(done.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun awaitUi(scenario: ActivityScenario<MainActivity>, timeout: Long = 15000,
                        check: (MainActivity) -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeout
        while (SystemClock.uptimeMillis() < deadline) {
            var ready = false
            scenario.onActivity { ready = check(it) }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail("Timed out waiting for native display/connection state")
    }

    private fun loaded(scenario: ActivityScenario<MainActivity>): WebView {
        awaitUi(scenario) { it.findViewById<WebView>(R.id.web).visibility == View.VISIBLE }
        lateinit var web: WebView
        scenario.onActivity { web = it.findViewById(R.id.web) }
        val deadline = SystemClock.uptimeMillis() + 10000
        while (js(web, "!!document.getElementById('phone-options-row')") != "true") {
            assertTrue("The shared dock should load", SystemClock.uptimeMillis() < deadline)
            SystemClock.sleep(100)
        }
        device.wait(Until.findObject(By.text("Got it")), 1000)?.click()
        return web
    }

    private fun screenshot(name: String) {
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        File(context.getExternalFilesDir(null), name).outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    private fun choose(id: String, label: String) {
        val spinner = device.wait(Until.findObject(By.res("com.windock.app", id)), 5000)
        assertNotNull("Spinner $id", spinner)
        spinner.click()
        val choice = device.wait(Until.findObject(By.text(label)), 5000)
        assertNotNull(label, choice)
        choice.click()
    }

    @Test fun nativeSettingsPersistDimConsumeWakeAndReleaseScreenForSleep() {
        prepare()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                var web = loaded(scenario)
                assertEquals("false", js(web, "document.getElementById('phone-options-row').hidden"))
                js(web, "document.getElementById('phone-options').click()")
                assertTrue(device.wait(Until.hasObject(By.text("This phone")), 5000))
                screenshot("phone-options.png")
                choose("dim_delay", "After 15 seconds")
                choose("sleep_delay", "After 1 minute idle")
                device.findObject(By.res("android", "button1")).click()
                awaitUi(scenario) { PhonePreferences.display(context) == DisplayPolicy(15_000, 60_000, 10) }
                assertEquals(DisplayPolicy(15_000, 60_000, 10), PhonePreferences.display(context))

                scenario.recreate()
                web = loaded(scenario)
                js(web, "window.__wakeClicks=0;document.addEventListener('pointerdown',()=>window.__wakeClicks++,true)")
                awaitUi(scenario, 20000) { it.window.attributes.screenBrightness in 0f..0.1f }
                scenario.onActivity {
                    assertEquals(View.GONE, it.findViewById<View>(R.id.idle_cover).visibility)
                    assertTrue(it.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0)
                }
                var x = 0; var y = 0
                scenario.onActivity { x = web.width / 2; y = web.height / 2 }
                device.click(x, y)
                awaitUi(scenario) { it.window.attributes.screenBrightness == -1f }
                assertEquals("0", js(web, "window.__wakeClicks"))
                device.click(x, y)
                SystemClock.sleep(300)
                assertEquals("1", js(web, "window.__wakeClicks"))
                // Background WebView updates must not keep an idle dock awake.
                js(web, "window.__idleUpdate=setInterval(()=>document.body.dataset.idleTest=Date.now(),250)")
                js(web, "window.WinDockAndroid.showKeyboard('4242',false)")
                awaitUi(scenario) {
                    ViewCompat.getRootWindowInsets(it.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == true
                }
                awaitUi(scenario, 65000) { it.findViewById<View>(R.id.idle_cover).visibility == View.VISIBLE }
                awaitUi(scenario) {
                    ViewCompat.getRootWindowInsets(it.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == false
                }
                screenshot("phone-screen-resting.png")
                scenario.onActivity {
                    assertEquals(0f, it.window.attributes.screenBrightness)
                    assertEquals(0, it.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                // When requested by the test command, prove Android actually powers
                // the display off, beyond merely drawing a black surface.
                if (InstrumentationRegistry.getArguments().getString("verifySleep") == "true") {
                    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                    val deadline = SystemClock.uptimeMillis() + 25000
                    while (power.isInteractive && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(250)
                    assertFalse("Android should turn off the display after keep-awake is released", power.isInteractive)
                    device.wakeUp()
                    device.pressMenu()
                    awaitUi(scenario) { it.findViewById<View>(R.id.idle_cover).visibility == View.GONE }
                } else {
                    device.click(x, y)
                    awaitUi(scenario) { it.findViewById<View>(R.id.idle_cover).visibility == View.GONE }
                    assertEquals("1", js(web, "window.__wakeClicks"))
                }
                scenario.moveToState(Lifecycle.State.CREATED)
                scenario.onActivity {
                    assertEquals(-1f, it.window.attributes.screenBrightness)
                    assertEquals(0, it.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                scenario.moveToState(Lifecycle.State.RESUMED)
                awaitUi(scenario) { it.window.attributes.screenBrightness == -1f }
            }
        } finally { PhonePreferences.saveDisplay(context, DisplayPolicy()) }
    }

    @Test fun usbGuideRemembersChoiceAndAllowsReturnToLan() {
        prepare()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                loaded(scenario)
                scenario.onActivity { @Suppress("DEPRECATION") it.onBackPressed() }
                awaitUi(scenario) { it.findViewById<View>(R.id.connection).visibility == View.VISIBLE }
                scenario.onActivity { it.findViewById<Button>(R.id.usb_connect).performClick() }
                assertTrue(device.wait(Until.hasObject(By.text("Connect by USB")), 5000))
                screenshot("usb-setup.png")
                device.findObject(By.res("android", "button1")).click()
                awaitUi(scenario) { PhonePreferences.usbOnly(context) }
                assertTrue(PhonePreferences.usbOnly(context))
                awaitUi(scenario, 20000) {
                    it.findViewById<Button>(R.id.usb_connect).isEnabled
                }
                // Recent emulators expose both wlan0 and a virtual eth0. A
                // connected result must belong to that wired subnet; this is
                // not evidence of physical USB hardware support.
                scenario.onActivity {
                    if (it.findViewById<WebView>(R.id.web).visibility == View.VISIBLE)
                        assertTrue(Discovery.permitsRememberedEndpoint(ServerUrl.load(context)!!, true, LocalNetwork.available()))
                    else assertEquals(it.getString(R.string.usb_not_found), it.findViewById<TextView>(R.id.status).text)
                }
                scenario.recreate()
                awaitUi(scenario, 20000) {
                    it.findViewById<Button>(R.id.usb_connect).isEnabled
                }
                assertTrue(PhonePreferences.usbOnly(context))
                scenario.onActivity {
                    if (it.findViewById<WebView>(R.id.web).visibility == View.VISIBLE) {
                        @Suppress("DEPRECATION") it.onBackPressed()
                    }
                }
                awaitUi(scenario) { it.findViewById<View>(R.id.connection).visibility == View.VISIBLE }
                scenario.onActivity { it.findViewById<Button>(R.id.retry).performClick() }
                loaded(scenario)
                assertFalse(PhonePreferences.usbOnly(context))
            }
        } finally {
            PhonePreferences.setUsbOnly(context, false)
            PhonePreferences.saveDisplay(context, DisplayPolicy())
        }
    }
}
