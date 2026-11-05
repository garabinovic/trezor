package com.trezor.app.vault

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.trezor.app.vault.JsVault.Companion.toHexAndZero
import java.io.File

/**
 * JS bridge for [KeyVault]. Keys are returned to JS as lowercase hex because op-sqlite
 * only accepts the SQLCipher key from JavaScript (see docs/TECHNICAL_ARCHITECTURE.md §4.4).
 * Every key operation is limited to the database key ([JsKeyAccess], applied by
 * [JsVault]); other keys stay native-only.
 */
class TrezorVaultModule(reactContext: ReactApplicationContext) :
    NativeTrezorVaultSpec(reactContext) {

  // noBackupFilesDir is excluded from Auto Backup and device-to-device transfer.
  private val vault = KeyVault(File(reactContext.noBackupFilesDir, "keys"))
  private val js = JsVault(vault)

  override fun getName(): String = NAME

  override fun hasKey(keyId: String, promise: Promise) = run(promise) { js.hasKey(keyId) }

  override fun createKey(keyId: String, promise: Promise) = run(promise) { js.createKeyHex(keyId) }

  override fun getKey(keyId: String, promise: Promise) = run(promise) { js.getKeyHex(keyId) }

  override fun randomBytesHex(length: Double): String =
      vault.randomBytes(length.toInt()).toHexAndZero()

  override fun getMasterKeySecurityLevel(promise: Promise) =
      run(promise) { vault.masterKeySecurityLevel().jsValue }

  private inline fun run(promise: Promise, block: () -> Any) {
    try {
      promise.resolve(block())
    } catch (e: VaultException) {
      promise.reject(e.code.name, e.message, e)
    } catch (e: IllegalArgumentException) {
      promise.reject("INVALID_ARGUMENT", e.message, e)
    } catch (e: Exception) {
      promise.reject("KEYSTORE_UNAVAILABLE", "Unexpected vault error", e)
    }
  }

  companion object {
    const val NAME = "TrezorVault"
  }
}
