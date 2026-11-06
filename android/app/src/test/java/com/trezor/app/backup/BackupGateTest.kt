package com.trezor.app.backup

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BackupGateTest {

  private val deleted = mutableListOf<List<String>>()

  init {
    BackupGate.deleter = { deleted += it }
  }

  @After
  fun tearDown() {
    BackupGate.end()
    BackupGate.deleter = null
  }

  @Test
  fun withoutABackupEveryDeletionRunsAtOnce() {
    assertFalse(BackupGate.isHeld())
    assertEquals(listOf("a", "b"), BackupGate.filterDeletion(listOf("a", "b")))
  }

  @Test
  fun exportedIdsAreDeferredUntilTheGateIsReleasedOthersAreNot() {
    BackupGate.begin(setOf("a", "b"))
    assertTrue(BackupGate.isHeld())
    assertEquals(listOf("c"), BackupGate.filterDeletion(listOf("a", "c")))
    assertEquals(emptyList<String>(), BackupGate.filterDeletion(listOf("b", "a")))
    assertTrue(deleted.isEmpty())

    BackupGate.end()
    assertFalse(BackupGate.isHeld())
    // Once each, in request order.
    assertEquals(listOf(listOf("a", "b")), deleted)
    // Released: deletions run at once again, and a second end() does nothing.
    assertEquals(listOf("a"), BackupGate.filterDeletion(listOf("a")))
    BackupGate.end()
    assertEquals(1, deleted.size)
  }

  @Test
  fun releasingWithNothingDeferredDeletesNothing() {
    BackupGate.begin(setOf("a"))
    BackupGate.end()
    assertTrue(deleted.isEmpty())
  }

  @Test
  fun onlyOneBackupHoldsTheGate() {
    BackupGate.begin(setOf("a"))
    try {
      BackupGate.begin(setOf("b"))
      fail("second holder")
    } catch (e: IllegalStateException) {
      // expected
    }
    // The first holder's set is unchanged.
    assertEquals(listOf("b"), BackupGate.filterDeletion(listOf("a", "b")))
  }

  @Test
  fun theProtectedSetIsACopy() {
    val ids = mutableSetOf("a")
    BackupGate.begin(ids)
    ids.clear()
    assertEquals(emptyList<String>(), BackupGate.filterDeletion(listOf("a")))
  }
}
