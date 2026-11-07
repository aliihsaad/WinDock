package com.windock.app

import android.net.ConnectivityManager
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Exercises real native navigation and authenticated TLS against the isolated loopback PC. */
@RunWith(AndroidJUnit4::class)
class ConnectionNavigationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private fun fixture(path: String): JSONObject = Socket("10.0.2.2", 18625).use { socket ->
        socket.soTimeout = 15000
        socket.getOutputStream().write("GET $path HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n".toByteArray())
        val input = java.io.DataInputStream(socket.getInputStream().buffered())
        val header = StringBuilder()
        while (!header.endsWith("\r\n\r\n") && header.length < 16384) header.append(input.readUnsignedByte().toChar())
        assertTrue(header.startsWith("HTTP/1.1 200"))
        val size = Regex("(?i)Content-Length: ([0-9]+)").find(header)!!.groupValues[1].toInt()
        require(size in 1..16384)
        val body = ByteArray(size); input.readFully(body); JSONObject(String(body, Charsets.UTF_8))
    }
    private fun js(web: WebView, expression: String): String {
        var value = "null"; val done = CountDownLatch(1)
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { value = it; done.countDown() } }
        done.await(2, TimeUnit.SECONDS); return value
    }
    private fun await(label: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 20000
        while (SystemClock.uptimeMillis() < deadline) { if (condition()) return; SystemClock.sleep(100) }
        fail("Timed out: $label")
    }
    @Test fun connectionEntryKeepsAddressEditingStableAndPairingIntact() {
        assumeTrue(Build.MODEL.contains("sdk", ignoreCase = true) && InstrumentationRegistry.getArguments().getString("verifyManaged") == "true")
        val invitation = PairingInvitation.parse(fixture("/invitation").getString("invitation"))
        val store = SecurePairing(context); store.forget(invitation.computer.hostId)
        PhonePreferences.setUsbOnly(context, false)
        PhonePreferences.saveDisplay(context, DisplayPolicy(0, 0, 10))
        SecureTransport(invitation.computer, store::save).use { assertTrue(it.claim(invitation.secret)) }
        val paired = store.selected()!!
        device.wakeUp()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web: WebView
                scenario.onActivity { web = it.findViewById(R.id.web) }
                fun connected() = js(web, "document.getElementById('conn')?.textContent === 'Connected'") == "true"
                fun inSettings(): Boolean {
                    var shown = false
                    scenario.onActivity { shown = it.findViewById<View>(R.id.connection).visibility == View.VISIBLE &&
                        it.findViewById<EditText>(R.id.address).isEnabled && web.visibility == View.GONE }
                    return shown
                }
                fun returnToDock() {
                    scenario.onActivity { it.findViewById<Button>(R.id.connection_return).performClick() }
                    await("return without pairing again") { var visible = false; scenario.onActivity { visible = web.visibility == View.VISIBLE }; visible && connected() }
                }
                await("initial dock") { connected() }
                assertEquals("true", js(web, "!document.getElementById('connection-open').hidden && !document.getElementById('drawer-switch-pc').hidden"))
                js(web, "document.getElementById('drawer-open').click()")
                assertEquals("true", js(web, "(() => { const a=document.getElementById('connection-open').getBoundingClientRect(), b=document.getElementById('drawer-switch-pc').getBoundingClientRect(); return a.height>=44 && b.right<=a.left && Math.abs(a.top-b.top)<1; })()"))
                // Real accessibility tap: no device-specific edge swipe or JS bridge call needed.
                val entry = device.wait(Until.findObject(By.text("Connection").clazz("android.widget.Button")), 5000)
                device.takeScreenshot(java.io.File(context.getExternalFilesDir(null), "connection-dock.png"))
                entry.click()
                await("explicit connection destination") { inSettings() }
                device.takeScreenshot(java.io.File(context.getExternalFilesDir(null), "connection-settings.png"))
                val draft = "https://192.168.1.80:8621"
                scenario.onActivity { activity ->
                    activity.findViewById<EditText>(R.id.address).setText(draft)
                    // Exercise the same callbacks used by pending retry and network-change events.
                    (MainActivity::class.java.getDeclaredField("secureRetry").apply { isAccessible = true }.get(activity) as Runnable).run()
                    val network = (activity.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as ConnectivityManager).activeNetwork!!
                    (MainActivity::class.java.getDeclaredField("networkMonitor").apply { isAccessible = true }.get(activity) as ConnectivityManager.NetworkCallback).onAvailable(network)
                }
                SystemClock.sleep(1100)
                assertTrue("A network event must not leave settings", inSettings())
                scenario.moveToState(Lifecycle.State.CREATED); scenario.moveToState(Lifecycle.State.RESUMED)
                SystemClock.sleep(900)
                assertTrue("Returning from another app must keep address editing open", inSettings())
                scenario.recreate(); scenario.onActivity { web = it.findViewById(R.id.web) }
                assertTrue(inSettings())
                scenario.onActivity { assertEquals(draft, it.findViewById<EditText>(R.id.address).text.toString()) }
                assertEquals(paired.hostId, store.selected()!!.hostId)
                assertEquals(paired.token, store.selected()!!.token)
                scenario.onActivity { it.findViewById<Button>(R.id.choose_pc).performClick() }
                assertTrue(device.wait(Until.hasObject(By.text("Switch PC")), 3000))
                // Cancelling the chooser must leave the address screen, not start reconnection.
                device.pressBack(); assertTrue(inSettings())
                returnToDock()
                js(web, "document.getElementById('drawer-open').click(); document.getElementById('connection-open').click()")
                await("settings before trying another address") { inSettings() }
                scenario.onActivity { activity ->
                    activity.findViewById<EditText>(R.id.address).setText("https://10.0.2.2:18628")
                    activity.findViewById<Button>(R.id.connect).performClick()
                }
                await("unreachable manual address") { inSettings() }
                assertFalse(store.hasSelected())
                assertNotNull("Trying another address retains the previous trusted identity", store.get(paired.hostId))
                returnToDock()
                assertEquals(paired.hostId, store.selected()!!.hostId)
                js(web, "document.getElementById('drawer-open').click(); document.getElementById('drawer-settings').click()")
                if (js(web, "'popover' in HTMLElement.prototype") == "true") {
                    js(web, "document.getElementById('performance-mode-picker').click()")
                    await("glass dropdown opens") { js(web, "document.getElementById('performance-mode-menu').matches(':popover-open')") == "true" }
                    device.pressBack()
                    await("Back dismisses only the dropdown") { js(web, "document.getElementById('settings').open && !document.getElementById('performance-mode-menu').matches(':popover-open')") == "true" }
                    assertEquals("true", js(web, "document.getElementById('performance-mode-picker').getAttribute('aria-expanded') === 'false'"))
                }
                device.pressBack()
                await("next Back closes Appearance") { js(web, "!document.getElementById('settings').open") == "true" }
                js(web, "document.getElementById('quick-controls-open').click()")
                device.pressBack()
                await("Back closes only the curtain") { js(web, "!document.getElementById('controls').open") == "true" }
                scenario.onActivity { assertEquals(View.VISIBLE, web.visibility) }
                device.pressBack()
                await("system Back reaches connection settings") { inSettings() }
                // A late in-flight secure probe cannot undo Change connection.
                fixture("/hold-state")
                scenario.onActivity { it.findViewById<Button>(R.id.connection_return).performClick() }
                assertTrue(device.wait(Until.hasObject(By.text("Change connection")), 3000))
                device.findObject(By.text("Change connection")).click()
                fixture("/release-state"); SystemClock.sleep(1000)
                assertTrue("Cancelled reconnect must not navigate later", inSettings())
                // Manual entry of the paired endpoint uses the existing identity and session.
                scenario.onActivity { activity ->
                    activity.findViewById<EditText>(R.id.address).setText(paired.endpoint)
                    activity.findViewById<Button>(R.id.connect).performClick()
                }
                await("manual address reconnect") { var visible = false; scenario.onActivity { visible = web.visibility == View.VISIBLE }; visible && connected() }
                assertEquals(paired.hostId, store.selected()!!.hostId)
                assertEquals("true", js(web, "!!document.querySelector('.tile[data-key=\"secure-fixture\"]')"))
            }
        } finally { fixture("/release-state"); store.forget(invitation.computer.hostId) }
    }
}
