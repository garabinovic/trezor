package com.trezor.app.attachments

import com.trezor.app.vault.VaultException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Type detection, ids, names and key policy used when importing attachments. */
class AttachmentImportRulesTest {

  private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

  private fun ascii(text: String, pad: Int = 0) = text.toByteArray(Charsets.US_ASCII) + ByteArray(pad)

  private fun ftyp(brand: String) = bytes(0, 0, 0, 0x18) + ascii("ftyp") + ascii(brand)

  @Test
  fun sniffRecognisesSupportedTypesByContent() {
    assertEquals(MediaTypes.JPEG, MediaTypes.sniff(bytes(0xFF, 0xD8, 0xFF, 0xE0)))
    assertEquals(
        MediaTypes.PNG, MediaTypes.sniff(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0)))
    assertEquals(MediaTypes.WEBP, MediaTypes.sniff(ascii("RIFF") + bytes(1, 2, 3, 4) + ascii("WEBP")))
    assertEquals(MediaTypes.PDF, MediaTypes.sniff(ascii("%PDF-1.7")))
    assertEquals(MediaTypes.HEIC, MediaTypes.sniff(ftyp("heic")))
    assertEquals(MediaTypes.HEIC, MediaTypes.sniff(ftyp("hevc")))
    assertEquals(MediaTypes.HEIF, MediaTypes.sniff(ftyp("mif1")))
  }

  @Test
  fun sniffRejectsEverythingElse() {
    assertNull(MediaTypes.sniff(ByteArray(0)))
    assertNull(MediaTypes.sniff(bytes(0xFF, 0xD8))) // too short
    assertNull(MediaTypes.sniff(ascii("GIF89a", 6)))
    assertNull(MediaTypes.sniff(ascii("PK", 10))) // zip / office documents
    assertNull(MediaTypes.sniff(ascii("RIFF") + bytes(1, 2, 3, 4) + ascii("WAVE")))
    assertNull(MediaTypes.sniff(ftyp("avif")))
    assertNull(MediaTypes.sniff(ftyp("avis")))
    assertNull(MediaTypes.sniff(ftyp("isom"))) // mp4 video
    assertNull(MediaTypes.sniff(ascii("<html><body>")))
  }

  /** A full `ftyp` box: size, "ftyp", major brand, minor version, compatible brands. */
  private fun ftypBox(major: String, vararg compatible: String): ByteArray {
    val size = 16 + 4 * compatible.size
    return bytes(0, 0, 0, size) + ascii("ftyp") + ascii(major) + ByteArray(4) +
        compatible.fold(ByteArray(0)) { acc, b -> acc + ascii(b) }
  }

  @Test
  fun avifIsNeverTakenForHeif() {
    // AVIF stills from common encoders: generic HEIF major brand, AVIF compatible brand.
    assertNull(MediaTypes.sniff(ftypBox("mif1", "mif1", "avif", "miaf", "MA1B")))
    assertNull(MediaTypes.sniff(ftypBox("msf1", "msf1", "avis", "iso8")))
    assertNull(MediaTypes.sniff(ftypBox("avif", "mif1", "avif", "miaf")))
    // Real HEIF/HEIC keep working.
    assertEquals(MediaTypes.HEIF, MediaTypes.sniff(ftypBox("mif1", "mif1", "heic", "miaf")))
    assertEquals(MediaTypes.HEIC, MediaTypes.sniff(ftypBox("heic", "mif1", "heic")))
    // Box size 0 ("to the end of the file") still has its brands read.
    val toEnd = ftypBox("mif1", "mif1", "avif").also { it[3] = 0 }
    assertNull(MediaTypes.sniff(toEnd))
    // Brands past the declared box end are not read.
    assertEquals(MediaTypes.HEIF, MediaTypes.sniff(ftypBox("mif1", "heic") + ascii("avif")))
  }

  @Test
  fun uuidv7MatchesTheJavaScriptLayout() {
    // Same vector as __tests__/storage/ids.test.ts ("matches the native attachment id generator").
    val random = ByteArray(10) { 0xff.toByte() }
    assertEquals(
        "01920000-0000-7fff-bfff-ffffffffffff", AttachmentIds.uuidv7(0x019200000000L, random))
    val id = AttachmentIds.newId()
    assertTrue(id, AttachmentStore.ID_PATTERN.matches(id))
    assertEquals('7', id[14])
  }

  @Test
  fun namesKeepTheLastSegmentWithoutControlCharacters() {
    assertEquals("receipt.pdf", AttachmentImporter.cleanName("../../etc/receipt.pdf"))
    assertEquals("scan.pdf", AttachmentImporter.cleanName("C:\\Users\\me\\scan.pdf"))
    assertEquals("invoicefdp.exe", AttachmentImporter.cleanName("invoice\u202Efdp.exe"))
    assertEquals("ab", AttachmentImporter.cleanName(" a\u0000\nb "))
    assertEquals("", AttachmentImporter.cleanName(".."))
    assertEquals("", AttachmentImporter.cleanName(null))
  }

  @Test
  fun fileNamesGetAnExtensionAndALimit() {
    assertEquals("IMG_1.jpg", AttachmentImporter.fileName("IMG_1", MediaTypes.JPEG))
    assertEquals("IMG_1.jpeg", AttachmentImporter.fileName("IMG_1.jpeg", MediaTypes.JPEG))
    assertEquals("Photo.png", AttachmentImporter.fileName("", MediaTypes.PNG))
    assertEquals("Document.pdf", AttachmentImporter.fileName("", MediaTypes.PDF))
    assertEquals("x.pdf", AttachmentImporter.fileName("x.", MediaTypes.PDF))
    val long = AttachmentImporter.fileName("a".repeat(300) + ".pdf", MediaTypes.PDF)
    assertEquals(AttachmentImporter.MAX_NAME_CHARS, long.length)
    assertTrue(long.endsWith("a.pdf"))
    // Never cuts a surrogate pair in half.
    val emoji = AttachmentImporter.fileName("\uD83D\uDCC4".repeat(100) + ".pdf", MediaTypes.PDF)
    assertTrue(emoji.length <= AttachmentImporter.MAX_NAME_CHARS)
    assertTrue(!emoji.substring(0, emoji.length - 4).last().isHighSurrogate())
  }

  private class FakeVault(var hasKey: Boolean, var hasFiles: Boolean) {
    var created = 0
    val keys =
        AttachmentKeys(
            hasKey = { hasKey },
            getKey = { ByteArray(32) { 1 } },
            createKey = {
              created++
              hasKey = true
              ByteArray(32) { 2 }
            },
            hasFiles = { hasFiles },
        )
  }

  @Test
  fun keyIsCreatedOnlyWhenNoEncryptedFilesExist() {
    val fresh = FakeVault(hasKey = false, hasFiles = false)
    assertArrayEquals(ByteArray(32) { 2 }, fresh.keys.obtain())
    assertArrayEquals(ByteArray(32) { 1 }, fresh.keys.obtain())
    assertEquals(1, fresh.created)

    val orphaned = FakeVault(hasKey = false, hasFiles = true)
    try {
      orphaned.keys.obtain()
      fail("must not replace a lost key")
    } catch (e: VaultException) {
      assertEquals(VaultException.Code.KEY_NOT_FOUND, e.code)
    }
    assertEquals(0, orphaned.created)

    // Can't tell whether files exist: fail closed, never create a key.
    var created = 0
    val unknown =
        AttachmentKeys(
            hasKey = { false },
            getKey = { ByteArray(32) },
            createKey = { created++; ByteArray(32) },
            hasFiles = {
              throw AttachmentStore.StoreException(AttachmentStore.StoreException.Code.IO_FAILED, "x")
            },
        )
    try {
      unknown.obtain()
      fail("must not create a key when files can't be listed")
    } catch (e: AttachmentStore.StoreException) {
      assertEquals(AttachmentStore.StoreException.Code.IO_FAILED, e.code)
    }
    assertEquals(0, created)
  }
}
