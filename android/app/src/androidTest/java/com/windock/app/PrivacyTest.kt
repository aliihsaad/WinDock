package com.windock.app

import android.view.View
import android.widget.Button
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PrivacyTest {
    @Test fun policyIsAvailableWithoutPairingAndBackDismissesIt() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            // Return to the native connection screen even if a fixture was remembered.
            scenario.onActivity {
                it.findViewById<View>(R.id.web).visibility = View.GONE
                it.findViewById<View>(R.id.connection).visibility = View.VISIBLE
                it.findViewById<Button>(R.id.privacy).performClick()
            }
            assertTrue(device.wait(Until.hasObject(By.textContains("WinDock Privacy Policy")), 5000))
            device.pressBack()
            assertTrue(device.wait(Until.gone(By.textContains("WinDock Privacy Policy")), 5000))
        }
    }
}
