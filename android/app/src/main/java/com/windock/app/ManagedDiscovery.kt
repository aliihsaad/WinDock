package com.windock.app

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI

/** Discovery is an untrusted routing hint. SecureTransport must verify every candidate. */
object ManagedDiscovery {
    const val PROBE = "windock:discover:v3"
    const val PREFIX = "windock:here:v3:"
    data class Candidate(val endpoint: String, val hostId: String, val usb: Boolean = false)
    fun parseCandidate(text: String, sender: String, networks: List<LocalNetwork>? = null): Candidate? = try {
        if (!text.startsWith(PREFIX) || text.length > 512) null else {
            val json = JSONObject(text.removePrefix(PREFIX))
            val id = KnownHosts.cleanId(json.optString("hostId"))
            if (id.isEmpty()) null else {
                val uri = URI(json.getString("endpoint"))
                if (uri.scheme != "https" || uri.port !in 1..65535 || uri.rawUserInfo != null ||
                    uri.rawQuery != null || uri.rawFragment != null || !uri.rawPath.isNullOrEmpty()) null
                else EndpointPolicy.normalize("https://$sender:${uri.port}", networks)?.let { Candidate(it, id) }
            }
        }
    } catch (_: Exception) { null }
    fun parse(text: String, sender: String, hostId: String): String? =
        parseCandidate(text, sender)?.takeIf { it.hostId == hostId }?.endpoint
    fun find(hostId: String, usbOnly: Boolean = false): List<String> =
        collect(hostId, usbOnly, LocalNetwork.available(), Discovery.PORT).map { it.endpoint }
    fun findAll(networks: List<LocalNetwork> = LocalNetwork.available(), port: Int = Discovery.PORT): List<Candidate> =
        collect(null, false, networks, port)
    private fun collect(hostId: String?, usbOnly: Boolean, networks: List<LocalNetwork>, port: Int): List<Candidate> {
        val links = networks.filter { !usbOnly || it.wired }
        val sockets = mutableListOf<Pair<LocalNetwork?, DatagramSocket>>()
        val found = linkedMapOf<String, Candidate>()
        try {
            for (link in if (usbOnly) links else links + listOf(null)) {
                val socket = DatagramSocket(null)
                try { socket.bind(InetSocketAddress(link?.let { InetAddress.getByName(it.address) }, 0)); socket.broadcast = true; socket.soTimeout = 30; sockets.add(link to socket) }
                catch (_: Exception) { socket.close() }
            }
            val end = System.nanoTime() + 1_300_000_000L; var next = 0L
            while (System.nanoTime() < end && !Thread.currentThread().isInterrupted && sockets.isNotEmpty()) {
                if (System.nanoTime() >= next) {
                    val payload = PROBE.toByteArray()
                    for ((link, socket) in sockets) try { socket.send(DatagramPacket(payload, payload.size, InetAddress.getByName(link?.broadcast ?: "255.255.255.255"), port)) } catch (_: Exception) {}
                    next = System.nanoTime() + 500_000_000L
                }
                for ((link, socket) in sockets) {
                    if (System.nanoTime() >= end) break
                    try {
                        val packet = DatagramPacket(ByteArray(513), 513); socket.receive(packet)
                        val sender = packet.address.hostAddress ?: continue
                        if (link != null && !link.contains(sender)) continue
                        parseCandidate(String(packet.data, 0, packet.length), sender, networks)?.let { candidate ->
                            if (hostId == null || hostId == candidate.hostId) found.putIfAbsent(candidate.endpoint,
                                candidate.copy(usb = links.any { it.wired && it.contains(sender) }))
                        }
                        if (found.size >= 8) return found.values.toList()
                    } catch (_: java.io.IOException) {}
                }
            }
        } finally { sockets.forEach { it.second.close() } }
        return found.values.toList()
    }
}
