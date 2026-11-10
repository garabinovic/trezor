package com.trezor.app.restore

import java.io.File
import java.io.IOException

/**
 * The file half of Delete all data (Phase 7). The database is emptied in place by JS, in one
 * transaction that also sets the `wipe.pending` marker; this deletes every file that may still
 * hold user content, through [RestoreFileOps] and its allow-list:
 * - the attachment root `N/attachments` (every `.tza`, `kept-ids`, `tmp/`);
 * - the quarantine root `N/quarantine` (files retained by earlier restores);
 * - the pre-migration snapshots `D/trezor.pre-migration-v<n>[.<k>].db` (and a `-journal`);
 * - backup and Check staging, `D/backup` and `D/check`;
 * - the decrypted view and share copies.
 *
 * Never the live database, the keys (`N/keys`), the App Lock preference, the reminder
 * schedule (cleared through the scheduler) or any file outside the app. Refused while a restore
 * owns its paths. Idempotent: a run interrupted part-way is simply repeated.
 */
class DataWipe(private val layout: RestoreLayout, private val ops: RestoreFileOps, private val types: PathTypes) {

  fun wipe() {
    for (path in listOf(layout.journal, layout.restoreDir, layout.restoreDbDir)) {
      when (types.of(path)) {
        PathType.ABSENT -> Unit
        PathType.ERROR -> throw IOException("Restore state can't be read")
        else -> throw RestoreException(RestoreException.IN_PROGRESS, "A restore owns its files")
      }
    }
    ops.deleteRecursively(layout.liveAttachments, wipe = true)
    ops.deleteRecursively(layout.quarantineRoot, wipe = true)
    snapshots().forEach(ops::deleteFileDurable)
    ops.deleteRecursively(layout.backupStaging)
    ops.deleteRecursively(layout.checkStaging, wipe = true)
    layout.viewCache?.let { ops.deleteRecursively(it, wipe = true) }
    layout.shareCache?.let { ops.deleteRecursively(it, wipe = true) }
  }

  private fun snapshots(): List<File> {
    val names = layout.databaseDir.list() ?: throw IOException("Database directory can't be listed")
    return names.filter(SNAPSHOT::matches).sorted().map { File(layout.databaseDir, it) }
  }

  companion object {
    /** `snapshotNames` in `src/storage/snapshot.ts`, for `trezor.db`. */
    internal val SNAPSHOT = Regex("^trezor\\.pre-migration-v\\d+(\\.\\d+)?\\.db(-journal)?$")
  }
}
