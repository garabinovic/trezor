package com.trezor.app.backup

import java.io.InputStream
import java.io.OutputStream
import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Chunked AES-256-GCM of one section (spec §3.6). A section of `P` plaintext bytes is
 * `max(1, ⌈P/c⌉)` chunks of `c` = 65536 bytes (the last may be shorter; an empty section is
 * one empty chunk), each followed by its 16-byte tag.
 */
object TzbkSections {

  private const val FULL_CHUNK = Tzbk.CHUNK_SIZE + Tzbk.TAG_BYTES

  fun chunkCount(plaintextLength: Long): Long {
    require(plaintextLength >= 0)
    return maxOf(1L, (plaintextLength + Tzbk.CHUNK_SIZE - 1) / Tzbk.CHUNK_SIZE)
  }

  fun ciphertextLength(plaintextLength: Long): Long =
      plaintextLength + Tzbk.TAG_BYTES * chunkCount(plaintextLength)

  /**
   * The plaintext length of a section of [ciphertextLength] bytes, or BACKUP_CORRUPT when
   * no plaintext length produces it (spec §3.6 inverse).
   */
  fun plaintextLength(ciphertextLength: Long): Long {
    if (ciphertextLength < Tzbk.TAG_BYTES) corrupt("Section shorter than one tag")
    val k = (ciphertextLength - 1) / FULL_CHUNK + 1 // ⌈L / (c + 16)⌉ without overflow
    val p = ciphertextLength - Tzbk.TAG_BYTES * k
    if (p < 0 || chunkCount(p) != k) corrupt("Invalid section length")
    return p
  }

  fun nonce(prefix: ByteArray, index: Long, final: Boolean): ByteArray {
    require(prefix.size == Tzbk.NONCE_PREFIX_BYTES && index in 0..0xFFFF_FFFFL)
    val n = ByteArray(Tzbk.IV_BYTES)
    prefix.copyInto(n, 0)
    BigEndian.putU32(n, 7, index)
    n[11] = if (final) 1 else 0
    return n
  }

  /** backupId[16] ‖ type[1] ‖ ordinal[4] ‖ c[4] ‖ prefix[7] ‖ P[8] ‖ i[4] ‖ final[1] (45 bytes). */
  fun aad(
      backupId: ByteArray,
      type: Int,
      ordinal: Long,
      prefix: ByteArray,
      plaintextLength: Long,
      index: Long,
      final: Boolean,
  ): ByteArray {
    require(backupId.size == Tzbk.BACKUP_ID_BYTES && prefix.size == Tzbk.NONCE_PREFIX_BYTES)
    val a = ByteArray(45)
    backupId.copyInto(a, 0)
    a[16] = type.toByte()
    BigEndian.putU32(a, 17, ordinal)
    BigEndian.putU32(a, 21, Tzbk.CHUNK_SIZE.toLong())
    prefix.copyInto(a, 25)
    BigEndian.putU64(a, 32, plaintextLength)
    BigEndian.putU32(a, 40, index)
    a[44] = if (final) 1 else 0
    return a
  }

  /** Where a section belongs; part of every chunk's AAD. */
  class Context(val backupId: ByteArray, val noncePrefix: ByteArray, val type: Int, val ordinal: Long)

  /**
   * Encrypts exactly [plaintextLength] bytes from [input] (which must then be at its end)
   * into [output]. Returns the ciphertext length.
   */
  fun encrypt(input: InputStream, plaintextLength: Long, output: OutputStream, key: ByteArray, at: Context): Long {
    val chunks = chunkCount(plaintextLength)
    val buffer = ByteArray(Tzbk.CHUNK_SIZE)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    val spec = SecretKeySpec(key, "AES")
    var remaining = plaintextLength
    try {
      for (i in 0 until chunks) {
        val n = minOf(remaining, Tzbk.CHUNK_SIZE.toLong()).toInt()
        readExactly(input, buffer, n) { throw IllegalArgumentException("Input shorter than its length") }
        val final = i == chunks - 1
        cipher.init(Cipher.ENCRYPT_MODE, spec, GCMParameterSpec(128, nonce(at.noncePrefix, i, final)))
        cipher.updateAAD(aad(at.backupId, at.type, at.ordinal, at.noncePrefix, plaintextLength, i, final))
        output.write(cipher.doFinal(buffer, 0, n))
        remaining -= n
      }
      require(input.read() == -1) { "Input longer than its length" }
      return ciphertextLength(plaintextLength)
    } finally {
      buffer.fill(0)
    }
  }

  /**
   * Decrypts a section of exactly [ciphertextLength] bytes from [input] into [output],
   * chunk by chunk: each chunk's plaintext is written only after its tag verified. A
   * failure can leave a verified prefix in [output], which the caller discards. Returns
   * the plaintext length.
   */
  fun decrypt(input: InputStream, ciphertextLength: Long, output: OutputStream, key: ByteArray, at: Context): Long {
    val p = plaintextLength(ciphertextLength)
    val chunks = chunkCount(p)
    val buffer = ByteArray(FULL_CHUNK)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    val spec = SecretKeySpec(key, "AES")
    var remaining = p
    for (i in 0 until chunks) {
      val n = minOf(remaining, Tzbk.CHUNK_SIZE.toLong()).toInt()
      readExactly(input, buffer, n + Tzbk.TAG_BYTES) { corrupt("Section truncated") }
      val final = i == chunks - 1
      val plain =
          try {
            cipher.init(Cipher.DECRYPT_MODE, spec, GCMParameterSpec(128, nonce(at.noncePrefix, i, final)))
            cipher.updateAAD(aad(at.backupId, at.type, at.ordinal, at.noncePrefix, p, i, final))
            cipher.doFinal(buffer, 0, n + Tzbk.TAG_BYTES)
          } catch (e: GeneralSecurityException) {
            throw BackupFormatException(BackupFormatException.Code.BACKUP_CORRUPT, "Section chunk $i invalid", e)
          }
      output.write(plain)
      plain.fill(0)
      remaining -= n
    }
    buffer.fill(0)
    return p
  }

  internal inline fun readExactly(input: InputStream, buffer: ByteArray, n: Int, onShort: () -> Nothing) {
    var got = 0
    while (got < n) {
      val r = input.read(buffer, got, n - got)
      if (r < 0) onShort()
      got += r
    }
  }
}

/**
 * Reads at most [limit] bytes of [input] and reports end-of-stream after them, so a
 * section reader can never consume the next section's bytes (spec §3.6).
 */
class LimitedInputStream(private val input: InputStream, limit: Long) : InputStream() {

  var remaining: Long = limit
    private set

  override fun read(): Int {
    if (remaining <= 0) return -1
    val b = input.read()
    if (b >= 0) remaining--
    return b
  }

  override fun read(b: ByteArray, off: Int, len: Int): Int {
    if (len == 0) return 0
    if (remaining <= 0) return -1
    val n = input.read(b, off, minOf(len.toLong(), remaining).toInt())
    if (n > 0) remaining -= n
    return n
  }

  override fun available(): Int = minOf(input.available().toLong(), remaining).toInt()
}
