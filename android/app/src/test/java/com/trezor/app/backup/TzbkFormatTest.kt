package com.trezor.app.backup

import com.trezor.app.backup.BackupFormatException.Code
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Rejection rules of TZBK v1 (spec v2.4 §3; §13 tests 1, 2, 4, 6–8). */
class TzbkFormatTest {

  private val file = Vectors.obj("file")
  private val reference: ByteArray = Base64.getDecoder().decode(file.str("base64"))
  private val password = file.str("password").toByteArray(Charsets.UTF_8)
  private val header = Vectors.obj("header")
  private val headerBytes = unhex(header.str("header"))
  private val kek = unhex(header.str("kek"))

  /** Where section i's framing starts and where its ciphertext ends (manifest, database, attachments). */
  private val starts = mutableListOf<Int>()
  private val ends = mutableListOf<Int>()

  init {
    var at = Tzbk.HEADER_BYTES
    repeat(2 + file.list("attachments").size) {
      starts += at
      at += Tzbk.FRAMING_BYTES + BigEndian.u64(reference, at).toInt()
      ends += at
    }
  }

  /** Every framing boundary of [reference]: header end, framing ends, section ends, trailer, end. */
  private val boundaries: List<Int>
    get() = listOf(0, Tzbk.HEADER_BYTES) + starts.map { it + Tzbk.FRAMING_BYTES } + ends + reference.size

  /** Reads a whole file as the format allows; throws on the first problem. */
  private fun readAll(bytes: ByteArray, input: InputStream = ByteArrayInputStream(bytes)) {
    TzbkReader.open(input, password).use { r ->
      val manifest = BackupManifest.decode(r.readManifest())
      r.readDatabase(NullOutput)
      manifest.attachments.forEachIndexed { i, a -> r.readAttachment(i, a.tzaSizeBytes, NullOutput) }
      r.finish(manifest.attachments.size)
    }
  }

  private object NullOutput : OutputStream() {
    override fun write(b: Int) {}

    override fun write(b: ByteArray, off: Int, len: Int) {}
  }

  private fun withCrc(b: ByteArray): ByteArray =
      b.copyOf().also { BigEndian.putU32(it, Tzbk.OFF_CRC, TzbkHeader.crcOf(it)) }

  // --- Header (tests 1, 2) -------------------------------------------------------------

  @Test
  fun theReferenceFileReadsCompletely() {
    readAll(reference)
  }

  @Test
  fun headerErrorsFollowTheSpecifiedPrecedence() {
    expectCode(Code.BACKUP_CORRUPT) { TzbkHeader.parse(headerBytes.copyOf(127)) }
    expectCode(Code.BACKUP_CORRUPT) { TzbkHeader.parse(headerBytes.copyOf().also { it[0] = 'X'.code.toByte() }) }
    // Wrong version and a bad CRC: the version wins.
    expectCode(Code.BACKUP_UNSUPPORTED) { TzbkHeader.parse(headerBytes.copyOf().also { it[5] = 2 }) }
    expectCode(Code.BACKUP_UNSUPPORTED) { TzbkHeader.parse(headerBytes.copyOf().also { it[7] = 64 }) }
    // A bad CRC and a wrong m: the CRC wins.
    val badCrcAndM = headerBytes.copyOf().also { BigEndian.putU32(it, Tzbk.OFF_MEMORY, 131072) }
    expectCode(Code.BACKUP_CORRUPT) { TzbkHeader.parse(badCrcAndM) }
    // A wrong m with a good CRC.
    expectCode(Code.BACKUP_UNSUPPORTED) { TzbkHeader.parse(withCrc(badCrcAndM)) }
  }

  @Test
  fun everyConstrainedHeaderFieldIsRejectedBeforeArgon2() {
    fun rejects(change: (ByteArray) -> Unit) =
        expectCode(Code.BACKUP_UNSUPPORTED) { TzbkHeader.parse(withCrc(headerBytes.copyOf().also(change))) }
    rejects { it[Tzbk.OFF_KDF] = 0x02 }
    rejects { it[Tzbk.OFF_KDF] = 0x00 }
    rejects { it[Tzbk.OFF_CIPHER] = 0x02 }
    for (m in listOf(0L, 65535L, 65537L, 262144L, 0xFFFF_FFFFL)) rejects { BigEndian.putU32(it, Tzbk.OFF_MEMORY, m) }
    for (t in listOf(0L, 1L, 2L, 11L, 0xFFFF_FFFFL)) rejects { BigEndian.putU32(it, Tzbk.OFF_ITERATIONS, t) }
    for (p in listOf(0, 2, 255)) rejects { it[Tzbk.OFF_PARALLELISM] = p.toByte() }
    for (c in listOf(0L, 32768L, 65537L)) rejects { BigEndian.putU32(it, Tzbk.OFF_CHUNK, c) }
    rejects { it[Tzbk.OFF_RESERVED] = 1 }
    rejects { it[Tzbk.OFF_RESERVED + 1] = 1 }
    // 3…10 iterations are accepted.
    for (t in 3L..10L) TzbkHeader.parse(withCrc(headerBytes.copyOf().also { BigEndian.putU32(it, Tzbk.OFF_ITERATIONS, t) }))
  }

  @Test
  fun theMemoryPreCheckRunsBeforeArgon2() {
    var asked = 0
    expectCode(Code.BACKUP_INSUFFICIENT_MEMORY) {
      TzbkReader.open(ByteArrayInputStream(reference), password, MemoryCheck { asked++; 64L * 1024 * 1024 + 32L * 1024 * 1024 - 1 })
    }
    assertEquals(1, asked)
  }

  // --- BMK wrap (test 4) ---------------------------------------------------------------

  @Test
  fun changingAnyHeaderByteMakesTheUnwrapOrTheParseFail() {
    // The known KEK of the reference header: no Argon2 run per byte.
    assertEquals(header.str("bmk"), TzbkCrypto.unwrapBmk(kek, TzbkHeader.parse(headerBytes)).hex())
    for (offset in 0 until Tzbk.HEADER_BYTES) {
      if (offset in Tzbk.OFF_CRC until Tzbk.OFF_CRC + 4) continue
      val changed = withCrc(headerBytes.copyOf().also { it[offset] = (it[offset].toInt() xor 0x01).toByte() })
      try {
        val parsed = TzbkHeader.parse(changed)
        TzbkCrypto.unwrapBmk(kek, parsed)
        fail("offset $offset: a changed header unwrapped")
      } catch (e: BackupFormatException) {
        assertTrue(
            "offset $offset: ${e.code}",
            e.code == Code.BACKUP_PASSWORD_OR_HEADER || e.code == Code.BACKUP_UNSUPPORTED ||
                e.code == Code.BACKUP_CORRUPT)
      }
    }
    // A changed CRC alone is BACKUP_CORRUPT.
    expectCode(Code.BACKUP_CORRUPT) {
      TzbkHeader.parse(headerBytes.copyOf().also { it[Tzbk.OFF_CRC] = (it[Tzbk.OFF_CRC].toInt() xor 1).toByte() })
    }
  }

  @Test
  fun aWrongPasswordIsPasswordOrHeader() {
    expectCode(Code.BACKUP_PASSWORD_OR_HEADER) {
      TzbkReader.open(ByteArrayInputStream(reference), "correct horse batterz".toByteArray())
    }
  }

  // --- Lengths and nonces (tests 6, 7) -------------------------------------------------

  @Test
  fun theLengthInverseAcceptsExactlyTheLengthsTheForwardRuleProduces() {
    val c = Tzbk.CHUNK_SIZE
    val valid = HashSet<Long>()
    for (p in 0L..(3L * c + 2)) valid += TzbkSections.ciphertextLength(p)
    for (l in 0L..(3L * (c + 16) + 1)) {
      if (l in valid) {
        assertEquals(l, TzbkSections.ciphertextLength(TzbkSections.plaintextLength(l)))
      } else {
        expectCode(Code.BACKUP_CORRUPT) { TzbkSections.plaintextLength(l) }
      }
    }
    // Exact multiples have no extra empty chunk; an empty section is one chunk.
    assertEquals(16L, TzbkSections.ciphertextLength(0))
    assertEquals(c + 16L, TzbkSections.ciphertextLength(c.toLong()))
    assertEquals(c + 1 + 32L, TzbkSections.ciphertextLength(c + 1L))
    // No overflow near the top of the range: the largest length round-trips, and one whose
    // last chunk would be shorter than its tag is rejected.
    assertEquals(Long.MAX_VALUE, TzbkSections.ciphertextLength(TzbkSections.plaintextLength(Long.MAX_VALUE)))
    val top = (Long.MAX_VALUE / (c + 16) - 1) * (c + 16)
    expectCode(Code.BACKUP_CORRUPT) { TzbkSections.plaintextLength(top + 5) }
    assertEquals(top, TzbkSections.ciphertextLength(TzbkSections.plaintextLength(top)))
  }

  @Test
  fun noKeyAndNoncePairRepeatsInACompleteFile() {
    val seen = HashSet<String>()
    var pairs = 0
    TzbkKeys(file.hex("bmk"), unhex(header.str("backupId"))).use { keys ->
      fun add(type: Int, ordinal: Long, plaintextLength: Long) {
        val key = keys.section(type, ordinal).hex()
        val chunks = TzbkSections.chunkCount(plaintextLength)
        for (i in 0 until chunks) {
          seen += key + TzbkSections.nonce(unhex(header.str("noncePrefix")), i, i == chunks - 1).hex()
          pairs++
        }
      }
      val manifest = BackupManifest.decode(CompleteFile.manifestBytes(file))
      add(Tzbk.TYPE_MANIFEST, 0, manifest.encode().size.toLong())
      add(Tzbk.TYPE_DATABASE, 0, file.obj("database").long("length"))
      manifest.attachments.forEachIndexed { i, a -> add(Tzbk.TYPE_ATTACHMENT, i.toLong(), a.tzaSizeBytes) }
    }
    seen += kek.hex() + header.str("wrapIv")
    pairs++
    assertEquals(pairs, seen.size)
  }

  // --- Framing, truncation, extension, substitution (test 8) ----------------------------

  @Test
  fun truncationAtEveryFramingBoundaryAndOneByteEitherSideIsRejected() {
    val cuts = boundaries.flatMap { listOf(it - 1, it, it + 1) }.filter { it in 0 until reference.size }.toSortedSet()
    for (cut in cuts) {
      try {
        readAll(reference.copyOf(cut))
        fail("cut at $cut was read")
      } catch (e: BackupFormatException) {
        assertTrue("cut at $cut: ${e.code}", e.code == Code.BACKUP_CORRUPT)
      }
    }
  }

  @Test
  fun bytesAfterTheTrailerAreRejected() {
    expectCode(Code.BACKUP_CORRUPT) { readAll(reference + byteArrayOf(0)) }
    expectCode(Code.BACKUP_CORRUPT) { readAll(reference + ByteArray(32)) }
  }

  @Test
  fun aModifiedTrailerOrSectionByteIsRejected() {
    for (offset in listOf(reference.size - 1, reference.size - 32, starts[1] + Tzbk.FRAMING_BYTES + 5, starts[2] + 100)) {
      val changed = reference.copyOf().also { it[offset] = (it[offset].toInt() xor 0x01).toByte() }
      expectCode(Code.BACKUP_CORRUPT) { readAll(changed) }
    }
  }

  @Test
  fun reorderedAttachmentSectionsAreRejected() {
    // Swap the two attachment sections (framing and ciphertext).
    val a0 = reference.copyOfRange(starts[2], ends[2])
    val a1 = reference.copyOfRange(starts[3], ends[3])
    val swapped = reference.copyOfRange(0, starts[2]) + a1 + a0 + reference.copyOfRange(ends[3], reference.size)
    expectCode(Code.BACKUP_CORRUPT) { readAll(swapped) }
  }

  @Test
  fun aSectionFromAnotherBackupIsRejected() {
    // Same password and content, another backup ID (so other keys and AAD).
    val other = file.toMutableMap()
    other["header"] = file.obj("header").toMutableMap().also { it["backupId"] = "ff".repeat(16) }
    val otherBytes = CompleteFile.write(other)
    val database = otherBytes.copyOfRange(starts[1], ends[1])
    val spliced = reference.copyOfRange(0, starts[1]) + database + reference.copyOfRange(ends[1], reference.size)
    expectCode(Code.BACKUP_CORRUPT) { readAll(spliced) }
  }

  @Test
  fun aWrongSectionTypeOrOrdinalIsRejected() {
    for ((offset, value) in listOf(starts[0] + 8 to 0x02, starts[0] + 8 to 0x04, starts[0] + 12 to 1)) {
      val changed = reference.copyOf().also { it[offset] = value.toByte() }
      expectCode(Code.BACKUP_CORRUPT) { readAll(changed) }
    }
  }

  @Test
  fun finishingBeforeEveryAttachmentWasReadIsInconsistent() {
    TzbkReader.open(ByteArrayInputStream(reference), password).use { r ->
      val manifest = BackupManifest.decode(r.readManifest())
      r.readDatabase(NullOutput)
      r.readAttachment(0, manifest.attachments[0].tzaSizeBytes, NullOutput)
      expectCode(Code.BACKUP_INCONSISTENT) { r.finish(manifest.attachments.size) }
    }
  }

  // --- Limits before allocation ----------------------------------------------------------

  /** The reference file up to [cut], then a framing record claiming [plaintext] bytes. */
  private fun withFraming(cut: Int, type: Int, ordinal: Long, ciphertextLength: Long): ByteArray {
    val f = ByteArray(Tzbk.FRAMING_BYTES)
    BigEndian.putU64(f, 0, ciphertextLength)
    f[8] = type.toByte()
    BigEndian.putU32(f, 9, ordinal)
    return reference.copyOf(cut) + f
  }

  @Test
  fun oversizedSectionsAreRejectedBeforeTheirBytesAreRead() {
    // A manifest of 16 MiB + 1 byte; no section bytes follow, none are needed.
    val manifest = withFraming(Tzbk.HEADER_BYTES, Tzbk.TYPE_MANIFEST, 0, TzbkSections.ciphertextLength(Tzbk.MAX_MANIFEST_BYTES + 1))
    TzbkReader.open(ByteArrayInputStream(manifest), password).use { r -> expectCode(Code.BACKUP_TOO_LARGE) { r.readManifest() } }

    val database = withFraming(starts[1], Tzbk.TYPE_DATABASE, 0, TzbkSections.ciphertextLength(Tzbk.MAX_DATABASE_BYTES + 1))
    TzbkReader.open(ByteArrayInputStream(database), password).use { r ->
      r.readManifest()
      expectCode(Code.BACKUP_TOO_LARGE) { r.readDatabase(NullOutput) }
    }

    // A length with the top bit set (above 2^63).
    val huge = withFraming(Tzbk.HEADER_BYTES, Tzbk.TYPE_MANIFEST, 0, -16L)
    TzbkReader.open(ByteArrayInputStream(huge), password).use { r -> expectCode(Code.BACKUP_TOO_LARGE) { r.readManifest() } }
  }

  @Test
  fun anAttachmentSectionOfTheWrongLengthIsRejected() {
    TzbkReader.open(ByteArrayInputStream(reference), password).use { r ->
      val manifest = BackupManifest.decode(r.readManifest())
      r.readDatabase(NullOutput)
      expectCode(Code.BACKUP_TOO_LARGE) { r.readAttachment(0, manifest.attachments[0].tzaSizeBytes - 1, NullOutput) }
    }
    TzbkReader.open(ByteArrayInputStream(reference), password).use { r ->
      val manifest = BackupManifest.decode(r.readManifest())
      r.readDatabase(NullOutput)
      expectCode(Code.BACKUP_INCONSISTENT) { r.readAttachment(0, manifest.attachments[0].tzaSizeBytes + 1, NullOutput) }
    }
  }

  @Test
  fun aSectionReaderNeverReadsPastItsSection() {
    // The database section read from a stream that counts bytes: exactly the manifest and
    // database sections (and the header) are consumed.
    var consumed = 0L
    val counting =
        object : InputStream() {
          val inner = ByteArrayInputStream(reference)

          override fun read(): Int = inner.read().also { if (it >= 0) consumed++ }

          override fun read(b: ByteArray, off: Int, len: Int): Int = inner.read(b, off, len).also { if (it > 0) consumed += it }
        }
    TzbkReader.open(counting, password).use { r ->
      r.readManifest()
      r.readDatabase(NullOutput)
    }
    assertEquals(ends[1].toLong(), consumed)
  }

  // --- Writer misuse and key lifetime ----------------------------------------------------

  @Test
  fun theWriterEnforcesOrderLengthsAndCompleteness() {
    val f = Vectors.obj("file")
    val h = f.obj("header")
    val unsealed = TzbkHeader.unsealed(h.hex("salt"), h.hex("backupId"), h.hex("noncePrefix"), h.hex("wrapIv"))
    val sealed = TzbkHeader.sealed(unsealed, TzbkCrypto.wrapBmk(kek, f.hex("bmk"), unsealed))
    TzbkKeys(f.hex("bmk"), sealed.backupId).use { keys ->
      val w = TzbkWriter(ByteArrayOutputStream(), sealed, keys, attachmentCount = 1)
      expectState { w.writeDatabase(ByteArrayInputStream(ByteArray(1)), 1) }
      w.writeManifest(ByteArray(3))
      expectArgument { w.writeDatabase(ByteArrayInputStream(ByteArray(2)), 1) } // longer than its length
    }
    TzbkKeys(f.hex("bmk"), sealed.backupId).use { keys ->
      val w = TzbkWriter(ByteArrayOutputStream(), sealed, keys, attachmentCount = 1)
      w.writeManifest(ByteArray(3))
      expectArgument { w.writeDatabase(ByteArrayInputStream(ByteArray(1)), 2) } // shorter
    }
    TzbkKeys(f.hex("bmk"), sealed.backupId).use { keys ->
      val w = TzbkWriter(ByteArrayOutputStream(), sealed, keys, attachmentCount = 1)
      w.writeManifest(ByteArray(3))
      w.writeDatabase(ByteArrayInputStream(ByteArray(1)), 1)
      expectState { w.finish() } // attachment 0 missing
      expectCode(Code.BACKUP_TOO_LARGE) { w.writeDatabase(ByteArrayInputStream(ByteArray(0)), Tzbk.MAX_DATABASE_BYTES + 1) }
    }
  }

  @Test
  fun closedKeysDeriveNothing() {
    val keys = TzbkKeys(file.hex("bmk"), unhex(header.str("backupId")))
    keys.close()
    expectState { keys.section(Tzbk.TYPE_MANIFEST, 0) }
    expectState { keys.mac() }
  }

  private fun expectState(block: () -> Unit) {
    try {
      block()
      fail("expected IllegalStateException")
    } catch (e: IllegalStateException) {
      // expected
    }
  }

  private fun expectArgument(block: () -> Unit) {
    try {
      block()
      fail("expected IllegalArgumentException")
    } catch (e: IllegalArgumentException) {
      // expected
    }
  }
}
