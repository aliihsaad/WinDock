package com.windock.app

import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Real UDP, HTTP and WebView bridge in an emulator; never connects to the user's PCs. */
@RunWith(AndroidJUnit4::class)
class PcPickerTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)

    @Before fun prepare() {
        assumeTrue("isolated fixture must not alter a personal phone", Build.MODEL.contains("sdk"))
        context.getSharedPreferences("windock", 0).edit().clear().commit()
        PhonePreferences.saveDisplay(context, DisplayPolicy(0, 0, 10))
    }

    private fun js(web: WebView, expression: String): String {
        val ready = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; ready.countDown() } }
        assertTrue(ready.await(5, TimeUnit.SECONDS))
        return result
    }
    private fun await(description: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 20000
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return
            SystemClock.sleep(100)
        }
        fail("Timed out: $description")
    }
    private fun screenshot(name: String) {
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        File(context.getExternalFilesDir(null), name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private fun open(web: WebView) {
        js(web, "window.WinDockAndroid.showPcPicker()")
        assertTrue(device.wait(Until.hasObject(By.text("Switch PC")), 5000))
        await("scan finished") { device.hasObject(By.text("Choose a PC. New connections may ask for its pairing code.")) }
    }
    private fun click(selector: BySelector) {
        repeat(8) {
            val item = device.findObject(selector)
            if (item != null && item.visibleBounds.height() > 12) { item.click(); return }
            device.findObject(By.clazz("android.widget.ScrollView"))?.scroll(Direction.DOWN, 0.6f)
            SystemClock.sleep(100)
        }
        fail("Picker item is not visible: $selector")
    }
    private fun forget(name: String) {
        click(By.desc("Forget $name?"))
        assertTrue(device.wait(Until.hasObject(By.text("Forget $name?")), 5000))
        device.wait(Until.findObject(By.text("Forget")), 5000).click()
        await("forget confirmation dismissed") { !device.hasObject(By.text("Forget $name?")) }
    }

    @Test fun discoversTwoLivePcsSwitchesForgetsAndKeepsManualRecovery() {
        Fixture().use { fixture ->
            // The emulator can hear the developer's LAN too. Never auto-select those hosts.
            val fixturePorts = setOf(java.net.URI(fixture.desk.endpoint).port, java.net.URI(fixture.studio.endpoint).port)
            fun suppressUnrelatedHosts() {
                Discovery.findAll().filter { java.net.URI(it.endpoint).port !in fixturePorts }
                    .forEach { ServerUrl.forgetHost(context, it.endpoint) }
            }
            suppressUnrelatedHosts()
            ServerUrl.save(context, fixture.desk.endpoint, fixture.link.wired)
            PhonePreferences.setUsbOnly(context, fixture.link.wired)
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web: WebView
                scenario.onActivity { web = it.findViewById(R.id.web) }
                await("initial PC") { js(web, "document.title === 'Desk Windows'") == "true" }
                device.wait(Until.findObject(By.text("Got it")), 1500)?.click()
                open(web)
                assertTrue(device.hasObject(By.textStartsWith("Desk Windows\nWindows")))
                assertTrue(device.hasObject(By.textStartsWith("Studio Linux\nLinux")))
                assertTrue("real UDP probe reached fixture", fixture.probes > 0)
                screenshot("pc-picker-two-hosts.png")
                // Refresh repeatedly and close while work is pending. Late results must not reopen it.
                device.findObject(By.text("REFRESH"))?.click() ?: device.findObject(By.text("Refresh")).click()
                device.findObject(By.text("CLOSE"))?.click() ?: device.findObject(By.text("Close")).click()
                SystemClock.sleep(1600)
                assertFalse(device.hasObject(By.text("Switch PC")))
                assertEquals("true", js(web, "document.title === 'Desk Windows'"))
                open(web)
                device.findObject(By.textStartsWith("Studio Linux\nLinux")).click()
                await("switch to Linux") { js(web, "document.title === 'Studio Linux'") == "true" }
                val selectedStudio = ServerUrl.knownHosts(context).first()
                assertEquals(2, ServerUrl.knownHosts(context).size)
                open(web)
                device.findObject(By.textStartsWith("Desk Windows\nWindows")).click()
                await("switch back to Windows") { js(web, "document.title === 'Desk Windows'") == "true" }
                open(web)
                forget("Desk Windows")
                assertFalse(ServerUrl.canAutoConnect(context, fixture.desk.endpoint))
                assertTrue("live PC is still an explicit choice", device.hasObject(By.textStartsWith("Desk Windows\nWindows")))
                forget("Studio Linux")
                assertTrue(ServerUrl.knownHosts(context).isEmpty())
                screenshot("pc-picker-forgotten-live.png")
                suppressUnrelatedHosts()
                scenario.recreate()
                scenario.onActivity { web = it.findViewById(R.id.web) }
                await("forgotten live PCs are not restored") {
                    var ready = false
                    scenario.onActivity { ready = it.findViewById<Button>(R.id.choose_pc).isEnabled &&
                        it.findViewById<View>(R.id.connection).visibility == View.VISIBLE }
                    ready
                }
                assertFalse(ServerUrl.canAutoConnect(context, fixture.desk.endpoint))
                assertFalse(ServerUrl.canAutoConnect(context, HostProbe.read(fixture.studio.endpoint, false)!!))
                assertTrue(ServerUrl.knownHosts(context).isEmpty())
                scenario.onActivity { it.findViewById<Button>(R.id.choose_pc).performClick() }
                await("rediscovery after forget") { device.hasObject(By.textStartsWith("Studio Linux\nLinux")) }
                device.findObject(By.textStartsWith("Studio Linux\nLinux")).click()
                await("explicit selection remembers again") { js(web, "document.title === 'Studio Linux'") == "true" }
                assertTrue(ServerUrl.canAutoConnect(context, fixture.studio.endpoint))
                assertEquals(listOf(selectedStudio.hostId), ServerUrl.knownHosts(context).map { it.hostId })
                fixture.studio.healthy = false
                open(web)
                click(By.textStartsWith("Studio Linux\nLinux"))
                await("unreachable selection does not silently switch PCs") {
                    var ready = false
                    scenario.onActivity { ready = it.findViewById<Button>(R.id.connect).isEnabled &&
                        it.findViewById<View>(R.id.connection).visibility == View.VISIBLE }
                    ready
                }
                scenario.onActivity {
                    val sameLink = fixture.desk.endpoint.replace(fixture.link.address, java.net.URI(selectedStudio.endpoint).host)
                    it.findViewById<EditText>(R.id.address).setText(sameLink)
                    it.findViewById<Button>(R.id.connect).performClick()
                }
                await("manual recovery") { js(web, "document.title === 'Desk Windows'") == "true" }
                assertTrue(ServerUrl.canAutoConnect(context, ServerUrl.knownHosts(context).first()))
            }
        }
    }

    @Test fun forgetClearsAllMatchingLastAddressesWithoutLosingOtherHosts() {
        val a = KnownHost("http://192.168.1.4:8620", "A", false, 1)
        val b = a.copy(endpoint = "http://192.168.1.5:8620", label = "B")
        val prefs = context.getSharedPreferences("windock", 0)
        prefs.edit().putString("endpoint", a.endpoint).commit()
        ServerUrl.migrate(context)
        ServerUrl.save(context, a.endpoint, true)
        ServerUrl.rememberHost(context, a); ServerUrl.rememberHost(context, b)
        ServerUrl.forgetHost(context, "192.168.1.4")
        assertNull(ServerUrl.load(context, false)); assertNull(ServerUrl.load(context, true))
        assertFalse(prefs.contains("endpoint"))
        ServerUrl.migrate(context)
        assertNull(ServerUrl.load(context, false))
        assertEquals(listOf(b), ServerUrl.knownHosts(context))
        assertFalse(ServerUrl.canAutoConnect(context, a.endpoint))
        ServerUrl.save(context, a.endpoint, false)
        assertNull("stale save cannot resurrect forgotten host", ServerUrl.load(context, false))
        ServerUrl.rememberHost(context, a)
        assertEquals(a.endpoint, ServerUrl.load(context, false))
    }

    @Test fun healthRejectsWrongAppOversizedBodiesAndRedirects() {
        FakePc("Desk", "windows", "127.0.0.1").use { pc ->
            assertEquals("Desk", HostProbe.read(pc.endpoint, false)?.name)
            pc.healthBody = "{\"app\":\"other\"}"
            assertNull(HostProbe.read(pc.endpoint, false))
            pc.healthBody = "{\"app\":\"windock\",\"hostName\":\"${"x".repeat(5000)}\"}"
            assertNull(HostProbe.read(pc.endpoint, false))
            pc.healthBody = "{\"app\":\"windock\"}"
            assertEquals(pc.endpoint.removePrefix("http://"), HostProbe.read(pc.endpoint, false)?.name)
            pc.status = 302
            assertNull(HostProbe.read(pc.endpoint, false))
        }
    }

    @Test fun forgettingAnIdentityPreventsReconnectOnAnotherAddress() {
        val id = "12345678-1234-1234-1234-123456789abc"
        val host = KnownHost("http://192.168.1.4:8620", "Desk", false, 1, "Windows", id)
        ServerUrl.rememberHost(context, host)
        ServerUrl.forgetHost(context, host.endpoint)
        val moved = host.copy(endpoint = "http://192.168.1.9:8620")
        assertFalse(ServerUrl.canAutoConnect(context, moved))
        assertTrue(ServerUrl.canAutoConnect(context, moved.copy(hostId = "aaaaaaaa-1234-1234-1234-123456789abc")))
        ServerUrl.rememberHost(context, moved)
        assertTrue(ServerUrl.canAutoConnect(context, moved))
        assertTrue("choosing the PC again restores its previous address too", ServerUrl.canAutoConnect(context, host))
    }

    private class Fixture : AutoCloseable {
        val link = LocalNetwork.available().first()
        val desk = FakePc("Desk Windows", "windows", link.address)
        val studio = FakePc("Studio Linux", "linux", link.address)
        private val socket = DatagramSocket(Discovery.PORT)
        private val worker = Executors.newSingleThreadExecutor()
        @Volatile var probes = 0
        init {
            worker.execute {
                try {
                    while (!socket.isClosed) {
                        val packet = DatagramPacket(ByteArray(256), 256)
                        socket.receive(packet)
                        if (String(packet.data, 0, packet.length) != Discovery.PROBE) continue
                        probes++
                        for (pc in listOf(desk, studio, desk)) {
                            val reply = "${Discovery.REPLY_PREFIX}${pc.endpoint}".toByteArray()
                            socket.send(DatagramPacket(reply, reply.size, packet.address, packet.port))
                        }
                    }
                } catch (_: java.io.IOException) { /* fixture closed */ }
            }
        }
        override fun close() { socket.close(); worker.shutdownNow(); desk.close(); studio.close() }
    }
    private class FakePc(val name: String, platform: String, address: String) : AutoCloseable {
        private val server = ServerSocket(0)
        private val worker = Executors.newCachedThreadPool()
        val endpoint = "http://$address:${server.localPort}"
        @Volatile var healthy = true
        @Volatile var status = 200
        private val hostId = java.util.UUID.randomUUID().toString()
        @Volatile var healthBody = "{\"ok\":true,\"app\":\"windock\",\"hostName\":\"$name\",\"platform\":\"$platform\",\"hostId\":\"$hostId\"}"
        init {
            worker.execute {
                try {
                    while (!server.isClosed) {
                        val socket = server.accept()
                        worker.execute {
                            socket.use {
                                try {
                                    it.soTimeout = 2000
                                    val reader = it.getInputStream().bufferedReader()
                                    val request = reader.readLine().orEmpty()
                                    while (!reader.readLine().isNullOrBlank()) { /* consume headers */ }
                                    val health = request.startsWith("GET /health ")
                                    val body = if (health) healthBody else "<!doctype html><title>$name</title><h1>$name</h1><button onclick='WinDockAndroid.showPcPicker()'>Choose computer</button>"
                                    val bytes = body.toByteArray()
                                    val code = if (healthy) status else 503
                                    val header = "HTTP/1.1 $code Response\r\nContent-Type: ${if (health) "application/json" else "text/html"}; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                                    it.getOutputStream().write(header.toByteArray() + bytes)
                                } catch (_: java.io.IOException) { /* client cancelled */ }
                            }
                        }
                    }
                } catch (_: java.io.IOException) { /* fixture closed */ }
            }
        }
        override fun close() { server.close(); worker.shutdownNow() }
    }
}
