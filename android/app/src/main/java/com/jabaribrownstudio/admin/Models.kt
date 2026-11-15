package com.jabaribrownstudio.admin

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

data class Booking(
    val row: Int,
    val status: String,
    val name: String,
    val email: String,
    val phone: String,
    val instagram: String,
    val pkg: String,
    val price: String,
    val date: String,
    val start: String,
    val end: String,
    val duration: Int,
    val location: String,
    val notes: String,
    val handledBy: String
) {
    val localDate: LocalDate? get() = try { LocalDate.parse(date) } catch (e: Exception) { null }
    val startTime: LocalTime? get() = parseTime(start)
    val endTime: LocalTime? get() = parseTime(end)
    val startDateTime: LocalDateTime? get() {
        val d = localDate ?: return null
        return d.atTime(startTime ?: LocalTime.MIDNIGHT)
    }
    val endDateTime: LocalDateTime? get() {
        val d = localDate ?: return null
        return d.atTime(endTime ?: startTime ?: LocalTime.MIDNIGHT)
    }
    val isActive: Boolean get() = status != "Cancelled"
}

fun parseTime(s: String): LocalTime? = try {
    val p = s.trim().split(":")
    LocalTime.of(p[0].toInt(), p[1].toInt())
} catch (e: Exception) { null }

data class OffDay(val row: Int, val date: String, val through: String, val from: String, val to: String, val note: String)

data class Settings(val slotInterval: Int, val bufferMinutes: Int, val minNoticeHours: Int, val maxDaysAhead: Int)

data class Me(val name: String, val role: String) {
    val isManager get() = role == "Manager" || role == "Owner"
}

/** Weekly hours: day of week (0 = Sunday ... 6 = Saturday) to a list of "HH:mm" start/end pairs. */
typealias Hours = Map<Int, List<Pair<String, String>>>

data class AdminData(
    val bookings: List<Booking>,
    val hours: Hours,
    val off: List<OffDay>,
    val settings: Settings,
    val me: Me
)

fun parseAdminData(j: JSONObject): AdminData {
    val bs = ArrayList<Booking>()
    val arr = j.optJSONArray("bookings") ?: JSONArray()
    for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        bs.add(
            Booking(
                row = o.optInt("row"), status = o.optString("status"), name = o.optString("name"),
                email = o.optString("email"), phone = o.optString("phone"), instagram = o.optString("instagram"),
                pkg = o.optString("pkg"), price = o.optString("price"), date = o.optString("date"),
                start = o.optString("start"), end = o.optString("end"), duration = o.optInt("duration"),
                location = o.optString("location"), notes = o.optString("notes"), handledBy = o.optString("handledBy")
            )
        )
    }
    val hours = HashMap<Int, List<Pair<String, String>>>()
    val ho = j.optJSONObject("hours")
    for (d in 0..6) {
        val list = ArrayList<Pair<String, String>>()
        val wa = ho?.optJSONArray(d.toString())
        if (wa != null) for (i in 0 until wa.length()) {
            val w = wa.optJSONArray(i) ?: continue
            list.add(Pair(w.optString(0), w.optString(1)))
        }
        hours[d] = list
    }
    val off = ArrayList<OffDay>()
    val oa = j.optJSONArray("off") ?: JSONArray()
    for (i in 0 until oa.length()) {
        val o = oa.getJSONObject(i)
        off.add(OffDay(o.optInt("row"), o.optString("date"), o.optString("through"), o.optString("from"), o.optString("to"), o.optString("note")))
    }
    val so = j.optJSONObject("settings") ?: JSONObject()
    val settings = Settings(so.optInt("slotInterval", 30), so.optInt("bufferMinutes", 0), so.optInt("minNoticeHours", 0), so.optInt("maxDaysAhead", 60))
    val mo = j.optJSONObject("me")
    val me = Me(mo?.optString("name") ?: "", mo?.optString("role") ?: "Staff")
    return AdminData(bs, hours, off, settings, me)
}

data class TeamMember(
    val id: String, val row: Int, val username: String, val name: String, val email: String,
    val role: String, val active: Boolean, val mustChange: Boolean, val lastLogin: String
)
