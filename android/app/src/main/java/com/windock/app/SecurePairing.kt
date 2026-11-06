package com.windock.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class TrustedComputer(val hostId: String, val name: String, val ca: String, val endpoint: String, val token: String = "") {
    val tlsName get() = "host-$hostId.windock.invalid"
    val origin get() = "https://$tlsName"
    fun certificate(): X509Certificate = CertificateFactory.getInstance("X.509").generateCertificate(
        ByteArrayInputStream(Base64.decode(ca, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))) as X509Certificate
    fun pin(): String = MessageDigest.getInstance("SHA-256").digest(certificate().publicKey.encoded).joinToString("") { "%02x".format(it) }
    fun json(): JSONObject = JSONObject().put("hostId", hostId).put("name", name).put("ca", ca).put("endpoint", endpoint).put("token", token)
    companion object {
        fun parse(json: JSONObject): TrustedComputer {
            val id = KnownHosts.cleanId(json.optString("hostId")); require(id.isNotEmpty())
            val ca = json.getString("ca"); require(ca.length in 100..4096)
            // Loading encrypted trust must not depend on which network is currently attached.
            // SecureTransport and discovery separately enforce admission before connecting.
            val endpoint = EndpointPolicy.canonicalize(json.getString("endpoint")); require(endpoint != null && endpoint.startsWith("https://"))
            val result = TrustedComputer(id, KnownHosts.cleanLabel(json.optString("name")), ca, endpoint, json.optString("token"))
            require(result.token.isEmpty() || result.token.matches(Regex("[A-Za-z0-9_-]{43}")))
            val cert = result.certificate(); require(cert.basicConstraints >= 0)
            cert.verify(cert.publicKey)
            return result
        }
    }
}

data class PairingInvitation(val computer: TrustedComputer, val secret: String) {
    companion object {
        fun parse(text: String, now: Long = System.currentTimeMillis()): PairingInvitation {
            require(text.length in 100..8192 && text.startsWith("windock-pair:"))
            val json = JSONObject(String(Base64.decode(text.removePrefix("windock-pair:"), Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8))
            require(json.getInt("v") == 1)
            val expires = json.getLong("expires"); require(expires > now && expires <= now + 5 * 60000)
            val port = json.getInt("port"); require(port in 1..65535)
            json.put("endpoint", "https://${json.getString("address")}:$port")
            val host = TrustedComputer.parse(json)
            host.certificate().checkValidity()
            val secret = json.getString("secret"); require(secret.matches(Regex("[A-Za-z0-9_-]{43}")))
            return PairingInvitation(host, secret)
        }
    }
}

/** Trust/session data stays in app-private storage, encrypted with a non-exportable Android Keystore key. */
class SecurePairing(context: Context) {
    private val prefs = context.getSharedPreferences("secure-computers", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("windock-pairing-v1", null) as? SecretKey)?.let { return it }
        check(prefs.all.keys.none { it.startsWith("host:") }) { "Saved pairing key is unavailable" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("windock-pairing-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun save(host: TrustedComputer) {
        try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(host.json().toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("host:${host.hostId}", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP))
            .putString("selected", host.hostId).commit())
        } catch (_: Exception) { throw ConnectionIssue(ConnectionFailure.STORAGE) }
    }
    @Synchronized fun get(id: String): TrustedComputer? {
        if (KnownHosts.cleanId(id).isEmpty()) return null
        val text = prefs.getString("host:$id", null) ?: return null
        val bytes = Base64.decode(text, Base64.NO_WRAP); require(bytes.size in 29..16384)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        return TrustedComputer.parse(JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)))
    }
    fun selected(): TrustedComputer? = get(prefs.getString("selected", "").orEmpty())
    fun hasSelected(): Boolean = !prefs.getString("selected", null).isNullOrEmpty()
    fun select(id: String?) { prefs.edit().putString("selected", id).apply() }
    fun forget(id: String) { prefs.edit().remove("host:$id").apply(); if (prefs.getString("selected", null) == id) select(null) }
    fun reset() {
        check(prefs.edit().clear().commit())
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("windock-pairing-v1") }
    }
}
