package com.windock.app

import org.junit.Assert.*
import org.junit.Test

/** Synthetic OS link metadata; these tests never contact the reporter's network. */
class LocalEndpointTest {
    private val wifi = LocalNetwork("50.50.50.20", "50.50.50.255", 24, false)
    private val usb = LocalNetwork("192.168.42.129", "192.168.42.255", 24, true)
    private val endpoint = "http://50.50.50.241:8620"

    @Test fun manualAddressRequiresTheCurrentLocalSubnet() {
        assertEquals(endpoint, EndpointPolicy.normalize("50.50.50.241:8620", listOf(wifi)))
        assertEquals(endpoint, EndpointPolicy.normalize(" $endpoint/ ", listOf(wifi)))
        assertTrue(EndpointPolicy.isSecure("https://50.50.50.241:8621", listOf(wifi)))
        assertNull(EndpointPolicy.normalize(endpoint, emptyList()))
        assertNull(EndpointPolicy.normalize(endpoint, listOf(usb)))
        assertNull(EndpointPolicy.normalize("http://50.50.51.241:8620", listOf(wifi)))
        assertNull(EndpointPolicy.normalize("http://8.8.8.8:8620", listOf(wifi)))
        val other = LocalNetwork("198.51.100.20", "198.51.100.255", 24, false)
        assertEquals("http://198.51.100.25:8620", EndpointPolicy.normalize("198.51.100.25:8620", listOf(other)))
    }

    @Test fun broadMissingAndInvalidLinkMetadataCannotAuthorizeInternetHosts() {
        for (prefix in listOf(-1, 0, 1, 7, 31, 32, 33))
            assertNull(EndpointPolicy.normalize(endpoint, listOf(wifi.copy(prefixLength = prefix))))
        assertNull(EndpointPolicy.normalize(endpoint, listOf(wifi.copy(broadcast = "255.255.255.255"))))
        assertNull(EndpointPolicy.normalize(endpoint, listOf(wifi.copy(address = "50.50.050.20"))))
        assertNull(EndpointPolicy.normalize("50.50.50.0", listOf(wifi)))
        assertNull(EndpointPolicy.normalize("50.50.50.255", listOf(wifi)))
        val broad = LocalNetwork("50.1.2.3", "50.255.255.255", 8, false)
        assertEquals(endpoint, EndpointPolicy.normalize(endpoint, listOf(broad)))
        assertNull(EndpointPolicy.normalize("51.50.50.241", listOf(broad)))
    }

    @Test fun malformedUrlsAndReservedAddressesStillFailOnLocalLinks() {
        for (input in listOf("50.50.050.241", "50.50.50.256", "50.50.50.241.evil.test", "842150641",
            "http://user@50.50.50.241", "http://50.50.50.241/path", "http://50.50.50.241?x=1",
            "http://50.50.50.241#x", "http://50.50.50.241:65536", "http://50.50.50.241:0",
            "file://50.50.50.241", "http://[::1]", "0.0.0.0", "224.0.0.1", "255.255.255.255", "169.254.1.2"))
            assertNull(input, EndpointPolicy.normalize(input, listOf(wifi)))
    }

    @Test fun originAndNetworkAreBothCheckedForWebRequests() {
        assertTrue(EndpointPolicy.allowsRequest(endpoint, "$endpoint/api/state", listOf(wifi)))
        for (url in listOf("http://50.50.50.240:8620/api/state", "https://50.50.50.241:8620/",
            "http://50.50.50.241:8621/", "http://user@50.50.50.241:8620/", "https://example.com/"))
            assertFalse(url, EndpointPolicy.allowsRequest(endpoint, url, listOf(wifi)))
        assertFalse(EndpointPolicy.allowsRequest(endpoint, "$endpoint/api/state", emptyList()))
    }

    @Test fun discoveryUsesValidatedSenderNotAnOffNetworkAdvertisedRoute() {
        val reply = "windock:here:v1:$endpoint"
        assertEquals(endpoint, Discovery.parseReply(reply, "50.50.50.241", networks = listOf(wifi)))
        assertNull(Discovery.parseReply(reply, "50.50.50.241", networks = emptyList()))
        assertNull(Discovery.parseReply(reply, "8.8.8.8", networks = listOf(wifi)))
        assertEquals("http://192.168.42.10:8620", Discovery.parseReply(reply, "192.168.42.10", networks = listOf(usb)))
        assertEquals("https://50.50.50.241:8621", Discovery.parseReply(
            "windock:here:v2:https://192.168.1.10:8621", "50.50.50.241", true, listOf(wifi)))
        assertNull(Discovery.parseReply("windock:here:v2:$endpoint", "50.50.50.241", true, listOf(wifi)))
        assertNull(Discovery.parseReply("windock:here:v1:http://evil.test:8620", "50.50.50.241", networks = listOf(wifi)))
    }

    @Test fun savedHostsSurviveLeavingNetworkButCannotBeProbedUntilReturning() {
        val host = KnownHost(endpoint, "Windows", false, 1)
        val saved = KnownHosts.remember(emptyList(), host, listOf(wifi))
        assertEquals(listOf(host), KnownHosts.parse(KnownHosts.serialize(saved)))
        var probes = 0
        assertTrue(PcScanner.scan(saved, emptyList(), discover = { emptyList() },
            probe = { _, _ -> probes++; host }).isEmpty())
        assertEquals(0, probes)
        assertEquals(listOf(host), PcScanner.scan(saved, listOf(wifi), discover = { emptyList() },
            probe = { _, _ -> host }))
        assertTrue(KnownHosts.forget(saved, endpoint).isEmpty())
        assertTrue(KnownHosts.remember(emptyList(), host, emptyList()).isEmpty())
    }

    @Test fun usbModeCannotReconnectToTheWifiAddress() {
        assertFalse(Discovery.permitsRememberedEndpoint(endpoint, true, listOf(wifi, usb)))
        assertTrue(Discovery.permitsRememberedEndpoint(endpoint, false, listOf(wifi, usb)))
        val tether = wifi.copy(wired = true)
        assertTrue(Discovery.permitsRememberedEndpoint(endpoint, true, listOf(tether)))
        assertFalse(Discovery.permitsRememberedEndpoint(endpoint, false, listOf(tether)))
        assertFalse(Discovery.permitsRememberedEndpoint(endpoint, true, emptyList()))
    }
}
