package com.trezor.app.reminders

import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Schedule save/clear and restore/re-arm (spec v2.4 §8.2 step 10–11, §8.11, tests 24, 37, 38). */
class ScheduleRestoreTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var schedule: File
  private lateinit var saved: File
  private val events = mutableListOf<String>()
  private var emptyAfterClear = true
  private var failRearm = false
  private var onClear: () -> Unit = {}
  /** A directory whose sync fails (by name), to fail a step part-way. */
  private var failSyncOf: String? = null
  private val original = byteArrayOf(9, 8, 7, 6, 5)

  private fun ops() =
      ScheduleRestore(
          schedule = schedule,
          saved = saved,
          syncDirectory = {
            if (it.name == failSyncOf) throw IOException("fsync ${it.name}")
            events += "sync:${it.name}"
          },
          clear = {
            onClear()
            events += "clear"
            schedule.writeBytes(byteArrayOf(0))
          },
          isEmpty = { emptyAfterClear },
          rearm = {
            if (failRearm) throw IOException("alarm service")
            events += "rearm"
          },
      )

  @Before
  fun setUp() {
    val nb = folder.newFolder("no_backup")
    schedule = File(nb, "reminders/schedule.bin").also { it.parentFile.mkdirs(); it.writeBytes(original) }
    saved = File(nb, "restore/schedule.saved.bin")
  }

  @Test
  fun saveCopiesDurablyRecordsThenClears() {
    val result = ops().saveAndClear { events += "journal:$it" }
    assertEquals(ScheduleRestore.Saved.SAVED, result)
    assertArrayEquals(original, saved.readBytes())
    assertFalse(File(saved.parentFile, "schedule.saved.bin.tmp").exists())
    // The copy is durable before the journal says so, and the journal before the clear.
    assertEquals(listOf("sync:restore", "journal:SAVED", "clear"), events)
  }

  @Test
  fun withoutAScheduleNothingIsCopiedAndAbsentIsRecorded() {
    schedule.delete()
    assertEquals(ScheduleRestore.Saved.ABSENT, ops().saveAndClear { events += "journal:$it" })
    assertFalse(saved.exists())
    assertEquals(listOf("journal:ABSENT", "clear"), events)
  }

  @Test
  fun aScheduleThatIsntEmptyAfterClearingFails() {
    emptyAfterClear = false
    try {
      ops().saveAndClear {}
      fail("not confirmed empty")
    } catch (e: IOException) {
      // expected; the saved copy stays for the restore
    }
    assertArrayEquals(original, saved.readBytes())
  }

  @Test
  fun restoreSavedCopiesBackRearmsAndDeletesTheCopy() {
    ops().saveAndClear {}
    events.clear()
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(original, schedule.readBytes())
    assertFalse(saved.exists())
    // Copy back durably, delete the saved copy durably, and only then re-arm (review L-A).
    assertEquals(listOf("sync:reminders", "sync:restore", "rearm"), events)
    // Again (M-a): saved but absent means the copy-back already happened; the deletion is
    // still made durable before re-arming.
    events.clear()
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(original, schedule.readBytes())
    assertEquals(listOf("sync:restore", "rearm"), events)
  }

  @Test
  fun restoreAbsentDeletesTheScheduleAndPendingLeavesIt() {
    ops().restoreAndRearm(ScheduleRestore.Saved.PENDING)
    assertArrayEquals(original, schedule.readBytes())
    // A stray copy from step 10 (a) is removed.
    saved.parentFile.mkdirs()
    File(saved.parentFile, "schedule.saved.bin.tmp").writeText("x")
    saved.writeBytes(original)
    ops().restoreAndRearm(ScheduleRestore.Saved.PENDING)
    assertArrayEquals(original, schedule.readBytes())
    assertFalse(saved.exists())
    assertFalse(File(saved.parentFile, "schedule.saved.bin.tmp").exists())
    ops().restoreAndRearm(ScheduleRestore.Saved.ABSENT)
    assertFalse(schedule.exists())
  }

  /**
   * Review L-A: re-arming fails after the copy-back, and an alarm of the restored schedule
   * fires before the retry and records its delivery. The retry must not copy the stale saved
   * schedule back over that (it would deliver the same occurrence again); it only re-arms.
   */
  @Test
  fun aRetryAfterAFailedRearmNeverRestoresTheStaleCopyAgain() {
    ops().saveAndClear {}
    failRearm = true
    try {
      ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
      fail("rearm failure hidden")
    } catch (e: IOException) {
      // expected
    }
    // The copy-back is complete and the saved copy already gone.
    assertArrayEquals(original, schedule.readBytes())
    assertFalse(saved.exists())
    // An alarm fires meanwhile (onFire records the delivery in the schedule).
    val afterAlarm = byteArrayOf(42, 42)
    schedule.writeBytes(afterAlarm)
    failRearm = false
    events.clear()
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(afterAlarm, schedule.readBytes())
    assertEquals(listOf("sync:restore", "rearm"), events)
    // And again: still nothing copied.
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(afterAlarm, schedule.readBytes())
  }

  @Test
  fun aFailedCopyBackKeepsTheSavedCopyAndArmsNothing() {
    ops().saveAndClear {}
    events.clear()
    failSyncOf = "reminders" // the copy-back's directory sync
    try {
      ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
      fail("copy-back failure hidden")
    } catch (e: IOException) {
      // expected
    }
    assertArrayEquals(original, saved.readBytes())
    assertFalse("armed before the copy-back was durable", "rearm" in events)
    failSyncOf = null
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(original, schedule.readBytes())
    assertFalse(saved.exists())
    assertEquals(1, events.count { it == "rearm" })
  }

  @Test
  fun aFailureWhileDeletingTheSavedCopyArmsNothingAndTheRetryFinishes() {
    ops().saveAndClear {}
    events.clear()
    // The deletion's directory sync fails: the copy is gone, but not yet durably.
    failSyncOf = "restore"
    try {
      ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
      fail("deletion failure hidden")
    } catch (e: IOException) {
      // expected
    }
    assertFalse("rearm" in events)
    failSyncOf = null
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(original, schedule.readBytes())
    assertEquals(1, events.count { it == "rearm" })

    // The deletion itself failing (directory not writable): the saved copy stays, and the
    // retry repeats the copy-back, still before anything is armed.
    ops().saveAndClear {}
    events.clear()
    saved.parentFile.setWritable(false)
    try {
      ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
      fail("deletion failure hidden")
    } catch (e: IOException) {
      // expected
    } finally {
      saved.parentFile.setWritable(true)
    }
    assertTrue(saved.exists())
    assertFalse("rearm" in events)
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(original, schedule.readBytes())
    assertFalse(saved.exists())
    assertEquals(1, events.count { it == "rearm" })
  }

  /**
   * Review Low 1: the saved copy was deleted but the directory sync failed, so the deletion
   * may not be durable. The retry finds the copy already absent and must still sync
   * `N/restore` before it arms anything.
   */
  @Test
  fun aRetryAfterAFailedDeletionSyncMakesTheDeletionDurableBeforeRearming() {
    ops().saveAndClear {}
    events.clear()
    failSyncOf = "restore"
    try {
      ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
      fail("sync failure hidden")
    } catch (e: IOException) {
      // expected
    }
    assertFalse(saved.exists())
    assertArrayEquals(original, schedule.readBytes())
    assertFalse("rearm" in events)
    failSyncOf = null
    events.clear()
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    // Ordering: the directory is synced first, then (and only then) re-armed; no copy-back.
    assertEquals(listOf("sync:restore", "rearm"), events)
    assertArrayEquals(original, schedule.readBytes())
  }

  /** M-b: the operation holds the `ScheduleStore` monitor for its whole duration. */
  @Test
  fun anAlarmOrRearmWaitsForTheWholeCriticalSection() {
    val inside = CountDownLatch(1)
    val proceed = CountDownLatch(1)
    onClear = {
      inside.countDown()
      proceed.await(5, TimeUnit.SECONDS)
    }
    val saver = Thread { ops().saveAndClear {} }.also { it.start() }
    assertTrue(inside.await(5, TimeUnit.SECONDS))
    // onFire and rearmAll take this same monitor through ScheduleStore.update.
    val other = CountDownLatch(1)
    val receiver = Thread { synchronized(ScheduleStore) { other.countDown() } }.also { it.start() }
    assertFalse("ran inside the critical section", other.await(300, TimeUnit.MILLISECONDS))
    proceed.countDown()
    assertTrue(other.await(5, TimeUnit.SECONDS))
    saver.join()
    receiver.join()
  }
}
