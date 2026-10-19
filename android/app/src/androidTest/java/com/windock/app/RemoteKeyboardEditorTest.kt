package com.windock.app

import android.view.inputmethod.EditorInfo
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

class RemoteKeyboardEditorTest {
    @Test fun compositionKeepsTheDockActiveButCleanupDoesNot() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val editor = RemoteKeyboardEditor(instrumentation.targetContext)
            var activity = 0
            editor.onUserActivity = { activity++ }
            val connection = editor.onCreateInputConnection(EditorInfo())!!
            connection.setComposingText("unfinished", 1)
            assertTrue(activity > 0)
            val previous = activity
            editor.resetSession()
            assertEquals(previous, activity)
            assertFalse(connection.setComposingText("stale", 1))
            assertEquals(previous, activity)
        }
    }

    @Test fun compositionEmojiDeletionAndStaleConnection() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val editor = RemoteKeyboardEditor(instrumentation.targetContext)
            val commits = mutableListOf<String>()
            val keys = mutableListOf<String>()
            editor.onText = { commits.add(it) }
            editor.onRemoteKey = { keys.add(it) }
            val connection = editor.onCreateInputConnection(EditorInfo())!!
            connection.setComposingText("helo", 1)
            assertTrue(commits.isEmpty())
            connection.setComposingText("hello", 1)
            connection.commitText("hello ", 1)
            assertEquals(listOf("hello "), commits)
            connection.finishComposingText()
            assertEquals(1, commits.size)
            connection.commitText("🙂👋🏽", 1)
            assertEquals("🙂👋🏽", commits.last())
            connection.deleteSurroundingText(1, 0)
            assertEquals(listOf("Backspace"), keys)
            connection.setComposingText("ab", 1)
            connection.deleteSurroundingText(1, 0)
            assertEquals(1, keys.size)
            // Surrounding deletion excludes the composing region in Android.
            // IMEs replace that region to edit an unfinished word.
            connection.setComposingText("a", 1)
            connection.finishComposingText()
            assertEquals("a", commits.last())
            editor.resetSession()
            assertFalse(connection.commitText("stale", 1))
            assertFalse(connection.deleteSurroundingText(1, 0))
            assertFalse(commits.contains("stale"))
            val fresh = editor.onCreateInputConnection(EditorInfo())!!
            fresh.commitText("مرحبا", 1)
            assertEquals("مرحبا", commits.last())
            fresh.commitText("\n", 1)
            assertEquals("Enter", keys.last())
        }
    }
}
