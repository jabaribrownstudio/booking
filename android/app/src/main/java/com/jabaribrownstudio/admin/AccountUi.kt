package com.jabaribrownstudio.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun AccountTab(vm: MainViewModel, pad: PaddingValues) {
    val me = vm.data?.me
    var changing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Account", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 8.dp))
        Card2 {
            Text(me?.name?.ifBlank { null } ?: vm.username.ifBlank { "Signed in" }, style = MaterialTheme.typography.titleLarge)
            Text(me?.role ?: "", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            Text(if (vm.mode == "worker") "Signed in with a username" else "Signed in with the admin key", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Card2 {
            Text("Home-screen widget", style = MaterialTheme.typography.titleMedium)
            Text(
                "Press and hold an empty spot on your home screen, tap Widgets, find Studio Admin and drag “Upcoming” onto the screen. Resize it to show more appointments. It refreshes about every 30 minutes and whenever you open the app.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (vm.mode == "worker") OutlinedButton(onClick = { changing = true }, modifier = Modifier.fillMaxWidth().height(50.dp)) { Text("Change password") }
        OutlinedButton(onClick = { vm.signOut() }, modifier = Modifier.fillMaxWidth().height(50.dp)) { Text("Sign out") }
        Text("Team accounts are managed in the web admin app.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (changing) {
        var cur by remember { mutableStateOf("") }
        var new by remember { mutableStateOf("") }
        var err by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { changing = false },
            title = { Text("Change password") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(cur, { cur = it }, label = { Text("Current password") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                    OutlinedTextField(new, { new = it }, label = { Text("New password (8+ characters)") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                    if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (new.length < 8 || cur.isEmpty()) err = "Enter your current password and a new one of 8+ characters."
                    else vm.changePassword(cur, new) { e -> if (e == null) changing = false else err = "That didn't work. Check the current password." }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { changing = false }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun Card2(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
}
