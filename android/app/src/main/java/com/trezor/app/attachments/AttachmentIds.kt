package com.trezor.app.attachments

import java.security.SecureRandom

/** UUIDv7 ids for attachments, laid out exactly like src/storage/ids.ts. */
object AttachmentIds {
  private val random = SecureRandom()

  fun newId(): String = uuidv7(System.currentTimeMillis(), ByteArray(10).also(random::nextBytes))

  /** 48-bit Unix millisecond timestamp, version 7, variant 10, then [random] (10 bytes). */
  fun uuidv7(now: Long, random: ByteArray): String {
    require(random.size >= 10) { "uuidv7 needs 10 random bytes" }
    val bytes = ByteArray(16)
    for (i in 0..5) bytes[i] = (now ushr (8 * (5 - i))).toByte()
    bytes[6] = (0x70 or (random[0].toInt() and 0x0f)).toByte()
    bytes[7] = random[1]
    bytes[8] = (0x80 or (random[2].toInt() and 0x3f)).toByte()
    System.arraycopy(random, 3, bytes, 9, 7)
    val hex = bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-" +
        "${hex.substring(16, 20)}-${hex.substring(20)}"
  }
}
