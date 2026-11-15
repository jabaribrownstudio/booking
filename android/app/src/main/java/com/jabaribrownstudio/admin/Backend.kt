package com.jabaribrownstudio.admin

import org.json.JSONObject

/** One place that knows how to call the booking backend in either sign-in mode. */
class Backend(private val store: Store) {

    /** Calls an admin action. Returns the server's answer, or throws NetworkError. */
    suspend fun call(action: String, data: JSONObject = JSONObject()): ApiResult {
        data.put("action", action)
        return if (store.mode == "worker") {
            data.put("u", store.username).put("hash", store.secret)
            Net.worker(store.workerUrl, "/api", data)
        } else {
            data.put("key", store.secret)
            Net.script(store.scriptUrl, data)
        }
    }

    /** Username + password sign-in through the Worker. Returns an error code or null on success (must-change is "must_change"). */
    suspend fun signInWorker(workerUrl: String, user: String, password: String): String? {
        val u = user.trim()
        val s = Net.worker(workerUrl, "/salt", JSONObject().put("u", u))
        val salt = s.json.optString("salt").ifEmpty { "AAAAAAAAAAAAAAAAAAAAAA==" }
        val hash = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { Net.hashPassword(password, salt) }
        val r = Net.worker(workerUrl, "/login", JSONObject().put("u", u).put("hash", hash))
        if (r.status == 429) return "locked"
        if (!r.ok) return "bad_login"
        store.workerUrl = workerUrl
        store.mode = "worker"
        store.username = u
        store.secret = hash
        val must = r.json.optJSONObject("user")?.optBoolean("mustChange", false) ?: false
        return if (must) "must_change" else null
    }

    /** Sign in with the admin key by asking for the list (a wrong key is refused). */
    suspend fun signInKey(scriptUrl: String, key: String): String? {
        val r = Net.script(scriptUrl, JSONObject().put("action", "admin_list").put("key", key.trim()))
        if (r.error == "unauthorized") return "bad_login"
        if (!r.ok) return "server"
        store.scriptUrl = scriptUrl
        store.mode = "key"
        store.username = ""
        store.secret = key.trim()
        return null
    }

    /** Changes the signed-in person's username. Returns an error code ("exists", "invalid_input", "other") or null. */
    suspend fun changeUsername(newName: String): String? {
        val r = Net.worker(store.workerUrl, "/unset", JSONObject().put("u", store.username).put("hash", store.secret).put("username", newName))
        if (!r.ok) return if (r.error == "exists" || r.error == "invalid_input") r.error else "other"
        store.username = r.json.optString("username", newName.trim().lowercase())
        return null
    }

    /** Sets a new password (used when the owner has asked for a change). Returns an error code or null. */
    suspend fun changePassword(current: String, new: String): String? {
        val s = Net.worker(store.workerUrl, "/salt", JSONObject().put("u", store.username))
        val salt = s.json.optString("salt")
        val cur = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { Net.hashPassword(current, salt) }
        val newSalt = Net.newSalt()
        val newHash = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { Net.hashPassword(new, newSalt) }
        val r = Net.worker(
            store.workerUrl, "/pwset",
            JSONObject().put("u", store.username).put("hash", store.secret).put("cur", cur)
                .put("pw", JSONObject().put("salt", newSalt).put("hash", newHash))
        )
        if (!r.ok) return "bad_password"
        store.secret = newHash
        return null
    }
}
