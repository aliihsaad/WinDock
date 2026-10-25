package com.windock.app

/** The web UI owns the preference; this is only an automatic device hint. */
object PerformancePolicy {
    fun pageUrl(endpoint: String, lowRam: Boolean): String =
        if (lowRam) "$endpoint/?perf=1" else endpoint
}
