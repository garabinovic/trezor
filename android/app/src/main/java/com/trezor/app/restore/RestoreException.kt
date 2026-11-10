package com.trezor.app.restore

/**
 * A restore error with its spec code (Phase 6 spec v2.4 §8, v2.5 §10): `RESTORE_STATE_UNKNOWN`,
 * `RESTORE_UNAVAILABLE`, `RESTORE_RECOVERY_RETRY`, `RESTORE_VERIFY_RETRY`,
 * `RESTORE_IN_PROGRESS`, `BACKUP_CHANGED`, `STORAGE_ERROR`; and `RESTORE_CANCEL_UNAVAILABLE`
 * when Cancel restore isn't possible (v2.5 §2.1). The message never contains a path, id, key
 * or password (§9.4).
 */
class RestoreException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause) {
  companion object {
    const val STATE_UNKNOWN = "RESTORE_STATE_UNKNOWN"
    const val UNAVAILABLE = "RESTORE_UNAVAILABLE"
    const val RECOVERY_RETRY = "RESTORE_RECOVERY_RETRY"
    const val VERIFY_RETRY = "RESTORE_VERIFY_RETRY"
    const val IN_PROGRESS = "RESTORE_IN_PROGRESS"
    const val CANCEL_UNAVAILABLE = "RESTORE_CANCEL_UNAVAILABLE"
    const val BACKUP_CHANGED = "BACKUP_CHANGED"
    const val STORAGE_ERROR = "STORAGE_ERROR"
  }
}
