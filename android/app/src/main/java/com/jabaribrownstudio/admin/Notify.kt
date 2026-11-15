package com.jabaribrownstudio.admin

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Notify {
    private const val CHANNEL = "bookings"

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "New bookings", NotificationManager.IMPORTANCE_HIGH).apply { description = "When a client books through your website" })
            }
        }
    }

    fun allowed(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Tells the owner about bookings that arrived since the last check. The first check only remembers what is already there. */
    fun check(ctx: Context, store: Store, bookings: List<Booking>) {
        val seen = store.seenRows()
        store.setSeenRows(bookings.map { it.row })
        if (seen == null || !allowed(ctx)) return
        val fresh = bookings.filter { it.row !in seen && it.source != "Admin app" && it.isActive }.sortedBy { it.startDateTime }
        if (fresh.isEmpty()) return
        ensureChannel(ctx)
        val nm = NotificationManagerCompat.from(ctx)
        fresh.take(5).forEach { b ->
            val open = Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("bookingRow", b.row)
            }
            val pi = PendingIntent.getActivity(ctx, b.row, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val text = listOf(b.pkg, Fmt.day(b.localDate) + " " + Fmt.time(b.start)).filter { it.isNotBlank() }.joinToString(" · ")
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("New booking: " + b.name)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text + (if (b.notes.isNotBlank()) "\n" + b.notes else "")))
                .setContentIntent(pi).setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            try { nm.notify(b.row, n) } catch (e: SecurityException) { }
        }
        if (fresh.size > 5) {
            val n = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("${fresh.size - 5} more new bookings").setAutoCancel(true).build()
            try { nm.notify(0, n) } catch (e: SecurityException) { }
        }
    }
}
