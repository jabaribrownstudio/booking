package com.jabaribrownstudio.admin

import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier

class MainActivity : FragmentActivity() {
    private val vm: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        vm.askBio = { ok -> promptBio(ok) }
        vm.bioAvailable = canBio()
        handleIntent(intent)
        setContent {
            StudioTheme {
                Surface(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), color = MaterialTheme.colorScheme.background) {
                    when {
                        !vm.signedIn -> SignInScreen(vm)
                        vm.locked -> LockScreen(vm)
                        vm.mustChange -> ChangePasswordScreen(vm)
                        else -> HomeScreen(vm)
                    }
                    if (vm.signedIn && !vm.mustChange && !vm.locked && vm.bioAvailable && !vm.bioLock && !vm.bioAsked) androidx.compose.material3.AlertDialog(
                        onDismissRequest = { vm.declineBio() },
                        title = { androidx.compose.material3.Text("Use your fingerprint?") },
                        text = { androidx.compose.material3.Text("Open the app with your fingerprint or face (or your screen lock) instead of signing in again. You can change this in Account.") },
                        confirmButton = { androidx.compose.material3.TextButton(onClick = { vm.enableBio() }) { androidx.compose.material3.Text("Turn on") } },
                        dismissButton = { androidx.compose.material3.TextButton(onClick = { vm.declineBio() }) { androidx.compose.material3.Text("Not now") } }
                    )
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

    private val BIO = BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    private fun canBio(): Boolean = try { BiometricManager.from(this).canAuthenticate(BIO) == BiometricManager.BIOMETRIC_SUCCESS } catch (e: Exception) { false }

    private fun promptBio(onOk: () -> Unit) {
        if (!canBio()) { vm.message = "Set up a fingerprint or screen lock in your phone's settings first."; return }
        val info = BiometricPrompt.PromptInfo.Builder().setTitle("JB Studio Admin").setSubtitle("Confirm it's you").setAllowedAuthenticators(BIO).build()
        BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { onOk() }
        }).authenticate(info)
    }

    private var stoppedAt = 0L
    override fun onStop() { super.onStop(); stoppedAt = System.currentTimeMillis() }
    override fun onDestroy() { super.onDestroy(); vm.askBio = null }

    private val askNotify = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    private var asked = false

    override fun onResume() {
        super.onResume()
        vm.bioAvailable = canBio()
        // Lock again if the app was away for more than half a minute.
        if (vm.signedIn && vm.bioLock && !vm.locked && stoppedAt > 0 && System.currentTimeMillis() - stoppedAt > 30000) vm.locked = true
        if (vm.signedIn && !vm.mustChange) vm.refreshIfStale()
        if (vm.signedIn && !asked && !Notify.allowed(this)) { asked = true; askNotify.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
    }
}
