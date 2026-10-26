package com.windock.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Public, bounded identity check. Pairing remains entirely in the WebView. */
object HostProbe {
    fun read(endpoint: String, usb: Boolean): KnownHost? {
        if (!ServerUrl.isValid(endpoint) || Thread.currentThread().isInterrupted) return null
        var conn: HttpURLConnection? = null
        return try {
            conn = URL("$endpoint/health").openConnection() as HttpURLConnection
            conn.connectTimeout = 1200
            conn.readTimeout = 1200
            conn.instanceFollowRedirects = false
            conn.requestMethod = "GET"
            if (conn.responseCode != 200) return null
            conn.inputStream.use { stream ->
                val body = ByteArray(4097)
                var count = 0
                while (count < body.size && !Thread.currentThread().isInterrupted) {
                    val read = stream.read(body, count, body.size - count)
                    if (read == -1) break
                    count += read
                }
                if (count > 4096 || Thread.currentThread().isInterrupted) return null
                val health = JSONObject(String(body, 0, count, Charsets.UTF_8))
                if (health.optString("app") == "windock") {
                    val platform = KnownHosts.platformName(health.optString("platform"))
                    KnownHost(endpoint, KnownHosts.cleanLabel(health.optString("hostName")).ifBlank { platform },
                        usb, System.currentTimeMillis(), platform, KnownHosts.cleanId(health.optString("hostId")))
                } else null
            }
        } catch (_: Exception) { null }
        finally { conn?.disconnect() }
    }
}
