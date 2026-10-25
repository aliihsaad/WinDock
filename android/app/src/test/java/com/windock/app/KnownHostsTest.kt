package com.windock.app

import org.junit.Assert.*
import org.junit.Test

class KnownHostsTest {
    private val desk = KnownHost("http://192.168.1.40:8620", "Windows", false, 100)
    private val mac = KnownHost("http://10.0.0.5:8620", "macOS", false, 200)
    private val usb = KnownHost("http://192.168.42.10:8620", "Linux", true, 300)

    @Test fun mostRecentFirstWithoutDuplicates() {
        var hosts = KnownHosts.remember(emptyList(), desk)
        hosts = KnownHosts.remember(hosts, mac)
        assertEquals(listOf(mac.endpoint, desk.endpoint), hosts.map { it.endpoint })
        hosts = KnownHosts.remember(hosts, desk.copy(label = "Windows", lastSeen = 400))
        assertEquals("reconnecting promotes the PC and keeps one entry", listOf(desk.endpoint, mac.endpoint), hosts.map { it.endpoint })
        assertEquals(400, hosts[0].lastSeen)
    }

    @Test fun endpointsAreNormalizedAndValidated() {
        val hosts = KnownHosts.remember(emptyList(), KnownHost(" 192.168.1.40 ", "Windows", false, 1))
        assertEquals("http://192.168.1.40:8620", hosts.single().endpoint)
        assertEquals("a public address is never remembered", emptyList<KnownHost>(), KnownHosts.remember(emptyList(), KnownHost("http://8.8.8.8", "x", false, 1)))
    }

    @Test fun keepsAtMostTheLimit() {
        var hosts = emptyList<KnownHost>()
        for (i in 1..KnownHosts.LIMIT + 3) hosts = KnownHosts.remember(hosts, KnownHost("http://192.168.1.$i:8620", "PC $i", false, i.toLong()))
        assertEquals(KnownHosts.LIMIT, hosts.size)
        assertEquals("the newest stays, the oldest go", "http://192.168.1.${KnownHosts.LIMIT + 3}:8620", hosts.first().endpoint)
        assertEquals("http://192.168.1.4:8620", hosts.last().endpoint)
    }

    @Test fun forgetRemovesOnlyThatPc() {
        val hosts = KnownHosts.remember(KnownHosts.remember(emptyList(), desk), mac)
        assertEquals(listOf(desk.endpoint), KnownHosts.forget(hosts, "10.0.0.5").map { it.endpoint })
        assertEquals(hosts, KnownHosts.forget(hosts, "not an address"))
    }

    @Test fun survivesStorage() {
        val hosts = listOf(usb, mac, desk)
        val text = KnownHosts.serialize(hosts)
        assertEquals(hosts, KnownHosts.parse(text))
        assertEquals(emptyList<KnownHost>(), KnownHosts.parse(null))
        assertEquals(emptyList<KnownHost>(), KnownHosts.parse(""))
    }

    @Test fun ignoresWhatItCannotTrust() {
        val text = listOf(
            "http://192.168.1.40:8620|Windows|wifi|100",
            "http://8.8.8.8:8620|Evil|wifi|100",
            "http://192.168.1.41:8620|Broken|cable|100",
            "http://192.168.1.42:8620|Negative|usb|-1",
            "not|enough",
            "http://192.168.1.40:8620|Duplicate|wifi|5",
            "http://192.168.1.43:8620|Linux|usb|7",
        ).joinToString("\n")
        val hosts = KnownHosts.parse(text)
        assertEquals(listOf("http://192.168.1.40:8620", "http://192.168.1.43:8620"), hosts.map { it.endpoint })
        assertTrue(hosts[1].usb)
    }

    @Test fun labelsStayPlain() {
        assertEquals("macOS 10.10", KnownHosts.cleanLabel("  macOS|10.10\n "))
        assertEquals(40, KnownHosts.cleanLabel("x".repeat(80)).length)
        assertEquals("macOS · 10.0.0.5:8620", mac.title)
        assertEquals("10.0.0.5:8620", mac.copy(label = "").title)
        assertEquals("", KnownHosts.platformName("amiga"))
        assertEquals("Windows", KnownHosts.platformName("windows"))
    }
}
