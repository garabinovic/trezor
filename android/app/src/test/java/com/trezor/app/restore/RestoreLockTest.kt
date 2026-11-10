package com.trezor.app.restore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The restore lock (spec v2.5 §5, review H1). */
class RestoreLockTest {

  private var gate = false
  private val lock = RestoreLock(gateHeld = { gate })

  private fun refused(action: () -> Unit) {
    try {
      action()
      fail("not refused")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.IN_PROGRESS, e.code)
    }
  }

  @Test
  fun aSessionAndARecoveryExcludeEachOther() {
    lock.prepare("s1")
    refused { lock.recover() }
    refused { lock.prepare("s2") }
    // Only the session's own end releases it.
    lock.endPrepare("s2")
    refused { lock.recover() }
    lock.endPrepare("s1")
    val run = lock.recover()
    refused { lock.prepare("s3") }
    refused { lock.recover() }
    lock.endRecover(run)
    lock.prepare("s3")
  }

  @Test
  fun aHeldRestoreGateRefusesBoth() {
    gate = true
    refused { lock.recover() }
    refused { lock.prepare("s1") }
    gate = false
    lock.recover()
  }

  /**
   * Review (Retry during Cancel restore): a second recovery run, from any caller, is refused
   * while the first holds the lock, and can't release it; the first ends its own run, and only
   * then can a new one begin.
   */
  @Test
  fun aRecoveryRunIsOwnedByItsTokenAndASecondCallerIsRefused() {
    val first = lock.recover()
    assertTrue(lock.isRecovering(first))
    refused { lock.recover() }
    // The refused caller has no token; a guessed, stale or empty one releases nothing.
    for (other in listOf("", "recovery-0", "recovery-2", "s1")) {
      lock.endRecover(other)
      assertTrue(lock.isRecovering(first))
      assertFalse(lock.isRecovering(other))
    }
    refused { lock.recover() }
    refused { lock.prepare("s1") }
    lock.endRecover(first)
    assertFalse(lock.isRecovering(first))
    // A new run gets a new token; the finished one's can't end it.
    val second = lock.recover()
    assertNotEquals(first, second)
    lock.endRecover(first)
    assertTrue(lock.isRecovering(second))
    refused { lock.recover() }
    lock.endRecover(second)
    lock.prepare("s1")
  }
}
