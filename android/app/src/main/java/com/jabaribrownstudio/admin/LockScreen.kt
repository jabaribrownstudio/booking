package com.jabaribrownstudio.admin

import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp

/** Shown when the app is locked. It asks for a fingerprint / face / screen lock straight away. */
@Composable
fun LockScreen(vm: MainViewModel) {
    LaunchedEffect(Unit) { vm.unlock() }
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
    ) {
        Image(
            painter = painterResource(if (isSystemInDarkTheme()) R.drawable.logo_white else R.drawable.logo),
            contentDescription = AppConfig.BUSINESS,
            modifier = Modifier.fillMaxWidth(0.7f).aspectRatio(462f / 224f), contentScale = ContentScale.Fit
        )
        Spacer(Modifier.height(24.dp))
        Text("Locked", style = MaterialTheme.typography.titleLarge)
        Text("Use your fingerprint, face or screen lock to open the app.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp, bottom = 24.dp))
        Button(onClick = { vm.unlock() }, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Unlock") }
        TextButton(onClick = { vm.signOut() }, modifier = Modifier.padding(top = 8.dp)) { Text("Sign out") }
    }
}
