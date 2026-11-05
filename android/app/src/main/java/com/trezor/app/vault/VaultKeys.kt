package com.trezor.app.vault

/**
 * Key operations of [KeyVault], by key id. An interface so the code that chooses which
 * key to use (the JS bridge, attachments, reminders) can be tested with a fake vault; the
 * real one needs the Android Keystore.
 *
 * Returned keys are plaintext copies; the caller zeroes them.
 */
interface VaultKeys {
  fun hasKey(keyId: String): Boolean

  fun createKey(keyId: String): ByteArray

  fun getKey(keyId: String): ByteArray
}
