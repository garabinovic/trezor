package com.trezor.app.restore

import com.trezor.app.attachments.AttachmentFormat
import com.trezor.app.attachments.AttachmentStore
import com.trezor.app.backup.BackupCreator
import com.trezor.app.backup.BackupFiles
import com.trezor.app.backup.BackupFormatException
import com.trezor.app.backup.BackupManifest
import com.trezor.app.backup.BackupPassword
import com.trezor.app.backup.BackupService
import com.trezor.app.reminders.ScheduleRestore
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Restore preparation on real files (spec v2.4 §8.2 steps 1–12 without the swap): backups
 * written by the production [BackupService] on a "source" device, restored on a "target"
 * device with another attachments key and its own live data. The JS steps (6, 9) are
 * stood in for by writing `S_db`; the schedule uses [ScheduleRestore] on real files with a
 * recording clear/re-arm.
 */
class RestoreServiceTest {

  @get:Rule val folder = TemporaryFolder()

  private val password = "correct horse battery"
  private val sourceKey = ByteArray(32) { 5 }
  private val targetKey = ByteArray(32) { 9 }
  private val exportBytes = ByteArray(6000) { (it * 13).toByte() }
  private val liveDbBytes = ByteArray(4096) { (it * 3).toByte() }

  private lateinit var layout: RestoreLayout
  private lateinit var service: RestoreService
  private var free = Long.MAX_VALUE
  private var failSync: (File) -> Boolean = { false }
  private val events = mutableListOf<String>()
  private var rearmFailures = 0
  private lateinit var schedule: ScheduleRestore

  private fun id(n: Int) = "01a1a0dd-991f-783c-9531-3fab9ef4%04d".format(n)

  @Before
  fun setUp() {
    val db = folder.newFolder("target", "databases")
    val nb = folder.newFolder("target", "no_backup")
    layout = RestoreLayout(db, nb)
    layout.liveDb.writeBytes(liveDbBytes)
    val ops =
        RestoreFileOps(
            layout,
            syncDirectory = { if (failSync(it)) throw java.io.IOException("sync failed") },
            link = { src, dst -> java.nio.file.Files.createLink(dst.toPath(), src.toPath()) })
    service =
        RestoreService(
            layout = layout,
            ops = ops,
            attachmentsKey = { targetKey.copyOf() },
            freeBytes = { free },
            deviceOf = { 1L },
        )
    layout.schedule.parentFile!!.mkdirs()
    layout.schedule.writeBytes(byteArrayOf(1, 2, 3, 4))
    schedule =
        ScheduleRestore(
            schedule = layout.schedule,
            saved = layout.savedSchedule,
            syncDirectory = {},
            clear = {
              events += "clear"
              layout.schedule.writeBytes(byteArrayOf(0))
            },
            isEmpty = { true },
            rearm = {
              if (rearmFailures > 0) {
                rearmFailures--
                throw java.io.IOException("alarm service")
              }
              events += "rearm"
            },
        )
  }

  // --- A source backup ------------------------------------------------------------------

  private class Backup(val bytes: ByteArray, val rows: List<BackupCreator.Row>, val trailer: String, val backupId: String)

  /** A backup of [count] attachments from a separate source device. */
  private fun backup(count: Int): Backup {
    val db = folder.newFolder()
    val nb = folder.newFolder()
    val store = AttachmentStore(File(nb, "attachments")) { sourceKey.copyOf() }
    val rows =
        (1..count).map { n ->
          val result = store.import(id(n), ByteArrayInputStream(ByteArray(1000 + n * 70_000) { (it + n).toByte() }), 1L shl 30)
          BackupCreator.Row(id(n), "item-$n", "f$n.pdf", "application/pdf", result.sizeBytes, result.sha256, 1)
        }
    File(db, "trezor.db").writeBytes(exportBytes)
    val source =
        BackupService(
            files = BackupFiles(db, nb, freeBytes = { Long.MAX_VALUE }),
            attachmentsKey = { sourceKey.copyOf() },
            fileOf = { File(File(nb, "attachments"), "$it.tza") },
            app = BackupManifest.App("android", "1.0", 1),
            liveDatabaseBytes = { exportBytes.size.toLong() },
        )
    val begun = source.begin(password, password)
    File(begun.exportDir, begun.exportName).writeBytes(exportBytes)
    val out = ByteArrayOutputStream()
    source.setDestination(begun.sessionId, MemoryDestination(out), "content://source")
    source.write(begun.sessionId, rows)
    val staged = source.readBack(begun.sessionId)
    source.finishCheck(staged.checkId)
    source.complete(begun.sessionId)
    return Backup(out.toByteArray(), rows, staged.result.trailer, staged.result.backupId)
  }

  private class MemoryDestination(val out: ByteArrayOutputStream) : BackupService.Destination {
    private var opened = false

    override fun size(): Long? = if (opened) out.size().toLong() else 0

    override fun openForWrite(): BackupService.Destination.Output {
      opened = true
      return object : BackupService.Destination.Output {
        override val stream: OutputStream = out

        override fun sync() {}

        override fun close() {}
      }
    }

    override fun openForRead(): InputStream = ByteArrayInputStream(out.toByteArray())

    override fun delete(): Boolean = true
  }

  // --- Target helpers -------------------------------------------------------------------

  private val liveRoot get() = layout.liveAttachments

  /** Live attachments on the target, under the target key. */
  private fun liveAttachment(n: Int) {
    AttachmentStore(liveRoot) { targetKey.copyOf() }.import(id(500 + n), ByteArrayInputStream(ByteArray(500) { n.toByte() }), 1L shl 20)
  }

  private fun snapshotLive(): Map<String, String> =
      (listOf(layout.liveDb) + liveRoot.walk().filter { it.isFile }.toList()).associate {
        it.relativeTo(layout.databaseDir.parentFile!!).path to sha(it.readBytes())
      }

  private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

  private fun begin(b: Backup, pw: String = password) = service.begin(ByteArrayInputStream(b.bytes), pw)

  /** Stands in for JS step 6: `S_db` written, `incoming.db` deleted. */
  private fun jsStep6(sessionId: String) {
    layout.stagedDb.writeBytes(byteArrayOf(7, 7, 7))
    service.deleteIncoming(sessionId)
  }

  private fun assertNothingLeft() {
    assertFalse(layout.restoreDbDir.exists())
    assertFalse(layout.restoreDir.exists())
    assertNull(service.journals.read())
  }

  // --- The whole preparation, then the pre-swap failure path ---------------------------------

  @Test
  fun preparationStagesEverythingAndTheFailurePathRestoresTheOldState() {
    val b = backup(3)
    liveAttachment(1)
    liveAttachment(2)
    // id 501 is kept (no row knows it); 502 is referenced.
    AttachmentStore(liveRoot) { targetKey.copyOf() }.keepUnreferenced(setOf(id(502)))
    val live = snapshotLive()
    val schedule0 = layout.schedule.readBytes()
    // An earlier restore's quarantine is never touched.
    val older = File(layout.quarantineRoot, "f".repeat(32)).also { it.mkdirs() }
    File(older, "${id(900)}.tza").writeText("old")

    val begun = begin(b)
    assertEquals(3, begun.attachments)
    assertEquals(b.backupId, begun.backupId)
    // Step 1 writes nothing.
    assertFalse(layout.restoreDir.exists())
    assertFalse(layout.restoreDbDir.exists())

    val staged = service.stage(begun.sessionId, b.backupId, b.trailer)
    try {
      // Step 3: the journal.
      val journal = service.journals.read()!!
      assertEquals(RestoreJournal.Phase.PREPARED, journal.phase)
      assertTrue(journal.hadAttachments)
      assertEquals(RestoreJournal.Schedule.PENDING, journal.scheduleSaved)
      assertEquals(staged.restoreId, journal.restoreId)
      // Step 4: the artifact, byte for byte, and S_att under the *target* key only.
      assertArrayEquals(exportBytes, layout.incoming.readBytes())
      assertEquals(b.rows.map { "${it.id}.tza" }.sorted(), layout.stagedAttachments.list()!!.sorted())
      for (row in b.rows) {
        val file = File(layout.stagedAttachments, "${row.id}.tza")
        val result = file.inputStream().use { AttachmentFormat.decrypt(it, NullOut, row.id, targetKey) }
        assertEquals(row.sha256, result.sha256)
        try {
          file.inputStream().use { AttachmentFormat.decrypt(it, NullOut, row.id, sourceKey) }
          fail("staged file readable with the source device key")
        } catch (e: AttachmentFormat.FormatException) {
          // expected
        }
      }
      assertFalse(layout.incomingAttachment.exists())
    } finally {
      staged.sqlcipherKey.fill(0)
    }

    jsStep6(begun.sessionId)
    assertFalse(layout.incoming.exists())
    // Steps 7–8: kept file linked into this restore's quarantine; the original stays.
    val outcome = service.preserveRetained(begun.sessionId)
    assertEquals(1, outcome.linked)
    assertEquals(0, outcome.missing)
    val q = layout.quarantine(staged.restoreId)
    assertEquals(listOf("${id(501)}.tza"), q.list()!!.toList())
    assertArrayEquals(File(liveRoot, "${id(501)}.tza").readBytes(), File(q, "${id(501)}.tza").readBytes())

    // Steps 10–11.
    assertEquals(RestoreJournal.Schedule.SAVED, service.saveAndClearSchedule(begun.sessionId, schedule))
    assertEquals(RestoreJournal.Schedule.SAVED, service.journals.read()!!.scheduleSaved)
    assertArrayEquals(schedule0, layout.savedSchedule.readBytes())
    assertEquals(listOf("clear"), events)

    // The live data hasn't been touched by any step.
    assertEquals(live, snapshotLive())

    // Pre-swap failure: schedule back and re-armed, staging and this quarantine gone.
    service.abort(begun.sessionId, schedule)
    assertEquals(listOf("clear", "rearm"), events)
    assertArrayEquals(schedule0, layout.schedule.readBytes())
    assertNothingLeft()
    assertFalse(q.exists())
    assertEquals("old", File(older, "${id(900)}.tza").readText())
    assertEquals(live, snapshotLive())
  }

  @Test
  fun zeroAttachmentsStillCreateAnEmptyStagedRootAndNoLiveRootIsRecorded() {
    val b = backup(0)
    val begun = begin(b)
    val staged = service.stage(begun.sessionId, null, null)
    staged.sqlcipherKey.fill(0)
    assertTrue(layout.stagedAttachments.isDirectory)
    assertEquals(0, layout.stagedAttachments.list()!!.size)
    assertFalse(service.journals.read()!!.hadAttachments)
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
  }

  // --- Failures ----------------------------------------------------------------------------

  @Test
  fun aWrongPasswordOrTooLittleSpaceWritesNothing() {
    val b = backup(1)
    try {
      begin(b, "another long password")
      fail("wrong password accepted")
    } catch (e: BackupFormatException) {
      assertEquals(BackupFormatException.Code.BACKUP_PASSWORD_OR_HEADER, e.code)
    }
    try {
      begin(b, "short")
      fail("short password accepted")
    } catch (e: BackupPassword.PasswordException) {
      assertEquals(BackupPassword.PasswordException.Code.PASSWORD_LENGTH, e.code)
    }
    free = 1000
    try {
      begin(b)
      fail("restore without space")
    } catch (e: BackupFiles.InsufficientSpace) {
      // expected
    }
    assertFalse(layout.restoreDir.exists())
    assertFalse(layout.restoreDbDir.exists())
  }

  @Test
  fun aBackupThatDiffersFromTheCheckedOneStopsBeforeStep6() {
    val b = backup(1)
    val live = snapshotLive()
    val begun = begin(b)
    try {
      service.stage(begun.sessionId, b.backupId, "0".repeat(64))
      fail("changed backup accepted")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.BACKUP_CHANGED, e.code)
    }
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
    // The schedule was never cleared (pending): it stays as it was.
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), layout.schedule.readBytes())
    assertEquals(live, snapshotLive())
  }

  @Test
  fun aDamagedAttachmentSectionFailsStagingAndIsCleanedUp() {
    val b = backup(2)
    // A byte inside the second attachment section's ciphertext (well before the trailer).
    val damaged = b.bytes.copyOf().also { it[it.size - 32 - 2000] = (it[it.size - 32 - 2000].toInt() xor 1).toByte() }
    val begun = service.begin(ByteArrayInputStream(damaged), password)
    try {
      service.stage(begun.sessionId, null, null)
      fail("damaged section accepted")
    } catch (e: BackupFormatException) {
      assertEquals(BackupFormatException.Code.BACKUP_CORRUPT, e.code)
    }
    assertFalse(layout.incomingAttachment.exists())
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
  }

  @Test
  fun aTruncatedFileFailsStaging() {
    val b = backup(1)
    val begun = service.begin(ByteArrayInputStream(b.bytes.copyOf(b.bytes.size - 10)), password)
    try {
      service.stage(begun.sessionId, null, null)
      fail("truncated file accepted")
    } catch (e: BackupFormatException) {
      assertEquals(BackupFormatException.Code.BACKUP_CORRUPT, e.code)
    }
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
  }

  @Test
  fun aFailingCleanupKeepsTheJournalAndReportsRecoveryRetry() {
    val b = backup(1)
    val begun = begin(b)
    service.stage(begun.sessionId, null, null).sqlcipherKey.fill(0)
    jsStep6(begun.sessionId)
    service.saveAndClearSchedule(begun.sessionId, schedule)
    // Deleting D/restore syncs its parent, the database directory: make that fail.
    failSync = { it == layout.databaseDir }
    try {
      service.abort(begun.sessionId, schedule)
      fail("cleanup failure hidden")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.RECOVERY_RETRY, e.code)
    }
    // Stopped at once: the journal is still there for recovery (Step 4).
    assertTrue(layout.journal.exists())
    // Retrying in the same session resumes and finishes.
    failSync = { false }
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
  }

  // --- Review corrections: M1 / L1 -----------------------------------------------------------

  @Test
  fun aFailedRearmKeepsEverythingAndARetryInTheSameSessionFinishes() {
    val b = backup(1)
    val schedule0 = layout.schedule.readBytes()
    val begun = begin(b)
    service.stage(begun.sessionId, null, null).sqlcipherKey.fill(0)
    jsStep6(begun.sessionId)
    service.saveAndClearSchedule(begun.sessionId, schedule)
    rearmFailures = 1
    try {
      service.abort(begun.sessionId, schedule)
      fail("rearm failure hidden")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.RECOVERY_RETRY, e.code)
    }
    // The journal (saved) and the staging stay. The schedule was copied back durably and
    // its saved copy deleted before re-arming (review L-A), so the retry only re-arms.
    assertEquals(RestoreJournal.Schedule.SAVED, service.journals.read()!!.scheduleSaved)
    assertFalse(layout.savedSchedule.exists())
    assertArrayEquals(schedule0, layout.schedule.readBytes())
    assertTrue(layout.restoreDbDir.isDirectory)
    service.abort(begun.sessionId, schedule)
    assertEquals(1, events.count { it == "rearm" })
    assertArrayEquals(schedule0, layout.schedule.readBytes())
    assertNothingLeft()
  }

  @Test
  fun anUnknownOrFinishedSessionIsRefusedNotReportedAsDone() {
    try {
      service.abort("0".repeat(32), schedule)
      fail("unknown session accepted")
    } catch (e: IllegalStateException) {
      // expected
    }
    val begun = begin(backup(0))
    service.stage(begun.sessionId, null, null).sqlcipherKey.fill(0)
    service.abort(begun.sessionId, schedule)
    try {
      service.abort(begun.sessionId, schedule)
      fail("finished session accepted again")
    } catch (e: IllegalStateException) {
      // expected
    }
  }

  @Test
  fun aJournalWriteThatFailsBeforeTheRenameIsCleanedUpAsThisSessionsOwn() {
    val begun = begin(backup(1))
    // Creating N/restore syncs N: fail it, so no journal is ever renamed into place.
    failSync = { it == layout.noBackupDir }
    try {
      service.stage(begun.sessionId, null, null)
      fail("journal failure hidden")
    } catch (e: java.io.IOException) {
      // expected
    }
    assertTrue(layout.restoreDir.isDirectory)
    assertFalse(layout.journal.exists())
    // A temp file a failed write can leave.
    layout.journalTmp.writeText("{")
    failSync = { false }
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
    // The schedule was never touched.
    assertArrayEquals(byteArrayOf(1, 2, 3, 4), layout.schedule.readBytes())
  }

  @Test
  fun aDirectorySyncFailureAfterTheJournalRenameIsCleanedUpThroughThatJournal() {
    val begun = begin(backup(1))
    var syncs = 0
    // The journal's own directory sync (after its rename) fails, once.
    failSync = { it == layout.restoreDir && syncs++ == 0 }
    try {
      service.stage(begun.sessionId, null, null)
      fail("sync failure hidden")
    } catch (e: java.io.IOException) {
      // expected
    }
    assertEquals(RestoreJournal.Phase.PREPARED, service.journals.read()!!.phase)
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
  }

  @Test
  fun restoreFilesWithoutAJournalAreNeverJudgedDone() {
    val begun = begin(backup(1))
    failSync = { it == layout.noBackupDir }
    try {
      service.stage(begun.sessionId, null, null)
      fail("journal failure hidden")
    } catch (e: java.io.IOException) {
      // expected
    }
    failSync = { false }
    // Something under N/restore this session didn't write: not deleted, not "done".
    val stranger = File(layout.restoreDir, "unexplained").also { it.writeText("x") }
    try {
      service.abort(begun.sessionId, schedule)
      fail("leftover reported as cleaned up")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.RECOVERY_RETRY, e.code)
    }
    assertTrue(stranger.exists())
    stranger.delete()
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
  }

  /** Review M-A: refused in step 1, before any session or gate, and left untouched. */
  @Test
  fun restoreFilesWithoutAJournalAreRefusedBeforeAnySession() {
    val b = backup(0)
    val marker = "earlier"
    for (dirs in listOf(listOf(layout.restoreDir), listOf(layout.restoreDbDir), listOf(layout.restoreDir, layout.restoreDbDir))) {
      dirs.forEach { File(it, "left.bin").also { f -> f.parentFile.mkdirs(); f.writeText(marker) } }
      try {
        begin(b)
        fail("began over earlier restore files")
      } catch (e: RestoreException) {
        assertEquals(RestoreException.STATE_UNKNOWN, e.code)
      }
      // Untouched, nothing new written.
      dirs.forEach { assertEquals(listOf("left.bin"), it.list()!!.toList()); assertEquals(marker, File(it, "left.bin").readText()) }
      assertFalse(layout.journal.exists())
      dirs.forEach { it.deleteRecursively() }
    }
    assertFalse(layout.restoreDir.exists() || layout.restoreDbDir.exists())
    // No session was left behind: a clean begin works.
    val begun = begin(b)
    service.stage(begun.sessionId, null, null).sqlcipherKey.fill(0)
    service.abort(begun.sessionId, schedule)
    assertNothingLeft()
  }

  /** Staging still refuses them too (a backstop if they appear after step 1). */
  @Test
  fun restoreFilesAppearingAfterStep1BlockStaging() {
    val begun = begin(backup(0))
    layout.restoreDir.mkdirs()
    try {
      service.stage(begun.sessionId, null, null)
      fail("staged over earlier restore files")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.STATE_UNKNOWN, e.code)
    }
    try {
      service.abort(begun.sessionId, schedule)
      fail("leftover reported as cleaned up")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.RECOVERY_RETRY, e.code)
    }
    assertTrue(layout.restoreDir.isDirectory)
  }

  @Test
  fun aJournalOrStagingLeftoverBlocksAnotherRestore() {
    val b = backup(1)
    layout.restoreDir.mkdirs()
    layout.journal.writeText("{}")
    try {
      begin(b)
      fail("restore with a journal present")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.STATE_UNKNOWN, e.code)
    }
    val p = service.preflight(false, { true }, { true })
    assertEquals(RestoreException.STATE_UNKNOWN, (p as RestoreService.Preflight.Refused).code)
  }

  // --- §8.1 preconditions -------------------------------------------------------------------

  @Test
  fun preflightFollowsTheSpecsPreconditions() {
    fun code(p: RestoreService.Preflight) = (p as? RestoreService.Preflight.Refused)?.code
    assertEquals(RestoreService.Preflight.Ready, service.preflight(false, { true }, { true }))
    // A missing or unusable database key.
    assertEquals(RestoreException.UNAVAILABLE, code(service.preflight(false, { false }, { true })))
    // An attachments key that doesn't unwrap.
    assertEquals(RestoreException.UNAVAILABLE, code(service.preflight(false, { true }, { false })))
    // No attachments key: fine while no encrypted file exists anywhere…
    assertEquals(RestoreService.Preflight.Ready, service.preflight(false, { true }, { null }))
    // …but not with one in any location, quarantine included.
    File(layout.quarantineRoot, "a".repeat(32)).also { it.mkdirs() }.resolve("${id(1)}.tza").writeText("x")
    assertEquals(RestoreException.UNAVAILABLE, code(service.preflight(false, { true }, { null })))
    // A hot journal refuses the error-screen entry only.
    layout.liveDbJournal.writeText("hot")
    assertEquals(RestoreService.Preflight.Ready, service.preflight(false, { true }, { true }))
    assertEquals(RestoreException.STATE_UNKNOWN, code(service.preflight(true, { true }, { true })))
    // Without a database file, no restore entry at all.
    layout.liveDb.delete()
    assertEquals(RestoreService.Preflight.NotOffered, service.preflight(true, { true }, { true }))
  }

  private object NullOut : OutputStream() {
    override fun write(b: Int) {}

    override fun write(b: ByteArray, off: Int, len: Int) {}
  }
}
