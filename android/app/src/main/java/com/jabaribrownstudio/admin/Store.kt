package com.jabaribrownstudio.admin

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

/** Credentials and the small cache the home-screen widget reads. Encrypted where the phone allows it. */
class Store(context: Context) {
    private val prefs: SharedPreferences = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "studio_secure", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        context.getSharedPreferences("studio_plain", Context.MODE_PRIVATE)
    }

    var scriptUrl: String
        get() = prefs.getString("scriptUrl", AppConfig.APPS_SCRIPT_URL) ?: AppConfig.APPS_SCRIPT_URL
        set(v) = prefs.edit().putString("scriptUrl", v).apply()
    var workerUrl: String
        get() = prefs.getString("workerUrl", AppConfig.WORKER_URL) ?: AppConfig.WORKER_URL
        set(v) = prefs.edit().putString("workerUrl", v).apply()

    /** "worker" (username + password) or "key" (admin key), or "" when signed out. */
    var mode: String
        get() = prefs.getString("mode", "") ?: ""
        set(v) = prefs.edit().putString("mode", v).apply()
    var username: String
        get() = prefs.getString("username", "") ?: ""
        set(v) = prefs.edit().putString("username", v).apply()
    /** The password hash (never the password) or the admin key. */
    var secret: String
        get() = prefs.getString("secret", "") ?: ""
        set(v) = prefs.edit().putString("secret", v).apply()

    val signedIn: Boolean get() = mode.isNotEmpty() && secret.isNotEmpty()

    fun signOut() {
        prefs.edit().remove("mode").remove("username").remove("secret").remove("widget").remove("widgetName").remove("widgetAt").apply()
    }

    /* ---- widget cache ---- */
    class Item(val name: String, val pkg: String, val date: String, val start: String, val end: String, val status: String, val location: String)

    fun saveWidget(items: List<Booking>, who: String) {
        val a = JSONArray()
        items.forEach {
            a.put(JSONObject().put("n", it.name).put("p", it.pkg).put("d", it.date).put("s", it.start).put("e", it.end).put("t", it.status).put("l", it.location))
        }
        prefs.edit().putString("widget", a.toString()).putString("widgetName", who).putLong("widgetAt", System.currentTimeMillis()).apply()
    }

    fun widgetItems(): List<Item> {
        val out = ArrayList<Item>()
        try {
            val a = JSONArray(prefs.getString("widget", "[]"))
            for (i in 0 until a.length()) {
                val o = a.getJSONObject(i)
                out.add(Item(o.optString("n"), o.optString("p"), o.optString("d"), o.optString("s"), o.optString("e"), o.optString("t"), o.optString("l")))
            }
        } catch (e: Exception) { }
        return out
    }

    val widgetUpdatedAt: Long get() = prefs.getLong("widgetAt", 0L)
}
