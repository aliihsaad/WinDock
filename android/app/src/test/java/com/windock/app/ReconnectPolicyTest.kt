package com.windock.app

import org.junit.Assert.*
import org.junit.Test

class ReconnectPolicyTest {
    @Test fun retriesAreBoundedAndBackOff() {
        val delays = (0..8).mapNotNull { ReconnectPolicy.delay(it, true, ConnectionFailure.OFFLINE) }
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 16000L, 30000L), delays)
    }
    @Test fun noRetriesInBackgroundOrForSecurityFailures() {
        for (failure in ConnectionFailure.values()) assertNull(ReconnectPolicy.delay(0, false, failure))
        for (failure in listOf(ConnectionFailure.AUTH, ConnectionFailure.IDENTITY, ConnectionFailure.EXPIRED, ConnectionFailure.STORAGE, ConnectionFailure.PAIRING))
            assertNull(ReconnectPolicy.delay(0, true, failure))
    }
    @Test fun certificateExpirationIsDistinctFromUnexpectedIdentity() {
        assertEquals(ConnectionFailure.EXPIRED, ConnectionFailure.from(javax.net.ssl.SSLHandshakeException("failure").apply { initCause(java.security.cert.CertificateExpiredException()) }))
        assertEquals(ConnectionFailure.IDENTITY, ConnectionFailure.from(javax.net.ssl.SSLPeerUnverifiedException("failure")))
        assertEquals(ConnectionFailure.OFFLINE, ConnectionFailure.from(java.net.ConnectException()))
    }
    @Test fun discoveryAddsNetworkGuidanceWithoutMaskingSecurityFailures() {
        assertEquals(ConnectionFailure.UNREACHABLE, ConnectionFailure.OFFLINE.withDiscovery(true))
        assertEquals(ConnectionFailure.OFFLINE, ConnectionFailure.OFFLINE.withDiscovery(false))
        for (failure in listOf(ConnectionFailure.IDENTITY, ConnectionFailure.EXPIRED, ConnectionFailure.AUTH, ConnectionFailure.PAIRING))
            assertEquals(failure, failure.withDiscovery(true))
        assertEquals(1000L, ReconnectPolicy.delay(0, true, ConnectionFailure.UNREACHABLE))
        assertNull(ReconnectPolicy.delay(6, true, ConnectionFailure.UNREACHABLE))
    }
}
