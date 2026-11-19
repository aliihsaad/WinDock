package com.windock.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject

/** Pure wake-word rule so it can be unit tested without Android. */
object WakeWord {
    private val WAKE = Regex("^\\s*(?:hey|ok|okay|hi)[ ,]+(?:dock|doc|dog|duck)\\b[\\s,.:!-]*", RegexOption.IGNORE_CASE)

    /** Null when the phrase does not start with the wake word; "" when it is only the wake word. */
    fun command(heard: String): String? {
        val m = WAKE.find(heard) ?: return null
        return heard.substring(m.range.last + 1).trim()
    }
}

/**
 * Press-to-talk and an optional "Hey Dock" mode using Android's own speech recognition.
 * It listens only while the dock is on screen; nothing runs in the background.
 */
class VoiceAssistant(private val activity: Activity, private val run: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var speaking = false
    private var handsFree = false
    private var wantCommand = false   // wake word already heard, the next phrase is the command
    private var pressToTalk = false
    private var waitingForPermission = false

    private fun js(call: String) = run("window.WinDockVoice&&window.WinDockVoice.$call")
    private fun hasMic() = activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    fun startListening() { pressToTalk = true; wantCommand = true; begin() }
    fun stopListening() { pressToTalk = false; wantCommand = false; recognizer?.cancel(); if (!handsFree) destroyRecognizer() }

    fun setHandsFree(on: Boolean) {
        handsFree = on
        if (on) begin() else if (!pressToTalk) { recognizer?.cancel(); destroyRecognizer() }
    }

    fun onPermission(granted: Boolean) {
        waitingForPermission = false
        if (granted) begin() else { pressToTalk = false; js("onError(${JSONObject.quote("Allow the microphone for WinDock to use voice.")})") }
    }

    fun onPause() { recognizer?.cancel(); destroyRecognizer(); stopSpeaking() }
    fun onResume() { if (handsFree) begin() }
    fun destroy() { handsFree = false; pressToTalk = false; destroyRecognizer(); tts?.shutdown(); tts = null }

    private fun begin() {
        if (speaking || waitingForPermission) return
        if (!(pressToTalk || handsFree)) return
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) { pressToTalk = false; js("onError(${JSONObject.quote("This phone has no speech recognition service.")})"); return }
        if (!hasMic()) { waitingForPermission = true; activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST); return }
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(activity).also { recognizer = it; it.setRecognitionListener(listener) }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, pressToTalk)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try { r.startListening(intent) } catch (_: Exception) { destroyRecognizer(); retryLater(1500) }
    }

    private fun retryLater(ms: Long) { if (handsFree) main.postDelayed({ if (handsFree && !pressToTalk) begin() }, ms) }
    private fun destroyRecognizer() { recognizer?.destroy(); recognizer = null }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
        override fun onPartialResults(partialResults: Bundle?) {
            if (!pressToTalk) return
            partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { js("onResult(${JSONObject.quote(it)},false)") }
        }
        override fun onResults(results: Bundle?) {
            val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            when {
                pressToTalk -> { pressToTalk = false; wantCommand = false; if (heard.isBlank()) js("onError(null)") else js("onResult(${JSONObject.quote(heard)},true)"); retryLater(600) }
                wantCommand -> { wantCommand = false; if (heard.isNotBlank()) js("onResult(${JSONObject.quote(heard)},true)"); retryLater(600) }
                else -> {
                    val command = WakeWord.command(heard)
                    when {
                        command == null -> retryLater(250)
                        command.isEmpty() -> { wantCommand = true; speak("Yes?") }
                        else -> { js("onResult(${JSONObject.quote(command)},true)"); retryLater(600) }
                    }
                }
            }
        }
        override fun onError(error: Int) {
            val quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
            if (pressToTalk) {
                pressToTalk = false
                js("onError(${JSONObject.quote(if (quiet) "I didn't catch that." else "Voice recognition isn't available right now.")})")
            }
            wantCommand = false
            destroyRecognizer()
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) handsFree = false
            retryLater(if (quiet) 300 else 2000)
        }
    }

    fun speak(text: String) {
        val clean = text.take(500)
        recognizer?.cancel()
        val engine = tts ?: TextToSpeech(activity) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) { tts?.language = java.util.Locale.getDefault(); say(clean) }
        }.also {
            tts = it
            it.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) { speaking = true }
                override fun onDone(id: String?) { speaking = false; main.post { if (wantCommand || handsFree) begin() } }
                @Deprecated("Deprecated in Java") override fun onError(id: String?) { speaking = false; main.post { if (handsFree) begin() } }
            })
        }
        if (ttsReady) say(clean) else if (engine === tts && tts != null && !ttsReady) { /* first call speaks once the engine is ready */ }
    }

    private fun say(text: String) { speaking = true; tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "windock-voice") }
    fun stopSpeaking() { tts?.stop(); speaking = false }

    companion object { const val REQUEST = 4417 }
}
