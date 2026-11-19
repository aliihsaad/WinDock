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
 *  - wake: a tiny grammar that only knows "hey <name>", so it is cheap enough to leave on. It reacts to the
 *    partial result, so the beep comes as soon as the name is said, and the last moments of audio are kept;
 *  - command: free speech, handed back as text. After a wake word it is first fed those kept moments, so
 *    "Tara open Blender" said in one breath works as well as "Tara ... open Blender".
 * The microphone is opened only while one of those is wanted, and closed the moment neither is.
 * Any failure (missing native library, bad model) is reported once and the engine stops itself.
 */
internal class VoskEngine(
    private val modelDir: java.io.File,
    private val names: () -> List<String>,
    private val strict: () -> Boolean,
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
        var viaWake = false
        var retried = false
        var seed: ByteArray? = null
        val recent = java.io.ByteArrayOutputStream()
        val buf = ByteArray(1600) // 50 ms of 16 kHz mono PCM16
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
                if (rebuildWake) { wake?.close(); wake = null; rebuildWake = false; recent.reset() }
                if (wantCommand && !inCommand) {
                    cmd?.close(); cmd = Recognizer(model, RATE.toFloat()); commandStart = System.currentTimeMillis(); inCommand = true
                    wake?.reset(); retried = false
                    val pre = seed; if (pre != null) { cmd!!.acceptWaveForm(pre, pre.size); seed = null }
                }
                if (!wantCommand && inCommand) { cmd?.close(); cmd = null; inCommand = false; viaWake = false }
                if (!inCommand && wake == null) wake = Recognizer(model, RATE.toFloat(), WakeGrammar.grammar(names(), strict()))
                val n = rec.read(buf, 0, buf.size)
                if (n <= 0) { Thread.sleep(20); continue }
                if (inCommand) {
                    val r = cmd!!
                    val done = r.acceptWaveForm(buf, n)
                    val elapsed = System.currentTimeMillis() - commandStart
                    val silent = !done && elapsed > NO_SPEECH_MS && JSONObject(r.partialResult).optString("partial").isBlank()
                    if (done || silent || elapsed > MAX_COMMAND_MS) {
                        val heard = JSONObject(if (done) r.result else r.finalResult).optString("text").trim()
                        val text = if (viaWake) (WakeGrammar.command(heard, names()) ?: heard).trim() else heard
                        if (viaWake && text.isEmpty() && !retried && elapsed < MAX_COMMAND_MS) {
                            // Only the name was said: give a fresh recogniser the rest of the time for the command itself.
                            retried = true; r.close(); cmd = Recognizer(model, RATE.toFloat()); commandStart = System.currentTimeMillis()
                        } else {
                            r.close(); cmd = null; inCommand = false; wantCommand = false; viaWake = false
                            onUtterance(text)
                        }
                    }
                } else {
                    recent.write(buf, 0, n)
                    if (recent.size() > RECENT_BYTES) { val keep = recent.toByteArray().copyOfRange(recent.size() - RECENT_BYTES, recent.size()); recent.reset(); recent.write(keep) }
                    val w = wake!!
                    val ended = w.acceptWaveForm(buf, n)
                    val heard = JSONObject(if (ended) w.result else w.partialResult).optString(if (ended) "text" else "partial")
                    if (WakeGrammar.command(heard, names(), strict()) != null) {
                        w.reset(); seed = recent.toByteArray(); recent.reset(); viaWake = true; wantCommand = true; onWake()
                    } else if (ended) recent.reset()
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
        const val MAX_COMMAND_MS = 10000L
        const val NO_SPEECH_MS = 4500L
        const val RECENT_BYTES = RATE * 2 * 3 // the last three seconds of 16-bit audio
    }
}
