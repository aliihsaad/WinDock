package com.tara.app

/**
 * Precise listening for commands. The recogniser is first limited to words Tara knows (command words,
 * numbers, the wake names and the names of apps on the dock), which it gets right far more often than open
 * speech. Anything with an unknown word is run again as open speech by the engine, so questions still work.
 */
object CommandGrammar {
    private val BASE = listOf(
        "hey", "ok", "okay", "hi", "open", "launch", "start", "run", "close", "quit", "exit", "stop", "cancel", "switch", "go", "to", "focus", "show", "bring", "up", "down",
        "play", "pause", "resume", "continue", "next", "previous", "last", "back", "skip", "song", "track", "video", "volume", "mute", "unmute", "louder", "quieter", "softer",
        "turn", "it", "raise", "lower", "increase", "decrease", "reduce", "the", "set", "at", "percent", "brightness", "lock", "sleep", "restart", "reboot", "shut", "power", "off", "on",
        "screenshot", "screen", "record", "recording", "battery", "cpu", "gpu", "wifi", "internet", "what", "is", "my", "tell", "me", "when", "render", "finishes", "then", "watch", "and",
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
        "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred",
    )
    private val WORD = Regex("^[a-z0-9]{2,20}$")

    /** One JSON array of single words plus "[unk]", for Vosk's grammar mode. */
    fun grammar(names: List<String>, vocabulary: List<String>): String {
        val words = LinkedHashSet<String>()
        words += BASE
        for (phrase in names.flatMap { WakeGrammar.spoken(it) } + vocabulary)
            for (piece in phrase.lowercase().split(Regex("[^a-z0-9]+"))) if (WORD.matches(piece)) words += piece
        words += "[unk]"
        // Every word is [a-z0-9] or "[unk]", so no escaping is needed.
        return words.joinToString(",", "[", "]") { "\"$it\"" }
    }

    fun clean(text: String): String = text.replace("[unk]", " ").replace(Regex("\\s+"), " ").trim()

    /** True when every word was one Tara knows, so the grammar answer can be trusted. */
    fun trusted(text: String): Boolean = text.isNotBlank() && !text.contains("[unk]")
}
