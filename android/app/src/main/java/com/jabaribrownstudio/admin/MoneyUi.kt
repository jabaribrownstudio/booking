package com.jabaribrownstudio.admin

import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.io.File
import java.time.LocalDate

private fun shareFile(ctx: Context, f: File) {
    try {
        val uri = FileProvider.getUriForFile(ctx, "com.jabaribrownstudio.admin.files", f)
        val i = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(i, "Share PDF"))
    } catch (e: Exception) { }
}

private fun openFile(ctx: Context, f: File) {
    try {
        val uri = FileProvider.getUriForFile(ctx, "com.jabaribrownstudio.admin.files", f)
        val i = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/pdf")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(i)
    } catch (e: Exception) { shareFile(ctx, f) }
}

@Composable
private fun StatusChip(status: String) {
    val dark = isSystemInDarkTheme()
    val key = when (status) { "Paid", "Accepted" -> "Confirmed"; "Partial", "Sent" -> "Pending"; else -> "Cancelled" }
    Text(
        status, style = MaterialTheme.typography.labelMedium, color = StatusColors.fg(key, dark),
        modifier = Modifier.clip(RoundedCornerShape(50)).background(StatusColors.bg(key, dark)).padding(horizontal = 10.dp, vertical = 4.dp)
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvoicesTab(vm: MainViewModel, pad: PaddingValues) {
    val m = vm.money
    var showEstimates by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Invoice?>(null) }
    var creating by remember { mutableStateOf<String?>(null) }
    var viewing by remember { mutableIntStateOf(-1) }
    var showFees by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.loadMoney() }

    Box(Modifier.fillMaxSize().padding(pad)) {
        PullToRefreshBox(isRefreshing = vm.moneyLoading, onRefresh = { vm.loadMoney() }, modifier = Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Invoices", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 8.dp))
                            Text("Estimates, payments and what you've earned.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        TextButton(onClick = { showFees = true }) { Text("Fees") }
                    }
                }
                if (m == null) {
                    item { Text(if (vm.moneyLoading) "Loading…" else "Pull down to load.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
                } else {
                    item { Summary(vm, m.finance) }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(selected = !showEstimates, onClick = { showEstimates = false }, label = { Text("Invoices") })
                            FilterChip(selected = showEstimates, onClick = { showEstimates = true }, label = { Text("Estimates (${m.invoices.count { it.type == "Estimate" }})") })
                        }
                    }
                    val list = m.invoices.filter { (it.type == "Estimate") == showEstimates }
                    if (list.isEmpty()) item { Text("Nothing here yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
                    items(list, key = { it.type + it.row }) { inv ->
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface).clickable { viewing = inv.row }.padding(16.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("#${inv.number} · ${inv.client}", style = MaterialTheme.typography.titleMedium, maxLines = 1)
                                    Text(Fmt.date(inv.date), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(Fmt.cash(inv.total), style = MaterialTheme.typography.titleMedium)
                                    Spacer(Modifier.height(4.dp))
                                    StatusChip(inv.status)
                                }
                            }
                            if (inv.isInvoice && inv.status in listOf("Sent", "Partial") && inv.due.isNotBlank() && inv.due < LocalDate.now().toString())
                                Text("Overdue · ${Fmt.cash(inv.owing)} due", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                }
            }
        }
        Box(Modifier.align(Alignment.BottomEnd).padding(20.dp)) {
            ExtendedFloatingActionButton(
                onClick = { menu = true }, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("New") },
                containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary
            )
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("New invoice") }, onClick = { menu = false; creating = "Invoice" })
                DropdownMenuItem(text = { Text("New estimate") }, onClick = { menu = false; creating = "Estimate" })
            }
        }
    }

    val cur = m?.invoices?.firstOrNull { it.row == viewing }
    if (cur != null) InvoiceDetail(vm, cur, onClose = { viewing = -1 }, onEdit = { editing = cur; viewing = -1 })
    if (creating != null) InvoiceEditor(vm, null, creating!!) { creating = null }
    if (editing != null) InvoiceEditor(vm, editing, editing!!.type) { editing = null }
    if (showFees && m != null) FeesDialog(vm, m.fees) { showFees = false }
}

@Composable
private fun Summary(vm: MainViewModel, f: Finance) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(MaterialTheme.colorScheme.primary).padding(18.dp)) {
        val on = MaterialTheme.colorScheme.onPrimary
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(f.years) { y ->
                FilterChip(
                    selected = y == f.year, onClick = { vm.loadMoney(y) }, label = { Text(y.toString()) },
                    colors = FilterChipDefaults.filterChipColors(labelColor = on, selectedContainerColor = on.copy(alpha = 0.22f), selectedLabelColor = on)
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("Collected in ${f.year}", color = on.copy(alpha = 0.75f), style = MaterialTheme.typography.labelLarge)
        Text(Fmt.cash(f.collected), color = on, style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(14.dp))
        val max = (f.months.maxOrNull() ?: 0.0).coerceAtLeast(1.0)
        Row(Modifier.fillMaxWidth().height(64.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
            f.months.forEach { v ->
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
                    Box(Modifier.fillMaxWidth().fillMaxHeight(((v / max).toFloat()).coerceIn(0.04f, 1f)).clip(RoundedCornerShape(4.dp)).background(on.copy(alpha = if (v > 0) 0.9f else 0.2f)))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            listOf("J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D").forEach { Text(it, Modifier.weight(1f), color = on.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Mini("Invoiced", f.invoiced, on, Modifier.weight(1f))
            Mini("Outstanding", f.outstanding, on, Modifier.weight(1f))
            Mini("Overdue", f.overdue, on, Modifier.weight(1f))
        }
        if (f.estimatesOpen > 0) Text("${f.estimatesOpen} open estimate(s) worth ${Fmt.cash(f.estimatesValue)}", color = on.copy(alpha = 0.75f), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp))
    }
}

@Composable
private fun Mini(label: String, n: Double, on: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    Column(modifier) {
        Text(label, color = on.copy(alpha = 0.75f), style = MaterialTheme.typography.labelMedium)
        Text(Fmt.cashShort(n), color = on, style = MaterialTheme.typography.titleMedium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvoiceDetail(vm: MainViewModel, inv: Invoice, onClose: () -> Unit, onEdit: () -> Unit) {
    val ctx = LocalContext.current
    var paying by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${inv.type} #${inv.number}", style = MaterialTheme.typography.titleLarge)
                    Text(inv.client + if (inv.email.isNotBlank()) " · " + inv.email else "", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                StatusChip(inv.status)
            }
            Text(
                (if (inv.isInvoice) "Issued " else "Dated ") + Fmt.date(inv.date) + " · " + (if (inv.isInvoice) "due " else "valid until ") + Fmt.date(inv.due) +
                    (if (inv.from > 0) " · from estimate #${inv.from}" else ""),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            HorizontalDivider()
            inv.items.forEach { it ->
                Row {
                    Column(Modifier.weight(1f)) {
                        Text(it.name, fontWeight = FontWeight.SemiBold)
                        if (it.qty != 1.0) Text("${it.qty.toString().removeSuffix(".0")} × ${Fmt.cash(it.price)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(Fmt.cash(it.amount))
                }
            }
            HorizontalDivider()
            Row { Text("Total", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(Fmt.cash(inv.total), fontWeight = FontWeight.Bold) }
            if (inv.isInvoice) {
                inv.payments.forEachIndexed { i, p ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Paid ${Fmt.date(p.date)} · ${p.method}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Text(Fmt.cash(p.amount))
                        IconButton(onClick = { vm.removePayment(inv.row, i) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Remove payment", Modifier.size(16.dp)) }
                    }
                }
                Row { Text("Amount due", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(Fmt.cash(inv.owing), fontWeight = FontWeight.Bold) }
            }
            Spacer(Modifier.height(4.dp))
            if (inv.isInvoice && inv.status != "Void" && inv.status != "Paid") Button(onClick = { paying = true }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Record payment") }
            if (!inv.isInvoice && inv.status != "Accepted") Button(onClick = { vm.convertEstimate(inv.row); onClose() }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Convert to invoice") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { vm.sendInvoice(inv.row) }, enabled = !vm.busy && inv.status != "Void", modifier = Modifier.weight(1f)) { Text(if (inv.sent.isBlank()) "Email it" else "Email again") }
                OutlinedButton(onClick = { vm.fetchPdf(inv.row) { f -> openFile(ctx, f) } }, enabled = !vm.busy, modifier = Modifier.weight(1f)) { Text("View PDF") }
                OutlinedButton(onClick = { vm.fetchPdf(inv.row) { f -> shareFile(ctx, f) } }, enabled = !vm.busy, modifier = Modifier.weight(1f)) { Text("Share") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!(inv.isInvoice && (inv.status == "Paid" || inv.status == "Void"))) OutlinedButton(onClick = onEdit, modifier = Modifier.weight(1f)) { Text("Edit") }
                if (!inv.isInvoice) {
                    if (inv.status != "Accepted") OutlinedButton(onClick = { vm.invoiceStatus(inv.row, "Accepted") }, modifier = Modifier.weight(1f)) { Text("Accepted") }
                    if (inv.status != "Declined") OutlinedButton(onClick = { vm.invoiceStatus(inv.row, "Declined") }, modifier = Modifier.weight(1f)) { Text("Declined") }
                } else if (inv.status != "Void" && inv.status != "Paid") {
                    OutlinedButton(onClick = { vm.invoiceStatus(inv.row, "Void") }, modifier = Modifier.weight(1f)) { Text("Void") }
                }
                if (!inv.isInvoice || inv.status == "Draft" || inv.status == "Void") OutlinedButton(
                    onClick = { confirmDelete = true }, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text("Delete") }
            }
        }
    }
    if (paying) PaymentDialog(inv, onDismiss = { paying = false }) { amt, date, method -> paying = false; vm.payInvoice(inv.row, amt, date, method) }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Delete #${inv.number}?") }, text = { Text("This removes it from your records.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.deleteInvoice(inv.row); onClose() }) { Text("Delete") } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep") } }
    )
}

private fun pickDate(ctx: Context, cur: String, set: (String) -> Unit) {
    val d = try { LocalDate.parse(cur) } catch (e: Exception) { LocalDate.now() }
    DatePickerDialog(ctx, { _, y, m, day -> set(LocalDate.of(y, m + 1, day).toString()) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
}

@Composable
private fun PaymentDialog(inv: Invoice, onDismiss: () -> Unit, onSave: (Double, String, String) -> Unit) {
    val ctx = LocalContext.current
    var amount by remember { mutableStateOf(String.format(java.util.Locale.US, "%.2f", inv.owing)) }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var method by remember { mutableStateOf("bank payment") }
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("Record payment") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Amount (${AppConfig.CURRENCY})") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedButton(onClick = { pickDate(ctx, date) { date = it } }, modifier = Modifier.fillMaxWidth()) { Text(Fmt.date(date)) }
                OutlinedTextField(method, { method = it }, label = { Text("Paid by (bank payment, cash…)") }, singleLine = true)
            }
        },
        confirmButton = { TextButton(onClick = { val a = amount.toDoubleOrNull() ?: 0.0; if (a > 0) onSave(a, date, method) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
private fun FeesDialog(vm: MainViewModel, fees: List<Fee>, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("Extra fees you can add") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (fees.isEmpty()) Text("No fees yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                fees.forEach { f ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(f.name, Modifier.weight(1f)); Text(Fmt.cash(f.price))
                        IconButton(onClick = { vm.removeFee(f.row) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Remove", Modifier.size(16.dp)) }
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
                OutlinedTextField(name, { name = it }, label = { Text("New fee (e.g. Permit fee)") }, singleLine = true)
                OutlinedTextField(price, { price = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Price (${AppConfig.CURRENCY})") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                TextButton(onClick = { val p = price.toDoubleOrNull(); if (name.isNotBlank() && p != null) { vm.addFee(name.trim(), p); name = ""; price = "" } }) { Text("Add fee") }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } }
    )
}

private class EditLine(name: String, desc: String, qty: String, price: String) {
    var name by mutableStateOf(name)
    var desc by mutableStateOf(desc)
    var qty by mutableStateOf(qty)
    var price by mutableStateOf(price)
}

private fun num(d: Double): String = if (d == Math.floor(d)) d.toLong().toString() else d.toString()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvoiceEditor(vm: MainViewModel, existing: Invoice?, type: String, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var client by remember { mutableStateOf(existing?.client ?: "") }
    var email by remember { mutableStateOf(existing?.email ?: "") }
    var phone by remember { mutableStateOf(existing?.phone ?: "") }
    var bookingRow by remember { mutableIntStateOf(existing?.bookingRow ?: 0) }
    var date by remember { mutableStateOf(existing?.date ?: LocalDate.now().toString()) }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    val lines = remember { mutableStateListOf<EditLine>().also { l -> existing?.items?.forEach { l.add(EditLine(it.name, it.desc, num(it.qty), num(it.price))) } } }
    var err by remember { mutableStateOf("") }
    var pickBooking by remember { mutableStateOf(false) }
    val fees = vm.money?.fees ?: emptyList()

    fun save(send: Boolean) {
        val items = lines.mapNotNull { l ->
            if (l.name.isBlank()) null else LineItem(l.name.trim(), l.desc, l.qty.toDoubleOrNull()?.takeIf { it > 0 } ?: 1.0, l.price.toDoubleOrNull() ?: 0.0)
        }
        err = when {
            client.isBlank() -> "Enter the client's name."
            items.isEmpty() -> "Add at least one item."
            else -> ""
        }
        if (err.isNotEmpty()) return
        vm.saveInvoice(existing?.row ?: 0, type, client.trim(), email.trim(), phone.trim(), bookingRow, items, date, notes.trim(), send) { e ->
            when (e) {
                null -> onClose()
                "no_email" -> err = "Saved, but there's no valid email address to send it to."
                "invalid_input" -> err = "Check the details. The email address may be wrong."
                "locked" -> err = "This invoice can't be changed any more."
                else -> err = "Couldn't save. Try again."
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (existing == null) "New ${type.lowercase()}" else "Edit ${type.lowercase()} #${existing.number}", style = MaterialTheme.typography.titleLarge)
            if (existing == null) OutlinedButton(onClick = { pickBooking = true }, modifier = Modifier.fillMaxWidth()) { Text(if (bookingRow > 0) "Linked to a booking · change" else "Fill from a booking") }
            OutlinedTextField(client, { client = it }, label = { Text("Client name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            OutlinedTextField(phone, { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
            OutlinedButton(onClick = { pickDate(ctx, date) { date = it } }, modifier = Modifier.fillMaxWidth()) { Text("Date: " + Fmt.date(date)) }

            Text("Items", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 6.dp))
            lines.forEachIndexed { i, l ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(l.name, { l.name = it }, label = { Text("Item") }, singleLine = true, modifier = Modifier.weight(1f))
                        IconButton(onClick = { lines.removeAt(i) }) { Icon(Icons.Outlined.Close, "Remove item") }
                    }
                    OutlinedTextField(l.desc, { l.desc = it }, label = { Text("Details (one per line, optional)") }, modifier = Modifier.fillMaxWidth(), minLines = 1)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(l.qty, { l.qty = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Qty") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        OutlinedTextField(l.price, { l.price = it.filter { c -> c.isDigit() || c == '.' || c == '-' } }, label = { Text("Price") }, singleLine = true, modifier = Modifier.weight(2f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                    }
                }
            }
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { AssistChip(onClick = { lines.add(EditLine("", "", "1", "")) }, label = { Text("+ Custom item") }) }
                items(fees) { f -> AssistChip(onClick = { lines.add(EditLine(f.name, f.desc, "1", num(f.price))) }, label = { Text("+ " + f.name) }) }
                items(AppConfig.PACKAGES) { p -> AssistChip(onClick = { lines.add(EditLine(p.name, "", "1", p.price.toString())) }, label = { Text("+ " + p.name) }) }
            }
            val total = lines.sumOf { (it.qty.toDoubleOrNull() ?: 1.0) * (it.price.toDoubleOrNull() ?: 0.0) }
            Row { Text("Total", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(Fmt.cash(total), style = MaterialTheme.typography.titleMedium) }
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { save(false) }, enabled = !vm.busy, modifier = Modifier.weight(1f).height(50.dp)) { Text("Save") }
                Button(onClick = { save(true) }, enabled = !vm.busy, modifier = Modifier.weight(1f).height(50.dp)) { Text("Save & email") }
            }
        }
    }

    if (pickBooking) {
        val bookings = (vm.data?.bookings ?: emptyList()).filter { it.isActive }.sortedByDescending { it.startDateTime }.take(40)
        AlertDialog(
            onDismissRequest = { pickBooking = false }, title = { Text("Choose a booking") },
            text = {
                LazyColumn {
                    items(bookings) { b ->
                        Column(Modifier.fillMaxWidth().clickable {
                            client = b.name; email = b.email; phone = b.phone; bookingRow = b.row
                            if (lines.isEmpty()) lines.add(EditLine(b.pkg.ifBlank { "Photography session" }, if (b.duration > 0) "Duration: ${b.duration} minutes" else "", "1", num(bookingPrice(b))))
                            pickBooking = false
                        }.padding(vertical = 8.dp)) {
                            Text(b.name, fontWeight = FontWeight.SemiBold)
                            Text(b.pkg + " · " + Fmt.date(b.date), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { pickBooking = false }) { Text("Cancel") } }
        )
    }
}

/** Shown when you tap Confirm on a booking: pick extra fees and decide whether the invoice is emailed. */
@Composable
fun ConfirmBookingDialog(vm: MainViewModel, b: Booking, onDismiss: () -> Unit) {
    val fees = vm.money?.fees ?: emptyList()
    val picked = remember { mutableStateListOf<Int>() }
    var send by remember { mutableStateOf(b.email.isNotBlank()) }
    val base = bookingPrice(b)
    val total = base + fees.filter { it.row in picked }.sumOf { it.price }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Confirm ${b.name}'s booking") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row { Text(b.pkg.ifBlank { "Session" }, Modifier.weight(1f)); Text(Fmt.cash(base)) }
                if (fees.isNotEmpty()) Text("Add to the invoice", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 10.dp))
                fees.forEach { f ->
                    Row(Modifier.fillMaxWidth().clickable { if (f.row in picked) picked.remove(f.row) else picked.add(f.row) }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = f.row in picked, onCheckedChange = { if (it) picked.add(f.row) else picked.remove(f.row) })
                        Text(f.name, Modifier.weight(1f)); Text(Fmt.cash(f.price))
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
                Row { Text("Invoice total", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(Fmt.cash(total), fontWeight = FontWeight.Bold) }
                if (b.email.isNotBlank()) Row(Modifier.fillMaxWidth().clickable { send = !send }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = send, onCheckedChange = { send = it })
                    Text("Email the confirmation and invoice")
                } else Text("No email on this booking, so the invoice is saved but not sent.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val extras = fees.filter { it.row in picked }.map { LineItem(it.name, it.desc, 1.0, it.price) }
                onDismiss(); vm.setStatus(b.row, "Confirmed", extras, send && b.email.isNotBlank())
            }) { Text("Confirm") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
