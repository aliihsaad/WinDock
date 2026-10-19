package com.windock.app

/** Zero follows Android's sleep timer; -1 stays awake while the dock is visible. */
data class DisplayPolicy(val dimAfterMs: Long = 30_000, val sleepAfterMs: Long = 0, val dimPercent: Int = 10) {
    enum class Stage { AWAKE, DIMMED, RESTING }

    fun stage(elapsedMs: Long): Stage = when {
        sleepAfterMs > 0 && elapsedMs >= sleepAfterMs -> Stage.RESTING
        dimAfterMs > 0 && elapsedMs >= dimAfterMs -> Stage.DIMMED
        else -> Stage.AWAKE
    }

    fun nextDeadline(elapsedMs: Long): Long? = listOf(dimAfterMs, sleepAfterMs)
        .filter { it > 0 && it > elapsedMs }.minOrNull()

    fun keepsAwake(stage: Stage) = sleepAfterMs != 0L && stage != Stage.RESTING

    companion object {
        val DIM_TIMES = listOf(0L, 15_000L, 30_000L, 60_000L, 120_000L)
        val SLEEP_TIMES = listOf(0L, 60_000L, 120_000L, 300_000L, 600_000L, -1L)
        val DIM_LEVELS = listOf(5, 10, 20)
    }
}
