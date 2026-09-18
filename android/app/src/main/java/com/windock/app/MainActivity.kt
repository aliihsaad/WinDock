package com.windock.app

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Native discovery/connection shell; the shared web UI owns pairing and the dock. */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var connection: View
    private lateinit var status: TextView
    private lateinit var address: EditText
    private lateinit var connectButton: Button
    private lateinit var retryButton: Button
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var endpoint: String? = null
    private var loadFailed = false
    private var connecting = false
    private val loadTimeout = Runnable {
        if (connecting) {
            failConnection(R.string.connection_lost)
            web.stopLoading()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        connection = findViewById(R.id.connection)
        status = findViewById(R.id.status)
        address = findViewById(R.id.address)
        connectButton = findViewById(R.id.connect)
        retryButton = findViewById(R.id.retry)
        address.setText(ServerUrl.load(this).orEmpty())
        connectButton.setOnClickListener {
            val selected = EndpointPolicy.normalize(address.text.toString())
            if (selected == null) address.error = getString(R.string.invalid_address)
            else connect(selected)
        }
        retryButton.setOnClickListener { connect() }
        address.setOnEditorActionListener { _, _, _ -> connectButton.performClick(); true }

        web.setBackgroundColor(getColor(R.color.dock_background))
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !EndpointPolicy.allowsRequest(endpoint, request.url.toString())

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (EndpointPolicy.allowsRequest(endpoint, request.url.toString())) null
                else WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                loadFailed = false
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (loadFailed || !EndpointPolicy.allowsRequest(endpoint, url)) return
                setBusy(false)
                connection.visibility = View.GONE
                web.visibility = View.VISIBLE
                hideSystemBars()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) failConnection(R.string.connection_lost)
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame) failConnection(R.string.connection_lost)
            }
        }
        hideSystemBars()
        connect()
    }

    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun setBusy(busy: Boolean) {
        if (!busy) web.removeCallbacks(loadTimeout)
        connecting = busy
        connectButton.isEnabled = !busy
        retryButton.isEnabled = !busy
        address.isEnabled = !busy
        findViewById<View>(R.id.progress).visibility = if (busy) View.VISIBLE else View.GONE
    }

    private fun failConnection(message: Int) {
        loadFailed = true
        setBusy(false)
        web.visibility = View.GONE
        connection.visibility = View.VISIBLE
        status.setText(message)
    }

    /** Validate remembered, entered and discovered hosts with the same health check. */
    private fun connect(manual: String? = null) {
        if (connecting) return
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(address.windowToken, 0)
        web.stopLoading()
        web.visibility = View.GONE
        connection.visibility = View.VISIBLE
        status.setText(R.string.searching)
        setBusy(true)
        io.execute {
            val remembered = manual ?: ServerUrl.load(this)
            val selected = remembered?.takeIf { reachable(it) }
                ?: if (manual == null) Discovery.find(::reachable) else null
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                if (selected == null) {
                    failConnection(R.string.not_found)
                } else {
                    endpoint = selected
                    ServerUrl.save(this, selected)
                    address.setText(selected)
                    status.setText(R.string.connecting)
                    loadFailed = false
                    web.loadUrl(selected)
                    web.postDelayed(loadTimeout, 15000)
                }
            }
        }
    }

    private fun reachable(endpoint: String): Boolean {
        if (!ServerUrl.isValid(endpoint)) return false
        var conn: HttpURLConnection? = null
        return try {
            conn = URL("$endpoint/health").openConnection() as HttpURLConnection
            conn.connectTimeout = 1500
            conn.readTimeout = 1500
            conn.instanceFollowRedirects = false
            conn.requestMethod = "GET"
            conn.responseCode == 200 && conn.inputStream.bufferedReader().use { reader ->
                val body = CharArray(4097)
                var count = 0
                while (count < body.size) {
                    val read = reader.read(body, count, body.size - count)
                    if (read == -1) break
                    count += read
                }
                count <= 4096 && JSONObject(String(body, 0, count)).optString("app") == "windock"
            }
        } catch (_: Exception) { false }
        finally { conn?.disconnect() }
    }

    @Deprecated("Activity back dispatch for the supported API 24+ range")
    override fun onBackPressed() {
        if (web.visibility != View.VISIBLE) {
            super.onBackPressed()
            return
        }
        // Close the shared UI's topmost sheet first; otherwise offer PC selection.
        web.evaluateJavascript("""
            (() => { const sheets = document.querySelectorAll('dialog[open]');
            if (!sheets.length) return false; sheets[sheets.length - 1].close(); return true; })()
        """.trimIndent()) { closed ->
            if (closed != "true" && !isDestroyed) failConnection(R.string.choose_pc)
        }
    }

    override fun onResume() { super.onResume(); if (::web.isInitialized) web.onResume() }
    override fun onPause() { if (::web.isInitialized) web.onPause(); super.onPause() }
    override fun onDestroy() {
        io.shutdownNow()
        web.removeCallbacks(loadTimeout)
        web.stopLoading()
        web.destroy()
        super.onDestroy()
    }
}
