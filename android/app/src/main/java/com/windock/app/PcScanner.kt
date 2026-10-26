package com.windock.app

import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** One bounded scan. No periodic polling or saved-history writes. */
object PcScanner {
    fun scan(saved: List<KnownHost>, networks: List<LocalNetwork> = LocalNetwork.available(),
             discover: () -> List<Discovery.Candidate> = { Discovery.findAll(networks) },
             probe: (String, Boolean) -> KnownHost? = HostProbe::read): List<KnownHost> {
        val candidates = (discover() + saved.filter {
            Discovery.permitsRememberedEndpoint(it.endpoint, it.usb, networks)
        }.map { Discovery.Candidate(it.endpoint, it.usb) }).distinctBy { it.endpoint }.take(32)
        if (Thread.currentThread().isInterrupted || candidates.isEmpty()) return emptyList()
        val workers = Executors.newFixedThreadPool(4)
        val completed = ExecutorCompletionService<KnownHost?>(workers)
        val jobs = candidates.map { candidate -> completed.submit(java.util.concurrent.Callable {
            probe(candidate.endpoint, candidate.usb)
        }) }
        val found = mutableListOf<KnownHost>()
        try {
            val deadline = System.nanoTime() + 3_000_000_000L
            repeat(jobs.size) {
                val remaining = deadline - System.nanoTime()
                if (remaining <= 0) return found
                val result = completed.poll(remaining, TimeUnit.NANOSECONDS) ?: return found
                try { result.get()?.let(found::add) }
                catch (_: java.util.concurrent.ExecutionException) { /* A failed probe is not a PC. */ }
            }
            return found
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            return emptyList()
        } finally {
            jobs.forEach { it.cancel(true) }
            workers.shutdownNow()
        }
    }
}
