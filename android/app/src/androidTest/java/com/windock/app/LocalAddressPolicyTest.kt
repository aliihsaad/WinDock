package com.windock.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Exercise Android's JSON implementation without contacting any public address. */
@RunWith(AndroidJUnit4::class)
class LocalAddressPolicyTest {
    @Test fun managedDiscoveryAdmitsOnlyTheCurrentLinkAndNeverDowngrades() {
        val links = listOf(LocalNetwork("50.50.50.20", "50.50.50.255", 24, false))
        val id = "44444444-4444-4444-8444-444444444444"
        val reply = "windock:here:v3:{\"hostId\":\"$id\",\"endpoint\":\"https://192.168.1.40:8621\"}"
        val candidate = ManagedDiscovery.parseCandidate(reply, "50.50.50.241", links)!!
        assertEquals("https://50.50.50.241:8621", candidate.endpoint)
        assertEquals(id, candidate.hostId)
        assertNull(ManagedDiscovery.parseCandidate(reply, "50.50.50.241", emptyList()))
        assertNull(ManagedDiscovery.parseCandidate(reply, "8.8.8.8", links))
        assertNull(ManagedDiscovery.parseCandidate(reply.replace("https:", "http:"), "50.50.50.241", links))
        assertNull(ManagedDiscovery.parseCandidate(reply.replace(id, "wrong"), "50.50.50.241", links))
    }
}
