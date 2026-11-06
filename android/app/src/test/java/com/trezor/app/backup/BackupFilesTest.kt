package com.trezor.app.backup

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class BackupFilesTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var databaseDir: File
  private lateinit var noBackupDir: File
  private var free = Long.MAX_VALUE
  private val synced = mutableListOf<File>()
  private lateinit var files: BackupFiles

  @Before
  fun setUp() {
    databaseDir = folder.newFolder("databases")
    noBackupDir = folder.newFolder("no_backup")
    files = BackupFiles(databaseDir, noBackupDir, freeBytes = { free }, syncDirectory = { synced += it })
  }

  @Test
  fun exportNamesAreRandomAndInsideTheBackupDirectory() {
    val a = files.newExportName()
    val b = files.newExportName()
    assertTrue(Regex("^[0-9a-f]{32}\\.db$").matches(a))
    assertNotEquals(a, b)
    assertEquals(File(databaseDir, "backup"), files.exportDir)
    assertTrue(files.exportDir.isDirectory)
  }

  @Test
  fun deleteExportRemovesTheFileAndItsJournalAndRefusesOtherNames() {
    val name = files.newExportName()
    File(files.exportDir, name).writeText("x")
    File(files.exportDir, "$name-journal").writeText("x")
    files.deleteExport(name)
    assertTrue(files.exportDir.listFiles()!!.isEmpty())
    for (bad in listOf("../trezor.db", "trezor.db", "${"0".repeat(32)}.db/../x")) {
      try {
        files.deleteExport(bad)
        fail("accepted $bad")
      } catch (e: IllegalArgumentException) {
        // expected
      }
    }
  }

  @Test
  fun checkDirectoriesAreNewAndOnlyGeneratedIdsAreAccepted() {
    val (id, dir) = files.newCheckDir()
    assertEquals(dir, files.checkDir(id))
    assertTrue(dir.isDirectory)
    File(dir, "incoming.db").writeText("x")
    files.deleteCheck(id)
    assertFalse(dir.exists())
    try {
      files.checkDir("../../no_backup")
      fail("path outside the check directory")
    } catch (e: IllegalArgumentException) {
      // expected
    }
  }

  @Test
  fun freeSpaceNeedsTheBytesPlusTheMargin() {
    free = 1000 + BackupFiles.MARGIN_BYTES
    files.requireFree(1000)
    free -= 1
    try {
      files.requireFree(1000)
      fail("not enough space accepted")
    } catch (e: BackupFiles.InsufficientSpace) {
      assertEquals(1000 + BackupFiles.MARGIN_BYTES, e.needed)
      assertEquals(free, e.available)
    }
  }

  @Test
  fun thePendingDestinationIsWrittenDurablyAndClearedOrReturnedOnce() {
    files.recordPendingDestination("content://a/1")
    val pending = File(noBackupDir, "backup/pending-destination")
    assertEquals("content://a/1", pending.readText())
    assertFalse(File(noBackupDir, "backup/pending-destination.tmp").exists())
    assertEquals(listOf(File(noBackupDir, "backup")), synced)

    // A second record replaces it.
    files.recordPendingDestination("content://a/2")
    assertEquals("content://a/2", pending.readText())
    files.clearPendingDestination()
    assertFalse(pending.exists())
    assertNull(files.cleanupAtStart())
  }

  @Test
  fun startupCleanupRemovesExportsChecksAndLeftoversButNothingElse() {
    File(databaseDir, "trezor.db").writeText("live")
    File(files.exportDir.also { it.mkdirs() }, files.newExportName()).writeText("x")
    File(files.newCheckDir().second, "incoming.db").writeText("x")
    File(noBackupDir, "backup").mkdirs()
    File(noBackupDir, "backup/pending-destination.tmp").writeText("half")
    File(noBackupDir, "attachments").mkdirs()
    File(noBackupDir, "attachments/a.tza").writeText("file")
    files.recordPendingDestination("content://a/3")

    assertEquals("content://a/3", files.cleanupAtStart())
    assertTrue(files.exportDir.listFiles()!!.isEmpty())
    assertTrue(File(databaseDir, "check").listFiles()!!.isEmpty())
    assertFalse(File(noBackupDir, "backup/pending-destination.tmp").exists())
    assertEquals("live", File(databaseDir, "trezor.db").readText())
    assertEquals("file", File(noBackupDir, "attachments/a.tza").readText())
    // Reported once.
    assertNull(files.cleanupAtStart())
  }

  @Test
  fun startupCleanupWithNothingStagedIsANoOp() {
    assertNull(files.cleanupAtStart())
  }
}
