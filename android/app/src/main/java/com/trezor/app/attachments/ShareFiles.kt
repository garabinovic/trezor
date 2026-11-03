package com.trezor.app.attachments

import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom

/**
 * Decrypted copies handed to other apps through the share sheet, in the app's private
 * cache ([dir], the only directory the FileProvider exposes). Each share gets its own
 * random folder, `<dir>/<random>/<file name>`, so the URI shows the file's name and
 * nothing else.
 *
 * A receiving app may read the file well after the share sheet closes, so files are kept
 * for [RETENTION_MS] and removed by [purgeExpired] (at startup and when the app returns
 * to the foreground). A share still being prepared or launched is never removed.
 */
class ShareFiles(
    private val store: AttachmentStore,
    private val dir: File,
    private val now: () -> Long = System::currentTimeMillis,
    /** Deletes a share folder; replaceable so tests can make cleanup fail. */
    private val deleteFolder: (File) -> Boolean = File::deleteRecursively,
) {

  private val random = SecureRandom()
  /** Folders of shares being prepared or launched in this process. */
  private val active = mutableSetOf<String>()

  /**
   * Decrypts attachment [id] into a new share file and checks it against its record
   * before returning it; nothing is left behind on failure. The file stays protected
   * from cleanup until [release]. Throws [AttachmentStore.StoreException].
   */
  fun prepare(
      id: String,
      expectedSize: Long,
      expectedSha256: String,
      fileName: String,
      mimeType: String,
  ): File {
    val folder = File(dir, ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) })
    synchronized(this) { active.add(folder.name) }
    try {
      if (!folder.mkdirs()) {
        throw AttachmentStore.StoreException(
            AttachmentStore.StoreException.Code.IO_FAILED, "Could not create share folder")
      }
      val part = File(folder, PART_NAME)
      FileOutputStream(part).use { out ->
        val buffered = out.buffered(BUFFER_BYTES)
        store.decryptTo(id, buffered, expectedSize, expectedSha256)
        buffered.flush()
        out.fd.sync()
      }
      val target = File(folder, nameFor(fileName, mimeType))
      if (!part.renameTo(target)) {
        throw AttachmentStore.StoreException(
            AttachmentStore.StoreException.Code.IO_FAILED, "Could not prepare share")
      }
      target.setLastModified(now())
      return target
    } catch (e: Exception) {
      folder.deleteRecursively()
      synchronized(this) { active.remove(folder.name) }
      if (e is java.io.IOException) {
        throw AttachmentStore.StoreException(
            AttachmentStore.StoreException.Code.IO_FAILED, "Could not prepare share", e)
      }
      throw e
    }
  }

  /** The share sheet has been launched; from now on only age protects the file. */
  @Synchronized
  fun release(file: File) {
    active.remove(file.parentFile?.name)
  }

  /**
   * Hands a prepared [file] to the share sheet: [uriFor] makes its FileProvider URI and
   * [start] launches the chooser. If either throws, no other app can have received the
   * file, so its folder is deleted at once and the original exception is rethrown (a
   * failing cleanup never replaces it). After a successful launch the file is kept for the
   * retention period, since the receiving app may read it later.
   */
  fun <U> launch(file: File, uriFor: (File) -> U, start: (U) -> Unit) {
    try {
      start(uriFor(file))
    } catch (e: Throwable) {
      discard(file)
      throw e
    } finally {
      release(file)
    }
  }

  /** Deletes the folder of a share no app received. Only folders of this cache. */
  private fun discard(file: File) {
    val folder = file.parentFile ?: return
    try {
      if (folder.parentFile?.canonicalPath == dir.canonicalPath) deleteFolder(folder)
    } catch (e: Exception) {
      // Left for purgeExpired; the caller reports the original failure.
    }
  }

  /** Deletes shares older than [RETENTION_MS], except active ones; returns how many. */
  @Synchronized
  fun purgeExpired(): Int {
    val cutoff = now() - RETENTION_MS
    var removed = 0
    dir.listFiles()?.forEach { entry ->
      if (entry.name in active) return@forEach
      val newest =
          if (entry.isDirectory) {
            (entry.listFiles().orEmpty().map { it.lastModified() } + entry.lastModified()).max()
          } else {
            entry.lastModified()
          }
      if (newest < cutoff && entry.deleteRecursively()) removed++
    }
    return removed
  }

  companion object {
    /** 24 hours, as agreed: long enough for the receiving app to read the file. */
    const val RETENTION_MS = 24L * 60 * 60 * 1000
    private const val PART_NAME = ".part"
    private const val BUFFER_BYTES = 64 * 1024

    /** The stored display name, cleaned again and with an extension for [mimeType]. */
    internal fun nameFor(fileName: String, mimeType: String): String =
        AttachmentImporter.fileName(AttachmentImporter.cleanName(fileName), mimeType)
  }
}
