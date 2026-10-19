package com.windock.app

import org.junit.Assert.*
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class UsbDiscoveryTest {
    @Test fun replyUsesTheAnsweringLinkAndKeepsEndpointValidation() {
        assertEquals("http://192.168.42.10:8620", Discovery.parseReply(
            "windock:here:v1:http://192.168.1.40:8620", "192.168.42.10"))
        assertEquals("https://192.168.42.10:9000", Discovery.parseReply(
            "windock:here:v1:https://localhost:9000", "192.168.42.10"))
        listOf("8.8.8.8", "example.com", "192.168.42.256", "192.168.042.1").forEach {
            assertNull(Discovery.parseReply("windock:here:v1:http://192.168.1.40:8620", it))
        }
        listOf("https://example.com", "http://192.168.1.40:8620/path", "javascript:alert(1)").forEach {
            assertNull(Discovery.parseReply("windock:here:v1:$it", "192.168.42.10"))
        }
    }

    @Test fun wiredNetworksUseTheirOwnSubnet() {
        val link = LocalNetwork("192.168.42.129", "192.168.42.255", 24, true)
        assertTrue(link.contains("192.168.42.10"))
        assertFalse(link.contains("192.168.1.10"))
        assertFalse(link.contains("192.168.42.010"))
        assertFalse(link.contains("localhost"))
        assertFalse(link.copy(prefixLength = 0).contains("192.168.42.10"))
        assertFalse(link.copy(prefixLength = 32).contains("192.168.42.10"))
        listOf("rndis0", "usb0", "ncm0", "eth0", "enx1234").forEach { assertTrue(LocalNetwork.isWiredName(it)) }
        listOf("wlan0", "rmnet0", "tun0").forEach { assertFalse(LocalNetwork.isWiredName(it)) }
    }

    @Test fun usbOnlyNeverUsesWifiOrGlobalBroadcast() {
        var checks = 0
        val result = Discovery.find({ checks++; true }, true,
            listOf(LocalNetwork("127.0.0.1", "127.0.0.1", 8, false)))
        assertNull(result)
        assertEquals(0, checks)
        val links = listOf(LocalNetwork("192.168.1.20", "192.168.1.255", 24, false),
            LocalNetwork("192.168.42.129", "192.168.42.255", 24, true))
        assertFalse(Discovery.permitsRememberedEndpoint("http://192.168.1.10:8620", true, links))
        assertFalse(Discovery.permitsRememberedEndpoint("http://192.168.42.10:8620", true, emptyList()))
        assertTrue(Discovery.permitsRememberedEndpoint("http://192.168.42.10:8620", true, links))
        assertTrue(Discovery.permitsRememberedEndpoint("http://192.168.1.10:8620", false, links))
        assertFalse(Discovery.permitsRememberedEndpoint("https://example.com", false, links))
    }

    @Test fun actualDatagramUsesSourceAddressAndHealthCheck() {
        val worker = Executors.newSingleThreadExecutor()
        try {
            DatagramSocket(Discovery.PORT, InetAddress.getByName("127.0.0.1")).use { host ->
                host.soTimeout = 5000
                val reply = worker.submit {
                    val packet = DatagramPacket(ByteArray(256), 256)
                    host.receive(packet)
                    assertEquals(Discovery.PROBE, String(packet.data, 0, packet.length))
                    // Ignore unrelated and invalid packets before a valid response.
                    for (body in listOf("unrelated", "windock:here:v1:https://example.com",
                        "windock:here:v1:http://192.168.1.40:18622")) {
                        val bytes = body.toByteArray()
                        host.send(DatagramPacket(bytes, bytes.size, packet.address, packet.port))
                    }
                }
                val checked = mutableListOf<String>()
                val result = Discovery.find({ checked.add(it); it == "http://127.0.0.1:18622" }, true,
                    listOf(LocalNetwork("127.0.0.1", "127.0.0.1", 8, true)))
                reply.get(5, TimeUnit.SECONDS)
                assertEquals("http://127.0.0.1:18622", result)
                assertEquals(listOf(result), checked)
            }
        } finally { worker.shutdownNow() }
    }
}
