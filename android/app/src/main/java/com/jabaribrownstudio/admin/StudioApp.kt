package com.jabaribrownstudio.admin

import android.app.Application

class StudioApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Opening the encrypted store is slow; do it in the background so the first screen isn't held up.
        Thread { Store.get(this); Push.ensure(this) }.start()
    }
}
