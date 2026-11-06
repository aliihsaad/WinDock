package com.windock.app

import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Process
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.*
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Selected URI handles only; file bytes stream from ContentResolver to the trusted PC. */
internal class NativeFiles(private val activity: Activity, private val connection: () -> FileConnection?,
    private val connectionState: () -> ConnectionState, private val connect: () -> Unit,
    private val visibilityChanged: () -> Unit = {}) {
    companion object { const val PICK = 4210 }
    enum class ConnectionState { READY, CONNECTING, DISCONNECTED }
    internal class Item(val uri: Uri, val id: String, val name: String, val size: Long?, val mime: String) {
        @Volatile var status = "Ready"
        @Volatile var bytes = 0L
        @Volatile var hash: String? = null
        @Volatile var completed = false
        fun metadata() = JSONObject().put("id", id).put("name", name).put("size", size ?: JSONObject.NULL).put("mime", mime)
    }
    private val items = mutableListOf<Item>()
    private val pending = mutableListOf<Uri>()
    private val io = Executors.newSingleThreadExecutor()
    private val cleanup = Executors.newSingleThreadExecutor()
    private val stopped = AtomicBoolean(false)
    @Volatile private var destroyed = false
    @Volatile private var busy = false
    @Volatile private var call: Call? = null
    @Volatile private var providerSignal: CancellationSignal? = null
    @Volatile private var source: java.io.InputStream? = null
    @Volatile private var current: FileConnection? = null
    private var batch: String? = null
    private var hostIdentity: String? = null
    private var importing = false
    private var sharedWaiting = false
    private var note = "Choose files to send. Keep WinDock open until the transfer finishes."
    private var dialog: Dialog? = null
    private var rows: LinearLayout? = null
    private val itemLabels = mutableMapOf<String,TextView>()
    private var rowSignature = ""
    private var caption: TextView? = null
    private var connectionCaption: TextView? = null
    private var connectButton: Button? = null
    private var progress: ProgressBar? = null
    private var send: Button? = null
    private var cancel: Button? = null
    private var reset: Button? = null
    private var chooseButtons = listOf<Button>()
    private val mint = Color.rgb(136,233,196)
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    private fun ui(block: () -> Unit) { activity.runOnUiThread { if (!destroyed && !activity.isFinishing) block() } }
    private fun text(value: String, size: Float = 14f) = TextView(activity).apply { text=value; textSize=size; setTextColor(Color.rgb(235,246,246)) }
    private fun button(value: String, action: () -> Unit) = Button(activity).apply {
        text=value; isAllCaps=false; textSize=13f; minHeight=dp(40); minimumHeight=dp(40)
        val states=arrayOf(intArrayOf(-android.R.attr.state_enabled),intArrayOf())
        backgroundTintList=ColorStateList(states,intArrayOf(Color.rgb(24,39,46),Color.rgb(32,61,68)))
        setTextColor(ColorStateList(states,intArrayOf(Color.rgb(111,133,137),mint))); setOnClickListener { action() }
    }
    fun show() {
        if (dialog?.isShowing == true) { render(); return }
        val panel=LinearLayout(activity).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(16),dp(8),dp(16),dp(8)); setBackgroundColor(Color.rgb(16,29,39)) }
        val heading=LinearLayout(activity).apply { gravity=Gravity.CENTER_VERTICAL }
        heading.addView(text("Files & Media",22f),LinearLayout.LayoutParams(0,dp(42),1f))
        heading.addView(button("Close") { if (busy) cancel("Transfer cancelled. Completed files remain on the PC."); dialog?.dismiss() })
        panel.addView(heading)
        val pickers=LinearLayout(activity)
        chooseButtons=listOf(button("Photos") { pick("image/*") },button("Videos") { pick("video/*") },button("Documents & files") { pick("*/*") })
        chooseButtons.forEach { pickers.addView(it,LinearLayout.LayoutParams(0,dp(44),1f)) }; panel.addView(pickers)
        rows=LinearLayout(activity).apply { orientation=LinearLayout.VERTICAL }
        rowSignature=""; itemLabels.clear()
        panel.addView(ScrollView(activity).apply { addView(rows) },LinearLayout.LayoutParams(-1,0,1f))
        caption=text(note).apply { setPadding(0,dp(4),0,dp(4)); accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE }; panel.addView(caption)
        connectionCaption=text("").apply { accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE }; panel.addView(connectionCaption)
        connectButton=button("Connect to PC") { dialog?.dismiss(); sharedWaiting=true; connect() }; panel.addView(connectButton)
        progress=ProgressBar(activity,null,android.R.attr.progressBarStyleHorizontal).apply { max=1000; progressTintList=ColorStateList.valueOf(mint) }; panel.addView(progress,LinearLayout.LayoutParams(-1,dp(6)))
        val actions=LinearLayout(activity)
        send=button("Send to PC") { start() }
        cancel=button("Cancel") { cancel("Transfer cancelled. Completed files remain on the PC.") }
        actions.addView(send,LinearLayout.LayoutParams(0,dp(44),1f)); actions.addView(cancel,LinearLayout.LayoutParams(0,dp(44),1f))
        reset=button("New selection") {
            if (busy || importing) return@button
            discardPendingBatch()
            items.clear(); batch=null; hostIdentity=null
            val waiting=pending.toList(); pending.clear()
            if (waiting.isNotEmpty()) add(waiting) else { note="Choose files to send."; render() }
        }
        actions.addView(reset,LinearLayout.LayoutParams(0,dp(44),1f)); panel.addView(actions)
        dialog=Dialog(activity).apply {
            setContentView(panel); setCanceledOnTouchOutside(false)
            setOnCancelListener { if (busy) cancel("Transfer cancelled. Completed files remain on the PC.") }
            setOnDismissListener {
                window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                if (dialog === this) { rows=null; caption=null; connectionCaption=null; connectButton=null; progress=null; send=null; cancel=null; reset=null; itemLabels.clear(); rowSignature="" }
                visibilityChanged()
            }
            show(); window?.setLayout((activity.resources.displayMetrics.widthPixels*.96).toInt(),(activity.resources.displayMetrics.heightPixels*.94).toInt())
        }
        visibilityChanged()
        render()
    }
    fun isShowing() = dialog?.isShowing == true
    fun connectionChanged() { if (dialog?.isShowing==true) render() }
    private fun render() {
        val list=rows ?: return
        val state=connectionState()
        val removable=batch==null && !busy && !importing
        val signature=items.joinToString { it.id } + ":$removable:$importing"
        if(signature!=rowSignature) {
          rowSignature=signature; list.removeAllViews(); itemLabels.clear()
          if (items.isEmpty()) list.addView(text(if (importing) "Preparing selection…" else "Only files you choose are shared."))
          items.forEach { item ->
            val row=LinearLayout(activity).apply { gravity=Gravity.CENTER_VERTICAL; setPadding(0,dp(3),0,dp(3)) }
            val label=text("").apply { maxLines=3 }; itemLabels[item.id]=label
            row.addView(label,LinearLayout.LayoutParams(0,-2,1f))
            if (removable) row.addView(button("Remove") { items.remove(item); render() })
            list.addView(row)
          }
        }
        items.forEach { item ->
            val size=(item.size ?: item.bytes.takeIf { item.completed })?.let { android.text.format.Formatter.formatShortFileSize(activity,it) } ?: "Size supplied while reading"
            itemLabels[item.id]?.text="${item.name}\n$size · ${item.status}"
        }
        caption?.text=note + if (pending.isNotEmpty()) " ${pending.size} shared file(s) are waiting. Choose New selection after this transfer." else ""
        connectionCaption?.text=if(state==ConnectionState.CONNECTING) "Reconnecting to your PC… Your selection is kept here."
            else "Connect securely to your PC to send files. Your selection is kept here."
        connectionCaption?.visibility=if(state==ConnectionState.READY || busy) View.GONE else View.VISIBLE
        connectButton?.visibility=if(state==ConnectionState.DISCONNECTED && !busy) View.VISIBLE else View.GONE
        chooseButtons.forEach { it.isEnabled=!busy && !importing && batch==null }
        send?.isEnabled=state==ConnectionState.READY && !busy && !importing && items.isNotEmpty() && items.any { !it.completed }
        send?.text=if (batch==null) "Send to PC" else "Retry / check status"
        cancel?.isEnabled=busy
        reset?.isEnabled=!busy && !importing
        val known=items.isNotEmpty() && items.all { it.size!=null }
        progress?.isIndeterminate=busy && !known
        if (items.isNotEmpty() && items.all { it.completed }) progress?.progress=1000
        else if (known) progress?.progress=((items.sumOf { it.bytes }.toDouble()/items.sumOf { it.size ?: 0 }.coerceAtLeast(1))*1000).toInt().coerceIn(0,1000)
        if (busy) dialog?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else dialog?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    private fun pick(type: String) {
        if (busy || importing || batch!=null) return
        val photo = type!="*/*" && Build.VERSION.SDK_INT>=33
        val intent=if(photo) Intent(MediaStore.ACTION_PICK_IMAGES).apply { this.type=type; putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX,minOf(TransferRules.MAX_FILES,MediaStore.getPickImagesMaxLimit())) }
        else documents(type)
        try { activity.startActivityForResult(intent,PICK) }
        catch (_: android.content.ActivityNotFoundException) {
            try { activity.startActivityForResult(documents(type),PICK) }
            catch (_: Exception) { note="No system file picker is available. Try Share → WinDock from your Gallery or Files app."; render() }
        }
    }
    private fun documents(type: String)=Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE); this.type=type; putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    fun result(request: Int, result: Int, data: Intent?): Boolean {
        if(request!=PICK)return false
        if(result==Activity.RESULT_OK && data!=null) add(uris(data,false))
        return true
    }
    @Suppress("DEPRECATION")
    private fun uris(intent: Intent, share: Boolean): List<Uri> {
        val output=mutableListOf<Uri>()
        try {
            if (share) {
                if(intent.action==Intent.ACTION_SEND_MULTIPLE) output.addAll(intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty().take(TransferRules.MAX_FILES+1))
                else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let(output::add)
            } else intent.data?.let(output::add)
            intent.clipData?.let { clip -> for(i in 0 until minOf(clip.itemCount,TransferRules.MAX_FILES+1)) clip.getItemAt(i).uri?.let(output::add) }
        } catch (_: Exception) { note="The sharing app supplied an invalid file selection." }
        return output.distinct()
    }
    fun share(intent: Intent): Boolean {
        if(intent.action !in listOf(Intent.ACTION_SEND,Intent.ACTION_SEND_MULTIPLE))return false
        val selected=uris(intent,true)
        sharedWaiting=true
        if(selected.size>TransferRules.MAX_FILES) { note="Share at most 50 files at a time. This new selection was not added."; show(); return true }
        if(selected.isEmpty()) { note="No readable file was shared. Choose a photo, video or document, then Share → WinDock."; show() }
        else if(busy || importing || batch!=null) {
            val combined=(pending+selected).distinct()
            if(combined.size>TransferRules.MAX_FILES) note="50 shared files are already waiting. Finish that selection, then share these files again."
            else { pending.clear(); pending.addAll(combined); note="Shared files are waiting for a new selection." }
            show()
        }
        else add(selected)
        return true
    }
    fun connected() { if(sharedWaiting) { sharedWaiting=false; show() } else if(dialog?.isShowing==true) render() }
    private fun add(selected: List<Uri>) {
        show()
        if(selected.size>TransferRules.MAX_FILES || items.size+selected.count { uri -> items.none { it.uri==uri } }>TransferRules.MAX_FILES) { note="Select at most 50 files at a time."; render(); return }
        importing=true; note="Preparing selected files…"; render()
        io.execute {
            val loaded=mutableListOf<Item>(); var rejected=0
            for(uri in selected.distinct()) {
                try {
                    require(TransferRules.validUri(uri.toString()) && uri.authority!=activity.packageName)
                    if(activity.checkUriPermission(uri,Process.myPid(),Process.myUid(),Intent.FLAG_GRANT_READ_URI_PERMISSION)!=PackageManager.PERMISSION_GRANTED) throw SecurityException()
                    val signal=CancellationSignal(); providerSignal=signal
                    var name:String?=null; var size:Long?=null
                    activity.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE),null,null,null,signal)?.use { c ->
                        if(c.moveToFirst()) { val n=c.getColumnIndex(OpenableColumns.DISPLAY_NAME); val s=c.getColumnIndex(OpenableColumns.SIZE); if(n>=0)name=c.getString(n); if(s>=0 && !c.isNull(s))size=TransferRules.size(c.getLong(s)) }
                    }
                    require(size==null || size!!<=TransferRules.MAX_FILE_BYTES)
                    loaded.add(Item(uri,TransferRules.id(),TransferRules.name(name),size,TransferRules.mime(activity.contentResolver.getType(uri))))
                } catch (_: Exception) { rejected++ }
            }
            providerSignal=null
            ui { importing=false; loaded.forEach { next -> if(items.none { it.uri==next.uri })items.add(next) }
                note=if(rejected>0) "$rejected file(s) could not be added. Check permission, file availability and the 8 GB file limit." else "${items.size} file(s) selected. Review, then Send to PC. Keep WinDock open."
                render()
            }
        }
    }
    private fun json(connection: FileConnection,path: String,method: String="GET",body: JSONObject?=null): JSONObject {
        val next=connection.call(path,method,body?.toString()?.toRequestBody("application/json".toMediaType())); call=next
        next.execute().use { response ->
            val text=response.peekBody(131073).string(); if(text.length>131072)throw IOException("Unexpected response from the computer.")
            val result=runCatching { JSONObject(text) }.getOrElse { throw IOException("Update WinDock on the computer to use Files & Media.") }
            if(!response.isSuccessful)throw IOException(when(response.code) {401,403->result.optString("error","Pair this phone securely, or enable receiving on the computer.");404->"Update WinDock on the computer, or check its transfer status before retrying.";else->result.optString("error","The computer could not receive this file.")}.take(250))
            return result
        }
    }
    private fun checkStopped() { if(stopped.get() || destroyed)throw IOException("Transfer cancelled. Completed files remain on the PC.") }
    private fun read(item: Item, sink: BufferedSink?): Pair<Long,String> {
        val hash=MessageDigest.getInstance("SHA-256"); var bytes=0L; var last=0L
        val signal=CancellationSignal(); providerSignal=signal
        activity.contentResolver.openAssetFileDescriptor(item.uri,"r",signal)?.use { descriptor ->
            descriptor.createInputStream().use { input ->
                source=input
                val buffer=ByteArray(65536)
                while(true) {
                    checkStopped(); val count=input.read(buffer); if(count<0)break; if(count==0)continue
                    bytes+=count; if(bytes>TransferRules.MAX_FILE_BYTES || (item.size!=null && bytes>item.size))throw IOException("The file changed or exceeds the 8 GB limit. Select it again.")
                    hash.update(buffer,0,count); sink?.write(buffer,0,count); item.bytes=bytes
                    val time=android.os.SystemClock.elapsedRealtime(); if(time-last>200) { last=time; ui { render() } }
                }
            }
        } ?: throw IOException("This file is unavailable. Open it in its source app, then share it again.")
        providerSignal=null; source=null
        if(item.size!=null && bytes!=item.size)throw IOException("The selected file changed size. Select it again.")
        return bytes to hash.digest().joinToString("") { "%02x".format(it) }
    }
    private fun start() {
        if(busy || importing || items.isEmpty())return
        // A picker/background return can invalidate the transport between render and tap.
        // Keep the selection open; reconnecting must never change PCs or auto-send files.
        if(connectionState()!=ConnectionState.READY) { render(); return }
        val transport=connection()
        if(transport==null) { note="The secure connection is not ready yet. Your selection is kept here; reconnect, then try again."; render(); return }
        if(hostIdentity!=null && hostIdentity!=transport.identity) { transport.close(); note="This selection belongs to another PC. Choose New selection to send to this computer."; render(); return }
        if(items.sumOf { it.size ?: 0 }>TransferRules.MAX_BATCH_BYTES) { transport.close(); note="Select less than 32 GB per batch."; render(); return }
        hostIdentity=transport.identity; if(batch==null)batch=TransferRules.id()
        val id=batch!!; val selection=items.toList(); current=transport; busy=true; stopped.set(false); note="Preparing secure transfer…"; render()
        io.execute {
            var finalNote="Transfer completed. Files are saved in the PC's WinDock receive folder."
            try {
                val info=json(transport,"/api/transfers/info"); if(!info.optBoolean("enabled"))throw IOException("Receiving is disabled. Enable it on the computer.")
                checkStopped()
                val initial=json(transport,"/api/transfers","POST",JSONObject().put("id",id).put("files",JSONArray(selection.map { it.metadata() })))
                val states=initial.getJSONArray("files")
                for(item in selection) {
                    checkStopped()
                    val state=(0 until states.length()).map { states.getJSONObject(it) }.first { it.getString("id")==item.id }
                    if(state.getString("status")=="completed") { item.completed=true; item.bytes=state.getLong("bytes"); item.status="Completed · ${state.optString("savedName",item.name)}"; ui { render() }; continue }
                    item.status="Preparing"; ui { render() }
                    if(state.getString("status") !in listOf("uploaded","committing")) {
                        val body=object:RequestBody() {
                            override fun contentType()="application/octet-stream".toMediaType()
                            override fun contentLength()=item.size ?: -1L
                            override fun isOneShot()=true
                            override fun writeTo(sink: BufferedSink) { val result=read(item,sink); item.bytes=result.first; item.hash=result.second }
                        }
                        item.status="Sending"; ui { note="Sending files. Keep WinDock open."; render() }
                        val upload=transport.call("/api/transfers/$id/${item.id}/content","PUT",body); call=upload
                        upload.execute().use { response ->
                            val result=runCatching { JSONObject(response.peekBody(8192).string()) }.getOrElse { throw IOException("The transfer was interrupted. Retry to check its status.") }
                            if(!response.isSuccessful)throw IOException(result.optString("error","The computer could not receive this file.").take(250))
                            if(result.optString("sha256")!=item.hash || result.optLong("bytes",-1)!=item.bytes)throw IOException("File integrity verification failed.")
                        }
                    } else if(item.hash==null) { val result=read(item,null); item.bytes=result.first; item.hash=result.second }
                    checkStopped(); item.status="Verifying"; ui { render() }
                    val complete=json(transport,"/api/transfers/$id/${item.id}/complete","POST",JSONObject().put("bytes",item.bytes).put("sha256",item.hash))
                    val result=complete.getJSONArray("files").let { list -> (0 until list.length()).map { list.getJSONObject(it) }.first { it.getString("id")==item.id } }
                    if(result.getString("status")!="completed")throw IOException("Completion is uncertain. Retry to check the computer's receipt.")
                    item.completed=true; item.status="Completed · ${result.optString("savedName",item.name)}"; ui { render() }
                }
            } catch(error: Exception) {
                finalNote=if(stopped.get())"Transfer stopped. Completed files remain on the PC. Retry checks their receipts before sending anything again."
                else when(error) { is SecurityException->"File access was removed. Select or share the file again."; is java.net.SocketTimeoutException->"Connection timed out. Check Wi-Fi or USB tethering, then retry."; is javax.net.ssl.SSLException->"The computer's secure identity could not be verified. Check pairing; certificate checks remain enabled."; is IOException->if(error.message?.startsWith("Unable to resolve") == true || error.message?.contains("Failed to connect")==true)"Computer unavailable. Check Wi-Fi or USB tethering, then retry." else error.message?.takeIf { !it.contains("content://") && !it.contains("http") }?.take(250) ?: "Transfer interrupted. Check the connection, then retry.";else->"Transfer could not finish. Check the connection and selected files, then retry." }
                selection.filter { !it.completed }.forEach { it.status=if(stopped.get())"Cancelled" else "Interrupted · retry available" }
            } finally {
                providerSignal=null; source=null; call=null
                if(stopped.get())runCatching { json(transport,"/api/transfers/$id/cancel","POST",JSONObject()) }
                transport.close(); current=null; busy=false
                ui { note=finalNote; render() }
            }
        }
    }
    private fun cancel(message: String) {
        stopped.set(true); call?.cancel(); val signal=providerSignal
        val input=source
        if(signal!=null || input!=null)cleanup.execute { runCatching { input?.close() }; runCatching { signal?.cancel() } }
        note=message; render()
    }
    private fun discardPendingBatch() {
        val id=batch ?: return
        val transport=connection() ?: return
        if(transport.identity!=hostIdentity) { transport.close(); return }
        io.execute { try { json(transport,"/api/transfers/$id/cancel","POST",JSONObject()) } catch (_: Exception) { } finally { transport.close() } }
    }
    fun pause() { if(busy)cancel("Transfer stopped because WinDock left the foreground. Return and retry to check its status.") }
    fun connectionLost() { if(busy)cancel("Connection interrupted. Reconnect, then retry to check transfer status.") }
    fun save(state: Bundle) {
        state.putString("filesBatch",batch); state.putString("filesHost",hostIdentity)
        state.putString("filesSelection",JSONArray(items.map { it.metadata().put("uri",it.uri.toString()) }).toString())
        state.putStringArrayList("filesWaiting",ArrayList(pending.map { it.toString() }))
    }
    fun restore(state: Bundle?) {
        try { val saved=JSONArray(state?.getString("filesSelection") ?: "[]"); if(saved.length()>TransferRules.MAX_FILES)return
            for(i in 0 until saved.length()) { val f=saved.getJSONObject(i); val uri=f.getString("uri"); if(TransferRules.validUri(uri))items.add(Item(Uri.parse(uri),f.getString("id"),f.getString("name"),if(f.isNull("size"))null else f.getLong("size"),f.getString("mime"))) }
            batch=state?.getString("filesBatch"); hostIdentity=state?.getString("filesHost")
            state?.getStringArrayList("filesWaiting")?.take(TransferRules.MAX_FILES)?.filter { TransferRules.validUri(it) }?.map(Uri::parse)?.let(pending::addAll)
            if(items.isNotEmpty()) { sharedWaiting=true; note="Selection restored. Retry checks the PC before sending. If file access expired, select the files again." }
        } catch (_: Exception) { items.clear(); batch=null; hostIdentity=null }
    }
    fun destroy() { cancel("Transfer stopped."); destroyed=true; dialog?.dismiss(); io.shutdownNow(); cleanup.shutdown(); current?.close() }
}
