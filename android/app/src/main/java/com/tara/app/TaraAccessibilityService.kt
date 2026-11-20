package com.tara.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent

/** A single remote action. Fractions are 0..1 of the screen so the PC never needs the phone's pixel size. */
data class PhoneAction(val type: String, val x1: Float = 0f, val y1: Float = 0f, val x2: Float = 0f, val y2: Float = 0f, val ms: Long = 0L)

object PhoneActions {
    private val GLOBAL = setOf("back", "home", "recents", "notifications")
    fun clamp(v: Float) = if (v.isNaN()) 0f else v.coerceIn(0f, 1f)
    fun valid(type: String) = type in GLOBAL || type == "tap" || type == "swipe"
    fun normalize(a: PhoneAction): PhoneAction? {
        if (!valid(a.type)) return null
        return a.copy(x1 = clamp(a.x1), y1 = clamp(a.y1), x2 = clamp(a.x2), y2 = clamp(a.y2), ms = a.ms.coerceIn(50L, 1500L))
    }
}

/** Lets the paired PC press Back/Home/Recents and tap or swipe on this phone, only while the user has switched it on. */
class TaraAccessibilityService : AccessibilityService() {
    companion object { @Volatile var instance: TaraAccessibilityService? = null }

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    fun perform(raw: PhoneAction): Boolean {
        val a = PhoneActions.normalize(raw) ?: return false
        return when (a.type) {
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "notifications" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            else -> {
                val m = resources.displayMetrics
                val w = m.widthPixels.toFloat(); val h = m.heightPixels.toFloat()
                val path = Path().apply { moveTo(a.x1 * w, a.y1 * h); if (a.type == "swipe") lineTo(a.x2 * w, a.y2 * h) }
                val duration = if (a.type == "tap") 50L else a.ms
                dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build(), null, null)
            }
        }
    }
}
