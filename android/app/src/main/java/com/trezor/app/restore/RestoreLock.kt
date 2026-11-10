package com.trezor.app.restore

import com.trezor.app.attachments.RestoreGate

/**
 * The process-wide restore lock (Phase 6 spec v2.5 §5): a restore session (from
 * `beginRestore` until its pre-swap cleanup succeeded, its module shut down, or the process
 * ended) and a recovery run (startup recovery, the Cancel restore check and action) exclude
 * each other, so recovery never touches staging that an active restore owns. Process-wide
 * because a reloaded JS runtime gets a new module instance while the old one may still be
 * finishing a step. A refused request changes nothing: `RESTORE_IN_PROGRESS`.
 */
class RestoreLock(private val gateHeld: () -> Boolean = RestoreGate::isHeld) {

  private var preparing: String? = null
  private var recovering = false

  /**
   * The restore whose verification last ended in `RESTORE_VERIFY_RETRY` in this process
   * (§2.1 condition 3): only then is Cancel restore offered.
   */
  @Volatile var verifyRetryOf: String? = null

  @Synchronized
  fun prepare(sessionId: String) {
    requireIdle()
    preparing = sessionId
  }

  @Synchronized
  fun endPrepare(sessionId: String) {
    if (preparing == sessionId) preparing = null
  }

  @Synchronized
  fun recover() {
    requireIdle()
    recovering = true
  }

  @Synchronized
  fun endRecover() {
    recovering = false
  }

  private fun requireIdle() {
    if (preparing != null || recovering || gateHeld()) {
      throw RestoreException(RestoreException.IN_PROGRESS, "A restore is in progress")
    }
  }

  companion object {
    val PROCESS = RestoreLock()
  }
}
