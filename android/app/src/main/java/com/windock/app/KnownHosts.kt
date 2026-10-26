package com.windock.app

/**
 * The PCs this phone has reached, most recent first, so switching between
 * a desk PC and a laptop is one tap instead of a search or a typed address.
 *
 * Pure functions over an immutable list: the activity persists the text form
 * through [ServerUrl]. Only validated endpoints are kept, labels are plain
 * text, and the PIN and session cookie stay in the WebView as before.
 */
data class KnownHost(val endpoint: String, val label: String, val usb: Boolean, val lastSeen: Long,
                     val platform: String = "", val hostId: String = "") {
    val name: String get() = label.ifBlank { platform.ifBlank { endpoint.removePrefix("http://") } }
    val identity: String get() = hostId.ifBlank { endpoint }
    val title: String get() = if (label.isBlank()) endpoint.removePrefix("http://") else "$label · ${endpoint.removePrefix("http://")}"
}

object KnownHosts {
    const val LIMIT = 8
    private const val MAX_LABEL = 40

    /** Put [host] first, replacing an older entry for the same endpoint, and keep at most [LIMIT]. */
    fun remember(hosts: List<KnownHost>, host: KnownHost): List<KnownHost> {
        val endpoint = EndpointPolicy.normalize(host.endpoint) ?: return hosts
        val clean = host.copy(endpoint = endpoint, label = cleanLabel(host.label), platform = cleanLabel(host.platform), hostId = cleanId(host.hostId))
        return (listOf(clean) + hosts.filter { it.endpoint != endpoint && it.identity != clean.identity }).take(LIMIT)
    }

    fun forget(hosts: List<KnownHost>, endpoint: String): List<KnownHost> {
        val target = EndpointPolicy.normalize(endpoint) ?: return hosts
        return hosts.filter { it.endpoint != target }
    }

    /** Labels come from the PC's health reply; keep them short and single-line. */
    fun cleanLabel(label: String?): String =
        (label ?: "").replace(Regex("[\\p{Cntrl}\\p{Cf}\\p{Zl}\\p{Zp}|]"), " ").trim().take(MAX_LABEL)

    fun cleanId(value: String?): String = value?.takeIf {
        it.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
    }.orEmpty()

    /** A readable name for the platform id the host reports. */
    fun platformName(platform: String?): String = when (platform) {
        "windows" -> "Windows"
        "linux" -> "Linux"
        "darwin" -> "macOS"
        else -> ""
    }

    /** One host per line, fields separated by `|`; unreadable lines are skipped. */
    fun serialize(hosts: List<KnownHost>): String =
        hosts.take(LIMIT).joinToString("\n") { listOf(it.endpoint, cleanLabel(it.label), if (it.usb) "usb" else "wifi", it.lastSeen.toString(), cleanLabel(it.platform), cleanId(it.hostId)).joinToString("|") }

    fun parse(text: String?): List<KnownHost> {
        if (text.isNullOrBlank()) return emptyList()
        val hosts = ArrayList<KnownHost>()
        for (line in text.lineSequence()) {
            val parts = line.split('|')
            // Four fields were used by the original #20 history model.
            if (parts.size !in 4..6) continue
            val endpoint = EndpointPolicy.normalize(parts[0]) ?: continue
            val usb = when (parts[2]) { "usb" -> true; "wifi" -> false; else -> continue }
            val lastSeen = parts[3].toLongOrNull()?.takeIf { it >= 0 } ?: continue
            val host = KnownHost(endpoint, cleanLabel(parts[1]), usb, lastSeen, cleanLabel(parts.getOrNull(4)), cleanId(parts.getOrNull(5)))
            if (hosts.any { it.endpoint == endpoint || it.identity == host.identity }) continue
            hosts.add(host)
            if (hosts.size == LIMIT) break
        }
        return hosts
    }
}
