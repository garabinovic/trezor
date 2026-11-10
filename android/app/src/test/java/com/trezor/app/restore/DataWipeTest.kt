package com.trezor.app.restore

import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Delete all data, file half (Phase 7): what goes, what never does. */
class DataWipeTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var layout: RestoreLayout
  private val synced = mutableListOf<String>()
  private lateinit var wipe: DataWipe

  private fun file(dir: File, name: String, text: String = "x") = File(dir, name).also { it.parentFile!!.mkdirs(); it.writeText(text) }

  @Before
  fun setUp() {
    layout = RestoreLayout(folder.newFolder("databases"), folder.newFolder("no_backup"), folder.newFolder("cache"))
    val ops = RestoreFileOps(layout, syncDirectory = { synced += it.relativeTo(folder.root).path })
    wipe = DataWipe(layout, ops, JvmPathTypes())
    // What must survive.
    file(layout.databaseDir, "trezor.db", "live")
    file(File(layout.noBackupDir, "keys"), "database.key.json", "k")
    file(File(layout.noBackupDir, "reminders"), "schedule.bin", "s")
    file(File(layout.noBackupDir, "backup"), "pending-destination", "uri")
    file(layout.cacheDir!!, "unrelated.bin")
    // What must go.
    file(layout.liveAttachments, "01a1a0dd-991f-783c-9531-3fab9ef40001.tza")
    file(layout.liveAttachments, "kept-ids")
    file(File(layout.liveAttachments, "tmp"), "01a1a0dd-991f-783c-9531-3fab9ef40002.part")
    file(layout.quarantine("e".repeat(32)), "01a1a0dd-991f-783c-9531-3fab9ef40003.tza")
    file(layout.databaseDir, "trezor.pre-migration-v1.db")
    file(layout.databaseDir, "trezor.pre-migration-v2.3.db")
    file(layout.databaseDir, "trezor.pre-migration-v2.3.db-journal")
    file(layout.backupStaging, "export.db")
    file(File(layout.checkStaging, "c1"), "incoming.db")
    file(layout.viewCache!!, "a.view")
    file(File(layout.shareCache!!, "s1"), "scan.pdf")
  }

  private fun survivors() =
      listOf(
          File(layout.databaseDir, "trezor.db"),
          File(layout.noBackupDir, "keys/database.key.json"),
          File(layout.noBackupDir, "reminders/schedule.bin"),
          File(layout.noBackupDir, "backup/pending-destination"),
          File(layout.cacheDir, "unrelated.bin"),
      )

  private fun assertWiped() {
    for (dir in listOf(layout.liveAttachments, layout.quarantineRoot, layout.backupStaging, layout.checkStaging, layout.viewCache!!, layout.shareCache!!)) {
      assertFalse("${dir.name} left", dir.exists())
    }
    assertEquals(listOf("trezor.db"), layout.databaseDir.list()!!.filter { it.endsWith(".db") || it.endsWith("-journal") }.sorted())
    survivors().forEach { assertTrue("${it.name} deleted", it.isFile) }
  }

  @Test
  fun deletesEveryUserFileAndNothingElse() {
    wipe.wipe()
    assertWiped()
    assertEquals("live", File(layout.databaseDir, "trezor.db").readText())
  }

  @Test
  fun syncsTheParentOfEveryDeletion() {
    wipe.wipe()
    for (parent in listOf("no_backup", "databases", "cache/attachments")) assertTrue(parent, parent in synced)
  }

  @Test
  fun isIdempotent() {
    wipe.wipe()
    synced.clear()
    wipe.wipe()
    assertWiped()
  }

  @Test
  fun aPartialFailureLeavesTheRestForARetry() {
    // The quarantine can't be deleted (directory not writable): the attachments already went.
    val q = layout.quarantine("e".repeat(32))
    q.setWritable(false)
    try {
      wipe.wipe()
      fail("failure hidden")
    } catch (e: IOException) {
      // expected
    } finally {
      q.setWritable(true)
    }
    assertFalse(layout.liveAttachments.exists())
    assertTrue(layout.quarantineRoot.exists())
    wipe.wipe()
    assertWiped()
  }

  @Test
  fun aRestoreInProgressIsRefusedAndNothingIsDeleted() {
    for (owned in listOf(layout.journal, File(layout.restoreDbDir, "trezor.db"), File(layout.stagedAttachments, "x.tza"))) {
      owned.parentFile!!.mkdirs()
      owned.writeText("x")
      try {
        wipe.wipe()
        fail("not refused")
      } catch (e: RestoreException) {
        assertEquals(RestoreException.IN_PROGRESS, e.code)
      }
      assertTrue(File(layout.liveAttachments, "kept-ids").isFile)
      layout.restoreDir.deleteRecursively()
      layout.restoreDbDir.deleteRecursively()
    }
  }

  @Test
  fun theWipePermissionCoversOnlyItsPaths() {
    val ops = RestoreFileOps(layout, syncDirectory = {})
    for (dir in listOf(layout.databaseDir, layout.noBackupDir, File(layout.noBackupDir, "keys"), File(layout.noBackupDir, "reminders"), layout.cacheDir!!)) {
      try {
        ops.deleteRecursively(dir, wipe = true)
        fail("deleted ${dir.name}")
      } catch (e: IllegalArgumentException) {
        // expected
      }
      assertTrue(dir.exists())
    }
    // Without the wipe permission the attachment root stays refused, as before.
    try {
      ops.deleteRecursively(layout.liveAttachments)
      fail("attachment root deleted without the wipe permission")
    } catch (e: IllegalArgumentException) {
      // expected
    }
  }

  @Test
  fun snapshotNamesFollowTheAppConvention() {
    for (name in listOf("trezor.pre-migration-v1.db", "trezor.pre-migration-v12.9.db", "trezor.pre-migration-v2.db-journal")) {
      assertTrue(name, DataWipe.SNAPSHOT.matches(name))
    }
    for (name in listOf("trezor.db", "trezor.db-journal", "other.pre-migration-v1.db", "trezor.pre-migration-vX.db", "trezor.pre-migration-v1.db.bak")) {
      assertFalse(name, DataWipe.SNAPSHOT.matches(name))
    }
  }
}
