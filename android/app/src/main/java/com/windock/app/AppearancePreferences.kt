package com.windock.app

import android.content.SharedPreferences
import org.json.JSONObject

/** Only non-secret appearance values cross this bridge, never arbitrary app preferences. */
class AppearancePreferences(private val preferences: SharedPreferences) {
    private data class Target(val endpoint: String, val scope: String)
    private var target: Target? = null

    @Synchronized fun select(endpoint: String?, hostId: String? = null) {
        target = EndpointPolicy.normalize(endpoint)?.let {
            Target(it, KnownHosts.cleanId(hostId).ifEmpty { it })
        }
    }

    // Called on WebView's JavaScript bridge thread. Commit before acknowledging a save,
    // so a later process exit cannot discard a queued WebView/localStorage write.
    @Synchronized fun snapshot(origin: String, legacy: String): String? {
        val selected = target?.takeIf { EndpointPolicy.allowsRequest(it.endpoint, origin) } ?: return null
        val ownerKey = "origin:${selected.endpoint}"
        val previousOwner = preferences.getString(ownerKey, null)
        val initializedKey = "initialized:${selected.scope}"
        val edit = preferences.edit().putString(ownerKey, selected.scope).putBoolean(initializedKey, true)
        val values = JSONObject()
        for (key in KEYS) preferences.getString("${selected.scope}:$key", null)?.let { values.put(key, it) }
        // Import once, atomically with the scope marker. An address reused by a different
        // PC must not adopt that PC's old web values, even after subsequent reloads.
        if (!preferences.getBoolean(initializedKey, false) && (previousOwner == null || previousOwner == selected.scope)) {
            val old = try { if (legacy.length <= 4096) JSONObject(legacy) else JSONObject() } catch (_: Exception) { JSONObject() }
            for (key in KEYS) {
                val value = old.opt(key) as? String ?: continue
                if (valid(key, value)) { values.put(key, value); edit.putString("${selected.scope}:$key", value) }
            }
        }
        if (!edit.commit()) return null
        return JSONObject().put("scope", selected.scope).put("values", values).toString()
    }

    @Synchronized fun save(origin: String, scope: String, key: String, value: String): Boolean {
        val selected = target ?: return false
        if (scope != selected.scope || !EndpointPolicy.allowsRequest(selected.endpoint, origin) || !valid(key, value)) return false
        return preferences.edit().putString("$scope:$key", value).commit()
    }

    private fun valid(key: String, value: String): Boolean {
        if (key !in KEYS || value.length > 2048) return false
        if (key == "windock-performance") return value in listOf("auto", "on", "off")
        return try {
            val layout = JSONObject(value)
            layout.keys().asSequence().all { field ->
                when (field) {
                    "perPage", "columns", "rows", "iconSize" -> layout.get(field) is Number
                    "immersive", "showLabels" -> layout.get(field) is Boolean
                    "background" -> layout.getString(field) in listOf("aurora", "dusk", "ember", "midnight")
                    "theme" -> layout.getString(field) in listOf("glass", "frost", "smoke")
                    else -> false
                }
            }
        } catch (_: Exception) { false }
    }

    companion object {
        private val KEYS = listOf("windock-performance", "windock-layout")
    }
}
