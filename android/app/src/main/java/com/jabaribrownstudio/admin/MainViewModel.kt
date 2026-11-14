package com.jabaribrownstudio.admin

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jabaribrownstudio.admin.widget.BookingsWidget
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MainViewModel(private val app: Application) : AndroidViewModel(app) {
    private val store = Store(app)
    private val backend = Backend(store)

    var signedIn by mutableStateOf(store.signedIn)
    var mustChange by mutableStateOf(false)
    var data by mutableStateOf<AdminData?>(null)
    var loading by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)
    var loginError by mutableStateOf("")
    var filter by mutableStateOf("Upcoming")
    var openRow by mutableStateOf(-1)

    // editable copies for the availability screen
    var hoursDraft by mutableStateOf<Hours>(emptyMap())
    var hoursDirty by mutableStateOf(false)

    val scriptUrl: String get() = store.scriptUrl
    val workerUrl: String get() = store.workerUrl
    val mode: String get() = store.mode
    val username: String get() = store.username

    init {
        if (store.signedIn) { Sync.schedule(app); load() }
    }

    fun clearMessage() { message = null }

    private fun forceSignOut(note: String) {
        store.signOut()
        signedIn = false; mustChange = false; data = null
        loginError = note
        viewModelScope.launch { BookingsWidget().updateAll(app) }
    }

    fun signOut() = forceSignOut("")

    /** Runs a backend action and deals with the common failures. Returns null if it failed (a message is already shown). */
    private suspend fun act(action: String, d: JSONObject = JSONObject()): ApiResult? {
        val r = try { backend.call(action, d) } catch (e: NetworkError) {
            message = "Can't reach the server. Check your connection."; return null
        } catch (e: Exception) { message = "Something went wrong. Try again."; return null }
        when {
            r.status == 401 || r.error == "unauthorized" -> { forceSignOut("Your sign-in is no longer valid. Please sign in again."); return null }
            r.status == 429 -> { message = "Too many attempts. Try again in a minute."; return null }
            r.error == "must_change" -> { mustChange = true; return null }
            r.error == "forbidden" -> { message = "You don't have permission to do that."; return null }
            r.status == 502 || r.error == "bad_response" -> { message = "The booking sheet didn't respond. Try again."; return null }
        }
        return r
    }

    fun load() {
        if (loading) return
        viewModelScope.launch {
            loading = true
            val r = act("admin_list")
            if (r != null && r.ok) {
                val d = parseAdminData(r.json)
                data = d
                if (!hoursDirty) hoursDraft = d.hours
                store.saveWidget(Sync.upcoming(d.bookings).take(30), d.me.name)
                try { BookingsWidget().updateAll(app) } catch (e: Exception) { }
            } else if (r != null) message = "Couldn't load your data."
            loading = false
        }
    }

    fun signIn(useKey: Boolean, scriptUrl: String, workerUrl: String, user: String, secret: String) {
        if (busy) return
        loginError = ""
        if (secret.isBlank() || (!useKey && user.isBlank())) { loginError = if (useKey) "Enter your admin key." else "Enter your username and password."; return }
        viewModelScope.launch {
            busy = true
            try {
                val err = if (useKey) backend.signInKey(scriptUrl.trim(), secret) else backend.signInWorker(workerUrl.trim(), user, secret)
                when (err) {
                    null -> { signedIn = true; Sync.schedule(app); load() }
                    "must_change" -> { signedIn = true; mustChange = true; Sync.schedule(app) }
                    "locked" -> loginError = "Too many attempts. Wait a minute and try again."
                    "bad_login" -> loginError = if (useKey) "That admin key isn't right." else "That username or password isn't right."
                    else -> loginError = "Couldn't sign in. Check the connection settings."
                }
            } catch (e: NetworkError) { loginError = "Can't reach the server. Check your connection and the addresses under Connection." }
            catch (e: Exception) { loginError = "Couldn't sign in. Check the addresses under Connection." }
            busy = false
        }
    }

    fun changePassword(current: String, new: String, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            busy = true
            val err = try { backend.changePassword(current, new) } catch (e: Exception) { "network" }
            busy = false
            if (err == null) { mustChange = false; message = "Password changed"; load() }
            onDone(err)
        }
    }

    fun setStatus(row: Int, status: String) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_status", JSONObject().put("row", row).put("status", status))
            busy = false
            if (r != null) {
                message = if (r.ok) (if (status == "Cancelled") "Booking cancelled" else "Marked " + status.lowercase()) else "Couldn't update that booking."
                openRow = -1
                loading = false; load()
            }
        }
    }

    class NewBooking(
        val name: String, val phone: String, val email: String, val location: String, val notes: String,
        val date: String, val time: String, val duration: Int, val packageName: String, val price: String,
        val status: String, val notify: Boolean, val force: Boolean
    )

    /** Calls back with null on success, or an error code ("slot_taken", "invalid_input", "other"). */
    fun addBooking(b: NewBooking, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            busy = true
            val r = act(
                "admin_add",
                JSONObject().put("name", b.name).put("phone", b.phone).put("email", b.email).put("location", b.location).put("notes", b.notes)
                    .put("date", b.date).put("time", b.time).put("duration", b.duration).put("packageName", b.packageName)
                    .put("price", b.price).put("currency", AppConfig.CURRENCY).put("status", b.status)
                    .put("notifyClient", b.notify).put("force", b.force)
            )
            busy = false
            if (r == null) { onDone("other"); return@launch }
            if (r.ok) {
                message = "Booking added"; filter = "Upcoming"
                loading = false; load(); onDone(null)
            } else onDone(if (r.error == "slot_taken") "slot_taken" else if (r.error == "invalid_input") "invalid_input" else "other")
        }
    }

    /* ---- availability ---- */
    fun editHours(day: Int, list: List<Pair<String, String>>) {
        hoursDraft = hoursDraft.toMutableMap().also { it[day] = list }
        hoursDirty = true
    }

    fun saveHours() {
        viewModelScope.launch {
            busy = true
            val h = JSONObject()
            for (d in 0..6) {
                val a = JSONArray()
                (hoursDraft[d] ?: emptyList()).forEach { a.put(JSONArray().put(it.first).put(it.second)) }
                h.put(d.toString(), a)
            }
            val r = act("admin_hours", JSONObject().put("hours", h))
            busy = false
            if (r != null) {
                if (r.ok) { hoursDirty = false; message = "Weekly hours saved"; loading = false; load() } else message = "Couldn't save your hours."
            }
        }
    }

    fun addOff(date: String, through: String, note: String) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_off_add", JSONObject().put("date", date).put("through", through).put("from", "").put("to", "").put("note", note))
            busy = false
            if (r != null) { message = if (r.ok) "Time off added" else "Couldn't add that."; loading = false; load() }
        }
    }

    fun removeOff(row: Int) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_off_remove", JSONObject().put("row", row))
            busy = false
            if (r != null) { message = if (r.ok) "Removed" else "Couldn't remove it."; loading = false; load() }
        }
    }

    fun saveSettings(interval: Int, buffer: Int, notice: Int, ahead: Int) {
        viewModelScope.launch {
            busy = true
            val r = act(
                "admin_settings",
                JSONObject().put("settings", JSONObject().put("slotInterval", interval).put("bufferMinutes", buffer).put("minNoticeHours", notice).put("maxDaysAhead", ahead))
            )
            busy = false
            if (r != null) { message = if (r.ok) "Settings saved" else "Couldn't save settings."; loading = false; load() }
        }
    }
}
