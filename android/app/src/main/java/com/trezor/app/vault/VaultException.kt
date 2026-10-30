package com.trezor.app.vault

/**
 * Typed vault failures. Codes are part of the JS contract (src/storage/vault.ts).
 * Messages must never contain key material.
 */
class VaultException(val code: Code, message: String, cause: Throwable? = null) :
    Exception(message, cause) {

  enum class Code {
    /** No envelope exists for the requested key. */
    KEY_NOT_FOUND,
    /** createKey() called for a key that already exists. */
    KEY_ALREADY_EXISTS,
    /** Envelopes exist but the Keystore master key is gone (e.g. Keystore wiped). */
    MASTER_KEY_MISSING,
    /** The master key exists but Android has permanently invalidated it. */
    KEY_INVALIDATED,
    /** Envelope unreadable, tampered with, or encrypted under a different master key. */
    UNWRAP_FAILED,
    /** Envelope was written by a newer, unknown format version. */
    ENVELOPE_UNSUPPORTED,
    /** Android Keystore could not be used at all. */
    KEYSTORE_UNAVAILABLE,
    /** Reading or writing the envelope file failed. */
    STORAGE_ERROR,
  }
}
