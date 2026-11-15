package com.jabaribrownstudio.admin

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

@Composable
fun HomeScreen(vm: MainViewModel) {
    var tab by remember { mutableIntStateOf(0) }
    val snack = remember { SnackbarHostState() }
    val canManage = vm.data?.me?.isManager == true
    val msg = vm.message
    LaunchedEffect(msg) {
        if (msg != null) { snack.showSnackbar(msg); vm.clearMessage() }
    }
    if (!canManage && (tab == 1 || tab == 3)) tab = 0
    LaunchedEffect(vm.openAdd, vm.focusRow) { if (vm.openAdd || vm.focusRow > 0) tab = 0 }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                NavigationBarItem(selected = tab == 0, onClick = { tab = 0 }, icon = { Icon(Icons.Outlined.CalendarMonth, null) }, label = { Text("Bookings") })
                if (canManage) NavigationBarItem(selected = tab == 3, onClick = { tab = 3 }, icon = { Icon(Icons.Outlined.Receipt, null) }, label = { Text("Invoices") })
                if (canManage) NavigationBarItem(selected = tab == 1, onClick = { tab = 1 }, icon = { Icon(Icons.Outlined.EventAvailable, null) }, label = { Text("Availability") })
                NavigationBarItem(selected = tab == 2, onClick = { tab = 2 }, icon = { Icon(Icons.Outlined.Person, null) }, label = { Text("Account") })
            }
        }
    ) { pad: PaddingValues ->
        when (tab) {
            0 -> BookingsTab(vm, pad)
            1 -> AvailabilityTab(vm, pad)
            3 -> InvoicesTab(vm, pad)
            else -> AccountTab(vm, pad)
        }
    }
}
