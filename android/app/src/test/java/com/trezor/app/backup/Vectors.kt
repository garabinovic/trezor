package com.trezor.app.backup

import java.security.MessageDigest
import java.security.SecureRandom

/**
 * The reference vectors from tools/backup-format/make-vectors.js (Node crypto / OpenSSL;
 * Argon2id also checked with libsodium). Expected values come only from there, never from
 * the Kotlin code under test.
 */
internal object Vectors {

  @Suppress("UNCHECKED_CAST")
  val root: Map<String, Any> by lazy {
    val bytes =
        requireNotNull(Vectors::class.java.classLoader!!.getResourceAsStream("backup/tzbk-v1-vectors.json")) {
          "vectors missing: run node tools/backup-format/make-vectors.js"
        }.use { it.readBytes() }
    StrictJson.parse(bytes, 16) as Map<String, Any>
  }

  @Suppress("UNCHECKED_CAST")
  fun list(key: String) = root[key] as List<Map<String, Any>>

  @Suppress("UNCHECKED_CAST")
  fun obj(key: String) = root[key] as Map<String, Any>
}

@Suppress("UNCHECKED_CAST")
internal fun Map<String, Any>.obj(key: String) = this[key] as Map<String, Any>

@Suppress("UNCHECKED_CAST")
internal fun Map<String, Any>.list(key: String) = this[key] as List<Map<String, Any>>

internal fun Map<String, Any>.str(key: String) = this[key] as String

internal fun Map<String, Any>.long(key: String) = this[key] as Long

internal fun Map<String, Any>.int(key: String) = (this[key] as Long).toInt()

internal fun Map<String, Any>.hex(key: String) = unhex(str(key))

internal fun unhex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }

internal fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }

internal fun sha256(b: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(b).hex()

/** The reference's test plaintext: byte i = (i * 31 + seed) mod 256. */
internal fun pattern(length: Int, seed: Int): ByteArray = ByteArray(length) { ((it * 31 + seed) and 0xff).toByte() }

/** A SecureRandom that hands out exactly the given arrays, in order. */
internal class FixedRandom(vararg values: ByteArray) : SecureRandom() {
  private val queue = ArrayDeque(values.toList())

  override fun nextBytes(bytes: ByteArray) {
    val next = queue.removeFirst()
    require(next.size == bytes.size) { "expected ${bytes.size} bytes, have ${next.size}" }
    next.copyInto(bytes)
  }
}

internal fun expectCode(code: BackupFormatException.Code, block: () -> Unit) {
  try {
    block()
  } catch (e: BackupFormatException) {
    if (e.code != code) throw AssertionError("expected $code, got ${e.code}: ${e.message}", e)
    return
  }
  throw AssertionError("expected $code")
}
