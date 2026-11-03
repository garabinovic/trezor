package com.trezor.app.attachments

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypted attachment file, format "TZA" version 1. Pure JVM (javax.crypto), no Android.
 *
 * Every file has its own random 256-bit data key (DEK), wrapped by the caller's key (the
 * KeyVault "attachments" key). The body is chunked AES-256-GCM (STREAM construction):
 *
 * ```
 * header  = magic "TZA1" | version u8 | chunkSize u32 | wrapIv 12 | wrappedDek 32+16 | noncePrefix 7
 * chunk i = AES-GCM(DEK, nonce = noncePrefix | u32 i | lastFlag, AAD = body AAD) ; plaintext ≤ chunkSize
 * ```
 *
 * - The DEK wrap's AAD binds format, version and attachment id; the chunks' AAD binds the
 *   same plus chunk size and nonce prefix. The wrap fields are left out of the chunk AAD on
 *   purpose: backup can rewrap the DEK ([rewrap]) and copy the body unchanged.
 * - Chunk index and last flag in the nonce detect reordered, dropped, truncated (also at a
 *   chunk boundary) and appended data; the id in the AAD detects files swapped between
 *   attachments. Only the last chunk may be short; an empty file is one empty last chunk.
 * - Each chunk is authenticated before its plaintext is written, so a failed decryption can
 *   leave only a prefix of authentic plaintext in the output; callers discard it.
 */
object AttachmentFormat {

  const val VERSION = 1
  const val CHUNK_SIZE = 64 * 1024
  const val KEY_BYTES = 32
  private val MAGIC = "TZA1".toByteArray(Charsets.US_ASCII)
  private const val TAG_BYTES = 16
  private const val IV_BYTES = 12
  private const val PREFIX_BYTES = 7
  private const val WRAPPED_DEK_BYTES = KEY_BYTES + TAG_BYTES
  const val HEADER_BYTES = 4 + 1 + 4 + IV_BYTES + WRAPPED_DEK_BYTES + PREFIX_BYTES
  /** Bounds for a chunk size read from a header (files written by this version use 64 KiB). */
  private const val MAX_CHUNK_SIZE = 1024 * 1024
  private const val TRANSFORMATION = "AES/GCM/NoPadding"

  class Result(val sizeBytes: Long, val sha256: String)

  class FormatException(val code: Code, message: String, cause: Throwable? = null) :
      Exception(message, cause) {
    enum class Code {
      /** Not a TZA file, or damaged/tampered/truncated content. */
      CORRUPTED,
      /** A version or chunk size this build can't read. */
      UNSUPPORTED,
      /** The DEK can't be unwrapped: wrong key or wrong attachment id (or damaged wrap). */
      KEY_MISMATCH,
      /** The plaintext exceeds the caller's limit. */
      TOO_LARGE,
    }
  }

  private class Header(
      val chunkSize: Int,
      val wrapIv: ByteArray,
      val wrappedDek: ByteArray,
      val noncePrefix: ByteArray,
  ) {
    fun write(out: OutputStream) {
      out.write(MAGIC)
      out.write(VERSION)
      out.write(ByteBuffer.allocate(4).putInt(chunkSize).array())
      out.write(wrapIv)
      out.write(wrappedDek)
      out.write(noncePrefix)
    }
  }

  private fun wrapAad(id: String) = "trezor.attachment-dek|$VERSION|$id".toByteArray(Charsets.UTF_8)

  private fun bodyAad(id: String, header: Header): ByteArray =
      ByteArrayOutputStream().apply {
            write("trezor.attachment|$VERSION|$id|${header.chunkSize}|".toByteArray(Charsets.UTF_8))
            write(header.noncePrefix)
          }
          .toByteArray()

  private fun nonce(prefix: ByteArray, index: Int, last: Boolean): ByteArray =
      ByteBuffer.allocate(IV_BYTES)
          .put(prefix)
          .putInt(index)
          .put(if (last) 1.toByte() else 0.toByte())
          .array()

  private fun requireKey(key: ByteArray) {
    require(key.size == KEY_BYTES) { "Wrapping key must be $KEY_BYTES bytes" }
  }

  private fun wrapDek(key: ByteArray, id: String, dek: ByteArray, random: SecureRandom): Pair<ByteArray, ByteArray> {
    val iv = ByteArray(IV_BYTES).also(random::nextBytes)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BYTES * 8, iv))
    cipher.updateAAD(wrapAad(id))
    return iv to cipher.doFinal(dek)
  }

  private fun unwrapDek(key: ByteArray, id: String, header: Header): ByteArray =
      try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(TAG_BYTES * 8, header.wrapIv),
        )
        cipher.updateAAD(wrapAad(id))
        cipher.doFinal(header.wrappedDek)
      } catch (e: GeneralSecurityException) {
        throw FormatException(FormatException.Code.KEY_MISMATCH, "Attachment key mismatch", e)
      }

  private fun readHeader(input: InputStream): Header {
    val data = DataInputStream(input)
    try {
      val magic = ByteArray(MAGIC.size).also(data::readFully)
      if (!magic.contentEquals(MAGIC)) {
        throw FormatException(FormatException.Code.CORRUPTED, "Not an attachment file")
      }
      val version = data.readUnsignedByte()
      if (version != VERSION) {
        throw FormatException(FormatException.Code.UNSUPPORTED, "Attachment format v$version")
      }
      val chunkSize = data.readInt()
      if (chunkSize !in 1..MAX_CHUNK_SIZE) {
        throw FormatException(FormatException.Code.UNSUPPORTED, "Chunk size $chunkSize")
      }
      return Header(
          chunkSize,
          ByteArray(IV_BYTES).also(data::readFully),
          ByteArray(WRAPPED_DEK_BYTES).also(data::readFully),
          ByteArray(PREFIX_BYTES).also(data::readFully),
      )
    } catch (e: EOFException) {
      throw FormatException(FormatException.Code.CORRUPTED, "Attachment header truncated", e)
    }
  }

  /** Reads until [buffer] is full or the stream ends; returns the number of bytes read. */
  private fun readFully(input: InputStream, buffer: ByteArray): Int {
    var total = 0
    while (total < buffer.size) {
      val n = input.read(buffer, total, buffer.size - total)
      if (n < 0) break
      total += n
    }
    return total
  }

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  /**
   * Encrypts [input] for attachment [id] into [output] (the stream is not closed).
   * Fails with TOO_LARGE once more than [maxBytes] plaintext bytes are read.
   */
  fun encrypt(
      input: InputStream,
      output: OutputStream,
      id: String,
      key: ByteArray,
      maxBytes: Long,
      random: SecureRandom = SecureRandom(),
  ): Result {
    requireKey(key)
    val dek = ByteArray(KEY_BYTES).also(random::nextBytes)
    try {
      val (wrapIv, wrappedDek) = wrapDek(key, id, dek, random)
      val header = Header(CHUNK_SIZE, wrapIv, wrappedDek, ByteArray(PREFIX_BYTES).also(random::nextBytes))
      header.write(output)
      val aad = bodyAad(id, header)
      val dekKey = SecretKeySpec(dek, "AES")
      val cipher = Cipher.getInstance(TRANSFORMATION)
      val digest = MessageDigest.getInstance("SHA-256")

      // One chunk of read-ahead: a chunk is the last one only if nothing follows it.
      var current = ByteArray(CHUNK_SIZE)
      var next = ByteArray(CHUNK_SIZE)
      var currentLength = readFully(input, current)
      var total = currentLength.toLong()
      var index = 0
      while (true) {
        if (total > maxBytes) {
          throw FormatException(FormatException.Code.TOO_LARGE, "Attachment exceeds $maxBytes bytes")
        }
        val nextLength = if (currentLength == CHUNK_SIZE) readFully(input, next) else 0
        val last = nextLength == 0
        cipher.init(
            Cipher.ENCRYPT_MODE,
            dekKey,
            GCMParameterSpec(TAG_BYTES * 8, nonce(header.noncePrefix, index, last)),
        )
        cipher.updateAAD(aad)
        output.write(cipher.doFinal(current, 0, currentLength))
        digest.update(current, 0, currentLength)
        if (last) break
        if (index == Int.MAX_VALUE) {
          throw FormatException(FormatException.Code.TOO_LARGE, "Too many chunks")
        }
        index++
        total += nextLength
        current = next.also { next = current }
        currentLength = nextLength
      }
      current.fill(0)
      next.fill(0)
      return Result(total, hex(digest.digest()))
    } finally {
      dek.fill(0)
    }
  }

  /**
   * Decrypts and authenticates attachment [id] from [input] into [output]. Throws
   * [FormatException] on any mismatch; the output may then hold a prefix of the plaintext.
   */
  fun decrypt(input: InputStream, output: OutputStream, id: String, key: ByteArray): Result {
    requireKey(key)
    val header = readHeader(input)
    val dek = unwrapDek(key, id, header)
    try {
      val aad = bodyAad(id, header)
      val dekKey = SecretKeySpec(dek, "AES")
      val cipher = Cipher.getInstance(TRANSFORMATION)
      val digest = MessageDigest.getInstance("SHA-256")
      val full = header.chunkSize + TAG_BYTES

      var current = ByteArray(full)
      var next = ByteArray(full)
      var currentLength = readFully(input, current)
      var total = 0L
      var index = 0
      while (true) {
        if (currentLength < TAG_BYTES) {
          throw FormatException(FormatException.Code.CORRUPTED, "Attachment truncated")
        }
        val nextLength = if (currentLength == full) readFully(input, next) else 0
        val last = nextLength == 0
        val plain =
            try {
              cipher.init(
                  Cipher.DECRYPT_MODE,
                  dekKey,
                  GCMParameterSpec(TAG_BYTES * 8, nonce(header.noncePrefix, index, last)),
              )
              cipher.updateAAD(aad)
              cipher.doFinal(current, 0, currentLength)
            } catch (e: GeneralSecurityException) {
              throw FormatException(FormatException.Code.CORRUPTED, "Attachment chunk $index invalid", e)
            }
        output.write(plain)
        digest.update(plain)
        total += plain.size
        plain.fill(0)
        if (last) break
        if (index == Int.MAX_VALUE) {
          throw FormatException(FormatException.Code.CORRUPTED, "Too many chunks")
        }
        index++
        current = next.also { next = current }
        currentLength = nextLength
      }
      return Result(total, hex(digest.digest()))
    } finally {
      dek.fill(0)
    }
  }

  /**
   * Re-wraps attachment [id]'s DEK from [oldKey] to [newKey] and copies the body unchanged
   * (backup export and restore). Doesn't authenticate the body: callers verify with
   * [decrypt] under the new key.
   */
  fun rewrap(
      input: InputStream,
      output: OutputStream,
      id: String,
      oldKey: ByteArray,
      newKey: ByteArray,
      random: SecureRandom = SecureRandom(),
  ) {
    requireKey(oldKey)
    requireKey(newKey)
    val header = readHeader(input)
    val dek = unwrapDek(oldKey, id, header)
    try {
      val (wrapIv, wrappedDek) = wrapDek(newKey, id, dek, random)
      Header(header.chunkSize, wrapIv, wrappedDek, header.noncePrefix).write(output)
      input.copyTo(output)
    } finally {
      dek.fill(0)
    }
  }
}
