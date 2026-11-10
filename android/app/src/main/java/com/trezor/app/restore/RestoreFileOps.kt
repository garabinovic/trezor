package com.trezor.app.restore

import com.trezor.app.attachments.DirectorySync
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

/**
 * The restore file operations (Phase 6 spec v2.4 §9.3). Durability: a rename or new name is
 * durable only once its directory is synced, so every operation syncs the directories it
 * changed. Atomic "no replace" relies on the restore gate and the single process.
 *
 * [syncDirectory] and [link] are replaceable so JVM tests can observe and fail them; they
 * prove the order of operations, not crash atomicity on a real filesystem (§8.5 A6).
 */
class RestoreFileOps(
    private val layout: RestoreLayout,
    private val syncDirectory: (File) -> Unit = DirectorySync::sync,
    private val link: (File, File) -> Unit = { src, dst -> android.system.Os.link(src.path, dst.path) },
) {

  fun syncDirectory(dir: File) = syncDirectory.invoke(dir)

  /** Renames [from] to [to], which must not exist; syncs both parent directories. */
  fun renameNoReplaceDurable(from: File, to: File) {
    if (to.exists()) throw IOException("Rename target exists")
    if (!from.exists()) throw IOException("Rename source missing")
    if (!from.renameTo(to)) throw IOException("Rename failed")
    syncDirectory(from.parentFile!!)
    if (from.parentFile!!.canonicalPath != to.parentFile!!.canonicalPath) syncDirectory(to.parentFile!!)
  }

  /**
   * Hard-links [src] at [dst], or copies it if linking fails; [dst] must not exist. The copy
   * goes to a temp name first and is synced, so a partial copy never has the final name.
   * Syncs [dst]'s directory. Returns true for a link, false for a copy.
   */
  fun linkOrCopyDurable(src: File, dst: File): Boolean {
    if (dst.exists()) throw IOException("Link target exists")
    val linked =
        try {
          link(src, dst)
          true
        } catch (e: Exception) {
          dst.delete()
          false
        }
    if (!linked) {
      val part = File(dst.parentFile, "${dst.name}.part")
      part.delete()
      FileInputStream(src).use { input ->
        FileOutputStream(part).use { output ->
          input.copyTo(output)
          output.fd.sync()
        }
      }
      if (dst.exists()) throw IOException("Link target exists")
      if (!part.renameTo(dst)) throw IOException("Copy failed")
    }
    syncDirectory(dst.parentFile!!)
    return linked
  }

  /**
   * Deletes [dir] and everything in it, then syncs its parent. Only `D/restore`, `D/backup`,
   * `D/check/<id>`, `N/restore`, `N/restore/attachments` and `N/quarantine/<restoreId>` of
   * [journalRestoreId] (the current journal's restore) are allowed, and `P_att`
   * (`N/restore/previous-attachments`) only for the `cleanup` row ([cleanup], spec v2.5 §8).
   * Delete all data ([wipe], Phase 7) may also delete the live attachment root, the
   * quarantine root, `D/check` and the view and share caches. Anything else is refused.
   * Throws if anything is left.
   */
  fun deleteRecursively(dir: File, journalRestoreId: String? = null, cleanup: Boolean = false, wipe: Boolean = false) {
    val path = dir.canonicalPath
    val allowed =
        mutableListOf(
            layout.restoreDbDir,
            File(layout.databaseDir, "backup"),
            layout.restoreDir,
            layout.stagedAttachments,
        )
    if (journalRestoreId != null) allowed += layout.quarantine(journalRestoreId)
    if (cleanup) allowed += layout.previousAttachments
    if (wipe) allowed += listOfNotNull(layout.liveAttachments, layout.quarantineRoot, layout.checkStaging, layout.viewCache, layout.shareCache)
    val inCheck = dir.parentFile?.canonicalPath == File(layout.databaseDir, "check").canonicalPath
    require(inCheck || allowed.any { it.canonicalPath == path }) { "Deletion outside the restore paths refused" }
    if (!dir.exists()) return
    dir.deleteRecursively()
    if (dir.exists()) throw IOException("Could not delete ${dir.name}")
    syncDirectory(dir.parentFile!!)
  }

  /** Deletes the regular file [file] if it exists, then syncs its directory. */
  fun deleteFileDurable(file: File) {
    if (!file.exists()) return
    if (!file.isFile || !file.delete()) throw IOException("Could not delete ${file.name}")
    syncDirectory(file.parentFile!!)
  }

  /** Writes [bytes] to [file] durably: temp file, `fsync`, rename over it, directory `fsync`. */
  fun writeDurable(file: File, bytes: ByteArray) {
    val dir = file.parentFile!!
    if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Could not create ${dir.name}")
    val tmp = File(dir, "${file.name}.tmp")
    FileOutputStream(tmp).use {
      it.write(bytes)
      it.fd.sync()
    }
    if (!tmp.renameTo(file)) throw IOException("Could not store ${file.name}")
    syncDirectory(dir)
  }

  /** Creates [dir] (and its parents) if needed and syncs its parent. */
  fun mkdirDurable(dir: File) {
    if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Could not create ${dir.name}")
    syncDirectory(dir.parentFile!!)
  }

  /** `fsync` of a regular file's content. */
  fun syncFile(file: File) {
    java.io.RandomAccessFile(file, "rw").use { it.fd.sync() }
  }
}
