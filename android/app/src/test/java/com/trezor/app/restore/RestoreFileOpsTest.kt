package com.trezor.app.restore

import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RestoreFileOpsTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var layout: RestoreLayout
  private val synced = mutableListOf<File>()
  private var linkWorks = true
  private lateinit var ops: RestoreFileOps

  @Before
  fun setUp() {
    layout = RestoreLayout(folder.newFolder("db"), folder.newFolder("nb"))
    ops =
        RestoreFileOps(
            layout,
            syncDirectory = { synced += it },
            link = { src, dst ->
              if (!linkWorks) throw IOException("EXDEV")
              Files.createLink(dst.toPath(), src.toPath())
            })
  }

  @Test
  fun renameNoReplaceRefusesAnExistingTargetAndSyncsBothParents() {
    val a = File(layout.restoreDir, "a").also { it.parentFile.mkdirs(); it.writeText("a") }
    val target = File(layout.quarantineRoot, "b").also { it.parentFile.mkdirs(); it.writeText("b") }
    try {
      ops.renameNoReplaceDurable(a, target)
      fail("replaced an existing file")
    } catch (e: IOException) {
      // expected
    }
    assertEquals("b", target.readText())
    target.delete()
    ops.renameNoReplaceDurable(a, target)
    assertEquals("a", target.readText())
    assertEquals(listOf(layout.restoreDir, layout.quarantineRoot), synced)
  }

  @Test
  fun linkOrCopyLinksAndFallsBackToACompleteCopy() {
    val src = File(layout.liveAttachments, "x.tza").also { it.parentFile.mkdirs(); it.writeText("content") }
    val dir = File(layout.quarantineRoot, "q").also { it.mkdirs() }
    assertTrue(ops.linkOrCopyDurable(src, File(dir, "x.tza")))
    linkWorks = false
    assertFalse(ops.linkOrCopyDurable(src, File(dir, "y.tza")))
    assertEquals("content", File(dir, "y.tza").readText())
    assertFalse(File(dir, "y.tza.part").exists())
    try {
      ops.linkOrCopyDurable(src, File(dir, "y.tza"))
      fail("overwrote a target")
    } catch (e: IOException) {
      // expected
    }
    // The original is never changed.
    assertEquals("content", src.readText())
    assertEquals(listOf(dir, dir), synced)
  }

  @Test
  fun deletionIsLimitedToTheRestorePaths() {
    val restoreId = "c".repeat(32)
    for (dir in listOf(layout.restoreDbDir, layout.restoreDir, layout.quarantine(restoreId), File(layout.databaseDir, "check/x"))) {
      File(dir, "f").also { it.parentFile.mkdirs(); it.writeText("x") }
      ops.deleteRecursively(dir, restoreId)
      assertFalse(dir.exists())
    }
    // Another restore's quarantine, the quarantine root, the live roots: refused.
    for (dir in listOf(layout.quarantine("d".repeat(32)), layout.quarantineRoot, layout.liveAttachments, layout.databaseDir, layout.noBackupDir)) {
      dir.mkdirs()
      try {
        ops.deleteRecursively(dir, restoreId)
        fail("deleted ${dir.name}")
      } catch (e: IllegalArgumentException) {
        // expected
      }
      assertTrue(dir.exists())
    }
    // Without the journal's restore id, no quarantine at all.
    layout.quarantine(restoreId).mkdirs()
    try {
      ops.deleteRecursively(layout.quarantine(restoreId))
      fail("deleted a quarantine without its journal")
    } catch (e: IllegalArgumentException) {
      // expected
    }
  }

  @Test
  fun aFailingDirectorySyncIsReported() {
    val failing = RestoreFileOps(layout, syncDirectory = { throw IOException("fsync") })
    try {
      failing.writeDurable(layout.journal, byteArrayOf(1))
      fail("sync failure hidden")
    } catch (e: IOException) {
      // expected
    }
  }
}
