package com.windock.app

import android.content.Context

/**
 * Remembers the last endpoint that actually answered, so the app opens straight
 * into the dock instead of re-discovering on every launch.
 *
 * Only a validated http(s) endpoint is stored. The PIN and session cookie stay
 * in the WebView; this layer never handles credentials and cannot bypass
 * pairing.
 */
object ServerUrl {
    private const val PREFS = "windock"
    private const val KEY = "endpoint"
    private const val FORGOTTEN = "forgottenEndpoints"
    private const val FORGOTTEN_HOSTS = "forgottenHosts"
    private const val FORGOTTEN_ALIASES = "forgottenAliases"

    private fun key(usbOnly: Boolean) = if (usbOnly) "usbEndpoint" else "wifiEndpoint"

    /** Preserve the old single address under its original transport before switching modes. */
    fun migrate(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.contains("usbEndpoint") || prefs.contains("wifiEndpoint")) return
        val old = prefs.getString(KEY, null)?.let { EndpointPolicy.normalize(it) } ?: return
        prefs.edit().putString(key(PhonePreferences.usbOnly(context)), old).apply()
    }

    fun isValid(url: String?): Boolean = EndpointPolicy.normalize(url) != null

    fun load(context: Context, usbOnly: Boolean = PhonePreferences.usbOnly(context)): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(key(usbOnly), null)
            ?.let { EndpointPolicy.normalize(it) }
            ?.takeIf { canAutoConnect(context, it) }

    fun save(context: Context, url: String, usbOnly: Boolean = PhonePreferences.usbOnly(context)) {
        val endpoint = EndpointPolicy.normalize(url) ?: return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(key(usbOnly), endpoint)
            .apply()
    }

    private const val KNOWN = "knownHosts"

    /** Every PC this phone has reached, most recent first. */
    fun knownHosts(context: Context): List<KnownHost> =
        KnownHosts.parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KNOWN, null))

    fun rememberHost(context: Context, host: KnownHost) {
        val endpoint = EndpointPolicy.normalize(host.endpoint) ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val hosts = KnownHosts.remember(knownHosts(context), host)
        val aliases = prefs.getStringSet(FORGOTTEN_ALIASES, emptySet()).orEmpty()
        val restored = aliases.filter { host.hostId.isNotEmpty() && it.startsWith("${host.hostId}|") }.toSet()
        val forgotten = prefs.getStringSet(FORGOTTEN, emptySet()).orEmpty() - endpoint - restored.map { it.substringAfter('|') }.toSet()
        prefs.edit().putString(KNOWN, KnownHosts.serialize(hosts)).putStringSet(FORGOTTEN, forgotten)
            .putStringSet(FORGOTTEN_ALIASES, aliases - restored)
            .putStringSet(FORGOTTEN_HOSTS, prefs.getStringSet(FORGOTTEN_HOSTS, emptySet()).orEmpty() - host.hostId).apply()
    }

    /** Forget is persistent even if this endpoint answers automatic discovery again. */
    fun forgetHost(context: Context, endpoint: String, hostId: String = "") {
        val target = EndpointPolicy.normalize(endpoint) ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val hosts = knownHosts(context)
        val identity = KnownHosts.cleanId(hostId).ifBlank { hosts.find { it.endpoint == target }?.hostId.orEmpty() }
        val removed = hosts.filter { it.endpoint == target || (identity.isNotEmpty() && it.hostId == identity) }
        val addresses = removed.map { it.endpoint }.toSet() + target
        val edit = prefs.edit().putString(KNOWN, KnownHosts.serialize(hosts - removed.toSet()))
            .putStringSet(FORGOTTEN, prefs.getStringSet(FORGOTTEN, emptySet()).orEmpty() + addresses)
        if (identity.isNotEmpty()) {
            edit.putStringSet(FORGOTTEN_HOSTS, prefs.getStringSet(FORGOTTEN_HOSTS, emptySet()).orEmpty() + identity)
                .putStringSet(FORGOTTEN_ALIASES, prefs.getStringSet(FORGOTTEN_ALIASES, emptySet()).orEmpty() +
                    addresses.map { "$identity|$it" }.toSet())
        }
        for (slot in listOf(KEY, key(false), key(true))) {
            if (EndpointPolicy.normalize(prefs.getString(slot, null)) in addresses) edit.remove(slot)
        }
        edit.apply()
    }

    fun canAutoConnect(context: Context, endpoint: String): Boolean {
        val target = EndpointPolicy.normalize(endpoint) ?: return false
        return target !in context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet(FORGOTTEN, emptySet()).orEmpty()
    }

    fun canAutoConnect(context: Context, host: KnownHost): Boolean = canAutoConnect(context, host.endpoint) &&
        (host.hostId.isEmpty() || host.hostId !in context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet(FORGOTTEN_HOSTS, emptySet()).orEmpty())
}
