package com.windock.app

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import kotlin.math.min

/** Uses only this Activity's brightness and keep-awake flag; no admin privileges. */
class IdleDisplayController(private val activity: Activity, private val cover: View,
                            private val clock: () -> Long = SystemClock::uptimeMillis,
                            private val onRest: () -> Unit = {}) {
    private val handler = Handler(Looper.getMainLooper())
    private val originalBrightness = activity.window.attributes.screenBrightness
    private var lastInput = clock()
    private var active = false
    var policy = PhonePreferences.display(activity)
        private set
    var stage = DisplayPolicy.Stage.AWAKE
        private set
    private val tick = Runnable { refresh() }

    fun setActive(enabled: Boolean) {
        if (active == enabled) return
        active = enabled
        lastInput = clock()
        refresh()
    }

    fun reloadPreferences() {
        policy = PhonePreferences.display(activity)
        userActivity()
    }

    /** Returns true when the first gesture should only wake the dimmed/black dock. */
    fun userActivity(): Boolean {
        val waking = active && stage != DisplayPolicy.Stage.AWAKE
        lastInput = clock()
        refresh()
        return waking
    }

    private fun refresh() {
        handler.removeCallbacks(tick)
        val elapsed = (clock() - lastInput).coerceAtLeast(0)
        val previousStage = stage
        stage = if (active) policy.stage(elapsed) else DisplayPolicy.Stage.AWAKE
        if (stage == DisplayPolicy.Stage.RESTING && previousStage != stage) onRest()
        cover.visibility = if (stage == DisplayPolicy.Stage.RESTING) View.VISIBLE else View.GONE
        if (stage == DisplayPolicy.Stage.RESTING) cover.bringToFront()
        val window = activity.window
        if (active && policy.keepsAwake(stage)) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val brightness = when (stage) {
            DisplayPolicy.Stage.AWAKE -> originalBrightness
            DisplayPolicy.Stage.RESTING -> 0f
            DisplayPolicy.Stage.DIMMED -> {
                val current = if (originalBrightness >= 0) originalBrightness else
                    Settings.System.getInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255f
                min(current, policy.dimPercent / 100f)
            }
        }
        if (window.attributes.screenBrightness != brightness) window.attributes = window.attributes.apply { screenBrightness = brightness }
        if (active && stage != DisplayPolicy.Stage.RESTING) policy.nextDeadline(elapsed)?.let {
            handler.postDelayed(tick, (it - elapsed).coerceAtLeast(1))
        }
    }

    fun close() { setActive(false); handler.removeCallbacks(tick) }
}
