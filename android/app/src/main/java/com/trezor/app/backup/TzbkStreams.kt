package com.trezor.app.backup

import java.io.FilterOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Writes a TZBK v1 file section by section in the fixed order: manifest, database, then
 * exactly [attachmentCount] attachments, then the trailer (spec §3.6–3.7). [header] must be
 * sealed already. The HMAC covers the header (CRC zeroed) and every framing record and
 * ciphertext byte as written.
 */
class TzbkWriter(
    private val output: OutputStream,
    private val header: TzbkHeader,
    private val keys: TzbkKeys,
    private val attachmentCount: Int,
) {

  private val mac = macFor(keys)
  private var written = 0L
  private val out =
      object : FilterOutputStream(output) {
        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

        override fun write(b: ByteArray, off: Int, len: Int) {
          written += len
          if (written > Tzbk.MAX_FILE_BYTES) tooLarge("Backup exceeds 5.25 GiB")
          mac.update(b, off, len)
          output.write(b, off, len)
        }
      }
  private var next = 0 // 0 manifest, 1 database, 2 + i attachment i, then done

  init {
    require(attachmentCount in 0..Tzbk.MAX_ATTACHMENTS)
    val bytes = header.encoded()
    output.write(bytes)
    written = bytes.size.toLong()
    mac.update(header.forMac())
  }

  fun writeManifest(manifest: ByteArray) {
    if (manifest.size > Tzbk.MAX_MANIFEST_BYTES) tooLarge("Manifest too large")
    section(0, Tzbk.TYPE_MANIFEST, 0, manifest.inputStream(), manifest.size.toLong())
  }

  fun writeDatabase(input: InputStream, length: Long) {
    if (length > Tzbk.MAX_DATABASE_BYTES) tooLarge("Database too large")
    section(1, Tzbk.TYPE_DATABASE, 0, input, length)
  }

  /** Attachment [ordinal]'s rewrapped TZA file, exactly [length] bytes. */
  fun writeAttachment(ordinal: Int, input: InputStream, length: Long) {
    require(ordinal < attachmentCount)
    section(2 + ordinal, Tzbk.TYPE_ATTACHMENT, ordinal.toLong(), input, length)
  }

  /** Writes the trailer. Every section must have been written. */
  fun finish() {
    check(next == 2 + attachmentCount) { "Sections missing" }
    // The trailer is not part of its own MAC, so it bypasses [out].
    output.write(mac.doFinal())
    written += Tzbk.TRAILER_BYTES
    next++
  }

  private fun section(position: Int, type: Int, ordinal: Long, input: InputStream, length: Long) {
    check(next == position) { "Sections out of order" }
    val framing = ByteArray(Tzbk.FRAMING_BYTES)
    BigEndian.putU64(framing, 0, TzbkSections.ciphertextLength(length))
    framing[8] = type.toByte()
    BigEndian.putU32(framing, 9, ordinal)
    out.write(framing)
    val key = keys.section(type, ordinal)
    try {
      TzbkSections.encrypt(input, length, out, key, TzbkSections.Context(header.backupId, header.noncePrefix, type, ordinal))
    } finally {
      key.fill(0)
    }
    next++
  }

  companion object {
    internal fun macFor(keys: TzbkKeys): Mac {
      val key = keys.mac()
      try {
        return Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
      } finally {
        key.fill(0)
      }
    }
  }
}

/**
 * Reads a TZBK v1 file section by section, in the fixed order, verifying every chunk as it
 * goes and the trailer at [finish]. Plaintext handed out before [finish] has passed its
 * chunk's GCM tag but is provisional until the trailer verifies (spec §3.7): callers must
 * not mark anything derived from it as valid before that.
 */
class TzbkReader private constructor(
    private val input: InputStream,
    val header: TzbkHeader,
    private val keys: TzbkKeys,
) : AutoCloseable {

  private val mac = TzbkWriter.macFor(keys)
  private var read = Tzbk.HEADER_BYTES.toLong()
  private var next = 0
  private val counting =
      object : InputStream() {
        override fun read(): Int {
          val one = ByteArray(1)
          return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
          val n = input.read(b, off, len)
          if (n > 0) {
            read += n
            if (read > Tzbk.MAX_FILE_BYTES) tooLarge("Backup exceeds 5.25 GiB")
            mac.update(b, off, n)
          }
          return n
        }
      }

  init {
    mac.update(header.forMac())
  }

  /** The manifest's plaintext (at most 16 MiB, allocated after the length check). */
  fun readManifest(): ByteArray {
    val length = framing(0, Tzbk.TYPE_MANIFEST, 0, Tzbk.MAX_MANIFEST_BYTES)
    val out = java.io.ByteArrayOutputStream(TzbkSections.plaintextLength(length).toInt())
    section(Tzbk.TYPE_MANIFEST, 0, length, out)
    return out.toByteArray()
  }

  /** Decrypts the database section into [output]; returns its plaintext length. */
  fun readDatabase(output: OutputStream): Long {
    val length = framing(1, Tzbk.TYPE_DATABASE, 0, Tzbk.MAX_DATABASE_BYTES)
    return section(Tzbk.TYPE_DATABASE, 0, length, output)
  }

  /**
   * Decrypts attachment [ordinal] (its rewrapped TZA file) into [output]. Its length must be
   * exactly [expectedTzaBytes], the manifest entry's `tzaSizeBytes`.
   */
  fun readAttachment(ordinal: Int, expectedTzaBytes: Long, output: OutputStream) {
    val length = framing(2 + ordinal, Tzbk.TYPE_ATTACHMENT, ordinal.toLong(), expectedTzaBytes)
    if (TzbkSections.plaintextLength(length) != expectedTzaBytes) inconsistent("Attachment length")
    section(Tzbk.TYPE_ATTACHMENT, ordinal.toLong(), length, output)
  }

  /**
   * Reads the 32-byte trailer, compares it in constant time, and requires the end of the
   * file right after it. [attachmentCount] is the manifest's count: every attachment
   * section must have been read.
   */
  fun finish(attachmentCount: Int) {
    if (next != 2 + attachmentCount) inconsistent("Sections missing")
    val expected = mac.doFinal()
    val trailer = ByteArray(Tzbk.TRAILER_BYTES)
    TzbkSections.readExactly(input, trailer, trailer.size) { corrupt("Trailer missing") }
    if (!MessageDigest.isEqual(expected, trailer)) corrupt("Trailer does not match")
    if (input.read() != -1) corrupt("Data after the trailer")
    next++
  }

  override fun close() = keys.close()

  private fun framing(position: Int, type: Int, ordinal: Long, maxPlaintext: Long): Long {
    check(next == position) { "Sections out of order" }
    val f = ByteArray(Tzbk.FRAMING_BYTES)
    TzbkSections.readExactly(counting, f, f.size) { corrupt("Section framing truncated") }
    val length = BigEndian.u64(f, 0)
    if (length < 0) tooLarge("Section length")
    if (f[8].toInt() and 0xff != type || BigEndian.u32(f, 9) != ordinal) corrupt("Unexpected section")
    // Checked before anything of the section is read or allocated.
    if (TzbkSections.plaintextLength(length) > maxPlaintext) tooLarge("Section too large")
    return length
  }

  private fun section(type: Int, ordinal: Long, length: Long, output: OutputStream): Long {
    val key = keys.section(type, ordinal)
    try {
      val bounded = LimitedInputStream(counting, length)
      return TzbkSections.decrypt(bounded, length, output, key, TzbkSections.Context(header.backupId, header.noncePrefix, type, ordinal))
    } finally {
      key.fill(0)
      next++
    }
  }

  companion object {
    /**
     * Reads and validates the header (before Argon2), runs Argon2id for [password] (NFC
     * UTF-8 bytes) after the memory check, and unwraps the BMK.
     */
    fun open(input: InputStream, password: ByteArray, memory: MemoryCheck = MemoryCheck.RUNTIME): TzbkReader {
      val header = TzbkHeader.read(input)
      val kek = TzbkCrypto.kek(password, header, memory)
      try {
        val bmk = TzbkCrypto.unwrapBmk(kek, header)
        try {
          return TzbkReader(input, header, TzbkKeys(bmk, header.backupId))
        } finally {
          bmk.fill(0)
        }
      } finally {
        kek.fill(0)
      }
    }
  }
}
