package com.windock.app

import java.net.URI
import java.util.UUID

internal object TransferRules {
    const val MAX_FILES = 50
    const val MAX_FILE_BYTES = 8L * 1024 * 1024 * 1024
    const val MAX_BATCH_BYTES = 32L * 1024 * 1024 * 1024
    fun id(): String = UUID.randomUUID().toString().replace("-", "")
    fun validUri(value: String): Boolean = try {
        val uri = URI(value)
        value.length <= 8192 && uri.scheme == "content" && !uri.rawAuthority.isNullOrBlank() &&
            uri.rawUserInfo == null && uri.rawFragment == null && !uri.rawAuthority.contains('@') &&
            !value.any { it.code < 32 }
    } catch (_: Exception) { false }
    fun name(value: String?): String = value?.takeIf { it.isNotBlank() && it.length <= 1024 }
        ?.map { if (it.code < 32 || it.code == 127 || it in '\u202a'..'\u202e' || it in '\u2066'..'\u2069') '_' else it }?.joinToString("") ?: "Shared file"
    fun mime(value: String?): String = value?.takeIf { it.length <= 127 && it.matches(Regex("[a-zA-Z0-9!#\\$&^_.+-]+/[a-zA-Z0-9!#\\$&^_.+-]+")) } ?: "application/octet-stream"
    fun size(value: Long?): Long? = value?.takeIf { it >= 0 }
}
