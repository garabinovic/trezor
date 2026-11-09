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
  private val original = byteArrayOf(9, 8, 7, 6, 5)

  private fun ops() =
      ScheduleRestore(
          schedule = schedule,
          saved = saved,
          syncDirectory = { events += "sync:${it.name}" },
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
    assertEquals(listOf("sync:reminders", "rearm", "sync:restore"), events)
    // Again (M-a): saved but absent means the copy-back already happened.
    events.clear()
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(original, schedule.readBytes())
    assertEquals(listOf("rearm"), events)
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

  @Test
  fun aFailedRearmKeepsTheSavedCopyForRetry() {
    ops().saveAndClear {}
    failRearm = true
    try {
      ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
      fail("rearm failure hidden")
    } catch (e: IOException) {
      // expected
    }
    assertTrue(saved.exists())
    failRearm = false
    ops().restoreAndRearm(ScheduleRestore.Saved.SAVED)
    assertArrayEquals(original, schedule.readBytes())
    assertFalse(saved.exists())
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
