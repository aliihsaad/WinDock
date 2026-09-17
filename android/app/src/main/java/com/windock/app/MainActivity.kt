package com.windock.app

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Full-screen WebView host for the WinDock PWA.
 *
 * The native layer does exactly two things the browser cannot: find the PC on
 * the LAN by UDP broadcast, and remember where it was. Everything else — the
 * dock, pairing, controls — is the shared web UI, so there is no second
 * implementation of the interface to keep in sync.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var status: TextView
    private val io = Executors.newSingleThreadExecutor()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        status = findViewById(R.id.status)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                status.visibility = View.GONE
                web.visibility = View.VISIBLE
            }
        }

        connect()
    }

    /** Use the remembered endpoint if it still answers, else rediscover. */
    private fun connect() {
        status.text = getString(R.string.searching)
        io.execute {
            val remembered = ServerUrl.load(this)
            val endpoint = remembered?.takeIf { reachable(it) } ?: Discovery.find()

            runOnUiThread {
                if (endpoint == null) {
                    status.text = getString(R.string.not_found)
                    return@runOnUiThread
                }
                ServerUrl.save(this, endpoint)
                web.loadUrl(endpoint)
            }
        }
    }

    /**
     * Confirm an endpoint is really a WinDock host before loading it.
     * /health is the only unauthenticated route, so this costs no session.
     */
    private fun reachable(endpoint: String): Boolean = try {
        val conn = URL("$endpoint/health").openConnection() as HttpURLConnection
        conn.connectTimeout = 1200
        conn.readTimeout = 1200
        conn.requestMethod = "GET"
        val ok = conn.responseCode == 200 &&
            conn.inputStream.bufferedReader().use(BufferedReader::readText).contains("\"app\":\"windock\"")
        conn.disconnect()
        ok
    } catch (_: Exception) {
        false
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }
}
