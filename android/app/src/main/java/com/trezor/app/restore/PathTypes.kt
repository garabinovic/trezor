package com.trezor.app.restore

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.File

/**
 * What a path is, from `lstat` (Phase 6 spec v2.5 §3.1): never `File.exists()`, which can't
 * tell a missing path from one it can't examine, and follows symlinks.
 */
enum class PathType {
  FILE,
  DIR,
  /** `lstat` failed with `ENOENT`, and only then. */
  ABSENT,
  /** Any other type, a symlink included. */
  OTHER,
  /** `lstat` failed otherwise: the state is not known. */
  ERROR,
}

fun interface PathTypes {
  fun of(file: File): PathType
}

object AndroidPathTypes : PathTypes {
  override fun of(file: File): PathType =
      try {
        val mode = Os.lstat(file.path).st_mode
        when {
          OsConstants.S_ISREG(mode) -> PathType.FILE
          OsConstants.S_ISDIR(mode) -> PathType.DIR
          else -> PathType.OTHER
        }
      } catch (e: ErrnoException) {
        if (e.errno == OsConstants.ENOENT) PathType.ABSENT else PathType.ERROR
      }
}
