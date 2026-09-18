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

    fun isValid(url: String?): Boolean = EndpointPolicy.normalize(url) != null

    fun load(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, null)
            ?.let { EndpointPolicy.normalize(it) }

    fun save(context: Context, url: String) {
        val endpoint = EndpointPolicy.normalize(url) ?: return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, endpoint)
            .apply()
    }
}
