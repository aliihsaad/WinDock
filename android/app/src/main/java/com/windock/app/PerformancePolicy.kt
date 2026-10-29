package com.windock.app

/** The web UI owns the preference; this is only an automatic device hint. */
object PerformancePolicy {
    // The ROM's low-RAM flag alone can miss older 2 GB phones.
    // Use total physical memory, not transient free RAM or the per-app heap limit.
    fun autoEnabled(lowRam: Boolean, totalMemoryBytes: Long): Boolean =
        lowRam || totalMemoryBytes in 1..(2L * 1024 * 1024 * 1024)

    fun pageUrl(endpoint: String, lowRam: Boolean): String =
        if (lowRam) "$endpoint/?perf=1" else endpoint
}
