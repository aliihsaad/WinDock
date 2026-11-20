package com.tara.app

/** Backs off to one try every 30 s and keeps going while Tara is on screen, so a PC that wakes up is found without a tap. */
object ReconnectPolicy {
    private val delays = longArrayOf(1000, 2000, 4000, 8000, 16000, 30000)
    fun delay(attempt: Int, active: Boolean, failure: ConnectionFailure): Long? =
        if (active && failure in listOf(ConnectionFailure.NETWORK, ConnectionFailure.OFFLINE, ConnectionFailure.UNREACHABLE)) delays[minOf(attempt, delays.lastIndex)] else null
}
