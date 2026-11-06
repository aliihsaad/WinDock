package com.windock.app

import java.net.Inet4Address
import java.net.NetworkInterface

/** A local IPv4 link, including Android's USB tethering interface. */
data class LocalNetwork(val address: String, val broadcast: String, val prefixLength: Int, val wired: Boolean) {
    /** Only a real unicast peer, never a default route, network or broadcast address. */
    fun containsPeer(host: String): Boolean {
        if (prefixLength !in 8..30 || !EndpointPolicy.isUnicastIpv4(address) ||
            !EndpointPolicy.isUnicastIpv4(host) || !contains(host)) return false
        val own = ipv4(address) ?: return false
        val peer = ipv4(host) ?: return false
        val mask = (0xffffffffL shl (32 - prefixLength)) and 0xffffffffL
        val network = own and mask
        val last = network or (mask xor 0xffffffffL)
        return ipv4(broadcast) == last && own != network && own != last && peer != network && peer != last
    }

    fun contains(host: String): Boolean {
        val own = ipv4(address) ?: return false
        val peer = ipv4(host) ?: return false
        if (prefixLength !in 1..32) return false
        val mask = (0xffffffffL shl (32 - prefixLength)) and 0xffffffffL
        return (own and mask) == (peer and mask)
    }

    companion object {
        private fun ipv4(value: String): Long? {
            val parts = value.split('.')
            if (parts.size != 4) return null
            var result = 0L
            for (part in parts) {
                if (!part.matches(Regex("0|[1-9][0-9]{0,2}"))) return null
                val number = part.toInt()
                if (number !in 0..255) return null
                result = (result shl 8) or number.toLong()
            }
            return result
        }

        fun isWiredName(name: String) = Regex("^(rndis|usb|ncm|eth|enx)", RegexOption.IGNORE_CASE).containsMatchIn(name)

        /** Read again on every connection attempt so plugging in a cable needs no restart. */
        fun available(): List<LocalNetwork> = try {
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().flatMap { link ->
                if (!link.isUp || link.isLoopback || link.isPointToPoint ||
                    Regex("^(rmnet|ccmni|pdp|wwan|tun|tap|wg|tailscale|ipsec)", RegexOption.IGNORE_CASE).containsMatchIn(link.name)) emptyList()
                else link.interfaceAddresses.mapNotNull { entry ->
                    val local = (entry.address as? Inet4Address)?.hostAddress
                    val broadcast = entry.broadcast?.hostAddress
                    // Do not use connection admission here: that would discard non-RFC1918
                    // LANs and recurse into this enumeration. Trust only OS link metadata.
                    if (local == null || broadcast == null || !EndpointPolicy.isUnicastIpv4(local)) null
                    else LocalNetwork(local, broadcast, entry.networkPrefixLength.toInt(), isWiredName(link.name))
                }
            }.distinctBy { it.address }.take(8)
        } catch (_: Exception) { emptyList() }
    }
}
