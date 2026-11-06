package com.windock.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Build
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
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
import androidx.core.view.ViewCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkRequest
import android.net.LinkProperties
import com.google.zxing.integration.android.IntentIntegrator

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
    private lateinit var files: NativeFiles
    private var resumed = false
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var endpoint: String? = null
    private var loadFailed = false
    private var connecting = false
    // An intentional destination, not a failed connection: background retries must not leave it.
    private var editingConnection = false
    private lateinit var idleDisplay: IdleDisplayController
    private var phoneDialog: AlertDialog? = null
    private var pcPicker: PcPicker? = null
    private lateinit var appUpdates: AppUpdates
    private lateinit var appearance: AppearancePreferences
    private var wakingGesture = false
    private val wakingKeys = mutableSetOf<Int>()
    private var usbOnly = false
    private var backCallback: OnBackInvokedCallback? = null
    private lateinit var securePairing: SecurePairing
    @Volatile private var secureTransport: SecureTransport? = null
    private var secureBridge: SecureWebBridge? = null
    private var generation = 0
    private var secureJob: java.util.concurrent.Future<*>? = null
    private var retryAttempt = 0
    private var lastFailure: ConnectionFailure? = null
    private var networkMonitor: ConnectivityManager.NetworkCallback? = null
    private val secureRetry = Runnable { if (resumed && !connecting && !editingConnection) connect(restoreOnStartup = true) }
    private fun pageAllowed(url: String?): Boolean = secureTransport?.allows(url) ?: EndpointPolicy.allowsRequest(endpoint, url)
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
        securePairing = SecurePairing(this)
        editingConnection = savedInstanceState?.getBoolean("editingConnection") == true
        files = NativeFiles(this, connection = { fileConnection() }, connectionState = { fileConnectionState() },
            connect = { showPcPicker() }, visibilityChanged = { syncIdleDisplay() })
        files.restore(savedInstanceState)
        findViewById<Button>(R.id.connection_files).setOnClickListener { files.show() }
        ServerUrl.migrate(this)
        usbOnly = PhonePreferences.usbOnly(this)
        idleDisplay = IdleDisplayController(this, findViewById(R.id.idle_cover), onRest = {
            hideRemoteKeyboard()
        })
        appUpdates = AppUpdates(this)
        appearance = AppearancePreferences(getSharedPreferences("appearance", MODE_PRIVATE))
        findViewById<Button>(R.id.app_updates).setOnClickListener { showUpdates() }
        setupRemoteKeyboard()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { root, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            root.setPadding(safe.left, safe.top, safe.right, maxOf(safe.bottom, ime.bottom))
            insets
        }
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = OnBackInvokedCallback { handleBack() }.also {
                onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, it)
            }
        }
        address.setText(ServerUrl.load(this).orEmpty())
        if (BuildConfig.REQUIRE_SECURE_HOST) address.setHint(R.string.secure_address_hint)
        connectButton.setOnClickListener {
            val selected = EndpointPolicy.normalize(address.text.toString())
            if (selected == null) address.error = getString(if (EndpointPolicy.canonicalize(address.text.toString()) != null)
                R.string.address_not_local else R.string.invalid_address)
            else if (BuildConfig.REQUIRE_SECURE_HOST && !EndpointPolicy.isSecure(selected)) address.error = getString(R.string.secure_host_required)
            else connect(selected)
        }
        retryButton.setOnClickListener {
            retryAttempt = 0; selectConnection(false); connect()
        }
        findViewById<Button>(R.id.scan_computer).setOnClickListener {
            showConnectionSettings()
            IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setBeepEnabled(false)
                .setBarcodeImageEnabled(false).setPrompt("Scan the code shown by WinDock on your computer").initiateScan()
        }
        findViewById<Button>(R.id.pairing_text).setOnClickListener {
            showConnectionSettings()
            val input = EditText(this).apply { hint = "Paste pairing text from your computer"; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE }
            showPhoneDialog(AlertDialog.Builder(this).setTitle("Pair this computer").setView(input)
                .setPositiveButton("Pair") { _, _ -> acceptInvitation(input.text.toString().trim()) }.setNegativeButton(android.R.string.cancel, null).create())
        }
        findViewById<Button>(R.id.connection_help).setOnClickListener {
            if (lastFailure == ConnectionFailure.STORAGE) {
                AlertDialog.Builder(this).setTitle("Reset saved secure pairings?")
                    .setMessage("Your saved secure pairing data could not be opened. Reset it, then scan a new code on each computer. This only clears secure pairings on this phone.")
                    .setPositiveButton("Reset pairings") { _, _ ->
                        try { securePairing.reset(); lastFailure = null; status.text = "Choose Scan computer code to pair again." }
                        catch (_: Exception) { status.text = "Clear WinDock's app storage in Android Settings, then pair again." }
                    }.setNegativeButton(android.R.string.cancel, null).show()
                return@setOnClickListener
            }
            showPhoneDialog(AlertDialog.Builder(this).setTitle("Reconnect to your computer")
                .setMessage("1. Open WinDock on the computer.\n2. Use the same Wi-Fi, or connect USB and enable tethering.\n3. Tap Retry.\n\nFor a new or replaced computer, choose Pair a phone securely on its tray menu (Linux: open the pairing link shown by windock), then scan its code. Never scan a code sent by someone else.\n\nDiagnostics: ${lastFailure?.name ?: "NONE"}. No credentials are included.")
                .setPositiveButton(android.R.string.ok, null).create())
        }
        findViewById<Button>(R.id.usb_connect).setOnClickListener { showConnectionSettings(); showUsbSetup() }
        findViewById<Button>(R.id.phone_options).setOnClickListener { showPhoneOptions() }
        findViewById<Button>(R.id.privacy).setOnClickListener { showPrivacy() }
        address.setOnEditorActionListener { _, _, _ -> connectButton.performClick(); true }
        findViewById<Button>(R.id.choose_pc).setOnClickListener { showConnectionSettings(); showPcPicker() }
        address.setOnFocusChangeListener { _, focused ->
            if (focused && !editingConnection && !connecting) showConnectionSettings()
        }
        findViewById<Button>(R.id.connection_cancel).setOnClickListener { showConnectionSettings() }
        findViewById<Button>(R.id.connection_return).setOnClickListener { returnToSavedPc() }
        findViewById<Button>(R.id.connection_more).setOnClickListener {
            val options = findViewById<View>(R.id.connection_options)
            val expanded = options.visibility != View.VISIBLE
            options.visibility = if (expanded) View.VISIBLE else View.GONE
            findViewById<Button>(R.id.connection_more).setText(if (expanded) R.string.fewer_options else R.string.more_options)
        }

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
                !pageAllowed(request.url.toString())

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val transport = secureTransport
                if (pageAllowed(request.url.toString())) {
                    if (transport == null) return null
                    try { if (request.method == "GET") return transport.resource(request.url.toString()) }
                    catch (error: Exception) { runOnUiThread { if (secureTransport === transport) secureFailure(ConnectionFailure.from(error)) } }
                }
                return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                if (editingConnection) { view.stopLoading(); return }
                files.connectionLost()
                hideRemoteKeyboard()
                loadFailed = !pageAllowed(url)
                if (loadFailed) { view.stopLoading(); failConnection(R.string.connection_lost) }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (editingConnection || loadFailed || !pageAllowed(url)) return
                if (secureTransport == null) retryAttempt = 0
                setBusy(false)
                connection.visibility = View.GONE
                web.visibility = View.VISIBLE
                hideSystemBars()
                syncIdleDisplay()
                files.connected()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!editingConnection && request.isForMainFrame) failConnection(R.string.connection_lost)
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (!editingConnection && request.isForMainFrame) failConnection(R.string.connection_lost)
            }
        }
        hideSystemBars()
        monitorNetworks()
        if (editingConnection) showConnectionSettings() else connect(restoreOnStartup = true)
        if (savedInstanceState == null && files.share(intent)) setIntent(Intent(Intent.ACTION_MAIN))
    }

    private fun fileConnection(): FileConnection? {
        if (!trustedKeyboardPage()) return null
        secureTransport?.let { return runCatching { it.files() }.getOrNull() }
        val url = endpoint?.takeIf { EndpointPolicy.isSecure(it) } ?: return null
        return FileConnection.legacy(url)
    }

    private fun fileConnectionState(): NativeFiles.ConnectionState {
        if (!resumed || connecting) return NativeFiles.ConnectionState.CONNECTING
        // onResume posts the saved-host reconnect; there is no transport in that short interval.
        if (!loadFailed && secureTransport == null && securePairing.hasSelected()) return NativeFiles.ConnectionState.CONNECTING
        return if (trustedKeyboardPage() && (secureTransport != null || FileConnection.hasLegacySession(endpoint)))
            NativeFiles.ConnectionState.READY else NativeFiles.ConnectionState.DISCONNECTED
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (files.share(intent)) setIntent(Intent(Intent.ACTION_MAIN))
    }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("editingConnection", editingConnection)
        files.save(outState); super.onSaveInstanceState(outState)
    }

    private fun showConnectionSettings() {
        editingConnection = true
        generation++; secureJob?.cancel(true); secureJob = null
        web.removeCallbacks(secureRetry); web.removeCallbacks(loadTimeout)
        secureBridge?.close(); secureBridge = null
        secureTransport?.close(); secureTransport = null
        web.removeJavascriptInterface("WinDockSecure")
        web.stopLoading()
        // Do not clear the selected identity, credentials, saved addresses or dock.
        failConnection(R.string.connection_intro)
    }

    private fun returnToSavedPc() {
        // Trying another address deselects the managed PC, but never deletes its trust record.
        // Restore only that already-trusted identity, not a new identity from discovery.
        if (!securePairing.hasSelected()) {
            val last = ServerUrl.load(this)
            val host = ServerUrl.knownHosts(this).firstOrNull { it.endpoint == last }
            try {
                if (host != null && securePairing.get(host.hostId) != null) securePairing.select(host.hostId)
            } catch (_: Exception) {
                editingConnection = false; secureFailure(ConnectionFailure.STORAGE); return
            }
        }
        connect(restoreOnStartup = true)
    }

    private fun showPcPicker() {
        if (phoneDialog != null || connecting) return
        hideRemoteKeyboard()
        val picker = PcPicker(this, endpoint.takeIf { web.visibility == View.VISIBLE && !loadFailed },
            select = { host ->
                if (host.requiresPairing) {
                    showConnectionSettings(); selectConnection(host.usb, host.endpoint)
                    status.setText(R.string.pc_pairing_instructions)
                } else {
                    val trusted = try { securePairing.get(host.hostId) } catch (_: Exception) { null }
                    securePairing.select(trusted?.hostId)
                    selectConnection(host.usb, host.endpoint)
                    if (trusted != null) connectSecure(trusted.copy(endpoint = host.endpoint)) else connect(host.endpoint)
                }
            },
            manual = { showConnectionSettings(); address.requestFocus() })
        pcPicker = picker
        showPhoneDialog(picker.dialog) { picker.close(); if (pcPicker === picker) pcPicker = null }
        picker.start()
    }

    private fun syncIdleDisplay() {
        if (::idleDisplay.isInitialized) idleDisplay.setActive(resumed && !connecting && !loadFailed &&
            web.visibility == View.VISIBLE && phoneDialog == null && (!::files.isInitialized || !files.isShowing()))
    }

    private fun showUpdates() {
        if (phoneDialog == null) showPhoneDialog(appUpdates.dialog())
    }

    private fun showPhoneOptions() {
        if (phoneDialog != null) return
        showPhoneDialog(PhoneOptions.displayDialog(this) { idleDisplay.reloadPreferences() })
    }

    private fun showPrivacy() {
        if (phoneDialog != null) return
        val text = TextView(this).apply {
            setPadding(24, 16, 24, 16)
            text = assets.open("privacy.txt").bufferedReader().use { it.readText() }
            setTextIsSelectable(true)
        }
        showPhoneDialog(AlertDialog.Builder(this).setTitle(R.string.privacy)
            .setView(android.widget.ScrollView(this).apply { addView(text) })
            .setPositiveButton(android.R.string.ok, null).create())
    }

    private fun showUsbSetup() {
        if (phoneDialog != null) return
        showPhoneDialog(PhoneOptions.usbDialog(this) {
            selectConnection(true); connect()
        })
    }

    private fun showPhoneDialog(dialog: AlertDialog, dismissed: () -> Unit = {}) {
        phoneDialog = dialog
        syncIdleDisplay()
        dialog.setOnDismissListener { dismissed(); if (phoneDialog === dialog) phoneDialog = null; syncIdleDisplay() }
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
            pageAllowed(web.url.orEmpty())

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
        @JavascriptInterface fun openFiles() { runOnUiThread { if (trustedKeyboardPage()) { hideRemoteKeyboard(); files.show() } } }
        private fun appearanceOrigin(origin: String): String =
            if (secureTransport?.allows(origin) == true) endpoint.orEmpty() else origin
        @JavascriptInterface fun getAppearance(origin: String, legacy: String): String? = appearance.snapshot(appearanceOrigin(origin), legacy)
        @JavascriptInterface fun saveAppearance(origin: String, scope: String, key: String, value: String): Boolean =
            appearance.save(appearanceOrigin(origin), scope, key, value)
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
        @JavascriptInterface fun hideKeyboard() { runOnUiThread { if (trustedKeyboardPage()) hideRemoteKeyboard() } }
        @JavascriptInterface fun showPcPicker() { runOnUiThread { if (trustedKeyboardPage()) this@MainActivity.showPcPicker() } }
        @JavascriptInterface fun showConnectionSettings() { runOnUiThread { if (trustedKeyboardPage()) this@MainActivity.showConnectionSettings() } }
        @JavascriptInterface fun getAppVersion(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun showUpdates() { runOnUiThread { if (trustedKeyboardPage()) this@MainActivity.showUpdates() } }
        @JavascriptInterface fun openPcRelease(version: String) { runOnUiThread { if (trustedKeyboardPage()) appUpdates.openPcRelease(version) } }
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
        findViewById<View>(R.id.choose_pc).isEnabled = !busy
        findViewById<View>(R.id.usb_connect).isEnabled = !busy
        findViewById<View>(R.id.progress).visibility = if (busy) View.VISIBLE else View.GONE
        findViewById<View>(R.id.connection_cancel).visibility = if (busy) View.VISIBLE else View.GONE
        findViewById<View>(R.id.connection_return).visibility = if (!busy && (securePairing.hasSelected() || ServerUrl.load(this) != null)) View.VISIBLE else View.GONE
        if (::files.isInitialized) files.connectionChanged()
    }

    private fun selectConnection(useUsb: Boolean, enteredAddress: String? = null) {
        usbOnly = useUsb
        PhonePreferences.setUsbOnly(this, useUsb)
        address.setText(enteredAddress ?: ServerUrl.load(this, useUsb).orEmpty())
        address.setHint(if (BuildConfig.REQUIRE_SECURE_HOST) {
            if (useUsb) R.string.secure_usb_address_hint else R.string.secure_address_hint
        } else if (useUsb) R.string.usb_address_hint else R.string.address_hint)
        findViewById<TextView>(R.id.connection_mode).setText(if (useUsb) R.string.mode_usb else R.string.mode_wifi)
    }

    private fun failConnection(message: Int) {
        if (::files.isInitialized) files.connectionLost()
        hideRemoteKeyboard()
        loadFailed = true
        setBusy(false)
        web.visibility = View.GONE
        connection.visibility = View.VISIBLE
        if (message == R.string.connection_lost && lastFailure != null) status.text = lastFailure!!.message else status.setText(message)
        syncIdleDisplay()
    }

    /** Validate remembered, entered and discovered hosts with the same health check. */
    private fun connect(manual: String? = null, restoreOnStartup: Boolean = false) {
        if (connecting) return
        editingConnection = false
        web.removeCallbacks(secureRetry)
        val trusted = try {
            val addressed = manual?.let { url -> ServerUrl.knownHosts(this).firstOrNull { it.endpoint == url } }
                ?.let { securePairing.get(it.hostId) }
            if (addressed != null) securePairing.select(addressed.hostId)
            addressed ?: securePairing.selected()
        } catch (_: Exception) { secureFailure(ConnectionFailure.STORAGE); return }
        if (trusted != null && (manual == null || manual == trusted.endpoint)) {
            if (restoreOnStartup && usbOnly && LocalNetwork.available().none { it.wired }) selectConnection(false)
            connectSecure(trusted); return
        }
        if (manual != null) securePairing.select(null)
        secureBridge?.close(); secureBridge = null; web.removeJavascriptInterface("WinDockSecure")
        secureTransport?.close(); secureTransport = null
        val legacyGeneration = ++generation
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(address.windowToken, 0)
        web.stopLoading()
        endpoint = null
        appearance.select(null)
        loadFailed = true
        web.visibility = View.GONE
        syncIdleDisplay()
        connection.visibility = View.VISIBLE
        findViewById<TextView>(R.id.connection_mode).setText(if (usbOnly) R.string.mode_usb else R.string.mode_wifi)
        status.setText(if (usbOnly) R.string.usb_searching else R.string.searching)
        setBusy(true)
        val requestedUsb = usbOnly
        io.execute {
            val networks = LocalNetwork.available()
            val useUsb = if (restoreOnStartup) Discovery.useUsbOnStartup(requestedUsb, networks) else requestedUsb
            runOnUiThread {
                if (!isDestroyed && !isFinishing && generation == legacyGeneration) {
                    selectConnection(useUsb, manual)
                    status.setText(if (requestedUsb && !useUsb) R.string.usb_disconnected else if (useUsb) R.string.usb_searching else R.string.searching)
                }
            }
            var identity: KnownHost? = null
            fun reachable(candidate: String): Boolean {
                if (manual == null && !ServerUrl.canAutoConnect(this, candidate)) return false
                identity = HostProbe.read(candidate, useUsb)
                    ?.takeIf { manual != null || ServerUrl.canAutoConnect(this, it) }
                return identity != null
            }
            val remembered = manual ?: ServerUrl.load(this, useUsb)
            val selected = remembered?.takeIf { Discovery.permitsRememberedEndpoint(it, useUsb, networks) && reachable(it) }
                ?: if (manual == null) Discovery.find(::reachable, useUsb, networks, secureOnly = BuildConfig.REQUIRE_SECURE_HOST) else null
            runOnUiThread {
                if (isDestroyed || isFinishing || generation != legacyGeneration) return@runOnUiThread
                if (selected == null) {
                    failConnection(if (BuildConfig.REQUIRE_SECURE_HOST) R.string.secure_host_required else if (useUsb) R.string.usb_not_found else R.string.not_found)
                } else {
                    endpoint = selected
                    appearance.select(selected, identity?.hostId)
                    ServerUrl.save(this, selected, useUsb)
                    identity?.let { ServerUrl.rememberHost(this, it) }
                    address.setText(selected)
                    status.setText(R.string.connecting)
                    loadFailed = false
                    // Only the page URL carries the hint; discovery and saved endpoints stay clean.
                    val activityManager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
                    val memory = ActivityManager.MemoryInfo()
                    activityManager.getMemoryInfo(memory)
                    val automatic = PerformancePolicy.autoEnabled(activityManager.isLowRamDevice, memory.totalMem)
                    web.loadUrl(PerformancePolicy.pageUrl(selected, automatic))
                    web.postDelayed(loadTimeout, 15000)
                }
            }
        }
    }

    @Deprecated("Activity back dispatch for the supported API 24+ range")
    override fun onBackPressed() {
        handleBack()
    }

    private fun handleBack() {
        if (keyboardBar.visibility == View.VISIBLE) {
            keyboardEditor.commitDraft()
            hideRemoteKeyboard()
            emitKeyboardEvent("closed")
            return
        }
        if (web.visibility != View.VISIBLE) {
            if (connecting) showConnectionSettings()
            else if (editingConnection && (securePairing.hasSelected() || ServerUrl.load(this) != null)) returnToSavedPc()
            else finish()
            return
        }
        // Close the shared UI's topmost sheet first; otherwise offer PC selection.
        web.evaluateJavascript("""
            (() => { const sheets = document.querySelectorAll('dialog[open]');
            if (!sheets.length) return false; sheets[sheets.length - 1].close(); return true; })()
        """.trimIndent()) { closed ->
            if (closed != "true" && !isDestroyed) showConnectionSettings()
        }
    }

    @Deprecated("Activity result API retained for the existing Activity shell")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (files.result(requestCode, resultCode, data)) return
        val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (result != null) { result.contents?.let(::acceptInvitation); return }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun acceptInvitation(text: String) {
        val invitation = try { PairingInvitation.parse(text) } catch (_: Exception) {
            if (editingConnection) { lastFailure = ConnectionFailure.PAIRING; status.text = ConnectionFailure.PAIRING.message }
            else secureFailure(ConnectionFailure.PAIRING)
            return
        }
        val previous = try { securePairing.get(invitation.computer.hostId) } catch (_: Exception) { null }
        val proceed = {
            retryAttempt = 0; generation++; secureJob?.cancel(true); setBusy(false)
            connectSecure(invitation.computer, invitation.secret)
        }
        if (previous != null && previous.pin() != invitation.computer.pin()) {
            AlertDialog.Builder(this).setTitle("Computer identity changed")
                .setMessage("Only replace the saved identity if you just showed this code on your own computer. This can happen after resetting WinDock's data.")
                .setPositiveButton("Pair this computer") { _, _ -> proceed() }.setNegativeButton(android.R.string.cancel, null).show()
        } else proceed()
    }

    private fun secureFailure(reason: ConnectionFailure, pairingAttempt: Boolean = false) {
        if (isDestroyed || isFinishing || editingConnection) return
        // A failed attempt to pair a new PC must not reconnect the previously selected one.
        if (pairingAttempt) editingConnection = true
        lastFailure = reason
        secureBridge?.close(); secureBridge = null
        secureTransport?.close(); secureTransport = null
        web.stopLoading()
        failConnection(R.string.connection_lost)
        status.text = reason.message
        web.removeCallbacks(secureRetry)
        val delay = ReconnectPolicy.delay(retryAttempt, resumed && !editingConnection, reason)
        if (delay != null) { retryAttempt++; web.postDelayed(secureRetry, delay) }
    }

    private fun connectSecure(saved: TrustedComputer, invitation: String? = null) {
        if (connecting) return
        editingConnection = false
        web.removeCallbacks(secureRetry); web.stopLoading(); web.removeCallbacks(loadTimeout)
        secureBridge?.close(); secureBridge = null; secureTransport?.close(); secureTransport = null
        web.removeJavascriptInterface("WinDockSecure")
        val attempt = ++generation
        val useUsb = usbOnly
        loadFailed = true; web.visibility = View.GONE; connection.visibility = View.VISIBLE
        status.text = if (invitation == null) "Reconnecting securely…" else "Pairing securely…"
        address.setText(saved.endpoint)
        setBusy(true); syncIdleDisplay()
        secureJob = io.submit {
            var found: SecureTransport? = null
            var identity: KnownHost? = null
            var failure = ConnectionFailure.OFFLINE
            fun probe(candidate: String): Boolean {
                if (Thread.currentThread().isInterrupted || !Discovery.permitsRememberedEndpoint(candidate, useUsb, LocalNetwork.available())) return false
                val transport = SecureTransport(saved.copy(endpoint = candidate), securePairing::save)
                try {
                    identity = transport.health()
                    if (invitation != null) {
                        if (!transport.claim(invitation)) { failure = ConnectionFailure.PAIRING; transport.close(); return false }
                    } else {
                        transport.execute("/api/state").use { response ->
                            if (response.code == 401 || response.code == 429) { failure = if (response.code == 429) ConnectionFailure.LOCKED else ConnectionFailure.AUTH; transport.close(); return false }
                            if (!response.isSuccessful) throw java.io.IOException("Host unavailable")
                        }
                        securePairing.save(transport.computer)
                    }
                    found = transport; return true
                } catch (error: Exception) {
                    val reason = ConnectionFailure.from(error)
                    if (reason != ConnectionFailure.OFFLINE || failure == ConnectionFailure.OFFLINE) failure = reason
                    transport.close(); return false
                }
            }
            try {
                if (!probe(saved.endpoint) && failure !in listOf(ConnectionFailure.AUTH, ConnectionFailure.PAIRING)) {
                    val deadline = System.nanoTime() + 10_000_000_000L
                    val discovered = ManagedDiscovery.find(saved.hostId, useUsb)
                    for (candidate in discovered.filter { it != saved.endpoint }) {
                        if (Thread.currentThread().isInterrupted || System.nanoTime() > deadline) break
                        if (probe(candidate)) break
                    }
                    if (found == null) failure = failure.withDiscovery(discovered.isNotEmpty())
                }
            } catch (error: Exception) { failure = ConnectionFailure.from(error) }
            runOnUiThread {
                if (isDestroyed || isFinishing || attempt != generation) { found?.close(); return@runOnUiThread }
                secureJob = null
                val transport = found
                if (transport == null) { secureFailure(failure, pairingAttempt = invitation != null); return@runOnUiThread }
                secureTransport = transport
                secureBridge = SecureWebBridge(web, transport,
                    failed = { reason -> if (secureTransport === transport) secureFailure(reason) },
                    connected = { if (secureTransport === transport) retryAttempt = 0 }
                ).also { web.addJavascriptInterface(it, "WinDockSecure") }
                endpoint = transport.computer.endpoint
                val onUsb = LocalNetwork.available().any { it.wired && it.contains(java.net.URI(endpoint).host) }
                selectConnection(onUsb, endpoint)
                ServerUrl.save(this, endpoint!!, onUsb)
                identity?.let { ServerUrl.rememberHost(this, it.copy(usb = onUsb)) }
                appearance.select(endpoint, saved.hostId)
                lastFailure = null; loadFailed = false
                val manager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
                val memory = ActivityManager.MemoryInfo(); manager.getMemoryInfo(memory)
                web.loadUrl(PerformancePolicy.pageUrl(transport.computer.origin, PerformancePolicy.autoEnabled(manager.isLowRamDevice, memory.totalMem)))
                web.postDelayed(loadTimeout, 15000)
            }
        }
    }

    private fun monitorNetworks() {
        val manager = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            private fun changed() { runOnUiThread {
                if (!resumed || connecting || editingConnection || !securePairing.hasSelected()) return@runOnUiThread
                retryAttempt = 0; web.removeCallbacks(secureRetry); web.postDelayed(secureRetry, 750)
            } }
            override fun onAvailable(network: Network) = changed()
            override fun onLost(network: Network) = changed()
            override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) = changed()
        }
        manager.registerNetworkCallback(NetworkRequest.Builder().build(), callback)
        networkMonitor = callback
    }

    override fun onResume() {
        super.onResume(); resumed = true
        if (::web.isInitialized) {
            web.onResume(); retryAttempt = 0
            if (!editingConnection && !connecting && ::securePairing.isInitialized && securePairing.hasSelected()) web.post(secureRetry)
        }
        if (::files.isInitialized) files.connectionChanged()
        syncIdleDisplay()
    }
    override fun onPause() {
        files.pause()
        resumed = false; wakingGesture = false; wakingKeys.clear(); syncIdleDisplay(); hideRemoteKeyboard()
        if (::web.isInitialized) { web.removeCallbacks(secureRetry); web.onPause() }
        if (secureTransport != null || secureJob != null) {
            generation++; secureJob?.cancel(true); secureJob = null
            secureBridge?.close(); secureBridge = null; secureTransport?.close(); secureTransport = null
            setBusy(false)
        }
        files.connectionChanged()
        super.onPause()
    }
    override fun onDestroy() {
        files.destroy()
        if (Build.VERSION.SDK_INT >= 33) backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        appearance.select(null)
        pcPicker?.close()
        phoneDialog?.setOnDismissListener(null)
        phoneDialog?.dismiss()
        appUpdates.close()
        idleDisplay.close()
        io.shutdownNow()
        generation++; secureJob?.cancel(true); secureBridge?.close(); secureTransport?.close()
        networkMonitor?.let { (getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) }
        web.removeCallbacks(secureRetry)
        web.removeCallbacks(loadTimeout)
        web.stopLoading()
        web.destroy()
        super.onDestroy()
    }

}
