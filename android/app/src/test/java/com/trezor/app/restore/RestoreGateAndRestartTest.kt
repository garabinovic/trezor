package com.trezor.app.restore

import androidx.lifecycle.Lifecycle
import com.trezor.app.attachments.RestoreGate
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RestoreGateAndRestartTest {

  @After
  fun tearDown() {
    RestoreGate.end()
  }

  @Test
  fun theGateIsHeldOnceAndReleasedIdempotently() {
    assertFalse(RestoreGate.isHeld())
    RestoreGate.begin()
    assertTrue(RestoreGate.isHeld())
    try {
      RestoreGate.begin()
      fail("second holder")
    } catch (e: IllegalStateException) {
      // expected
    }
    RestoreGate.end()
    RestoreGate.end()
    assertFalse(RestoreGate.isHeld())
  }

  /** L8: only a RESUMED MainActivity counts as the foreground. */
  @Test
  fun onlyAResumedMainActivityIsForeground() {
    assertTrue(ProcessRestart.isForeground(true, Lifecycle.State.RESUMED))
    for (state in listOf(Lifecycle.State.STARTED, Lifecycle.State.CREATED, Lifecycle.State.INITIALIZED, Lifecycle.State.DESTROYED, null)) {
      assertFalse("$state", ProcessRestart.isForeground(true, state))
    }
    assertFalse(ProcessRestart.isForeground(false, Lifecycle.State.RESUMED))
  }
}
