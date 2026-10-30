package com.windock.app

internal data class AppUpdateResult(val status: String, val version: String? = null, val releasePage: String? = null)

internal object UpdatePolicy {
    const val DOWNLOADS_PAGE = "https://windock.vercel.app/#download"
    const val RELEASES = "https://github.com/aliihsaad/WinDock/releases"
    const val FEED = "https://windock.vercel.app/downloads.json"
    private val version = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?")
    fun releasePage(value: String): String? = if (value.length <= 100 && version.matches(value)) DOWNLOADS_PAGE else null
    fun evaluate(release: String, apkVersion: String, apkCode: Int, url: String, installedCode: Int): AppUpdateResult {
        val page = releasePage(release) ?: throw IllegalArgumentException("Invalid release")
        require(releasePage(apkVersion) != null && apkCode > 0)
        require(url == "$RELEASES/download/v$release/WinDock-android-debug.apk")
        return AppUpdateResult(if (apkCode > installedCode) "available" else "current", apkVersion, page)
    }
}
