package com.windock.app

import java.net.URI

/** Strict numeric URLs, with non-private addresses admitted only on a current local link. */
object EndpointPolicy {
    fun isSecure(endpoint: String, networks: List<LocalNetwork>? = null): Boolean =
        normalize(endpoint, networks)?.startsWith("https://") == true

    fun normalize(input: String?, networks: List<LocalNetwork>? = null): String? {
        val endpoint = canonicalize(input) ?: return null
        val host = URI(endpoint).host
        return endpoint.takeIf { isLegacyHost(host) ||
            (networks ?: LocalNetwork.available()).any { it.containsPeer(host) } }
    }

    /** Storage/advertisement syntax only. This does NOT grant permission to connect. */
    fun canonicalize(input: String?): String? {
        if (input.isNullOrBlank() || input.length > 200) return null
        val value = input.trim().let { if ("://" in it) it else "http://$it" }
        return try {
            val uri = URI(value)
            val scheme = uri.scheme?.lowercase() ?: return null
            val host = uri.host?.lowercase() ?: return null
            if (scheme !in listOf("http", "https") || (host != "localhost" && !isUnicastIpv4(host))) return null
            if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
            if (!uri.rawPath.isNullOrEmpty() && uri.rawPath != "/") return null
            if (uri.port != -1 && uri.port !in 1..65535) return null
            // Bare IPs use WinDock's port; full URLs keep their explicit/default port.
            val port = if (uri.port == -1 && "://" !in input) 8620 else uri.port
            URI(scheme, null, host, port, null, null, null).toASCIIString()
        } catch (_: Exception) { null }
    }

    internal fun isUnicastIpv4(host: String): Boolean {
        val octets = ipv4Octets(host) ?: return false
        return octets[0] in 1..223 && !(octets[0] == 169 && octets[1] == 254)
    }

    private fun ipv4Octets(host: String): List<Int>? {
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { !it.matches(Regex("0|[1-9][0-9]{0,2}")) }) return null
        return parts.map { it.toInt() }.takeIf { it.all { octet -> octet in 0..255 } }
    }

    private fun isLegacyHost(host: String): Boolean {
        if (host == "localhost") return true
        val octets = ipv4Octets(host) ?: return false
        return octets[0] == 10 || octets[0] == 127 ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            // RFC 6598 shared address space, also used by Tailscale. This does not establish VPN trust.
            (octets[0] == 100 && octets[1] in 64..127)
    }

    fun allowsRequest(endpoint: String?, request: String?, networks: List<LocalNetwork>? = null): Boolean = try {
        val origin = URI(normalize(endpoint, networks) ?: "")
        val target = URI(request ?: "")
        fun port(uri: URI) = if (uri.port != -1) uri.port else if (uri.scheme == "https") 443 else 80
        origin.host != null && target.rawUserInfo == null &&
            target.scheme == origin.scheme && target.host == origin.host && port(target) == port(origin)
    } catch (_: Exception) { false }
}
