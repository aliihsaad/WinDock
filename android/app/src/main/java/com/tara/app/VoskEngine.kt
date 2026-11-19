package com.tara.app

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer

/**
 * Offline listening on one background thread. Two modes, never both at once:
 *  - wake: a tiny grammar that only knows "hey <name>", so it is cheap enough to leave on;
 *  - command: free speech for a few seconds, handed back as text.
 * The microphone is opened only while one of those is wanted, and closed the moment neither is.
 * Any failure (missing native library, bad model) is reported once and the engine stops itself.
 */
internal class VoskEngine(
    private val modelDir: java.io.File,
    private val names: () -> List<String>,
    private val onWake: () -> Unit,
    private val onUtterance: (String) -> Unit,
    private val onFailure: (String) -> Unit,
) {
    @Volatile private var thread: Thread? = null
    @Volatile private var running = false
    @Volatile private var paused = false
    @Volatile private var wantWake = false
    @Volatile private var wantCommand = false
    @Volatile private var rebuildWake = false

    @Synchronized private fun ensureRunning() {
        if (running && thread?.isAlive == true) return
        thread?.join(800)
        running = true
        thread = Thread({ loop() }, "tara-vosk").also { it.isDaemon = true; it.start() }
    }

    fun startWake() { wantWake = true; ensureRunning() }
    fun stopWake() { wantWake = false }
    fun commandOnce() { wantCommand = true; ensureRunning() }
    fun cancelCommand() { wantCommand = false }
    fun pause(on: Boolean) { paused = on }
    fun refreshNames() { rebuildWake = true }
    fun shutdown() { running = false; wantWake = false; wantCommand = false; thread?.interrupt() }

    @SuppressLint("MissingPermission")
    private fun openRecorder(): AudioRecord? = try {
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) null else {
            val r = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 6400) * 2)
            if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); null } else { r.startRecording(); r }
        }
    } catch (_: Exception) { null }

    private fun closeRecorder(r: AudioRecord?) { try { r?.stop() } catch (_: Exception) {}; try { r?.release() } catch (_: Exception) {} }

    private fun loop() {
        var model: Model? = null
        var rec: AudioRecord? = null
        var wake: Recognizer? = null
        var cmd: Recognizer? = null
        var inCommand = false
        var commandStart = 0L
        val buf = ByteArray(3200) // 100 ms of 16 kHz mono PCM16
        try {
            LibVosk.setLogLevel(LogLevel.WARNINGS)
            while (running) {
                val active = !paused && (wantWake || wantCommand)
                if (!active) {
                    closeRecorder(rec); rec = null
                    cmd?.close(); cmd = null; inCommand = false
                    if (!wantWake) { wake?.close(); wake = null }
                    Thread.sleep(150); continue
                }
                if (model == null) model = Model(modelDir.absolutePath)
                if (rec == null) { rec = openRecorder(); if (rec == null) { onFailure("Could not open the microphone."); return } }
                if (rebuildWake) { wake?.close(); wake = null; rebuildWake = false }
                if (wantCommand && !inCommand) {
                    cmd?.close(); cmd = Recognizer(model, RATE.toFloat()); commandStart = System.currentTimeMillis(); inCommand = true
                    wake?.reset()
                }
                if (!wantCommand && inCommand) { cmd?.close(); cmd = null; inCommand = false }
                if (!inCommand && wake == null) wake = Recognizer(model, RATE.toFloat(), WakeGrammar.grammar(names()))
                val n = rec.read(buf, 0, buf.size)
                if (n <= 0) { Thread.sleep(20); continue }
                if (inCommand) {
                    val r = cmd!!
                    val done = r.acceptWaveForm(buf, n)
                    val elapsed = System.currentTimeMillis() - commandStart
                    val silent = !done && elapsed > NO_SPEECH_MS && JSONObject(r.partialResult).optString("partial").isBlank()
                    if (done || silent || elapsed > MAX_COMMAND_MS) {
                        val text = JSONObject(if (done) r.result else r.finalResult).optString("text").trim()
                        r.close(); cmd = null; inCommand = false; wantCommand = false
                        onUtterance(text)
                    }
                } else if (wake!!.acceptWaveForm(buf, n)) {
                    val heard = JSONObject(wake.result).optString("text")
                    if (WakeGrammar.command(heard, names()) != null) { wake.reset(); wantCommand = true; onWake() }
                }
            }
        } catch (_: InterruptedException) {
            // shutdown() asked us to stop
        } catch (t: Throwable) { // includes UnsatisfiedLinkError on a phone the native library does not fit
            if (running) onFailure("Offline voice could not start on this phone.")
        } finally {
            closeRecorder(rec)
            try { cmd?.close() } catch (_: Throwable) {}
            try { wake?.close() } catch (_: Throwable) {}
            try { model?.close() } catch (_: Throwable) {}
            running = false
        }
    }

    companion object {
        const val RATE = 16000
        const val MAX_COMMAND_MS = 8000L
        const val NO_SPEECH_MS = 5000L
    }
}
