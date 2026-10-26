package com.windock.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Public release metadata only: no pairing cookies, PINs or host addresses. */
internal class AppUpdates(private val activity: Activity, private val load: (() -> AppUpdateResult)? = null) : AutoCloseable {
    private val executor = Executors.newSingleThreadExecutor()
    @Volatile private var closed = false
    @Volatile private var connection: HttpURLConnection? = null
    private var busy = false
    private var result = AppUpdateResult("unchecked")
    private var render: (() -> Unit)? = null

    fun dialog(): AlertDialog {
        val dp = activity.resources.displayMetrics.density
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((24 * dp).toInt(), (8 * dp).toInt(), (24 * dp).toInt(), (16 * dp).toInt())
        }
        fun text(value: String) = TextView(activity).apply {
            text = value; setTextColor(Color.LTGRAY); textSize = 15f
            setPadding(0, (10 * dp).toInt(), 0, (10 * dp).toInt()); content.addView(this)
        }
        text(activity.getString(R.string.installed_android_version, BuildConfig.VERSION_NAME))
        val status = text("").apply { id = R.id.update_status; accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE }
        val check = Button(activity).apply { id = R.id.update_check; isAllCaps = false; content.addView(this) }
        val download = Button(activity).apply {
            id = R.id.update_download; isAllCaps = false; setText(R.string.view_release)
            setOnClickListener { result.releasePage?.let(::openPage) }; content.addView(this)
        }
        text(activity.getString(R.string.android_update_install))
        val dialog = AlertDialog.Builder(activity).setTitle(R.string.app_updates)
            .setView(ScrollView(activity).apply { addView(content) })
            .setNegativeButton(R.string.close, null).create()
        render = {
            if (!closed) {
                status.text = when {
                    busy -> activity.getString(R.string.checking_updates)
                    result.status == "current" -> activity.getString(R.string.up_to_date)
                    result.status == "available" -> activity.getString(R.string.update_available, result.version)
                    result.status == "failed" -> activity.getString(R.string.update_failed)
                    else -> activity.getString(R.string.updates_unchecked)
                }
                check.setText(if (busy) R.string.checking_updates else R.string.check_updates)
                check.isEnabled = !busy
                download.visibility = if (!busy && result.status == "available") android.view.View.VISIBLE else android.view.View.GONE
            }
        }
        check.setOnClickListener { this@AppUpdates.check() }
        dialog.setOnShowListener { render?.invoke() }
        return dialog
    }

    private fun check() {
        if (closed || busy) return
        busy = true; render?.invoke()
        executor.execute {
            val next = try { load?.invoke() ?: fetch() } catch (_: Exception) { AppUpdateResult("failed") }
            activity.runOnUiThread {
                if (!closed && !activity.isDestroyed && !activity.isFinishing) {
                    result = next; busy = false; render?.invoke()
                }
            }
        }
    }

    private fun fetch(): AppUpdateResult {
        val conn = URL(UpdatePolicy.FEED).openConnection() as HttpURLConnection
        connection = conn
        try {
            if (closed) throw InterruptedException()
            conn.connectTimeout = 5000; conn.readTimeout = 5000
            conn.instanceFollowRedirects = false; conn.useCaches = false
            conn.setRequestProperty("User-Agent", "WinDock-Android/" + BuildConfig.VERSION_NAME)
            conn.setRequestProperty("Cache-Control", "no-cache")
            val deadline = System.nanoTime() + 12_000_000_000L
            if (conn.responseCode != 200) throw IllegalStateException("Feed unavailable")
            val bytes = ByteArrayOutputStream()
            conn.inputStream.use { input ->
                val buffer = ByteArray(4096)
                while (true) {
                    if (closed || System.nanoTime() > deadline) throw InterruptedException()
                    val count = input.read(buffer); if (count == -1) break
                    if (bytes.size() + count > 65536) throw IllegalStateException("Feed too large")
                    bytes.write(buffer, 0, count)
                }
            }
            return parseManifest(bytes.toString("UTF-8"), BuildConfig.VERSION_CODE)
        } finally { conn.disconnect(); if (connection === conn) connection = null }
    }

    fun openPcRelease(version: String) { UpdatePolicy.releasePage(version)?.let(::openPage) }
    private fun openPage(page: String) {
        try { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(page))) }
        catch (_: ActivityNotFoundException) { Toast.makeText(activity, R.string.update_browser_missing, Toast.LENGTH_LONG).show() }
    }
    override fun close() { closed = true; render = null; connection?.disconnect(); executor.shutdownNow() }

    companion object {
        internal fun parseManifest(body: String, installedCode: Int): AppUpdateResult {
            val json = JSONObject(body)
            require(json.opt("available") == true)
            val release = json.get("version") as String
            val apk = json.getJSONObject("android")
            if (!apk.has("versionCode") && !apk.has("versionName") && release == BuildConfig.VERSION_NAME) {
                return UpdatePolicy.evaluate(release, release, installedCode, apk.get("url") as String, installedCode)
            }
            val code = apk.get("versionCode") as Number
            require(code.toLong() in 1..Int.MAX_VALUE.toLong() && code.toDouble() == code.toInt().toDouble())
            return UpdatePolicy.evaluate(release, apk.get("versionName") as String, code.toInt(), apk.get("url") as String, installedCode)
        }
    }
}
