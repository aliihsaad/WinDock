package com.windock.app

import java.net.URI

/** Numeric LAN addresses avoid DNS rebinding and ambiguous URL parsing. */
object EndpointPolicy {
    fun normalize(input: String?): String? {
        if (input.isNullOrBlank() || input.length > 200) return null
        val value = input.trim().let { if ("://" in it) it else "http://$it" }
        return try {
            val uri = URI(value)
            val scheme = uri.scheme?.lowercase() ?: return null
            val host = uri.host?.lowercase() ?: return null
            if (scheme !in listOf("http", "https") || !isLocalHost(host)) return null
            if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
            if (!uri.rawPath.isNullOrEmpty() && uri.rawPath != "/") return null
            if (uri.port != -1 && uri.port !in 1..65535) return null
            // Bare IPs use WinDock's port; full URLs keep their explicit/default port.
            val port = if (uri.port == -1 && "://" !in input) 8620 else uri.port
            URI(scheme, null, host, port, null, null, null).toASCIIString()
        } catch (_: Exception) { null }
    }

    private fun isLocalHost(host: String): Boolean {
        if (host == "localhost") return true
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { !it.matches(Regex("0|[1-9][0-9]{0,2}")) }) return false
        val octets = parts.map { it.toInt() }
        if (octets.any { it !in 0..255 }) return false
        return octets[0] == 10 || octets[0] == 127 ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 172 && octets[1] in 16..31)
    }

    fun allowsRequest(endpoint: String?, request: String?): Boolean = try {
        val origin = URI(normalize(endpoint) ?: "")
        val target = URI(request ?: "")
        fun port(uri: URI) = if (uri.port != -1) uri.port else if (uri.scheme == "https") 443 else 80
        origin.host != null && target.rawUserInfo == null &&
            target.scheme == origin.scheme && target.host == origin.host && port(target) == port(origin)
    } catch (_: Exception) { false }
}
