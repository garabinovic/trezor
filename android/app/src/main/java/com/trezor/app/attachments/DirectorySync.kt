package com.trezor.app.attachments

import java.io.File
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.file.StandardOpenOption

/**
 * Makes a directory's entries durable (`fsync` on the directory), so a file renamed into
 * it survives a power loss. Syncing the file alone doesn't persist its new name.
 *
 * On Android this uses `android.system.Os` (available on every supported API level). The
 * JVM unit tests run the `java.nio` path against the host file system. Any failure throws
 * [IOException]; callers must not treat the entry as durable then.
 */
object DirectorySync {

  private val onAndroid = System.getProperty("java.vm.name") == "Dalvik"

  fun sync(directory: File) {
    if (onAndroid) syncWithOs(directory) else syncWithNio(directory)
  }

  private fun syncWithOs(directory: File) {
    try {
      val fd =
          android.system.Os.open(directory.path, android.system.OsConstants.O_RDONLY, 0)
      try {
        android.system.Os.fsync(fd)
      } finally {
        android.system.Os.close(fd)
      }
    } catch (e: android.system.ErrnoException) {
      throw IOException("Could not sync directory", e)
    }
  }

  private fun syncWithNio(directory: File) {
    FileChannel.open(directory.toPath(), StandardOpenOption.READ).use { it.force(true) }
  }
}
