package com.trezor.app.backup

import com.trezor.app.attachments.AttachmentFormat
import com.trezor.app.attachments.AttachmentStore
import com.trezor.app.backup.BackupCreator.AttachmentUnreadable
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
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
 * Backup creation and Check backup, end to end on real files (spec v2.4 §6, §7): a real
 * attachment store with TZA files, an export file (opaque to native code, as the SQLCipher
 * artifact is), and an in-memory destination that can fail at every step.
 */
class BackupServiceTest {

  @get:Rule val folder = TemporaryFolder()

  private val password = "correct horse battery"
  private val deviceKey = ByteArray(32) { 5 }
  private lateinit var databaseDir: File
  private lateinit var noBackupDir: File
  private lateinit var store: AttachmentStore
  private var free = Long.MAX_VALUE
  private var keyAvailable = true
  private lateinit var files: BackupFiles
  private lateinit var service: BackupService
  private val exportBytes = ByteArray(5000) { (it * 7).toByte() }

  private fun id(n: Int) = "01a1a0dd-991f-783c-9531-3fab9ef4%04d".format(n)

  @Before
  fun setUp() {
    databaseDir = folder.newFolder("databases")
    noBackupDir = folder.newFolder("no_backup")
    store = AttachmentStore(File(noBackupDir, "attachments")) { deviceKey.copyOf() }
    files = BackupFiles(databaseDir, noBackupDir, freeBytes = { free })
    File(databaseDir, "trezor.db").writeBytes(exportBytes)
    service =
        BackupService(
            files = files,
            attachmentsKey = { if (keyAvailable) deviceKey.copyOf() else null },
            fileOf = { File(File(noBackupDir, "attachments"), "$it.tza") },
            app = BackupManifest.App("android", "1.0", 1),
            liveDatabaseBytes = { File(databaseDir, "trezor.db").length() },
            now = { 1793000000000 },
        )
  }

  /** Imports an attachment; returns its row as the export would have it. */
  private fun attachment(n: Int, size: Int = 1000, item: String = "item-$n"): BackupCreator.Row {
    val plain = ByteArray(size) { (it + n).toByte() }
    val result = store.import(id(n), ByteArrayInputStream(plain), 1L shl 30)
    return BackupCreator.Row(id(n), item, "f$n.pdf", "application/pdf", result.sizeBytes, result.sha256, 1)
  }

  /** A destination that keeps the file in memory and can fail where asked. */
  private class Destination : BackupService.Destination {
    var reported: Long? = 0
    val written = ByteArrayOutputStream()
    var deleted = false
    var deletable = true
    var failWrite = false
    var failSync = false
    var failClose = false
    var sizeAfter: ((Long) -> Long?)? = null
    var readBack: ((ByteArray) -> ByteArray)? = null
    /** Runs once, at the first byte written (while the creator holds the gate). */
    var onFirstWrite: (() -> Unit)? = null
    private var opened = false

    override fun size(): Long? {
      if (!opened) return reported
      val after = sizeAfter ?: return written.size().toLong()
      return after(written.size().toLong())
    }

    override fun openForWrite(): BackupService.Destination.Output {
      opened = true
      return object : BackupService.Destination.Output {
        override val stream: OutputStream =
            object : OutputStream() {
              override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

              override fun write(b: ByteArray, off: Int, len: Int) {
                if (failWrite && written.size() > 1000) throw IOException("ENOSPC")
                onFirstWrite?.let {
                  onFirstWrite = null
                  it()
                }
                written.write(b, off, len)
              }
            }

        override fun sync() {
          if (failSync) throw java.io.SyncFailedException("sync failed")
        }

        override fun close() {
          if (failClose) throw IOException("close failed")
        }
      }
    }

    /** Read streams opened and not yet closed. */
    var openReads = 0

    override fun openForRead(): InputStream {
      openReads++
      return object : ByteArrayInputStream(readBack?.invoke(written.toByteArray()) ?: written.toByteArray()) {
        private var closed = false

        override fun close() {
          if (!closed) openReads--
          closed = true
        }
      }
    }

    override fun delete(): Boolean {
      if (!deletable) return false
      deleted = true
      return true
    }
  }

  /** Begins a session and puts the "export" where the JS side's ATTACH would have. */
  private fun begin(destination: Destination = Destination()): Pair<BackupService.Begun, Destination> {
    val begun = service.begin(password, password)
    File(begun.exportDir, begun.exportName).writeBytes(exportBytes)
    service.setDestination(begun.sessionId, destination, "content://test/backup")
    return begun to destination
  }

  private fun hashes(): Map<String, String> =
      File(noBackupDir, "attachments").walk().filter { it.isFile }.associate {
        it.relativeTo(noBackupDir).path to sha(it.readBytes())
      }

  private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

  // --- Creation ---------------------------------------------------------------------------

  @Test
  fun aBackupIsWrittenReadBackAndCheckedWithItsAttachments() {
    val rows = listOf(attachment(2), attachment(1, size = 70_000), attachment(3, size = 0))
    val before = hashes()
    val (begun, dest) = begin()

    val length = service.write(begun.sessionId, rows)
    assertEquals(dest.written.size().toLong(), length)
    // The export is gone once written; the pending record stays until complete().
    assertFalse(File(begun.exportDir, begun.exportName).exists())
    assertTrue(File(noBackupDir, "backup/pending-destination").exists())

    val staged = service.readBack(begun.sessionId)
    assertEquals("the read-back stream is closed", 0, dest.openReads)
    assertArrayEquals(exportBytes, staged.result.incoming.readBytes())
    assertEquals(listOf(id(1), id(2), id(3)), staged.result.manifest.attachments.map { it.id })
    assertEquals(64, staged.result.trailer.length)
    assertArrayEquals(begun.sqlcipherKey, staged.result.sqlcipherKey)
    service.finishCheck(staged.checkId)
    assertFalse(staged.result.incoming.parentFile!!.exists())
    service.complete(begun.sessionId)
    assertFalse(File(noBackupDir, "backup/pending-destination").exists())

    // The same file passes Check backup with the password, and the live store is unchanged.
    val checked = service.check(ByteArrayInputStream(dest.written.toByteArray()), password)
    assertEquals(3, checked.result.manifest.attachments.size)
    service.finishCheck(checked.checkId)
    assertEquals(before, hashes())
  }

  @Test
  fun aBackupWithoutAttachmentsNeedsNoAttachmentKey() {
    keyAvailable = false
    val (begun, _) = begin()
    service.write(begun.sessionId, emptyList())
    val staged = service.readBack(begun.sessionId)
    assertEquals(0, staged.result.manifest.attachments.size)
  }

  @Test
  fun attachmentsWithoutTheirKeyFailWithKeyUnavailable() {
    val rows = listOf(attachment(1))
    keyAvailable = false
    val (begun, dest) = begin()
    try {
      service.write(begun.sessionId, rows)
      fail("written without the attachment key")
    } catch (e: BackupService.DestinationException) {
      assertEquals(BackupService.KEY_UNAVAILABLE, e.code)
    }
    assertEquals(0, dest.written.size())
  }

  @Test
  fun theSectionHoldsTheSameBodyWithOnlyTheDekRewrapped() {
    val row = attachment(1, size = 200_000)
    val original = File(noBackupDir, "attachments/${row.id}.tza").readBytes()
    val (begun, dest) = begin()
    service.write(begun.sessionId, listOf(row))
    TzbkReader.open(ByteArrayInputStream(dest.written.toByteArray()), password.toByteArray()).use { r ->
      val manifest = BackupManifest.decode(r.readManifest())
      r.readDatabase(ByteArrayOutputStream())
      val section = ByteArrayOutputStream().also { r.readAttachment(0, manifest.attachments[0].tzaSizeBytes, it) }.toByteArray()
      assertEquals(original.size, section.size)
      // Header bytes 9–68 (wrap IV and wrapped DEK) differ; magic, chunk size, prefix and body don't.
      assertArrayEquals(original.copyOfRange(0, 9), section.copyOfRange(0, 9))
      assertArrayEquals(original.copyOfRange(69, original.size), section.copyOfRange(69, section.size))
      val plain = ByteArrayOutputStream()
      val wrap = r.attachmentWrapKey()
      AttachmentFormat.decrypt(ByteArrayInputStream(section), plain, row.id, wrap)
      assertEquals(row.sha256, sha(plain.toByteArray()))
      // Not decryptable with the device key any more.
      try {
        AttachmentFormat.decrypt(ByteArrayInputStream(section), ByteArrayOutputStream(), row.id, deviceKey)
        fail("the section still opens with the device key")
      } catch (e: AttachmentFormat.FormatException) {
        assertEquals(AttachmentFormat.FormatException.Code.KEY_MISMATCH, e.code)
      }
    }
  }

  // --- Attachments that can't be backed up (M-e) ------------------------------------------

  private fun expectUnreadable(rows: List<BackupCreator.Row>, id: String, item: String, reason: AttachmentUnreadable.Reason) {
    val (begun, dest) = begin()
    try {
      service.write(begun.sessionId, rows)
      fail("backed up with a bad attachment")
    } catch (e: AttachmentUnreadable) {
      assertEquals(id, e.attachmentId)
      assertEquals(item, e.itemId)
      assertEquals(reason, e.reason)
    }
    // Nothing was written: every file is checked before the first byte. The picked
    // (empty) document is deleted.
    assertEquals(0, dest.written.size())
    assertEquals("deleted", service.abort(begun.sessionId))
    assertTrue(dest.deleted)
    assertFalse(BackupGate.isHeld())
  }

  @Test
  fun aMissingAttachmentFailsTheBackupNamingItAndItsItem() {
    val good = attachment(1)
    val gone = attachment(2)
    store.delete(gone.id)
    expectUnreadable(listOf(good, gone), gone.id, "item-2", AttachmentUnreadable.Reason.MISSING)
  }

  @Test
  fun aDamagedAttachmentFailsTheBackup() {
    val row = attachment(1, size = 5000)
    val file = File(noBackupDir, "attachments/${row.id}.tza")
    val bytes = file.readBytes().also { it[200] = (it[200].toInt() xor 1).toByte() }
    file.writeBytes(bytes)
    expectUnreadable(listOf(row), row.id, "item-1", AttachmentUnreadable.Reason.DAMAGED)
  }

  @Test
  fun anAttachmentNotMatchingItsRowFailsTheBackup() {
    val row = attachment(1)
    expectUnreadable(listOf(row.copy(sha256 = "0".repeat(64))), row.id, "item-1", AttachmentUnreadable.Reason.MISMATCH)
    expectUnreadable(listOf(row.copy(sizeBytes = row.sizeBytes + 1)), row.id, "item-1", AttachmentUnreadable.Reason.MISMATCH)
  }

  @Test
  fun anAttachmentUnderAnotherKeyIsDamaged() {
    val other = AttachmentStore(File(noBackupDir, "attachments")) { ByteArray(32) { 9 } }
    val result = other.import(id(1), ByteArrayInputStream(ByteArray(100)), 1L shl 20)
    val row = BackupCreator.Row(id(1), "item-1", "a.pdf", "application/pdf", result.sizeBytes, result.sha256, 1)
    expectUnreadable(listOf(row), row.id, "item-1", AttachmentUnreadable.Reason.DAMAGED)
  }

  // --- Destination ------------------------------------------------------------------------

  @Test
  fun aDestinationThatIsNotEmptyOrDoesNotReportItsSizeIsRefusedAndNeverTouched() {
    for ((reported, code) in listOf<Pair<Long?, String>>(null to BackupService.DESTINATION_UNVERIFIED, 5L to BackupService.DESTINATION_NOT_EMPTY)) {
      val begun = service.begin(password, password)
      val dest = Destination().also { it.reported = reported }
      try {
        service.setDestination(begun.sessionId, dest, "content://x")
        fail("accepted a destination reporting $reported")
      } catch (e: BackupService.DestinationException) {
        assertEquals(code, e.code)
      }
      assertEquals("none", service.abort(begun.sessionId))
      assertFalse(dest.deleted)
    }
  }

  private var nextAttachment = 100

  private fun expectWriteFailure(configure: Destination.() -> Unit, check: (Exception) -> Unit = {}) {
    val rows = listOf(attachment(nextAttachment++, size = 70_000))
    val (begun, dest) = begin(Destination().apply(configure))
    try {
      service.write(begun.sessionId, rows)
      fail("reported as written")
    } catch (e: Exception) {
      check(e)
    }
    assertFalse("the gate is released", BackupGate.isHeld())
    assertFalse("the export is deleted", File(begun.exportDir, begun.exportName).exists())
    assertEquals(if (dest.deletable) "deleted" else "remains", service.abort(begun.sessionId))
    assertFalse(File(noBackupDir, "backup/pending-destination").exists())
  }

  @Test
  fun failuresWhileWritingSyncingOrClosingDeleteThePartialFile() {
    expectWriteFailure({ failWrite = true })
    expectWriteFailure({ failSync = true })
    expectWriteFailure({ failClose = true })
  }

  @Test
  fun aFinalSizeThatIsUnknownOrWrongIsNotAVerifiedBackup() {
    expectWriteFailure({ sizeAfter = { null } }) { assertEquals(BackupService.DESTINATION_UNVERIFIED, (it as BackupService.DestinationException).code) }
    expectWriteFailure({ sizeAfter = { it - 1 } }) { assertEquals(BackupService.DESTINATION_UNVERIFIED, (it as BackupService.DestinationException).code) }
  }

  @Test
  fun aPartialFileThatCannotBeDeletedIsReportedAsRemaining() {
    expectWriteFailure({
      failWrite = true
      deletable = false
    })
  }

  @Test
  fun aReadBackThatDiffersFromWhatWasWrittenFails() {
    for (damage in listOf<(ByteArray) -> ByteArray>({ it.copyOf(it.size - 1) }, { it + byteArrayOf(0) }, { it.copyOf().also { b -> b[b.size / 2] = (b[b.size / 2].toInt() xor 1).toByte() } })) {
      val (begun, dest) = begin(Destination().also { it.readBack = damage })
      service.write(begun.sessionId, listOf(attachment(1)))
      try {
        service.readBack(begun.sessionId)
        fail("a damaged read-back passed")
      } catch (e: BackupFormatException) {
        assertEquals(BackupFormatException.Code.BACKUP_CORRUPT, e.code)
      }
      assertEquals("the read-back stream is closed", 0, dest.openReads)
      assertTrue("no staged check is left", File(databaseDir, "check").listFiles().orEmpty().isEmpty())
      assertEquals("deleted", service.abort(begun.sessionId))
      assertTrue(dest.deleted)
      store.delete(id(1))
    }
  }

  // --- Gate ---------------------------------------------------------------------------------

  @Test
  fun deletingAnExportedAttachmentDuringTheWriteWaitsForTheGate() {
    val rows = listOf(attachment(1), attachment(2))
    val outside = attachment(3)
    val deletedLater = mutableListOf<String>()
    BackupGate.deleter = { deletedLater += it }
    try {
      var now: List<String>? = null
      val dest = Destination().also { it.onFirstWrite = { now = BackupGate.filterDeletion(listOf(id(1), outside.id)) } }
      val (begun, _) = begin(dest)
      service.write(begun.sessionId, rows)
      // Asked while the gate was held: only the file outside the backup could go at once;
      // the exported one went when the gate was released.
      assertEquals(listOf(outside.id), now)
      assertEquals(listOf(id(1)), deletedLater)
      assertFalse(BackupGate.isHeld())
      // Without a gate, nothing is deferred.
      assertEquals(listOf(id(2)), BackupGate.filterDeletion(listOf(id(2))))
    } finally {
      BackupGate.deleter = null
    }
  }

  @Test
  fun aFailedWriteStillReleasesTheGateAndRunsDeferredDeletions() {
    val rows = listOf(attachment(1))
    val deletedLater = mutableListOf<String>()
    BackupGate.deleter = { deletedLater += it }
    try {
      val dest = Destination().also {
        it.onFirstWrite = { BackupGate.filterDeletion(listOf(id(1))) }
        it.failSync = true
      }
      val (begun, _) = begin(dest)
      try {
        service.write(begun.sessionId, rows)
        fail("written")
      } catch (e: java.io.SyncFailedException) {
        // expected
      }
      assertFalse(BackupGate.isHeld())
      assertEquals(listOf(id(1)), deletedLater)
    } finally {
      BackupGate.deleter = null
    }
  }

  @Test
  fun aSecondBackupCannotStartWhileOneIsRunning() {
    service.begin(password, password)
    try {
      service.begin(password, password)
      fail("two sessions")
    } catch (e: IllegalStateException) {
      // expected
    }
  }

  // --- Password, space, memory --------------------------------------------------------------

  @Test
  fun passwordRulesApplyBeforeAnyKeyIsMade() {
    for ((pw, confirm, code) in
        listOf(
            Triple("short", "short", BackupPassword.PasswordException.Code.PASSWORD_LENGTH),
            Triple("correct horse battery", "correct horse batterY", BackupPassword.PasswordException.Code.PASSWORD_MISMATCH),
            Triple("correct horse ‮battery", "correct horse ‮battery", BackupPassword.PasswordException.Code.PASSWORD_CHARACTER),
            Triple("correct horse \uD800battery", "correct horse \uD800battery", BackupPassword.PasswordException.Code.PASSWORD_INVALID),
        )) {
      try {
        service.begin(pw, confirm)
        fail("accepted $pw")
      } catch (e: BackupPassword.PasswordException) {
        assertEquals(code, e.code)
      }
    }
    assertFalse(File(databaseDir, "backup").exists())
  }

  @Test
  fun notEnoughSpaceForTheExportStopsBeforeArgon2() {
    free = exportBytes.size + BackupFiles.MARGIN_BYTES - 1
    try {
      service.begin(password, password)
      fail("began without space")
    } catch (e: BackupFiles.InsufficientSpace) {
      assertEquals(exportBytes.size + BackupFiles.MARGIN_BYTES, e.needed)
    }
  }

  // --- Check backup -------------------------------------------------------------------------

  private fun writtenBackup(rows: List<BackupCreator.Row> = listOf(attachment(1), attachment(2))): ByteArray {
    val (begun, dest) = begin()
    service.write(begun.sessionId, rows)
    service.complete(begun.sessionId)
    return dest.written.toByteArray()
  }

  private fun expectCheckFails(bytes: ByteArray, code: BackupFormatException.Code, pw: String = password) {
    val before = hashes()
    try {
      service.check(ByteArrayInputStream(bytes), pw)
      fail("checked")
    } catch (e: BackupFormatException) {
      assertEquals(code, e.code)
    }
    assertTrue("staging is cleaned up", File(databaseDir, "check").listFiles().orEmpty().isEmpty())
    assertEquals("live attachments unchanged", before, hashes())
  }

  @Test
  fun checkRejectsWrongPasswordsDamageTruncationAndTrailingData() {
    val good = writtenBackup()
    expectCheckFails(good, BackupFormatException.Code.BACKUP_PASSWORD_OR_HEADER, "correct horse batterz")
    expectCheckFails(good.copyOf(good.size - 1), BackupFormatException.Code.BACKUP_CORRUPT)
    expectCheckFails(good.copyOf(200), BackupFormatException.Code.BACKUP_CORRUPT)
    expectCheckFails(good + byteArrayOf(1), BackupFormatException.Code.BACKUP_CORRUPT)
    // A byte in the last attachment section, and one in the trailer.
    for (offset in listOf(good.size - 100, good.size - 1)) {
      expectCheckFails(good.copyOf().also { it[offset] = (it[offset].toInt() xor 1).toByte() }, BackupFormatException.Code.BACKUP_CORRUPT)
    }
  }

  @Test
  fun checkNeedsSpaceForTheDatabaseArtifact() {
    val good = writtenBackup()
    free = exportBytes.size + BackupFiles.MARGIN_BYTES - 1
    try {
      service.check(ByteArrayInputStream(good), password)
      fail("staged without space")
    } catch (e: BackupFiles.InsufficientSpace) {
      // expected
    }
    assertTrue(File(databaseDir, "check").listFiles().orEmpty().isEmpty())
  }

  @Test
  fun checkLeavesNothingOnSuccessOnceFinished() {
    val good = writtenBackup()
    val staged = service.check(ByteArrayInputStream(good), password)
    assertTrue(staged.result.incoming.isFile)
    service.finishCheck(staged.checkId)
    assertTrue(File(databaseDir, "check").listFiles().orEmpty().isEmpty())
  }

  @Test
  fun startupCleanupRemovesStagingAndReportsAPendingDestination() {
    val begun = service.begin(password, password)
    File(begun.exportDir, begun.exportName).writeBytes(exportBytes)
    service.setDestination(begun.sessionId, Destination(), "content://test/partial")
    files.newCheckDir().second.resolve("incoming.db").writeText("x")

    assertEquals("content://test/partial", files.cleanupAtStart())
    assertTrue(File(databaseDir, "backup").listFiles().orEmpty().isEmpty())
    assertTrue(File(databaseDir, "check").listFiles().orEmpty().isEmpty())
    assertEquals(null, files.cleanupAtStart())
  }

  // --- Limits -----------------------------------------------------------------------------

  @Test
  fun anAttachmentOfExactly25MiBIsBackedUpAndChecked() {
    val row = attachment(1, size = Tzbk.MAX_ATTACHMENT_BYTES.toInt())
    val (begun, dest) = begin()
    service.write(begun.sessionId, listOf(row))
    val staged = service.readBack(begun.sessionId)
    assertEquals(Tzbk.MAX_ATTACHMENT_BYTES, staged.result.manifest.attachments.single().sizeBytes)
    service.finishCheck(staged.checkId)
    service.complete(begun.sessionId)
    val checked = service.check(ByteArrayInputStream(dest.written.toByteArray()), password)
    service.finishCheck(checked.checkId)
  }

  @Test
  fun aRowOverTheFormatLimitFailsBeforeAnyFileIsReadOrByteWritten() {
    val row = attachment(1).copy(sizeBytes = Tzbk.MAX_ATTACHMENT_BYTES + 1)
    val (begun, dest) = begin()
    try {
      service.write(begun.sessionId, listOf(row))
      fail("written over the limit")
    } catch (e: BackupFormatException) {
      assertEquals(BackupFormatException.Code.BACKUP_TOO_LARGE, e.code)
    }
    assertEquals(0, dest.written.size())
    assertFalse(BackupGate.isHeld())
  }
}
