package com.trezor.app.attachments

import com.trezor.app.attachments.AttachmentStore.StoreException.Code
import java.io.ByteArrayInputStream
import java.io.File
import java.util.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AttachmentViewsTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var store: AttachmentStore
  private lateinit var dir: File
  private lateinit var views: AttachmentViews
  private val id = "01a1a0dd-991f-783c-9531-3fab9ef47901"
  private val content = ByteArray(200_000).also { Random(5).nextBytes(it) }
  private lateinit var stored: AttachmentFormat.Result

  @Before
  fun setUp() {
    val key = ByteArray(32) { 9 }
    store = AttachmentStore(File(folder.root, "attachments")) { key.copyOf() }
    dir = File(folder.root, "cache/attachments/view")
    views = AttachmentViews(store, dir)
    stored = store.import(id, ByteArrayInputStream(content), 1L shl 30)
  }

  private fun expectFailure(code: Code, block: () -> Unit) {
    try {
      block()
      fail("expected $code")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(code, e.code)
    }
  }

  @Test
  fun opensAVerifiedCopyUnderARandomNameAndClosesIt() {
    val first = views.open(id, stored.sizeBytes, stored.sha256)
    val second = views.open(id, stored.sizeBytes, stored.sha256)
    assertArrayEquals(content, first.readBytes())
    assertNotEquals(first.name, second.name)
    assertEquals(dir.canonicalPath, first.parentFile!!.canonicalPath)

    assertTrue(views.close(first.path))
    assertFalse(first.exists())
    assertTrue(second.exists())
  }

  @Test
  fun aRecordMismatchOrMissingFileLeavesNoCopy() {
    expectFailure(Code.INTEGRITY_MISMATCH) { views.open(id, stored.sizeBytes, "0".repeat(64)) }
    expectFailure(Code.INTEGRITY_MISMATCH) { views.open(id, stored.sizeBytes + 1, stored.sha256) }
    store.delete(id)
    expectFailure(Code.MISSING) { views.open(id, stored.sizeBytes, stored.sha256) }
    assertTrue(dir.listFiles().orEmpty().isEmpty())
  }

  @Test
  fun closeRefusesFilesOutsideTheViewDirectory() {
    val outside = File(folder.root, "attachments/$id${AttachmentStore.SUFFIX}")
    for (path in listOf(outside.path, "${dir.path}/../../attachments/x.view", "${dir.path}/notes.txt")) {
      try {
        views.close(path)
        fail("must refuse $path")
      } catch (e: IllegalArgumentException) {
        // expected
      }
    }
    assertTrue(outside.exists())
  }

  @Test
  fun purgeInactiveKeepsOpenFilesAndRemovesClosedOrStrayOnes() {
    val open = views.open(id, stored.sizeBytes, stored.sha256)
    val page = views.newFile().also { it.writeBytes(byteArrayOf(1, 2, 3)) }
    val closed = views.open(id, stored.sizeBytes, stored.sha256)
    views.close(closed.path)
    // A file left by an earlier process, which this one never handed out.
    val stray = File(dir, "${"ab".repeat(16)}.view").also { it.writeBytes(byteArrayOf(9)) }

    assertEquals(1, views.purgeInactive())
    assertTrue(open.exists())
    assertTrue(page.exists())
    assertFalse(stray.exists())

    views.close(page.path)
    assertEquals(0, views.purgeInactive())
    assertFalse(page.exists())
    assertTrue(open.exists())
  }

  @Test
  fun purgeRemovesEveryCopy() {
    views.open(id, stored.sizeBytes, stored.sha256)
    views.open(id, stored.sizeBytes, stored.sha256)
    assertEquals(2, views.purge())
    assertTrue(dir.listFiles().orEmpty().isEmpty())
    assertTrue(store.exists(id))
  }
}
