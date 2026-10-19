package com.windock.app

import android.content.Context
import android.text.InputFilter
import android.text.InputType
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.widget.EditText
import androidx.core.widget.doOnTextChanged

/**
 * The IME composes/autocorrects a word locally. Only committed text goes to the PC,
 * so composing replacements never delete unrelated text from the PC document.
 * We deliberately do not mirror existing PC field contents into the IME.
 */
class RemoteKeyboardEditor(context: Context) : EditText(context) {
    var onText: (String) -> Unit = {}
    var onRemoteKey: (String) -> Unit = {}
    var onUserActivity: () -> Unit = {}
    private var discarding = false
    private var generation = 0

    init {
        if (android.os.Build.VERSION.SDK_INT >= 26)
            importantForAutofill = IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        setTextColor(0xffe1e7f0.toInt())
        setHintTextColor(0xff8490a2.toInt())
        hint = "Type on PC…"
        textSize = 15f
        filters = arrayOf(InputFilter.LengthFilter(1024))
        configure(false)
        doOnTextChanged { _, _, before, count ->
            // IME composition may remain local for a long time before a word
            // is committed to the PC. It still counts as active typing.
            if (!discarding && (before > 0 || count > 0)) onUserActivity()
        }
    }

    fun configure(password: Boolean) {
        resetSession()
        inputType = if (password) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        maxLines = 2
        imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN or EditorInfo.IME_FLAG_NO_EXTRACT_UI or
            EditorInfo.IME_ACTION_NONE
        if (android.os.Build.VERSION.SDK_INT >= 26)
            imeOptions = imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
    }

    fun discardDraft() {
        discarding = true
        text?.clear()
        discarding = false
    }
    fun resetSession() { generation++; discardDraft() }

    fun commitDraft() {
        if (discarding) return
        val value = text?.toString().orEmpty()
        discardDraft()
        val normalized = value.replace("\r\n", "\n").replace('\r', '\n')
        var start = 0
        normalized.forEachIndexed { index, character ->
            if (character == '\n' || character == '\t') {
                if (index > start) onText(normalized.substring(start, index))
                onRemoteKey(if (character == '\n') "Enter" else "Tab")
                start = index + 1
            }
        }
        if (start < normalized.length) onText(normalized.substring(start))
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val base = super.onCreateInputConnection(outAttrs) ?: return null
        val ticket = generation
        return object : InputConnectionWrapper(base, false) {
            override fun setComposingText(value: CharSequence?, newCursorPosition: Int): Boolean =
                ticket == generation && super.setComposingText(value, newCursorPosition)
            override fun setSelection(start: Int, end: Int): Boolean =
                ticket == generation && super.setSelection(start, end)
            override fun setComposingRegion(start: Int, end: Int): Boolean =
                ticket == generation && super.setComposingRegion(start, end)
            @androidx.annotation.RequiresApi(33)
            override fun setComposingRegion(start: Int, end: Int, attribute: android.view.inputmethod.TextAttribute?): Boolean =
                setComposingRegion(start, end)
            override fun performContextMenuAction(id: Int): Boolean =
                ticket == generation && super.performContextMenuAction(id)
            @androidx.annotation.RequiresApi(33)
            override fun setComposingText(value: CharSequence, newCursorPosition: Int, attribute: android.view.inputmethod.TextAttribute?): Boolean =
                setComposingText(value, newCursorPosition)
            override fun commitText(value: CharSequence?, newCursorPosition: Int): Boolean {
                if (ticket != generation) return false
                val result = super.commitText(value, newCursorPosition)
                commitDraft()
                return result
            }
            @androidx.annotation.RequiresApi(33)
            override fun commitText(value: CharSequence, newCursorPosition: Int, attribute: android.view.inputmethod.TextAttribute?): Boolean =
                commitText(value, newCursorPosition)
            override fun finishComposingText(): Boolean {
                if (ticket != generation) return false
                val result = super.finishComposingText()
                commitDraft()
                return result
            }
            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                if (ticket != generation) return false
                if (!text.isNullOrEmpty()) return super.deleteSurroundingText(beforeLength, afterLength)
                repeat(beforeLength.coerceIn(0, 32)) { onRemoteKey("Backspace") }
                repeat(afterLength.coerceIn(0, 32)) { onRemoteKey("Delete") }
                return true
            }
            override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean {
                if (ticket != generation) return false
                if (!text.isNullOrEmpty()) return super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
                return deleteSurroundingText(beforeLength, afterLength)
            }
            override fun sendKeyEvent(event: KeyEvent): Boolean {
                if (ticket != generation) return false
                return handleKey(event) || super.sendKeyEvent(event)
            }
            override fun performEditorAction(actionCode: Int): Boolean {
                if (ticket != generation) return false
                commitDraft()
                onRemoteKey("Enter")
                return true
            }
        }
    }

    private fun handleKey(event: KeyEvent): Boolean {
        val key = when (event.keyCode) {
            KeyEvent.KEYCODE_DEL -> if (text.isNullOrEmpty()) "Backspace" else null
            KeyEvent.KEYCODE_FORWARD_DEL -> if (text.isNullOrEmpty()) "Delete" else null
            KeyEvent.KEYCODE_ENTER -> "Enter"
            KeyEvent.KEYCODE_TAB -> "Tab"
            KeyEvent.KEYCODE_ESCAPE -> "Escape"
            KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
            KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
            KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
            KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
            else -> null
        } ?: return false
        if (event.action == KeyEvent.ACTION_DOWN) {
            commitDraft()
            onRemoteKey(key)
        }
        return true
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (handleKey(event)) return true
        val result = super.onKeyDown(keyCode, event)
        if (BaseInputConnection.getComposingSpanStart(text) < 0) commitDraft()
        return result
    }

    override fun onTextContextMenuItem(id: Int): Boolean {
        val result = super.onTextContextMenuItem(id)
        if (id == android.R.id.paste || id == android.R.id.pasteAsPlainText) commitDraft()
        return result
    }
}
