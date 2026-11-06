package com.windock.app

import android.webkit.WebResourceResponse
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.net.Proxy
import java.net.URI
import java.security.KeyStore
import java.security.cert.CertificateExpiredException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

enum class ConnectionFailure(val message: String) {
    NETWORK("Connection interrupted. Check Wi-Fi or USB tethering, then retry."),
    OFFLINE("Your computer isn't responding. Check that WinDock is running."),
    UNREACHABLE("Computer found, but its secure connection is unreachable. Check the computer's firewall and Wi-Fi or USB connection. Open Connection help on the computer for setup steps."),
    EXPIRED("Your computer's security certificate has expired. Check its clock and restart WinDock to renew it."),
    IDENTITY("WinDock couldn't verify this computer. Open WinDock on the computer and pair again only if it is yours."),
    AUTH("This pairing session has expired or was removed. Scan a new code on your computer."),
    LOCKED("Too many pairing attempts. Wait a few minutes, or choose Allow pairing on your computer, then retry."),
    STORAGE("Your saved pairing couldn't be opened. Pair this computer again."),
    PAIRING("That pairing code is invalid or expired. Show a new code on the computer and scan it again.");
    fun withDiscovery(found: Boolean): ConnectionFailure = if (this == OFFLINE && found) UNREACHABLE else this
    companion object {
        fun from(error: Throwable): ConnectionFailure {
            val causes = generateSequence(error) { it.cause }.take(8).toList()
            return when {
                error is ConnectionIssue -> error.reason
                causes.any { it is CertificateExpiredException } -> EXPIRED
                causes.any { it is SSLException || it is java.security.cert.CertificateException } -> IDENTITY
                else -> OFFLINE
            }
        }
    }
}
class ConnectionIssue(val reason: ConnectionFailure) : java.io.IOException(reason.name)

/** Per-computer trust, built-in PKIX + hostname checks, and explicit local-address routing. */
class SecureTransport(var computer: TrustedComputer, private val save: (TrustedComputer) -> Unit) : AutoCloseable {
    private val closed = java.util.concurrent.atomic.AtomicBoolean(false)
    companion object {
        private val cleanup = java.util.concurrent.ThreadPoolExecutor(0, 1, 30, TimeUnit.SECONDS,
            java.util.concurrent.LinkedBlockingQueue<Runnable>())
    }
    private val endpoint = URI(computer.endpoint)
    private val port = if (endpoint.port < 0) 443 else endpoint.port
    private val origin = "https://${computer.tlsName}:$port"
    private val manager: X509TrustManager
    val client: OkHttpClient
    private val readClient: OkHttpClient
    private val mediaClient: OkHttpClient
    init {
        require(EndpointPolicy.isSecure(computer.endpoint))
        val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null); setCertificateEntry("computer", computer.certificate()) }
        val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
        manager = factory.trustManagers.filterIsInstance<X509TrustManager>().single()
        val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf(manager), null) }
        client = OkHttpClient.Builder().sslSocketFactory(ssl.socketFactory, manager)
            .addInterceptor { chain ->
                // A pooled connection or upload must not reuse an on-link exception after
                // leaving that network. This also covers clients copied with newBuilder().
                if (!EndpointPolicy.isSecure(computer.endpoint)) throw ConnectionIssue(ConnectionFailure.NETWORK)
                chain.proceed(chain.request())
            }
            // No custom HostnameVerifier. The signed stable hostname is always checked.
            .dns(object : Dns { override fun lookup(hostname: String): List<InetAddress> =
                if (hostname != computer.tlsName || !EndpointPolicy.isSecure(computer.endpoint)) throw java.net.UnknownHostException()
                else listOf(InetAddress.getByName(endpoint.host)) })
            .proxy(Proxy.NO_PROXY).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(3, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(12, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS).build()
        // Same trust, routing, connection pool and dispatcher; only this optional read
        // allows the desktop media helper's existing 20-second deadline to finish.
        // Recover stale pooled connections only for safe reads. Never replay controls,
        // pairing claims, uploads or any other mutating request after a network failure.
        readClient = client.newBuilder().retryOnConnectionFailure(true).build()
        mediaClient = readClient.newBuilder().readTimeout(25, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS).build()
    }
    fun allows(url: String?): Boolean = try {
        val uri = URI(url ?: "")
        uri.scheme == "https" && uri.host == computer.tlsName && uri.port == -1 && uri.rawUserInfo == null
    } catch (_: Exception) { false }
    private fun request(path: String, method: String = "GET", body: String? = null): Request {
        require(path.startsWith("/") && !path.startsWith("//") && path.length < 2048)
        val uri = URI(path); require(uri.scheme == null && uri.host == null && uri.rawFragment == null)
        require(method in listOf("GET", "POST", "PUT"))
        val builder = Request.Builder().url(origin + path).header("Origin", origin)
        if (computer.token.isNotEmpty()) builder.header("Cookie", "__Host-windock_session=${computer.token}")
        if (method != "GET") builder.method(method, (body ?: "{}").toRequestBody("application/json".toMediaType()))
        return builder.build()
    }
    fun execute(path: String, method: String = "GET", body: String? = null): Response {
        val reader = if (method != "GET") client else if (path == "/api/nowplaying") mediaClient else readClient
        val response = reader.newCall(request(path, method, body)).execute()
        if (path == "/api/auth" && response.isSuccessful) {
            response.headers("set-cookie").firstOrNull { it.startsWith("__Host-windock_session=") }
                ?.substringAfter('=')?.substringBefore(';')?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{43}")) }?.let {
                    computer = computer.copy(token = it); save(computer)
                }
        }
        return response
    }
    fun health(): KnownHost {
        execute("/health").use { response ->
            require(response.code == 200)
            val text = response.peekBody(4097).string(); require(text.length <= 4096)
            val health = JSONObject(text)
            if (health.optString("hostId") != computer.hostId || health.optString("app") != "windock") throw javax.net.ssl.SSLPeerUnverifiedException("identity mismatch")
            val renewed = health.optString("ca")
            if (renewed.isNotEmpty() && renewed != computer.ca) {
                val updated = computer.copy(ca = renewed)
                val cert = updated.certificate(); cert.checkValidity(); cert.verify(cert.publicKey)
                if (updated.pin() != computer.pin() || cert.subjectX500Principal != computer.certificate().subjectX500Principal || cert.basicConstraints < 0)
                    throw javax.net.ssl.SSLPeerUnverifiedException("identity changed")
                computer = updated
                if (computer.token.isNotEmpty()) save(computer)
            }
            return KnownHost(computer.endpoint, KnownHosts.cleanLabel(health.optString("hostName")), false,
                System.currentTimeMillis(), KnownHosts.platformName(health.optString("platform")), computer.hostId)
        }
    }
    fun claim(secret: String): Boolean {
        execute("/api/pairing/claim", "POST", JSONObject().put("hostId", computer.hostId).put("secret", secret).toString()).use { response ->
            if (response.code == 429) throw ConnectionIssue(ConnectionFailure.LOCKED)
            if (!response.isSuccessful) return false
            val result = JSONObject(response.peekBody(4096).string())
            require(result.getString("hostId") == computer.hostId)
            val token = result.getString("token"); require(token.matches(Regex("[A-Za-z0-9_-]{43}")))
            computer = computer.copy(token = token); save(computer); return true
        }
    }
    fun resource(url: String): WebResourceResponse {
        require(allows(url)); val uri = URI(url)
        execute(uri.rawPath.ifEmpty { "/" } + (uri.rawQuery?.let { "?$it" } ?: "")).use { response ->
            val bytes = response.peekBody(8L * 1024 * 1024 + 1).bytes(); require(bytes.size <= 8 * 1024 * 1024)
            val mime = response.header("content-type", "application/octet-stream")!!.substringBefore(';')
            val code = if (response.code in 300..399) 502 else response.code
            return WebResourceResponse(mime, "utf-8", code, response.message.ifBlank { "Response" },
                mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"), ByteArrayInputStream(bytes))
        }
    }
    fun socket(path: String, listener: WebSocketListener): WebSocket {
        require(path == "/" || path == "/input")
        return client.newWebSocket(request(path), listener)
    }
    internal fun files(): FileConnection {
        check(!closed.get() && computer.token.isNotEmpty())
        return FileConnection(computer.hostId, origin, "__Host-windock_session=${computer.token}", client)
    }
    override fun close() {
        if (closed.compareAndSet(false, true)) cleanup.execute {
            // Closing a TLS socket can write close_notify; never do it on Android's UI thread.
            client.dispatcher.cancelAll(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown()
        }
    }
}
