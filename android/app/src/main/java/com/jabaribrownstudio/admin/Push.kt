package com.jabaribrownstudio.admin

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Instant alerts through Firebase Cloud Messaging. Does nothing until the Firebase values in AppConfig are filled in. */
object Push {
    val configured: Boolean get() = AppConfig.FIREBASE_APP_ID.isNotBlank() && AppConfig.FIREBASE_API_KEY.isNotBlank() && AppConfig.FIREBASE_PROJECT_ID.isNotBlank()

    @Synchronized
    fun ensure(ctx: Context): Boolean {
        if (!configured) return false
        try {
            if (FirebaseApp.getApps(ctx).isEmpty()) {
                FirebaseApp.initializeApp(ctx, FirebaseOptions.Builder()
                    .setApiKey(AppConfig.FIREBASE_API_KEY).setApplicationId(AppConfig.FIREBASE_APP_ID)
                    .setProjectId(AppConfig.FIREBASE_PROJECT_ID).setGcmSenderId(AppConfig.FIREBASE_SENDER_ID).build())
            }
            return true
        } catch (e: Exception) { return false }
    }

    /** Tells the server which phone to alert. Safe to call often: it only talks to the server when the token changed. */
    fun register(ctx: Context) {
        val app = ctx.applicationContext
        if (!ensure(app)) return
        val store = Store.get(app)
        if (!store.signedIn) return
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (token.isNullOrBlank() || token == store.pushToken) return@addOnSuccessListener
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val r = Backend(store).call("admin_push_register", JSONObject().put("token", token))
                        if (r.ok) store.pushToken = token
                    } catch (e: Exception) { }
                }
            }
        } catch (e: Exception) { }
    }

    suspend fun unregister(ctx: Context) {
        val store = Store.get(ctx)
        val t = store.pushToken
        if (t.isBlank()) return
        try { Backend(store).call("admin_push_unregister", JSONObject().put("token", t)) } catch (e: Exception) { }
    }
}

class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Store.get(this).pushToken = ""
        Push.register(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        when (d["type"]) {
            "booking" -> Notify.fromPush(applicationContext, Store.get(applicationContext), d)
            else -> if (!d["title"].isNullOrBlank()) Notify.simple(applicationContext, d["title"] ?: "", d["body"] ?: "")
        }
        // Refresh the widget and saved bookings too.
        CoroutineScope(Dispatchers.IO).launch { Sync.refresh(applicationContext) }
    }
}
