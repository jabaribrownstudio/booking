package com.jabaribrownstudio.admin

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.jabaribrownstudio.admin.widget.BookingsWidget
import java.time.LocalDateTime
import java.util.concurrent.TimeUnit

object Sync {
    /** The bookings that belong on the widget: not cancelled, not finished yet, soonest first. */
    fun upcoming(all: List<Booking>, now: LocalDateTime = LocalDateTime.now()): List<Booking> =
        all.filter { it.isActive && (it.endDateTime ?: it.startDateTime)?.isAfter(now) == true }
            .sortedBy { it.startDateTime }

    /** Fetches the list, updates the widget cache and redraws the widget. Returns the data, or null if it failed. */
    suspend fun refresh(context: Context): AdminData? {
        val store = Store(context)
        if (!store.signedIn) { BookingsWidget().updateAll(context); return null }
        return try {
            val r = Backend(store).call("admin_list")
            if (!r.ok) { BookingsWidget().updateAll(context); return null }
            val data = parseAdminData(r.json)
            store.saveWidget(upcoming(data.bookings).take(40), data.me.name)
            Notify.check(context, store, data.bookings)
            BookingsWidget().updateAll(context)
            data
        } catch (e: Exception) { null }
    }

    fun schedule(context: Context) {
        val req = PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("refresh", ExistingPeriodicWorkPolicy.UPDATE, req)
    }
}

class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        Sync.refresh(applicationContext)
        return Result.success()
    }
}
