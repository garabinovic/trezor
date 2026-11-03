package com.trezor.app.attachments

import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom

/**
 * Short-lived decrypted copies for showing an image, in the app's private cache ([dir]).
 * Each copy is decrypted completely and checked against its database record before its
 * path is handed out, gets a random name (so image caches never reuse one), and is deleted
 * when the screen showing it goes away; [purge] removes any left over at startup.
 */
class AttachmentViews(private val store: AttachmentStore, private val dir: File) {

  private val random = SecureRandom()

  /** Decrypts [id] and returns the copy. Throws [AttachmentStore.StoreException]. */
  fun open(id: String, expectedSize: Long, expectedSha256: String): File {
    if (!dir.isDirectory && !dir.mkdirs()) {
      throw AttachmentStore.StoreException(
          AttachmentStore.StoreException.Code.IO_FAILED, "Could not create view directory")
    }
    val name = ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }
    val part = File(dir, "$name$PART_SUFFIX")
    val target = File(dir, "$name$SUFFIX")
    try {
      FileOutputStream(part).use { out ->
        val buffered = out.buffered(BUFFER_BYTES)
        store.decryptTo(id, buffered, expectedSize, expectedSha256)
        buffered.flush()
      }
      if (!part.renameTo(target)) {
        throw AttachmentStore.StoreException(
            AttachmentStore.StoreException.Code.IO_FAILED, "Could not prepare view")
      }
      return target
    } catch (e: java.io.IOException) {
      throw AttachmentStore.StoreException(
          AttachmentStore.StoreException.Code.IO_FAILED, "Could not prepare view", e)
    } finally {
      part.delete()
    }
  }

  /** Deletes a copy returned by [open]. Anything outside [dir] is refused. */
  fun close(path: String): Boolean {
    val file = File(path)
    if (file.parentFile?.canonicalPath != dir.canonicalPath || !NAME.matches(file.name)) {
      throw IllegalArgumentException("Not a view file")
    }
    return file.delete()
  }

  /** Deletes every copy (startup, when nothing can be showing one). */
  fun purge(): Int = dir.listFiles()?.count { it.isFile && it.delete() } ?: 0

  companion object {
    private const val SUFFIX = ".view"
    private const val PART_SUFFIX = ".part"
    private const val BUFFER_BYTES = 64 * 1024
    private val NAME = Regex("^[0-9a-f]{32}\\.view$")
  }
}
