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
