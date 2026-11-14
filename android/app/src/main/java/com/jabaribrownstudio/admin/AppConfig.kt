package com.jabaribrownstudio.admin

/** Defaults for this studio. People can still change the two addresses on the sign-in screen. */
object AppConfig {
    const val BUSINESS = "Jabari Brown Studio"
    const val APPS_SCRIPT_URL =
        "https://script.google.com/macros/s/AKfycbzo4dqwhycjgYWCMlBHgU4Dkc_UmEBYuUCWGRY8lm_Vw_fjRadBpFkx8RbcL7klE618/exec"
    const val WORKER_URL = "https://booking-auth.jabaribrownstudio.workers.dev"
    const val CURRENCY = "J$"
    const val INSTAGRAM = "jabaribrownstudio"

    data class Pkg(val name: String, val price: Int, val minutes: Int)

    val PACKAGES = listOf(
        Pkg("Bronze", 15000, 30),
        Pkg("Silver", 22000, 60),
        Pkg("Gold", 37000, 120),
        Pkg("Professional Headshot", 7500, 20)
    )
}
