package com.trezor.app.vault

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File

/**
 * JS bridge for [KeyVault]. Keys are returned to JS as lowercase hex because op-sqlite
 * only accepts the SQLCipher key from JavaScript (see docs/TECHNICAL_ARCHITECTURE.md §4.4).
 */
class TrezorVaultModule(reactContext: ReactApplicationContext) :
    NativeTrezorVaultSpec(reactContext) {

  // noBackupFilesDir is excluded from Auto Backup and device-to-device transfer.
  private val vault = KeyVault(File(reactContext.noBackupFilesDir, "keys"))

  override fun getName(): String = NAME

  override fun hasKey(keyId: String, promise: Promise) = run(promise) { vault.hasKey(keyId) }

  override fun createKey(keyId: String, promise: Promise) =
      run(promise) { vault.createKey(keyId).toHexAndZero() }

  override fun getKey(keyId: String, promise: Promise) =
      run(promise) { vault.getKey(keyId).toHexAndZero() }

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

  private fun ByteArray.toHexAndZero(): String {
    val out = CharArray(size * 2)
    for (i in indices) {
      val v = this[i].toInt() and 0xff
      out[i * 2] = HEX[v ushr 4]
      out[i * 2 + 1] = HEX[v and 0x0f]
    }
    fill(0)
    return String(out).also { out.fill('\u0000') }
  }

  companion object {
    const val NAME = "TrezorVault"
    private val HEX = "0123456789abcdef".toCharArray()
  }
}
