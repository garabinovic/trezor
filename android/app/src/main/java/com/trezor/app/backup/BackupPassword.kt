package com.trezor.app.backup

import java.text.Normalizer

/**
 * Backup password rules (spec §4). Only code points in the fixed Unicode 8.0 table
 * ([Unicode8Allowed]) are accepted, never the device's ICU data, so every platform accepts
 * and rejects the same passwords; NFC of such text is the same in every later Unicode
 * version (Normalization Stability Policy).
 *
 * The password arrives as a JS string and can't be wiped; the returned bytes are the
 * caller's to zero.
 */
object BackupPassword {

  const val MIN_CODE_POINTS = 10
  const val MAX_CODE_POINTS = 256
  const val MAX_UTF8_BYTES = 1024

  class PasswordException(val code: Code, message: String, val position: Int = -1) : Exception(message) {
    enum class Code {
      /** Not well-formed UTF-16 (an unpaired surrogate). */
      PASSWORD_INVALID,
      /** A character outside the allowed set; [position] is its code-point index. */
      PASSWORD_CHARACTER,
      /** Fewer than 10 or more than 256 code points, or more than 1024 UTF-8 bytes, after NFC. */
      PASSWORD_LENGTH,
      /** The confirmation differs. */
      PASSWORD_MISMATCH,
    }
  }

  /** The NFC UTF-8 bytes of [password] (spec §4.2 steps 1–5). */
  fun encode(password: String): ByteArray {
    checkCharacters(password) // steps 1–2, on the input
    val nfc = Normalizer.normalize(password, Normalizer.Form.NFC) // step 3
    checkCharacters(nfc) // step 4, defensive
    val count = nfc.codePointCount(0, nfc.length)
    val bytes = nfc.toByteArray(Charsets.UTF_8)
    if (count < MIN_CODE_POINTS || count > MAX_CODE_POINTS || bytes.size > MAX_UTF8_BYTES) {
      bytes.fill(0)
      throw PasswordException(PasswordException.Code.PASSWORD_LENGTH, "Password length")
    }
    return bytes
  }

  /** [encode] for a new password entered twice (spec §4.2 step 6). */
  fun encodeConfirmed(password: String, confirmation: String): ByteArray {
    val a = encode(password)
    val b =
        try {
          encode(confirmation)
        } catch (e: PasswordException) {
          a.fill(0)
          throw PasswordException(PasswordException.Code.PASSWORD_MISMATCH, "Passwords differ")
        }
    val same = java.security.MessageDigest.isEqual(a, b)
    b.fill(0)
    if (!same) {
      a.fill(0)
      throw PasswordException(PasswordException.Code.PASSWORD_MISMATCH, "Passwords differ")
    }
    return a
  }

  /** Whether [codePoint] is in the Unicode 8.0 allowed set (binary search over ranges). */
  fun isAllowed(codePoint: Int): Boolean {
    val r = Unicode8Allowed.RANGES
    var lo = 0
    var hi = r.size / 2 - 1
    while (lo <= hi) {
      val mid = (lo + hi) ushr 1
      when {
        codePoint < r[2 * mid] -> hi = mid - 1
        codePoint > r[2 * mid + 1] -> lo = mid + 1
        else -> return true
      }
    }
    return false
  }

  private fun checkCharacters(s: String) {
    var i = 0
    var index = 0
    while (i < s.length) {
      val c = s[i]
      val cp: Int
      if (Character.isHighSurrogate(c)) {
        if (i + 1 >= s.length || !Character.isLowSurrogate(s[i + 1])) {
          throw PasswordException(PasswordException.Code.PASSWORD_INVALID, "Unpaired surrogate", index)
        }
        cp = Character.toCodePoint(c, s[i + 1])
        i += 2
      } else {
        if (Character.isLowSurrogate(c)) {
          throw PasswordException(PasswordException.Code.PASSWORD_INVALID, "Unpaired surrogate", index)
        }
        cp = c.code
        i++
      }
      if (!isAllowed(cp)) {
        throw PasswordException(PasswordException.Code.PASSWORD_CHARACTER, "Character not allowed", index)
      }
      index++
    }
  }
}
