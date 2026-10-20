package com.windock.app

/**
 * The PCs this phone has paired with, most recent first, so switching between
 * a desk PC and a laptop is one tap instead of a search or a typed address.
 *
 * Pure functions over an immutable list: the activity persists the text form
 * through [ServerUrl]. Only validated endpoints are kept, labels are plain
 * text, and the PIN and session cookie stay in the WebView as before.
 */
data class KnownHost(val endpoint: String, val label: String, val usb: Boolean, val lastSeen: Long) {
    /** What the list shows: the platform and the address, or just the address. */
    val title: String get() = if (label.isBlank()) endpoint.removePrefix("http://") else "$label · ${endpoint.removePrefix("http://")}"
}

object KnownHosts {
    const val LIMIT = 8
    private const val MAX_LABEL = 40

    /** Put [host] first, replacing an older entry for the same endpoint, and keep at most [LIMIT]. */
    fun remember(hosts: List<KnownHost>, host: KnownHost): List<KnownHost> {
        val endpoint = EndpointPolicy.normalize(host.endpoint) ?: return hosts
        val clean = host.copy(endpoint = endpoint, label = cleanLabel(host.label))
        return (listOf(clean) + hosts.filter { it.endpoint != endpoint }).take(LIMIT)
    }

    fun forget(hosts: List<KnownHost>, endpoint: String): List<KnownHost> {
        val target = EndpointPolicy.normalize(endpoint) ?: return hosts
        return hosts.filter { it.endpoint != target }
    }

    /** Labels come from the PC's health reply; keep them short and single-line. */
    fun cleanLabel(label: String?): String =
        (label ?: "").replace(Regex("[\\p{Cntrl}|]"), " ").trim().take(MAX_LABEL)

    /** A readable name for the platform id the host reports. */
    fun platformName(platform: String?): String = when (platform) {
        "windows" -> "Windows"
        "linux" -> "Linux"
        "darwin" -> "macOS"
        else -> ""
    }

    /** One host per line, fields separated by `|`; unreadable lines are skipped. */
    fun serialize(hosts: List<KnownHost>): String =
        hosts.joinToString("\n") { listOf(it.endpoint, cleanLabel(it.label), if (it.usb) "usb" else "wifi", it.lastSeen.toString()).joinToString("|") }

    fun parse(text: String?): List<KnownHost> {
        if (text.isNullOrBlank()) return emptyList()
        val hosts = ArrayList<KnownHost>()
        for (line in text.lineSequence()) {
            val parts = line.split('|')
            if (parts.size != 4) continue
            val endpoint = EndpointPolicy.normalize(parts[0]) ?: continue
            val usb = when (parts[2]) { "usb" -> true; "wifi" -> false; else -> continue }
            val lastSeen = parts[3].toLongOrNull()?.takeIf { it >= 0 } ?: continue
            if (hosts.any { it.endpoint == endpoint }) continue
            hosts.add(KnownHost(endpoint, cleanLabel(parts[1]), usb, lastSeen))
            if (hosts.size == LIMIT) break
        }
        return hosts
    }
}
