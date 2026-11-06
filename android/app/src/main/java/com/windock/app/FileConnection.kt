package com.windock.app

import okhttp3.*
import java.util.concurrent.TimeUnit

/** An isolated upload client retaining the existing host's certificate and hostname checks. */
internal class FileConnection(val identity: String, val origin: String, private val cookie: String, base: OkHttpClient) : AutoCloseable {
    companion object {
        fun hasLegacySession(endpoint: String?): Boolean = endpoint!=null && EndpointPolicy.isSecure(endpoint) &&
            !android.webkit.CookieManager.getInstance().getCookie(endpoint).isNullOrBlank()
        /** Reuse the existing manually configured HTTPS session; never perform native PIN pairing. */
        fun legacy(endpoint: String): FileConnection? {
            if (!EndpointPolicy.isSecure(endpoint)) return null
            val cookie = android.webkit.CookieManager.getInstance().getCookie(endpoint) ?: return null
            val base = OkHttpClient.Builder().proxy(java.net.Proxy.NO_PROXY).addInterceptor { chain ->
                if (!EndpointPolicy.isSecure(endpoint)) throw ConnectionIssue(ConnectionFailure.NETWORK)
                chain.proceed(chain.request())
            }.build()
            return FileConnection(endpoint, endpoint.trimEnd('/'), cookie, base)
        }
    }
    private val client = base.newBuilder().dispatcher(Dispatcher()).connectionPool(ConnectionPool())
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(5, TimeUnit.MINUTES).writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.SECONDS).build()
    fun call(path: String, method: String = "GET", body: RequestBody? = null): Call {
        require(path.matches(Regex("/api/transfers(?:/[a-z0-9/]+)?")))
        require(method in listOf("GET", "POST", "PUT"))
        return client.newCall(Request.Builder().url(origin + path).header("Origin", origin)
            .header("Cookie", cookie).method(method, body).build()).also {
            it.timeout().timeout(if (method=="PUT") 3600 else if (path.endsWith("/complete")) 300 else 15, TimeUnit.SECONDS)
        }
    }
    override fun close() { client.dispatcher.cancelAll(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown() }
}
