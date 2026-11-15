package com.jabaribrownstudio.admin

/** Defaults for this studio. People can still change the two addresses on the sign-in screen. */
object AppConfig {
    const val BUSINESS = "Jabari Brown Studio"
    const val APPS_SCRIPT_URL =
        "https://script.google.com/macros/s/AKfycbzo4dqwhycjgYWCMlBHgU4Dkc_UmEBYuUCWGRY8lm_Vw_fjRadBpFkx8RbcL7klE618/exec"
    const val WORKER_URL = "https://booking-auth.jabaribrownstudio.workers.dev"
    const val CURRENCY = "J$"
    /** Firebase (instant alerts). Leave blank until set up; the app then checks every 15 minutes instead. */
    const val FIREBASE_API_KEY = "AIzaSyBi1WfoRwatUkKFbgQoS1MVcHI-dbkdyG0"
    const val FIREBASE_APP_ID = "1:358016827250:android:044d7e55ca72f79c9267eb"
    const val FIREBASE_PROJECT_ID = "jb-studio-admin"
    const val FIREBASE_SENDER_ID = "358016827250"
    const val INSTAGRAM = "jabaribrownstudio"

    data class Pkg(val name: String, val price: Int, val minutes: Int)

    val PACKAGES = listOf(
        Pkg("Bronze", 15000, 30),
        Pkg("Silver", 22000, 60),
        Pkg("Gold", 37000, 120),
        Pkg("Professional Headshot", 7500, 20)
    )
}
