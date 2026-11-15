package com.jabaribrownstudio.admin

import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

object Fmt {
    private val timeFmt = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    private val dayFmt = DateTimeFormatter.ofPattern("EEE d MMM", Locale.US)
    private val longDayFmt = DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.US)

    fun time(t: LocalTime?): String = t?.format(timeFmt)?.replace("AM", "am")?.replace("PM", "pm") ?: ""
    fun time(s: String): String = time(parseTime(s))

    fun day(d: LocalDate?): String {
        if (d == null) return ""
        val today = LocalDate.now()
        return when (d) {
            today -> "Today"
            today.plusDays(1) -> "Tomorrow"
            today.minusDays(1) -> "Yesterday"
            else -> d.format(dayFmt)
        }
    }

    fun longDay(d: LocalDate?): String {
        if (d == null) return ""
        val today = LocalDate.now()
        return when (d) {
            today -> "Today · " + d.format(DateTimeFormatter.ofPattern("d MMM", Locale.US))
            today.plusDays(1) -> "Tomorrow · " + d.format(DateTimeFormatter.ofPattern("d MMM", Locale.US))
            else -> d.format(longDayFmt)
        }
    }

    fun range(start: String, end: String): String {
        val a = time(start); val b = time(end)
        return if (b.isEmpty()) a else "$a – $b"
    }

    fun money(price: String): String {
        if (price.isBlank()) return ""
        val n = price.replace(",", "").toDoubleOrNull() ?: return price
        return AppConfig.CURRENCY + String.format(Locale.US, "%,.0f", n)
    }

    fun cash(n: Double): String {
        val neg = n < 0
        val s = String.format(Locale.US, "%,.2f", Math.abs(n))
        return (if (neg) "-" else "") + AppConfig.CURRENCY + s
    }

    fun cashShort(n: Double): String = AppConfig.CURRENCY + String.format(Locale.US, "%,.0f", n)

    fun date(s: String): String = try { LocalDate.parse(s).format(DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)) } catch (e: Exception) { s }
}
