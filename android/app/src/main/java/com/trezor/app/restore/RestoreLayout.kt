package com.trezor.app.restore

import java.io.File

/**
 * The fixed restore paths (Phase 6 spec v2.4 §2). `D` is the database directory, `N` the
 * no-backup directory. Paths are never stored in the journal; ids are validated before they
 * become file names.
 */
class RestoreLayout(val databaseDir: File, val noBackupDir: File) {
  /** `L_db`. */
  val liveDb = File(databaseDir, "trezor.db")
  val liveDbJournal = File(databaseDir, "trezor.db-journal")
  /** `D/restore`. */
  val restoreDbDir = File(databaseDir, "restore")
  val incoming = File(restoreDbDir, "incoming.db")
  /** `S_db`. */
  val stagedDb = File(restoreDbDir, "trezor.db")
  /** `P_db` (Step 4). */
  val previousDb = File(restoreDbDir, "previous.db")

  /** `L_att`. */
  val liveAttachments = File(noBackupDir, "attachments")
  /** `N/restore`. */
  val restoreDir = File(noBackupDir, "restore")
  val journal = File(restoreDir, "restore.json")
  val journalTmp = File(restoreDir, "restore.json.tmp")
  val savedSchedule = File(restoreDir, "schedule.saved.bin")
  /** `S_att`. */
  val stagedAttachments = File(restoreDir, "attachments")
  /** `P_att` (Step 4). */
  val previousAttachments = File(restoreDir, "previous-attachments")
  /** One attachment section on its way into `S_att` (still under the backup's wrap key). */
  val incomingAttachment = File(restoreDir, "incoming-attachment.tmp")

  val quarantineRoot = File(noBackupDir, "quarantine")
  val schedule = File(noBackupDir, "reminders/schedule.bin")

  /** `N/quarantine/<restoreId>`. */
  fun quarantine(restoreId: String): File = File(quarantineRoot, RestoreIds.restoreId(restoreId))
}

object RestoreIds {
  private val HEX32 = Regex("^[0-9a-f]{32}$")

  fun restoreId(id: String): String {
    require(HEX32.matches(id)) { "Invalid restore id" }
    return id
  }

  fun isHex32(id: String) = HEX32.matches(id)
}
