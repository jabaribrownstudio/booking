package com.jabaribrownstudio.admin

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONObject

class ClientBooking(val row: Int, val date: String, val start: String, val pkg: String, val status: String)
class ClientInvoice(val row: Int, val number: Int, val type: String, val status: String, val date: String, val total: Double, val paid: Double)

class Client(
    val row: Int, val name: String, val email: String, val phone: String, val instagram: String, val notes: String,
    val bookings: List<ClientBooking>, val invoices: List<ClientInvoice>, val billed: Double, val paid: Double, val owing: Double
)

fun parseClients(j: JSONObject): List<Client> {
    val out = ArrayList<Client>()
    val a = j.optJSONArray("clients") ?: return out
    for (i in 0 until a.length()) {
        val o = a.getJSONObject(i)
        val bk = ArrayList<ClientBooking>()
        o.optJSONArray("bookings")?.let { b -> for (k in 0 until b.length()) { val x = b.getJSONObject(k); bk.add(ClientBooking(x.optInt("row"), x.optString("date"), x.optString("start"), x.optString("pkg"), x.optString("status"))) } }
        val iv = ArrayList<ClientInvoice>()
        o.optJSONArray("invoices")?.let { b -> for (k in 0 until b.length()) { val x = b.getJSONObject(k); iv.add(ClientInvoice(x.optInt("row"), x.optInt("number"), x.optString("type"), x.optString("status"), x.optString("date"), x.optDouble("total"), x.optDouble("paid"))) } }
        out.add(Client(o.optInt("row"), o.optString("name"), o.optString("email"), o.optString("phone"), o.optString("instagram"), o.optString("notes"), bk, iv, o.optDouble("billed"), o.optDouble("paid"), o.optDouble("owing")))
    }
    return out
}

/** The Clients list inside Accounting. */
fun androidx.compose.foundation.lazy.LazyListScope.clientItems(vm: MainViewModel, query: String, onOpen: (Client) -> Unit) {
    val all = vm.clients
    if (all == null) { item { Text(if (vm.clientsLoading) "Loading…" else "Pull down to load.", modifier = Modifier.padding(16.dp)) }; return }
    val q = query.trim().lowercase()
    val list = if (q.isEmpty()) all else all.filter { (it.name + " " + it.email + " " + it.phone).lowercase().contains(q) }
    if (list.isEmpty()) item { Text(if (all.isEmpty()) "No clients yet. They're added automatically from bookings and invoices, or tap New → New Client." else "No clients match that.", modifier = Modifier.padding(16.dp)) }
    items(list, key = { "client" + it.row }) { c ->
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface).clickable { onOpen(c) }.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(c.name, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text(listOf(c.email, c.phone).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "No contact details" }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("${c.bookings.count { it.status != "Cancelled" }} booking" + (if (c.bookings.count { it.status != "Cancelled" } == 1) "" else "s"), style = MaterialTheme.typography.labelMedium)
                    if (c.billed > 0) Text(Fmt.cash(c.billed), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (c.owing > 0.004) Text("Owes " + Fmt.cash(c.owing), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientDetail(vm: MainViewModel, c: Client, onClose: () -> Unit, onEdit: () -> Unit, onInvoice: () -> Unit, onOpenInvoice: (Int) -> Unit) {
    val ctx = LocalContext.current
    var confirmDelete by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(c.name, style = MaterialTheme.typography.titleLarge)
            if (c.email.isNotBlank()) Text(c.email)
            if (c.phone.isNotBlank()) Text(c.phone)
            if (c.instagram.isNotBlank()) Text("@" + c.instagram.removePrefix("@"))
            if (c.notes.isNotBlank()) Text(c.notes, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (c.phone.isNotBlank()) OutlinedButton(onClick = { try { ctx.startActivity(Intent(Intent.ACTION_DIAL, android.net.Uri.parse("tel:" + c.phone.filter { it.isDigit() || it == '+' }))) } catch (e: Exception) { } }, modifier = Modifier.weight(1f)) { Text("Call") }
                if (c.email.isNotBlank()) OutlinedButton(onClick = { try { ctx.startActivity(Intent(Intent.ACTION_SENDTO, android.net.Uri.parse("mailto:" + c.email))) } catch (e: Exception) { } }, modifier = Modifier.weight(1f)) { Text("Email") }
            }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp)) {
                Column(Modifier.weight(1f)) { Text("Billed", style = MaterialTheme.typography.labelMedium); Text(Fmt.cash(c.billed), style = MaterialTheme.typography.titleMedium) }
                Column(Modifier.weight(1f)) { Text("Paid", style = MaterialTheme.typography.labelMedium); Text(Fmt.cash(c.paid), style = MaterialTheme.typography.titleMedium) }
                Column(Modifier.weight(1f)) { Text("Owing", style = MaterialTheme.typography.labelMedium); Text(Fmt.cash(c.owing), style = MaterialTheme.typography.titleMedium, color = if (c.owing > 0.004) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface) }
            }
            Text("Bookings (${c.bookings.size})", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 6.dp))
            if (c.bookings.isEmpty()) Text("No bookings yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            c.bookings.forEach { b ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { vm.focusRow = b.row; onClose() }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text(b.pkg.ifBlank { "Session" }); Text(Fmt.date(b.date) + (if (b.start.isNotBlank()) " · " + b.start else ""), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    StatusChip(b.status)
                }
            }
            Text("Invoices and estimates (${c.invoices.size})", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 6.dp))
            if (c.invoices.isEmpty()) Text("None yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            c.invoices.forEach { i ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { onOpenInvoice(i.row) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text((if (i.type == "Estimate") "Estimate #" else "Invoice #") + i.number); Text(Fmt.date(i.date) + " · " + Fmt.cash(i.total), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    StatusChip(i.status)
                }
            }
            Button(onClick = onInvoice, modifier = Modifier.fillMaxWidth().height(48.dp).padding(top = 0.dp)) { Text("New Invoice for ${c.name.substringBefore(' ')}") }
            OutlinedButton(onClick = onEdit, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Edit client") }
            TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) { Text("Delete client", color = MaterialTheme.colorScheme.error) }
        }
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Delete ${c.name}?") },
        text = { Text("This removes the client record only. Their bookings and invoices stay.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.deleteClient(c.row); onClose() }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } }
    )
}

@Composable
fun ClientDialog(vm: MainViewModel, existing: Client?, onClose: () -> Unit) {
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var email by remember { mutableStateOf(existing?.email ?: "") }
    var phone by remember { mutableStateOf(existing?.phone ?: "") }
    var insta by remember { mutableStateOf(existing?.instagram ?: "") }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    var err by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(if (existing == null) "New Client" else "Edit Client") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(email, { email = it }, label = { Text("Email (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                OutlinedTextField(phone, { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                OutlinedTextField(insta, { insta = it }, label = { Text("Instagram (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(enabled = !vm.busy, onClick = {
                if (name.isBlank()) { err = "Enter the client's name."; return@TextButton }
                vm.saveClient(existing?.row ?: 0, name.trim(), email.trim(), phone.trim(), insta.trim(), notes.trim()) { e ->
                    when (e) { null -> onClose(); "exists" -> err = "This client is already saved."; "invalid_input" -> err = "Check the details. The email may be wrong."; else -> err = "Couldn't save. Try again." }
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}

/** Pick a saved client to fill the invoice's name, email and phone. */
@Composable
fun ClientPicker(vm: MainViewModel, onPick: (Client) -> Unit, onClose: () -> Unit) {
    LaunchedEffect(Unit) { if (vm.clients == null) vm.loadClients() }
    var q by remember { mutableStateOf("") }
    val all = vm.clients ?: emptyList()
    val list = if (q.isBlank()) all else all.filter { (it.name + " " + it.email + " " + it.phone).lowercase().contains(q.trim().lowercase()) }
    AlertDialog(
        onDismissRequest = onClose, title = { Text("Choose a client") },
        text = {
            Column {
                OutlinedTextField(q, { q = it }, label = { Text("Search") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (list.isEmpty()) Text(if (vm.clientsLoading) "Loading…" else "No clients found.", modifier = Modifier.padding(top = 12.dp))
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(list, key = { it.row }) { c ->
                        Column(Modifier.fillMaxWidth().clickable { onPick(c) }.padding(vertical = 10.dp)) {
                            Text(c.name, style = MaterialTheme.typography.titleMedium)
                            Text(listOf(c.email, c.phone).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = {}, dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}
