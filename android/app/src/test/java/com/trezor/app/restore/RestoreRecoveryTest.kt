package com.trezor.app.restore

import com.trezor.app.reminders.ScheduleRestore
import com.trezor.app.restore.RestoreJournal.Phase
import com.trezor.app.restore.RestoreRecovery.Decision
import com.trezor.app.restore.RestoreRecovery.Outcome
import com.trezor.app.restore.RestoreRecovery.Rename
import com.trezor.app.restore.RestoreRecovery.Slot
import com.trezor.app.restore.RestoreRecovery.Verification
import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The swap and its recovery on real files (spec v2.4 §8.2 steps 13a–15, §8.5; v2.5 §1–§9).
 * Directory syncs are recorded and can be made to fail; `lstat` is the JVM's
 * (`NOFOLLOW_LINKS`) and can be made to fail per path. These tests prove decisions, order and
 * idempotence under assumption A6, not crash atomicity on a device filesystem (v2.5 §11).
 */
class RestoreRecoveryTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var layout: RestoreLayout
  private lateinit var ops: RestoreFileOps
  private lateinit var recovery: RestoreRecovery
  private val lock = RestoreLock(gateHeld = { false })
  private val events = mutableListOf<String>()
  /** Phases as each journal write made them durable, in order. */
  private val phases = mutableListOf<Phase>()
  /** Paths whose `lstat` fails. */
  private val unreadable = mutableSetOf<String>()
  private var syncs = 0
  /** The sync with this number fails (0: none). */
  private var failSyncAt = 0

  private val restoreId = "e".repeat(32)
  private val oldDb = ByteArray(8192) { 1 }
  private val newDb = ByteArray(4096) { 2 }
  private val oldIds = listOf(id(1), id(2))
  private val newIds = listOf(id(7))
  private val previousSchedule = byteArrayOf(5, 5, 5)
  private val clearedSchedule = byteArrayOf(0)

  private fun id(n: Int) = "01a1a0dd-991f-783c-9531-3fab9ef4%04d".format(n)

  private val types = JvmPathTypes { it.path in unreadable }

  private fun rel(file: File) = file.relativeTo(folder.root).path

  @Before
  fun setUp() {
    layout = RestoreLayout(folder.newFolder("databases"), folder.newFolder("no_backup"))
    ops =
        RestoreFileOps(
            layout,
            syncDirectory = { dir ->
              syncs++
              if (syncs == failSyncAt) throw IOException("fsync")
              events += "sync:${rel(dir)}"
              if (dir == layout.restoreDir && layout.journal.isFile) {
                val phase = RestoreJournal.decode(layout.journal.readBytes()).phase
                // Recovery never writes `prepared`: that journal is the arrangement's.
                if (phase != Phase.PREPARED && phases.lastOrNull() != phase) {
                  phases += phase
                  events += "phase:$phase"
                }
              }
            },
            link = { src, dst -> Files.createLink(dst.toPath(), src.toPath()) })
    val schedule =
        ScheduleRestore(
            schedule = layout.schedule,
            saved = layout.savedSchedule,
            syncDirectory = ops::syncDirectory,
            clear = {},
            isEmpty = { true },
            rearm = { events += "rearm" },
        )
    recovery = RestoreRecovery(layout, ops, types, schedule, lock)
  }

  // --- Arrangements ---------------------------------------------------------------------------

  private fun reset() {
    for (dir in listOf(layout.databaseDir, layout.noBackupDir)) {
      dir.deleteRecursively()
      dir.mkdirs()
    }
    events.clear()
    phases.clear()
    unreadable.clear()
    syncs = 0
    failSyncAt = 0
    lock.verifyRetryOf = null
  }

  private fun journal(phase: Phase, h: Boolean, schedule: RestoreJournal.Schedule = RestoreJournal.Schedule.SAVED) =
      RestoreJournal(restoreId, "b".repeat(32), phase, h, schedule, 1L)

  private fun writeJournal(phase: Phase, h: Boolean, schedule: RestoreJournal.Schedule = RestoreJournal.Schedule.SAVED) {
    layout.restoreDir.mkdirs()
    layout.journal.writeBytes(journal(phase, h, schedule).encode())
  }

  private fun phase() = RestoreJournal.decode(layout.journal.readBytes()).phase

  /** The state after step 12 that passes step 13a: live data, staging, quarantine, saved schedule. */
  private fun prepared(h: Boolean, schedule: RestoreJournal.Schedule = RestoreJournal.Schedule.SAVED) {
    layout.liveDb.writeBytes(oldDb)
    if (h) {
      oldIds.forEach { File(layout.liveAttachments, "$it.tza").also { f -> f.parentFile!!.mkdirs() }.writeText("old $it") }
      File(layout.liveAttachments, "kept-ids").writeText(oldIds[0])
      File(layout.liveAttachments, "tmp").mkdirs()
      File(layout.quarantine(restoreId), "${oldIds[0]}.tza").also { it.parentFile!!.mkdirs() }.writeText("old ${oldIds[0]}")
    }
    layout.restoreDbDir.mkdirs()
    layout.stagedDb.writeBytes(newDb)
    layout.stagedAttachments.mkdirs()
    newIds.forEach { File(layout.stagedAttachments, "$it.tza").writeText("new $it") }
    layout.schedule.parentFile!!.mkdirs()
    layout.schedule.writeBytes(clearedSchedule)
    layout.restoreDir.mkdirs()
    if (schedule == RestoreJournal.Schedule.SAVED) layout.savedSchedule.writeBytes(previousSchedule)
    writeJournal(Phase.PREPARED, h, schedule)
  }

  private fun fileOf(slot: Slot) =
      when (slot) {
        Slot.L_ATT -> layout.liveAttachments
        Slot.S_ATT -> layout.stagedAttachments
        Slot.P_ATT -> layout.previousAttachments
        Slot.L_DB -> layout.liveDb
        Slot.S_DB -> layout.stagedDb
        Slot.P_DB -> layout.previousDb
      }

  /** Exactly [present] of the six paths, under a journal at [phase]. */
  private fun arrange(h: Boolean, phase: Phase, present: Set<Slot>) {
    reset()
    layout.restoreDbDir.mkdirs()
    layout.schedule.parentFile!!.mkdirs()
    layout.schedule.writeBytes(clearedSchedule)
    writeJournal(phase, h)
    for (slot in present) {
      val f = fileOf(slot)
      if (slot.dir) {
        File(f, "${id(slot.ordinal)}.tza").also { it.parentFile!!.mkdirs() }.writeText(slot.name)
      } else {
        f.writeBytes(ByteArray(4096) { slot.ordinal.toByte() })
      }
    }
  }

  /** Every path under the test root with its content: "nothing touched" compares two of these. */
  private fun tree(): Map<String, String> =
      folder.root.walkTopDown().associate { f ->
        rel(f) to (if (f.isFile) f.readBytes().contentToString() else if (f.isDirectory) "dir" else "other")
      }

  private fun expectCode(code: String, action: () -> Unit) {
    try {
      action()
      fail("expected $code")
    } catch (e: RestoreException) {
      assertEquals(code, e.code)
    }
  }

  /** Expects [code] and that nothing was changed. */
  private fun expectRefused(code: String, action: () -> Unit) {
    val before = tree()
    expectCode(code, action)
    assertEquals(before, tree())
  }

  /** Startup recovery until done, answering every verification with [verdict]. */
  private fun finish(verdict: Verification = Verification.PASS) {
    repeat(8) {
      when (recovery.run()) {
        Outcome.Done -> return
        is Outcome.Verify -> recovery.finishVerification(verdict)
      }
    }
    fail("recovery did not settle")
  }

  private fun names(dir: File) = dir.list()?.sorted() ?: emptyList()

  private fun assertNoRestoreLeft() {
    assertFalse("journal left", layout.journal.exists())
    assertFalse("N/restore left", layout.restoreDir.exists())
    assertFalse("D/restore left", layout.restoreDbDir.exists())
  }

  private fun assertRestored(h: Boolean) {
    assertArrayEquals(newDb, layout.liveDb.readBytes())
    assertEquals(newIds.map { "$it.tza" }, names(layout.liveAttachments))
    assertNoRestoreLeft()
    // The retained files stay quarantined after a successful restore (decision 6).
    assertEquals(h, File(layout.quarantine(restoreId), "${oldIds[0]}.tza").isFile)
    // Not re-armed: the reconcile after startup arms the restored reminders.
    assertArrayEquals(clearedSchedule, layout.schedule.readBytes())
    assertFalse("rearm" in events)
  }

  private fun assertRolledBack(h: Boolean) {
    assertArrayEquals(oldDb, layout.liveDb.readBytes())
    if (h) {
      assertEquals(oldIds.map { "$it.tza" } + listOf("kept-ids", "tmp"), names(layout.liveAttachments))
    } else {
      assertFalse(layout.liveAttachments.exists())
    }
    assertNoRestoreLeft()
    assertFalse(layout.quarantine(restoreId).exists())
    assertArrayEquals(previousSchedule, layout.schedule.readBytes())
    assertTrue("rearm" in events)
  }

  // --- The state tables (v2.4 §8.5) -----------------------------------------------------------

  /** `s("110", "101")` = `A = (L_att, S_att, P_att)`, `B = (L_db, S_db, P_db)`; `x` = either. */
  private fun s(a: String, b: String): List<Set<Slot>> {
    val bits = a + b
    var sets = listOf(emptySet<Slot>())
    for ((i, c) in bits.withIndex()) {
      val slot = Slot.values()[i]
      sets =
          when (c) {
            '1' -> sets.map { it + slot }
            '0' -> sets
            else -> sets.flatMap { listOf(it, it + slot) }
          }
    }
    return sets
  }

  private fun rows(h: Boolean): Map<Phase, Map<Set<Slot>, List<Rename>>> {
    fun one(a: String, b: String, renames: List<Rename> = emptyList()) = s(a, b).associateWith { renames }
    return if (h) {
      mapOf(
          Phase.PREPARED to one("1x0", "1x0"),
          Phase.SWAPPING to
              (one("110", "110", listOf(Rename.A, Rename.B, Rename.C, Rename.D)) +
                  one("011", "110", listOf(Rename.B, Rename.C, Rename.D)) +
                  one("101", "110", listOf(Rename.C, Rename.D)) +
                  one("101", "011", listOf(Rename.D)) +
                  one("101", "101")),
          Phase.VERIFYING to one("101", "101"),
          Phase.CLEANUP to one("10x", "10x"),
          Phase.ROLLINGBACK to
              (one("101", "101", listOf(Rename.R1, Rename.R2, Rename.R3, Rename.R4)) +
                  one("101", "011", listOf(Rename.R2, Rename.R3, Rename.R4)) +
                  one("101", "110", listOf(Rename.R3, Rename.R4)) +
                  one("011", "110", listOf(Rename.R4)) +
                  one("110", "110")),
          Phase.ROLLEDBACK to one("1x0", "1x0"),
      )
    } else {
      mapOf(
          Phase.PREPARED to one("0x0", "1x0"),
          Phase.SWAPPING to
              (one("010", "110", listOf(Rename.B, Rename.C, Rename.D)) +
                  one("100", "110", listOf(Rename.C, Rename.D)) +
                  one("100", "011", listOf(Rename.D)) +
                  one("100", "101")),
          Phase.VERIFYING to one("100", "101"),
          Phase.CLEANUP to one("100", "10x"),
          Phase.ROLLINGBACK to
              (one("100", "101", listOf(Rename.R1, Rename.R2, Rename.R3)) +
                  one("100", "011", listOf(Rename.R2, Rename.R3)) +
                  one("100", "110", listOf(Rename.R3)) +
                  one("010", "110")),
          Phase.ROLLEDBACK to one("0x0", "1x0"),
      )
    }
  }

  /** All 64 combinations of the six paths, in every phase, for both tables. */
  @Test
  fun everyCombinationDecidesExactlyItsTableRowAndAnyOtherTouchesNothing() {
    val all = s("xxx", "xxx")
    assertEquals(64, all.size)
    for (h in listOf(true, false)) {
      for ((phase, rows) in rows(h)) {
        for (present in all) {
          arrange(h, phase, present)
          val renames = rows[present]
          if (renames == null) {
            expectRefused(RestoreException.STATE_UNKNOWN) { recovery.decide() }
            continue
          }
          val d = recovery.decide()
          val what = "h=$h $phase $present"
          when (phase) {
            Phase.PREPARED -> assertTrue(what, d is Decision.Prepared)
            Phase.SWAPPING -> assertEquals(what, renames, (d as Decision.Forward).renames)
            Phase.VERIFYING -> assertTrue(what, d is Decision.Verify)
            Phase.CLEANUP -> assertTrue(what, d is Decision.Cleanup)
            Phase.ROLLINGBACK -> assertEquals(what, renames, (d as Decision.Back).renames)
            Phase.ROLLEDBACK -> assertTrue(what, d is Decision.RolledBack)
          }
        }
      }
    }
  }

  @Test
  fun stagingWithoutAJournalIsDeletedButNeverTheQuarantine() {
    File(layout.restoreDbDir, "incoming.db").also { it.parentFile!!.mkdirs() }.writeText("x")
    File(layout.stagedAttachments, "${id(1)}.tza").also { it.parentFile!!.mkdirs() }.writeText("x")
    File(layout.quarantine(restoreId), "${id(1)}.tza").also { it.parentFile!!.mkdirs() }.writeText("kept")
    assertEquals(Outcome.Done, recovery.run())
    assertNoRestoreLeft()
    assertTrue(File(layout.quarantine(restoreId), "${id(1)}.tza").isFile)
    // Nothing at all: nothing to do.
    assertEquals(Outcome.Done, recovery.run())
  }

  /** M-c: what only a journal's restore leaves means the journal is missing, not stale staging. */
  @Test
  fun stagingWithPreviousDataOrASavedScheduleButNoJournalIsUnknown() {
    for (left in listOf(layout.previousDb, layout.savedSchedule, File(layout.previousAttachments, "${id(1)}.tza"))) {
      reset()
      layout.restoreDbDir.mkdirs()
      left.parentFile!!.mkdirs()
      left.writeText("x")
      expectRefused(RestoreException.STATE_UNKNOWN) { recovery.run() }
    }
  }

  // --- Whole runs --------------------------------------------------------------------------------

  @Test
  fun aSwapThenAPassingVerificationLeavesTheRestoredData() {
    for (h in listOf(true, false)) {
      reset()
      prepared(h)
      assertEquals(Phase.VERIFYING, recovery.swap(restoreId))
      assertArrayEquals(newDb, layout.liveDb.readBytes())
      assertArrayEquals(oldDb, layout.previousDb.readBytes())
      assertEquals(h, layout.previousAttachments.isDirectory)
      val verify = recovery.run() as Outcome.Verify
      assertEquals(newIds, verify.attachmentIds)
      recovery.finishVerification(Verification.PASS)
      assertEquals(Phase.CLEANUP, phase())
      assertEquals(Outcome.Done, recovery.run())
      assertRestored(h)
      assertEquals(listOf(Phase.SWAPPING, Phase.VERIFYING, Phase.CLEANUP), phases)
    }
  }

  @Test
  fun aFailedVerificationRollsBackToThePreviousDataAndSchedule() {
    for (h in listOf(true, false)) {
      reset()
      prepared(h)
      recovery.swap(restoreId)
      finish(Verification.FAIL)
      assertRolledBack(h)
      assertEquals(listOf(Phase.SWAPPING, Phase.VERIFYING, Phase.ROLLINGBACK, Phase.ROLLEDBACK), phases)
    }
  }

  /** The `prepared` row at startup is the pre-swap failure path: nothing live was moved. */
  @Test
  fun aPreparedJournalAtStartupUndoesThePreparation() {
    for (schedule in listOf(RestoreJournal.Schedule.SAVED, RestoreJournal.Schedule.ABSENT, RestoreJournal.Schedule.PENDING)) {
      for (h in listOf(true, false)) {
        reset()
        prepared(h, schedule)
        if (schedule == RestoreJournal.Schedule.PENDING) layout.schedule.writeBytes(previousSchedule)
        layout.incomingAttachment.writeText("in transit")
        assertEquals(Outcome.Done, recovery.run())
        assertArrayEquals(oldDb, layout.liveDb.readBytes())
        assertNoRestoreLeft()
        assertFalse(layout.quarantine(restoreId).exists())
        when (schedule) {
          RestoreJournal.Schedule.ABSENT -> assertFalse(layout.schedule.exists())
          else -> assertArrayEquals(previousSchedule, layout.schedule.readBytes())
        }
        assertTrue("rearm" in events)
      }
    }
  }

  /**
   * Fault injection (M-d, v2.5 §4.3): every directory sync of the swap fails in turn, the
   * process "restarts" and startup recovery finishes. Each run ends with one complete
   * outcome, restored or rolled back, and never rolls forward once `rollingback` was durable.
   */
  @Test
  fun aFailureAtEverySyncOfTheSwapConvergesToOneCompleteOutcome() {
    for (h in listOf(true, false)) {
      var n = 1
      while (true) {
        reset()
        prepared(h)
        failSyncAt = n
        val swapped = runCatching { recovery.swap(restoreId) }
        failSyncAt = 0
        finish()
        assertConverged(h, "h=$h sync #$n")
        if (swapped.isSuccess && syncs < n) break
        n++
      }
      assertTrue("too few faults injected", n > 10)
    }
  }

  /** The same for startup recovery: after the swap, every sync of verification's aftermath fails in turn. */
  @Test
  fun aFailureAtEverySyncOfRecoveryConvergesToo() {
    for (verdict in listOf(Verification.PASS, Verification.FAIL)) {
      for (h in listOf(true, false)) {
        var n = 1
        while (true) {
          reset()
          prepared(h)
          recovery.swap(restoreId)
          syncs = 0
          failSyncAt = n
          val result = runCatching { finish(verdict) }
          failSyncAt = 0
          finish(verdict)
          if (verdict == Verification.PASS) assertRestored(h) else assertRolledBack(h)
          assertConverged(h, "$verdict h=$h sync #$n")
          if (result.isSuccess && syncs < n) break
          n++
        }
      }
    }
  }

  private fun assertConverged(h: Boolean, what: String) {
    if (layout.liveDb.readBytes().contentEquals(newDb)) assertRestored(h) else assertRolledBack(h)
    val rolledBackAt = phases.indexOf(Phase.ROLLINGBACK)
    if (rolledBackAt >= 0) {
      val after = phases.drop(rolledBackAt)
      assertFalse("$what: forward after rollingback $phases", Phase.VERIFYING in after || Phase.CLEANUP in after)
    }
  }

  /** A rename that fails outright (not only its sync) rolls back in the restoring process. */
  @Test
  fun aRenameThatFailsRollsBackInProcessAndRecoveryFinishesTheCleanup() {
    prepared(true)
    // `L_db → P_db` can't create its entry in D/restore.
    layout.restoreDbDir.setWritable(false)
    try {
      // The rollback itself succeeds; deleting D/restore in `rolledback` then fails.
      expectCode(RestoreException.RECOVERY_RETRY) { recovery.swap(restoreId) }
      assertEquals(listOf(Phase.SWAPPING, Phase.ROLLINGBACK, Phase.ROLLEDBACK), phases)
    } finally {
      layout.restoreDbDir.setWritable(true)
    }
    assertEquals(Outcome.Done, recovery.run())
    assertRolledBack(true)
  }

  /** v2.5 §4.2: the sync set before classifying and before every phase write; `N` after `N/restore` goes. */
  @Test
  fun directoriesAreSyncedBeforeEveryPhaseWriteAndAfterTheLastDeletion() {
    val syncSet = listOf("sync:databases", "sync:databases/restore", "sync:no_backup", "sync:no_backup/restore")
    prepared(true)
    recovery.swap(restoreId)
    events.clear()
    recovery.run()
    // Before classifying (the journal file itself is synced first, not recorded here).
    assertEquals(syncSet, events.take(4))
    reset()
    prepared(true)
    recovery.swap(restoreId)
    finish()
    val writes = events.withIndex().filter { it.value.startsWith("phase:") }.map { it.index }
    assertEquals(listOf("phase:SWAPPING", "phase:VERIFYING", "phase:CLEANUP"), writes.map { events[it] })
    for (i in writes) {
      // The write's own sync of N/restore, right after the sync set.
      assertEquals("sync:no_backup/restore", events[i - 1])
      assertEquals(syncSet, events.subList(i - 5, i - 1))
    }
    // The journal's deletion (sync of N/restore), then the empty N/restore's (sync of N).
    val deletion = events.lastIndexOf("sync:no_backup/restore")
    assertEquals("sync:no_backup", events[deletion + 1])
    assertNoRestoreLeft()
  }

  // --- Verification outcomes and Cancel restore (v2.5 §1, §2) --------------------------------------

  @Test
  fun aTransientOrKeyFailureKeepsEverything() {
    prepared(true)
    recovery.swap(restoreId)
    recovery.run()
    for (v in listOf(Verification.RETRY, Verification.UNAVAILABLE)) {
      val before = tree()
      recovery.finishVerification(v)
      assertEquals(before, tree())
      assertEquals(Phase.VERIFYING, phase())
    }
    // Retry verifies again.
    assertTrue(recovery.run() is Outcome.Verify)
  }

  /** D1: an entry step 4 can't have staged is unexplained, never a reason to roll back. */
  @Test
  fun anUnexpectedEntryAmongTheRestoredAttachmentsIsUnknown() {
    for (stray in listOf("kept-ids", "tmp", "notes.txt", "${id(9)}.tza")) {
      reset()
      prepared(true)
      recovery.swap(restoreId)
      val f = File(layout.liveAttachments, stray)
      if (stray == "tmp" || stray.endsWith(".tza")) f.mkdirs() else f.writeText("x")
      expectRefused(RestoreException.STATE_UNKNOWN) { recovery.run() }
    }
  }

  @Test
  fun cancelRestoreOffersThePreviousDataAndRollsBack() {
    prepared(true)
    recovery.swap(restoreId)
    recovery.run()
    recovery.finishVerification(Verification.RETRY)
    val before = tree()
    assertEquals(oldIds, recovery.previousData())
    assertEquals(before, tree())
    recovery.cancel()
    assertEquals(Phase.ROLLINGBACK, phase())
    // Previous data untouched by the cancel itself.
    assertArrayEquals(oldDb, layout.previousDb.readBytes())
    assertEquals(oldIds.map { "$it.tza" } + listOf("kept-ids", "tmp"), names(layout.previousAttachments))
    assertEquals(Outcome.Done, recovery.run())
    assertRolledBack(true)
  }

  @Test
  fun cancelRestoreIsUnavailableUnlessEveryConditionHolds() {
    fun verifying(h: Boolean = true) {
      reset()
      prepared(h)
      recovery.swap(restoreId)
      recovery.run()
    }
    // No RESTORE_VERIFY_RETRY in this process.
    verifying()
    expectRefused(RestoreException.CANCEL_UNAVAILABLE) { recovery.previousData() }
    expectRefused(RestoreException.CANCEL_UNAVAILABLE) { recovery.cancel() }
    // A key failure isn't a retry.
    recovery.finishVerification(Verification.UNAVAILABLE)
    expectRefused(RestoreException.CANCEL_UNAVAILABLE) { recovery.cancel() }
    // A new recovery run forgets the last outcome.
    recovery.finishVerification(Verification.RETRY)
    recovery.run()
    expectRefused(RestoreException.CANCEL_UNAVAILABLE) { recovery.cancel() }
    // P_db not whole pages.
    recovery.finishVerification(Verification.RETRY)
    layout.previousDb.writeBytes(ByteArray(100))
    expectRefused(RestoreException.CANCEL_UNAVAILABLE) { recovery.cancel() }
    // P_att missing: not the verifying row.
    verifying()
    recovery.finishVerification(Verification.RETRY)
    layout.previousAttachments.deleteRecursively()
    expectRefused(RestoreException.CANCEL_UNAVAILABLE) { recovery.cancel() }
    // Another phase.
    verifying()
    recovery.finishVerification(Verification.RETRY)
    writeJournal(Phase.CLEANUP, true)
    expectRefused(RestoreException.CANCEL_UNAVAILABLE) { recovery.cancel() }
    // Without attachments: no P_att is needed.
    verifying(h = false)
    recovery.finishVerification(Verification.RETRY)
    assertEquals(emptyList<String>(), recovery.previousData())
  }

  // --- Types, sidecars, pending, temp files (v2.5 §3) --------------------------------------------

  @Test
  fun aPathOfTheWrongTypeIsUnknownAndOneThatCantBeExaminedIsRetry() {
    fun verifying() {
      reset()
      prepared(true)
      recovery.swap(restoreId)
    }
    verifying()
    layout.liveDb.delete()
    layout.liveDb.mkdirs()
    expectRefused(RestoreException.STATE_UNKNOWN) { recovery.run() }
    verifying()
    layout.previousDb.delete()
    Files.createSymbolicLink(layout.previousDb.toPath(), layout.liveDb.toPath())
    expectRefused(RestoreException.STATE_UNKNOWN) { recovery.run() }
    verifying()
    layout.previousAttachments.deleteRecursively()
    layout.previousAttachments.writeText("x")
    expectRefused(RestoreException.STATE_UNKNOWN) { recovery.run() }
    verifying()
    layout.journal.delete()
    layout.journal.mkdirs()
    expectRefused(RestoreException.STATE_UNKNOWN) { recovery.run() }
    for (path in listOf(layout.liveDb, layout.previousAttachments, layout.restoreDir, layout.journal)) {
      verifying()
      unreadable += path.path
      expectRefused(RestoreException.RECOVERY_RETRY) { recovery.run() }
    }
  }

  @Test
  fun aSidecarOnceTheSwapMayHaveBegunIsUnknown() {
    for (phase in listOf(Phase.SWAPPING, Phase.VERIFYING, Phase.CLEANUP, Phase.ROLLINGBACK, Phase.ROLLEDBACK)) {
      for (db in listOf(layout.liveDb, layout.stagedDb, layout.previousDb)) {
        for (suffix in listOf("-journal", "-wal", "-shm")) {
          reset()
          prepared(true)
          recovery.swap(restoreId)
          writeJournal(phase, true)
          File(db.parentFile, db.name + suffix).also { it.parentFile!!.mkdirs() }.writeText("x")
          expectRefused(RestoreException.STATE_UNKNOWN) { recovery.decide() }
        }
      }
    }
  }

  @Test
  fun inPreparedALiveHotJournalIsLeftAndStagingSidecarsGoWithTheStaging() {
    prepared(true)
    File(layout.databaseDir, "trezor.db-journal").writeText("hot")
    File(layout.restoreDbDir, "trezor.db-journal").writeText("x")
    assertEquals(Outcome.Done, recovery.run())
    assertNoRestoreLeft()
    assertEquals("hot", File(layout.databaseDir, "trezor.db-journal").readText())
  }

  @Test
  fun aPendingScheduleOrASectionInTransitAfterPreparedIsUnknown() {
    for (phase in listOf(Phase.SWAPPING, Phase.VERIFYING, Phase.CLEANUP, Phase.ROLLINGBACK, Phase.ROLLEDBACK)) {
      reset()
      prepared(true)
      recovery.swap(restoreId)
      writeJournal(phase, true, RestoreJournal.Schedule.PENDING)
      expectRefused(RestoreException.STATE_UNKNOWN) { recovery.decide() }
      writeJournal(phase, true)
      layout.incomingAttachment.writeText("x")
      expectRefused(RestoreException.STATE_UNKNOWN) { recovery.decide() }
    }
  }

  @Test
  fun aTempJournalIsDeletedAndNeverRead() {
    prepared(true)
    recovery.swap(restoreId)
    layout.journalTmp.writeBytes(journal(Phase.CLEANUP, true).encode())
    assertTrue(recovery.decide() is Decision.Verify)
    assertFalse(layout.journalTmp.exists())
  }

  // --- Step 13a (v2.5 §6) -----------------------------------------------------------------------------

  @Test
  fun step13aRefusesAnythingButTheExactPreparedStateAndChangesNothing() {
    val cases: List<Pair<String, () -> Unit>> =
        listOf(
            "pending schedule" to { writeJournal(Phase.PREPARED, true, RestoreJournal.Schedule.PENDING) },
            "live hot journal" to { File(layout.databaseDir, "trezor.db-journal").writeText("x") },
            "staged wal" to { File(layout.restoreDbDir, "trezor.db-wal").writeText("x") },
            "section in transit" to { layout.incomingAttachment.writeText("x") },
            "no staged database" to { layout.stagedDb.delete() },
            "no staged attachments" to { layout.stagedAttachments.deleteRecursively() },
            "previous database" to { layout.previousDb.writeText("x") },
            "another phase" to { writeJournal(Phase.SWAPPING, true) },
        )
    for ((what, change) in cases) {
      reset()
      prepared(true)
      change()
      try {
        expectRefused(RestoreException.STATE_UNKNOWN) { recovery.swap(restoreId) }
      } catch (e: AssertionError) {
        throw AssertionError(what, e)
      }
    }
    reset()
    prepared(true)
    expectRefused(RestoreException.STATE_UNKNOWN) { recovery.swap("f".repeat(32)) }
  }
}
