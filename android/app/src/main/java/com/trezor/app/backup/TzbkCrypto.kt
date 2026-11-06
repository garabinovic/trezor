package com.trezor.app.backup

import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.bouncycastle.crypto.params.HKDFParameters

/** Free heap the process can still use; replaceable in tests. */
fun interface MemoryCheck {
  fun availableBytes(): Long

  companion object {
    val RUNTIME = MemoryCheck {
      val r = Runtime.getRuntime()
      r.maxMemory() - (r.totalMemory() - r.freeMemory())
    }
  }
}

/**
 * Password → KEK → BMK (spec §3.3–3.4), with BouncyCastle's Argon2id. Argon2 is the only
 * primitive javax.crypto doesn't offer; AES-GCM is the platform's.
 *
 * BouncyCastle copies the salt into its parameters and clears its memory blocks only
 * when hashing completes normally: after an exception or OOM, internal copies may stay on
 * the heap until collected. Arrays owned here are zeroed in `finally`.
 */
object TzbkCrypto {

  /**
   * The KEK for [password] (NFC UTF-8 bytes from [BackupPassword]). Checks the header's
   * parameters again and the free heap before allocating Argon2's 64 MiB. Caller zeroes
   * the result.
   */
  fun kek(password: ByteArray, header: TzbkHeader, memory: MemoryCheck = MemoryCheck.RUNTIME): ByteArray {
    // parse() already enforced these; repeated so no other path can weaken them.
    require(header.memoryKiB == Tzbk.MEMORY_KIB && header.parallelism == Tzbk.PARALLELISM)
    require(header.iterations in Tzbk.MIN_ITERATIONS..Tzbk.MAX_ITERATIONS)
    val needed = header.memoryKiB * 1024L + Tzbk.MEMORY_MARGIN_BYTES
    if (memory.availableBytes() < needed) {
      throw BackupFormatException(
          BackupFormatException.Code.BACKUP_INSUFFICIENT_MEMORY, "Not enough memory for Argon2id")
    }
    val salt = header.salt
    val out = ByteArray(Tzbk.KEY_BYTES)
    try {
      val params =
          Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
              .withVersion(Argon2Parameters.ARGON2_VERSION_13)
              .withIterations(header.iterations)
              .withMemoryAsKB(header.memoryKiB)
              .withParallelism(header.parallelism)
              .withSalt(salt)
              .build()
      Argon2BytesGenerator().apply { init(params) }.generateBytes(password, out)
      return out.copyOf()
    } catch (e: OutOfMemoryError) {
      throw BackupFormatException(
          BackupFormatException.Code.BACKUP_INSUFFICIENT_MEMORY, "Not enough memory for Argon2id", e)
    } finally {
      out.fill(0)
      salt.fill(0)
    }
  }

  /** The 48-byte wrapped BMK: AES-256-GCM(KEK, header IV, AAD = canonical header). */
  fun wrapBmk(kek: ByteArray, bmk: ByteArray, unsealed: TzbkHeader): ByteArray {
    require(kek.size == Tzbk.KEY_BYTES && bmk.size == Tzbk.KEY_BYTES)
    return gcm(Cipher.ENCRYPT_MODE, kek, unsealed.wrapIv, unsealed.canonical(), bmk)
  }

  /** The BMK, or BACKUP_PASSWORD_OR_HEADER. Caller zeroes it. */
  fun unwrapBmk(kek: ByteArray, header: TzbkHeader): ByteArray =
      try {
        gcm(Cipher.DECRYPT_MODE, kek, header.wrapIv, header.canonical(), header.wrappedBmk)
      } catch (e: GeneralSecurityException) {
        throw BackupFormatException(
            BackupFormatException.Code.BACKUP_PASSWORD_OR_HEADER, "Wrong password or modified header", e)
      }

  /** HKDF-SHA256 (RFC 5869), 32 bytes out. */
  internal fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int = Tzbk.KEY_BYTES): ByteArray {
    val out = ByteArray(length)
    HKDFBytesGenerator(SHA256Digest()).apply { init(HKDFParameters(ikm, salt, info)) }.generateBytes(out, 0, length)
    return out
  }

  internal fun gcm(mode: Int, key: ByteArray, iv: ByteArray, aad: ByteArray, input: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(Tzbk.TAG_BYTES * 8, iv))
    cipher.updateAAD(aad)
    return cipher.doFinal(input)
  }
}

/**
 * The keys derived from one backup's BMK (spec §3.5): HKDF-SHA256, salt = backup ID, 32
 * bytes each. Holds its own copy of the BMK until [close]; every returned key is a fresh
 * array the caller zeroes.
 */
class TzbkKeys(bmk: ByteArray, backupId: ByteArray) : AutoCloseable {

  private val bmk = bmk.copyOf()
  private val backupId = backupId.copyOf()
  private var closed = false

  init {
    require(bmk.size == Tzbk.KEY_BYTES && backupId.size == Tzbk.BACKUP_ID_BYTES)
  }

  /** The key of section ([type], [ordinal]); info = `TZBK-SECTION-v1` ‖ type ‖ ordinal (u32). */
  fun section(type: Int, ordinal: Long): ByteArray = derive(sectionInfo(type, ordinal))

  fun attachmentWrap(): ByteArray = derive(ATTACHMENT_WRAP)

  fun mac(): ByteArray = derive(MAC)

  /** The SQLCipher artifact key (spec §3.5, §5): 32 bytes, used as `x'<hex>'`. */
  fun sqlcipher(): ByteArray = derive(SQLCIPHER)

  private fun derive(info: ByteArray): ByteArray {
    check(!closed) { "Keys are closed" }
    return TzbkCrypto.hkdf(bmk, backupId, info)
  }

  override fun close() {
    closed = true
    bmk.fill(0)
  }

  companion object {
    private val SECTION = "TZBK-SECTION-v1".toByteArray(Charsets.US_ASCII)
    private val ATTACHMENT_WRAP = "trezor.backup.v1.attachment-wrap".toByteArray(Charsets.US_ASCII)
    private val MAC = "trezor.backup.v1.mac".toByteArray(Charsets.US_ASCII)
    private val SQLCIPHER = "trezor.backup.v1.sqlcipher".toByteArray(Charsets.US_ASCII)

    internal fun sectionInfo(type: Int, ordinal: Long): ByteArray {
      require(type in Tzbk.TYPE_MANIFEST..Tzbk.TYPE_ATTACHMENT && ordinal in 0..0xFFFF_FFFFL)
      val info = SECTION.copyOf(SECTION.size + 5)
      info[SECTION.size] = type.toByte()
      BigEndian.putU32(info, SECTION.size + 1, ordinal)
      return info
    }
  }
}
