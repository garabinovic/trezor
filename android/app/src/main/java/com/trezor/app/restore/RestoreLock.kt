package com.trezor.app.restore

import com.trezor.app.attachments.RestoreGate

/**
 * The process-wide restore lock (Phase 6 spec v2.5 §5): a restore session (from
 * `beginRestore` until its pre-swap cleanup succeeded, its module shut down, or the process
 * ended) and a recovery run (startup recovery, the Cancel restore check and action) exclude
 * each other, so recovery never touches staging that an active restore owns, and two recovery
 * runs exclude each other too, also from the same JS runtime (a Retry during Cancel restore).
 * Process-wide because a reloaded JS runtime gets a new module instance while the old one may
 * still be finishing a step. A refused request changes nothing: `RESTORE_IN_PROGRESS`.
 *
 * A recovery run is identified by the token [recover] returns: only that token can use or end
 * it, so a refused caller can't release the run that refused it.
 */
class RestoreLock(private val gateHeld: () -> Boolean = RestoreGate::isHeld) {

  private var preparing: String? = null
  /** The token of the recovery run holding the lock. */
  private var recovering: String? = null
  private var runs = 0L

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

  /** Starts a recovery run and returns its token. */
  @Synchronized
  fun recover(): String {
    requireIdle()
    runs++
    return "recovery-$runs".also { recovering = it }
  }

  /** Whether [token] is the run holding the lock. */
  @Synchronized
  fun isRecovering(token: String): Boolean = recovering == token

  /** Ends the run of [token]; any other token (a refused or finished caller's) changes nothing. */
  @Synchronized
  fun endRecover(token: String) {
    if (recovering == token) recovering = null
  }

  private fun requireIdle() {
    if (preparing != null || recovering != null || gateHeld()) {
      throw RestoreException(RestoreException.IN_PROGRESS, "A restore is in progress")
    }
  }

  companion object {
    val PROCESS = RestoreLock()
  }
}
