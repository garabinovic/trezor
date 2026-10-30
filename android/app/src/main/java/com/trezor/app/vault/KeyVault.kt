package com.trezor.app.vault

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.SecureRandom
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
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
 */
class KeyVault(
    private val keyDir: File,
    private val masterKeyAlias: String = DEFAULT_MASTER_KEY_ALIAS,
) {

  enum class SecurityLevel(val jsValue: String) {
    STRONGBOX("strongbox"),
    TRUSTED_ENVIRONMENT("tee"),
    SOFTWARE("software"),
    UNKNOWN("unknown"),
    NONE("none"),
  }

  private val random = SecureRandom()

  @Synchronized
  fun hasKey(keyId: String): Boolean = envelopeFile(keyId).isFile

  /** Creates and stores a new random key. Returns the plaintext key; caller must zero it. */
  @Synchronized
  fun createKey(keyId: String): ByteArray {
    val file = envelopeFile(keyId)
    if (file.exists()) {
      throw VaultException(VaultException.Code.KEY_ALREADY_EXISTS, "Key '$keyId' already exists")
    }
    val master = loadMasterKey() ?: createMasterKeyIfSafe()
    val key = randomBytes(KEY_LENGTH_BYTES)
    try {
      writeEnvelope(file, wrap(master, keyId, key, System.currentTimeMillis()))
      return key.copyOf()
    } finally {
      key.fill(0)
    }
  }

  /** Unwraps an existing key. Returns the plaintext key; caller must zero it. */
  @Synchronized
  fun getKey(keyId: String): ByteArray {
    val file = envelopeFile(keyId)
    if (!file.isFile) {
      throw VaultException(VaultException.Code.KEY_NOT_FOUND, "No key '$keyId'")
    }
    val envelope = readEnvelope(file)
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
        loadMasterKey()
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
  @Synchronized
  fun masterKeySecurityLevel(): SecurityLevel {
    val key = loadMasterKey() ?: return SecurityLevel.NONE
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

  // --- Master key -------------------------------------------------------------------------

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

  private fun loadMasterKey(): SecretKey? =
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

  /**
   * A new master key would orphan every existing envelope, so it is only created when no
   * envelopes exist yet (first launch, or after the app's data was cleared).
   */
  private fun createMasterKeyIfSafe(): SecretKey {
    val existing = keyDir.listFiles { f -> f.name.endsWith(ENVELOPE_SUFFIX) }.orEmpty()
    if (existing.isNotEmpty()) {
      throw VaultException(
          VaultException.Code.MASTER_KEY_MISSING,
          "Master key is missing but ${existing.size} envelope(s) exist",
      )
    }
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

  private fun envelopeFile(keyId: String): File {
    require(KEY_ID_PATTERN.matches(keyId)) { "Invalid key id" }
    return File(keyDir, "$keyId$ENVELOPE_SUFFIX")
  }

  private fun writeEnvelope(file: File, envelope: Envelope) {
    val json =
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
    try {
      if (!keyDir.isDirectory && !keyDir.mkdirs()) throw IOException("Cannot create $keyDir")
      // Write-then-rename so a crash never leaves a half-written envelope.
      val tmp = File(keyDir, "${file.name}.tmp")
      FileOutputStream(tmp).use {
        it.write(json.toByteArray(Charsets.UTF_8))
        it.fd.sync()
      }
      if (!tmp.renameTo(file)) throw IOException("Cannot move envelope into place")
    } catch (e: IOException) {
      throw VaultException(VaultException.Code.STORAGE_ERROR, "Could not write key envelope", e)
    }
  }

  private fun readEnvelope(file: File): Envelope {
    val text =
        try {
          file.readText(Charsets.UTF_8)
        } catch (e: IOException) {
          throw VaultException(VaultException.Code.STORAGE_ERROR, "Could not read key envelope", e)
        }
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
    private const val ENVELOPE_SUFFIX = ".key.json"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private val KEY_ID_PATTERN = Regex("^[a-z][a-z0-9-]{0,31}$")
  }
}
