package com.windock.app

import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs only against scripts/android-smoke-host.mjs; it never launches real PC apps. */
@RunWith(AndroidJUnit4::class)
class DockSmokeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val endpoint = "http://10.0.2.2:18622"
    private fun screenshot(name: String) {
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        File(context.getExternalFilesDir(null), name).outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    private fun js(web: WebView, expression: String): String {
        val done = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; done.countDown() } }
        assertTrue("JavaScript callback", done.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun awaitJs(web: WebView, expression: String) {
        val deadline = SystemClock.uptimeMillis() + 15000
        while (SystemClock.uptimeMillis() < deadline) {
            if (js(web, expression) == "true") return
            SystemClock.sleep(100)
        }
        fail("Timed out: $expression")
    }

    private fun awaitUi(scenario: ActivityScenario<MainActivity>, predicate: (MainActivity) -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 15000
        while (SystemClock.uptimeMillis() < deadline) {
            var ready = false
            scenario.onActivity { ready = predicate(it) }
            if (ready) return
            SystemClock.sleep(100)
        }
        fail("Timed out waiting for native connection screen")
    }

    private fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, hold: Long = 0) {
        val start = SystemClock.uptimeMillis()
        fun send(action: Int, x: Float, y: Float) {
            val event = MotionEvent.obtain(start, SystemClock.uptimeMillis(), action, x, y, 0)
            instrumentation.sendPointerSync(event)
            event.recycle()
        }
        send(MotionEvent.ACTION_DOWN, x1, y1)
        if (hold > 0) SystemClock.sleep(hold)
        for (i in 1..10) {
            send(MotionEvent.ACTION_MOVE, x1 + (x2 - x1) * i / 10, y1 + (y2 - y1) * i / 10)
            SystemClock.sleep(25)
        }
        send(MotionEvent.ACTION_UP, x2, y2)
    }

    @Test fun installedAppPairsRendersSwipesAndDispatchesActions() {
        ServerUrl.save(context, endpoint)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView
            scenario.onActivity { activity ->
                web = activity.findViewById(R.id.web)
                assertEquals(Configuration.ORIENTATION_LANDSCAPE, activity.resources.configuration.orientation)
            }
            awaitJs(web, "!!document.getElementById('pin')")
            awaitJs(web, "!document.getElementById('pair').hidden || !document.getElementById('app').hidden")
            if (js(web, "!document.getElementById('pair').hidden") == "true") {
                js(web, "document.getElementById('pin').value='0000'; document.querySelector('#pair-form button').click()")
                awaitJs(web, "document.getElementById('pair-error').textContent.length > 0")
                js(web, "document.getElementById('pin').value='8642'; document.querySelector('#pair-form button').click()")
            }
            awaitJs(web, "!document.getElementById('app').hidden && document.querySelectorAll('.tile').length === 5")
            awaitJs(web, "document.getElementById('conn').textContent === 'Connected'")
            // A fresh Android image explains immersive mode with a system overlay.
            UiDevice.getInstance(instrumentation).wait(Until.findObject(By.text("Got it")), 3000)?.click()
            assertEquals("true", js(web, "innerWidth > innerHeight && document.body.classList.contains('is-immersive')"))
            assertEquals("2", js(web, "document.querySelectorAll('.dock-page').length"))
            assertEquals("\"none\"", js(web, "getComputedStyle(document.querySelector('.bar')).display"))
            assertEquals("\"none\"", js(web, "getComputedStyle(document.querySelector('.tile__label')).display"))
            js(web, "document.querySelector('.tile[data-key=\"smoke-1\"]').click()")
            awaitJs(web, "document.querySelector('.tile[data-key=\"smoke-1\"]').classList.contains('is-running')")
            js(web, "document.querySelector('.tile[data-key=\"smoke-1\"]').click()")

            var width = 0; var height = 0
            scenario.onActivity { width = web.width; height = web.height }
            gesture(width * .82f, height * .52f, width * .18f, height * .52f)
            awaitJs(web, "document.getElementById('dock').scrollLeft > document.getElementById('dock').clientWidth / 2")
            gesture(width * .18f, height * .52f, width * .82f, height * .52f)
            awaitJs(web, "document.getElementById('dock').scrollLeft < 10")
            gesture(width * .5f, height * .88f, width * .5f, height * .3f)
            awaitJs(web, "document.getElementById('drawer').open")
            instrumentation.runOnMainSync { @Suppress("DEPRECATION") (web.context as MainActivity).onBackPressed() }
            awaitJs(web, "!document.getElementById('drawer').open")
            SystemClock.sleep(600)
            // Hold empty canvas: editing must start without dispatching an app action.
            gesture(width * .5f, height * .5f, width * .5f, height * .5f, 600)
            awaitJs(web, "document.querySelectorAll('.tile.is-editing').length === 5")
            js(web, "document.getElementById('edit-done').click()")
            awaitJs(web, "document.querySelectorAll('.tile.is-editing').length === 0")
            val screenshot = instrumentation.uiAutomation.takeScreenshot()
            File(context.getExternalFilesDir(null), "dock-smoke.png").outputStream().use {
                screenshot.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
            screenshot.recycle()
            scenario.onActivity { assertEquals(View.VISIBLE, web.visibility) }

            // Back returns to PC selection. A failed address remains recoverable.
            scenario.onActivity { @Suppress("DEPRECATION") it.onBackPressed() }
            awaitUi(scenario) { it.findViewById<View>(R.id.connection).visibility == View.VISIBLE }
            scenario.onActivity {
                it.findViewById<EditText>(R.id.address).setText("127.0.0.1:1")
                it.findViewById<Button>(R.id.connect).performClick()
            }
            awaitUi(scenario) {
                it.findViewById<Button>(R.id.connect).isEnabled &&
                    it.findViewById<TextView>(R.id.status).text == it.getString(R.string.not_found)
            }
            screenshot("connection-smoke.png")
            scenario.onActivity {
                it.findViewById<EditText>(R.id.address).setText(endpoint)
                it.findViewById<Button>(R.id.connect).performClick()
            }
            awaitUi(scenario) { it.findViewById<WebView>(R.id.web).visibility == View.VISIBLE }
            awaitJs(web, "!document.getElementById('app').hidden && document.querySelectorAll('.tile').length === 5")
            // Recreating the Activity must remember the host and preserve WebView pairing.
            scenario.recreate()
            scenario.onActivity { web = it.findViewById(R.id.web) }
            awaitJs(web, "!!document.getElementById('app') && !document.getElementById('app').hidden && document.querySelectorAll('.tile').length === 5")
        }
    }
}
