package com.trezor.app.vault

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import com.trezor.app.vault.KeyVault.Companion.ANDROID_KEYSTORE
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** The vault's non-exportable AES-256-GCM master key [masterKeyAlias] in Android Keystore. */
internal class AndroidMasterKeys(private val masterKeyAlias: String) : MasterKeys {

  private fun keyStore(): KeyStore =
      try {
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
      } catch (e: Exception) {
        throw VaultException(
            VaultException.Code.KEYSTORE_UNAVAILABLE,
            "Android Keystore unavailable",
            e,
        )
      }

  override fun load(): SecretKey? =
      try {
        keyStore().getKey(masterKeyAlias, null) as SecretKey?
      } catch (e: UnrecoverableKeyException) {
        throw VaultException(VaultException.Code.KEY_INVALIDATED, "Master key unrecoverable", e)
      } catch (e: VaultException) {
        throw e
      } catch (e: Exception) {
        throw VaultException(
            VaultException.Code.KEYSTORE_UNAVAILABLE,
            "Could not load master key",
            e,
        )
      }

  /** StrongBox when available, otherwise the TEE (or software) Keystore. */
  override fun generate(): SecretKey {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        return generateMasterKey(strongBox = true)
      } catch (e: StrongBoxUnavailableException) {
        // Fall through to TEE / software-backed key.
      }
    }
    return generateMasterKey(strongBox = false)
  }

  private fun generateMasterKey(strongBox: Boolean): SecretKey {
    val spec =
        KeyGenParameterSpec.Builder(
                masterKeyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .apply {
              if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                setIsStrongBoxBacked(true)
              }
            }
            .build()
    return try {
      KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
          .apply { init(spec) }
          .generateKey()
    } catch (e: StrongBoxUnavailableException) {
      throw e
    } catch (e: Exception) {
      throw VaultException(
          VaultException.Code.KEYSTORE_UNAVAILABLE,
          "Could not create master key",
          e,
      )
    }
  }
}
