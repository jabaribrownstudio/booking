package com.jabaribrownstudio.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamSheet(vm: MainViewModel, onClose: () -> Unit) {
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<TeamMember?>(null) }
    LaunchedEffect(Unit) { vm.loadTeam() }
    val dark = isSystemInDarkTheme()

    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Team", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Button(onClick = { adding = true }) { Text("Add member") }
            }
            if (vm.team.isEmpty()) Text(if (vm.teamLoading) "Loading…" else "No team members yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            vm.team.forEach { m ->
                var menu by remember { mutableStateOf(false) }
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.name, style = MaterialTheme.typography.titleMedium)
                            Text(
                                listOf(m.role, if (m.username.isNotBlank()) "@" + m.username else "", if (!m.active) "locked out" else if (m.mustChange) "hasn't signed in yet" else "").filter { it.isNotBlank() }.joinToString(" · "),
                                style = MaterialTheme.typography.bodyMedium, color = if (!m.active) StatusColors.fg("Pending", dark) else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (m.role != "Owner") Box {
                            TextButton(onClick = { menu = true }) { Text("Manage") }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text(if (m.role == "Staff") "Make Manager" else "Make Staff") }, onClick = { menu = false; vm.setRole(m, if (m.role == "Staff") "Manager" else "Staff") })
                                DropdownMenuItem(text = { Text(if (m.active) "Lock out" else "Let them sign in again") }, onClick = { menu = false; vm.setActive(m, !m.active) })
                                DropdownMenuItem(text = { Text(if (vm.mode == "worker") "Reset password" else "New admin key") }, onClick = { menu = false; vm.resetAccess(m) })
                                DropdownMenuItem(text = { Text("Remove") }, onClick = { menu = false; removing = m })
                            }
                        }
                    }
                }
            }
            Text(
                "Staff can view and manage bookings. Managers can also change availability, settings and invoices. Only you (the Owner) can manage the team.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    if (adding) AddMemberDialog(vm) { adding = false }
    removing?.let { m ->
        AlertDialog(
            onDismissRequest = { removing = null }, title = { Text("Remove ${m.name}?") },
            text = { Text("Their sign-in stops working. Bookings they handled keep their name.") },
            confirmButton = { TextButton(onClick = { removing = null; vm.removeMember(m) }) { Text("Remove") } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Keep") } }
        )
    }
    vm.secretShown?.let { (title, secret) ->
        val clip = LocalClipboardManager.current
        AlertDialog(
            onDismissRequest = { vm.secretShown = null }, title = { Text(title) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Copy this now and send it to them privately. It won't be shown again.", style = MaterialTheme.typography.bodyMedium)
                    Text(secret, style = MaterialTheme.typography.titleMedium, modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp))
                }
            },
            confirmButton = { TextButton(onClick = { vm.secretShown = null }) { Text("Done") } },
            dismissButton = { TextButton(onClick = { clip.setText(AnnotatedString(secret)) }) { Text("Copy") } }
        )
    }
}

@Composable
private fun AddMemberDialog(vm: MainViewModel, onDismiss: () -> Unit) {
    val worker = vm.mode == "worker"
    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("Staff") }
    var err by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text("Add team member") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true)
                if (worker) {
                    OutlinedTextField(username, { username = it.lowercase().filter { c -> c.isLetterOrDigit() || c in "._-" } }, label = { Text("Username (3+ letters or numbers)") }, singleLine = true)
                    OutlinedTextField(email, { email = it }, label = { Text("Email (optional)") }, singleLine = true)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = role == "Staff", onClick = { role = "Staff" }, label = { Text("Staff") })
                    FilterChip(selected = role == "Manager", onClick = { role = "Manager" }, label = { Text("Manager") })
                }
                if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(enabled = !vm.busy, onClick = {
                err = when {
                    name.isBlank() -> "Enter their name."
                    worker && username.length < 3 -> "The username needs at least 3 characters."
                    else -> ""
                }
                if (err.isEmpty()) vm.addMember(name.trim(), username, email.trim(), role) { e ->
                    when (e) {
                        null -> onDismiss()
                        "exists" -> err = "That username or email is already used."
                        "invalid_input" -> err = "Check the details and try again."
                        else -> err = "Couldn't add them. Try again."
                    }
                }
            }) { Text("Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
