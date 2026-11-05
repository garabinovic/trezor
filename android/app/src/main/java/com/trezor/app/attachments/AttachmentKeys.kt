package com.trezor.app.attachments

import com.trezor.app.vault.VaultException
import com.trezor.app.vault.VaultKeys

/**
 * Supplies the KeyVault "attachments" key. Like the vault's master key, it is created only
 * when nothing depends on it yet: if the key is gone while encrypted files exist, a new key
 * would not bring them back, so this fails instead and leaves the files untouched.
 *
 * [hasFiles] must throw when it can't tell; the failure propagates and no key is created.
 *
 * Returned keys are copies; the caller zeroes them.
 */
class AttachmentKeys(
    private val hasKey: () -> Boolean,
    private val getKey: () -> ByteArray,
    private val createKey: () -> ByteArray,
    private val hasFiles: () -> Boolean,
) {

  @Synchronized
  fun obtain(): ByteArray {
    if (hasKey()) return getKey()
    if (hasFiles()) {
      throw VaultException(
          VaultException.Code.KEY_NOT_FOUND,
          "Attachment key is missing but encrypted attachments exist",
      )
    }
    return createKey()
  }

  companion object {
    const val KEY_ID = "attachments"

    /** The production wiring: [vault]'s key [KEY_ID], never any other. */
    fun of(vault: VaultKeys, hasFiles: () -> Boolean) =
        AttachmentKeys(
            hasKey = { vault.hasKey(KEY_ID) },
            getKey = { vault.getKey(KEY_ID) },
            createKey = { vault.createKey(KEY_ID) },
            hasFiles = hasFiles,
        )
  }
}
