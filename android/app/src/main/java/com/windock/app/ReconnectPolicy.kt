package com.windock.app

/** A bounded foreground burst; a network event, resume or explicit retry starts a new burst. */
object ReconnectPolicy {
    private val delays = longArrayOf(1000, 2000, 4000, 8000, 16000, 30000)
    fun delay(attempt: Int, active: Boolean, failure: ConnectionFailure): Long? =
        if (active && failure in listOf(ConnectionFailure.NETWORK, ConnectionFailure.OFFLINE, ConnectionFailure.UNREACHABLE)) delays.getOrNull(attempt) else null
}
