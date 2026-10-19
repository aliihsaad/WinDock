package com.windock.app

import org.junit.Assert.*
import org.junit.Test

class DisplayPolicyTest {
    @Test fun timedRestTakesPriorityAndReleasesKeepAwake() {
        val policy = DisplayPolicy(15_000, 60_000, 10)
        assertEquals(DisplayPolicy.Stage.AWAKE, policy.stage(14_999))
        assertEquals(DisplayPolicy.Stage.DIMMED, policy.stage(15_000))
        assertEquals(DisplayPolicy.Stage.RESTING, policy.stage(60_000))
        assertEquals(15_000L, policy.nextDeadline(0))
        assertEquals(60_000L, policy.nextDeadline(15_000))
        assertNull(policy.nextDeadline(60_000))
        assertTrue(policy.keepsAwake(policy.stage(59_999)))
        assertFalse(policy.keepsAwake(policy.stage(60_000)))
        assertEquals(DisplayPolicy.Stage.RESTING, DisplayPolicy(120_000, 60_000).stage(60_000))
    }

    @Test fun systemTimeoutAndStayAwakeHaveDifferentPowerBehavior() {
        val system = DisplayPolicy()
        assertFalse(system.keepsAwake(system.stage(0)))
        assertFalse(system.keepsAwake(system.stage(500_000)))
        val stayAwake = DisplayPolicy(0, -1)
        assertEquals(DisplayPolicy.Stage.AWAKE, stayAwake.stage(Long.MAX_VALUE))
        assertTrue(stayAwake.keepsAwake(stayAwake.stage(Long.MAX_VALUE)))
        assertNull(stayAwake.nextDeadline(0))
        assertNull(DisplayPolicy(0, 0).nextDeadline(0))
    }
}
