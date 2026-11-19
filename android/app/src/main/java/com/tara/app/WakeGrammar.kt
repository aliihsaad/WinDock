package com.tara.app

/**
 * Pure rules for the hands-free wake phrase, so they can be unit tested without Android.
 * The wake recogniser only ever has to pick between "<greeting> <name>" phrases and noise,
 * which is why it is far lighter and more reliable than free dictation.
 */
object WakeGrammar {
    val DEFAULT_NAMES = listOf("tara")
    private val GREETINGS = listOf("hey", "ok", "okay", "hi")
    // Words a recogniser commonly hears instead of the name.
    private val ALIASES = mapOf("tara" to listOf("tarah", "tera", "terra"), "dock" to listOf("doc", "dog", "duck"))
    private val NAME = Regex("[a-z]{2,12}")
    const val MAX_NAMES = 5

    /** "Dock, Sid; Jarvis!" becomes [dock, sid, jarvis]. Empty input gives the defaults. */
    fun cleanNames(raw: String?): List<String> {
        val names = (raw ?: "").lowercase().split(Regex("[,;\\n]+")).map { it.replace(Regex("[^a-z]"), "") }
            .filter { NAME.matches(it) }.distinct().take(MAX_NAMES)
        return names.ifEmpty { DEFAULT_NAMES }
    }

    private fun spoken(names: List<String>) = names.flatMap { listOf(it) + (ALIASES[it] ?: emptyList()) }.distinct()

    /** JSON array for the recogniser: the bare name, every greeting with every name, plus an "unknown" bucket for everything else. */
    fun grammar(names: List<String>, strict: Boolean = false): String {
        val phrases = (if (strict) emptyList() else spoken(names)) + GREETINGS.flatMap { g -> spoken(names).map { "$g $it" } } + "[unk]"
        return phrases.joinToString(",", "[", "]") { "\"" + it + "\"" }
    }

    /** Null when the text is not a wake phrase ("Tara" or "Hey Tara"; only "Hey Tara" when strict); the words after it otherwise (often empty). */
    fun command(heard: String, names: List<String>, strict: Boolean = false): String? {
        val alt = spoken(names).joinToString("|") { Regex.escape(it) }
        val greeting = if (strict) "(?:hey|ok|okay|hi)[ ,]+" else "(?:(?:hey|ok|okay|hi)[ ,]+)?"
        val m = Regex("^\\s*$greeting(?:$alt)\\b[\\s,.:!-]*", RegexOption.IGNORE_CASE).find(heard) ?: return null
        return heard.substring(m.range.last + 1).trim()
    }
}
