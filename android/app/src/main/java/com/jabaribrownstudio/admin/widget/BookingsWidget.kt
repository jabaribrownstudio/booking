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

class BookingsWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = Store(context)
        val signedIn = store.signedIn
        val now = LocalDateTime.now()
        val items = if (signedIn) store.widgetItems().filter {
            try {
                val d = LocalDate.parse(it.date)
                val t = com.jabaribrownstudio.admin.parseTime(it.end) ?: com.jabaribrownstudio.admin.parseTime(it.start)
                d.atTime(t ?: java.time.LocalTime.MIDNIGHT).isAfter(now)
            } catch (e: Exception) { false }
        } else emptyList()
        provideContent { WidgetContent(signedIn, items) }
    }
}

private fun cp(res: Int) = ColorProvider(res)

@Composable
private fun WidgetContent(signedIn: Boolean, items: List<Store.Item>) {
    val open = actionStartActivity<MainActivity>()
    Column(
        modifier = GlanceModifier.fillMaxSize().background(ImageProvider(R.drawable.widget_bg)).padding(12.dp).clickable(open)
    ) {
        Row(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "Upcoming",
                modifier = GlanceModifier.defaultWeight(),
                style = TextStyle(color = cp(R.color.widget_text), fontSize = 16.sp, fontWeight = FontWeight.Bold)
            )
            if (signedIn) {
                Text(
                    text = if (items.isEmpty()) "" else items.size.toString(),
                    style = TextStyle(color = cp(R.color.widget_sub), fontSize = 13.sp)
                )
                Spacer(GlanceModifier.width(10.dp))
                Text(
                    text = "Refresh",
                    modifier = GlanceModifier.clickable(actionRunCallback<RefreshAction>()),
                    style = TextStyle(color = cp(R.color.widget_accent), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                )
            }
        }
        if (!signedIn) {
            Message("Open JB Studio Admin and sign in to see your appointments here.")
        } else if (items.isEmpty()) {
            Message("No upcoming appointments.")
        } else {
            LazyColumn(modifier = GlanceModifier.fillMaxWidth()) {
                items(items) { it -> BookingRow(it) }
            }
        }
    }
}

@Composable
private fun Message(text: String) {
    Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text = text, style = TextStyle(color = cp(R.color.widget_sub), fontSize = 13.sp))
    }
}

@Composable
private fun BookingRow(b: Store.Item) {
    val d = try { LocalDate.parse(b.date) } catch (e: Exception) { null }
    val statusColor = if (b.status == "Pending") R.color.widget_wait else R.color.widget_ok
    Box(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 6.dp)) {
        Row(
            modifier = GlanceModifier.fillMaxWidth().background(ImageProvider(R.drawable.widget_card)).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    text = b.name,
                    maxLines = 1,
                    style = TextStyle(color = cp(R.color.widget_text), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                )
                Text(
                    text = listOf(b.pkg, b.status).filter { it.isNotBlank() }.joinToString(" · "),
                    maxLines = 1,
                    style = TextStyle(color = cp(statusColor), fontSize = 12.sp)
                )
            }
            Spacer(GlanceModifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = Fmt.time(b.start),
                    style = TextStyle(color = cp(R.color.widget_text), fontSize = 14.sp, fontWeight = FontWeight.Bold)
                )
                Text(
                    text = Fmt.day(d),
                    style = TextStyle(color = cp(R.color.widget_sub), fontSize = 12.sp)
                )
            }
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
