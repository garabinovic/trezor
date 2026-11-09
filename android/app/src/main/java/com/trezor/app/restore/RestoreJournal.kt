package com.trezor.app.restore

import com.trezor.app.backup.StrictJson
import java.io.File

/**
 * The restore journal `N/restore/restore.json` (Phase 6 spec v2.4 §8.4): strict UTF-8 JSON,
 * exactly these keys, in this order when written:
 *
 * `{"format":"trezor-restore-journal","version":1,"restoreId":…,"backupId":…,"phase":…,
 * "hadDatabase":true,"hadAttachments":…,"scheduleSaved":…,"createdAt":…}`
 *
 * Anything else (unknown or missing key, wrong type, unknown phase, `hadDatabase = false`,
 * malformed ids) is [RestoreException.STATE_UNKNOWN]. Paths are fixed (§2) and not stored.
 */
data class RestoreJournal(
    val restoreId: String,
    val backupId: String,
    val phase: Phase,
    val hadAttachments: Boolean,
    val scheduleSaved: Schedule,
    val createdAt: Long,
) {
  enum class Phase(val json: String) {
    PREPARED("prepared"),
    SWAPPING("swapping"),
    VERIFYING("verifying"),
    CLEANUP("cleanup"),
    ROLLINGBACK("rollingback"),
    ROLLEDBACK("rolledback"),
  }

  enum class Schedule(val json: String) {
    PENDING("pending"),
    SAVED("saved"),
    ABSENT("absent"),
  }

  init {
    require(RestoreIds.isHex32(restoreId) && RestoreIds.isHex32(backupId)) { "Invalid journal id" }
    require(createdAt >= 0) { "Invalid journal time" }
  }

  fun encode(): ByteArray =
      ("{\"format\":\"$FORMAT\",\"version\":$VERSION,\"restoreId\":\"$restoreId\",\"backupId\":\"$backupId\"," +
              "\"phase\":\"${phase.json}\",\"hadDatabase\":true,\"hadAttachments\":$hadAttachments," +
              "\"scheduleSaved\":\"${scheduleSaved.json}\",\"createdAt\":$createdAt}")
          .toByteArray(Charsets.UTF_8)

  companion object {
    const val FORMAT = "trezor-restore-journal"
    const val VERSION = 1L
    private val KEYS =
        listOf("format", "version", "restoreId", "backupId", "phase", "hadDatabase", "hadAttachments", "scheduleSaved", "createdAt")

    fun decode(bytes: ByteArray): RestoreJournal {
      try {
        val map = StrictJson.parse(bytes, 1) as? Map<*, *> ?: unknown()
        if (map.keys != KEYS.toSet()) unknown()
        if (map["format"] != FORMAT || map["version"] != VERSION) unknown()
        if (map["hadDatabase"] != true) unknown()
        val phase = Phase.values().firstOrNull { it.json == map["phase"] } ?: unknown()
        val schedule = Schedule.values().firstOrNull { it.json == map["scheduleSaved"] } ?: unknown()
        val hadAttachments = map["hadAttachments"] as? Boolean ?: unknown()
        return RestoreJournal(
            restoreId = map["restoreId"] as? String ?: unknown(),
            backupId = map["backupId"] as? String ?: unknown(),
            phase = phase,
            hadAttachments = hadAttachments,
            scheduleSaved = schedule,
            createdAt = map["createdAt"] as? Long ?: unknown(),
        )
      } catch (e: RestoreException) {
        throw e
      } catch (e: Exception) {
        throw RestoreException(RestoreException.STATE_UNKNOWN, "Restore journal can't be read", e)
      }
    }

    private fun unknown(): Nothing = throw RestoreException(RestoreException.STATE_UNKNOWN, "Restore journal is not valid")
  }
}

/**
 * Reads and writes the journal durably (§8.4): `restore.json.tmp`, `fsync`, rename over
 * `restore.json`, `fsync N/restore`. A `.tmp` file is never authoritative.
 */
class JournalStore(private val layout: RestoreLayout, private val ops: RestoreFileOps) {

  /** The journal, or null if there is none. A file that can't be read or parsed is STATE_UNKNOWN. */
  fun read(): RestoreJournal? {
    val file = layout.journal
    if (!file.exists()) return null
    val bytes =
        try {
          file.readBytes()
        } catch (e: Exception) {
          throw RestoreException(RestoreException.STATE_UNKNOWN, "Restore journal can't be read", e)
        }
    return RestoreJournal.decode(bytes)
  }

  fun write(journal: RestoreJournal) = ops.writeDurable(layout.journal, journal.encode())

  /** Deletes the journal (and a stray `.tmp`), then syncs `N/restore`. */
  fun delete() {
    deleteFile(layout.journalTmp)
    deleteFile(layout.journal)
    if (layout.restoreDir.isDirectory) ops.syncDirectory(layout.restoreDir)
  }

  private fun deleteFile(file: File) {
    if (file.exists() && !file.delete()) throw java.io.IOException("Could not delete ${file.name}")
  }
}
