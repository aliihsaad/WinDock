package com.windock.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.MotionEvent
import android.view.KeyEvent
import android.view.Gravity
import android.webkit.JavascriptInterface
import android.widget.FrameLayout
import android.widget.LinearLayout
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
import androidx.core.view.doOnLayout
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
    private lateinit var keyboardBar: LinearLayout
    private lateinit var keyboardEditor: RemoteKeyboardEditor
    private var keyboardTarget: String? = null
    private var resumed = false
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var endpoint: String? = null
    private var loadFailed = false
    private var connecting = false
    private lateinit var idleDisplay: IdleDisplayController
    private var phoneDialog: AlertDialog? = null
    private var wakingGesture = false
    private val wakingKeys = mutableSetOf<Int>()
    private var usbOnly = false
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
        usbOnly = PhonePreferences.usbOnly(this)
        idleDisplay = IdleDisplayController(this, findViewById(R.id.idle_cover), onRest = { hideRemoteKeyboard() })
        setupRemoteKeyboard()
        address.setText(ServerUrl.load(this).orEmpty())
        connectButton.setOnClickListener {
            val selected = EndpointPolicy.normalize(address.text.toString())
            if (selected == null) address.error = getString(R.string.invalid_address)
            else connect(selected)
        }
        retryButton.setOnClickListener {
            usbOnly = false; PhonePreferences.setUsbOnly(this, false); connect()
        }
        findViewById<Button>(R.id.usb_connect).setOnClickListener { showUsbSetup() }
        findViewById<Button>(R.id.phone_options).setOnClickListener { showPhoneOptions() }
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
        web.addJavascriptInterface(KeyboardBridge(), "WinDockAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !EndpointPolicy.allowsRequest(endpoint, request.url.toString())

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (EndpointPolicy.allowsRequest(endpoint, request.url.toString())) null
                else WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                hideRemoteKeyboard()
                loadFailed = false
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (loadFailed || !EndpointPolicy.allowsRequest(endpoint, url)) return
                setBusy(false)
                connection.visibility = View.GONE
                web.visibility = View.VISIBLE
                hideSystemBars()
                syncIdleDisplay()
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

    private fun syncIdleDisplay() {
        if (::idleDisplay.isInitialized) idleDisplay.setActive(resumed && !connecting && !loadFailed &&
            web.visibility == View.VISIBLE && phoneDialog == null)
    }

    private fun showPhoneOptions() {
        if (phoneDialog != null) return
        showPhoneDialog(PhoneOptions.displayDialog(this) { idleDisplay.reloadPreferences() })
    }

    private fun showUsbSetup() {
        if (phoneDialog != null) return
        showPhoneDialog(PhoneOptions.usbDialog(this) {
            usbOnly = true; PhonePreferences.setUsbOnly(this, true); connect()
        })
    }

    private fun showPhoneDialog(dialog: AlertDialog) {
        phoneDialog = dialog
        syncIdleDisplay()
        dialog.setOnDismissListener { if (phoneDialog === dialog) phoneDialog = null; syncIdleDisplay() }
        dialog.show()
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (::idleDisplay.isInitialized) {
            if (event.actionMasked == MotionEvent.ACTION_DOWN) wakingGesture = idleDisplay.userActivity()
            else if (event.actionMasked == MotionEvent.ACTION_MOVE) idleDisplay.userActivity()
            if (wakingGesture) {
                if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) wakingGesture = false
                return true
            }
        }
        return super.dispatchTouchEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (::idleDisplay.isInitialized && event.action == KeyEvent.ACTION_DOWN && idleDisplay.userActivity())
            wakingKeys.add(event.keyCode)
        if (event.keyCode in wakingKeys) {
            if (event.action == KeyEvent.ACTION_UP) wakingKeys.remove(event.keyCode)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun setupRemoteKeyboard() {
        val dp = resources.displayMetrics.density
        keyboardBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding((8 * dp).toInt(), 0, (8 * dp).toInt(), 0)
            setBackgroundColor(0xff101722.toInt())
            visibility = View.GONE
        }
        keyboardEditor = RemoteKeyboardEditor(this)
        keyboardEditor.onUserActivity = { idleDisplay.userActivity() }
        keyboardEditor.onText = { emitKeyboardInput(JSONObject().put("type", "text").put("text", it)) }
        keyboardEditor.onRemoteKey = { emitKeyboardInput(JSONObject().put("type", "key").put("key", it)) }
        val close = Button(this).apply {
            text = "↓"; contentDescription = "Hide keyboard"
            setOnClickListener { keyboardEditor.commitDraft(); hideRemoteKeyboard(); emitKeyboardEvent("closed") }
        }
        val signature = Button(this).apply {
            text = "Sign"; contentDescription = "Draw and insert a signature"
            isAllCaps = false
            setOnClickListener { keyboardEditor.commitDraft(); hideRemoteKeyboard(); emitKeyboardEvent("signature") }
        }
        keyboardBar.addView(close, LinearLayout.LayoutParams((52 * dp).toInt(), (48 * dp).toInt()))
        keyboardBar.addView(keyboardEditor, LinearLayout.LayoutParams(0, (52 * dp).toInt(), 1f))
        keyboardBar.addView(signature, LinearLayout.LayoutParams((72 * dp).toInt(), (48 * dp).toInt()))
        findViewById<FrameLayout>(R.id.root).addView(keyboardBar, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, (56 * dp).toInt(), Gravity.BOTTOM))
    }

    private fun trustedKeyboardPage(): Boolean =
        resumed && !loadFailed && !connecting && web.visibility == View.VISIBLE &&
            EndpointPolicy.allowsRequest(endpoint, web.url.orEmpty())

    private fun emitKeyboardInput(message: JSONObject) {
        val target = keyboardTarget ?: return
        if (!trustedKeyboardPage()) return
        idleDisplay.userActivity()
        message.put("target", target)
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('windock-keyboard-input',{detail:$message}))", null)
    }

    private fun emitKeyboardEvent(action: String) {
        if (!trustedKeyboardPage()) return
        val data = JSONObject().put("action", action)
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('windock-keyboard-action',{detail:$data}))", null)
    }

    private fun hideRemoteKeyboard() {
        if (!::keyboardBar.isInitialized) return
        keyboardTarget = null
        keyboardEditor.resetSession()
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(keyboardEditor.windowToken, 0)
        keyboardEditor.clearFocus()
        keyboardBar.visibility = View.GONE
    }

    private inner class KeyboardBridge {
        @JavascriptInterface fun showKeyboard(target: String, password: Boolean) {
            if (!target.matches(Regex("[1-9][0-9]{0,15}"))) return
            runOnUiThread {
                if (!trustedKeyboardPage()) return@runOnUiThread
                if (keyboardTarget != target) keyboardEditor.configure(password)
                keyboardTarget = target
                keyboardBar.visibility = View.VISIBLE
                keyboardEditor.requestFocus()
                keyboardEditor.post {
                    if (keyboardTarget == target) showRemoteIme()
                }
            }
        }
        @JavascriptInterface fun hideKeyboard() { runOnUiThread { hideRemoteKeyboard() } }
        @JavascriptInterface fun showPhoneSettings() { runOnUiThread { if (trustedKeyboardPage()) showPhoneOptions() } }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) { hideSystemBars(); if (keyboardTarget != null) showRemoteIme() }
    }

    private fun showRemoteIme() {
        keyboardEditor.doOnLayout {
            if (keyboardTarget != null && trustedKeyboardPage() && keyboardEditor.hasWindowFocus())
                WindowCompat.getInsetsController(window, keyboardEditor).show(WindowInsetsCompat.Type.ime())
        }
    }

    private fun setBusy(busy: Boolean) {
        if (!busy) web.removeCallbacks(loadTimeout)
        connecting = busy
        connectButton.isEnabled = !busy
        retryButton.isEnabled = !busy
        address.isEnabled = !busy
        findViewById<View>(R.id.usb_connect).isEnabled = !busy
        findViewById<View>(R.id.progress).visibility = if (busy) View.VISIBLE else View.GONE
    }

    private fun failConnection(message: Int) {
        hideRemoteKeyboard()
        loadFailed = true
        setBusy(false)
        web.visibility = View.GONE
        connection.visibility = View.VISIBLE
        status.setText(message)
        syncIdleDisplay()
    }

    /** Validate remembered, entered and discovered hosts with the same health check. */
    private fun connect(manual: String? = null) {
        if (connecting) return
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(address.windowToken, 0)
        web.stopLoading()
        web.visibility = View.GONE
        syncIdleDisplay()
        connection.visibility = View.VISIBLE
        status.setText(if (usbOnly) R.string.usb_searching else R.string.searching)
        setBusy(true)
        val useUsb = usbOnly
        io.execute {
            val networks = LocalNetwork.available()
            val remembered = manual ?: ServerUrl.load(this)
            val selected = remembered?.takeIf { Discovery.permitsRememberedEndpoint(it, useUsb, networks) && reachable(it) }
                ?: if (manual == null) Discovery.find(::reachable, useUsb, networks) else null
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                if (selected == null) {
                    failConnection(if (useUsb) R.string.usb_not_found else R.string.not_found)
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
        if (keyboardBar.visibility == View.VISIBLE) {
            keyboardEditor.commitDraft()
            hideRemoteKeyboard()
            emitKeyboardEvent("closed")
            return
        }
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

    override fun onResume() { super.onResume(); resumed = true; if (::web.isInitialized) web.onResume(); syncIdleDisplay() }
    override fun onPause() { resumed = false; wakingGesture = false; wakingKeys.clear(); syncIdleDisplay(); hideRemoteKeyboard(); if (::web.isInitialized) web.onPause(); super.onPause() }
    override fun onDestroy() {
        phoneDialog?.setOnDismissListener(null)
        phoneDialog?.dismiss()
        idleDisplay.close()
        io.shutdownNow()
        web.removeCallbacks(loadTimeout)
        web.stopLoading()
        web.destroy()
        super.onDestroy()
    }
}
