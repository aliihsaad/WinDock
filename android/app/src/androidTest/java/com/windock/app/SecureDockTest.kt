package com.windock.app

import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLHandshakeException

/** Explicitly opt in with verifySecure=true against the TLS-enabled smoke fixture.
 * Trust its temporary CA on the test emulator and adb reverse tcp:18623 first.
 * Never run against a real PC: fixture credentials and apps are intentionally fake.
 */
@RunWith(AndroidJUnit4::class)
class SecureDockTest {
    @Test fun releaseRejectsRemovedCertificateTrust() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyUntrusted") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)
        val connection = URL("https://127.0.0.1:18623/health").openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 5000; connection.readTimeout = 5000
            assertThrows(SSLHandshakeException::class.java) { connection.responseCode }
        } finally { connection.disconnect() }
    }

    @Test fun releasePairsOverTrustedTlsAndUsesLiveDockAndInput() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifySecure") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)
        val endpoint = "https://127.0.0.1:18623"
        val health = URL("$endpoint/health").openConnection() as HttpsURLConnection
        try {
            health.connectTimeout = 5000; health.readTimeout = 5000
            assertEquals(200, health.responseCode)
        } finally { health.disconnect() }
        val cleared = CountDownLatch(1)
        instrumentation.runOnMainSync { CookieManager.getInstance().removeAllCookies { cleared.countDown() } }
        assertTrue(cleared.await(5, TimeUnit.SECONDS))
        ServerUrl.save(context, endpoint)
        PhonePreferences.setUsbOnly(context, false)
        UiDevice.getInstance(instrumentation).wakeUp()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView
            scenario.onActivity { web = it.findViewById(R.id.web) }
            fun js(expression: String): String {
                var result = "null"
                val done = CountDownLatch(1)
                instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; done.countDown() } }
                assertTrue(done.await(5, TimeUnit.SECONDS))
                return result
            }
            fun awaitJs(expression: String) {
                val until = SystemClock.uptimeMillis() + 20000
                while (SystemClock.uptimeMillis() < until) {
                    if (js(expression) == "true") return
                    SystemClock.sleep(100)
                }
                fail("Timed out: $expression")
            }
            fun screenshot(name: String) {
                // DOM state can update before Chromium submits the corresponding frame.
                instrumentation.waitForIdleSync()
                SystemClock.sleep(500)
                val bitmap = instrumentation.uiAutomation.takeScreenshot()
                bitmap.setHasAlpha(false)
                File(context.getExternalFilesDir(null), name).outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
                bitmap.recycle()
            }
            awaitJs("!!document.getElementById('pin') && !document.getElementById('pair').hidden")
            js("document.getElementById('pin').value='864213'; document.querySelector('#pair-form button').click()")
            awaitJs("document.getElementById('pair-error').textContent.length > 0")
            js("document.getElementById('pin').value='975310'; document.querySelector('#pair-form button').click()")
            awaitJs("!document.getElementById('app').hidden && document.querySelectorAll('.tile').length === 5")
            awaitJs("document.getElementById('conn').textContent === 'Connected'")
            assertEquals("\"https:\"", js("location.protocol"))
            // Session cookies stay HttpOnly; the page cannot read the secure token.
            assertEquals("false", js("document.cookie.includes('windock_session')"))
            js("document.querySelector('.tile[data-key=\"smoke-1\"]').click()")
            awaitJs("document.querySelector('.tile[data-key=\"smoke-1\"]').classList.contains('is-running')")
            screenshot("release-dock.png")
            js("document.getElementById('quick-controls-open').click();document.getElementById('quick-input').click()")
            awaitJs("document.getElementById('input-pad').open && document.getElementById('touchpad-surface').dataset.ready === 'true'")
            screenshot("release-touchpad.png")
            js("document.getElementById('input-signature-tab').click()")
            awaitJs("!document.getElementById('signature-pane').hidden")
            screenshot("release-signature.png")
            // Exercise Android's actual Back dispatcher, rather than calling the deprecated method.
            UiDevice.getInstance(instrumentation).pressBack()
            awaitJs("!document.getElementById('input-pad').open")
            scenario.recreate()
            scenario.onActivity { web = it.findViewById(R.id.web) }
            awaitJs("!!document.getElementById('app') && !document.getElementById('app').hidden && document.querySelectorAll('.tile').length === 5")
        }
    }
}
