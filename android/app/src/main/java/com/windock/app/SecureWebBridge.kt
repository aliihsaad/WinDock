package com.windock.app

import android.webkit.JavascriptInterface
import android.webkit.WebView
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Small adapter for the existing fetch/WebSocket protocols; credentials never enter JavaScript. */
class SecureWebBridge(private val web: WebView, private val transport: SecureTransport,
                      private val failed: (ConnectionFailure) -> Unit, private val connected: () -> Unit = {}) : AutoCloseable {
    private val workers = ThreadPoolExecutor(2, 4, 30, TimeUnit.SECONDS, ArrayBlockingQueue(8))
    private val sockets = ConcurrentHashMap<Int, WebSocket>()
    @Volatile private var closed = false
    private fun emit(message: JSONObject) {
        web.post { if (!closed && transport.allows(web.url)) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('windock-transport',{detail:$message}))", null) }
    }
    private fun failure(reason: ConnectionFailure) { web.post { if (!closed) failed(reason) } }
    @JavascriptInterface fun request(id: Int, path: String, method: String, body: String) {
        if (closed || id < 0 || !path.startsWith("/api/") || body.length > 96 * 1024) return
        try { workers.execute {
            try {
                transport.execute(path, method, body).use { response ->
                    val text = response.peekBody(2L * 1024 * 1024 + 1).string(); require(text.length <= 2 * 1024 * 1024)
                    emit(JSONObject().put("kind", "response").put("id", id).put("status", response.code).put("body", text))
                    if (response.code == 401 && path != "/api/auth") failure(ConnectionFailure.AUTH)
                }
            } catch (error: Exception) {
                emit(JSONObject().put("kind", "response").put("id", id).put("error", "Connection interrupted"))
                val reason = ConnectionFailure.from(error)
                // A slow/unavailable media provider is not a broken dock connection.
                // Auth and certificate failures still fail closed, even on optional reads.
                if (path != "/api/nowplaying" || method != "GET" ||
                    reason !in listOf(ConnectionFailure.NETWORK, ConnectionFailure.OFFLINE)) failure(reason)
            }
        } } catch (_: java.util.concurrent.RejectedExecutionException) {
            emit(JSONObject().put("kind", "response").put("id", id).put("error", "Connection busy. Retry shortly."))
        }
    }
    @JavascriptInterface fun openSocket(id: Int, path: String) {
        if (closed || id < 0 || sockets.size >= 2 || sockets.containsKey(id) || path !in listOf("/", "/input")) return
        val listener = object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                emit(JSONObject().put("kind", "open").put("id", id))
                if (path == "/") web.post { if (!closed) connected() }
            }
            override fun onMessage(ws: WebSocket, text: String) {
                if (text.length > 2 * 1024 * 1024) { ws.cancel(); return }
                emit(JSONObject().put("kind", "message").put("id", id).put("body", text))
            }
            override fun onClosing(ws: WebSocket, code: Int, reason: String) { ws.close(code, null) }
            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                val active = sockets.remove(id) != null
                emit(JSONObject().put("kind", "close").put("id", id))
                if (active && path == "/") failure(ConnectionFailure.OFFLINE)
            }
            override fun onFailure(ws: WebSocket, error: Throwable, response: Response?) {
                sockets.remove(id); emit(JSONObject().put("kind", "close").put("id", id))
                if (!closed) failure(if (response?.code == 401) ConnectionFailure.AUTH else ConnectionFailure.from(error))
            }
        }
        sockets[id] = transport.socket(path, listener)
    }
    @JavascriptInterface fun queuedBytes(id: Int): Long = sockets[id]?.queueSize() ?: 0
    @JavascriptInterface fun send(id: Int, text: String): Boolean {
        val socket = sockets[id] ?: return false
        if (closed || text.length > 96 * 1024 || socket.queueSize() + text.toByteArray(Charsets.UTF_8).size > 262144) return false
        return socket.send(text)
    }
    @JavascriptInterface fun closeSocket(id: Int) { sockets.remove(id)?.close(1000, null) }
    override fun close() { closed = true; sockets.values.forEach { it.cancel() }; sockets.clear(); workers.shutdownNow() }
}
