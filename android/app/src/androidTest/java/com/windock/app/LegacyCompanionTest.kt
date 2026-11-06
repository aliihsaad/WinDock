package com.windock.app

import android.os.Build
import android.os.SystemClock
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in against the isolated v0.2.6 companion fixture; never a personal PC. */
class LegacyCompanionTest {
    @Test fun releasedCompanionPinSessionAndLiveActionsRemainCompatible() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(Build.MODEL.contains("sdk") &&
            InstrumentationRegistry.getArguments().getString("verifyLegacyRelease") == "true")
        val context = instrumentation.targetContext
        val endpoint = "http://10.0.2.2:18622"
        PhonePreferences.setUsbOnly(context, false)
        ServerUrl.save(context, endpoint)
        fun js(web: WebView, expression: String): String {
            var result = "null"; val ready = CountDownLatch(1)
            instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; ready.countDown() } }
            assertTrue(ready.await(3, TimeUnit.SECONDS)); return result
        }
        fun await(web: WebView, expression: String) {
            val deadline = SystemClock.uptimeMillis() + 12000
            while (SystemClock.uptimeMillis() < deadline) {
                if (js(web, expression) == "true") return
                SystemClock.sleep(150)
            }
            fail("Released companion did not reach: $expression")
        }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView; scenario.onActivity { web = it.findViewById(R.id.web) }
            await(web, "!!document.getElementById('pin') && !document.getElementById('pair').hidden")
            js(web, "document.getElementById('pin').value='000000'; document.querySelector('#pair-form button').click()")
            await(web, "document.getElementById('pair-error').textContent.length > 0")
            js(web, "document.getElementById('pin').value='864213'; document.querySelector('#pair-form button').click()")
            await(web, "!document.getElementById('app').hidden && document.getElementById('conn').textContent==='Connected'")
            assertEquals("5", js(web, "document.querySelectorAll('.tile').length"))
            js(web, "document.querySelector('.tile[data-key=\"smoke-1\"]').click()")
            await(web, "document.querySelector('.tile[data-key=\"smoke-1\"]').classList.contains('is-running')")
        }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView; scenario.onActivity { web = it.findViewById(R.id.web) }
            await(web, "document.getElementById('pair')?.hidden && !document.getElementById('app')?.hidden && document.getElementById('conn')?.textContent==='Connected'")
            assertEquals(endpoint, ServerUrl.load(context, false))
        }
    }
}
