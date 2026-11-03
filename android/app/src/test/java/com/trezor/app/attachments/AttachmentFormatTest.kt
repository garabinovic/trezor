package com.trezor.app.attachments

import com.trezor.app.attachments.AttachmentFormat.CHUNK_SIZE
import com.trezor.app.attachments.AttachmentFormat.FormatException.Code
import com.trezor.app.attachments.AttachmentFormat.HEADER_BYTES
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Random
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.fail
import org.junit.Test

class AttachmentFormatTest {

  private val id = "01a1a0dd-991f-783c-9531-3fab9ef47906"
  private val otherId = "01a1a0dd-991f-783c-9531-3fab9ef47907"
  private val key = ByteArray(32) { it.toByte() }
  private val otherKey = ByteArray(32) { (it + 1).toByte() }
  private val tag = 16

  private fun bytes(size: Int, seed: Long = size.toLong()) = ByteArray(size).also { Random(seed).nextBytes(it) }

  private fun sha(data: ByteArray) =
      MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

  private fun encrypt(plain: ByteArray, attachmentId: String = id, max: Long = Long.MAX_VALUE): ByteArray =
      ByteArrayOutputStream().also { out ->
        val result = AttachmentFormat.encrypt(ByteArrayInputStream(plain), out, attachmentId, key, max)
        assertEquals(plain.size.toLong(), result.sizeBytes)
        assertEquals(sha(plain), result.sha256)
      }.toByteArray()

  private fun decrypt(sealed: ByteArray, attachmentId: String = id, k: ByteArray = key): ByteArray =
      ByteArrayOutputStream().also { out ->
        AttachmentFormat.decrypt(ByteArrayInputStream(sealed), out, attachmentId, k)
      }.toByteArray()

  private fun expectFailure(code: Code, block: () -> Unit) {
    try {
      block()
      fail("expected $code")
    } catch (e: AttachmentFormat.FormatException) {
      assertEquals(code, e.code)
    }
  }

  private fun chunksFor(size: Int) = if (size == 0) 1 else (size + CHUNK_SIZE - 1) / CHUNK_SIZE

  @Test
  fun roundTripsEverySizeAroundChunkBoundaries() {
    for (size in listOf(0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, 3 * CHUNK_SIZE, 3 * CHUNK_SIZE + 17, 2_500_000)) {
      val plain = bytes(size)
      val sealed = encrypt(plain)
      assertEquals("length for $size", HEADER_BYTES + size + chunksFor(size) * tag, sealed.size)
      val result = ByteArrayOutputStream()
      val r = AttachmentFormat.decrypt(ByteArrayInputStream(sealed), result, id, key)
      assertArrayEquals("content for $size", plain, result.toByteArray())
      assertEquals(size.toLong(), r.sizeBytes)
      assertEquals(sha(plain), r.sha256)
    }
  }

  @Test
  fun ciphertextRevealsNoPlaintextAndEveryFileHasItsOwnKey() {
    val plain = "Passport 1234567 — Ana Marković ".repeat(4000).toByteArray()
    val a = encrypt(plain)
    val b = encrypt(plain)
    val needle = "Passport".toByteArray()
    assertFalse(String(a, Charsets.ISO_8859_1).contains(String(needle, Charsets.ISO_8859_1)))
    // Same content, same key and id: different DEK, wrap and nonces, so different bytes.
    assertFalse(a.copyOfRange(HEADER_BYTES, a.size).contentEquals(b.copyOfRange(HEADER_BYTES, b.size)))
  }

  @Test
  fun anyModifiedRegionIsDetected() {
    val sealed = encrypt(bytes(3 * CHUNK_SIZE + 100))
    fun flipped(offset: Int) = sealed.copyOf().also { it[offset] = (it[offset].toInt() xor 0x01).toByte() }
    expectFailure(Code.CORRUPTED) { decrypt(flipped(0)) } // magic
    expectFailure(Code.UNSUPPORTED) { decrypt(flipped(4)) } // version
    expectFailure(Code.CORRUPTED) { decrypt(flipped(8)) } // chunk size (still in range)
    expectFailure(Code.KEY_MISMATCH) { decrypt(flipped(9)) } // wrap IV
    expectFailure(Code.KEY_MISMATCH) { decrypt(flipped(30)) } // wrapped DEK
    expectFailure(Code.CORRUPTED) { decrypt(flipped(HEADER_BYTES - 1)) } // nonce prefix
    expectFailure(Code.CORRUPTED) { decrypt(flipped(HEADER_BYTES + 5)) } // first chunk
    expectFailure(Code.CORRUPTED) { decrypt(flipped(HEADER_BYTES + CHUNK_SIZE + 3)) } // first tag
    expectFailure(Code.CORRUPTED) { decrypt(flipped(sealed.size - 1)) } // last tag
  }

  @Test
  fun truncatedExtendedAndReorderedFilesAreRejected() {
    val plain = bytes(3 * CHUNK_SIZE) // three full chunks
    val sealed = encrypt(plain)
    val full = CHUNK_SIZE + tag
    // Dropping the last whole chunk leaves a valid-looking file: the last flag catches it.
    expectFailure(Code.CORRUPTED) { decrypt(sealed.copyOf(HEADER_BYTES + 2 * full)) }
    expectFailure(Code.CORRUPTED) { decrypt(sealed.copyOf(sealed.size - 1)) }
    expectFailure(Code.CORRUPTED) { decrypt(sealed.copyOf(HEADER_BYTES)) }
    expectFailure(Code.CORRUPTED) { decrypt(sealed.copyOf(HEADER_BYTES - 1)) }
    expectFailure(Code.CORRUPTED) { decrypt(ByteArray(0)) }
    expectFailure(Code.CORRUPTED) { decrypt(sealed + ByteArray(1)) }
    expectFailure(Code.CORRUPTED) { decrypt(sealed + sealed.copyOfRange(HEADER_BYTES, HEADER_BYTES + full)) }
    val swapped = sealed.copyOf()
    System.arraycopy(sealed, HEADER_BYTES + full, swapped, HEADER_BYTES, full)
    System.arraycopy(sealed, HEADER_BYTES, swapped, HEADER_BYTES + full, full)
    expectFailure(Code.CORRUPTED) { decrypt(swapped) }
  }

  @Test
  fun wrongKeyWrongIdAndForeignBodiesAreRejected() {
    val sealed = encrypt(bytes(1000))
    expectFailure(Code.KEY_MISMATCH) { decrypt(sealed, k = otherKey) }
    expectFailure(Code.KEY_MISMATCH) { decrypt(sealed, attachmentId = otherId) }
    // Header of one attachment with the body of another (same key): different DEK.
    val other = encrypt(bytes(1000, seed = 7))
    val grafted = sealed.copyOfRange(0, HEADER_BYTES) + other.copyOfRange(HEADER_BYTES, other.size)
    expectFailure(Code.CORRUPTED) { decrypt(grafted) }
  }

  @Test
  fun theSizeLimitIsEnforcedWhileReading() {
    encrypt(bytes(CHUNK_SIZE * 2), max = CHUNK_SIZE * 2L)
    expectFailure(Code.TOO_LARGE) { encrypt(bytes(CHUNK_SIZE * 2 + 1), max = CHUNK_SIZE * 2L) }
    expectFailure(Code.TOO_LARGE) { encrypt(bytes(10), max = 9) }
  }

  @Test
  fun rewrapMovesTheFileToAnotherKeyWithTheBodyUnchanged() {
    val plain = bytes(2 * CHUNK_SIZE + 5)
    val sealed = encrypt(plain)
    val moved =
        ByteArrayOutputStream().also {
          AttachmentFormat.rewrap(ByteArrayInputStream(sealed), it, id, key, otherKey)
        }.toByteArray()
    assertEquals(sealed.size, moved.size)
    assertNotEquals(sealed.copyOfRange(0, HEADER_BYTES).toList(), moved.copyOfRange(0, HEADER_BYTES).toList())
    assertArrayEquals(sealed.copyOfRange(HEADER_BYTES, sealed.size), moved.copyOfRange(HEADER_BYTES, moved.size))
    assertArrayEquals(plain, decrypt(moved, k = otherKey))
    expectFailure(Code.KEY_MISMATCH) { decrypt(moved, k = key) }
    expectFailure(Code.KEY_MISMATCH) {
      AttachmentFormat.rewrap(ByteArrayInputStream(sealed), ByteArrayOutputStream(), id, otherKey, key)
    }
  }

  @Test(expected = IllegalArgumentException::class)
  fun keysMustBe256Bit() {
    AttachmentFormat.encrypt(ByteArrayInputStream(ByteArray(1)), ByteArrayOutputStream(), id, ByteArray(16), 10)
  }
}
