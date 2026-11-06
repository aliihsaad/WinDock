package com.windock.app

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
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class ManagedPcSwitchTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private fun enabled() = assumeTrue(Build.MODEL.contains("sdk", ignoreCase = true) && InstrumentationRegistry.getArguments().getString("verifyManaged") == "true")
    private fun invitation(path: String): PairingInvitation {
        Socket("10.0.2.2", 18625).use { socket ->
            socket.soTimeout=15000
            socket.getOutputStream().write("GET $path HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n".toByteArray())
            val input=java.io.DataInputStream(socket.getInputStream().buffered()); val header=StringBuilder()
            while(!header.endsWith("\r\n\r\n") && header.length<16384) header.append(input.readUnsignedByte().toChar())
            assertTrue(header.startsWith("HTTP/1.1 200"))
            val size=Regex("(?i)Content-Length: ([0-9]+)").find(header)!!.groupValues[1].toInt(); require(size in 1..16384)
            val body=ByteArray(size); input.readFully(body)
            return PairingInvitation.parse(JSONObject(String(body,Charsets.UTF_8)).getString("invitation"))
        }
    }
    private fun js(web: WebView, code: String): String {
        var value="null"; val done=CountDownLatch(1)
        instrumentation.runOnMainSync { web.evaluateJavascript(code) { value=it; done.countDown() } }
        done.await(2,TimeUnit.SECONDS); return value
    }
    private fun await(label: String, predicate: () -> Boolean) {
        val until=SystemClock.uptimeMillis()+25000
        while(SystemClock.uptimeMillis()<until) { if(predicate()) return; SystemClock.sleep(100) }
        fail("Timed out: $label")
    }
    @Test fun managedAdvertisementsAreVisibleButNeverEstablishTrust() {
        enabled()
        val id="55555555-5555-4555-8555-555555555555"
        val packet="${ManagedDiscovery.PREFIX}{\"hostId\":\"$id\",\"endpoint\":\"https://192.168.1.10:18632\"}"
        DatagramSocket(0,InetAddress.getByName("127.0.0.1")).use { socket ->
            socket.soTimeout=3000
            val worker=Executors.newSingleThreadExecutor()
            try {
                val reply=worker.submit {
                    val probe=DatagramPacket(ByteArray(256),256); socket.receive(probe)
                    assertEquals(ManagedDiscovery.PROBE,String(probe.data,0,probe.length))
                    val bytes=packet.toByteArray(); socket.send(DatagramPacket(bytes,bytes.size,probe.address,probe.port))
                }
                val found=ManagedDiscovery.findAll(listOf(LocalNetwork("127.0.0.1","127.0.0.1",8,false)),socket.localPort)
                reply.get(3,TimeUnit.SECONDS)
                assertEquals("https://127.0.0.1:18632",found.single().endpoint)
                assertNull(ManagedDiscovery.parse(packet,"127.0.0.1","44444444-4444-4444-8444-444444444444"))
                assertNull(ManagedDiscovery.parseCandidate(packet.replace("https:","http:"),"127.0.0.1"))
                assertNull(ManagedDiscovery.parseCandidate(packet.replace(":18632",":0"),"127.0.0.1"))
                assertNull(ManagedDiscovery.parseCandidate(packet.replace(":18632",":18632/path"),"127.0.0.1"))
                val rows=ManagedPcScanner.scan(emptyList(),emptyList(),true,emptyList(),{found},{emptyList()})
                assertEquals(1,rows.size); assertTrue(rows.single().requiresPairing)
                assertEquals(id,rows.single().hostId)
            } finally { worker.shutdownNow() }
        }
    }
    @Test fun scanningAndSwitchingTwoTrustedPcsNeverSelectsTheWrongOne() {
        enabled()
        val store=SecurePairing(context); val first=invitation("/invitation"); val second=invitation("/other-invitation")
        try {
            for(code in listOf(first,second)) SecureTransport(code.computer,store::save).use { assertTrue(it.claim(code.secret)) }
            val windows=store.get(first.computer.hostId)!!; val linux=store.get(second.computer.hostId)!!
            store.select(windows.hostId)
            val hints=listOf(windows,linux).map { ManagedDiscovery.Candidate(it.endpoint,it.hostId) }
            val rows=ManagedPcScanner.scan(emptyList(),listOf(windows,linux),true,emptyList(),{hints},{emptyList()})
            assertEquals(2,rows.size); assertTrue(rows.none { it.requiresPairing })
            assertEquals("Linux",rows.single{it.hostId==linux.hostId}.platform)
            assertEquals("A background scan must not switch the selected host",windows.hostId,store.selected()!!.hostId)
            val impostor=ManagedPcScanner.scan(emptyList(),listOf(windows),true,emptyList(),
                {listOf(ManagedDiscovery.Candidate(linux.endpoint,windows.hostId))},{emptyList()})
            assertTrue("A discovery identity cannot bypass TLS pinning",impostor.isEmpty())
            rows.forEach { ServerUrl.rememberHost(context,it) }
            PhonePreferences.setUsbOnly(context,false)
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web: WebView; scenario.onActivity { web=it.findViewById(R.id.web) }
                fun loaded(tile: String)=js(web,"document.getElementById('conn')?.textContent==='Connected' && !!document.querySelector('.tile[data-key=\"$tile\"]')")=="true"
                await("Windows fixture") { loaded("secure-fixture") }
                // Existing paired PC entered manually must use its own saved CA, not system trust or the old PC.
                js(web,"window.WinDockAndroid.showConnectionSettings()")
                scenario.onActivity { it.findViewById<EditText>(R.id.address).setText(linux.endpoint); it.findViewById<Button>(R.id.connect).performClick() }
                await("manual switch to Linux") { loaded("linux-fixture") }
                assertEquals(linux.hostId,store.selected()!!.hostId)
                scenario.recreate(); scenario.onActivity { web=it.findViewById(R.id.web) }
                await("Linux remains selected after recreation") { loaded("linux-fixture") }
            }
        } finally { store.forget(first.computer.hostId); store.forget(second.computer.hostId) }
    }
    @Test fun unsuccessfulNewPairingDoesNotBounceBackToThePreviousPc() {
        enabled()
        val store=SecurePairing(context); val first=invitation("/invitation"); val second=invitation("/other-invitation")
        try {
            SecureTransport(first.computer,store::save).use { assertTrue(it.claim(first.secret)) }
            PhonePreferences.setUsbOnly(context,false)
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web: WebView; scenario.onActivity { web=it.findViewById(R.id.web) }
                await("previous PC") { js(web,"document.getElementById('conn')?.textContent==='Connected'")=="true" }
                js(web,"window.WinDockAndroid.showConnectionSettings()")
                // A fresh, correctly formed QR whose target is offline, not an expired/invalid code.
                val payload=second.computer.json().put("v",1).put("address","10.0.2.2").put("port",1)
                    .put("expires",System.currentTimeMillis()+120000).put("secret",second.secret)
                val text="windock-pair:"+android.util.Base64.encodeToString(payload.toString().toByteArray(),android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)
                scenario.onActivity { MainActivity::class.java.getDeclaredMethod("acceptInvitation",String::class.java).apply { isAccessible=true }.invoke(it,text) }
                await("failed new PC remains on connection screen") {
                    var ready=false; scenario.onActivity { ready=it.findViewById<TextView>(R.id.status).text.toString()==ConnectionFailure.OFFLINE.message && it.findViewById<EditText>(R.id.address).isEnabled }; ready
                }
                SystemClock.sleep(1600)
                scenario.onActivity { activity ->
                    (MainActivity::class.java.getDeclaredField("secureRetry").apply { isAccessible=true }.get(activity) as Runnable).run()
                }
                // Wait beyond another connection attempt; a hidden-but-loading WebView is not success.
                SystemClock.sleep(2500)
                scenario.onActivity { activity ->
                    assertTrue("No retry to the old PC may be in progress",activity.findViewById<EditText>(R.id.address).isEnabled)
                    assertEquals(ConnectionFailure.OFFLINE.message,activity.findViewById<TextView>(R.id.status).text.toString())
                    assertEquals(View.GONE,web.visibility)
                    assertEquals(View.VISIBLE,activity.findViewById<View>(R.id.connection).visibility)
                }
                assertEquals("Previous pairing is kept for an explicit Return action",first.computer.hostId,store.selected()!!.hostId)
            }
        } finally { store.forget(first.computer.hostId); store.forget(second.computer.hostId) }
    }
}
