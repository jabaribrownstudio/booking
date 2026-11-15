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

    override fun onResume() {
        super.onResume()
        if (vm.signedIn && !vm.mustChange) vm.refreshIfStale()
    }
}
