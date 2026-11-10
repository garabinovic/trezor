package com.trezor.app.restore

import org.junit.Assert.assertEquals
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
    lock.recover()
    refused { lock.prepare("s3") }
    refused { lock.recover() }
    lock.endRecover()
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
}
