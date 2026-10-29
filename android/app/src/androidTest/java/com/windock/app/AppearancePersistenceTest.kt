package com.windock.app

import android.os.Build
import android.os.SystemClock
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Run seed and verify in separate instrumentation processes, with am force-stop between them. */
@RunWith(AndroidJUnit4::class)
class AppearancePersistenceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private fun evaluate(web: WebView, expression: String): String? {
        val done = CountDownLatch(1)
        var result: String? = null
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; done.countDown() } }
        return if (done.await(2, TimeUnit.SECONDS)) result else null
    }

    private fun awaitJs(web: WebView, expression: String) {
        val deadline = SystemClock.uptimeMillis() + 30000
        while (evaluate(web, expression) != "true") {
            assertTrue("Timed out: $expression", SystemClock.uptimeMillis() < deadline)
            SystemClock.sleep(100)
        }
    }

    @Test fun survivesProcessAndHostRestart() {
        val args = InstrumentationRegistry.getArguments()
        val phase = args.getString("appearancePhase")
        assumeTrue("Explicit emulator fixture test only", Build.MODEL.contains("sdk") && phase in listOf("seed", "verify"))
        val endpoint = args.getString("appearanceEndpoint") ?: "http://10.0.2.2:18622"
        require(endpoint in listOf("http://10.0.2.2:18622", "http://10.0.2.2:18623"))
        PhonePreferences.setUsbOnly(context, false)
        PhonePreferences.saveDisplay(context, DisplayPolicy(0, -1))
        ServerUrl.save(context, endpoint)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView
            scenario.onActivity { web = it.findViewById(R.id.web) }
            awaitJs(web, "!!window.WinDockPerformance && !!document.getElementById('performance-mode')")
            awaitJs(web, "!document.getElementById('pair').hidden || !document.getElementById('app').hidden")
            evaluate(web, "if(!document.getElementById('pair').hidden){document.getElementById('pin').value='864213';document.getElementById('pin').form.requestSubmit()}")
            awaitJs(web, "!document.getElementById('app').hidden")
            if (phase == "seed") {
                // Use the actual settings handlers, including normalized layout and UI updates.
                evaluate(web, """
                    document.getElementById('drawer-open').click();
                    document.getElementById('drawer-settings').click();
                    const choose=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change'));};
                    choose('performance-mode','off');
                    choose('glass-theme','frost');
                    document.querySelector('[data-per-page="8"]').click();
                    const labels=document.getElementById('show-labels');labels.checked=true;labels.dispatchEvent(new Event('change'));
                    choose('performance-mode','on');
                """.trimIndent())
            }
            assertEquals("\"on\"", evaluate(web, "window.WinDockPerformance.preference"))
            assertEquals("true", evaluate(web, "document.documentElement.classList.contains('perf')"))
            assertEquals("\"frost\"", evaluate(web, "document.documentElement.dataset.theme"))
            assertEquals("true", evaluate(web, "document.getElementById('show-labels').checked"))
            assertEquals("8", evaluate(web, "JSON.parse(localStorage.getItem('windock-layout')).perPage"))
            if (args.getString("appearanceClearWeb") == "true") {
                // Deliberately lose only web appearance values; native recovery must restore them.
                evaluate(web, "localStorage.removeItem('windock-layout');localStorage.removeItem('windock-performance')")
            }
        }
    }
}
