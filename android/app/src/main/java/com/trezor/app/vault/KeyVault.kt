package com.trezor.app.vault

import android.os.Build
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.security.GeneralSecurityException
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONException
import org.json.JSONObject

/**
 * Wraps random 256-bit data keys with a non-exportable AES-256-GCM master key held in
 * Android Keystore. Only wrapped keys ("envelopes") are written to disk.
 *
 * Envelope format v1 (JSON, one file per key in [keyDir]):
 * ```
 * { "format": "trezor.key-envelope", "version": 1, "keyId": "database",
 *   "masterKeyAlias": "trezor.master.v1", "algorithm": "AES-256-GCM",
 *   "iv": <base64>, "ciphertext": <base64, includes GCM tag>, "createdAt": <ms> }
 * ```
 * The GCM associated data binds the ciphertext to format, version, keyId and master alias,
 * so an envelope cannot be renamed or reused for another purpose.
 *
 * The vault never creates a replacement key on failure: callers decide what to do.
 *
 * Every operation runs under one process-wide lock in [EnvelopeStore], which also decides
 * when a master key may be generated and makes each new envelope durable. Several
 * instances on the same [keyDir] are therefore safe.
 */
class KeyVault
internal constructor(
    keyDir: File,
    private val masterKeyAlias: String,
    masterKeys: MasterKeys,
) : VaultKeys {

  constructor(
      keyDir: File,
      masterKeyAlias: String = DEFAULT_MASTER_KEY_ALIAS,
  ) : this(keyDir, masterKeyAlias, AndroidMasterKeys(masterKeyAlias))

  private val store = EnvelopeStore(keyDir, masterKeys)

  enum class SecurityLevel(val jsValue: String) {
    STRONGBOX("strongbox"),
    TRUSTED_ENVIRONMENT("tee"),
    SOFTWARE("software"),
    UNKNOWN("unknown"),
    NONE("none"),
  }

  private val random = SecureRandom()

  override fun hasKey(keyId: String): Boolean = store.exists(envelopeName(keyId))

  /** Creates and stores a new random key. Returns the plaintext key; caller must zero it. */
  override fun createKey(keyId: String): ByteArray {
    val name = envelopeName(keyId)
    val key = randomBytes(KEY_LENGTH_BYTES)
    try {
      store.create(name) { master ->
        encodeEnvelope(wrap(master, keyId, key, System.currentTimeMillis()))
      }
      return key.copyOf()
    } finally {
      key.fill(0)
    }
  }

  /** Unwraps an existing key. Returns the plaintext key; caller must zero it. */
  override fun getKey(keyId: String): ByteArray =
      EnvelopeStore.locked {
        val bytes =
            store.read(envelopeName(keyId))
                ?: throw VaultException(VaultException.Code.KEY_NOT_FOUND, "No key '$keyId'")
        unwrapStored(keyId, decodeEnvelope(bytes))
      }

  private fun unwrapStored(keyId: String, envelope: Envelope): ByteArray {
    if (envelope.version > ENVELOPE_VERSION) {
      throw VaultException(
          VaultException.Code.ENVELOPE_UNSUPPORTED,
          "Envelope version ${envelope.version} is newer than supported $ENVELOPE_VERSION",
      )
    }
    if (envelope.keyId != keyId || envelope.masterKeyAlias != masterKeyAlias) {
      throw VaultException(VaultException.Code.UNWRAP_FAILED, "Envelope does not match '$keyId'")
    }
    val master =
        store.masterKey()
            ?: throw VaultException(
                VaultException.Code.MASTER_KEY_MISSING,
                "Master key is missing from Android Keystore",
            )
    return unwrap(master, envelope)
  }

  fun randomBytes(length: Int): ByteArray {
    require(length in 1..MAX_RANDOM_BYTES) { "length must be 1..$MAX_RANDOM_BYTES" }
    return ByteArray(length).also { random.nextBytes(it) }
  }

  /** Where the master key is stored. [SecurityLevel.NONE] when it does not exist yet. */
  fun masterKeySecurityLevel(): SecurityLevel {
    val key = store.masterKey() ?: return SecurityLevel.NONE
    return try {
      val factory = SecretKeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE)
      val info = factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        when (info.securityLevel) {
          KeyProperties.SECURITY_LEVEL_STRONGBOX -> SecurityLevel.STRONGBOX
          KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> SecurityLevel.TRUSTED_ENVIRONMENT
          KeyProperties.SECURITY_LEVEL_SOFTWARE -> SecurityLevel.SOFTWARE
          else -> SecurityLevel.UNKNOWN
        }
      } else {
        @Suppress("DEPRECATION")
        if (info.isInsideSecureHardware) SecurityLevel.TRUSTED_ENVIRONMENT
        else SecurityLevel.SOFTWARE
      }
    } catch (e: GeneralSecurityException) {
      SecurityLevel.UNKNOWN
    }
  }

  // --- Wrap / unwrap ----------------------------------------------------------------------

  private class Envelope(
      val version: Int,
      val keyId: String,
      val masterKeyAlias: String,
      val iv: ByteArray,
      val ciphertext: ByteArray,
      val createdAt: Long,
  )

  private fun aad(keyId: String): ByteArray =
      "$ENVELOPE_FORMAT|$ENVELOPE_VERSION|$keyId|$masterKeyAlias".toByteArray(Charsets.UTF_8)

  private fun wrap(master: SecretKey, keyId: String, key: ByteArray, createdAt: Long): Envelope =
      try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, master) // Keystore generates a random IV
        cipher.updateAAD(aad(keyId))
        Envelope(
            ENVELOPE_VERSION,
            keyId,
            masterKeyAlias,
            cipher.iv,
            cipher.doFinal(key),
            createdAt,
        )
      } catch (e: KeyPermanentlyInvalidatedException) {
        throw VaultException(VaultException.Code.KEY_INVALIDATED, "Master key invalidated", e)
      } catch (e: GeneralSecurityException) {
        throw VaultException(VaultException.Code.KEYSTORE_UNAVAILABLE, "Could not wrap key", e)
      }

  private fun unwrap(master: SecretKey, envelope: Envelope): ByteArray =
      try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            master,
            GCMParameterSpec(GCM_TAG_BITS, envelope.iv),
        )
        cipher.updateAAD(aad(envelope.keyId))
        cipher.doFinal(envelope.ciphertext)
      } catch (e: KeyPermanentlyInvalidatedException) {
        throw VaultException(VaultException.Code.KEY_INVALIDATED, "Master key invalidated", e)
      } catch (e: AEADBadTagException) {
        throw VaultException(VaultException.Code.UNWRAP_FAILED, "Envelope failed authentication", e)
      } catch (e: GeneralSecurityException) {
        throw VaultException(VaultException.Code.UNWRAP_FAILED, "Could not unwrap key", e)
      }

  // --- Envelope files ---------------------------------------------------------------------

  private fun envelopeName(keyId: String): String {
    require(KEY_ID_PATTERN.matches(keyId)) { "Invalid key id" }
    return "$keyId${EnvelopeStore.SUFFIX}"
  }

  private fun encodeEnvelope(envelope: Envelope): ByteArray =
        JSONObject()
            .put("format", ENVELOPE_FORMAT)
            .put("version", envelope.version)
            .put("keyId", envelope.keyId)
            .put("masterKeyAlias", envelope.masterKeyAlias)
            .put("algorithm", "AES-256-GCM")
            .put("iv", Base64.encodeToString(envelope.iv, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(envelope.ciphertext, Base64.NO_WRAP))
            .put("createdAt", envelope.createdAt)
            .toString()
            .toByteArray(Charsets.UTF_8)

  private fun decodeEnvelope(bytes: ByteArray): Envelope {
    val text = String(bytes, Charsets.UTF_8)
    return try {
      val json = JSONObject(text)
      if (json.getString("format") != ENVELOPE_FORMAT) throw JSONException("Unknown format")
      Envelope(
          version = json.getInt("version"),
          keyId = json.getString("keyId"),
          masterKeyAlias = json.getString("masterKeyAlias"),
          iv = Base64.decode(json.getString("iv"), Base64.NO_WRAP),
          ciphertext = Base64.decode(json.getString("ciphertext"), Base64.NO_WRAP),
          createdAt = json.getLong("createdAt"),
      )
    } catch (e: JSONException) {
      throw VaultException(VaultException.Code.UNWRAP_FAILED, "Key envelope is malformed", e)
    } catch (e: IllegalArgumentException) {
      throw VaultException(VaultException.Code.UNWRAP_FAILED, "Key envelope is malformed", e)
    }
  }

  companion object {
    const val DEFAULT_MASTER_KEY_ALIAS = "trezor.master.v1"
    const val ENVELOPE_FORMAT = "trezor.key-envelope"
    const val ENVELOPE_VERSION = 1
    const val KEY_LENGTH_BYTES = 32
    private const val MAX_RANDOM_BYTES = 1024
    internal const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private val KEY_ID_PATTERN = Regex("^[a-z][a-z0-9-]{0,31}$")
  }
}
