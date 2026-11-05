package com.trezor.app.attachments

import com.trezor.app.vault.VaultException
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.util.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AttachmentExportTest {

  @get:Rule val folder = TemporaryFolder()

  private val key = ByteArray(32) { 4 }
  private var keyAvailable = true
  private lateinit var store: AttachmentStore
  private lateinit var export: AttachmentExport

  private val imageId = "01a1a0dd-991f-783c-9531-3fab9ef47901"
  private val pdfId = "01a1a0dd-991f-783c-9531-3fab9ef47902"
  private val image = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) + random(300_000, 1)
  private val pdf = "%PDF-1.7\n".toByteArray() + random(150_000, 2)
  private lateinit var imageRecord: AttachmentFormat.Result
  private lateinit var pdfRecord: AttachmentFormat.Result

  private fun random(size: Int, seed: Long) = ByteArray(size).also { Random(seed).nextBytes(it) }

  /** A SAF document as the export sees it. */
  private class FakeDestination(
      var existing: Long? = 0,
      val failAfter: Int = Int.MAX_VALUE,
      /** What a write past [failAfter] throws. */
      val failure: () -> Throwable = { IOException("disk full") },
      val deletable: Boolean = true,
      /** Modes the provider accepts. */
      val modes: Set<String> = setOf("wt", "w"),
  ) : AttachmentExport.Destination {
    val written = ByteArrayOutputStream()
    var opened = false
    var deleted = false
    val tried = mutableListOf<String>()

    override fun existingSize() = existing

    override fun open(mode: String): OutputStream {
      tried.add(mode)
      if (mode !in modes) throw IllegalArgumentException("mode $mode not supported")
      opened = true
      return object : OutputStream() {
        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

        override fun write(b: ByteArray, off: Int, len: Int) {
          if (written.size() + len > failAfter) throw failure()
          written.write(b, off, len)
        }
      }
    }

    override fun delete(): Boolean {
      deleted = deletable
      return deletable
    }
  }

  @Before
  fun setUp() {
    store =
        AttachmentStore(File(folder.root, "attachments")) {
          if (!keyAvailable) throw VaultException(VaultException.Code.KEY_NOT_FOUND, "gone")
          key.copyOf()
        }
    export = AttachmentExport(store)
    imageRecord = store.import(imageId, ByteArrayInputStream(image), 1L shl 30)
    pdfRecord = store.import(pdfId, ByteArrayInputStream(pdf), 1L shl 30)
  }

  private fun encrypted(id: String) = File(folder.root, "attachments/$id.tza").readBytes()

  private fun exportCode(block: () -> Unit): String =
      try {
        block()
        fail("expected an export failure")
        ""
      } catch (e: AttachmentExport.ExportException) {
        e.code
      }

  @Test
  fun exportsAnImageAndAPdfExactlyAndLeavesTheOriginalsAlone() {
    val beforeImage = encrypted(imageId)
    val beforePdf = encrypted(pdfId)

    for ((id, record, content) in
        listOf(Triple(imageId, imageRecord, image), Triple(pdfId, pdfRecord, pdf))) {
      export.verify(id, record.sizeBytes, record.sha256)
      val destination = FakeDestination()
      export.write(id, record.sizeBytes, record.sha256, destination)
      assertArrayEquals(content, destination.written.toByteArray())
      assertFalse(destination.deleted)
    }

    assertArrayEquals(beforeImage, encrypted(imageId))
    assertArrayEquals(beforePdf, encrypted(pdfId))
    assertEquals(setOf(imageId, pdfId), store.storedIds())
  }

  @Test
  fun aDestinationWithContentIsNeverOverwrittenOrDeleted() {
    val existing = FakeDestination(existing = 42)
    assertEquals(
        AttachmentExport.DESTINATION_NOT_EMPTY,
        exportCode { export.write(pdfId, pdfRecord.sizeBytes, pdfRecord.sha256, existing) })
    assertFalse(existing.opened)
    assertFalse(existing.deleted)
  }

  @Test
  fun writesTruncatingAndFallsBackOnlyForProvidersWithoutIt() {
    val normal = FakeDestination()
    export.write(pdfId, pdfRecord.sizeBytes, pdfRecord.sha256, normal)
    assertEquals(listOf("wt"), normal.tried)
    assertArrayEquals(pdf, normal.written.toByteArray())

    // "w" only after the destination was shown to be empty.
    val old = FakeDestination(modes = setOf("w"))
    export.write(pdfId, pdfRecord.sizeBytes, pdfRecord.sha256, old)
    assertEquals(listOf("wt", "w"), old.tried)
    assertArrayEquals(pdf, old.written.toByteArray())
  }

  @Test
  fun aDestinationOfUnknownSizeIsNeitherWrittenNorDeleted() {
    // e.g. a provider that hands back an existing document and reports no size.
    val unknown = FakeDestination(existing = null)
    assertEquals(
        AttachmentExport.DESTINATION_UNVERIFIED,
        exportCode { export.write(pdfId, pdfRecord.sizeBytes, pdfRecord.sha256, unknown) })
    assertTrue(unknown.tried.isEmpty())
    assertFalse(unknown.deleted)
  }

  @Test
  fun aDestinationThatCantBeOpenedIsCleanedUp() {
    val closed = FakeDestination(modes = emptySet())
    assertEquals(
        AttachmentExport.EXPORT_FAILED,
        exportCode { export.write(pdfId, pdfRecord.sizeBytes, pdfRecord.sha256, closed) })
    assertTrue(closed.deleted) // the empty document the picker created
    val stuck = FakeDestination(modes = emptySet(), deletable = false)
    assertEquals(
        AttachmentExport.EXPORT_INCOMPLETE,
        exportCode { export.write(pdfId, pdfRecord.sizeBytes, pdfRecord.sha256, stuck) })
  }

  @Test
  fun aFailedWriteDeletesThePartialDestination() {
    val before = encrypted(imageId)
    val failing = FakeDestination(failAfter = 100_000)
    assertEquals(
        AttachmentExport.EXPORT_FAILED,
        exportCode { export.write(imageId, imageRecord.sizeBytes, imageRecord.sha256, failing) })
    assertTrue(failing.deleted)

    // A provider that refuses deletion is reported, so the user can be told.
    val stuck = FakeDestination(failAfter = 100_000, deletable = false)
    assertEquals(
        AttachmentExport.EXPORT_INCOMPLETE,
        exportCode { export.write(imageId, imageRecord.sizeBytes, imageRecord.sha256, stuck) })
    assertArrayEquals(before, encrypted(imageId))
    store.verify(imageId, imageRecord.sizeBytes, imageRecord.sha256)
  }

  @Test
  fun anErrorWhileWritingStillDeletesThePartialDestination() {
    // L3: an Error (simulated out of memory) must not leave a partial plaintext copy
    // outside the app without at least trying to delete it, and is reported like a failure.
    val oom = FakeDestination(failAfter = 100_000, failure = { OutOfMemoryError("simulated") })
    assertEquals(
        AttachmentExport.EXPORT_FAILED,
        exportCode { export.write(imageId, imageRecord.sizeBytes, imageRecord.sha256, oom) })
    assertTrue(oom.deleted)

    val stuck =
        FakeDestination(failAfter = 100_000, failure = { OutOfMemoryError("simulated") }, deletable = false)
    assertEquals(
        AttachmentExport.EXPORT_INCOMPLETE,
        exportCode { export.write(imageId, imageRecord.sizeBytes, imageRecord.sha256, stuck) })
  }

  @Test
  fun damagedMissingAndKeylessAttachmentsFailTheCheckBeforeAnythingIsWritten() {
    fun storeCode(block: () -> Unit) =
        try {
          block()
          fail("expected a store failure")
        } catch (e: AttachmentStore.StoreException) {
          e.code
        }

    assertEquals(
        AttachmentStore.StoreException.Code.INTEGRITY_MISMATCH,
        storeCode { export.verify(pdfId, pdfRecord.sizeBytes, "0".repeat(64)) })

    val file = File(folder.root, "attachments/$pdfId.tza")
    val bytes = file.readBytes()
    bytes[bytes.size - 20] = (bytes[bytes.size - 20].toInt() xor 1).toByte()
    file.writeBytes(bytes)
    assertEquals(
        AttachmentStore.StoreException.Code.CORRUPTED,
        storeCode { export.verify(pdfId, pdfRecord.sizeBytes, pdfRecord.sha256) })

    store.delete(pdfId)
    assertEquals(
        AttachmentStore.StoreException.Code.MISSING,
        storeCode { export.verify(pdfId, pdfRecord.sizeBytes, pdfRecord.sha256) })

    keyAvailable = false
    try {
      export.verify(imageId, imageRecord.sizeBytes, imageRecord.sha256)
      fail("expected the key to be missing")
    } catch (e: VaultException) {
      assertEquals(VaultException.Code.KEY_NOT_FOUND, e.code)
    }
    // Damage found while writing also removes the partial copy.
    val destination = FakeDestination()
    assertEquals(
        AttachmentExport.EXPORT_FAILED,
        exportCode {
          export.write(imageId, imageRecord.sizeBytes, imageRecord.sha256, destination)
        })
    assertTrue(destination.deleted)
  }
}
