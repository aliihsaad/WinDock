package com.windock.app

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

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

    private const val TIMEOUT_MS = 1500
    private const val ATTEMPTS = 3

    /** Parse a reply datagram into an endpoint, or null if it is not ours. */
    fun parseReply(message: String): String? {
        if (!message.startsWith(REPLY_PREFIX)) return null
        val endpoint = message.removePrefix(REPLY_PREFIX).trim()
        return endpoint.ifEmpty { null }
    }

    /**
     * Broadcast a probe and return the first valid endpoint, or null.
     * Runs on a background thread; never call from the main thread.
     */
    fun find(): String? {
        DatagramSocket().use { socket ->
            socket.broadcast = true
            socket.soTimeout = TIMEOUT_MS
            val payload = PROBE.toByteArray()
            val broadcast = InetAddress.getByName("255.255.255.255")

            repeat(ATTEMPTS) {
                try {
                    socket.send(DatagramPacket(payload, payload.size, broadcast, PORT))
                    val buffer = ByteArray(256)
                    val packet = DatagramPacket(buffer, buffer.size)
                    socket.receive(packet)
                    val reply = String(packet.data, 0, packet.length)
                    parseReply(reply)?.let { return it }
                } catch (_: SocketTimeoutException) {
                    // try again
                } catch (_: java.io.IOException) {
                    return null
                }
            }
        }
        return null
    }
}
