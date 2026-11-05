package com.trezor.app.attachments

import com.trezor.app.attachments.ExportFileNames.MAX_BYTES
import com.trezor.app.attachments.ExportFileNames.forExport
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Names of decrypted copies outside the store (Share and Save a copy). */
class ExportFileNamesTest {

  @get:Rule val folder = TemporaryFolder()

  private val pdf = MediaTypes.PDF
  private val jpg = MediaTypes.JPEG

  private fun bytes(text: String) = text.toByteArray(Charsets.UTF_8).size

  /** Within the limit, and strict UTF-8 that decodes back to the same text. */
  private fun assertSafe(name: String) {
    val encoded = name.toByteArray(Charsets.UTF_8)
    assertTrue("${encoded.size} bytes: $name", encoded.size <= MAX_BYTES)
    val decoded =
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(encoded))
            .toString()
    assertEquals(name, decoded)
    assertTrue(name.isNotEmpty() && !name.contains('/') && !name.contains('\\'))
  }

  @Test
  fun shortNamesAreKeptAsTheyAre() {
    for (name in
        listOf(
            "Receipt March.pdf",
            "Račun čćžšđ ČĆŽŠĐ.pdf",
            "Гаранција фрижидер.pdf",
            "保修卡.jpg",
            "IMG_0001.heic")) {
      val mime = if (name.endsWith(".jpg")) jpg else if (name.endsWith(".heic")) MediaTypes.HEIC else pdf
      assertEquals(name, forExport(name, mime))
      assertSafe(forExport(name, mime))
    }
  }

  @Test
  fun longNamesAreCutByBytesKeepingTheExtension() {
    // 120 characters is the stored limit; in UTF-8 these are 120, ~240 and ~360 bytes.
    val cases =
        listOf(
            "a".repeat(300) + ".pdf" to pdf,
            "č".repeat(150) + ".pdf" to pdf,
            "Ж".repeat(150) + ".jpg" to jpg,
            "漢".repeat(150) + ".pdf" to pdf,
            "照片".repeat(80) + ".webp" to MediaTypes.WEBP,
            "😀".repeat(80) + ".png" to MediaTypes.PNG,
        )
    for ((raw, mime) in cases) {
      val name = forExport(raw, mime)
      assertSafe(name)
      assertTrue(name, name.endsWith(raw.substringAfterLast('.').let { ".$it" }))
      // As long as possible: one more code point of the base wouldn't fit.
      val base = name.substringBeforeLast('.')
      val next = raw.substring(base.length).codePointAt(0)
      assertTrue(bytes(name) + String(Character.toChars(next)).let(::bytes) > MAX_BYTES ||
          name.length >= AttachmentImporter.MAX_NAME_CHARS)
    }
    // The case from the review: within 120 characters but far over 255 bytes.
    val cjk = "漢".repeat(116) + ".pdf"
    assertEquals(352, bytes(cjk))
    val shortened = forExport(cjk, pdf)
    assertEquals("漢".repeat(65) + ".pdf", shortened) // 195 + 4 bytes; a 66th wouldn't fit
    assertSafe(shortened)
  }

  @Test
  fun exactlyAtTheLimitIsKeptAndOneByteOverIsCut() {
    val atLimit = "a".repeat(MAX_BYTES - 4) + ".pdf"
    assertEquals(MAX_BYTES, bytes(atLimit))
    assertEquals(atLimit, ExportFileNames.limit(atLimit, pdf))

    val over = "a".repeat(MAX_BYTES - 3) + ".pdf"
    assertEquals(MAX_BYTES + 1, bytes(over))
    assertEquals("a".repeat(MAX_BYTES - 4) + ".pdf", ExportFileNames.limit(over, pdf))

    // A two-byte character straddling the limit is dropped whole, never split.
    val straddle = "a".repeat(MAX_BYTES - 5) + "č" + ".pdf"
    assertEquals(MAX_BYTES + 1, bytes(straddle))
    assertEquals("a".repeat(MAX_BYTES - 5) + ".pdf", ExportFileNames.limit(straddle, pdf))
  }

  @Test
  fun namesWithoutExtensionHiddenOrEmptyGetSafeNames() {
    assertEquals("scan.pdf", forExport("scan", pdf))
    assertEquals(".hidden.pdf", forExport(".hidden", pdf))
    assertEquals("Document.pdf", forExport("", pdf))
    assertEquals("Photo.jpg", forExport("...", jpg))
    assertEquals("Photo.jpg", forExport("‮\u0000", jpg))
    assertEquals("secret.pdf", forExport("../../files/attachments/secret.pdf", pdf))

    // No extension and too long in bytes: cut, then the type's extension is added.
    val noExt = ExportFileNames.limit("ž".repeat(150), pdf)
    assertSafe(noExt)
    assertEquals("ž".repeat(MAX_BYTES / 2), noExt)
  }

  @Test
  fun anOverlongExtensionIsReplacedByTheTypesOwn() {
    val name = ExportFileNames.limit("漢".repeat(80) + "." + "x".repeat(30), pdf)
    assertSafe(name)
    assertTrue(name, name.endsWith(".pdf"))
    assertEquals(MAX_BYTES - (MAX_BYTES - 4) % 3, bytes(name))
    // Deterministic: same input, same output.
    assertEquals(name, ExportFileNames.limit("漢".repeat(80) + "." + "x".repeat(30), pdf))
  }

  @Test
  fun aLoneSurrogateNeverReachesTheFileSystem() {
    val name = forExport("broken\uD83D name.pdf", pdf)
    assertEquals("broken name.pdf", name)
    assertSafe(name)
  }

  @Test
  fun theShareCopyGetsTheSafeName() {
    val key = ByteArray(32) { 6 }
    val store = AttachmentStore(File(folder.root, "attachments")) { key.copyOf() }
    val id = "01a1a0dd-991f-783c-9531-3fab9ef47901"
    val record = store.import(id, ByteArrayInputStream("%PDF-1.4\n".toByteArray()), 1L shl 20)
    val shares = ShareFiles(store, File(folder.root, "cache/attachments/share"))
    val raw = "漢".repeat(116) + ".pdf"

    val file = shares.prepare(id, record.sizeBytes, record.sha256, raw, pdf)
    // Created on the real file system, with exactly the helper's name.
    assertTrue(file.exists())
    assertEquals(forExport(raw, pdf), file.name)
    assertSafe(file.name)
  }
}
