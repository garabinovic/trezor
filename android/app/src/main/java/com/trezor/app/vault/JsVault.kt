package com.trezor.app.vault

/**
 * What [TrezorVaultModule] does for JavaScript, without React Native types. Every key
 * operation is limited to the database key ([JsKeyAccess]) before [vault] is touched, and
 * keys leave as lowercase hex, with the plaintext bytes zeroed.
 *
 * Throws [IllegalArgumentException] for a refused id (`INVALID_ARGUMENT` in JS) and
 * whatever [vault] throws otherwise.
 */
class JsVault(private val vault: VaultKeys) {

  fun hasKey(keyId: String): Boolean = vault.hasKey(JsKeyAccess.check(keyId))

  fun createKeyHex(keyId: String): String = vault.createKey(JsKeyAccess.check(keyId)).toHexAndZero()

  fun getKeyHex(keyId: String): String = vault.getKey(JsKeyAccess.check(keyId)).toHexAndZero()

  companion object {
    private val HEX = "0123456789abcdef".toCharArray()

    /** Lowercase hex of these bytes; the bytes and the intermediate chars are zeroed. */
    fun ByteArray.toHexAndZero(): String {
      val out = CharArray(size * 2)
      for (i in indices) {
        val v = this[i].toInt() and 0xff
        out[i * 2] = HEX[v ushr 4]
        out[i * 2 + 1] = HEX[v and 0x0f]
      }
      fill(0)
      return String(out).also { out.fill('\u0000') }
    }
  }
}
