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

    fun save(context: Context, url: String, usbOnly: Boolean = PhonePreferences.usbOnly(context)) {
        val endpoint = EndpointPolicy.normalize(url) ?: return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(key(usbOnly), endpoint)
            .apply()
    }
}
