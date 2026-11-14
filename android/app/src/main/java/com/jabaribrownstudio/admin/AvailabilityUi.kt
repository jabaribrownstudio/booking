package com.jabaribrownstudio.admin

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.LocalTime

private val DAYS = listOf(1 to "Monday", 2 to "Tuesday", 3 to "Wednesday", 4 to "Thursday", 5 to "Friday", 6 to "Saturday", 0 to "Sunday")

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surface).padding(16.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        content()
    }
}

@Composable
fun AvailabilityTab(vm: MainViewModel, pad: PaddingValues) {
    val ctx = LocalContext.current
    val d = vm.data
    LazyColumn(
        Modifier.fillMaxSize().padding(pad), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Text("Availability", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 8.dp))
            Text("What clients can book on your website.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            Section("Weekly hours") {
                DAYS.forEach { (dow, label) ->
                    val list = vm.hoursDraft[dow] ?: emptyList()
                    Column(Modifier.padding(vertical = 6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(100.dp))
                            if (list.isEmpty()) Text("Closed", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            else Spacer(Modifier.weight(1f))
                            TextButton(onClick = { vm.editHours(dow, list + Pair("09:00", "17:00")) }) { Text("Add") }
                        }
                        list.forEachIndexed { i, w ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 8.dp)) {
                                OutlinedButton(onClick = { pickTime(ctx, w.first) { t -> vm.editHours(dow, list.toMutableList().also { it[i] = Pair(t, w.second) }) } }) { Text(Fmt.time(w.first)) }
                                Text("  to  ")
                                OutlinedButton(onClick = { pickTime(ctx, w.second) { t -> vm.editHours(dow, list.toMutableList().also { it[i] = Pair(w.first, t) }) } }) { Text(Fmt.time(w.second)) }
                                IconButton(onClick = { vm.editHours(dow, list.toMutableList().also { it.removeAt(i) }) }) { Icon(Icons.Outlined.Close, "Remove") }
                            }
                        }
                    }
                }
                if (vm.hoursDirty) {
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { vm.saveHours() }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Save weekly hours") }
                }
            }
        }
        item { TimeOffSection(vm, d?.off ?: emptyList()) }
        item { SettingsSection(vm, d?.settings) }
    }
}

private fun pickTime(ctx: android.content.Context, current: String, onPick: (String) -> Unit) {
    val t = parseTime(current) ?: LocalTime.of(9, 0)
    TimePickerDialog(ctx, { _, h, m -> onPick(String.format("%02d:%02d", h, m)) }, t.hour, t.minute, false).show()
}

@Composable
private fun TimeOffSection(vm: MainViewModel, off: List<OffDay>) {
    val ctx = LocalContext.current
    var adding by remember { mutableStateOf(false) }
    Section("Time off") {
        if (off.isEmpty()) Text("No days blocked.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        off.forEach { o ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                Column(Modifier.weight(1f)) {
                    val a = try { Fmt.day(LocalDate.parse(o.date)) } catch (e: Exception) { o.date }
                    val b = if (o.through.isNotBlank()) " – " + (try { Fmt.day(LocalDate.parse(o.through)) } catch (e: Exception) { o.through }) else ""
                    Text(a + b, style = MaterialTheme.typography.titleMedium)
                    if (o.note.isNotBlank()) Text(o.note, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { vm.removeOff(o.row) }) { Icon(Icons.Outlined.Close, "Remove") }
            }
        }
        Spacer(Modifier.height(6.dp))
        OutlinedButton(onClick = { adding = true }, modifier = Modifier.fillMaxWidth()) { Text("Block off days") }
    }
    if (adding) {
        var from by remember { mutableStateOf<LocalDate?>(null) }
        var to by remember { mutableStateOf<LocalDate?>(null) }
        var note by remember { mutableStateOf("") }
        fun pickDate(cur: LocalDate?, set: (LocalDate) -> Unit) {
            val d = cur ?: LocalDate.now()
            DatePickerDialog(ctx, { _, y, m, day -> set(LocalDate.of(y, m + 1, day)) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
        }
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("Block off days") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { pickDate(from) { from = it } }, modifier = Modifier.fillMaxWidth()) { Text(from?.toString() ?: "First day") }
                    OutlinedButton(onClick = { pickDate(to ?: from) { to = it } }, modifier = Modifier.fillMaxWidth()) { Text(to?.toString() ?: "Last day (optional)") }
                    OutlinedTextField(note, { note = it }, label = { Text("Note (optional)") }, singleLine = true)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val f = from
                    if (f != null) { vm.addOff(f.toString(), to?.takeIf { !it.isBefore(f) && it != f }?.toString() ?: "", note); adding = false }
                }) { Text("Block") }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun SettingsSection(vm: MainViewModel, s: Settings?) {
    if (s == null) return
    var interval by remember(s) { mutableStateOf(s.slotInterval.toString()) }
    var buffer by remember(s) { mutableStateOf(s.bufferMinutes.toString()) }
    var notice by remember(s) { mutableStateOf(s.minNoticeHours.toString()) }
    var ahead by remember(s) { mutableStateOf(s.maxDaysAhead.toString()) }
    val num = KeyboardOptions(keyboardType = KeyboardType.Number)
    Section("Booking rules") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(interval, { interval = it.filter { c -> c.isDigit() } }, label = { Text("Start times every (minutes)") }, singleLine = true, keyboardOptions = num, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(buffer, { buffer = it.filter { c -> c.isDigit() } }, label = { Text("Gap between sessions (minutes)") }, singleLine = true, keyboardOptions = num, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notice, { notice = it.filter { c -> c.isDigit() } }, label = { Text("Minimum notice (hours)") }, singleLine = true, keyboardOptions = num, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(ahead, { ahead = it.filter { c -> c.isDigit() } }, label = { Text("Bookable days ahead") }, singleLine = true, keyboardOptions = num, modifier = Modifier.fillMaxWidth())
            Button(
                onClick = { vm.saveSettings(interval.toIntOrNull() ?: s.slotInterval, buffer.toIntOrNull() ?: 0, notice.toIntOrNull() ?: 0, ahead.toIntOrNull() ?: s.maxDaysAhead) },
                enabled = !vm.busy, modifier = Modifier.fillMaxWidth().height(48.dp)
            ) { Text("Save rules") }
        }
    }
}
