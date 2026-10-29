package com.windock.app

import org.junit.Assert.*
import org.junit.Test

class PerformancePolicyTest {
    @Test fun totalMemoryCoversOlderPhonesWithoutTheRomFlag() {
        val gib = 1024L * 1024 * 1024
        for (bytes in listOf(1L, gib, 2 * gib - 1, 2 * gib))
            assertTrue("$bytes bytes", PerformancePolicy.autoEnabled(false, bytes))
        for (bytes in listOf(-1L, 0L, 2 * gib + 1, 3 * gib, 8 * gib, Long.MAX_VALUE))
            assertFalse("$bytes bytes", PerformancePolicy.autoEnabled(false, bytes))
        for (bytes in listOf(-1L, 0L, 8 * gib))
            assertTrue("ROM flag remains sufficient", PerformancePolicy.autoEnabled(true, bytes))
    }

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
