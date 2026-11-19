package com.windock.app

/**
 * Pure rules for the hands-free wake phrase, so they can be unit tested without Android.
 * The wake recogniser only ever has to pick between "<greeting> <name>" phrases and noise,
 * which is why it is far lighter and more reliable than free dictation.
 */
object WakeGrammar {
    val DEFAULT_NAMES = listOf("dock", "sid")
    private val GREETINGS = listOf("hey", "ok", "okay", "hi")
    // Words a recogniser commonly hears instead of the name.
    private val ALIASES = mapOf("dock" to listOf("doc", "dog", "duck"))
    private val NAME = Regex("[a-z]{2,12}")
    const val MAX_NAMES = 5

    /** "Dock, Sid; Jarvis!" becomes [dock, sid, jarvis]. Empty input gives the defaults. */
    fun cleanNames(raw: String?): List<String> {
        val names = (raw ?: "").lowercase().split(Regex("[,;\\n]+")).map { it.replace(Regex("[^a-z]"), "") }
            .filter { NAME.matches(it) }.distinct().take(MAX_NAMES)
        return names.ifEmpty { DEFAULT_NAMES }
    }

    private fun spoken(names: List<String>) = names.flatMap { listOf(it) + (ALIASES[it] ?: emptyList()) }.distinct()

    /** JSON array for the recogniser: every greeting with every name, plus an "unknown" bucket for everything else. */
    fun grammar(names: List<String>): String {
        val phrases = GREETINGS.flatMap { g -> spoken(names).map { "$g $it" } } + "[unk]"
        return phrases.joinToString(",", "[", "]") { "\"" + it + "\"" }
    }

    /** Null when the text is not a wake phrase; the words after it otherwise (often empty). */
    fun command(heard: String, names: List<String>): String? {
        val alt = spoken(names).joinToString("|") { Regex.escape(it) }
        val m = Regex("^\\s*(?:hey|ok|okay|hi)[ ,]+(?:$alt)\\b[\\s,.:!-]*", RegexOption.IGNORE_CASE).find(heard) ?: return null
        return heard.substring(m.range.last + 1).trim()
    }
}
