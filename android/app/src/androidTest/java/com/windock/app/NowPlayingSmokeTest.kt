package com.windock.app

import android.os.SystemClock
import android.webkit.WebView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Emulator only: run scripts/now-playing-smoke-host.mjs first. No native PC actions. */
@RunWith(AndroidJUnit4::class)
class NowPlayingSmokeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun fixture(change: String? = null): JSONObject {
        val connection = URL("http://10.0.2.2:18624/state").openConnection() as HttpURLConnection
        connection.connectTimeout = 5000
        connection.readTimeout = 5000
        try {
            if (change != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(change.toByteArray()) }
            }
            assertEquals(200, connection.responseCode)
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
    private fun js(web: WebView, expression: String): String {
        val done = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; done.countDown() } }
        assertTrue("JavaScript callback", done.await(5, TimeUnit.SECONDS))
        return result
    }
    private fun awaitJs(web: WebView, expression: String, timeout: Long = 6000) {
        val deadline = SystemClock.uptimeMillis() + timeout
        while (SystemClock.uptimeMillis() < deadline) {
            if (js(web, expression) == "true") return
            SystemClock.sleep(100)
        }
        fail("Timed out: $expression; state=" + js(web, "JSON.stringify({connection:document.getElementById('conn')?.textContent,pairError:document.getElementById('pair-error')?.textContent,hidden:document.hidden,title:document.querySelector('.np__title')?.textContent})"))
    }
    @Test fun mediaUpdatesWithoutRefreshAndResumesAfterBackgrounding() {
        fixture("""{"media":{"title":"Android first","artist":"First artist","playing":true},"delayMs":0,"fail":false}""")
        ServerUrl.save(instrumentation.targetContext, "http://10.0.2.2:18623")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView
            scenario.onActivity { web = it.findViewById(R.id.web) }
            awaitJs(web, "!!document.getElementById('pin')", 15000)
            awaitJs(web, "!document.getElementById('pair').hidden || !document.getElementById('app').hidden")
            if (js(web, "!document.getElementById('pair').hidden") == "true") {
                js(web, "document.getElementById('pin').value='864213'; document.querySelector('#pair-form button').click()")
            }
            awaitJs(web, "document.getElementById('conn').textContent === 'Connected'", 15000)
            awaitJs(web, "document.querySelector('.np__title')?.textContent === 'Android first'")
            js(web, "window.mediaRefreshClicks=0; document.getElementById('refresh').addEventListener('click',()=>window.mediaRefreshClicks++)")
            fixture("""{"media":{"title":"Android second","artist":"Second artist","playing":true}}""")
            awaitJs(web, "document.querySelector('.np__title')?.textContent === 'Android second' && document.querySelector('.np__artist')?.textContent === 'Second artist'")
            fixture("""{"media":{"title":"Android second","artist":"Second artist","playing":false}}""")
            awaitJs(web, "document.querySelector('#nowplaying .eyebrow')?.textContent === 'Paused'")
            fixture("""{"media":null}""")
            awaitJs(web, "document.getElementById('nowplaying').textContent === ''")

            scenario.moveToState(Lifecycle.State.CREATED)
            SystemClock.sleep(500) // Let any already-started poll finish.
            val backgroundRequests = fixture().getInt("requests")
            fixture("""{"media":{"title":"After background","artist":"Artist","playing":true}}""")
            SystemClock.sleep(2500)
            assertEquals("No polling while backgrounded", backgroundRequests, fixture().getInt("requests"))
            scenario.moveToState(Lifecycle.State.RESUMED)
            awaitJs(web, "document.querySelector('.np__title')?.textContent === 'After background'")
            assertEquals("No Refresh clicks", "0", js(web, "window.mediaRefreshClicks"))
        }
    }
}
