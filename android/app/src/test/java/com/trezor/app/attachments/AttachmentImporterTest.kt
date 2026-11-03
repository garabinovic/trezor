package com.trezor.app.attachments

import com.trezor.app.attachments.AttachmentImporter.Code
import com.trezor.app.attachments.AttachmentImporter.Outcome
import com.trezor.app.attachments.AttachmentImporter.Source
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AttachmentImporterTest {

  @get:Rule val folder = TemporaryFolder()

  private lateinit var root: File
  private lateinit var store: AttachmentStore
  private var nextId = 0
  private val newId = { "01a1a0dd-991f-783c-9531-3fab9ef479%02d".format(++nextId) }

  private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) +
      ByteArray(70_000) { (it % 251).toByte() }
  private val pdf = "%PDF-1.7\n".toByteArray() + ByteArray(1_000) { 7 }

  @Before
  fun setUp() {
    root = File(folder.root, "attachments")
    val key = ByteArray(32) { 3 }
    store = AttachmentStore(root) { key.copyOf() }
  }

  private fun importer(maxBytes: Long = AttachmentImporter.MAX_ATTACHMENT_BYTES) =
      AttachmentImporter(store, newId, maxBytes)

  private fun source(bytes: ByteArray, name: String? = "file", size: Long? = bytes.size.toLong()) =
      Source(name, size) { ByteArrayInputStream(bytes) }

  private fun sha256(bytes: ByteArray) =
      MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  private fun failure(outcome: Outcome): Code = (outcome as Outcome.Failed).code

  @Test
  fun importsAFileWithItsContentTypeAndChecksum() {
    val outcome = importer().import(source(jpeg, "IMG_0001"), imagesOnly = true) as Outcome.Imported
    assertEquals(MediaTypes.JPEG, outcome.mimeType)
    assertEquals("IMG_0001.jpg", outcome.fileName)
    assertEquals(jpeg.size.toLong(), outcome.sizeBytes)
    assertEquals(sha256(jpeg), outcome.sha256)

    val back = ByteArrayOutputStream()
    store.decryptTo(outcome.id, back, outcome.sizeBytes, outcome.sha256)
    assertArrayEquals(jpeg, back.toByteArray())
    assertEquals(setOf(outcome.id), store.storedIds())
  }

  @Test
  fun theDeclaredNameAndTypeDoNotDecideTheType() {
    // A PDF named like a photo is stored as a PDF, and refused where only images belong.
    val asFile = importer().import(source(pdf, "holiday.jpg"), imagesOnly = false) as Outcome.Imported
    assertEquals(MediaTypes.PDF, asFile.mimeType)
    assertEquals("holiday.jpg", asFile.fileName)
    assertEquals(Code.UNSUPPORTED_TYPE, failure(importer().import(source(pdf), imagesOnly = true)))
    assertEquals(
        Code.UNSUPPORTED_TYPE,
        failure(importer().import(source("PK\u0003\u0004 not a photo".toByteArray()), false)))
    assertEquals(Code.UNSUPPORTED_TYPE, failure(importer().import(source(ByteArray(0)), false)))
  }

  @Test
  fun tooLargeFilesAreRefusedWhetherOrNotTheirSizeIsDeclared() {
    val small = importer(maxBytes = 1_000)
    assertEquals(Code.TOO_LARGE, failure(small.import(source(jpeg), imagesOnly = true)))
    assertEquals(Code.TOO_LARGE, failure(small.import(source(jpeg, size = null), imagesOnly = true)))
    assertEquals(Code.TOO_LARGE, failure(small.import(source(jpeg, size = 10), imagesOnly = true)))
    assertTrue(store.storedIds().isEmpty())
    assertTrue(File(root, "tmp").listFiles().orEmpty().isEmpty())
  }

  @Test
  fun unreadableSourcesFailWithoutLeavingFiles() {
    val failing =
        object : InputStream() {
          var served = 0

          override fun read(): Int = throw IOException("gone")

          override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (served > 0) throw IOException("gone")
            served++
            // More than the type check reads, so the failure hits the import itself.
            jpeg.copyInto(b, off, 0, minOf(len, 100))
            return minOf(len, 100)
          }
        }
    assertEquals(Code.READ_FAILED, failure(importer().import(Source("a", null) { null }, true)))
    assertEquals(
        Code.READ_FAILED,
        failure(importer().import(Source("a", null) { throw SecurityException("revoked") }, true)))
    assertEquals(Code.IMPORT_FAILED, failure(importer().import(Source("a", null) { failing }, true)))
    assertTrue(store.storedIds().isEmpty())
    assertTrue(File(root, "tmp").listFiles().orEmpty().isEmpty())
  }

  /** A stream that reads fine but fails when closed. */
  private fun closeFails(bytes: ByteArray) =
      object : ByteArrayInputStream(bytes) {
        override fun close() = throw IOException("close failed")
      }

  @Test
  fun aSourceThatFailsOnCloseIsReportedAndLeavesNoFile() {
    val outcome = importer().import(Source("scan.jpg", null) { closeFails(jpeg) }, imagesOnly = true)
    assertEquals(Code.READ_FAILED, failure(outcome))
    assertEquals("scan.jpg", (outcome as Outcome.Failed).fileName)
    assertTrue(store.storedIds().isEmpty())
    assertTrue(File(root, "tmp").listFiles().orEmpty().isEmpty())
  }

  @Test
  fun aCloseFailureKeepsAnEarlierReason() {
    val small = importer(maxBytes = 1_000)
    assertEquals(
        Code.TOO_LARGE, failure(small.import(Source("big.jpg", null) { closeFails(jpeg) }, true)))
    assertEquals(
        Code.UNSUPPORTED_TYPE,
        failure(importer().import(Source("a.txt", null) { closeFails("hello".toByteArray()) }, false)))
  }

  @Test
  fun oneFileFailingNeverStopsTheOthers() {
    val outcomes =
        importer()
            .importAll(
                listOf(
                    { source(jpeg, "a.jpg") },
                    { Source("b.jpg", null) { closeFails(jpeg) } },
                    { throw IllegalStateException("provider crashed") },
                    { source(pdf, "d.pdf") },
                ),
                imagesOnly = false,
            )
    assertEquals(4, outcomes.size)
    assertTrue(outcomes[0] is Outcome.Imported)
    assertEquals(Code.READ_FAILED, failure(outcomes[1]))
    assertEquals(Code.IMPORT_FAILED, failure(outcomes[2]))
    assertTrue(outcomes[3] is Outcome.Imported)
    assertEquals(
        setOf((outcomes[0] as Outcome.Imported).id, (outcomes[3] as Outcome.Imported).id),
        store.storedIds())
  }

  @Test
  fun failuresReportACleanedNameNeverAPath() {
    val outcome = importer().import(source(ByteArray(4), "/storage/x/‮secret.txt"), false)
    assertEquals("secret.txt", (outcome as Outcome.Failed).fileName)
    val unnamed = importer().import(source(ByteArray(4), null), false) as Outcome.Failed
    assertEquals("File", unnamed.fileName)
  }
}
