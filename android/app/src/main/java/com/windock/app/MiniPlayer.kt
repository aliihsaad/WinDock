package com.windock.app

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/** Pure rules, so they can be unit tested without Android. */
object MiniPlayerPolicy {
    private val ID = Regex("^[A-Za-z0-9_-]{11}$")
    private val NAVIGABLE = Regex("^(?:[a-z0-9-]+\\.)*(?:youtube\\.com|youtube-nocookie\\.com|google\\.com|googlevideo\\.com|gstatic\\.com|ytimg\\.com|accounts\\.google\\.com)$")

    /** Only a plain YouTube watch page may be opened by the dock. Anything else is refused. */
    fun isPlayable(url: String?): Boolean {
        val uri = try { java.net.URI(url ?: return false) } catch (_: Exception) { return false }
        if (uri.scheme != "https" || uri.userInfo != null || uri.port != -1) return false
        val host = uri.host?.lowercase() ?: return false
        if (host != "m.youtube.com" && host != "www.youtube.com" && host != "youtube.com") return false
        if (uri.path != "/watch") return false
        val v = (uri.rawQuery ?: return false).split("&").firstOrNull { it.startsWith("v=") }?.substring(2) ?: return false
        return ID.matches(v)
    }

    /** Pages inside the player may only move around on YouTube/Google hosts over https. */
    fun mayNavigate(scheme: String?, host: String?): Boolean =
        scheme == "https" && host != null && NAVIGABLE.matches(host.lowercase())
}

/**
 * A small floating YouTube window. It uses its own WebView with no JavaScript bridge, so the
 * page can never reach the dock's PC controls.
 */
class MiniPlayer(private val activity: Activity) {
    private var root: LinearLayout? = null
    private var web: WebView? = null
    private var large = false

    @SuppressLint("SetJavaScriptEnabled")
    fun open(url: String) {
        if (!MiniPlayerPolicy.isPlayable(url)) return
        close()
        val density = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()
        val view = WebView(activity).apply {
            settings.javaScriptEnabled = true // YouTube's player needs it
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean =
                    !MiniPlayerPolicy.mayNavigate(r.url.scheme, r.url.host)
            }
            setBackgroundColor(Color.BLACK)
        }
        fun button(label: String, onTap: () -> Unit) = TextView(activity).apply {
            text = label; setTextColor(Color.WHITE); textSize = 16f; gravity = Gravity.CENTER
            setPadding(dp(14), dp(6), dp(14), dp(6)); setOnClickListener { onTap() }
            contentDescription = if (label == "✕") "Close player" else "Resize player"
        }
        val bar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; setBackgroundColor(0xCC111111.toInt()); gravity = Gravity.END
            addView(View0(activity), LinearLayout.LayoutParams(0, 1, 1f))
            addView(button("⤢") { toggleSize(view) })
            addView(button("✕") { close() })
        }
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK); elevation = dp(8).toFloat()
            addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        // Drag by the bar.
        var dx = 0f; var dy = 0f
        bar.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { dx = box.x - e.rawX; dy = box.y - e.rawY; true }
                MotionEvent.ACTION_MOVE -> {
                    val parent = box.parent as? ViewGroup
                    val maxX = ((parent?.width ?: 0) - box.width).coerceAtLeast(0).toFloat()
                    val maxY = ((parent?.height ?: 0) - box.height).coerceAtLeast(0).toFloat()
                    box.x = (e.rawX + dx).coerceIn(0f, maxX); box.y = (e.rawY + dy).coerceIn(0f, maxY); true
                }
                else -> false
            }
        }
        activity.addContentView(box, FrameLayout.LayoutParams(dp(300), dp(190), Gravity.BOTTOM or Gravity.END).apply { setMargins(dp(12), dp(12), dp(12), dp(12)) })
        root = box; web = view; large = false
        view.loadUrl(url)
    }

    private fun toggleSize(view: WebView) {
        large = !large
        val box = root ?: return
        val density = activity.resources.displayMetrics.density
        val lp = box.layoutParams
        lp.width = ((if (large) 560 else 300) * density).toInt()
        lp.height = ((if (large) 350 else 190) * density).toInt()
        box.layoutParams = lp
    }

    fun close() {
        web?.apply { stopLoading(); loadUrl("about:blank"); destroy() }
        (root?.parent as? ViewGroup)?.removeView(root)
        root = null; web = null
    }

    private fun View0(a: Activity) = android.view.View(a)
}
