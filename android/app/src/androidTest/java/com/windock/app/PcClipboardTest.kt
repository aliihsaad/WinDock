package com.windock.app

import android.os.Build
import android.os.SystemClock
import android.graphics.Bitmap
import android.view.MotionEvent
import android.webkit.WebView
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
import org.json.JSONArray
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Disposable emulator only, against clipboard-smoke-host.mjs fake providers. */
@RunWith(AndroidJUnit4::class)
class PcClipboardTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private fun js(web: WebView, expression: String): String {
        val latch = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; latch.countDown() } }
        assertTrue(latch.await(5, TimeUnit.SECONDS)); return result
    }
    private fun awaitJs(web: WebView, expression: String) {
        val deadline = SystemClock.uptimeMillis() + 15000
        while (SystemClock.uptimeMillis() < deadline) {
            if (js(web, expression) == "true") return
            SystemClock.sleep(100)
        }
        fail("Timed out: $expression")
    }
    private fun tap(web: WebView, id: String) {
        val point = JSONArray(js(web, "(()=>{const r=document.getElementById('$id').getBoundingClientRect();return [(r.x+r.width/2)*devicePixelRatio,(r.y+r.height/2)*devicePixelRatio]})()"))
        val xy = IntArray(2)
        instrumentation.runOnMainSync { web.getLocationOnScreen(xy) }
        val now = SystemClock.uptimeMillis()
        for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            val event = MotionEvent.obtain(now,SystemClock.uptimeMillis(),action,xy[0]+point.getDouble(0).toFloat(),xy[1]+point.getDouble(1).toFloat(),0)
            instrumentation.sendPointerSync(event); event.recycle()
        }
    }
    @Test fun clipboardHistoryUsesRealWebViewWithoutSendingDrafts() {
        assumeTrue("Never run fixture on a personal phone", Build.MODEL.contains("sdk"))
        PhonePreferences.setUsbOnly(context,false)
        ServerUrl.save(context,"http://10.0.2.2:18627")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView
            scenario.onActivity { web=it.findViewById(R.id.web) }
            awaitJs(web,"!!document.getElementById('pin')")
            awaitJs(web,"!document.getElementById('pair').hidden || !document.getElementById('app').hidden")
            if(js(web,"!document.getElementById('pair').hidden")=="true") js(web,"document.getElementById('pin').value='864213';document.querySelector('#pair-form button').click()")
            awaitJs(web,"!document.getElementById('app').hidden")
            UiDevice.getInstance(instrumentation).wait(Until.findObject(By.text("Got it")),1500)?.click()
            js(web,"document.getElementById('drawer-open').click();document.getElementById('drawer-input').click()")
            awaitJs(web,"document.getElementById('input-pad').dataset.ready==='true'")
            js(web,"document.getElementById('pc-clipboard-toggle').click()")
            awaitJs(web,"document.querySelectorAll('.pc-clipboard__item').length===4")
            js(web,"document.querySelector('.pc-clipboard__item').click()")
            awaitJs(web,"!document.getElementById('pc-clipboard-editor').hidden")
            js(web,"document.getElementById('pc-clipboard-text').scrollIntoView({block:'center'})")
            SystemClock.sleep(300); tap(web,"pc-clipboard-text")
            awaitJs(web,"document.activeElement.id==='pc-clipboard-text'")
            SystemClock.sleep(700)
            var imeVisible = false
            var imeTop = 0
            scenario.onActivity {
                val insets = ViewCompat.getRootWindowInsets(it.window.decorView)!!
                imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
                imeTop = it.window.decorView.height - insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            }
            assertTrue("Software keyboard must be open", imeVisible)
            val location = IntArray(2)
            instrumentation.runOnMainSync { web.getLocationOnScreen(location) }
            for (id in listOf("pc-clipboard-text", "pc-clipboard-paste")) {
                val r = JSONArray(js(web,"(()=>{const r=document.getElementById('$id').getBoundingClientRect();return [r.top*devicePixelRatio,r.bottom*devicePixelRatio,r.height]})()"))
                assertTrue("$id must remain above the keyboard: bottom=${r.getDouble(1)+location[1]}, keyboard=$imeTop", r.getDouble(0)>=0 && r.getDouble(1)+location[1]<=imeTop+2 && r.getDouble(2)>=44)
            }
            val screenshot=instrumentation.uiAutomation.takeScreenshot()
            File(context.getExternalFilesDir(null),"clipboard-editor-ime.png").outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG,100,it) }; screenshot.recycle()
            assertEquals("true",js(web,"(()=>{const r=document.getElementById('pc-clipboard-text').getBoundingClientRect();return r.height>=44 && r.bottom>0 && r.top<innerHeight})()"))
            js(web,"document.getElementById('pc-clipboard-text').value='Edited on Android 🙂';document.getElementById('pc-clipboard-text').dispatchEvent(new Event('input'))")
            tap(web,"pc-clipboard-paste")
            awaitJs(web,"document.getElementById('pc-clipboard-status').textContent==='Paste sent to the PC.'")
            js(web,"document.getElementById('pc-clipboard-close').click()")
            assertEquals("true",js(web,"document.getElementById('pc-clipboard-panel').hidden && !document.getElementById('pc-clipboard-text').value && !document.getElementById('pc-clipboard-list').children.length"))
        }
    }
}
