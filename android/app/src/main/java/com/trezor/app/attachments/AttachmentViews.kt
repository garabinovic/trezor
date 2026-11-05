package com.trezor.app.attachments

import java.io.File
import java.io.FileOutputStream
import java.security.SecureRandom

/**
 * Short-lived decrypted copies for viewing, in the app's private cache ([dir]): whole
 * attachments ([open]) and rendered PDF pages ([newFile]). A decrypted attachment is
 * checked completely against its database record before its path is handed out. Every
 * file gets a random name (so image caches never reuse one) and is deleted when the
 * screen showing it goes away ([close]). [purgeInactive] removes files no screen holds
 * (when the app returns to the foreground); [purge] removes all of them (at startup).
 */
class AttachmentViews(private val store: AttachmentStore, private val dir: File) {

  private val random = SecureRandom()
  /** Names of files handed out and not closed yet. */
  private val active = mutableSetOf<String>()

  /** Decrypts [id] and returns the copy. Throws [AttachmentStore.StoreException]. */
  fun open(id: String, expectedSize: Long, expectedSha256: String): File {
    val target = reserve()
    val part = File(dir, "${target.name}$PART_SUFFIX")
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
    } catch (e: Throwable) {
      // Errors too: the reserved name is released, and the plaintext part goes in finally.
      release(target)
      when (e) {
        is AttachmentStore.StoreException -> throw e
        is java.io.IOException ->
            throw AttachmentStore.StoreException(
                AttachmentStore.StoreException.Code.IO_FAILED, "Could not prepare view", e)
        else -> throw e
      }
    } finally {
      part.delete()
    }
  }

  /** A new, empty, tracked file name for derived content such as a rendered page. */
  fun newFile(): File = reserve()

  /** Deletes a file from [open] or [newFile]. Anything outside [dir] is refused. */
  fun close(path: String): Boolean {
    val file = File(path)
    if (file.parentFile?.canonicalPath != dir.canonicalPath || !NAME.matches(file.name)) {
      throw IllegalArgumentException("Not a view file")
    }
    return release(file)
  }

  /** Deletes every file no screen holds; returns how many. */
  @Synchronized
  fun purgeInactive(): Int =
      dir.listFiles()?.count { file ->
        val name = file.name.removeSuffix(PART_SUFFIX)
        file.isFile && name !in active && file.delete()
      } ?: 0

  /** Deletes every copy (startup, when nothing can be showing one). */
  @Synchronized
  fun purge(): Int {
    active.clear()
    return dir.listFiles()?.count { it.isFile && it.delete() } ?: 0
  }

  @Synchronized
  private fun reserve(): File {
    if (!dir.isDirectory && !dir.mkdirs()) {
      throw AttachmentStore.StoreException(
          AttachmentStore.StoreException.Code.IO_FAILED, "Could not create view directory")
    }
    val name = ByteArray(16).also(random::nextBytes).joinToString("") { "%02x".format(it) }
    return File(dir, "$name$SUFFIX").also { active.add(it.name) }
  }

  @Synchronized
  private fun release(file: File): Boolean {
    active.remove(file.name)
    return file.delete()
  }

  companion object {
    private const val SUFFIX = ".view"
    private const val PART_SUFFIX = ".part"
    private const val BUFFER_BYTES = 64 * 1024
    private val NAME = Regex("^[0-9a-f]{32}\\.view$")
  }
}
