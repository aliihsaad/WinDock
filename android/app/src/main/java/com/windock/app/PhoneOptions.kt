package com.windock.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.provider.Settings
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast

object PhoneOptions {
    fun displayDialog(activity: Activity, saved: () -> Unit): AlertDialog {
        val dp = activity.resources.displayMetrics.density
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((24 * dp).toInt(), (8 * dp).toInt(), (24 * dp).toInt(), (12 * dp).toInt())
        }
        fun text(value: String) = TextView(activity).apply {
            text = value; setTextColor(Color.LTGRAY); textSize = 13f
            setPadding(0, (10 * dp).toInt(), 0, (8 * dp).toInt())
            content.addView(this)
        }
        fun select(label: String, labels: Array<String>, selected: Int, viewId: Int): Spinner {
            val heading = text(label)
            return Spinner(activity).apply {
                id = viewId; contentDescription = label; heading.labelFor = id
                adapter = ArrayAdapter(activity, android.R.layout.simple_spinner_dropdown_item, labels)
                setSelection(selected)
                content.addView(this, LinearLayout.LayoutParams(-1, (48 * dp).toInt()))
            }
        }
        val current = PhonePreferences.display(activity)
        text(activity.getString(R.string.phone_options_intro))
        val dim = select(activity.getString(R.string.dim_after), activity.resources.getStringArray(R.array.dim_delays),
            DisplayPolicy.DIM_TIMES.indexOf(current.dimAfterMs), R.id.dim_delay)
        val level = select(activity.getString(R.string.dim_level), arrayOf("5%", "10%", "20%"),
            DisplayPolicy.DIM_LEVELS.indexOf(current.dimPercent), R.id.dim_level)
        val sleep = select(activity.getString(R.string.sleep_after), activity.resources.getStringArray(R.array.sleep_delays),
            DisplayPolicy.SLEEP_TIMES.indexOf(current.sleepAfterMs), R.id.sleep_delay)
        text(activity.getString(R.string.screen_sleep_explanation))
        text(activity.getString(R.string.display_care_note))
        content.addView(Button(activity).apply {
            text = activity.getString(R.string.android_display_settings); isAllCaps = false
            setOnClickListener { openSettings(activity, Settings.ACTION_DISPLAY_SETTINGS) }
        })
        return AlertDialog.Builder(activity).setTitle(R.string.phone_options)
            .setView(ScrollView(activity).apply { addView(content) })
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.save) { _, _ ->
                PhonePreferences.saveDisplay(activity, DisplayPolicy(
                    DisplayPolicy.DIM_TIMES[dim.selectedItemPosition], DisplayPolicy.SLEEP_TIMES[sleep.selectedItemPosition],
                    DisplayPolicy.DIM_LEVELS[level.selectedItemPosition]))
                saved()
            }.create()
    }

    fun usbDialog(activity: Activity, connect: () -> Unit): AlertDialog = AlertDialog.Builder(activity)
        .setTitle(R.string.usb_title).setMessage(R.string.usb_instructions)
        .setNegativeButton(android.R.string.cancel, null)
        .setNeutralButton(R.string.network_settings) { _, _ -> openSettings(activity, Settings.ACTION_WIRELESS_SETTINGS) }
        .setPositiveButton(R.string.find_usb_pc) { _, _ -> connect() }.create()

    private fun openSettings(activity: Activity, action: String) {
        try { activity.startActivity(Intent(action)) }
        catch (_: ActivityNotFoundException) { Toast.makeText(activity, R.string.open_settings_manually, Toast.LENGTH_LONG).show() }
    }
}
