package com.jabaribrownstudio.admin

import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.ui.unit.sp
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
fun StatusChip(status: String) {
    val dark = isSystemInDarkTheme()
    val key = when (status) { "Paid", "Accepted" -> "Confirmed"; "Partial", "Sent" -> "Pending"; else -> "Cancelled" }
    Text(
        status, style = MaterialTheme.typography.labelMedium, color = StatusColors.fg(key, dark),
        modifier = Modifier.clip(RoundedCornerShape(50)).background(StatusColors.bg(key, dark)).padding(horizontal = 10.dp, vertical = 4.dp)
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun InvoicesTab(vm: MainViewModel, pad: PaddingValues) {
    val m = vm.money
    var section by remember { mutableStateOf("Invoices") }
    var payFilter by remember { mutableStateOf("All") }
    var itemDialog by remember { mutableStateOf<Fee?>(null) }
    var newItem by remember { mutableStateOf(false) }
    var taxDialog by remember { mutableStateOf(false) }
    var taxToRemove by remember { mutableStateOf<SavedTax?>(null) }
    var editing by remember { mutableStateOf<Invoice?>(null) }
    var creating by remember { mutableStateOf<String?>(null) }
    var viewing by remember { mutableIntStateOf(-1) }
    var converting by remember { mutableStateOf<Invoice?>(null) }
    var menu by remember { mutableStateOf(false) }
    var clientQuery by remember { mutableStateOf("") }
    var clientOpen by remember { mutableStateOf<Client?>(null) }
    var clientEdit by remember { mutableStateOf<Client?>(null) }
    var clientNew by remember { mutableStateOf(false) }
    var invoiceFor by remember { mutableStateOf<Client?>(null) }
    LaunchedEffect(Unit) { vm.loadMoney() }
    LaunchedEffect(section) { if (section == "Clients") vm.loadClients() }

    Box(Modifier.fillMaxSize().padding(pad)) {
        PullToRefreshBox(isRefreshing = vm.moneyLoading || vm.clientsLoading, onRefresh = { vm.loadMoney(); if (section == "Clients") vm.loadClients() }, modifier = Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Accounting", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 8.dp))
                            Text("Invoices, estimates, products and payments.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (m == null) {
                    item { Text(if (vm.moneyLoading) "Loading…" else "Pull down to load.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
                } else {
                    item { Summary(vm, m.finance) }
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf("Invoices" to "Invoices", "Estimates" to "Estimate", "Items" to "Services", "Clients" to "Clients").forEach { (k, l) ->
                                FilterChip(selected = section == k, onClick = { section = k }, modifier = Modifier.weight(1f).height(48.dp),
                                    label = { Text(l, Modifier.fillMaxWidth(), maxLines = 1, softWrap = false, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = androidx.compose.ui.text.style.TextAlign.Center) })
                            }
                        }
                    }
                    if (section == "Clients") {
                        item { OutlinedTextField(clientQuery, { clientQuery = it }, label = { Text("Search clients") }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
                        clientItems(vm, clientQuery) { clientOpen = it }
                    }
                    if (section == "Invoices") item {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("All", "Unpaid", "Paid").forEach { f ->
                                FilterChip(selected = payFilter == f, onClick = { payFilter = f }, label = { Text(f) })
                            }
                        }
                    }
                    if (section == "Items") {
                        if (m.fees.isEmpty()) item { Text("No Products or Services yet. Add the things you charge for, with a price and quantity, then drop them into any invoice or estimate.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
                        items(m.fees, key = { "fee" + it.row }) { f ->
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface).clickable { itemDialog = f }.padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(f.name, style = MaterialTheme.typography.titleMedium)
                                    if (f.desc.isNotBlank()) Text(f.desc, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                                    Text("Quantity ${num(f.qty)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(Fmt.cash(f.price), style = MaterialTheme.typography.titleMedium)
                                    if (f.qty != 1.0) Text("= " + Fmt.cash(f.price * f.qty), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        item { Text("Taxes", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp)) }
                        if (m.taxes.isEmpty()) item { Text("No taxes saved. Add one (for example GCT 15%) to apply it to invoices in one tap.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        items(m.taxes, key = { "tax" + it.row }) { t ->
                            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface).padding(start = 16.dp, top = 6.dp, bottom = 6.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(t.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                                Text(num(t.rate) + "%")
                                IconButton(onClick = { taxToRemove = t }) { Icon(Icons.Outlined.Close, "Remove tax") }
                            }
                        }
                        item { OutlinedButton(onClick = { taxDialog = true }, modifier = Modifier.fillMaxWidth()) { Text("+ Add a tax") } }
                    }
                    val list = if (section == "Items" || section == "Clients") emptyList() else m.invoices.filter { (it.type == "Estimate") == (section == "Estimates") }.filter {
                        section == "Estimates" || when (payFilter) {
                            "Unpaid" -> it.status in listOf("Draft", "Sent", "Partial")
                            "Paid" -> it.status == "Paid"
                            else -> true
                        }
                    }
                    if (section != "Items" && section != "Clients" && list.isEmpty()) item { Text(if (section == "Invoices" && payFilter != "All") "No ${payFilter.lowercase()} invoices." else "Nothing here yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
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
                            if (!inv.isInvoice && inv.status != "Declined") {
                                val made = m.invoices.firstOrNull { it.isInvoice && it.from == inv.number }
                                if (made != null) TextButton(onClick = { section = "Invoices"; payFilter = "All"; viewing = made.row }, modifier = Modifier.padding(top = 4.dp)) { Text("View invoice #${made.number}") }
                                else Button(onClick = { converting = inv }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) { Text("Convert to invoice") }
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
                DropdownMenuItem(text = { Text("New Invoice") }, onClick = { menu = false; creating = "Invoice" })
                DropdownMenuItem(text = { Text("New Estimate") }, onClick = { menu = false; creating = "Estimate" })
                DropdownMenuItem(text = { Text("New Client") }, onClick = { menu = false; section = "Clients"; clientNew = true })
                DropdownMenuItem(text = { Text("New Product or Service") }, onClick = { menu = false; section = "Items"; newItem = true })
            }
        }
    }

    val cur = m?.invoices?.firstOrNull { it.row == viewing }
    converting?.let { e -> ConvertDialog(vm, e, onClose = { converting = null }) { r -> converting = null; section = "Invoices"; payFilter = "All"; viewing = r } }
    if (cur != null) InvoiceDetail(vm, cur, onClose = { viewing = -1 }, onEdit = { editing = cur; viewing = -1 }, onConverted = { r -> section = "Invoices"; payFilter = "All"; viewing = r })
    clientOpen?.let { c0 ->
        val c = vm.clients?.firstOrNull { it.row == c0.row } ?: c0
        ClientDetail(vm, c, onClose = { clientOpen = null }, onEdit = { clientEdit = c; clientOpen = null }, onInvoice = { invoiceFor = c; clientOpen = null }, onOpenInvoice = { r -> clientOpen = null; section = "Invoices"; payFilter = "All"; viewing = r })
    }
    if (clientNew || clientEdit != null) ClientDialog(vm, clientEdit) { clientNew = false; clientEdit = null }
    if (invoiceFor != null) InvoiceEditor(vm, null, "Invoice", prefill = invoiceFor) { invoiceFor = null }
    if (creating != null) InvoiceEditor(vm, null, creating!!) { creating = null }
    if (editing != null) InvoiceEditor(vm, editing, editing!!.type) { editing = null }
    if (newItem || itemDialog != null) ItemDialog(vm, itemDialog) { newItem = false; itemDialog = null }
    if (taxDialog) TaxDialog(vm) { taxDialog = false }
    taxToRemove?.let { t ->
        AlertDialog(
            onDismissRequest = { taxToRemove = null },
            title = { Text("Delete ${t.name}?") }, text = { Text("It will be removed from your saved taxes. Invoices that already use it are not changed.") },
            confirmButton = { TextButton(onClick = { taxToRemove = null; vm.removeTax(t.row) }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { taxToRemove = null }) { Text("Keep") } }
        )
    }
}

@Composable
private fun Summary(vm: MainViewModel, f: Finance) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(MaterialTheme.colorScheme.primary).padding(12.dp)) {
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
        Text(Fmt.cash(f.collected), color = on, style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        val max = (f.months.maxOrNull() ?: 0.0).coerceAtLeast(1.0)
        Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
            f.months.forEach { v ->
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
                    Box(Modifier.fillMaxWidth().fillMaxHeight(((v / max).toFloat()).coerceIn(0.04f, 1f)).clip(RoundedCornerShape(4.dp)).background(on.copy(alpha = if (v > 0) 0.9f else 0.2f)))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            listOf("J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D").forEach { Text(it, Modifier.weight(1f), color = on.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
        }
        Spacer(Modifier.height(8.dp))
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
private fun InvoiceDetail(vm: MainViewModel, inv: Invoice, onClose: () -> Unit, onEdit: () -> Unit, onConverted: (Int) -> Unit) {
    val ctx = LocalContext.current
    var paying by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var converting by remember { mutableStateOf<Invoice?>(null) }
    converting?.let { e -> ConvertDialog(vm, e, onClose = { converting = null }) { r -> converting = null; onConverted(r); onClose() } }
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
            val tt = totals(inv.items, inv.discount, inv.taxes)
            if (tt.discount > 0 || tt.taxes.isNotEmpty()) {
                Row { Text("Subtotal", Modifier.weight(1f)); Text(Fmt.cash(tt.subtotal)) }
                if (tt.discount > 0) Row {
                    Text("Discount" + (if (inv.discount?.type == "percent") " (${num(inv.discount.value)}%)" else ""), Modifier.weight(1f)); Text("-" + Fmt.cash(tt.discount))
                }
                tt.taxes.forEach { (t, a) -> Row { Text("${t.name} (${num(t.rate)}%)", Modifier.weight(1f)); Text(Fmt.cash(a)) } }
            }
            Row { Text("Total", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(Fmt.cash(inv.total), fontWeight = FontWeight.Bold) }
            if (inv.isInvoice) {
                inv.payments.forEachIndexed { i, p ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        var pm by remember { mutableStateOf(false) }
                        Text("Paid ${Fmt.date(p.date)} · ${p.method}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Text(Fmt.cash(p.amount))
                        Box {
                            TextButton(onClick = { pm = true }) { Text("Receipt") }
                            DropdownMenu(expanded = pm, onDismissRequest = { pm = false }) {
                                DropdownMenuItem(text = { Text("Email receipt") }, onClick = { pm = false; vm.emailReceipt(inv.row, i) })
                                DropdownMenuItem(text = { Text("View PDF") }, onClick = { pm = false; vm.fetchReceiptPdf(inv.row, i) { f -> openFile(ctx, f) } })
                                DropdownMenuItem(text = { Text("Share PDF") }, onClick = { pm = false; vm.fetchReceiptPdf(inv.row, i) { f -> shareFile(ctx, f) } })
                                DropdownMenuItem(text = { Text("Remove payment") }, onClick = { pm = false; vm.removePayment(inv.row, i) })
                            }
                        }
                    }
                }
                Row { Text("Amount due", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(Fmt.cash(inv.owing), fontWeight = FontWeight.Bold) }
            }
            Spacer(Modifier.height(4.dp))
            if (inv.isInvoice && inv.status in listOf("Sent", "Partial", "Draft") && inv.owing > 0) OutlinedButton(onClick = { vm.remindInvoice(inv.row) }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Send payment reminder") }
            if (inv.isInvoice && inv.status != "Void" && inv.status != "Paid") Button(onClick = { paying = true }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Record payment") }
            if (!inv.isInvoice && inv.status != "Declined" && m0(vm, inv) == null) Button(onClick = { converting = inv }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Convert to invoice") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { vm.sendInvoice(inv.row) }, enabled = !vm.busy && inv.status != "Void", modifier = Modifier.weight(1f)) { Text(if (inv.sent.isBlank()) "Email it" else "Email again", maxLines = 1, softWrap = false) }
                OutlinedButton(onClick = { vm.fetchPdf(inv.row) { f -> openFile(ctx, f) } }, enabled = !vm.busy, modifier = Modifier.weight(1f)) { Text("View PDF") }
                OutlinedButton(onClick = { vm.fetchPdf(inv.row) { f -> shareFile(ctx, f) } }, enabled = !vm.busy, modifier = Modifier.weight(1f)) { Text("Share") }
            }
            if (inv.sent.isNotBlank() || inv.status == "Sent") OutlinedButton(onClick = { vm.invoiceStatus(inv.row, "Unsent") }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth()) { Text("Mark as Unsent") }
            if (!inv.isInvoice) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (inv.status != "Accepted") OutlinedButton(onClick = { vm.invoiceStatus(inv.row, "Accepted") }, modifier = Modifier.weight(1f)) { Text("Accepted", maxLines = 1, softWrap = false) }
                if (inv.status != "Declined") OutlinedButton(onClick = { vm.invoiceStatus(inv.row, "Declined") }, modifier = Modifier.weight(1f)) { Text("Declined", maxLines = 1, softWrap = false) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!(inv.isInvoice && (inv.status == "Paid" || inv.status == "Void"))) OutlinedButton(onClick = onEdit, modifier = Modifier.weight(1f)) { Text("Edit", maxLines = 1, softWrap = false) }
                if (inv.isInvoice && inv.status != "Void" && inv.status != "Paid") {
                    OutlinedButton(onClick = { vm.invoiceStatus(inv.row, "Void") }, modifier = Modifier.weight(1f)) { Text("Void", maxLines = 1, softWrap = false) }
                }
                if (!inv.isInvoice || inv.status == "Draft" || inv.status == "Void") OutlinedButton(
                    onClick = { confirmDelete = true }, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text("Delete", maxLines = 1, softWrap = false) }
            }
        }
    }
    if (paying) PaymentDialog(inv, onDismiss = { paying = false }) { amt, date, method, receipt -> paying = false; vm.payInvoice(inv.row, amt, date, method, receipt) }
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
private fun PaymentDialog(inv: Invoice, onDismiss: () -> Unit, onSave: (Double, String, String, Boolean) -> Unit) {
    var receipt by remember { mutableStateOf(inv.email.isNotBlank()) }
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
                if (inv.email.isNotBlank()) Row(Modifier.fillMaxWidth().clickable { receipt = !receipt }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = receipt, onCheckedChange = { receipt = it }); Text("Email a receipt to the client")
                } else Text("No client email, so no receipt will be sent.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { TextButton(onClick = { val a = amount.toDoubleOrNull() ?: 0.0; if (a > 0) onSave(a, date, method, receipt && inv.email.isNotBlank()) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
private fun ItemDialog(vm: MainViewModel, f: Fee?, onDismiss: () -> Unit) {
    var name by remember(f) { mutableStateOf(f?.name ?: "") }
    var desc by remember(f) { mutableStateOf(f?.desc ?: "") }
    var price by remember(f) { mutableStateOf(f?.let { num(it.price) } ?: "") }
    var qty by remember(f) { mutableStateOf(f?.let { num(it.qty) } ?: "1") }
    var confirmDelete by remember { mutableStateOf(false) }
    if (confirmDelete && f != null) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Delete ${f.name}?") },
        text = { Text("It will be removed from your Products & Services. Invoices that already use it are not changed.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.removeFee(f.row); onDismiss() }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete") } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep") } }
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (f == null) "New Product or Service" else "Edit Product or Service") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Name (e.g. Permit fee)") }, singleLine = true)
                OutlinedTextField(desc, { desc = it }, label = { Text("Description (optional)") })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(price, { price = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Price (${AppConfig.CURRENCY})") }, singleLine = true, modifier = Modifier.weight(1.4f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                    OutlinedTextField(qty, { qty = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Quantity") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                }
                Text("The quantity is filled in whenever you add this to an invoice. You can still change it there.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val p = price.toDoubleOrNull(); val q = qty.toDoubleOrNull()?.takeIf { it > 0 } ?: 1.0
                if (name.isNotBlank() && p != null) {
                    if (f == null) vm.addFee(name.trim(), desc.trim(), p, q) else vm.updateFee(f.row, name.trim(), desc.trim(), p, q)
                    onDismiss()
                }
            }) { Text("Save") }
        },
        dismissButton = {
            Row {
                if (f != null) TextButton(onClick = { confirmDelete = true }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Delete") }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        }
    )
}

@Composable
private fun TaxDialog(vm: MainViewModel, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var rate by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("New tax") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Name (e.g. GCT)") }, singleLine = true)
                OutlinedTextField(rate, { rate = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Rate (%)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            }
        },
        confirmButton = { TextButton(onClick = { val r = rate.toDoubleOrNull(); if (name.isNotBlank() && r != null && r > 0) { vm.addTax(name.trim(), r); onDismiss() } }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

private class EditTax(name: String, rate: String) {
    var name by mutableStateOf(name)
    var rate by mutableStateOf(rate)
}

private fun discountOf(type: String, value: String): Discount? = value.toDoubleOrNull()?.takeIf { it > 0 }?.let { Discount(type, it) }
private fun taxesOf(list: List<EditTax>): List<TaxRate> = list.mapNotNull { t -> val r = t.rate.toDoubleOrNull(); if (t.name.isBlank() || r == null || r <= 0) null else TaxRate(t.name.trim(), r) }

/** Discount and tax inputs, shared by the invoice editor and the confirm dialog. */
@Composable
private fun AdjustFields(saved: List<SavedTax>, discType: String, onType: (String) -> Unit, discValue: String, onValue: (String) -> Unit, taxes: MutableList<EditTax>) {
    Text("Discount", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 6.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        FilterChip(selected = discType == "percent", onClick = { onType("percent") }, label = { Text("%") })
        FilterChip(selected = discType == "amount", onClick = { onType("amount") }, label = { Text(AppConfig.CURRENCY) })
        OutlinedTextField(discValue, { onValue(it.filter { c -> c.isDigit() || c == '.' }) }, label = { Text("None") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
    }
    Text("Taxes", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 6.dp))
    taxes.forEachIndexed { i, t ->
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(t.name, { t.name = it }, label = { Text("Tax") }, singleLine = true, modifier = Modifier.weight(1.4f))
            OutlinedTextField(t.rate, { t.rate = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("%") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            IconButton(onClick = { taxes.removeAt(i) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Remove tax", Modifier.size(16.dp)) }
        }
    }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(saved.filter { st -> taxes.none { it.name == st.name } }) { st -> AssistChip(onClick = { taxes.add(EditTax(st.name, num(st.rate))) }, label = { Text("+ ${st.name} ${num(st.rate)}%") }) }
        item { AssistChip(onClick = { taxes.add(EditTax("", "")) }, label = { Text("+ Other tax") }) }
    }
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
private fun InvoiceEditor(vm: MainViewModel, existing: Invoice?, type: String, prefill: Client? = null, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var client by remember { mutableStateOf(existing?.client ?: prefill?.name ?: "") }
    var email by remember { mutableStateOf(existing?.email ?: prefill?.email ?: "") }
    var phone by remember { mutableStateOf(existing?.phone ?: prefill?.phone ?: "") }
    var pickClient by remember { mutableStateOf(false) }
    var bookingRow by remember { mutableIntStateOf(existing?.bookingRow ?: 0) }
    var date by remember { mutableStateOf(existing?.date ?: LocalDate.now().toString()) }
    var due by remember { mutableStateOf(existing?.due?.takeIf { it.isNotBlank() } ?: (existing?.date ?: LocalDate.now().toString())) }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    val lines = remember { mutableStateListOf<EditLine>().also { l -> existing?.items?.forEach { l.add(EditLine(it.name, it.desc, num(it.qty), num(it.price))) } } }
    var err by remember { mutableStateOf("") }
    var pickBooking by remember { mutableStateOf(false) }
    var pickItem by remember { mutableStateOf(false) }
    val fees = vm.money?.fees ?: emptyList()
    var discType by remember { mutableStateOf(existing?.discount?.type ?: "percent") }
    var discValue by remember { mutableStateOf(existing?.discount?.let { num(it.value) } ?: "") }
    val taxes = remember { mutableStateListOf<EditTax>().also { l -> existing?.taxes?.forEach { l.add(EditTax(it.name, num(it.rate))) } } }

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
        vm.saveInvoice(existing?.row ?: 0, type, client.trim(), email.trim(), phone.trim(), bookingRow, items, date, notes.trim(), send, discountOf(discType, discValue), taxesOf(taxes), due) { e ->
            when (e) {
                null -> onClose()
                "no_email" -> err = "Saved, but there's no valid email address to send it to."
                "invalid_input" -> err = "Check the details. The email address may be wrong."
                "locked" -> err = "This invoice can't be changed any more."
                else -> err = "Couldn't save. Try again."
            }
        }
    }

    if (pickClient) ClientPicker(vm, onPick = { c -> client = c.name; email = c.email; phone = c.phone; pickClient = false }, onClose = { pickClient = false })
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (existing == null) "New ${type.lowercase()}" else "Edit ${type.lowercase()} #${existing.number}", style = MaterialTheme.typography.titleLarge)
            if (existing == null) OutlinedButton(onClick = { pickBooking = true }, modifier = Modifier.fillMaxWidth()) { Text(if (bookingRow > 0) "Linked to a booking · change" else "Fill from a booking") }
            if (existing == null) OutlinedButton(onClick = { pickClient = true }, modifier = Modifier.fillMaxWidth()) { Text("Choose a saved client") }
            OutlinedTextField(client, { client = it }, label = { Text("Client name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            OutlinedTextField(phone, { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { pickDate(ctx, date) { nd -> if (due == date) due = nd else if (due < nd) due = nd; date = nd } }, modifier = Modifier.weight(1f)) { Text("Date: " + Fmt.date(date)) }
                OutlinedButton(onClick = { pickDate(ctx, due) { due = it } }, modifier = Modifier.weight(1f)) { Text((if (type == "Estimate") "Valid until: " else "Due: ") + Fmt.date(due)) }
            }

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
                items(fees) { f -> AssistChip(onClick = { lines.add(EditLine(f.name, f.desc, num(f.qty), num(f.price))) }, label = { Text("+ " + f.name) }) }
            }
            OutlinedButton(onClick = { pickItem = true }, modifier = Modifier.fillMaxWidth()) { Text("Add a Product or Service") }
            AdjustFields(vm.money?.taxes ?: emptyList(), discType, { discType = it }, discValue, { discValue = it }, taxes)
            val tt = totals(
                lines.map { LineItem(it.name, "", it.qty.toDoubleOrNull() ?: 1.0, it.price.toDoubleOrNull() ?: 0.0) },
                discountOf(discType, discValue), taxesOf(taxes)
            )
            if (tt.discount > 0 || tt.taxes.isNotEmpty()) {
                Row { Text("Subtotal", Modifier.weight(1f)); Text(Fmt.cash(tt.subtotal)) }
                if (tt.discount > 0) Row { Text("Discount", Modifier.weight(1f)); Text("-" + Fmt.cash(tt.discount)) }
                tt.taxes.forEach { (t, a) -> Row { Text("${t.name} (${num(t.rate)}%)", Modifier.weight(1f)); Text(Fmt.cash(a)) } }
            }
            Row { Text("Total", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(Fmt.cash(tt.total), style = MaterialTheme.typography.titleMedium) }
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { save(false) }, enabled = !vm.busy, modifier = Modifier.weight(1f).height(50.dp)) { Text("Save") }
                Button(onClick = { save(true) }, enabled = !vm.busy, modifier = Modifier.weight(1f).height(50.dp)) { Text("Save & email") }
            }
        }
    }

    if (pickItem) {
        AlertDialog(
            onDismissRequest = { pickItem = false }, title = { Text("Add a Product or Service") },
            text = {
                LazyColumn {
                    items(fees) { f ->
                        Row(Modifier.fillMaxWidth().clickable { lines.add(EditLine(f.name, f.desc, num(f.qty), num(f.price))); pickItem = false }.padding(vertical = 10.dp)) {
                            Column(Modifier.weight(1f)) { Text(f.name, fontWeight = FontWeight.SemiBold); if (f.desc.isNotBlank()) Text(f.desc, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
                            Text(Fmt.cash(f.price) + if (f.qty != 1.0) " × " + num(f.qty) else "")
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { pickItem = false }) { Text("Cancel") } }
        )
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
    val picked = remember { androidx.compose.runtime.mutableStateMapOf<Int, String>() }
    val custom = remember { mutableStateListOf<EditLine>() }
    var pickItem by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    var invDate by remember { mutableStateOf(LocalDate.now().toString()) }
    var invDue by remember { mutableStateOf(LocalDate.now().toString()) }
    var send by remember { mutableStateOf(b.email.isNotBlank()) }
    val base = bookingPrice(b)
    var discType by remember { mutableStateOf("percent") }
    var discValue by remember { mutableStateOf("") }
    val taxes = remember { mutableStateListOf<EditTax>() }
    val total = totals(
        listOf(LineItem("", "", 1.0, base)) + fees.filter { it.row in picked }.map { LineItem("", "", picked[it.row]?.toDoubleOrNull()?.takeIf { q -> q > 0 } ?: it.qty, it.price) } +
            custom.map { LineItem("", "", it.qty.toDoubleOrNull() ?: 1.0, it.price.toDoubleOrNull() ?: 0.0) },
        discountOf(discType, discValue), taxesOf(taxes)
    ).total
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Confirm ${b.name}'s booking") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row { Text(b.pkg.ifBlank { "Session" }, Modifier.weight(1f)); Text(Fmt.cash(base)) }
                Text("Add to the invoice", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 10.dp))
                fees.filter { it.row in picked }.forEach { f ->
                    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Column(Modifier.weight(1f)) { Text(f.name); Text(Fmt.cash(f.price), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        OutlinedTextField(picked[f.row] ?: "1", { picked[f.row] = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Qty") }, singleLine = true, modifier = Modifier.width(84.dp), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        IconButton(onClick = { picked.remove(f.row) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Remove item", Modifier.size(16.dp)) }
                    }
                }
                OutlinedButton(onClick = { pickItem = true }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Text("+ Add from Products & Services") }
                custom.forEachIndexed { i, l ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                        OutlinedTextField(l.name, { l.name = it }, label = { Text("Item") }, singleLine = true, modifier = Modifier.weight(1.3f))
                        OutlinedTextField(l.qty, { l.qty = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Qty") }, singleLine = true, modifier = Modifier.weight(0.7f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        OutlinedTextField(l.price, { l.price = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Price") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        IconButton(onClick = { custom.removeAt(i) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Remove item", Modifier.size(16.dp)) }
                    }
                }
                OutlinedButton(onClick = { custom.add(EditLine("", "", "1", "")) }, modifier = Modifier.fillMaxWidth()) { Text("+ Add a custom item") }
                AdjustFields(vm.money?.taxes ?: emptyList(), discType, { discType = it }, discValue, { discValue = it }, taxes)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                    OutlinedButton(onClick = { pickDate(ctx, invDate) { nd -> if (invDue == invDate || invDue < nd) invDue = nd; invDate = nd } }, modifier = Modifier.weight(1f)) { Text("Invoice date: " + Fmt.date(invDate)) }
                    OutlinedButton(onClick = { pickDate(ctx, invDue) { invDue = it } }, modifier = Modifier.weight(1f)) { Text("Due: " + Fmt.date(invDue)) }
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
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = {
                    val extras = fees.filter { it.row in picked }.map { LineItem(it.name, it.desc, picked[it.row]?.toDoubleOrNull()?.takeIf { q -> q > 0 } ?: it.qty, it.price) } +
                        custom.filter { it.name.isNotBlank() }.map { LineItem(it.name.trim(), "", it.qty.toDoubleOrNull()?.takeIf { q -> q > 0 } ?: 1.0, it.price.toDoubleOrNull() ?: 0.0) }
                    onDismiss(); vm.setStatus(b.row, "Confirmed", extras, send && b.email.isNotBlank(), discount = discountOf(discType, discValue), taxes = taxesOf(taxes), invDate = invDate, invDue = invDue)
                }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Confirm and invoice") }
                androidx.compose.material3.FilledTonalButton(onClick = {
                    onDismiss(); vm.setStatus(b.row, "Confirmed", noInvoice = true)
                }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text(if (b.email.isNotBlank()) "Confirm, email only (invoice later)" else "Confirm without invoice") }
                OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Cancel") }
            }
        },
        dismissButton = null
    )
    if (pickItem) {
        AlertDialog(
            onDismissRequest = { pickItem = false }, title = { Text("Products & Services") },
            text = {
                LazyColumn {
                    if (fees.isEmpty()) item { Text("Nothing saved yet. Add items under Accounting → Products & Services.") }
                    items(fees) { f ->
                        Row(Modifier.fillMaxWidth().clickable { if (f.row in picked) picked.remove(f.row) else picked[f.row] = num(f.qty) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = f.row in picked, onCheckedChange = { if (it) picked[f.row] = num(f.qty) else picked.remove(f.row) })
                            Text(f.name, Modifier.weight(1f)); Text(Fmt.cash(f.price))
                        }
                    }
                }
            },
            confirmButton = { Button(onClick = { pickItem = false }) { Text("Done") } }
        )
    }
}

private fun m0(vm: MainViewModel, inv: Invoice): Invoice? = vm.money?.invoices?.firstOrNull { it.isInvoice && it.from == inv.number }


/** Turns an estimate into an invoice, and can also create a booking so the two are linked (cancelling that booking then voids the invoice). */
@Composable
private fun ConvertDialog(vm: MainViewModel, e: Invoice, onClose: () -> Unit, onDone: (Int) -> Unit) {
    val ctx = LocalContext.current
    val linked = e.bookingRow > 0
    var create by remember { mutableStateOf(false) }
    var date by remember { mutableStateOf<LocalDate?>(null) }
    var time by remember { mutableStateOf<java.time.LocalTime?>(null) }
    var duration by remember { mutableStateOf("60") }
    var location by remember { mutableStateOf("") }
    var force by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Convert estimate #${e.number} to an invoice") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (linked) Text("This estimate is already linked to a booking, so the invoice will be linked to it too.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else {
                    Row(Modifier.fillMaxWidth().clickable { create = !create }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = create, onCheckedChange = { create = it })
                        Text("Also create a booking for ${e.client}")
                    }
                    if (create) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(modifier = Modifier.weight(1f), onClick = {
                                val d = date ?: LocalDate.now()
                                DatePickerDialog(ctx, { _, y, m, day -> date = LocalDate.of(y, m + 1, day) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
                            }) { Text(date?.let { it.dayOfMonth.toString() + "/" + it.monthValue + "/" + it.year } ?: "Pick date") }
                            OutlinedButton(modifier = Modifier.weight(1f), onClick = {
                                val t = time ?: java.time.LocalTime.of(10, 0)
                                android.app.TimePickerDialog(ctx, { _, h, m -> time = java.time.LocalTime.of(h, m) }, t.hour, t.minute, false).show()
                            }) { Text(time?.let { Fmt.time(it) } ?: "Pick time") }
                        }
                        OutlinedTextField(duration, { duration = it.filter { c -> c.isDigit() } }, label = { Text("Minutes") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        OutlinedTextField(location, { location = it }, label = { Text("Location (optional)") }, modifier = Modifier.fillMaxWidth())
                        Text("The booking is created as confirmed and no email is sent for it.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (err == "slot_taken") Row(Modifier.fillMaxWidth().clickable { force = !force }, verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = force, onCheckedChange = { force = it }); Text("Book it anyway (overlaps another booking)")
                        }
                    }
                }
                if (err.isNotEmpty()) Text(when (err) {
                    "slot_taken" -> "That time overlaps another booking."
                    "pick" -> "Choose a date and time for the booking."
                    else -> "Couldn't convert it. Try again."
                }, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(enabled = !vm.busy, onClick = {
                val d = date; val t = time
                if (create && !linked && (d == null || t == null)) { err = "pick"; return@TextButton }
                val b = if (create && !linked && d != null && t != null) org.json.JSONObject().put("date", d.toString())
                    .put("time", String.format("%02d:%02d", t.hour, t.minute)).put("duration", duration.toIntOrNull() ?: 60)
                    .put("location", location.trim()).put("force", force) else null
                vm.convertEstimate(e.row, b, onError = { err = it }) { r -> onDone(r) }
            }) { Text("Convert") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}
