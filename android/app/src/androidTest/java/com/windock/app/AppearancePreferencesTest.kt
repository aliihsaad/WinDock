package com.windock.app

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppearancePreferencesTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val first = "http://10.0.2.2:18622"
    private val moved = "http://10.0.2.2:18623"
    private val hostA = "11111111-1111-4111-8111-111111111111"
    private val hostB = "22222222-2222-4222-8222-222222222222"

    @Test fun migratesOnceRestoresAcrossAddressesAndSeparatesPcs() {
        val disk = context.getSharedPreferences("appearance-test", Context.MODE_PRIVATE)
        disk.edit().clear().commit()
        try {
            val store = AppearancePreferences(disk)
            store.select(first, hostA)
            val legacy = JSONObject().put("windock-performance", "off")
                .put("windock-layout", "{\"perPage\":8,\"showLabels\":true,\"theme\":\"frost\"}").toString()
            fun values(origin: String, old: String = legacy) = JSONObject(store.snapshot(origin, old)!!).getJSONObject("values")
            assertEquals("off", values(first).getString("windock-performance"))
            assertTrue(store.save(first, hostA, "windock-performance", "on"))
            assertEquals("on", values(first).getString("windock-performance")) // stale web Off cannot win
            val reopened = AppearancePreferences(disk)
            reopened.select(moved, hostA)
            val restored = JSONObject(reopened.snapshot(moved, "{}")!!).getJSONObject("values")
            assertEquals("on", restored.getString("windock-performance"))
            assertTrue(JSONObject(restored.getString("windock-layout")).getBoolean("showLabels"))
            store.select(first, hostB)
            assertEquals(0, values(first).length()) // same URL, different physical PC
            assertEquals(0, values(first).length()) // repeated startup must not import stale values
            assertFalse(store.save(first, hostA, "windock-performance", "off")) // old page after switch
            assertTrue(store.save(first, hostB, "windock-performance", "off"))
            store.select(first, hostA)
            assertEquals("on", values(first).getString("windock-performance"))
        } finally { disk.edit().clear().commit() }
    }

    @Test fun restrictsBridgeAndFallsBackForOlderHosts() {
        val disk = context.getSharedPreferences("appearance-test", Context.MODE_PRIVATE)
        disk.edit().clear().commit()
        try {
            val store = AppearancePreferences(disk)
            store.select(first, "not-a-host-id")
            assertEquals(first, JSONObject(store.snapshot(first, "not-json")!!).getString("scope"))
            assertNull(store.snapshot("https://example.com", "{}"))
            assertFalse(store.save(moved, first, "windock-performance", "on"))
            assertFalse(store.save(first, first, "session-token", "secret"))
            assertFalse(store.save(first, first, "windock-performance", "yes"))
            for (value in listOf("[]", "broken", "{\"token\":\"secret\"}", "{\"showLabels\":\"true\"}", " ".repeat(2049)))
                assertFalse(value.take(60), store.save(first, first, "windock-layout", value))
            assertTrue(store.save(first, first, "windock-performance", "on"))
            store.select(moved)
            assertEquals(0, JSONObject(store.snapshot(moved, "{}")!!).getJSONObject("values").length())
            store.select(null)
            assertNull(store.snapshot(first, "{}"))
            assertFalse(store.save(first, first, "windock-performance", "off"))
        } finally { disk.edit().clear().commit() }
    }
}
