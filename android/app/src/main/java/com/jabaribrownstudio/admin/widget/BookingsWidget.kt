package com.jabaribrownstudio.admin.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.layout.size
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.jabaribrownstudio.admin.Fmt
import com.jabaribrownstudio.admin.MainActivity
import com.jabaribrownstudio.admin.R
import com.jabaribrownstudio.admin.Store
import com.jabaribrownstudio.admin.Sync
import java.time.LocalDate
import java.time.LocalDateTime

sealed class Entry {
    class Day(val label: String) : Entry()
    object Empty : Entry()
    class Book(val b: Store.Item) : Entry()
}

private val KEY_ROW = ActionParameters.Key<Int>("bookingRow")
private val KEY_ADD = ActionParameters.Key<String>("openAdd")

class BookingsWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = Store.get(context)
        val signedIn = store.signedIn
        val now = LocalDateTime.now()
        val items = if (signedIn) store.widgetItems().filter {
            try {
                val d = LocalDate.parse(it.date)
                val t = com.jabaribrownstudio.admin.parseTime(it.end) ?: com.jabaribrownstudio.admin.parseTime(it.start)
                d.atTime(t ?: java.time.LocalTime.MIDNIGHT).isAfter(now)
            } catch (e: Exception) { false }
        } else emptyList()
        val entries = ArrayList<Entry>()
        val today = LocalDate.now()
        for (i in 0..6) {
            val d = today.plusDays(i.toLong())
            entries.add(Entry.Day(d.format(java.time.format.DateTimeFormatter.ofPattern("EEEE, d MMMM", java.util.Locale.US))))
            val day = items.filter { it.date == d.toString() }.sortedBy { it.start }
            if (day.isEmpty()) entries.add(Entry.Empty) else day.forEach { entries.add(Entry.Book(it)) }
        }
        provideContent { WidgetContent(signedIn, entries) }
    }
}

private fun cp(res: Int) = ColorProvider(res)

@Composable
private fun WidgetContent(signedIn: Boolean, entries: List<Entry>) {
    Column(modifier = GlanceModifier.fillMaxSize().background(ImageProvider(R.drawable.widget_bg)).padding(horizontal = 14.dp).padding(top = 12.dp, bottom = 8.dp)) {
        if (!signedIn) {
            Box(modifier = GlanceModifier.defaultWeight().fillMaxWidth().clickable(actionStartActivity<MainActivity>()), contentAlignment = Alignment.Center) {
                Text("Open JB Studio Admin and sign in to see your appointments here.", style = TextStyle(color = cp(R.color.widget_sub), fontSize = 13.sp))
            }
        } else {
            LazyColumn(modifier = GlanceModifier.defaultWeight().fillMaxWidth()) {
                items(entries) { e ->
                    when (e) {
                        is Entry.Day -> Text(
                            text = e.label, maxLines = 1,
                            modifier = GlanceModifier.padding(top = 10.dp, bottom = 4.dp),
                            style = TextStyle(color = cp(R.color.widget_text), fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        )
                        is Entry.Empty -> Text(
                            text = "Nothing planned", modifier = GlanceModifier.padding(bottom = 4.dp),
                            style = TextStyle(color = cp(R.color.widget_sub), fontSize = 14.sp)
                        )
                        is Entry.Book -> BookingRow(e.b)
                    }
                }
            }
        }
        Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (signedIn) Text(
                text = "Refresh", modifier = GlanceModifier.clickable(actionRunCallback<RefreshAction>()).padding(vertical = 8.dp, horizontal = 4.dp),
                style = TextStyle(color = cp(R.color.widget_accent), fontSize = 13.sp, fontWeight = FontWeight.Medium)
            )
            Spacer(GlanceModifier.defaultWeight())
            if (signedIn) Box(
                modifier = GlanceModifier.size(52.dp).background(ImageProvider(R.drawable.widget_fab))
                    .clickable(actionStartActivity<MainActivity>(actionParametersOf(KEY_ADD to "1"))),
                contentAlignment = Alignment.Center
            ) {
                Text("+", style = TextStyle(color = cp(R.color.widget_fab_fg), fontSize = 28.sp, fontWeight = FontWeight.Medium))
            }
        }
    }
}

@Composable
private fun BookingRow(b: Store.Item) {
    val statusColor = if (b.status == "Pending") R.color.widget_wait else R.color.widget_ok
    Box(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 6.dp)) {
        Row(
            modifier = GlanceModifier.fillMaxWidth().background(ImageProvider(R.drawable.widget_card)).padding(horizontal = 12.dp, vertical = 8.dp)
                .clickable(actionStartActivity<MainActivity>(actionParametersOf(KEY_ROW to b.row))),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(text = b.name, maxLines = 1, style = TextStyle(color = cp(R.color.widget_text), fontSize = 14.sp, fontWeight = FontWeight.Bold))
                Text(
                    text = listOf(b.pkg, b.status).filter { it.isNotBlank() }.joinToString(" · "), maxLines = 1,
                    style = TextStyle(color = cp(statusColor), fontSize = 12.sp)
                )
            }
            Spacer(GlanceModifier.width(8.dp))
            Text(text = Fmt.time(b.start), style = TextStyle(color = cp(R.color.widget_text), fontSize = 14.sp, fontWeight = FontWeight.Bold))
        }
    }
}

class RefreshAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        Sync.refresh(context)
    }
}

class BookingsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = BookingsWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        Sync.schedule(context)
    }
}
