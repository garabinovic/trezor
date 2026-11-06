package com.trezor.app.backup

import java.io.InputStream
import java.util.zip.CRC32

/**
 * The 128-byte TZBK v1 header (spec §3.1–3.2, §3.4). [parse] checks it in the order the
 * spec fixes, all before any Argon2 work; the first failing check decides the error.
 */
class TzbkHeader private constructor(private val bytes: ByteArray) {

  val iterations: Int get() = BigEndian.u32(bytes, Tzbk.OFF_ITERATIONS).toInt()
  val memoryKiB: Int get() = BigEndian.u32(bytes, Tzbk.OFF_MEMORY).toInt()
  val parallelism: Int get() = bytes[Tzbk.OFF_PARALLELISM].toInt() and 0xff
  val salt: ByteArray get() = slice(Tzbk.OFF_SALT, Tzbk.SALT_BYTES)
  val backupId: ByteArray get() = slice(Tzbk.OFF_BACKUP_ID, Tzbk.BACKUP_ID_BYTES)
  /** Header bytes 55–61: the nonce prefix of every section (spec §3.6). */
  val noncePrefix: ByteArray get() = slice(Tzbk.OFF_NONCE_PREFIX, Tzbk.NONCE_PREFIX_BYTES)
  val wrapIv: ByteArray get() = slice(Tzbk.OFF_WRAP_IV, Tzbk.IV_BYTES)
  val wrappedBmk: ByteArray get() = slice(Tzbk.OFF_WRAPPED_BMK, Tzbk.WRAPPED_BMK_BYTES)

  /** The header as written to the file. */
  fun encoded(): ByteArray = bytes.copyOf()

  /** The trailer HMAC's view: CRC zeroed, wrapped BMK included (spec §3.7). */
  fun forMac(): ByteArray = bytes.copyOf().also { it.fill(0, Tzbk.OFF_CRC, Tzbk.OFF_CRC + 4) }

  /** The BMK wrap's AAD: CRC and wrapped BMK zeroed (spec §3.4). */
  fun canonical(): ByteArray = canonicalOf(bytes)

  private fun slice(at: Int, length: Int) = bytes.copyOfRange(at, at + length)

  companion object {

    /**
     * Builds a header around [wrappedBmk] (from [TzbkCrypto.wrapBmk], over
     * [unsealed]`.canonical()`), with the CRC computed last.
     */
    fun sealed(unsealed: TzbkHeader, wrappedBmk: ByteArray): TzbkHeader {
      require(wrappedBmk.size == Tzbk.WRAPPED_BMK_BYTES)
      val b = unsealed.bytes.copyOf()
      wrappedBmk.copyInto(b, Tzbk.OFF_WRAPPED_BMK)
      BigEndian.putU32(b, Tzbk.OFF_CRC, crcOf(b))
      return TzbkHeader(b)
    }

    /** A header for writing, with the wrapped-BMK and CRC fields still zero. */
    fun unsealed(
        salt: ByteArray,
        backupId: ByteArray,
        noncePrefix: ByteArray,
        wrapIv: ByteArray,
        iterations: Int = Tzbk.WRITER_ITERATIONS,
    ): TzbkHeader {
      require(salt.size == Tzbk.SALT_BYTES && backupId.size == Tzbk.BACKUP_ID_BYTES)
      require(noncePrefix.size == Tzbk.NONCE_PREFIX_BYTES && wrapIv.size == Tzbk.IV_BYTES)
      require(iterations in Tzbk.MIN_ITERATIONS..Tzbk.MAX_ITERATIONS)
      val b = ByteArray(Tzbk.HEADER_BYTES)
      Tzbk.MAGIC.copyInto(b, 0)
      BigEndian.putU16(b, Tzbk.OFF_VERSION, Tzbk.VERSION)
      BigEndian.putU16(b, Tzbk.OFF_HEADER_LENGTH, Tzbk.HEADER_BYTES)
      b[Tzbk.OFF_KDF] = Tzbk.KDF_ARGON2ID.toByte()
      b[Tzbk.OFF_CIPHER] = Tzbk.CIPHER_SUITE.toByte()
      BigEndian.putU32(b, Tzbk.OFF_MEMORY, Tzbk.MEMORY_KIB.toLong())
      BigEndian.putU32(b, Tzbk.OFF_ITERATIONS, iterations.toLong())
      b[Tzbk.OFF_PARALLELISM] = Tzbk.PARALLELISM.toByte()
      salt.copyInto(b, Tzbk.OFF_SALT)
      backupId.copyInto(b, Tzbk.OFF_BACKUP_ID)
      BigEndian.putU32(b, Tzbk.OFF_CHUNK, Tzbk.CHUNK_SIZE.toLong())
      noncePrefix.copyInto(b, Tzbk.OFF_NONCE_PREFIX)
      wrapIv.copyInto(b, Tzbk.OFF_WRAP_IV)
      return TzbkHeader(b)
    }

    /** Reads exactly 128 bytes; fewer is BACKUP_CORRUPT. */
    fun read(input: InputStream): TzbkHeader {
      val b = ByteArray(Tzbk.HEADER_BYTES)
      var n = 0
      while (n < b.size) {
        val r = input.read(b, n, b.size - n)
        if (r < 0) corrupt("Not a backup file")
        n += r
      }
      return parse(b)
    }

    /**
     * Validation order (spec §3.1):
     * 1. length and magic → BACKUP_CORRUPT;
     * 2. version and header length → BACKUP_UNSUPPORTED;
     * 3. CRC → BACKUP_CORRUPT;
     * 4. identifiers, Argon2 parameters, chunk size, reserved bytes → BACKUP_UNSUPPORTED.
     */
    fun parse(input: ByteArray): TzbkHeader {
      if (input.size < Tzbk.HEADER_BYTES) corrupt("Not a backup file")
      val b = input.copyOf(Tzbk.HEADER_BYTES)
      for (i in Tzbk.MAGIC.indices) if (b[i] != Tzbk.MAGIC[i]) corrupt("Not a backup file")
      if (BigEndian.u16(b, Tzbk.OFF_VERSION) != Tzbk.VERSION) unsupported("Backup version")
      if (BigEndian.u16(b, Tzbk.OFF_HEADER_LENGTH) != Tzbk.HEADER_BYTES) unsupported("Header length")
      if (BigEndian.u32(b, Tzbk.OFF_CRC) != crcOf(b)) corrupt("Header CRC")
      if (b[Tzbk.OFF_KDF].toInt() and 0xff != Tzbk.KDF_ARGON2ID) unsupported("KDF")
      if (b[Tzbk.OFF_CIPHER].toInt() and 0xff != Tzbk.CIPHER_SUITE) unsupported("Cipher suite")
      if (BigEndian.u32(b, Tzbk.OFF_MEMORY) != Tzbk.MEMORY_KIB.toLong()) unsupported("Argon2 memory")
      val t = BigEndian.u32(b, Tzbk.OFF_ITERATIONS)
      if (t < Tzbk.MIN_ITERATIONS || t > Tzbk.MAX_ITERATIONS) unsupported("Argon2 iterations")
      if (b[Tzbk.OFF_PARALLELISM].toInt() and 0xff != Tzbk.PARALLELISM) unsupported("Argon2 parallelism")
      if (BigEndian.u32(b, Tzbk.OFF_CHUNK) != Tzbk.CHUNK_SIZE.toLong()) unsupported("Chunk size")
      if (b[Tzbk.OFF_RESERVED].toInt() != 0 || b[Tzbk.OFF_RESERVED + 1].toInt() != 0) {
        unsupported("Reserved bytes")
      }
      return TzbkHeader(b)
    }

    /** CRC-32/ISO-HDLC over the 128 bytes with the CRC field zeroed (spec §3.2). */
    internal fun crcOf(header: ByteArray): Long {
      val copy = header.copyOf(Tzbk.HEADER_BYTES)
      copy.fill(0, Tzbk.OFF_CRC, Tzbk.OFF_CRC + 4)
      return CRC32().apply { update(copy) }.value
    }

    internal fun canonicalOf(header: ByteArray): ByteArray =
        header.copyOf(Tzbk.HEADER_BYTES).also {
          it.fill(0, Tzbk.OFF_WRAPPED_BMK, Tzbk.OFF_WRAPPED_BMK + Tzbk.WRAPPED_BMK_BYTES)
          it.fill(0, Tzbk.OFF_CRC, Tzbk.OFF_CRC + 4)
        }
  }
}
