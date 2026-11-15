package com.jabaribrownstudio.admin

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun SignInScreen(vm: MainViewModel) {
    var user by remember { mutableStateOf(vm.username) }
    var secret by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))
        Image(
            painter = painterResource(if (isSystemInDarkTheme()) R.drawable.logo_white else R.drawable.logo),
            contentDescription = AppConfig.BUSINESS,
            modifier = Modifier.fillMaxWidth(0.7f).aspectRatio(462f / 224f), contentScale = ContentScale.Fit
        )
        Spacer(Modifier.height(20.dp))
        Text(
            "Sign in to manage bookings and your availability.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp, bottom = 24.dp)
        )
        OutlinedTextField(
            value = user, onValueChange = { user = it }, label = { Text("Username") }, singleLine = true,
            modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = secret, onValueChange = { secret = it }, label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
        )
        if (vm.loginError.isNotEmpty()) {
            Text(vm.loginError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp).fillMaxWidth())
        }
        Spacer(Modifier.height(18.dp))
        Button(
            onClick = { vm.signIn(false, vm.scriptUrl, vm.workerUrl, user, secret) },
            enabled = !vm.busy, modifier = Modifier.fillMaxWidth().height(52.dp)
        ) {
            if (vm.busy) CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.5.dp, color = MaterialTheme.colorScheme.onPrimary)
            else Text("Sign in")
        }
    }
}

@Composable
fun ChangePasswordScreen(vm: MainViewModel) {
    var cur by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(48.dp))
        Text("Choose a new password", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Your account was set up with a temporary password. Pick one only you know.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp, bottom = 20.dp)
        )
        val pw = PasswordVisualTransformation()
        OutlinedTextField(value = cur, onValueChange = { cur = it }, label = { Text("Current (temporary) password") }, singleLine = true, visualTransformation = pw, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(value = new, onValueChange = { new = it }, label = { Text("New password (at least 8 characters)") }, singleLine = true, visualTransformation = pw, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(value = again, onValueChange = { again = it }, label = { Text("New password again") }, singleLine = true, visualTransformation = pw, modifier = Modifier.fillMaxWidth())
        if (err.isNotEmpty()) Text(err, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 10.dp).fillMaxWidth())
        Spacer(Modifier.height(18.dp))
        Button(
            enabled = !vm.busy, modifier = Modifier.fillMaxWidth().height(52.dp),
            onClick = {
                err = when {
                    cur.isEmpty() -> "Enter your current password."
                    new.length < 8 -> "The new password needs at least 8 characters."
                    vm.username.isNotEmpty() && new.lowercase().contains(vm.username.lowercase()) -> "The password can't contain your username."
                    new != again -> "The two new passwords don't match."
                    new == cur -> "Choose a password different from the temporary one."
                    else -> ""
                }
                if (err.isEmpty()) vm.changePassword(cur, new) { e -> if (e != null) err = "That didn't work. Check the current password and try again." }
            }
        ) { Text("Save password") }
        TextButton(onClick = { vm.signOut() }) { Text("Sign out") }
    }
}
