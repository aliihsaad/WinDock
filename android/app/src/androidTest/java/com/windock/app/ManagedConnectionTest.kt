package com.windock.app

import android.os.SystemClock
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.lifecycle.Lifecycle
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.After
import org.junit.runner.RunWith
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in emulator fixture only. The temporary invitation is never logged or put in shell arguments. */
@RunWith(AndroidJUnit4::class)
class ManagedConnectionTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun fixture(path: String): JSONObject {
        // Test control channel on the emulator's host loopback, never shipped in the app.
        Socket("10.0.2.2", 18625).use { socket ->
            socket.soTimeout = 15000
            socket.getOutputStream().write("GET $path HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n".toByteArray())
            val stream = java.io.DataInputStream(socket.getInputStream().buffered())
            val header = StringBuilder()
            while (!header.endsWith("\r\n\r\n") && header.length < 16384) header.append(stream.readUnsignedByte().toChar())
            assertTrue(header.startsWith("HTTP/1.1 200"))
            val length = Regex("(?i)Content-Length: ([0-9]+)").find(header)?.groupValues?.get(1)?.toInt() ?: throw AssertionError("Missing fixture response length")
            require(length in 1..16384)
            val body = ByteArray(length)
            var received = 0
            while (received < length) {
                val count = stream.read(body, received, length - received)
                if (count < 0) throw java.io.EOFException("Fixture $path closed after $received of $length bytes")
                received += count
            }
            return try { JSONObject(String(body, Charsets.UTF_8)) } catch (_: Exception) { throw AssertionError("Invalid fixture response for $path") }
        }
    }
    private fun enabled() { assumeTrue(InstrumentationRegistry.getArguments().getString("verifyManaged") == "true") }
    @After fun cleanFixturePairing() {
        if (InstrumentationRegistry.getArguments().getString("managedPhase") == null)
            SecurePairing(instrumentation.targetContext).forget("44444444-4444-4444-8444-444444444444")
    }
    @Test fun pairingSurvivesProcessRestart() {
        val phase = InstrumentationRegistry.getArguments().getString("managedPhase")
        assumeTrue(phase in listOf("seed", "verify"))
        val store = SecurePairing(instrumentation.targetContext)
        if (phase == "seed") {
            val invitation = PairingInvitation.parse(fixture("/invitation").getString("invitation"))
            store.forget(invitation.computer.hostId)
            SecureTransport(invitation.computer, store::save).use { assertTrue(it.claim(invitation.secret)) }
        } else {
            val host = store.selected() ?: throw AssertionError("Pairing did not survive process death")
            SecureTransport(host, store::save).use { it.health(); it.execute("/api/state").use { response -> assertEquals(200, response.code) } }
            store.forget(host.hostId)
        }
    }
    @Test fun nonPrivatePairingCanBeLoadedOffNetworkWithoutAllowingAConnection() {
        enabled()
        val invitation = PairingInvitation.parse(fixture("/invitation").getString("invitation"))
        val host = invitation.computer.copy(endpoint = "https://50.50.50.241:8621")
        assertEquals(host, TrustedComputer.parse(host.json()))
        val store = SecurePairing(instrumentation.targetContext)
        try {
            store.save(host)
            assertEquals(host, SecurePairing(instrumentation.targetContext).get(host.hostId))
            assertNull(EndpointPolicy.normalize(host.endpoint, emptyList()))
            // The owned emulator has no 50.50.50.x link: loading trust must not open a socket.
            assertThrows(IllegalArgumentException::class.java) { SecureTransport(host, store::save).close() }
        } finally { store.forget(host.hostId) }
    }
    @Test fun slowMediaDoesNotBlockOrDisconnectTheDock() {
        enabled()
        val invitation=PairingInvitation.parse(fixture("/invitation").getString("invitation"))
        val store=SecurePairing(instrumentation.targetContext); store.forget(invitation.computer.hostId)
        PhonePreferences.setUsbOnly(instrumentation.targetContext,false)
        SecureTransport(invitation.computer,store::save).use { assertTrue(it.claim(invitation.secret)) }
        fixture("/media-slow")
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web:WebView
                scenario.onActivity { web=it.findViewById(R.id.web) }
                fun js(expression:String):String {
                    var value="null"; val done=CountDownLatch(1)
                    instrumentation.runOnMainSync { web.evaluateJavascript(expression){value=it;done.countDown()} }
                    done.await(2,TimeUnit.SECONDS); return value
                }
                fun connected()=js("!document.getElementById('app')?.hidden && document.getElementById('conn')?.textContent==='Connected'")=="true"
                val deadline=SystemClock.uptimeMillis()+7000
                while(!connected() && SystemClock.uptimeMillis()<deadline) SystemClock.sleep(150)
                assertTrue("A 20-second media provider must not block dock startup",connected())
                js("window.mediaConnectionMarker='same-page'")
                // Includes both the old 8s native and 15s JS timeouts, then the actual 20s reply.
                val waitForMedia=SystemClock.uptimeMillis()+23000
                while(SystemClock.uptimeMillis()<waitForMedia) {
                    assertEquals("\"same-page\"",js("window.mediaConnectionMarker"))
                    assertTrue("Slow optional media must not disconnect the primary socket",connected())
                    if(js("document.body.textContent.includes('Slow fixture media')")=="true") break
                    SystemClock.sleep(400)
                }
                assertEquals("true",js("document.body.textContent.includes('Slow fixture media')"))
                // A provider that exceeds its deadline also must not tear down a healthy dock.
                js("window.optionalMediaFailed=false; window.addEventListener('windock-transport',e=>{if(e.detail.kind==='response' && e.detail.error) window.optionalMediaFailed=true;})")
                fixture("/media-stalled")
                val timeoutWindow=SystemClock.uptimeMillis()+55000
                while(SystemClock.uptimeMillis()<timeoutWindow && js("window.optionalMediaFailed")!="true") {
                    assertEquals("\"same-page\"",js("window.mediaConnectionMarker")); assertTrue(connected())
                    SystemClock.sleep(500)
                }
                assertEquals("The stalled media request must actually time out", "true",js("window.optionalMediaFailed"))
                SystemClock.sleep(1500)
                assertEquals("\"same-page\"",js("window.mediaConnectionMarker")); assertTrue(connected())
                assertNotNull(store.get(invitation.computer.hostId))
            }
        } finally { fixture("/media-normal"); store.forget(invitation.computer.hostId) }
    }
    @Test fun staleReadRecoversWithoutReplayingControlRequests() {
        enabled()
        val invitation=PairingInvitation.parse(fixture("/invitation").getString("invitation"))
        val store=SecurePairing(instrumentation.targetContext); store.forget(invitation.computer.hostId)
        try {
            SecureTransport(invitation.computer,store::save).use { transport ->
                assertTrue(transport.claim(invitation.secret)); transport.health()
                fixture("/drop-next-read")
                transport.execute("/api/capture").use { assertEquals(200,it.code) }
                assertEquals(2,fixture("/fault-status").getInt("readAttempts"))
                fixture("/drop-next-write")
                assertThrows(java.io.IOException::class.java) { transport.execute("/api/control","POST","{\"verb\":\"media-playpause\"}").close() }
                assertEquals("A control whose response is lost must never be replayed",1,fixture("/fault-status").getInt("writeAttempts"))
                transport.execute("/api/state").use { assertEquals(200,it.code) }
            }
        } finally { fixture("/clear-faults"); store.forget(invitation.computer.hostId) }
    }
    @Test fun nativeTrustSessionRenewalRestartAndMovedEndpoint() {
        enabled()
        val invitation = PairingInvitation.parse(fixture("/invitation").getString("invitation"))
        val store = SecurePairing(instrumentation.targetContext)
        store.forget(invitation.computer.hostId)
        lateinit var paired: TrustedComputer
        SecureTransport(invitation.computer, store::save).use { transport ->
            assertEquals(invitation.computer.hostId, transport.health().hostId)
            assertTrue(transport.claim(invitation.secret))
            assertFalse(transport.claim(invitation.secret))
            paired = transport.computer
            transport.execute("/api/state").use { assertEquals(200, it.code) }
            transport.execute("/api/clipboard/history").use { assertEquals(200, it.code) }
            assertFalse(transport.allows("https://attacker.invalid/"))
            assertFalse(transport.allows("http://${paired.tlsName}/"))
        }
        val restored = SecurePairing(instrumentation.targetContext).get(paired.hostId)!!
        assertEquals(paired.token, restored.token)
        assertFalse(instrumentation.targetContext.getSharedPreferences("secure-computers", android.content.Context.MODE_PRIVATE).all.toString().contains(paired.token))
        assertNull(ManagedDiscovery.parse("windock:here:v3:{\"hostId\":\"wrong\",\"endpoint\":\"https://10.0.2.2:18626\"}", "10.0.2.2", paired.hostId))
        fixture("/renew"); fixture("/restart")
        SecureTransport(restored, store::save).use { transport ->
            transport.health(); transport.execute("/api/state").use { assertEquals(200, it.code) }
        }
        val moved = paired.copy(endpoint = "https://10.0.2.2:${fixture("/move").getInt("port")}")
        SecureTransport(moved, store::save).use { transport ->
            assertEquals(paired.hostId, transport.health().hostId)
            transport.execute("/api/state").use { assertEquals(200, it.code) }
        }
        // A routing hint with the wrong authenticated host name must fail TLS.
        SecureTransport(moved.copy(hostId = "55555555-5555-4555-8555-555555555555"), {}).use { transport ->
            assertThrows(javax.net.ssl.SSLException::class.java) { transport.health() }
        }
        fixture("/move"); fixture("/revoke")
        SecureTransport(paired, {}).use { transport -> transport.execute("/api/state").use { assertEquals(401, it.code) } }
        store.forget(paired.hostId)
    }

    @Test fun sharedDockUsesNativeTlsAndReconnectsAfterActivityAndHostRestart() {
        enabled()
        val text = fixture("/invitation").getString("invitation")
        val invitation = PairingInvitation.parse(text)
        val store = SecurePairing(instrumentation.targetContext); store.forget(invitation.computer.hostId)
        PhonePreferences.setUsbOnly(instrumentation.targetContext, false)
        UiDevice.getInstance(instrumentation).wakeUp()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var web: WebView
            scenario.onActivity { activity ->
                web = activity.findViewById(R.id.web)
                MainActivity::class.java.getDeclaredMethod("acceptInvitation", String::class.java).apply { isAccessible = true }.invoke(activity, text)
            }
            fun js(expression: String): String {
                var result = "null"; val done = CountDownLatch(1)
                instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; done.countDown() } }
                // A navigation can discard evaluation in the old document. Retry against the new page.
                done.await(2, TimeUnit.SECONDS); return result
            }
            fun awaitJs(expression: String) {
                val until = SystemClock.uptimeMillis() + 25000
                while (SystemClock.uptimeMillis() < until) { if (js(expression) == "true") return; SystemClock.sleep(150) }
                var status = ""
                scenario.onActivity { status = it.findViewById<android.widget.TextView>(R.id.status).text.toString() }
                fail("Managed dock did not reach expected UI state: $expression; status=$status")
            }
            awaitJs("!!document.getElementById('conn') && document.getElementById('conn').textContent === 'Connected'")
            println("Managed fixture: shared dock connected")
            assertEquals("\"https:\"", js("location.protocol"))
            assertEquals("false", js("document.cookie.includes('windock_session')"))
            assertEquals("true", js("window.WinDockAndroid.saveAppearance(location.origin, JSON.parse(window.WinDockAndroid.getAppearance(location.origin,'{}')).scope, 'windock-performance','on')"))
            js("document.querySelector('.tile[data-key=\"secure-fixture\"]').click()")
            awaitJs("document.querySelector('.tile[data-key=\"secure-fixture\"]').classList.contains('is-running')")
            js("document.getElementById('quick-controls-open').click();document.getElementById('quick-input').click()")
            awaitJs("document.getElementById('touchpad-surface').dataset.ready === 'true'")
            println("Managed fixture: app launch and input connected")
            js("window.restartMarker='old'")
            fixture("/restart")
            awaitJs("window.restartMarker === undefined && !!document.getElementById('conn') && document.getElementById('conn').textContent === 'Connected'")
            js("window.resumeMarker='old'")
            scenario.moveToState(Lifecycle.State.CREATED)
            SystemClock.sleep(300)
            scenario.moveToState(Lifecycle.State.RESUMED)
            awaitJs("window.resumeMarker === undefined && !!document.getElementById('conn') && document.getElementById('conn').textContent === 'Connected'")
            scenario.recreate(); scenario.onActivity { web = it.findViewById(R.id.web) }
            awaitJs("!!document.getElementById('conn') && document.getElementById('conn').textContent === 'Connected'")
            assertNotNull(SecurePairing(instrumentation.targetContext).get(invitation.computer.hostId))
            assertEquals("true", js("JSON.parse(window.WinDockAndroid.getAppearance(location.origin,'{}')).values['windock-performance'] === 'on'"))
            println("Managed fixture: restart and activity recreation connected")
            if (instrumentation.targetContext.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
                scenario.onActivity {
                    it.findViewById<android.widget.EditText>(R.id.address).setText("http://10.0.2.2:18624")
                    it.findViewById<android.widget.Button>(R.id.connect).performClick()
                }
                awaitJs("location.origin === 'http://10.0.2.2:18624' && !!document.getElementById('pair')")
                assertFalse(store.hasSelected())
                assertNotNull(store.get(invitation.computer.hostId))
            }
        }
        store.forget(invitation.computer.hostId)
    }
}
