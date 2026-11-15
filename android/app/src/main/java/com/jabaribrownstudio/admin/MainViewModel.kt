package com.jabaribrownstudio.admin

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jabaribrownstudio.admin.widget.BookingsWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class MainViewModel(private val app: Application) : AndroidViewModel(app) {
    private val store = Store.get(app)
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
    /** Set by the widget and by notifications: show the add-booking form, or one booking. */
    var openAdd by mutableStateOf(false)
    var focusRow by mutableStateOf(-1)

    // editable copies for the availability screen
    var hoursDraft by mutableStateOf<Hours>(emptyMap())
    var hoursDirty by mutableStateOf(false)

    var money by mutableStateOf<MoneyData?>(null)
    var moneyYear by mutableStateOf(0)
    var moneyLoading by mutableStateOf(false)

    val scriptUrl: String get() = store.scriptUrl
    val workerUrl: String get() = store.workerUrl
    val mode: String get() = store.mode
    val username: String get() = store.username

    private var lastLoad = 0L

    /** Set when a newer build of the app has been published. */
    var updateAvailable by mutableStateOf(false)
    val releasePage = "https://github.com/jabaribrownstudio/booking/releases/tag/android-latest"

    private fun checkUpdate() {
        viewModelScope.launch {
            val body = Net.get("https://api.github.com/repos/jabaribrownstudio/booking/releases/tags/android-latest") ?: return@launch
            val latest = try { Regex("Build (\\d+)").find(JSONObject(body).optString("body"))?.groupValues?.get(1)?.toIntOrNull() } catch (e: Exception) { null } ?: return@launch
            val mine = try { app.packageManager.getPackageInfo(app.packageName, 0).longVersionCode } catch (e: Exception) { Long.MAX_VALUE }
            if (latest > mine) updateAvailable = true
        }
    }

    init {
        checkUpdate()
        if (store.signedIn) {
            // Show what we had last time straight away, then refresh quietly.
            // Reading and parsing the saved copy happens off the main thread so the first frame is not delayed.
            viewModelScope.launch {
                val (d, m) = withContext(Dispatchers.Default) {
                    val d = store.getCache("list")?.let { try { parseAdminData(JSONObject(it)) } catch (e: Exception) { null } }
                    val m = store.getCache("money")?.let { try { parseMoney(JSONObject(it)) } catch (e: Exception) { null } }
                    d to m
                }
                if (data == null && d != null) { data = d; hoursDraft = d.hours }
                if (money == null && m != null) { money = m; moneyYear = m.finance.year }
                Sync.schedule(app)
                load()
                if (data?.me?.isManager == true) loadMoney()
            }
        }
    }

    /** Refreshes when the app comes back to the front, unless it was refreshed a moment ago. */
    fun refreshIfStale() { if (System.currentTimeMillis() - lastLoad > 45000) load() }

    fun clearMessage() { message = null }

    private fun forceSignOut(note: String) {
        store.signOut()
        signedIn = false; mustChange = false; data = null; money = null
        loginError = note
        viewModelScope.launch { BookingsWidget().updateAll(app) }
    }

    fun signOut() {
        viewModelScope.launch {
            kotlinx.coroutines.withTimeoutOrNull(4000) { Push.unregister(app) } // stop alerts to this phone
            forceSignOut("")
        }
    }

    /** Runs a backend action and deals with the common failures. Returns null if it failed (a message is already shown). */
    private suspend fun act(action: String, d: JSONObject = JSONObject()): ApiResult? = checked { backend.call(action, d) }

    private suspend fun checked(call: suspend () -> ApiResult): ApiResult? {
        val r = try { call() } catch (e: NetworkError) {
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

    /** True once the full history (not just the last 60 days) has been loaded. */
    var showingAll by mutableStateOf(false)

    fun loadOlder() { showingAll = true; load() }

    fun load() {
        if (loading) return
        viewModelScope.launch {
            loading = true
            val all = showingAll
            val r = act("admin_list", if (all) JSONObject().put("all", true) else JSONObject())
            if (r != null && r.ok) {
                // Parsing, saving and building the widget list happen on a background thread.
                val d = withContext(Dispatchers.Default) {
                    val d = parseAdminData(r.json)
                    if (!all) store.putCache("list", r.json.toString())
                    store.saveWidget(Sync.upcoming(d.bookings).take(40), d.me.name)
                    store.setSeenRows(d.bookings.map { it.row })
                    d
                }
                data = d
                lastLoad = System.currentTimeMillis()
                if (!hoursDirty) hoursDraft = d.hours
                try { BookingsWidget().updateAll(app) } catch (e: Exception) { }
                Push.register(app)
                if (d.me.isManager && money == null) loadMoney()
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

    fun setStatus(row: Int, status: String, extras: List<LineItem>? = null, sendInvoice: Boolean = true, comment: String = "", discount: Discount? = null, taxes: List<TaxRate> = emptyList(), noInvoice: Boolean = false) {
        // Show the change at once; the refresh below corrects it if the server disagrees.
        data?.let { d -> data = d.copy(bookings = d.bookings.map { if (it.row == row) it.copy(status = status) else it }) }
        viewModelScope.launch {
            busy = true
            val d = JSONObject().put("row", row).put("status", status)
            if (comment.isNotBlank()) d.put("comment", comment.trim())
            if (status == "Confirmed" && noInvoice) d.put("invoice", JSONObject().put("skip", true))
            else if (status == "Confirmed" && extras != null) d.put("invoice", JSONObject().put("extras", itemsJson(extras)).put("send", sendInvoice).put("discount", discountJson(discount)).put("taxes", taxesJson(taxes)))
            val r = act("admin_status", d)
            busy = false
            if (r != null) {
                message = if (r.ok) {
                    if (status == "Cancelled") {
                        val v = r.json.optInt("voided"); val k = r.json.optInt("kept")
                        "Booking cancelled" + (if (v > 0) " and its invoice was voided" else "") + (if (k > 0) ". Its invoice has payments, so it was left as is." else "")
                    } else "Marked " + status.lowercase()
                } else "Couldn't update that booking."
                openRow = -1
                loading = false; load()
                if (status == "Confirmed" || status == "Cancelled") loadMoney()
            } else {
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

    /* ---- invoices, estimates, money ---- */
    fun loadMoney(year: Int = moneyYear) {
        viewModelScope.launch {
            moneyLoading = true
            val r = act("admin_money", JSONObject().put("year", year))
            if (r != null && r.ok) { val m = parseMoney(r.json); money = m; moneyYear = m.finance.year; if (m.finance.year == java.time.LocalDate.now().year) store.putCache("money", r.json.toString()) }
            else if (r != null) message = "Couldn't load invoices."
            moneyLoading = false
        }
    }

    private fun moneyDone(r: ApiResult?, okMsg: String, failMsg: String): Boolean {
        if (r == null) return false
        message = if (r.ok) okMsg else failMsg
        if (r.ok) loadMoney()
        return r.ok
    }

    /** Saves an invoice or estimate. onDone gets null on success or an error code ("no_email", "invalid_input", "locked", "other"). */
    fun saveInvoice(
        row: Int, type: String, client: String, email: String, phone: String, bookingRow: Int, items: List<LineItem>,
        date: String, notes: String, send: Boolean, discount: Discount?, taxes: List<TaxRate>, onDone: (String?) -> Unit
    ) {
        viewModelScope.launch {
            busy = true
            val d = JSONObject().put("type", type).put("client", client).put("email", email).put("phone", phone)
                .put("bookingRow", bookingRow).put("items", itemsJson(items)).put("date", date).put("notes", notes).put("send", send)
                .put("discount", discountJson(discount)).put("taxes", taxesJson(taxes))
            if (row > 0) d.put("row", row)
            val r = act("admin_inv_save", d)
            busy = false
            if (r == null) { onDone("other"); return@launch }
            if (r.ok) {
                message = (if (type == "Estimate") "Estimate #" else "Invoice #") + r.json.optInt("number") + (if (r.json.optBoolean("sent")) " saved and emailed" else " saved")
                loadMoney(); onDone(null)
            } else {
                if (r.error == "no_email") loadMoney()
                onDone(if (r.error == "no_email" || r.error == "invalid_input" || r.error == "locked") r.error else "other")
            }
        }
    }

    fun sendInvoice(row: Int) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_inv_send", JSONObject().put("row", row))
            busy = false
            if (r != null && !r.ok && r.error == "no_email") message = "Add the client's email address first."
            else moneyDone(r, "Emailed to the client", "Couldn't send it.")
        }
    }

    fun payInvoice(row: Int, amount: Double, date: String, method: String, receipt: Boolean) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_inv_pay", JSONObject().put("row", row).put("amount", amount).put("date", date).put("method", method).put("receipt", receipt))
            busy = false
            moneyDone(r, if (r?.json?.optBoolean("receiptSent") == true) "Payment recorded and receipt emailed" else "Payment recorded", "Couldn't record that payment.")
        }
    }

    fun emailReceipt(row: Int, index: Int) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_inv_receipt", JSONObject().put("row", row).put("index", index).put("mode", "email"))
            busy = false
            if (r != null) message = if (r.ok) "Receipt emailed" else if (r.error == "no_email") "Add the client's email address first." else "Couldn't send the receipt."
        }
    }

    fun fetchReceiptPdf(row: Int, index: Int, onFile: (java.io.File) -> Unit) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_inv_receipt", JSONObject().put("row", row).put("index", index).put("mode", "pdf"))
            busy = false
            if (r != null && r.ok) savePdf(r, onFile) else if (r != null) message = "Couldn't create the receipt."
        }
    }

    private fun savePdf(r: ApiResult, onFile: (java.io.File) -> Unit) {
        try {
            val bytes = android.util.Base64.decode(r.json.optString("pdf"), android.util.Base64.DEFAULT)
            val dir = java.io.File(app.cacheDir, "pdfs").also { it.mkdirs() }
            val f = java.io.File(dir, r.json.optString("name", "document.pdf").replace(Regex("[^A-Za-z0-9 ._-]"), "_"))
            f.writeBytes(bytes)
            onFile(f)
        } catch (e: Exception) { message = "Couldn't open the PDF." }
    }

    fun removePayment(row: Int, index: Int) {
        viewModelScope.launch {
            val r = act("admin_inv_unpay", JSONObject().put("row", row).put("index", index))
            moneyDone(r, "Payment removed", "Couldn't remove it.")
        }
    }

    fun invoiceStatus(row: Int, status: String) {
        viewModelScope.launch {
            val r = act("admin_inv_status", JSONObject().put("row", row).put("status", status))
            moneyDone(r, "Marked " + status.lowercase(), "Couldn't update it.")
        }
    }

    /** Makes an invoice from an estimate. onDone gets the new invoice's row. */
    fun convertEstimate(row: Int, onDone: (Int) -> Unit = {}) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_inv_convert", JSONObject().put("row", row))
            busy = false
            if (moneyDone(r, "Invoice #" + (r?.json?.optInt("number") ?: 0) + " created", "Couldn't convert it.")) onDone(r?.json?.optInt("row") ?: -1)
        }
    }

    fun deleteInvoice(row: Int) {
        viewModelScope.launch {
            val r = act("admin_inv_delete", JSONObject().put("row", row))
            moneyDone(r, "Deleted", "Only drafts and voided invoices can be deleted.")
        }
    }

    fun addFee(name: String, desc: String, price: Double, qty: Double) {
        viewModelScope.launch {
            val r = act("admin_fee_add", JSONObject().put("name", name).put("desc", desc).put("price", price).put("qty", qty))
            moneyDone(r, "Saved", "Couldn't save that item.")
        }
    }

    fun updateFee(row: Int, name: String, desc: String, price: Double, qty: Double) {
        viewModelScope.launch {
            val r = act("admin_fee_update", JSONObject().put("row", row).put("name", name).put("desc", desc).put("price", price).put("qty", qty))
            moneyDone(r, "Saved", "Couldn't save that item.")
        }
    }

    fun addTax(name: String, rate: Double) {
        viewModelScope.launch {
            val r = act("admin_tax_add", JSONObject().put("name", name).put("rate", rate))
            moneyDone(r, "Tax saved", "Couldn't save that tax.")
        }
    }

    fun removeTax(row: Int) {
        viewModelScope.launch {
            val r = act("admin_tax_remove", JSONObject().put("row", row))
            moneyDone(r, "Tax removed", "Couldn't remove it.")
        }
    }

    fun removeFee(row: Int) {
        viewModelScope.launch {
            val r = act("admin_fee_remove", JSONObject().put("row", row))
            moneyDone(r, "Fee removed", "Couldn't remove it.")
        }
    }

    /** Downloads the PDF and hands the file to the screen so it can be opened or shared. */
    fun fetchPdf(row: Int, onFile: (java.io.File) -> Unit) {
        viewModelScope.launch {
            busy = true
            val r = act("admin_inv_pdf", JSONObject().put("row", row))
            busy = false
            if (r != null && r.ok) {
                try {
                    val bytes = android.util.Base64.decode(r.json.optString("pdf"), android.util.Base64.DEFAULT)
                    val dir = java.io.File(app.cacheDir, "pdfs").also { it.mkdirs() }
                    val f = java.io.File(dir, r.json.optString("name", "document.pdf").replace(Regex("[^A-Za-z0-9 ._-]"), "_"))
                    f.writeBytes(bytes)
                    onFile(f)
                } catch (e: Exception) { message = "Couldn't open the PDF." }
            } else if (r != null) message = "Couldn't create the PDF."
        }
    }

    /* ---- team (owner only) ---- */
    var team by mutableStateOf<List<TeamMember>>(emptyList())
    var teamLoading by mutableStateOf(false)
    /** A password or key to show the owner once: title to secret. */
    var secretShown by mutableStateOf<Pair<String, String>?>(null)

    private suspend fun teamCall(op: String, extra: JSONObject = JSONObject()): ApiResult? {
        if (store.mode == "worker") {
            return checked { Net.worker(store.workerUrl, "/team", extra.put("u", store.username).put("hash", store.secret).put("op", op)) }
        }
        val action = when (op) { "list" -> "admin_staff_list"; "add" -> "admin_staff_add"; "update" -> "admin_staff_update"; "setpw" -> "admin_staff_reset"; else -> "admin_staff_remove" }
        return act(action, extra)
    }

    private fun parseTeam(j: JSONObject): List<TeamMember> {
        val out = ArrayList<TeamMember>()
        val a = (if (store.mode == "worker") j.optJSONArray("users") else j.optJSONArray("staff")) ?: JSONArray()
        for (i in 0 until a.length()) {
            val o = a.getJSONObject(i)
            out.add(
                TeamMember(
                    id = o.optString("id"), row = o.optInt("row"), username = o.optString("username"), name = o.optString("name"),
                    email = o.optString("email"), role = o.optString("role"), active = o.optBoolean("active", true),
                    mustChange = o.optBoolean("mustChange", false), lastLogin = o.optString("lastLogin")
                )
            )
        }
        return out
    }

    fun loadTeam() {
        viewModelScope.launch {
            teamLoading = true
            val r = teamCall("list")
            if (r != null && r.ok) team = parseTeam(r.json)
            teamLoading = false
        }
    }

    private suspend fun newPw(password: String): JSONObject = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
        val salt = Net.newSalt()
        JSONObject().put("salt", salt).put("hash", Net.hashPassword(password, salt))
    }

    private fun tempPassword(): String {
        val alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
        val rnd = java.security.SecureRandom()
        return (1..10).map { alphabet[rnd.nextInt(alphabet.length)] }.joinToString("")
    }

    /** onDone gets null on success or "exists" / "invalid_input" / "other". */
    fun addMember(name: String, username: String, email: String, role: String, onDone: (String?) -> Unit) {
        viewModelScope.launch {
            busy = true
            val worker = store.mode == "worker"
            val temp = tempPassword()
            val body = JSONObject().put("name", name).put("role", role)
            if (worker) body.put("username", username).put("email", email).put("pw", newPw(temp))
            val r = teamCall("add", body)
            busy = false
            if (r == null) { onDone("other"); return@launch }
            if (r.ok) {
                secretShown = if (worker) ("Temporary password for $name" to "Username: $username\nPassword: $temp\n\nThey will be asked to choose their own password the first time they sign in.")
                              else ("Admin key for $name" to r.json.optString("key"))
                loadTeam(); onDone(null)
            } else onDone(if (r.error == "exists") "exists" else if (r.error == "invalid_input") "invalid_input" else "other")
        }
    }

    private fun ref(m: TeamMember): JSONObject = if (store.mode == "worker") JSONObject().put("id", m.id) else JSONObject().put("row", m.row)

    fun setRole(m: TeamMember, role: String) {
        viewModelScope.launch {
            val r = teamCall("update", ref(m).put("role", role))
            if (r != null) { message = if (r.ok) "${m.name} is now $role" else "Couldn't change that."; loadTeam() }
        }
    }

    fun setActive(m: TeamMember, active: Boolean) {
        viewModelScope.launch {
            val r = teamCall("update", ref(m).put("active", active))
            if (r != null) { message = if (r.ok) (if (active) "${m.name} can sign in again" else "${m.name} is locked out") else "Couldn't change that."; loadTeam() }
        }
    }

    fun resetAccess(m: TeamMember) {
        viewModelScope.launch {
            busy = true
            val worker = store.mode == "worker"
            val temp = tempPassword()
            val body = ref(m)
            if (worker) body.put("pw", newPw(temp))
            val r = teamCall("setpw", body)
            busy = false
            if (r != null) {
                if (r.ok) secretShown = if (worker) ("New temporary password for ${m.name}" to "Username: ${m.username}\nPassword: $temp\n\nThey will choose their own password at next sign-in.")
                                        else ("New admin key for ${m.name}" to r.json.optString("key"))
                else message = "Couldn't reset that."
                loadTeam()
            }
        }
    }

    fun removeMember(m: TeamMember) {
        viewModelScope.launch {
            val r = teamCall("remove", ref(m))
            if (r != null) { message = if (r.ok) "${m.name} removed" else "Couldn't remove that."; loadTeam() }
        }
    }
}
