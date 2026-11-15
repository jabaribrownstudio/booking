package com.jabaribrownstudio.admin

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.produceState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.LocalDateTime

private val FILTERS = listOf("Upcoming", "Pending", "Past", "Cancelled")

private fun filtered(all: List<Booking>, f: String): List<Booking> {
    val now = LocalDateTime.now()
    fun over(b: Booking) = (b.endDateTime ?: b.startDateTime)?.isBefore(now) == true
    return when (f) {
        "Upcoming" -> all.filter { it.isActive && !over(it) }.sortedBy { it.startDateTime }
        "Pending" -> all.filter { it.status == "Pending" && !over(it) }.sortedBy { it.startDateTime }
        "Past" -> all.filter { it.isActive && over(it) }.sortedByDescending { it.startDateTime }
        else -> all.filter { !it.isActive }.sortedByDescending { it.startDateTime }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookingsTab(vm: MainViewModel, pad: PaddingValues) {
    val d = vm.data
    var showAdd by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf<Booking?>(null) }
    Box(Modifier.fillMaxSize().padding(pad)) {
        PullToRefreshBox(isRefreshing = vm.loading, onRefresh = { vm.load() }, modifier = Modifier.fillMaxSize()) {
            val all = d?.bookings ?: emptyList()
            // Sorting, grouping and counting only re-run when the data or filter changes, not on every redraw.
            val list by produceState(emptyList<Booking>(), all, vm.filter) { value = withContext(Dispatchers.Default) { filtered(all, vm.filter) } }
            val groups = remember(list) { list.groupBy { it.date } }
            val stats by produceState(Triple(0, 0, 0), all) {
                value = withContext(Dispatchers.Default) {
                    val today = LocalDate.now(); val now = LocalDateTime.now()
                    Triple(
                        all.count { it.isActive && it.localDate == today && (it.endDateTime ?: it.startDateTime)?.isAfter(now) == true },
                        all.count { b -> b.isActive && b.localDate.let { it != null && !it.isBefore(today) && !it.isAfter(today.plusDays(29)) } },
                        filtered(all, "Pending").size
                    )
                }
            }
            val (todayN, weekN, pendN) = stats
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 96.dp)) {
                item {
                    Text(
                        (if (d != null && d.me.name.isNotBlank()) "Hi, " + d.me.name.split(" ")[0] else "Bookings"),
                        style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 8.dp)
                    )
                    Text(AppConfig.BUSINESS, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                        Stat("Today", todayN, Modifier.weight(1f))
                        Stat("Next 30 days", weekN, Modifier.weight(1f))
                        Stat("Pending", pendN, Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(14.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(FILTERS) { f -> FilterChip(selected = vm.filter == f, onClick = { vm.filter = f; vm.openRow = -1 }, label = { Text(f) }) }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                if (d == null) {
                    item { Text(if (vm.loading) "Loading…" else "Pull down to load your bookings.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
                } else if (list.isEmpty()) {
                    item { Text("Nothing here.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
                } else {
                    groups.forEach { (date, bs) ->
                        item(key = "h$date") {
                            Text(
                                Fmt.longDay(bs.first().localDate), style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 14.dp, bottom = 6.dp)
                            )
                        }
                        items(bs, key = { it.row }) { b ->
                            BookingCard(b, expanded = vm.openRow == b.row, onToggle = { vm.openRow = if (vm.openRow == b.row) -1 else b.row }, onStatus = { s, note -> if (s == "Confirmed" && d?.me?.isManager == true) confirming = b else vm.setStatus(b.row, s, comment = note) }, onRemind = { vm.remindBooking(b.row) })
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                    if (d.truncated && !vm.showingAll && vm.filter == "Past") item(key = "older") {
                        androidx.compose.material3.TextButton(onClick = { vm.loadOlder() }, modifier = Modifier.fillMaxWidth()) { Text("Load older bookings") }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { showAdd = true },
            icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Add booking") },
            containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp)
        )
    }
    if (showAdd) AddBookingSheet(vm, onClose = { showAdd = false })
    confirming?.let { ConfirmBookingDialog(vm, it) { confirming = null } }
    LaunchedEffect(vm.openAdd) { if (vm.openAdd) { showAdd = true; vm.openAdd = false } }
    val focus = d?.bookings?.firstOrNull { it.row == vm.focusRow }
    if (focus != null) {
        ModalBottomSheet(onDismissRequest = { vm.focusRow = -1 }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.background) {
            Column(Modifier.navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 20.dp)) {
                Text(Fmt.longDay(focus.localDate), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
                BookingCard(focus, expanded = true, onToggle = { }, onStatus = { s, note ->
                    vm.focusRow = -1
                    if (s == "Confirmed" && d?.me?.isManager == true) confirming = focus else vm.setStatus(focus.row, s, comment = note)
                }, onRemind = { vm.remindBooking(focus.row) })
            }
        }
    }
}

@Composable
private fun Stat(label: String, n: Int, modifier: Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface).padding(horizontal = 14.dp, vertical = 12.dp)
    ) {
        Text(n.toString(), style = MaterialTheme.typography.titleLarge)
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun StatusPill(status: String) {
    val dark = isSystemInDarkTheme()
    Text(
        status, style = MaterialTheme.typography.labelMedium, color = StatusColors.fg(status, dark),
        modifier = Modifier.clip(RoundedCornerShape(50)).background(StatusColors.bg(status, dark)).padding(horizontal = 10.dp, vertical = 4.dp)
    )
}

@Composable
private fun BookingCard(b: Booking, expanded: Boolean, onToggle: () -> Unit, onStatus: (String, String) -> Unit, onRemind: () -> Unit = {}) {
    val ctx = LocalContext.current
    var confirmCancel by remember { mutableStateOf(false) }
    var cancelNote by remember { mutableStateOf("") }
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth().animateContentSize().clickable { onToggle() }
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.width(78.dp)) {
                    Text(Fmt.time(b.start), style = MaterialTheme.typography.titleMedium)
                    Text(Fmt.time(b.end), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Column(Modifier.weight(1f)) {
                    Text(b.name, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text(
                        listOf(b.pkg, if (b.duration > 0) "${b.duration} min" else "").filter { it.isNotBlank() }.joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1
                    )
                }
                StatusPill(b.status)
            }
            if (expanded) {
                Spacer(Modifier.height(14.dp))
                Detail("Price", Fmt.money(b.price))
                Detail("Phone", b.phone)
                Detail("Email", b.email)
                Detail("Instagram", b.instagram)
                Detail("Location", b.location)
                Detail("Notes", b.notes)
                Detail("Handled by", b.handledBy)
                Spacer(Modifier.height(10.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (b.phone.isNotBlank()) {
                        item { Contact("Call", Icons.Outlined.Call) { open(ctx, Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + b.phone.filter { c -> c.isDigit() || c == '+' }))) } }
                        item { Contact("WhatsApp", Icons.Outlined.Chat) { open(ctx, Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + waNumber(b.phone)))) } }
                    }
                    if (b.email.isNotBlank()) item { Contact("Email", Icons.Outlined.Email) { open(ctx, Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + b.email))) } }
                    if (b.instagram.isNotBlank()) item { Contact("Instagram", Icons.Outlined.PhotoCamera) { open(ctx, Intent(Intent.ACTION_VIEW, Uri.parse("https://instagram.com/" + b.instagram.trim().trimStart('@').substringAfterLast('/')))) } }
                }
                if (b.isActive && b.email.isNotBlank()) {
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(onClick = onRemind, modifier = Modifier.fillMaxWidth()) { Text("Send reminder to client") }
                    if (b.status == "Confirmed") Text("The client is also reminded automatically the day before.", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (b.status != "Confirmed") Button(onClick = { onStatus("Confirmed", "") }, modifier = Modifier.weight(1f)) { Text("Confirm") }
                    if (b.status != "Pending") OutlinedButton(onClick = { onStatus("Pending", "") }, modifier = Modifier.weight(1f)) { Text("Set pending") }
                    if (b.status != "Cancelled") OutlinedButton(
                        onClick = { confirmCancel = true }, modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f))
                    ) { Text("Cancel") }
                }
            }
        }
    }
    if (confirmCancel) androidx.compose.material3.AlertDialog(
        onDismissRequest = { confirmCancel = false },
        title = { Text("Cancel this booking?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${b.name}'s time will open up again for other clients.")
                androidx.compose.material3.OutlinedTextField(
                    cancelNote, { cancelNote = it }, label = { Text("Comment (optional)") },
                    supportingText = { Text(if (b.email.isNotBlank()) "Included in the cancellation email to the client." else "Saved in the booking's notes.") },
                    modifier = Modifier.fillMaxWidth(), minLines = 2
                )
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(onClick = { confirmCancel = false; onStatus("Cancelled", cancelNote); cancelNote = "" }) { Text("Cancel booking") } },
        dismissButton = { androidx.compose.material3.TextButton(onClick = { confirmCancel = false }) { Text("Keep it") } }
    )
}

@Composable
private fun Detail(label: String, value: String) {
    if (value.isBlank()) return
    Row(Modifier.padding(vertical = 3.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(92.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun Contact(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)) {
        Icon(icon, null, Modifier.width(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(label)
    }
}

private fun waNumber(p: String): String {
    val d = p.filter { it.isDigit() }
    return when {
        d.length == 7 -> "1876$d"
        d.length == 10 -> "1$d"
        else -> d
    }
}

private fun open(ctx: Context, i: Intent) {
    try { ctx.startActivity(i) } catch (e: Exception) { }
}
