package com.trezor.app.attachments

import java.io.File

/**
 * Every place an encrypted attachment file under the device `attachments` key can be
 * (Phase 6 spec v2.4 §8.6): the live root, the restore staging and previous roots, and each
 * quarantine directory. The key may be created only if none of them holds a `.tza` file.
 *
 * The fail-closed listing rule of [AttachmentStore.hasAnyFile] applies to each of them: a
 * location that exists but can't be listed throws instead of answering "no".
 */
object AttachmentLocations {

  /** `<noBackupDir>/attachments`, `restore/attachments`, `restore/previous-attachments`. */
  fun roots(noBackupDir: File): List<File> =
      listOf(
          File(noBackupDir, "attachments"),
          File(noBackupDir, "restore/attachments"),
          File(noBackupDir, "restore/previous-attachments"),
      )

  fun quarantineRoot(noBackupDir: File) = File(noBackupDir, "quarantine")

  /** Whether any encrypted attachment file exists in any location. Never guesses "no". */
  fun hasAnyFile(noBackupDir: File): Boolean {
    if (roots(noBackupDir).any { hasTza(it) }) return true
    return listOrThrow(quarantineRoot(noBackupDir)).any { it.isDirectory && hasTza(it) }
  }

  private fun hasTza(dir: File): Boolean =
      listOrThrow(dir).any { it.isFile && it.name.endsWith(AttachmentStore.SUFFIX) }

  private fun listOrThrow(dir: File): Array<File> {
    if (!dir.exists()) return emptyArray()
    return (if (dir.isDirectory) dir.listFiles() else null)
        ?: throw AttachmentStore.StoreException(
            AttachmentStore.StoreException.Code.IO_FAILED, "Attachment location can't be read")
  }
}
