package com.windock.app

import org.junit.Assert.*
import org.junit.Test

class PerformancePolicyTest {
    @Test fun hintDoesNotChangeOriginOrSavedEndpointPolicy() {
        for (address in listOf("192.168.1.2:8620", "192.168.42.100:8620", "10.0.2.2:18622")) {
            val endpoint = EndpointPolicy.normalize(address)!!
            assertEquals(endpoint, PerformancePolicy.pageUrl(endpoint, false))
            val hinted = PerformancePolicy.pageUrl(endpoint, true)
            assertEquals("$endpoint/?perf=1", hinted)
            assertTrue(EndpointPolicy.allowsRequest(endpoint, hinted))
            assertNull(EndpointPolicy.normalize(hinted))
            assertFalse(EndpointPolicy.allowsRequest(endpoint, "http://192.168.99.99/?perf=1"))
        }
    }
}
