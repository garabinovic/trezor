package com.trezor.app.backup

import com.trezor.app.backup.BackupFormatException.Code
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The manifest's strict parsing, field rules and canonical writer (spec v2.4 §3.8; §13 test 9, 44). */
class BackupManifestTest {

  private fun id(n: Int) = "01a1a0dd-991f-783c-9531-3fab9ef4%04d".format(n)

  private fun attachment(i: Int, size: Long = 1000, id: String = id(i)) =
      BackupManifest.Attachment(i, id, "f$i.pdf", "application/pdf", size, "a".repeat(64), 1, TzaSection.size(size))

  private fun manifest(attachments: List<BackupManifest.Attachment> = listOf(attachment(0), attachment(1))) =
      BackupManifest(
          createdAt = 1793000000000,
          app = BackupManifest.App("android", "1.0", 1),
          database = BackupManifest.Database(5000, "b".repeat(64)),
          attachments = attachments,
      )

  private val canonical = String(manifest().encode(), Charsets.UTF_8)

  private fun decodeText(text: String) = BackupManifest.decode(text.toByteArray(Charsets.UTF_8))

  private fun rejects(code: Code, text: String) = expectCode(code) { decodeText(text) }

  @Test
  fun theCanonicalFormRoundTrips() {
    assertEquals(manifest(), decodeText(canonical))
    assertTrue(canonical.startsWith("{\"format\":\"trezor-backup-manifest\",\"manifestVersion\":1,"))
    // Whitespace between tokens is accepted when reading.
    assertEquals(manifest(), decodeText(canonical.replace(",", " ,\n\t").replace(":", " : ")))
  }

  @Test
  fun structuralViolationsAreRejected() {
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"createdAt\"", "\"createdat\"")) // unknown + missing
    rejects(Code.BACKUP_CORRUPT, canonical.replace("{\"format\"", "{\"extra\":1,\"format\"")) // unknown key
    rejects(Code.BACKUP_CORRUPT, canonical.replace("{\"format\"", "{\"createdAt\":1,\"format\"")) // duplicate
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"createdAt\":1793000000000", "\"createdAt\":null"))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"createdAt\":1793000000000", "\"createdAt\":\"1\""))
    rejects(Code.BACKUP_CORRUPT, canonical + " x")
    rejects(Code.BACKUP_CORRUPT, canonical.dropLast(1))
    rejects(Code.BACKUP_CORRUPT, "[$canonical]")
    rejects(Code.BACKUP_CORRUPT, "\uFEFF$canonical")
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"1.0\"", "'1.0'"))
  }

  @Test
  fun numbersMustBeNonNegativeIntegersUpTo2Pow53Minus1() {
    for (bad in listOf("1.0", "1e3", "-1", "01", "9007199254740992", "99999999999999999999")) {
      rejects(Code.BACKUP_CORRUPT, canonical.replace("\"createdAt\":1793000000000", "\"createdAt\":$bad"))
    }
    decodeText(canonical.replace("\"createdAt\":1793000000000", "\"createdAt\":9007199254740991"))
    decodeText(canonical.replace("\"createdAt\":1793000000000", "\"createdAt\":0"))
  }

  @Test
  fun textMustBeWellFormedUtf8WithoutLoneSurrogates() {
    val bytes = canonical.toByteArray(Charsets.UTF_8)
    val at = canonical.indexOf("1.0") + 1
    for (bad in listOf(byteArrayOf(0xFF.toByte()), byteArrayOf(0xC0.toByte(), 0x80.toByte()), byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte()))) {
      expectCode(Code.BACKUP_CORRUPT) { BackupManifest.decode(bytes.copyOf(at) + bad + bytes.copyOfRange(at, bytes.size)) }
    }
    for (escape in listOf("\\ud800", "\\udc00", "\\ud800x", "\\ud800\\u0041")) {
      rejects(Code.BACKUP_CORRUPT, canonical.replace("\"1.0\"", "\"$escape\""))
    }
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"1.0\"", "\"a\u0001b\"")) // unescaped control
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"1.0\"", "\"\\x41\""))
    // A valid escaped pair is fine.
    assertEquals("\uD83D\uDE00", decodeText(canonical.replace("\"1.0\"", "\"\\ud83d\\ude00\"")).app.versionName)
  }

  @Test
  fun fieldRules() {
    rejects(Code.BACKUP_UNSUPPORTED, canonical.replace("trezor-backup-manifest", "trezor-backup"))
    rejects(Code.BACKUP_UNSUPPORTED, canonical.replace("\"manifestVersion\":1", "\"manifestVersion\":2"))
    rejects(Code.BACKUP_UNSUPPORTED, canonical.replace("\"schemaVersion\":3", "\"schemaVersion\":2"))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"android\"", "\"web\""))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"versionName\":\"1.0\"", "\"versionName\":\"\""))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"versionCode\":1", "\"versionCode\":2147483648"))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"sizeBytes\":5000", "\"sizeBytes\":0"))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"sizeBytes\":5000", "\"sizeBytes\":268435457"))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("b".repeat(64), "B".repeat(64)))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("b".repeat(64), "b".repeat(63)))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("application/pdf", "image/gif"))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"f0.pdf\"", "\"\""))
    rejects(Code.BACKUP_UNSUPPORTED, canonical.replace("\"formatVersion\":1,", "\"formatVersion\":2,"))
    rejects(Code.BACKUP_INCONSISTENT, canonical.replace("\"tzaSizeBytes\":1092", "\"tzaSizeBytes\":1093"))
    rejects(Code.BACKUP_INCONSISTENT, canonical.replace("\"ordinal\":1", "\"ordinal\":2"))
    rejects(Code.BACKUP_INCONSISTENT, canonical.replace(id(1), id(0))) // duplicate id
    rejects(Code.BACKUP_INCONSISTENT, canonical.replace(id(0), id(9))) // not sorted
    rejects(Code.BACKUP_INCONSISTENT, canonical.replace(id(0), "../../../etc/passwd")) // not an id
    rejects(Code.BACKUP_INCONSISTENT, canonical.replace(id(0), id(0).uppercase()))
  }

  @Test
  fun versionNameIsCountedInCodePoints() {
    val emoji64 = "\uD83D\uDE00".repeat(64) // 64 code points, 128 UTF-16 units
    decodeText(canonical.replace("\"versionName\":\"1.0\"", "\"versionName\":\"$emoji64\""))
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"versionName\":\"1.0\"", "\"versionName\":\"${emoji64}a\""))
  }

  @Test
  fun limits() {
    val mib25 = 25L * 1024 * 1024
    // 163 × 25 MiB + 21 MiB = exactly 4 GiB: accepted (inclusive).
    val exact = (0 until 164).map { attachment(it, if (it < 163) mib25 else 21L * 1024 * 1024) }
    manifest(exact).validate()
    val over = exact.mapIndexed { i, a -> if (i == 163) attachment(i, 21L * 1024 * 1024 + 1) else a }
    expectCode(Code.BACKUP_TOO_LARGE) { manifest(over).validate() }
    expectCode(Code.BACKUP_CORRUPT) { manifest(listOf(attachment(0, mib25 + 1))).validate() }
    expectCode(Code.BACKUP_TOO_LARGE) { manifest((0..Tzbk.MAX_ATTACHMENTS).map { attachment(it, 0) }).validate() }
    expectCode(Code.BACKUP_TOO_LARGE) { BackupManifest.decode(ByteArray((Tzbk.MAX_MANIFEST_BYTES + 1).toInt())) }
    // Nesting deeper than the manifest's own structure.
    rejects(Code.BACKUP_CORRUPT, canonical.replace("\"versionCode\":1", "\"versionCode\":[[[1]]]"))
  }

  @Test
  fun theCanonicalWriterEscapesOnlyWhatJsonStringifyEscapes() {
    val name = "q\"b\\s/n\nt\tc\u0007d\u007Fe\u0085\u00E9\uD83D\uDE00"
    val text = String(manifest().copy(app = BackupManifest.App("android", name, 1)).encode(), Charsets.UTF_8)
    assertTrue(text.contains("\"versionName\":\"q\\\"b\\\\s/n\\nt\\tc\\u0007d\u007Fe\u0085\u00E9\uD83D\uDE00\""))
    try {
      manifest().copy(app = BackupManifest.App("android", "a\uD800b", 1)).encode()
      throw AssertionError("an unpaired surrogate was written")
    } catch (e: IllegalArgumentException) {
      // expected
    }
  }
}
