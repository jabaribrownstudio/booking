package com.jabaribrownstudio.admin

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleIntent(intent)
        setContent {
            StudioTheme {
                Surface(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), color = MaterialTheme.colorScheme.background) {
                    when {
                        !vm.signedIn -> SignInScreen(vm)
                        vm.mustChange -> ChangePasswordScreen(vm)
                        else -> HomeScreen(vm)
                    }
                    if (vm.updateAvailable) androidx.compose.material3.AlertDialog(
                        onDismissRequest = { vm.updateAvailable = false },
                        title = { androidx.compose.material3.Text("Update available") },
                        text = { androidx.compose.material3.Text("A newer version of JB Studio Admin is ready. Open the download page to get it, then install it over this one.") },
                        confirmButton = {
                            androidx.compose.material3.TextButton(onClick = {
                                vm.updateAvailable = false
                                try { startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(vm.releasePage))) } catch (e: Exception) { }
                            }) { androidx.compose.material3.Text("Update") }
                        },
                        dismissButton = { androidx.compose.material3.TextButton(onClick = { vm.updateAvailable = false }) { androidx.compose.material3.Text("Later") } }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: android.content.Intent?) {
        if (i == null) return
        if (i.getStringExtra("openAdd") != null) vm.openAdd = true
        val row = i.getIntExtra("bookingRow", -1)
        if (row > 0) vm.focusRow = row
        i.removeExtra("openAdd"); i.removeExtra("bookingRow")
    }

    private val askNotify = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    private var asked = false

    override fun onResume() {
        super.onResume()
        if (vm.signedIn && !vm.mustChange) vm.refreshIfStale()
        if (vm.signedIn && !asked && !Notify.allowed(this)) { asked = true; askNotify.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
    }
}
