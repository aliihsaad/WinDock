package com.windock.app

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

/**
 * On-phone speech recognition for voice commands.
 *
 * Audio and transcripts stay on the phone. Android 12 and newer use the system's on-device
 * recognizer when it is installed; otherwise the system recognizer is asked to prefer its offline
 * language pack. Only when the user turns on online recognition (off by default) is the system
 * recognizer allowed to use the network. The recognizer never touches the page: the Activity receives text and errors
 * through the two callbacks and decides whether the page may see them.
 */
class VoiceRecognition(
    private val context: Context,
    private val onResult: (text: String, isFinal: Boolean) -> Unit,
    private val onError: (code: String, detail: String?) -> Unit,
) {
    private var recognizer: SpeechRecognizer? = null
    private var languages: List<String> = emptyList()
    private var tried: List<String> = emptyList()
    private var listening = false
    private var onDevice = false
    private var online = false
    private var downloadRequested = false

    /** Start one recognition session. Callbacks arrive on the main thread. */
    fun start(locale: Locale = Locale.getDefault(), online: Boolean = false) {
        if (listening) { onError("busy", null); return }
        if (this.online != online) { recognizer?.destroy(); recognizer = null; onDevice = false; this.online = online }
        val engine = recognizer ?: createEngine() ?: run { onError("unavailable", "no speech recognition service on this phone"); return }
        languages = VoicePolicy.languageCandidates(locale)
        tried = languages
        listening = true
        engine.startListening(intentFor(languages.first()))
    }

    /** Drop the current session without reporting anything to the page. */
    fun cancel() {
        if (!listening) return
        listening = false
        recognizer?.cancel()
    }

    fun destroy() {
        listening = false
        recognizer?.destroy()
        recognizer = null
    }

    private fun createEngine(): SpeechRecognizer? {
        val engine = if (!online && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            onDevice = true
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else if (SpeechRecognizer.isRecognitionAvailable(context)) {
            SpeechRecognizer.createSpeechRecognizer(context)
        } else {
            return null
        }
        engine.setRecognitionListener(listener)
        recognizer = engine
        return engine
    }

    private fun intentFor(language: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, !online)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
    }

    /**
     * Every candidate failed. Android 13+ can say which packs exist, so the dock can show them
     * and the recognizer can fetch the one the phone actually offers instead of guessing.
     */
    private fun explainLanguageFailure() {
        val engine = recognizer
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || engine == null) {
            onError("language", VoicePolicy.describeSupport(onDevice, tried, null, null, null))
            return
        }
        if (online) { onError("language", "online · " + VoicePolicy.describeSupport(onDevice, tried, null, null, null)); return }
        engine.checkRecognitionSupport(intentFor(tried.first()), context.mainExecutor, object : RecognitionSupportCallback {
            override fun onSupportResult(support: RecognitionSupport) {
                val installed = support.installedOnDeviceLanguages
                val supported = support.supportedOnDeviceLanguages
                val pending = support.pendingOnDeviceLanguages
                val detail = VoicePolicy.describeSupport(onDevice, tried, installed, supported, pending)
                val download = VoicePolicy.languageToDownload(tried, supported, installed, pending)
                if (download != null && !downloadRequested) {
                    downloadRequested = true
                    try { engine.triggerModelDownload(intentFor(download)) } catch (_: Exception) { /* best effort */ }
                    onError("downloading", "$download · $detail")
                } else {
                    onError("language", detail)
                }
            }
            override fun onError(error: Int) {
                this@VoiceRecognition.onError("language", VoicePolicy.describeSupport(onDevice, tried, null, null, null) + " · support check failed ($error)")
            }
        })
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            if (!listening) return
            VoicePolicy.transcript(partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION))
                ?.let { onResult(it, false) }
        }

        override fun onResults(results: Bundle?) {
            if (!listening) return
            listening = false
            val text = VoicePolicy.transcript(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION))
            if (text == null) onError("no-match", null) else onResult(text, true)
        }

        override fun onError(error: Int) {
            if (!listening) return
            val code = VoicePolicy.errorCode(error)
            if (VoicePolicy.shouldRetryLanguage(code, languages.size - 1)) {
                languages = languages.drop(1)
                recognizer?.startListening(intentFor(languages.first()))
                return
            }
            listening = false
            if (code == "language") explainLanguageFailure()
            else this@VoiceRecognition.onError(code, if (code == "unavailable") "error $error · " + VoicePolicy.describeSupport(onDevice, tried, null, null, null) else null)
        }
    }
}
