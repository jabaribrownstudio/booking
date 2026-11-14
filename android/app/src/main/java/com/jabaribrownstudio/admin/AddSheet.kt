package com.jabaribrownstudio.admin

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.LocalTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddBookingSheet(vm: MainViewModel, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var pkg by remember { mutableStateOf<AppConfig.Pkg?>(AppConfig.PACKAGES.first()) }
    var duration by remember { mutableStateOf(AppConfig.PACKAGES.first().minutes.toString()) }
    var price by remember { mutableStateOf(AppConfig.PACKAGES.first().price.toString()) }
    var date by remember { mutableStateOf<LocalDate?>(null) }
    var time by remember { mutableStateOf<LocalTime?>(null) }
    var status by remember { mutableStateOf("Confirmed") }
    var notify by remember { mutableStateOf(true) }
    var force by remember { mutableStateOf(false) }
    var showForce by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("New booking", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(name, { name = it }, label = { Text("Client name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(phone, { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
            OutlinedTextField(email, { email = it }, label = { Text("Email (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            Text("Package", style = MaterialTheme.typography.labelLarge)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(AppConfig.PACKAGES) { p ->
                    FilterChip(selected = pkg == p, onClick = { pkg = p; duration = p.minutes.toString(); price = p.price.toString() }, label = { Text(p.name) })
                }
                item { FilterChip(selected = pkg == null, onClick = { pkg = null }, label = { Text("Custom") }) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(duration, { duration = it.filter { c -> c.isDigit() } }, label = { Text("Minutes") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                OutlinedTextField(price, { price = it.filter { c -> c.isDigit() } }, label = { Text("Price (${AppConfig.CURRENCY})") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    modifier = Modifier.weight(1f).height(52.dp),
                    onClick = {
                        val d = date ?: LocalDate.now()
                        DatePickerDialog(ctx, { _, y, m, day -> date = LocalDate.of(y, m + 1, day) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
                    }
                ) { Text(date?.let { Fmt.day(it) + " " + it.dayOfMonth + "/" + it.monthValue } ?: "Pick date") }
                OutlinedButton(
                    modifier = Modifier.weight(1f).height(52.dp),
                    onClick = {
                        val t = time ?: LocalTime.of(10, 0)
                        TimePickerDialog(ctx, { _, h, m -> time = LocalTime.of(h, m) }, t.hour, t.minute, false).show()
                    }
                ) { Text(time?.let { Fmt.time(it) } ?: "Pick time") }
            }
            OutlinedTextField(location, { location = it }, label = { Text("Location (optional)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes (optional)") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = status == "Confirmed", onClick = { status = "Confirmed" }, label = { Text("Confirmed") })
                FilterChip(selected = status == "Pending", onClick = { status = "Pending" }, label = { Text("Pending") })
            }
            if (email.isNotBlank()) Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = notify, onCheckedChange = { notify = it })
                Text("Email the client a confirmation")
            }
            if (showForce) Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = force, onCheckedChange = { force = it })
                Text("Book it anyway (overlaps another booking)")
            }
            if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
            Button(
                enabled = !vm.busy, modifier = Modifier.fillMaxWidth().height(52.dp),
                onClick = {
                    val d = date; val t = time; val mins = duration.toIntOrNull() ?: 0
                    err = when {
                        name.isBlank() -> "Enter the client's name."
                        d == null || t == null -> "Choose a date and start time."
                        mins < 5 -> "Enter the session length in minutes."
                        else -> ""
                    }
                    if (err.isEmpty() && d != null && t != null) {
                        vm.addBooking(
                            MainViewModel.NewBooking(
                                name.trim(), phone.trim(), email.trim(), location.trim(), notes.trim(), d.toString(), String.format("%02d:%02d", t.hour, t.minute),
                                mins, pkg?.name ?: "Custom session", price, status, notify && email.isNotBlank(), force
                            )
                        ) { e ->
                            when (e) {
                                null -> onClose()
                                "slot_taken" -> { err = "That time overlaps another booking (or its buffer)."; showForce = true }
                                "invalid_input" -> err = "Check the details. The email address may be wrong."
                                else -> err = "Couldn't add the booking. Try again."
                            }
                        }
                    }
                }
            ) {
                if (vm.busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp, color = MaterialTheme.colorScheme.onPrimary) else Text("Add booking")
            }
            Spacer(Modifier.height(4.dp))
        }
    }
}
