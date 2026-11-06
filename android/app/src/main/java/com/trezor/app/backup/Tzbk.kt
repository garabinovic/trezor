package com.trezor.app.backup

/**
 * TZBK v1, the encrypted backup file format (Phase 6 specification v2.4 §3). Constants and
 * the error type shared by the format classes in this package. Nothing here reads or
 * writes app data: this is the format library only (Phase 6 Step 1).
 *
 * ```
 * file    = header[128] ‖ section(manifest) ‖ section(database) ‖ section(attachment 0…n−1) ‖ trailer[32]
 * section = length[8] ‖ type[1] ‖ ordinal[4] ‖ ciphertext[length]
 * ```
 * All integers are unsigned big-endian.
 */
object Tzbk {
  const val HEADER_BYTES = 128
  const val VERSION = 1
  const val KDF_ARGON2ID = 0x01
  const val CIPHER_SUITE = 0x01

  /** Argon2id memory in KiB. v1 accepts exactly this value (spec §3.1). */
  const val MEMORY_KIB = 65536
  const val MIN_ITERATIONS = 3
  const val MAX_ITERATIONS = 10
  const val WRITER_ITERATIONS = 3
  const val PARALLELISM = 1
  /** Free heap needed on top of Argon2's memory before it runs (spec §3.1). */
  const val MEMORY_MARGIN_BYTES = 32L * 1024 * 1024

  const val CHUNK_SIZE = 65536
  const val TAG_BYTES = 16
  const val KEY_BYTES = 32
  const val SALT_BYTES = 16
  const val BACKUP_ID_BYTES = 16
  const val NONCE_PREFIX_BYTES = 7
  const val IV_BYTES = 12
  const val WRAPPED_BMK_BYTES = KEY_BYTES + TAG_BYTES
  const val FRAMING_BYTES = 13
  const val TRAILER_BYTES = 32

  const val TYPE_MANIFEST = 0x01
  const val TYPE_DATABASE = 0x02
  const val TYPE_ATTACHMENT = 0x03

  const val MAX_MANIFEST_BYTES = 16L * 1024 * 1024
  const val MAX_DATABASE_BYTES = 256L * 1024 * 1024
  const val MAX_ATTACHMENT_BYTES = 25L * 1024 * 1024
  const val MAX_ATTACHMENTS = 20_000
  const val MAX_ATTACHMENT_TOTAL_BYTES = 4L * 1024 * 1024 * 1024
  /** 5.25 GiB. */
  const val MAX_FILE_BYTES = 5_637_144_576L

  // Header offsets (spec §3.1).
  internal const val OFF_VERSION = 4
  internal const val OFF_HEADER_LENGTH = 6
  internal const val OFF_KDF = 8
  internal const val OFF_CIPHER = 9
  internal const val OFF_MEMORY = 10
  internal const val OFF_ITERATIONS = 14
  internal const val OFF_PARALLELISM = 18
  internal const val OFF_SALT = 19
  internal const val OFF_BACKUP_ID = 35
  internal const val OFF_CHUNK = 51
  internal const val OFF_NONCE_PREFIX = 55
  internal const val OFF_WRAP_IV = 62
  internal const val OFF_WRAPPED_BMK = 74
  internal const val OFF_CRC = 122
  internal const val OFF_RESERVED = 126

  internal val MAGIC = byteArrayOf(0x54, 0x5A, 0x42, 0x4B) // "TZBK"
}

/** A backup file that can't be read or written as TZBK v1 (spec §3.11). */
class BackupFormatException(val code: Code, message: String, cause: Throwable? = null) :
    Exception(message, cause) {
  enum class Code {
    /** A version, identifier or parameter this format doesn't accept. */
    BACKUP_UNSUPPORTED,
    /** CRC, framing, length, chunk, trailer or manifest damage. */
    BACKUP_CORRUPT,
    /** The BMK doesn't unwrap: wrong password or a modified header (not distinguished). */
    BACKUP_PASSWORD_OR_HEADER,
    /** A section or the file exceeds its limit. */
    BACKUP_TOO_LARGE,
    /** Not enough free heap for Argon2id; nothing was written (transient). */
    BACKUP_INSUFFICIENT_MEMORY,
    /** The manifest contradicts itself or the sections. */
    BACKUP_INCONSISTENT,
  }
}

internal fun corrupt(message: String): Nothing =
    throw BackupFormatException(BackupFormatException.Code.BACKUP_CORRUPT, message)

internal fun unsupported(message: String): Nothing =
    throw BackupFormatException(BackupFormatException.Code.BACKUP_UNSUPPORTED, message)

internal fun tooLarge(message: String): Nothing =
    throw BackupFormatException(BackupFormatException.Code.BACKUP_TOO_LARGE, message)

internal fun inconsistent(message: String): Nothing =
    throw BackupFormatException(BackupFormatException.Code.BACKUP_INCONSISTENT, message)

internal object BigEndian {
  fun u16(b: ByteArray, at: Int) = ((b[at].toInt() and 0xff) shl 8) or (b[at + 1].toInt() and 0xff)

  fun u32(b: ByteArray, at: Int): Long =
      ((b[at].toLong() and 0xff) shl 24) or ((b[at + 1].toLong() and 0xff) shl 16) or
          ((b[at + 2].toLong() and 0xff) shl 8) or (b[at + 3].toLong() and 0xff)

  fun u64(b: ByteArray, at: Int): Long {
    var v = 0L
    for (i in 0 until 8) v = (v shl 8) or (b[at + i].toLong() and 0xff)
    return v
  }

  fun putU16(b: ByteArray, at: Int, v: Int) {
    b[at] = (v ushr 8).toByte()
    b[at + 1] = v.toByte()
  }

  fun putU32(b: ByteArray, at: Int, v: Long) {
    for (i in 0 until 4) b[at + i] = (v ushr (24 - 8 * i)).toByte()
  }

  fun putU64(b: ByteArray, at: Int, v: Long) {
    for (i in 0 until 8) b[at + i] = (v ushr (56 - 8 * i)).toByte()
  }
}
