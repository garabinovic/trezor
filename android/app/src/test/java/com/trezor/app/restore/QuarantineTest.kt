package com.trezor.app.restore

import com.trezor.app.attachments.AttachmentStore
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** The retained set and quarantine (spec v2.4 §9.2, L7, test 46). */
class QuarantineTest {

  @get:Rule val folder = TemporaryFolder()

  private val key = ByteArray(32) { 4 }
  private lateinit var layout: RestoreLayout
  private lateinit var quarantine: Quarantine
  private val restoreId = "e".repeat(32)

  private fun id(n: Int) = "01a1a0dd-991f-783c-9531-3fab9ef4%04d".format(n)

  @Before
  fun setUp() {
    layout = RestoreLayout(folder.newFolder("db"), folder.newFolder("nb"))
    quarantine =
        Quarantine(layout, RestoreFileOps(layout, syncDirectory = {}, link = { s, d -> Files.createLink(d.toPath(), s.toPath()) }))
  }

  private fun store() = AttachmentStore(layout.liveAttachments) { key.copyOf() }

  private fun file(n: Int) = File(layout.liveAttachments, "${id(n)}.tza")

  private fun files(vararg ns: Int) = ns.forEach { store().import(id(it), ByteArrayInputStream(ByteArray(100) { n -> n.toByte() }), 1L shl 20) }

  private fun quarantined() = layout.quarantine(restoreId).list()?.sorted().orEmpty()

  @Test
  fun noLiveRootOrNoKeptIdsRetainsNothing() {
    assertEquals(0, quarantine.preserve(restoreId).linked)
    files(1, 2)
    val o = quarantine.preserve(restoreId)
    assertEquals(0, o.linked + o.copied)
    assertFalse(layout.quarantine(restoreId).exists())
  }

  @Test
  fun validKeptIdsAreLinkedAndAnIdWithoutAFileIsCounted() {
    files(1, 2, 3)
    store().keepUnreferenced(setOf(id(1))) // 2 and 3 are kept
    file(3).delete()
    val o = quarantine.preserve(restoreId)
    assertEquals(1, o.linked)
    assertEquals(1, o.missing)
    assertFalse(o.failClosed)
    assertEquals(listOf("${id(2)}.tza"), quarantined())
    // The original stays in the live root, byte for byte.
    assertTrue(file(2).isFile)
    assertTrue(file(2).readBytes().contentEquals(File(layout.quarantine(restoreId), "${id(2)}.tza").readBytes()))
  }

  @Test
  fun damagedKeptIdsFailClosedAndRetainEveryFile() {
    files(1, 2, 3)
    File(layout.liveAttachments, "kept-ids").writeText("not the header\n")
    // Not attachment files: never retained.
    File(layout.liveAttachments, "notes.txt").writeText("x")
    File(layout.liveAttachments, "tmp").mkdirs()
    val o = quarantine.preserve(restoreId)
    assertTrue(o.failClosed)
    assertEquals(3, o.linked)
    assertEquals((1..3).map { "${id(it)}.tza" }, quarantined())
  }

  @Test
  fun anUnlistableLiveRootIsAStorageError() {
    layout.liveAttachments.parentFile!!.mkdirs()
    layout.liveAttachments.writeText("not a directory")
    try {
      quarantine.preserve(restoreId)
      fail("unlistable root accepted")
    } catch (e: RestoreException) {
      assertEquals(RestoreException.STORAGE_ERROR, e.code)
    }
  }

  @Test
  fun anExistingQuarantineFileIsNeverOverwritten() {
    files(1, 2)
    store().keepUnreferenced(setOf(id(1)))
    File(layout.quarantine(restoreId), "${id(2)}.tza").also { it.parentFile.mkdirs(); it.writeText("earlier") }
    try {
      quarantine.preserve(restoreId)
      fail("overwrote a quarantined file")
    } catch (e: java.io.IOException) {
      // expected
    }
    assertEquals("earlier", File(layout.quarantine(restoreId), "${id(2)}.tza").readText())
  }
}
