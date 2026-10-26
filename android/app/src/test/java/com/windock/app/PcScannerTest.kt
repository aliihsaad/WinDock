package com.windock.app

import org.junit.Assert.*
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class PcScannerTest {
    @Test fun collectsMultipleRepliesAndDeduplicatesWithoutProbingInsideReceiveLoop() {
        DatagramSocket(0, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = 3000
            val worker = Executors.newSingleThreadExecutor()
            try {
                val reply = worker.submit {
                    val request = DatagramPacket(ByteArray(256), 256)
                    server.receive(request)
                    assertEquals(Discovery.PROBE, String(request.data, 0, request.length))
                    for (body in listOf("unrelated", "${Discovery.REPLY_PREFIX}http://8.8.8.8:9000",
                        "${Discovery.REPLY_PREFIX}http://192.168.1.4:9001",
                        "${Discovery.REPLY_PREFIX}http://192.168.1.4:9001",
                        "${Discovery.REPLY_PREFIX}http://192.168.1.5:9002")) {
                        val bytes = body.toByteArray()
                        server.send(DatagramPacket(bytes, bytes.size, request.address, request.port))
                    }
                }
                val found = Discovery.findAll(listOf(LocalNetwork("127.0.0.1", "127.0.0.1", 8, true)), server.localPort)
                reply.get(3, TimeUnit.SECONDS)
                assertEquals(listOf("http://127.0.0.1:9001", "http://127.0.0.1:9002"), found.map { it.endpoint })
                assertTrue(found.all { it.usb })
            } finally { worker.shutdownNow() }
        }
    }

    @Test fun combinesSavedFallbackAndDiscoveryOncePerAddressAndPreservesTransport() {
        val wifi = KnownHost("http://192.168.1.40:8620", "Desk", false, 1)
        val usb = KnownHost("http://192.168.42.10:8620", "Laptop", true, 2)
        val offline = wifi.copy(endpoint = "http://192.168.1.41:8620")
        val checked = java.util.Collections.synchronizedList(mutableListOf<Pair<String, Boolean>>())
        val found = PcScanner.scan(listOf(wifi, usb, offline), listOf(
            LocalNetwork("192.168.1.20", "192.168.1.255", 24, false),
            LocalNetwork("192.168.42.129", "192.168.42.255", 24, true)),
            discover = { listOf(Discovery.Candidate(wifi.endpoint, false)) },
            probe = { endpoint, wired -> checked.add(endpoint to wired); listOf(wifi, usb).find { it.endpoint == endpoint } })
        assertEquals(setOf(wifi, usb), found.toSet())
        assertEquals(3, checked.size)
        assertTrue(checked.contains(usb.endpoint to true))
        val unplugged = PcScanner.scan(listOf(usb), emptyList(), discover = { emptyList() },
            probe = { _, _ -> fail("unplugged USB must not use Wi-Fi"); null })
        assertTrue(unplugged.isEmpty())
    }

    @Test fun slowHostDoesNotHideHealthyHostAndScanHasAnOverallDeadline() {
        val running = AtomicInteger(0)
        val peak = AtomicInteger(0)
        val start = System.nanoTime()
        val found = PcScanner.scan(emptyList(), emptyList(),
            discover = { (1..20).map { Discovery.Candidate("http://192.168.1.$it:8620", false) } },
            probe = { endpoint, _ ->
                val count = running.incrementAndGet(); peak.updateAndGet { maxOf(it, count) }
                try {
                    if (endpoint.contains(".2:")) KnownHost(endpoint, "Healthy", false, 1)
                    else { Thread.sleep(10000); null }
                } finally { running.decrementAndGet() }
            })
        assertEquals("Healthy", found.single().name)
        assertTrue("bounded scan", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 4500)
        assertTrue("at most four concurrent probes", peak.get() <= 4)
    }

    @Test fun cancellationInterruptsTheScanAndDiscardsResults() {
        val entered = CountDownLatch(1)
        val interrupted = CountDownLatch(1)
        val worker = Executors.newSingleThreadExecutor()
        try {
            val scan = worker.submit {
                PcScanner.scan(emptyList(), emptyList(),
                    discover = { listOf(Discovery.Candidate("http://127.0.0.1:1", false)) },
                    probe = { _, _ ->
                        entered.countDown()
                        try { Thread.sleep(10000); null }
                        catch (e: InterruptedException) { interrupted.countDown(); throw e }
                    })
            }
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            scan.cancel(true)
            assertTrue(interrupted.await(2, TimeUnit.SECONDS))
        } finally { worker.shutdownNow() }
    }
}
