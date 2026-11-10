package com.trezor.app.restore

import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.attribute.BasicFileAttributes

/** `lstat` on the JVM (`NOFOLLOW_LINKS`), for tests; [unreadable] paths answer ERROR. */
class JvmPathTypes(private val unreadable: (File) -> Boolean = { false }) : PathTypes {
  override fun of(file: File): PathType {
    if (unreadable(file)) return PathType.ERROR
    return try {
      val a = Files.readAttributes(file.toPath(), BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
      when {
        a.isRegularFile -> PathType.FILE
        a.isDirectory -> PathType.DIR
        else -> PathType.OTHER
      }
    } catch (e: NoSuchFileException) {
      PathType.ABSENT
    }
  }
}
