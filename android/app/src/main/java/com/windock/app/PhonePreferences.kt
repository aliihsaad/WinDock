package com.windock.app

import android.content.Context

/** Phone-only preferences never become shared PC/dock settings. */
object PhonePreferences {
    private fun store(context: Context) = context.getSharedPreferences("phone-options", Context.MODE_PRIVATE)
    fun display(context: Context): DisplayPolicy {
        val prefs = store(context)
        return DisplayPolicy(
            prefs.getLong("dimAfterMs", 30_000).takeIf { it in DisplayPolicy.DIM_TIMES } ?: 30_000,
            prefs.getLong("sleepAfterMs", 0).takeIf { it in DisplayPolicy.SLEEP_TIMES } ?: 0,
            prefs.getInt("dimPercent", 10).takeIf { it in DisplayPolicy.DIM_LEVELS } ?: 10,
        )
    }
    fun saveDisplay(context: Context, policy: DisplayPolicy) {
        store(context).edit().putLong("dimAfterMs", policy.dimAfterMs)
            .putLong("sleepAfterMs", policy.sleepAfterMs).putInt("dimPercent", policy.dimPercent).apply()
    }
    fun usbOnly(context: Context) = store(context).getBoolean("usbOnly", false)
    fun setUsbOnly(context: Context, enabled: Boolean) { store(context).edit().putBoolean("usbOnly", enabled).apply() }
}
