package com.windock.app

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.content.res.ColorStateList
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** Native picker stays available even when a selected PC is offline. */
class PcPicker(private val activity: Activity, private val current: String?,
               private val select: (KnownHost) -> Unit, private val manual: () -> Unit) {
    private val dp = activity.resources.displayMetrics.density
    private val worker = Executors.newSingleThreadExecutor()
    private var job: Future<*>? = null
    private var generation = 0
    private var closed = false
    private var scanning = false
    private var available = emptyList<KnownHost>()
    private var confirming: KnownHost? = null
    private val content = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(px(20), 0, px(20), px(8))
    }
    private val scroll = ScrollView(activity).apply { addView(content) }
    val dialog: AlertDialog = AlertDialog.Builder(activity).setTitle(R.string.switch_pc)
        .setView(scroll)
        .setNegativeButton(R.string.close, null)
        .setNeutralButton(R.string.enter_address) { _, _ -> manual() }
        .setPositiveButton(R.string.refresh, null).create()

    fun start() {
        dialog.window?.setBackgroundDrawable(GradientDrawable().apply {
            setColor(0xff111d26.toInt()); cornerRadius = px(20).toFloat()
            setStroke(px(1), 0xff34444f.toInt())
        })
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { refresh() }
        refresh()
    }

    fun close() {
        closed = true
        generation++
        job?.cancel(true)
        worker.shutdownNow()
    }

    private fun refresh() {
        if (closed) return
        job?.cancel(true)
        val scan = ++generation
        scanning = true
        available = emptyList()
        render()
        val saved = ServerUrl.knownHosts(activity)
        job = worker.submit {
            val found = PcScanner.scan(saved)
            activity.runOnUiThread {
                if (closed || scan != generation || activity.isDestroyed || activity.isFinishing) return@runOnUiThread
                available = found.sortedWith(compareBy<KnownHost> { it.endpoint != current }
                    .thenBy { candidate -> saved.none { it.endpoint == candidate.endpoint } }
                    .thenBy { it.usb }.thenBy { it.endpoint }).distinctBy { it.identity }
                    .sortedWith(compareBy<KnownHost> { it.endpoint != current }.thenBy { it.name.lowercase() })
                scanning = false
                render()
            }
        }
    }

    private fun px(value: Int) = (value * dp).toInt()
    private fun text(value: String, heading: Boolean = false) = TextView(activity).apply {
        text = value
        setTextColor(if (heading) Color.WHITE else 0xffaabbc8.toInt())
        textSize = if (heading) 15f else 13f
        if (heading) setTypeface(null, Typeface.BOLD)
        setPadding(0, px(10), 0, px(8))
    }
    private fun button(label: String, action: () -> Unit) = Button(activity).apply {
        text = label; isAllCaps = false
        setTextColor(0xffeef6f5.toInt())
        backgroundTintList = ColorStateList.valueOf(0xff20333b.toInt())
        setOnClickListener { action() }
    }

    private fun render() {
        scroll.scrollTo(0, 0)
        content.removeAllViews()
        confirming?.let { host ->
            content.addView(text(activity.getString(R.string.forget_pc, host.name), true))
            content.addView(text(activity.getString(R.string.forget_explanation)))
            content.addView(button(activity.getString(R.string.forget)) {
                ServerUrl.forgetHost(activity, host.endpoint, host.hostId)
                confirming = null; render()
            })
            content.addView(button(activity.getString(android.R.string.cancel)) { confirming = null; render() })
            return
        }
        val saved = ServerUrl.knownHosts(activity)
        content.addView(text(activity.getString(if (scanning) R.string.pc_scanning else R.string.pc_scan_hint)))
        if (available.isNotEmpty()) {
            content.addView(text(activity.getString(R.string.available_pcs), true))
            available.forEach { row(it, saved.any { savedHost -> savedHost.identity == it.identity || savedHost.endpoint == it.endpoint }, true) }
        } else if (!scanning) content.addView(text(activity.getString(R.string.no_available_pcs)))
        val missing = saved.filter { host -> available.none { it.identity == host.identity || it.endpoint == host.endpoint } }
        if (missing.isNotEmpty()) {
            content.addView(text(activity.getString(R.string.saved_pcs), true))
            missing.forEach { row(it, true, false) }
        }
    }

    private fun row(host: KnownHost, saved: Boolean, online: Boolean) {
        val card = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(px(12), px(4), px(12), px(4))
            background = GradientDrawable().apply {
                setColor(0xff18242e.toInt()); cornerRadius = px(12).toFloat()
                setStroke(px(1), if (host.endpoint == this@PcPicker.current) 0xff88e9c4.toInt() else 0xff34444f.toInt())
            }
        }
        val state = if (host.endpoint == current) activity.getString(R.string.current_pc)
            else if (online) activity.getString(R.string.pc_available)
            else activity.getString(if (scanning) R.string.pc_checking else R.string.pc_not_found)
        val details = listOf(host.platform, if (host.usb) "USB" else "LAN", state).filter { it.isNotBlank() }.joinToString(" · ")
        card.addView(button("${host.name}\n$details\n${host.endpoint}") {
            dialog.dismiss()
            select(host)
        }.apply { gravity = android.view.Gravity.START or android.view.Gravity.CENTER_VERTICAL; textSize = 14f },
            LinearLayout.LayoutParams(0, -2, 1f))
        if (saved) card.addView(button(activity.getString(R.string.forget)) { confirming = host; render() }.apply {
            contentDescription = activity.getString(R.string.forget_pc, host.name)
        })
        content.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = px(10) })
    }
}
