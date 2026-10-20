package com.windock.app

import android.speech.SpeechRecognizer
import java.util.Locale

/** Pure decisions behind voice commands; the Activity only wires them to Android. */
object VoicePolicy {
    /**
     * Languages to try, most specific first. Offline packs are published per region, so a phone set
     * to es-VE falls back to the Spanish packs phones actually ship instead of failing outright.
     */
    fun languageCandidates(locale: Locale): List<String> {
        val language = locale.language.lowercase(Locale.ROOT)
        val region = locale.country.uppercase(Locale.ROOT)
        val candidates = mutableListOf<String>()
        if (language.isNotEmpty() && region.isNotEmpty()) candidates += "$language-$region"
        when (language) {
            "es" -> candidates += listOf("es-ES", "es-US", "es-MX")
            "en" -> candidates += listOf("en-US", "en-GB")
            "pt" -> candidates += listOf("pt-BR", "pt-PT")
            "" -> candidates += "en-US"
            else -> candidates += language
        }
        return candidates.distinct()
    }

    /** Collapse SpeechRecognizer error numbers into the few outcomes the dock explains. */
    fun errorCode(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-match"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language"
        else -> "unavailable"
    }

    /**
     * The pack worth downloading after every candidate failed: the first candidate the phone
     * says it supports on-device but has not installed or already queued, else any pack of the
     * same language (phones ship es-US or es-419 where the device locale says es-VE).
     */
    fun languageToDownload(candidates: List<String>, supported: List<String>?, installed: List<String>?, pending: List<String>?): String? {
        if (supported == null) return null
        val taken = (installed.orEmpty() + pending.orEmpty()).map { it.lowercase(Locale.ROOT) }.toSet()
        val available = supported.filter { it.lowercase(Locale.ROOT) !in taken }
        candidates.firstOrNull { candidate -> available.any { it.equals(candidate, ignoreCase = true) } }?.let { return it }
        val language = candidates.firstOrNull()?.substringBefore('-')?.lowercase(Locale.ROOT) ?: return null
        return available.firstOrNull { it.lowercase(Locale.ROOT) == language || it.lowercase(Locale.ROOT).startsWith("$language-") }
    }

    /** One line the dock can show so a failure is diagnosable without adb. */
    fun describeSupport(onDevice: Boolean, tried: List<String>, installed: List<String>?, supported: List<String>?, pending: List<String>?): String {
        val parts = mutableListOf("on-device recognizer: " + if (onDevice) "yes" else "no", "tried: " + tried.joinToString(", "))
        if (installed != null) parts += "installed: " + (installed.takeIf { it.isNotEmpty() }?.joinToString(", ") ?: "none")
        if (supported != null) parts += "available: " + (supported.takeIf { it.isNotEmpty() }?.joinToString(", ") ?: "none")
        if (!pending.isNullOrEmpty()) parts += "downloading: " + pending.joinToString(", ")
        return parts.joinToString(" · ")
    }

    /** Whether a failed attempt should be retried with the next language candidate. */
    fun shouldRetryLanguage(code: String, remaining: Int): Boolean = code == "language" && remaining > 0

    /** The transcript to hand to the dock: the recognizer's best non-blank candidate. */
    fun transcript(results: List<String>?): String? =
        results?.asSequence()?.map { it.trim() }?.firstOrNull { it.isNotEmpty() }
}
