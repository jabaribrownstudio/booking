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
    private const val REMINDERS = "reminders"

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "New bookings", NotificationManager.IMPORTANCE_HIGH).apply { description = "When a client books through your website" })
            }
            if (nm.getNotificationChannel(REMINDERS) == null) {
                nm.createNotificationChannel(NotificationChannel(REMINDERS, "Appointment reminders", NotificationManager.IMPORTANCE_HIGH).apply { description = "Shortly before a confirmed appointment starts" })
            }
        }
    }

    fun allowed(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Tells the owner about bookings that arrived since the last check. The first check only remembers what is already there. */
    fun check(ctx: Context, store: Store, bookings: List<Booking>) {
        val seen = store.seenRows()
        store.setSeenRows(bookings.map { it.row })
        if (!allowed(ctx)) return
        remind(ctx, store, bookings)
        if (seen == null) return
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

    /** Shows an alert straight from an instant (push) message, and remembers the row so the 15-minute check doesn't repeat it. */
    fun fromPush(ctx: Context, store: Store, d: Map<String, String>) {
        val row = d["row"]?.toIntOrNull() ?: return
        store.seenRows()?.let { store.setSeenRows(it + row) }
        if (!allowed(ctx)) return
        ensureChannel(ctx)
        val open = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("bookingRow", row)
        }
        val pi = PendingIntent.getActivity(ctx, row, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val text = listOf(d["pkg"] ?: "", d["when"] ?: "").filter { it.isNotBlank() }.joinToString(" · ")
        val n = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(d["title"] ?: "New booking").setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        try { NotificationManagerCompat.from(ctx).notify(row, n) } catch (e: SecurityException) { }
    }

    /** Reminds about confirmed appointments that start within the next hour (checked every ~15 minutes). */
    private fun remind(ctx: Context, store: Store, bookings: List<Booking>) {
        val now = java.time.LocalDateTime.now()
        val done = store.remindedRows().toMutableSet()
        val due = bookings.filter { b ->
            val st = b.startDateTime
            b.isActive && b.status.equals("Confirmed", true) && b.row !in done && st != null &&
                st.isAfter(now.minusMinutes(5)) && st.isBefore(now.plusMinutes(65))
        }
        if (due.isEmpty()) return
        ensureChannel(ctx)
        val nm = NotificationManagerCompat.from(ctx)
        due.take(5).forEach { b ->
            val mins = java.time.Duration.between(now, b.startDateTime).toMinutes().coerceAtLeast(0)
            val open = Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("bookingRow", b.row)
            }
            val pi = PendingIntent.getActivity(ctx, 100000 + b.row, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val text = listOf(b.pkg, Fmt.time(b.start), b.location).filter { it.isNotBlank() }.joinToString(" · ")
            val n = NotificationCompat.Builder(ctx, REMINDERS).setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(b.name + (if (mins <= 1) " is starting now" else " starts in about $mins min"))
                .setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(pi).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
            try { nm.notify(100000 + b.row, n) } catch (e: SecurityException) { }
        }
        done.addAll(due.map { it.row })
        store.setRemindedRows(done.toList().takeLast(300))
    }

    /** Sends a test notification so the owner can confirm alerts reach this phone. */
    fun test(ctx: Context): Boolean {
        if (!allowed(ctx)) return false
        ensureChannel(ctx)
        val pi = PendingIntent.getActivity(ctx, 99, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Notifications are working").setContentText("You will be alerted about new bookings and upcoming appointments.")
            .setContentIntent(pi).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        return try { NotificationManagerCompat.from(ctx).notify(99, n); NotificationManagerCompat.from(ctx).areNotificationsEnabled() } catch (e: SecurityException) { false }
    }
}
