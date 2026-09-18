package com.windock.app

import org.junit.Assert.*
import org.junit.Test

class EndpointPolicyTest {
    @Test fun trayAddressesAndManualEntry() {
        assertEquals("http://192.168.178.80:8620", EndpointPolicy.normalize("http://192.168.178.80:8620/"))
        assertEquals("http://192.168.178.80:8620", EndpointPolicy.normalize(" 192.168.178.80 "))
        assertEquals("http://10.0.2.2:18621", EndpointPolicy.normalize("10.0.2.2:18621"))
        assertEquals("https://172.31.255.254:8443", EndpointPolicy.normalize("https://172.31.255.254:8443"))
        assertEquals("http://localhost:8620", EndpointPolicy.normalize("localhost:8620"))
        assertEquals("http://127.0.0.1:8620", EndpointPolicy.normalize("127.0.0.1:8620"))
    }

    @Test fun rejectsUnsafeAndAmbiguousEndpoints() {
        listOf(null, "", "https://example.com", "http://8.8.8.8", "http://172.15.1.2", "http://172.32.1.2",
            "http://192.169.1.2", "http://192.168.1.256", "http://192.168.001.1", "http://0xc0a80101",
            "http://user@192.168.1.2", "http://192.168.1.2@evil.test", "http://192.168.1.2.evil.test",
            "file:///etc/passwd", "javascript:alert(1)", "intent://192.168.1.2", "http://192.168.1.2/path",
            "http://192.168.1.2?x=1", "http://192.168.1.2#x", "http://192.168.1.2:0",
            "http://192.168.1.2:65536", "http://192.168.1.2\\@evil.test", "http://[::1]").forEach {
            assertNull("Must reject $it", EndpointPolicy.normalize(it))
        }
    }

    @Test fun webViewStaysOnItsPairedOrigin() {
        val endpoint = "http://192.168.178.80:8620"
        assertTrue(EndpointPolicy.allowsRequest(endpoint, "$endpoint/api/apps/icon?id=x&v=2"))
        assertTrue(EndpointPolicy.allowsRequest(endpoint, "$endpoint/app.js"))
        assertTrue(EndpointPolicy.allowsRequest("http://192.168.1.2", "http://192.168.1.2:80/api/state"))
        listOf("http://192.168.178.81:8620/", "http://192.168.178.80:80/", "https://192.168.178.80:8620/",
            "http://user@192.168.178.80:8620/", "https://evil.test/", "file:///etc/passwd",
            "content://settings/", "javascript:alert(1)", null).forEach {
            assertFalse("Must block $it", EndpointPolicy.allowsRequest(endpoint, it))
        }
        assertFalse(EndpointPolicy.allowsRequest(null, endpoint))
    }

    @Test fun discoveryRejectsOtherProtocolsAndPublicHosts() {
        assertEquals("http://192.168.1.40:8620", Discovery.parseReply("windock:here:v1:http://192.168.1.40:8620"))
        listOf("garbage", "windock:here:v0:http://192.168.1.40:8620", "windock:here:v1:",
            "windock:here:v1:https://example.com", "windock:here:v1:javascript:alert(1)").forEach {
            assertNull(Discovery.parseReply(it))
        }
    }
}
