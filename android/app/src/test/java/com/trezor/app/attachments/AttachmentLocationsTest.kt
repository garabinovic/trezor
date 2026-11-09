package com.trezor.app.attachments

import com.trezor.app.vault.VaultException
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** `hasAnyFile` over every location (spec v2.4 §8.6, test 22). */
class AttachmentLocationsTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var nb: File

  @Before
  fun setUp() {
    nb = folder.newFolder("no_backup")
  }

  private fun tza(dir: String) = File(nb, "$dir/01a1a0dd-991f-783c-9531-3fab9ef40001.tza").also { it.parentFile.mkdirs(); it.writeText("x") }

  @Test
  fun everyLocationCounts() {
    assertFalse(AttachmentLocations.hasAnyFile(nb))
    for (dir in listOf("attachments", "restore/attachments", "restore/previous-attachments", "quarantine/${"a".repeat(32)}")) {
      val f = tza(dir)
      assertTrue(dir, AttachmentLocations.hasAnyFile(nb))
      f.delete()
      assertFalse(dir, AttachmentLocations.hasAnyFile(nb))
    }
    // Other files and empty directories don't.
    File(nb, "attachments/kept-ids").writeText("x")
    File(nb, "quarantine/empty").mkdirs()
    assertFalse(AttachmentLocations.hasAnyFile(nb))
  }

  @Test
  fun anUnreadableLocationNeverAnswersNo() {
    for (dir in listOf("attachments", "restore/previous-attachments", "quarantine")) {
      val f = File(nb, dir).also { it.parentFile.mkdirs(); it.writeText("not a directory") }
      try {
        AttachmentLocations.hasAnyFile(nb)
        fail("answered for an unreadable $dir")
      } catch (e: AttachmentStore.StoreException) {
        assertEquals(AttachmentStore.StoreException.Code.IO_FAILED, e.code)
      }
      f.delete()
    }
  }

  @Test
  fun theKeyIsNotCreatedWhileAQuarantinedFileExists() {
    var created = false
    val keys =
        AttachmentKeys(
            hasKey = { false },
            getKey = { ByteArray(32) },
            createKey = { created = true; ByteArray(32) },
            hasFiles = { AttachmentLocations.hasAnyFile(nb) })
    tza("quarantine/${"b".repeat(32)}")
    try {
      keys.obtain()
      fail("key created over a quarantined file")
    } catch (e: VaultException) {
      assertEquals(VaultException.Code.KEY_NOT_FOUND, e.code)
    }
    assertFalse(created)
  }
}
