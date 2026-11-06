package com.windock.app

import android.os.SystemClock
import android.webkit.WebView
import android.content.Intent
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class FilesTransferTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val device get()=UiDevice.getInstance(instrumentation)
    private fun fixture(path: String): JSONObject {
        Socket().use { socket ->
            socket.connect(java.net.InetSocketAddress("10.0.2.2",18625),5000)
            socket.soTimeout=15000
            socket.getOutputStream().write("GET $path HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n".toByteArray())
            val input=java.io.DataInputStream(socket.getInputStream().buffered());val header=StringBuilder()
            while(!header.endsWith("\r\n\r\n") && header.length<16384)header.append(input.readUnsignedByte().toChar())
            val length=Regex("(?i)Content-Length: ([0-9]+)").find(header)!!.groupValues[1].toInt();require(length<131072)
            val bytes=ByteArray(length);input.readFully(bytes);return JSONObject(String(bytes))
        }
    }
    private fun await(test:()->Boolean) { val until=SystemClock.uptimeMillis()+30000;while(SystemClock.uptimeMillis()<until){if(test())return;SystemClock.sleep(150)};fail("Files test condition timed out") }
    private fun js(web: WebView, expression:String):String { var result="null";val latch=CountDownLatch(1);instrumentation.runOnMainSync { web.evaluateJavascript(expression){result=it;latch.countDown()} };latch.await(2,TimeUnit.SECONDS);return result }
    private fun share(mode:String) { device.executeShellCommand("am start -n com.windock.app.test/com.windock.app.FilesShareFixtureActivity --es mode $mode") }
    private fun active(): MainActivity? {
        var result:MainActivity?=null
        instrumentation.runOnMainSync { result=ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<MainActivity>().firstOrNull() }
        return result
    }
    private fun launch():MainActivity {
        device.wakeUp()
        instrumentation.targetContext.startActivity(Intent(instrumentation.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        await { active()!=null };return active()!!
    }
    private fun closeActivities() { instrumentation.runOnMainSync {
        Stage.values().flatMap { ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(it).toList() }.filterIsInstance<MainActivity>().distinct().forEach { it.finish() }
    } }
    @Test fun photoPickerKeepsSelectionWhileSecureConnectionReturns() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyFiles")=="true")
        assumeTrue(android.os.Build.VERSION.SDK_INT>=33)
        val store=SecurePairing(instrumentation.targetContext)
        val invitation=fixture("/invitation").getString("invitation")
        val parsed=PairingInvitation.parse(invitation)
        store.forget(parsed.computer.hostId); PhonePreferences.setUsbOnly(instrumentation.targetContext,false)
        val resolver=instrumentation.targetContext.contentResolver
        val photo=resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,android.content.ContentValues().apply {
            put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,"windock-picker-fixture-${System.nanoTime()}.jpg")
            put(android.provider.MediaStore.Images.Media.MIME_TYPE,"image/jpeg")
            put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,"Pictures/WinDockFixture")
            put(android.provider.MediaStore.Images.Media.DATE_TAKEN,System.currentTimeMillis())
        })!!
        val bitmap=android.graphics.Bitmap.createBitmap(32,32,android.graphics.Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.GREEN)
        resolver.openOutputStream(photo)!!.use { assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,95,it)) }; bitmap.recycle()
        try {
            val activity=launch(); lateinit var web:WebView
            instrumentation.runOnMainSync { web=activity.findViewById(R.id.web); MainActivity::class.java.getDeclaredMethod("acceptInvitation",String::class.java).apply{isAccessible=true}.invoke(activity,invitation) }
            await { js(web,"document.getElementById('conn')?.textContent==='Connected'")=="true" }
            js(web,"window.WinDockAndroid.openFiles()")
            device.wait(Until.findObject(By.text("Photos")),10000)!!.click()
            // Real system Photo Picker: the external activity pauses WinDock and closes its transport.
            val thumbnail=device.wait(Until.findObject(By.descContains("Photo taken")),10000)
            if(thumbnail==null) device.dumpWindowHierarchy(java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"picker-failure.xml"))
            assertNotNull("System photo picker must expose the seeded image",thumbnail)
            thumbnail!!.click()
            fixture("/hold-state")
            device.wait(Until.findObject(By.text(java.util.regex.Pattern.compile("Done|Add.*"))),10000)!!.click()
            val selection=device.wait(Until.findObject(By.textStartsWith("1 file(s) selected")),15000)
            if(selection==null) device.dumpWindowHierarchy(java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"picker-selection-failure.xml"))
            assertNotNull("The system picker must return one readable selected photo",selection)
            val send=device.findObject(By.text("Send to PC"))
            val earlySendEnabled=send.isEnabled
            send.click()
            assertTrue("A premature tap must keep Files & Media open (sendEnabled=$earlySendEnabled, switchPc=${device.hasObject(By.text("Switch PC"))})",device.hasObject(By.text("Files & Media")))
            assertFalse("Send must wait for secure reconnect after Photos",earlySendEnabled)
            assertFalse(device.hasObject(By.text("Switch PC")))
            device.takeScreenshot(java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"files-reconnecting.png"))
            fixture("/release-state")
            await { device.findObject(By.text("Send to PC"))?.isEnabled==true }
            // Reconnecting never sends automatically: the owner still reviews and presses Send.
            assertFalse(device.hasObject(By.textStartsWith("Transfer completed.")))
            device.findObject(By.text("Send to PC")).click()
            assertNotNull(device.wait(Until.findObject(By.textStartsWith("Transfer completed.")),30000))
            device.takeScreenshot(java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"files-picker-completed.png"))
            val batches=fixture("/files").getJSONArray("batches"); val last=batches.getJSONObject(batches.length()-1)
            assertTrue(last.getBoolean("completed")); assertEquals(1,last.getJSONArray("files").length())
            assertTrue(last.getJSONArray("files").getJSONObject(0).getLong("bytes")>0)
        } finally { fixture("/release-state"); closeActivities(); store.forget(parsed.computer.hostId); resolver.delete(photo,null,null) }
    }
    @Test fun unavailablePcKeepsFilesUntilExplicitConnect() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyFiles")=="true")
        val store=SecurePairing(instrumentation.targetContext); val invitation=fixture("/invitation").getString("invitation")
        val parsed=PairingInvitation.parse(invitation); store.forget(parsed.computer.hostId)
        PhonePreferences.setUsbOnly(instrumentation.targetContext,false)
        try {
            val activity=launch(); lateinit var web:WebView
            instrumentation.runOnMainSync { web=activity.findViewById(R.id.web); MainActivity::class.java.getDeclaredMethod("acceptInvitation",String::class.java).apply{isAccessible=true}.invoke(activity,invitation) }
            await { js(web,"document.getElementById('conn')?.textContent==='Connected'")=="true" }
            share("single")
            await { device.findObject(By.text("Send to PC"))?.isEnabled==true }
            // A real rejected session on foreground return, rather than a mocked UI flag.
            device.pressHome(); fixture("/revoke")
            device.executeShellCommand("am start -n com.windock.app/.MainActivity")
            await {
                var failed=false
                instrumentation.runOnMainSync {
                    failed=MainActivity::class.java.getDeclaredField("loadFailed").apply{isAccessible=true}.getBoolean(activity) &&
                        !MainActivity::class.java.getDeclaredField("connecting").apply{isAccessible=true}.getBoolean(activity)
                }; failed && active()!=null
            }
            device.findObject(By.text("Send to PC")).click()
            assertTrue("Send must keep the selection open after reconnect fails (switchPc=${device.hasObject(By.text("Switch PC"))})",device.hasObject(By.text("Files & Media")))
            assertFalse(device.findObject(By.text("Send to PC")).isEnabled)
            assertFalse(device.hasObject(By.text("Switch PC")))
            assertTrue(device.hasObject(By.textStartsWith("مرحبا photo-")))
            device.findObject(By.text("Connect to PC")).click()
            assertNotNull(device.wait(Until.findObject(By.text("Switch PC")),10000))
        } finally { closeActivities(); store.forget(parsed.computer.hostId) }
    }
    @Test fun sharesSingleAndMultipleFilesOverManagedHttpsWithReceipts() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyFiles")=="true")
        val store=SecurePairing(instrumentation.targetContext);val invitation=fixture("/invitation").getString("invitation")
        val parsed=PairingInvitation.parse(invitation);store.forget(parsed.computer.hostId);PhonePreferences.setUsbOnly(instrumentation.targetContext,false);device.wakeUp()
        try {
            val activity=launch()
            lateinit var web:WebView
            instrumentation.runOnMainSync { web=activity.findViewById(R.id.web);MainActivity::class.java.getDeclaredMethod("acceptInvitation",String::class.java).apply{isAccessible=true}.invoke(activity,invitation) }
            await { js(web,"document.getElementById('conn')?.textContent==='Connected'")=="true" }
            assertEquals("false",js(web,"document.getElementById('quick-files').hidden"))
            assertEquals("false",js(web,"!!document.getElementById('quick-voice')"))
            for(mode in listOf("single","multiple")) {
                if(mode=="multiple") { device.findObject(By.text("New selection"))?.click();device.findObject(By.text("Close"))?.click() }
                share(mode)
                assertNotNull(device.wait(Until.findObject(By.text("Send to PC")),15000))
                await { active()!=null }
                val returned=active()!!
                instrumentation.runOnMainSync { web=returned.findViewById(R.id.web) }
                try { await { js(web,"document.getElementById('conn')?.textContent==='Connected'")=="true" && device.findObject(By.text("Send to PC"))?.isEnabled==true } }
                catch(error:AssertionError) {
                    device.takeScreenshot(java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"files-failure.png"))
                    device.dumpWindowHierarchy(java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"files-failure.xml"))
                    throw AssertionError("Share return: connection="+js(web,"document.getElementById('conn')?.textContent")+", sendEnabled="+device.findObject(By.text("Send to PC"))?.isEnabled,error)
                }
                if(mode=="single") {
                    device.findObject(By.text("Close")).click()
                    js(web,"window.WinDockAndroid.openFiles()")
                    assertNotNull(device.wait(Until.findObject(By.textStartsWith("مرحبا photo-")),10000))
                    assertTrue(device.findObject(By.text("Send to PC")).isEnabled)
                }
                device.findObject(By.text("Send to PC")).click()
                assertNotNull(device.wait(Until.findObject(By.textStartsWith("Transfer completed.")),30000))
                val batches=fixture("/files").getJSONArray("batches");val last=batches.getJSONObject(batches.length()-1)
                assertTrue(last.getBoolean("completed"));assertEquals(if(mode=="single")1 else 2,last.getJSONArray("files").length())
                for(i in 0 until last.getJSONArray("files").length()) { val file=last.getJSONArray("files").getJSONObject(i);assertEquals(65536L,file.getLong("bytes"));assertTrue(file.getString("sha256").matches(Regex("[a-f0-9]{64}"))) }
                device.takeScreenshot(java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"files-completed.png"))
            }
            device.findObject(By.text("Close"))?.click()
            assertEquals("true",js(web,"typeof window.WinDockAndroid.showKeyboard === 'function'"))
        } finally { closeActivities();store.forget(parsed.computer.hostId) }
    }
    @Test fun ungrantedShareIsRejectedWithoutStoragePermission() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyFiles")=="true")
        try {
            launch()
            share("denied")
            assertNotNull(device.wait(Until.findObject(By.textStartsWith("1 file(s) could not be added")),15000))
            assertFalse(device.findObject(By.text("Send to PC")).isEnabled)
            device.findObject(By.text("Close"))?.click()
        } finally { closeActivities() }
        val permissions=instrumentation.targetContext.packageManager.getPackageInfo("com.windock.app",android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
        assertFalse(permissions.any { it.endsWith("RECORD_AUDIO") || it.contains("READ_MEDIA_") || it.endsWith("MANAGE_EXTERNAL_STORAGE") || it.endsWith("READ_EXTERNAL_STORAGE") })
    }
}
