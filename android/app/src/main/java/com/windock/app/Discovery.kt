package com.windock.app

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.net.URI

/**
 * LAN discovery client.
 *
 * These constants MUST match src/discovery.js on the host. `verify-android.mjs`
 * asserts that agreement so the two implementations cannot drift apart
 * silently — a mismatch here would make the app simply never find the PC.
 */
object Discovery {
    const val PORT = 41234
    const val PROBE = "windock:discover:v1"
    const val REPLY_PREFIX = "windock:here:v1:"

    private const val TIMEOUT_MS = 500
    private const val ATTEMPTS = 3

    fun useUsbOnStartup(previousUsb: Boolean, networks: List<LocalNetwork>): Boolean =
        previousUsb && networks.any { it.wired }

    fun permitsRememberedEndpoint(endpoint: String, usbOnly: Boolean, networks: List<LocalNetwork>): Boolean {
        val url = EndpointPolicy.normalize(endpoint) ?: return false
        val host = URI(url).host.orEmpty()
        return if (usbOnly) networks.any { it.wired && it.contains(host) }
        else networks.any { !it.wired && it.contains(host) } || networks.none { it.wired && it.contains(host) }
    }

    /** Parse a reply datagram into an endpoint, or null if it is not ours. */
    fun parseReply(message: String, sender: String? = null): String? {
        if (!message.startsWith(REPLY_PREFIX)) return null
        val endpoint = EndpointPolicy.normalize(message.removePrefix(REPLY_PREFIX).trim()) ?: return null
        if (sender == null) return endpoint
        // A PC with Wi-Fi and USB may advertise its Wi-Fi IP. The datagram's
        // source is the address that actually answered on this cable/network.
        val advertised = URI(endpoint)
        return try {
            EndpointPolicy.normalize(URI(advertised.scheme, null, sender, advertised.port, null, null, null).toString())
        } catch (_: Exception) { null }
    }

    /**
     * Broadcast a probe and return the first valid endpoint, or null.
     * Runs on a background thread; never call from the main thread.
     */
    fun find(reachable: (String) -> Boolean, usbOnly: Boolean = false,
             networks: List<LocalNetwork> = LocalNetwork.available(), port: Int = PORT): String? {
        val links = networks.filter { it.wired == usbOnly }
        // USB mode never silently falls back to Wi-Fi. The wildcard broadcast
        // preserves discovery on phones which hide interface enumeration.
        val targets: List<LocalNetwork?> = if (usbOnly) links else links + listOf(null)
        for (link in targets) {
            if (Thread.currentThread().isInterrupted) return null
            val found = findOnLink(link, port) { permitsRememberedEndpoint(it, usbOnly, networks) && reachable(it) }
            if (found != null) return found
        }
        return null
    }

    data class Candidate(val endpoint: String, val usb: Boolean)

    /** Collect before health checks so a slow or offline PC cannot hide other replies. */
    fun findAll(networks: List<LocalNetwork> = LocalNetwork.available(), port: Int = PORT): List<Candidate> {
        val sockets = mutableListOf<Pair<LocalNetwork?, DatagramSocket>>()
        val found = linkedMapOf<String, Candidate>()
        try {
            for (link in networks + listOf(null)) {
                val socket = DatagramSocket(null)
                try {
                    socket.bind(InetSocketAddress(link?.let { InetAddress.getByName(it.address) }, 0))
                    socket.broadcast = true
                    socket.soTimeout = 25
                    sockets.add(link to socket)
                } catch (_: java.io.IOException) { socket.close() }
            }
            val deadline = System.nanoTime() + 1_200_000_000L
            var nextProbe = 0L
            val payload = PROBE.toByteArray()
            while (sockets.isNotEmpty() && System.nanoTime() < deadline && !Thread.currentThread().isInterrupted) {
                if (System.nanoTime() >= nextProbe) {
                    sockets.forEach { (link, socket) ->
                        try {
                            socket.send(DatagramPacket(payload, payload.size,
                                InetAddress.getByName(link?.broadcast ?: "255.255.255.255"), port))
                        } catch (_: java.io.IOException) { /* Another link may still answer. */ }
                    }
                    nextProbe = System.nanoTime() + 500_000_000L
                }
                for ((link, socket) in sockets) {
                    if (Thread.currentThread().isInterrupted || System.nanoTime() >= deadline) break
                    try {
                        val packet = DatagramPacket(ByteArray(256), 256)
                        socket.receive(packet)
                        val sender = packet.address.hostAddress ?: continue
                        if (link != null && !link.contains(sender)) continue
                        val endpoint = parseReply(String(packet.data, 0, packet.length), sender) ?: continue
                        val usb = link?.wired ?: (networks.any { it.wired && it.contains(sender) } &&
                            networks.none { !it.wired && it.contains(sender) })
                        found.putIfAbsent(endpoint, Candidate(endpoint, usb))
                        if (found.size == 24) return found.values.toList()
                    } catch (_: java.io.IOException) { /* Timeout or unavailable interface. */ }
                }
            }
            return found.values.toList()
        } finally { sockets.forEach { it.second.close() } }
    }

    private fun findOnLink(link: LocalNetwork?, port: Int, reachable: (String) -> Boolean): String? = try {
        DatagramSocket(null).use { socket ->
            socket.bind(InetSocketAddress(link?.let { InetAddress.getByName(it.address) }, 0))
            socket.broadcast = true
            socket.soTimeout = TIMEOUT_MS
            val payload = PROBE.toByteArray()
            val broadcast = InetAddress.getByName(link?.broadcast ?: "255.255.255.255")

            repeat(ATTEMPTS) {
                try {
                    socket.send(DatagramPacket(payload, payload.size, broadcast, port))
                    val deadline = System.nanoTime() + TIMEOUT_MS * 1_000_000L
                    while (System.nanoTime() < deadline) {
                        socket.soTimeout = ((deadline - System.nanoTime()) / 1_000_000L).coerceIn(1, TIMEOUT_MS.toLong()).toInt()
                        val buffer = ByteArray(256)
                        val packet = DatagramPacket(buffer, buffer.size)
                        socket.receive(packet)
                        val sender = packet.address.hostAddress ?: continue
                        if (link != null && !link.contains(sender)) continue
                        val reply = String(packet.data, 0, packet.length)
                        parseReply(reply, sender)?.takeIf(reachable)?.let { return it }
                    }
                } catch (_: SocketTimeoutException) {
                    // try again
                } catch (_: java.io.IOException) {
                    return null
                }
            }
        }
        null
    } catch (_: java.io.IOException) { null }
}
