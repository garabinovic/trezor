package com.trezor.app.vault

import com.trezor.app.attachments.DirectorySync
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.SecureRandom
import javax.crypto.SecretKey

/** The master key's side in a key store (Android Keystore in the app). */
interface MasterKeys {
  /** The master key, or null when its alias doesn't exist. Throws [VaultException]. */
  fun load(): SecretKey?

  /**
   * Generates the master key under its alias. Android Keystore silently replaces an
   * existing entry, so this is only called after [load] returned null under the lock.
   */
  fun generate(): SecretKey
}

/**
 * The envelope files in [keyDir] and the rules for creating them, shared by every
 * [KeyVault]. Several vault instances use the same directory and master key (the React
 * modules and the reminder code each create one), so everything here runs under one lock
 * for the whole process; a lock per instance would let two of them see "no master key"
 * at once and both generate one, the second replacing the first.
 *
 * - The master key is generated only when, under the lock, it still doesn't exist and
 *   the directory can be listed and holds no envelope or envelope temp file (anything that
 *   may have been wrapped by an earlier master key).
 * - An envelope is never replaced. It is written to a temp file of its own, synced,
 *   renamed into place, and the directory is synced (the parent too when the directory
 *   was just created) before the key is handed out.
 * - A directory that exists but can't be listed fails with STORAGE_ERROR; it is never
 *   taken for an empty one.
 *
 * Temp files left by a crash are kept: one may be a complete envelope whose rename never
 * reached the disk, and nothing here can tell that safely.
 */
internal class EnvelopeStore(
    private val keyDir: File,
    private val masterKeys: MasterKeys,
    private val syncDirectory: (File) -> Unit = DirectorySync::sync,
) {

  private val random = SecureRandom()

  fun exists(name: String): Boolean = locked { File(keyDir, name).isFile }

  /** The envelope's bytes, or null if there is none. */
  fun read(name: String): ByteArray? =
      locked {
        val file = File(keyDir, name)
        if (!file.isFile) return@locked null
        try {
          file.readBytes()
        } catch (e: IOException) {
          throw VaultException(VaultException.Code.STORAGE_ERROR, "Could not read key envelope", e)
        }
      }

  /** The master key, or null if it doesn't exist. */
  fun masterKey(): SecretKey? = locked { masterKeys.load() }

  /**
   * Creates envelope [name] with the bytes [content] makes from the master key (created
   * first if that is safe). Throws KEY_ALREADY_EXISTS if the envelope exists. Returns only
   * once the envelope is durable.
   */
  fun create(name: String, content: (SecretKey) -> ByteArray) {
    locked {
      val file = File(keyDir, name)
      if (file.exists()) {
        throw VaultException(VaultException.Code.KEY_ALREADY_EXISTS, "Key already exists")
      }
      val master = masterKeys.load() ?: generateIfSafe()
      write(file, content(master))
    }
  }

  private fun generateIfSafe(): SecretKey {
    val dependent = entries().filter { it.endsWith(SUFFIX) || it.endsWith(TMP_SUFFIX) }
    if (dependent.isNotEmpty()) {
      throw VaultException(
          VaultException.Code.MASTER_KEY_MISSING,
          "Master key is missing but ${dependent.size} envelope file(s) exist",
      )
    }
    return masterKeys.generate()
  }

  /** Names in [keyDir]; empty only when it provably doesn't exist. */
  private fun entries(): List<String> {
    if (!keyDir.exists()) {
      // exists() == false can also mean "could not stat": confirm from the parent.
      val siblings =
          keyDir.parentFile?.list()
              ?: throw VaultException(
                  VaultException.Code.STORAGE_ERROR, "Cannot list the key directory's parent")
      if (keyDir.name in siblings) {
        throw VaultException(VaultException.Code.STORAGE_ERROR, "Key directory is not accessible")
      }
      return emptyList()
    }
    return keyDir.list()?.toList()
        ?: throw VaultException(VaultException.Code.STORAGE_ERROR, "Cannot list key directory")
  }

  private fun write(file: File, bytes: ByteArray) {
    try {
      if (!keyDir.isDirectory) {
        if (!keyDir.mkdirs()) throw IOException("Cannot create key directory")
        syncDirectory(keyDir.parentFile ?: throw IOException("Key directory has no parent"))
      }
      val suffix = ByteArray(8).also(random::nextBytes).joinToString("") { "%02x".format(it) }
      val tmp = File(keyDir, "${file.name}.$suffix$TMP_SUFFIX")
      try {
        FileOutputStream(tmp).use {
          it.write(bytes)
          it.fd.sync()
        }
        if (!tmp.renameTo(file)) throw IOException("Cannot move envelope into place")
      } catch (e: IOException) {
        // This write's own temp file, never renamed: no envelope depends on it.
        tmp.delete()
        throw e
      }
      syncDirectory(keyDir)
    } catch (e: IOException) {
      throw VaultException(VaultException.Code.STORAGE_ERROR, "Could not write key envelope", e)
    }
  }

  companion object {
    const val SUFFIX = ".key.json"
    const val TMP_SUFFIX = ".tmp"
    /** One lock for every vault in the process: they share the master key. */
    private val LOCK = Any()

    fun <T> locked(block: () -> T): T = synchronized(LOCK) { block() }
  }
}
