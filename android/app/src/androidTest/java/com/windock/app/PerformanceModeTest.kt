package com.windock.app

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.view.MotionEvent
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

/** Only an emulator and the isolated android-smoke-host fixture; no real PC actions. */
@RunWith(AndroidJUnit4::class)
class PerformanceModeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val endpoint = "http://10.0.2.2:18622"

    private fun js(web: WebView, expression: String): String {
        val done = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; done.countDown() } }
        assertTrue("WebView callback: $expression", done.await(20, TimeUnit.SECONDS))
        return result
    }

    private fun awaitJs(web: WebView, expression: String) {
        val deadline = SystemClock.uptimeMillis() + 15000
        while (js(web, expression) != "true") {
            assertTrue("Timed out: $expression", SystemClock.uptimeMillis() < deadline)
            SystemClock.sleep(100)
        }
    }

    private fun choose(web: WebView, id: String, value: String) {
        js(web, "document.getElementById('$id').value='$value';document.getElementById('$id').dispatchEvent(new Event('change'))")
    }

    private fun click(web: WebView, id: String) { js(web, "document.getElementById('$id').click()") }

    private fun screenshot(name: String) {
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        File(context.getExternalFilesDir(null), name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun preferencePersistencePagingAppearanceAndInput() {
        assumeTrue("Never run this fixture on a personal phone", Build.MODEL.contains("sdk"))
        val device = UiDevice.getInstance(instrumentation)
        device.wakeUp()
        PhonePreferences.setUsbOnly(context, false)
        PhonePreferences.saveDisplay(context, DisplayPolicy(0, -1))
        ServerUrl.save(context, endpoint)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView
            scenario.onActivity { web = it.findViewById(R.id.web) }
            awaitJs(web, "!!window.WinDockPerformance && !!document.getElementById('performance-mode')")
            val lowRam = (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice
            assertEquals(lowRam.toString(), js(web, "window.WinDockPerformance.autoEnabled"))
            assertEquals(endpoint, ServerUrl.load(context))
            awaitJs(web, "!document.getElementById('pair').hidden || !document.getElementById('app').hidden")
            js(web, "if(!document.getElementById('pair').hidden){document.getElementById('pin').value='8642';document.getElementById('pin').form.requestSubmit()}")
            awaitJs(web, "!document.getElementById('app').hidden && document.querySelectorAll('.tile').length===5")
            device.wait(Until.findObject(By.text("Got it")), 1000)?.click()

            for (mode in listOf("on", "off")) {
                click(web, "drawer-open")
                click(web, "drawer-settings")
                choose(web, "performance-mode", "off")
                choose(web, "glass-theme", "frost")
                choose(web, "performance-mode", mode)
                val enabled = mode == "on"
                assertEquals(enabled.toString(), js(web, "document.documentElement.classList.contains('perf')"))
                assertEquals(enabled.toString(), js(web, "document.getElementById('glass-theme').disabled"))
                assertEquals("\"frost\"", js(web, "document.documentElement.dataset.theme"))
                assertEquals(if (enabled) "\"none\"" else "\"blur(44px) saturate(1.3)\"", js(web, "getComputedStyle(document.getElementById('settings')).backdropFilter"))
                assertEquals(if (enabled) "\"auto\"" else "\"smooth\"", js(web, "getComputedStyle(document.getElementById('dock')).scrollBehavior"))
                screenshot("performance-$mode.png")
                js(web, "document.querySelector('[data-close=settings]').click()")
                js(web, "document.querySelector('[data-page=\"1\"]').click()")
                awaitJs(web, "Math.abs(document.getElementById('dock').scrollLeft-document.getElementById('dock').clientWidth)<2")
                js(web, "document.querySelector('[data-page=\"0\"]').click()")
                awaitJs(web, "document.getElementById('dock').scrollLeft<2")
                js(web, "document.querySelector('[data-key=\"smoke-1\"]').click()")
                awaitJs(web, "document.querySelector('[data-key=\"smoke-1\"]').classList.contains('is-running')")
                click(web, "drawer-open")
                click(web, "drawer-edit")
                assertEquals(if (enabled) "\"none\"" else "\"wobble\"", js(web, "getComputedStyle(document.querySelector('.tile')).animationName"))
                click(web, "edit-done")
                click(web, "drawer-open")
                click(web, "drawer-input")
                awaitJs(web, "document.getElementById('input-pad').dataset.ready==='true'")
                assertEquals(if (enabled) "\"24px\"" else "\"260px\"", js(web, "getComputedStyle(document.querySelector('#touchpad-feedback span')).width"))
                assertEquals("\"none\"", js(web, "getComputedStyle(document.getElementById('touchpad-surface')).touchAction"))
                // Deliver actual Android touch events through WebView, independent of OS overlays.
                val down = SystemClock.uptimeMillis()
                for ((index, action) in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP).withIndex()) {
                    scenario.onActivity {
                        val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, web.width * .4f + index * 40f, web.height * .4f, 0)
                        web.dispatchTouchEvent(event)
                        event.recycle()
                    }
                    SystemClock.sleep(80)
                }
                click(web, "mouse-left")
                click(web, "mouse-right")
                click(web, "mouse-drag")
                assertEquals("\"true\"", js(web, "document.getElementById('mouse-drag').getAttribute('aria-pressed')"))
                click(web, "mouse-drag")
                js(web, "document.getElementById('input-pad').close()")
                SystemClock.sleep(100)
            }
            // A manual Off must survive both reload and a new low-RAM hint.
            scenario.onActivity { web.loadUrl(PerformancePolicy.pageUrl(endpoint, true)) }
            awaitJs(web, "window.WinDockPerformance?.autoEnabled===true && document.readyState==='complete'")
            assertEquals("false", js(web, "window.WinDockPerformance.enabled"))
            click(web, "drawer-open")
            click(web, "drawer-settings")
            choose(web, "performance-mode", "auto")
            assertEquals("true", js(web, "window.WinDockPerformance.enabled"))
            js(web, "window.performanceTestBeforeReload=true")
            scenario.onActivity { web.reload() }
            awaitJs(web, "!window.performanceTestBeforeReload && document.readyState==='complete' && window.WinDockPerformance?.preference==='auto' && window.WinDockPerformance.enabled")
            // Reset this test device's preference without changing a personal device.
            js(web, "localStorage.removeItem('windock-performance')")
        }
    }
}
