package com.windock.app

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.view.inputmethod.EditorInfo
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Exercises the real WebView bridge and IME against an emulator-only host. */
class RemoteKeyboardBridgeTest {
    @Test fun opensNativeImeAndReturnsEmojiToTrustedPage() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = context.getSharedPreferences("windock", android.content.Context.MODE_PRIVATE)
        val remembered = prefs.getString("wifiEndpoint", null)
        val usbOnly = PhonePreferences.usbOnly(context)
        val securePrefs = context.getSharedPreferences("secure-computers", android.content.Context.MODE_PRIVATE)
        val selected = securePrefs.getString("selected", null)
        val server = ServerSocket(0)
        val endpoint = "http://127.0.0.1:" + server.localPort
        val host = thread(isDaemon = true) {
            while (!server.isClosed) {
                try {
                    server.accept().use { client ->
                        val reader = client.getInputStream().bufferedReader()
                        val request = reader.readLine().orEmpty()
                        while (!reader.readLine().isNullOrEmpty()) { }
                        val health = request.startsWith("GET /health ")
                        val body = if (health) """{"app":"windock"}""" else
                            """<html><body>ready<script>
                            window.inputs=[];
                            window.addEventListener('windock-keyboard-input',e=>{window.inputs.push(e.detail);document.body.textContent=JSON.stringify(e.detail)});
                            </script></body></html>"""
                        val bytes = body.toByteArray()
                        client.getOutputStream().apply {
                            write(("HTTP/1.1 200 OK\r\nContent-Type: " +
                                (if (health) "application/json" else "text/html") +
                                "\r\nContent-Length: " + bytes.size + "\r\nConnection: close\r\n\r\n").toByteArray())
                            write(bytes); flush()
                        }
                    }
                } catch (_: Exception) { if (server.isClosed) break }
            }
        }
        fun editor(view: View): RemoteKeyboardEditor? {
            if (view is RemoteKeyboardEditor) return view
            if (view is ViewGroup) for (i in 0 until view.childCount) editor(view.getChildAt(i))?.let { return it }
            return null
        }
        try {
            androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wakeUp()
            // This loopback fixture must not restore a PC left selected by another test.
            SecurePairing(context).select(null)
            PhonePreferences.setUsbOnly(context, false)
            ServerUrl.save(context, endpoint, false)
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity {
                    it.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    if (android.os.Build.VERSION.SDK_INT >= 27) { it.setShowWhenLocked(true); it.setTurnScreenOn(true) }
                    if (android.os.Build.VERSION.SDK_INT >= 26)
                        (it.getSystemService(android.content.Context.KEYGUARD_SERVICE) as android.app.KeyguardManager).requestDismissKeyguard(it, null)
                }
                fun awaitState(check: (MainActivity) -> Boolean) {
                    val until = System.currentTimeMillis() + 12000
                    do {
                        val tutorial = androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                            .findObject(androidx.test.uiautomator.By.text("Got it"))
                        tutorial?.click()
                        var done = false
                        scenario.onActivity { done = check(it) }
                        if (done) return
                        Thread.sleep(100)
                    } while (System.currentTimeMillis() < until)
                    var state = ""
                    scenario.onActivity {
                        val root = it.findViewById<View>(R.id.root)
                        val edit = editor(root)
                        state = "window=" + it.hasWindowFocus() + ", decor=" + it.window.decorView.isShown + ", web=" + it.findViewById<WebView>(R.id.web).visibility + ", shown=" + edit?.isShown + ", focused=" + edit?.hasFocus() + ", ime=" + ViewCompat.getRootWindowInsets(root)?.isVisible(WindowInsetsCompat.Type.ime())
                    }
                    val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("dumpsys window")
                    val windows = android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use { it.readText() }
                    val focus = windows.lineSequence().filter { it.contains("mCurrentFocus=") || it.contains("mFocusedApp=") }.joinToString()
                    fail("Timed out waiting for native keyboard state: " + state + "; " + focus)
                }
                awaitState { it.hasWindowFocus() && it.findViewById<WebView>(R.id.web).visibility == View.VISIBLE }
                scenario.onActivity { it.findViewById<WebView>(R.id.web).evaluateJavascript("WinDockAndroid.showKeyboard('42',false)", null) }
                awaitState {
                    val root = it.findViewById<View>(R.id.root)
                    editor(root)?.hasFocus() == true &&
                        ViewCompat.getRootWindowInsets(root)?.isVisible(WindowInsetsCompat.Type.ime()) == true
                }
                scenario.onActivity {
                    val edit = editor(it.findViewById(R.id.root))!!
                    edit.onCreateInputConnection(EditorInfo())!!.commitText("Hi 🙂", 1)
                }
                val delivered = CountDownLatch(1)
                var reply = ""
                scenario.onActivity { it.findViewById<WebView>(R.id.web).evaluateJavascript("document.body.textContent") { value -> reply = value; delivered.countDown() } }
                assertTrue(delivered.await(5, TimeUnit.SECONDS))
                assertTrue(reply.contains("Hi"))
                assertTrue(reply.contains("42"))
                scenario.onActivity {
                    val edit = editor(it.findViewById(R.id.root))!!
                    edit.onCreateInputConnection(EditorInfo())!!.setComposingText("draft", 1)
                    it.findViewById<WebView>(R.id.web).evaluateJavascript("WinDockAndroid.pressKeyboardKey('42','Home')", null)
                }
                var ordered = ""
                val keyUntil = System.currentTimeMillis() + 5000
                do {
                    val read = CountDownLatch(1)
                    scenario.onActivity { it.findViewById<WebView>(R.id.web).evaluateJavascript("JSON.stringify(window.inputs)") { value -> ordered=value; read.countDown() } }
                    assertTrue(read.await(5, TimeUnit.SECONDS))
                    if (ordered.contains("Home")) break
                    Thread.sleep(50)
                } while (System.currentTimeMillis() < keyUntil)
                assertTrue("Native draft must be committed before Home: $ordered", ordered.indexOf("draft") >= 0 && ordered.indexOf("Home") > ordered.indexOf("draft"))
                scenario.onActivity { it.findViewById<WebView>(R.id.web).evaluateJavascript("WinDockAndroid.pressKeyboardKey('41','End');WinDockAndroid.pressKeyboardKey('42','Control')", null) }
                Thread.sleep(150)
                val denied = CountDownLatch(1)
                scenario.onActivity { it.findViewById<WebView>(R.id.web).evaluateJavascript("JSON.stringify(window.inputs)") { value -> ordered=value; denied.countDown() } }
                assertTrue(denied.await(5, TimeUnit.SECONDS))
                assertFalse(ordered.contains("End"))
                assertFalse(ordered.contains("Control"))
                scenario.onActivity { it.findViewById<WebView>(R.id.web).evaluateJavascript("WinDockAndroid.hideKeyboard()", null) }
                awaitState { editor(it.findViewById(R.id.root))?.isShown == false }
            }
        } finally {
            server.close(); host.join(500)
            prefs.edit().apply { if (remembered == null) remove("wifiEndpoint") else putString("wifiEndpoint", remembered) }.commit()
            PhonePreferences.setUsbOnly(context, usbOnly)
            SecurePairing(context).select(selected)
        }
    }
}
