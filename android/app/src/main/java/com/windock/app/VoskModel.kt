package com.windock.app

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.zip.ZipInputStream
import org.json.JSONObject

/** The offline speech model: where it comes from, how it is checked, and how it is unpacked safely. */
internal object VoskModel {
    private const val BASE = "https://github.com/yeshwanthkumardomala/WinDock/releases/download/voicepack-v1/"
    const val MANIFEST = BASE + "vosk-model.json"
    const val MAX_ZIP_BYTES = 120L * 1024 * 1024
    const val MAX_UNPACKED_BYTES = 400L * 1024 * 1024
    private val SHA = Regex("[0-9a-f]{64}")

    data class Info(val url: String, val sha256: String, val size: Long)

    fun installed(dir: File) = File(dir, "am").isDirectory && File(dir, "conf").isDirectory

    /** Throws unless the published model is exactly where we expect and has a sane size and checksum. */
    fun validate(url: String, sha256: String, size: Long): Info {
        require(url.startsWith(BASE) && url.endsWith(".zip") && !url.contains("..")) { "Unexpected model location" }
        val sha = sha256.lowercase()
        require(SHA.matches(sha)) { "Bad checksum" }
        require(size in 1..MAX_ZIP_BYTES) { "Bad size" }
        return Info(url, sha, size)
    }

    fun parse(body: String): Info {
        val j = JSONObject(body)
        return validate(j.getString("url"), j.getString("sha256"), j.getLong("size"))
    }

    /** Where a zip entry may be written, or null when it would escape [root]. */
    fun safeTarget(root: File, name: String): File? {
        if (name.isEmpty() || name.contains('\u0000') || name.startsWith("/") || name.startsWith("\\") || Regex("^[A-Za-z]:").containsMatchIn(name)) return null
        val base = root.canonicalFile
        val target = File(base, name).canonicalFile
        return if (target.path == base.path || target.path.startsWith(base.path + File.separator)) target else null
    }

    /** Downloads, verifies and unpacks the model into [dir]. Throws on any problem and leaves nothing half-installed. */
    fun install(dir: File, cache: File, progress: (Int) -> Unit) {
        val info = parse(ApkUpdater.fetchText(MANIFEST))
        cache.mkdirs()
        val zip = File(cache, "vosk-model.zip")
        val staging = File(dir.parentFile, "vosk-model.tmp")
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            var read = 0L
            val c = ApkUpdater.open(info.url)
            try {
                c.inputStream.use { input ->
                    FileOutputStream(zip).use { out ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            val n = input.read(buffer); if (n < 0) break
                            read += n
                            if (read > info.size) throw SecurityException("Model is larger than expected")
                            digest.update(buffer, 0, n); out.write(buffer, 0, n)
                            progress((read * 90 / info.size).toInt())
                        }
                    }
                }
            } finally { c.disconnect() }
            if (read != info.size || ApkUpdater.hex(digest.digest()) != info.sha256) throw SecurityException("Model failed its integrity check")

            staging.deleteRecursively(); staging.mkdirs()
            var total = 0L
            ZipInputStream(zip.inputStream().buffered()).use { z ->
                while (true) {
                    val e = z.nextEntry ?: break
                    val target = safeTarget(staging, e.name) ?: throw SecurityException("Unsafe file in model")
                    if (e.isDirectory) { target.mkdirs(); continue }
                    target.parentFile?.mkdirs()
                    FileOutputStream(target).use { out ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            val n = z.read(buffer); if (n < 0) break
                            total += n
                            if (total > MAX_UNPACKED_BYTES) throw SecurityException("Model is larger than expected")
                            out.write(buffer, 0, n)
                        }
                    }
                }
            }
            progress(96)
            val root = if (installed(staging)) staging else staging.listFiles()?.singleOrNull { it.isDirectory && installed(it) }
                ?: throw IOException("Model files are missing")
            dir.deleteRecursively()
            if (!root.renameTo(dir)) throw IOException("Could not place the model")
            progress(100)
        } finally {
            zip.delete(); staging.deleteRecursively()
        }
    }
}
