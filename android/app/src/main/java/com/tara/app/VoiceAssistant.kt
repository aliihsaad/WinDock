package com.tara.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.File
import org.json.JSONObject

/**
 * "Tara" / "Hey Tara" hands-free and press-to-talk.
 * Both use the offline Vosk model once it is downloaded. Until then (or if Vosk cannot start on this phone)
 * press-to-talk falls back to Android's own recogniser; hands-free needs the model.
 * Nothing listens unless the dock is on screen and hands-free is switched on.
 */
class VoiceAssistant(private val activity: Activity, private val run: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences("tara-voice", android.content.Context.MODE_PRIVATE)
    private val modelDir = File(activity.filesDir, "vosk-model")
    private var engine: VoskEngine? = null
    private var voskFailed = false
    private var fallback: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var handsFree = false
    private var pressToTalk = false
    private var waitingForPermission = false
    @Volatile private var downloading = false

    private fun js(call: String) = run("window.TaraVoice&&window.TaraVoice.$call")
    private fun hasMic() = activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    private fun modelReady() = VoskModel.installed(modelDir)
    private fun useVosk() = modelReady() && !voskFailed
    private fun names() = WakeGrammar.cleanNames(prefs.getString("names", ""))

    fun modelState(): String = JSONObject().put("ready", modelReady()).put("busy", downloading).toString()
    private fun strictWake() = prefs.getBoolean("strict", false)
    fun wakeStrict(): Boolean = strictWake()
    private var vocabulary: List<String> = emptyList()
    /** Words from the apps on this PC's dock, so commands that name them are heard precisely. */
    fun setVocabulary(words: List<String>) { vocabulary = words; engine?.setVocabulary(words) }
    fun setWakeStrict(on: Boolean) { prefs.edit().putBoolean("strict", on).apply(); engine?.refreshNames() }
    fun wakeNames(): String = names().joinToString(", ")
    fun setWakeNames(raw: String) { prefs.edit().putString("names", WakeGrammar.cleanNames(raw).joinToString(",")).apply(); engine?.refreshNames() }
    fun pauseListening(on: Boolean) { engine?.pause(on) }

    fun downloadModel() {
        if (downloading) return
        downloading = true
        Thread {
            try {
                VoskModel.install(modelDir, activity.cacheDir) { pct -> main.post { js("onModelState(" + JSONObject().put("ready", false).put("progress", pct) + ")") } }
                voskFailed = false
                main.post { js("onModelState(" + JSONObject().put("ready", true).put("progress", 100) + ")") }
            } catch (e: Throwable) {
                main.post { js("onModelState(" + JSONObject().put("ready", false).put("error", "The voice model could not be downloaded. Check the connection and try again.") + ")") }
            } finally { downloading = false }
        }.start()
    }

    fun startListening() { pressToTalk = true; begin() }
    fun stopListening() { pressToTalk = false; engine?.cancelCommand(); fallback?.cancel() }

    fun setHandsFree(on: Boolean) {
        if (on && !useVosk()) { handsFree = false; js("onNeedModel()"); return }
        handsFree = on
        if (on) begin() else engine?.stopWake()
    }

    fun onPermission(granted: Boolean) {
        waitingForPermission = false
        if (granted) begin() else { pressToTalk = false; js("onError(${JSONObject.quote("Allow the microphone for Tara to use voice.")})") }
    }

    fun onPause() { fallback?.destroy(); fallback = null; stopSpeaking(); engine?.shutdown(); engine = null }
    fun onResume() { if (handsFree) begin() }
    fun destroy() { handsFree = false; pressToTalk = false; onPause(); tts?.shutdown(); tts = null }

    private fun begin() {
        if (!(pressToTalk || handsFree) || waitingForPermission) return
        if (!hasMic()) { waitingForPermission = true; activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST); return }
        if (useVosk()) {
            val e = engine ?: makeEngine().also { engine = it; it.setVocabulary(vocabulary) }
            if (pressToTalk) e.commandOnce()
            if (handsFree) e.startWake()
        } else if (pressToTalk) beginFallback()
    }

    private fun makeEngine() = VoskEngine(
        modelDir = modelDir,
        names = ::names,
        strict = ::strictWake,
        onWake = { main.post { beep(); js("onWake()") } },
        onUtterance = { text -> main.post { pressToTalk = false; js("onUtterance(${JSONObject.quote(text)})") } },
        onLevel = { l -> main.post { js("onLevel($l)") } },
        onFailure = { message -> main.post {
            voskFailed = true; engine?.shutdown(); engine = null; handsFree = false
            js("onError(${JSONObject.quote(message)})")
            if (pressToTalk) begin()
        } },
    )

    private fun beep() { try { ToneGenerator(AudioManager.STREAM_MUSIC, 45).startTone(ToneGenerator.TONE_PROP_PROMPT, 90) } catch (_: Exception) {} }

    // ---- fallback: Android's own recogniser, press-to-talk only ----
    private fun beginFallback() {
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) { pressToTalk = false; js("onError(${JSONObject.quote("This phone has no speech recognition service.")})"); return }
        val r = fallback ?: SpeechRecognizer.createSpeechRecognizer(activity).also { fallback = it; it.setRecognitionListener(listener) }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try { r.startListening(intent) } catch (_: Exception) { fallback?.destroy(); fallback = null; pressToTalk = false; js("onError(null)") }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
        override fun onPartialResults(partialResults: Bundle?) {
            partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { js("onResult(${JSONObject.quote(it)},false)") }
        }
        override fun onResults(results: Bundle?) {
            pressToTalk = false
            val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            if (heard.isBlank()) js("onError(null)") else js("onResult(${JSONObject.quote(heard)},true)")
        }
        override fun onError(error: Int) {
            pressToTalk = false
            val quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
            js("onError(${JSONObject.quote(if (quiet) "I didn't catch that." else "Voice recognition isn't available right now.")})")
            fallback?.destroy(); fallback = null
        }
    }

    // ---- speaking: the phone's own voice ----
    fun speak(text: String) {
        val clean = text.take(500)
        engine?.pause(true)
        val engineTts = tts ?: TextToSpeech(activity) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) { tts?.language = java.util.Locale.getDefault(); say(clean) } else main.post { engine?.pause(false) }
        }.also {
            tts = it
            it.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) { main.post { engine?.pause(false) } }
                @Deprecated("Deprecated in Java") override fun onError(id: String?) { main.post { engine?.pause(false) } }
            })
        }
        if (ttsReady && engineTts === tts) say(clean)
    }

    private fun say(text: String) { tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "tara-voice") }
    fun stopSpeaking() { tts?.stop(); engine?.pause(false) }

    companion object { const val REQUEST = 4417 }
}
