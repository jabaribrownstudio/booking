package com.jabaribrownstudio.admin

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class ApiResult(val status: Int, val json: JSONObject) {
    val ok: Boolean get() = json.optBoolean("ok", false)
    val error: String get() = json.optString("error", "")
}

class NetworkError : Exception("network")

/** Everything the app says to the internet. */
object Net {
    private const val TIMEOUT = 25000

    /** POSTs JSON and follows redirects the way Google Apps Script needs (POST, then GET on the new address). */
    private fun request(url: String, body: String, contentType: String): ApiResult {
        var conn = open(url)
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", contentType)
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        var hops = 0
        while (conn.responseCode in intArrayOf(301, 302, 303, 307, 308) && hops < 6) {
            val loc = conn.getHeaderField("Location") ?: break
            conn.disconnect()
            conn = open(URL(URL(url), loc).toString())
            conn.requestMethod = "GET"
            hops++
        }
        val code = conn.responseCode
        val stream = if (code >= 400) conn.errorStream else conn.inputStream
        val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        conn.disconnect()
        val j = try { JSONObject(text) } catch (e: Exception) { JSONObject().put("ok", false).put("error", "bad_response") }
        return ApiResult(code, j)
    }

    private fun open(url: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false
        c.connectTimeout = TIMEOUT
        c.readTimeout = TIMEOUT
        return c
    }

    private suspend fun call(url: String, body: JSONObject, contentType: String): ApiResult =
        withContext(Dispatchers.IO) {
            try { request(url, body.toString(), contentType) } catch (e: java.io.IOException) { throw NetworkError() }
        }

    /** The Cloudflare Worker: plain JSON. */
    suspend fun worker(base: String, path: String, body: JSONObject): ApiResult =
        call(base.trimEnd('/') + path, body, "application/json")

    /** Google Apps Script: text/plain avoids a preflight request. */
    suspend fun script(url: String, body: JSONObject): ApiResult =
        call(url, body, "text/plain;charset=utf-8")

    /** PBKDF2-SHA256, 150,000 rounds, 256 bits, base64: byte-for-byte what the web admin app and the Worker use. */
    fun hashPassword(password: String, saltB64: String): String {
        val salt = Base64.decode(saltB64, Base64.DEFAULT)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(password.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        mac.update(salt)
        var u = mac.doFinal(byteArrayOf(0, 0, 0, 1))
        val t = u.copyOf()
        for (i in 2..150000) {
            u = mac.doFinal(u)
            for (k in t.indices) t[k] = (t[k].toInt() xor u[k].toInt()).toByte()
        }
        return Base64.encodeToString(t, Base64.NO_WRAP)
    }

    fun newSalt(): String {
        val b = ByteArray(16)
        java.security.SecureRandom().nextBytes(b)
        return Base64.encodeToString(b, Base64.NO_WRAP)
    }
}
