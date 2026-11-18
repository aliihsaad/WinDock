package com.windock.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.TextView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

internal data class ApkRelease(val version: String, val code: Int, val url: String, val sha256: String)

/** Pure rules for the self-updater: where releases may come from and what a valid one looks like. */
internal object ApkUpdater {
    private const val BASE = "https://github.com/yeshwanthkumardomala/WinDock/releases/download/upgrades-latest/"
    const val FEED = BASE + "latest.json"
    const val APK_URL = BASE + "WinDock-android-debug.apk"
    const val MAX_APK_BYTES = 150L * 1024 * 1024
    private val HOSTS = setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
    private val VERSION = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")
    private val SHA = Regex("[0-9a-f]{64}")

    fun allowed(url: String): Boolean = try {
        val u = URL(url)
        u.protocol == "https" && u.userInfo == null && (u.port == -1 || u.port == 443) && u.host in HOSTS
    } catch (_: Exception) { false }

    /** Throws unless every field is acceptable; the URL must be exactly the published APK. */
    fun validate(available: Boolean, version: String, code: Int, url: String, sha256: String): ApkRelease {
        require(available)
        require(version.length <= 100 && VERSION.matches(version))
        require(code > 0)
        require(url == APK_URL)
        val sha = sha256.lowercase()
        require(SHA.matches(sha))
        return ApkRelease(version, code, url, sha)
    }

    fun parse(body: String): ApkRelease {
        val json = JSONObject(body)
        val apk = json.getJSONObject("android")
        return validate(json.opt("available") == true, apk.getString("versionName"), apk.getInt("versionCode"), apk.getString("url"), apk.getString("sha256"))
    }

    fun isNewer(release: ApkRelease, installedCode: Int) = release.code > installedCode

    fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    /** GET following at most four redirects, each of which must stay on GitHub's own hosts. */
    fun open(url: String): HttpURLConnection {
        var current = url
        repeat(5) {
            if (!allowed(current)) throw IOException("Unexpected download location")
            val c = URL(current).openConnection() as HttpURLConnection
            c.connectTimeout = 10_000; c.readTimeout = 20_000
            c.instanceFollowRedirects = false; c.useCaches = false
            c.setRequestProperty("User-Agent", "WinDock-Android/" + BuildConfig.VERSION_NAME)
            c.setRequestProperty("Cache-Control", "no-cache")
            val status = c.responseCode
            if (status in 300..399) {
                val next = c.getHeaderField("Location")
                c.disconnect()
                if (next == null) throw IOException("Bad redirect")
                current = URL(URL(current), next).toString()
            } else if (status == 200) return c
            else { c.disconnect(); throw IOException("HTTP $status") }
        }
        throw IOException("Too many redirects")
    }

    fun fetchText(url: String): String {
        val c = open(url)
        try {
            val out = ByteArrayOutputStream()
            c.inputStream.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    val n = input.read(buffer); if (n < 0) break
                    if (out.size() + n > 65_536) throw IOException("Feed too large")
                    out.write(buffer, 0, n)
                }
            }
            return out.toString("UTF-8")
        } finally { c.disconnect() }
    }

    /** Downloads to [dest] and deletes it unless the SHA-256 matches the published feed. */
    fun download(release: ApkRelease, dest: File, cancelled: () -> Boolean, progress: (Int) -> Unit) {
        val c = open(release.url)
        try {
            val total = c.contentLengthLong
            if (total > MAX_APK_BYTES) throw IOException("Unexpectedly large update")
            dest.parentFile?.mkdirs()
            val digest = MessageDigest.getInstance("SHA-256")
            var read = 0L
            c.inputStream.use { input ->
                dest.outputStream().use { out ->
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        if (cancelled()) throw InterruptedException()
                        val n = input.read(buffer); if (n < 0) break
                        read += n
                        if (read > MAX_APK_BYTES) throw IOException("Unexpectedly large update")
                        digest.update(buffer, 0, n); out.write(buffer, 0, n)
                        if (total > 0) progress((read * 100 / total).toInt())
                    }
                }
            }
            if (hex(digest.digest()) != release.sha256) { dest.delete(); throw SecurityException("checksum") }
        } catch (e: Exception) { dest.delete(); throw e }
        finally { c.disconnect() }
    }
}

/**
 * Checks the fork's release feed, downloads the new APK, verifies it and opens Android's installer.
 * Android always asks the person to confirm the install; nothing is installed silently.
 * [send] receives JSON messages for the web UI: {status, version?, percent?, message?, retry?}.
 */
internal class PhoneUpdater(private val activity: Activity, private val send: (String) -> Unit) : AutoCloseable {
    private val executor = Executors.newSingleThreadExecutor()
    @Volatile private var closed = false
    @Volatile private var release: ApkRelease? = null
    @Volatile private var working = false
    private var sink: ((String) -> Unit)? = null

    private fun emit(status: String, text: String, extra: JSONObject = JSONObject()) {
        val json = extra.put("status", status)
        if (closed) return
        activity.runOnUiThread {
            if (closed || activity.isDestroyed) return@runOnUiThread
            send(json.toString()); sink?.invoke(text)
        }
    }

    fun check() {
        if (BuildConfig.PLAY_DISTRIBUTION) { emit("failed", "Updates for this version come from Google Play.", JSONObject().put("message", "Updates for this version come from Google Play.")); return }
        if (working) return
        working = true
        executor.execute {
            try { checkNow() } finally { working = false }
        }
    }

    private fun checkNow(): ApkRelease? = try {
        val found = ApkUpdater.parse(ApkUpdater.fetchText(ApkUpdater.FEED))
        release = found
        if (ApkUpdater.isNewer(found, BuildConfig.VERSION_CODE)) {
            emit("available", "Version ${found.version} is available.", JSONObject().put("version", found.version)); found
        } else { emit("current", "You’re up to date."); null }
    } catch (_: Exception) {
        emit("failed", "Couldn’t check for updates. Check your connection and try again.", JSONObject().put("retry", false)); null
    }

    /** Downloads the release found by the last check (checking first if needed), then opens the installer. */
    fun install() {
        if (BuildConfig.PLAY_DISTRIBUTION || working) return
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            try { activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))) } catch (_: ActivityNotFoundException) {}
            emit("permission", "Allow WinDock to install updates, then come back and tap Update again.")
            return
        }
        working = true
        executor.execute {
            try {
                val target = release?.takeIf { ApkUpdater.isNewer(it, BuildConfig.VERSION_CODE) } ?: checkNow() ?: return@execute
                val dir = File(activity.cacheDir, "updates")
                dir.deleteRecursively()
                val file = File(dir, "WinDock-" + target.version + ".apk")
                var last = -1
                ApkUpdater.download(target, file, { closed }) { percent ->
                    if (percent != last) { last = percent; emit("downloading", "Downloading… $percent%", JSONObject().put("percent", percent)) }
                }
                activity.runOnUiThread { launchInstaller(file) }
            } catch (_: SecurityException) {
                emit("failed", "The download did not match its checksum, so it was not installed.", JSONObject().put("message", "The download did not match its checksum, so it was not installed.").put("retry", true))
            } catch (_: Exception) {
                if (!closed) emit("failed", "The update couldn’t be downloaded. Check your connection and try again.", JSONObject().put("message", "The update couldn’t be downloaded. Check your connection and try again.").put("retry", true))
            } finally { working = false }
        }
    }

    private fun launchInstaller(file: File) {
        if (closed || activity.isDestroyed) return
        try {
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".updates", file)
            activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            emit("installing", "Ready. Tap Install when Android asks.")
        } catch (_: Exception) {
            emit("failed", "Android couldn’t open the installer.", JSONObject().put("message", "Android couldn’t open the installer.").put("retry", true))
        }
    }

    /** Small native screen for when the web UI is not reachable (before pairing). */
    fun dialog(): AlertDialog {
        val dp = activity.resources.displayMetrics.density
        val text = TextView(activity).apply {
            setPadding((24 * dp).toInt(), (12 * dp).toInt(), (24 * dp).toInt(), (8 * dp).toInt())
            setTextColor(Color.LTGRAY); textSize = 15f
            this.text = activity.getString(R.string.installed_android_version, BuildConfig.VERSION_NAME) + "\n\nTap Update now to download and install the newest version."
        }
        sink = { message -> text.text = activity.getString(R.string.installed_android_version, BuildConfig.VERSION_NAME) + "\n\n" + message }
        val dialog = AlertDialog.Builder(activity).setTitle(R.string.app_updates).setView(text)
            .setPositiveButton("Update now", null).setNegativeButton(R.string.close, null).create()
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { release = null; install() } }
        dialog.setOnDismissListener { sink = null }
        return dialog
    }

    override fun close() { closed = true; sink = null; executor.shutdownNow() }
}
