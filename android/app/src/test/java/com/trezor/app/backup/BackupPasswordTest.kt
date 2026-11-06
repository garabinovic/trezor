package com.trezor.app.backup

import com.trezor.app.backup.BackupPassword.PasswordException
import com.trezor.app.backup.BackupPassword.PasswordException.Code
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Backup password rules (spec v2.4 §4; §13 test 10). The expected categories, ages and NFC
 * results below are taken from the Unicode standard, not from the generated table.
 */
class BackupPasswordTest {

  private fun utf8(s: String) = s.toByteArray(Charsets.UTF_8)

  private fun expect(code: Code, password: String, position: Int? = null) {
    try {
      BackupPassword.encode(password)
      throw AssertionError("accepted: $password")
    } catch (e: PasswordException) {
      assertEquals(code, e.code)
      if (position != null) assertEquals(position, e.position)
    }
  }

  @Test
  fun theTableMatchesItsRecordedChecksumAndIsWellFormed() {
    val r = Unicode8Allowed.RANGES
    val lines = StringBuilder()
    var count = 0L
    var previousEnd = -2
    for (i in r.indices step 2) {
      assertTrue("sorted and disjoint at $i", r[i] > previousEnd + 1 || i == 0)
      assertTrue(r[i] <= r[i + 1])
      previousEnd = r[i + 1]
      count += r[i + 1] - r[i] + 1
      lines.append(Integer.toHexString(r[i])).append('-').append(Integer.toHexString(r[i + 1])).append('\n')
    }
    val sha = MessageDigest.getInstance("SHA-256").digest(lines.toString().toByteArray()).joinToString("") { "%02x".format(it) }
    assertEquals(Unicode8Allowed.TABLE_SHA256, sha)
    assertEquals(Unicode8Allowed.CODE_POINTS.toLong(), count)
  }

  @Test
  fun allowedCharacters() {
    for (cp in
        listOf(
            0x0020, // SPACE (Zs)
            0x0041, 0x007A, 0x00A0, // NBSP (Zs)
            0x00E9, 0x0301, // combining acute (Mn)
            0x3000, // ideographic space (Zs)
            0x200C, 0x200D, // ZWNJ, ZWJ (Cf, allowed by name)
            0xFE0F, 0xE0100, // variation selectors (Mn)
            0x1F600, // 6.1
            0x1F3FB, 0x1F918, // 8.0: skin tone modifier, SIGN OF THE HORNS
            0x0436, 0x4E2D, 0xAC00)) {
      assertTrue("U+%04X".format(cp), BackupPassword.isAllowed(cp))
    }
  }

  @Test
  fun rejectedCharacters() {
    for (cp in
        listOf(
            0x0000, 0x0007, 0x001F, 0x007F, 0x0085, // Cc
            0x00AD, 0x200B, 0x200E, 0x202E, 0x2060, 0x2066, 0xFEFF, 0xE0041, // Cf incl. bidi, tags
            0xE000, 0xF0000, // Co
            0xD800, 0xDFFF, // Cs
            0xFFFE, 0xFFFF, 0xFDD0, 0x10FFFF, // noncharacters
            0x0378, // unassigned
            0x2028, 0x2029, // Zl, Zp
            0x1F923, // 9.0
            0x1F9D0, // 10.0
        )) {
      assertFalse("U+%04X".format(cp), BackupPassword.isAllowed(cp))
    }
  }

  @Test
  fun aValidPasswordIsItsNfcUtf8Bytes() {
    assertArrayEquals(utf8("correct horse battery"), BackupPassword.encode("correct horse battery"))
    // No trimming, no case folding.
    assertArrayEquals(utf8("  Correct Horse  "), BackupPassword.encode("  Correct Horse  "))
  }

  @Test
  fun nfcEquivalentInputsGiveIdenticalBytes() {
    val pad = "password-"
    for ((a, b, expected) in
        listOf(
            Triple("é", "é", "c3a9"),
            Triple("Å", "Å", "c385"), // ANGSTROM SIGN → Å
            Triple("한", "한", "ed959c"), // Hangul jamo → 한
            Triple("ą́", "ą́", "c485cc81"), // canonical ordering
        )) {
      val x = BackupPassword.encode(pad + a)
      val y = BackupPassword.encode(pad + b)
      assertArrayEquals(x, y)
      assertEquals(utf8(pad).hex() + expected, x.hex())
    }
  }

  @Test
  fun malformedUtf16IsInvalid() {
    expect(Code.PASSWORD_INVALID, "abcdefghijk\uD800")
    expect(Code.PASSWORD_INVALID, "abcde\uDC00fghijk", position = 5)
    expect(Code.PASSWORD_INVALID, "\uD800\uD800abcdefghijk", position = 0)
  }

  @Test
  fun aDisallowedCharacterIsReportedWithItsCodePointPosition() {
    expect(Code.PASSWORD_CHARACTER, "abcdefghij\u0007", position = 10)
    expect(Code.PASSWORD_CHARACTER, "😀😀abcdefgh‮", position = 10)
    expect(Code.PASSWORD_CHARACTER, "abcdefghij🤣") // U+1F923, Unicode 9.0
    expect(Code.PASSWORD_CHARACTER, "abcdefghij­")
  }

  @Test
  fun lengthIsCountedInCodePointsAfterNfc() {
    expect(Code.PASSWORD_LENGTH, "123456789")
    BackupPassword.encode("1234567890")
    BackupPassword.encode("a".repeat(256))
    expect(Code.PASSWORD_LENGTH, "a".repeat(257))
    // 10 code points before NFC, 9 after: rejected.
    expect(Code.PASSWORD_LENGTH, "abcdefgh" + "é")
    // 11 before, 10 after: accepted.
    BackupPassword.encode("abcdefghi" + "é")
    // 256 four-byte code points are exactly 1024 UTF-8 bytes: accepted.
    assertEquals(1024, BackupPassword.encode("😀".repeat(256)).size)
  }

  @Test
  fun confirmation() {
    assertArrayEquals(utf8("password-é"), BackupPassword.encodeConfirmed("password-é", "password-é"))
    try {
      BackupPassword.encodeConfirmed("correct horse battery", "correct horse batterY")
      throw AssertionError("a different confirmation was accepted")
    } catch (e: PasswordException) {
      assertEquals(Code.PASSWORD_MISMATCH, e.code)
    }
  }
}

/** TZA v1 rules for backup sections (Annex A §A.6). */
class TzaSectionTest {

  @Test
  fun tzaSizeMatchesAnnexAExamples() {
    assertEquals(1092L, TzaSection.size(1000))
    assertEquals(92L, TzaSection.size(0))
    assertEquals(65628L, TzaSection.size(65536))
    assertEquals(65645L, TzaSection.size(65537))
  }

  @Test
  fun aBackupSectionNeedsMagicVersion1AndChunkSize65536() {
    val header = unhex(Vectors.list("tza")[0].str("header"))
    TzaSection.checkHeader(header)
    expectCode(BackupFormatException.Code.BACKUP_CORRUPT) { TzaSection.checkHeader(header.copyOf(75)) }
    expectCode(BackupFormatException.Code.BACKUP_CORRUPT) { TzaSection.checkHeader(header.copyOf().also { it[3] = '2'.code.toByte() }) }
    expectCode(BackupFormatException.Code.BACKUP_UNSUPPORTED) { TzaSection.checkHeader(header.copyOf().also { it[4] = 2 }) }
    // A chunk size the device reader would accept (32 KiB) is not allowed in a backup.
    expectCode(BackupFormatException.Code.BACKUP_UNSUPPORTED) {
      TzaSection.checkHeader(header.copyOf().also { BigEndian.putU32(it, 5, 32768) })
    }
  }
}
