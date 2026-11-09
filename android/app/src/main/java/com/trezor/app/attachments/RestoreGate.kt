package com.trezor.app.attachments

/**
 * The native half of the restore gate (Phase 6 spec v2.4 §8.7). While held, the attachments
 * module accepts no new work from JS: imports, deletes, views, PDFs, exports and shares are
 * refused with [IN_PROGRESS], a picker result that arrives is refused, and an import that
 * finishes meanwhile has its files deleted. The JS half (the exclusive operation on the live
 * database queue and the paused reminder reconcile) is in `src/backup/restore.ts`.
 *
 * The attachments module registers [hooks] so the restore coordinator can wait for work
 * already accepted, see active shares and purge the decrypted caches (§8.9) on the module's
 * own task lanes.
 */
object RestoreGate {

  const val IN_PROGRESS = "RESTORE_IN_PROGRESS"

  interface Hooks {
    /** Waits until every task accepted before the gate has finished. */
    fun drain()

    /** Shares whose copy is still being prepared or launched (`ShareFiles` active set). */
    fun activeShares(): Int

    /** Deletes every view, PDF page and share copy; true only if both caches are empty. */
    fun purgeCaches(): Boolean
  }

  @Volatile private var held = false
  @Volatile var hooks: Hooks? = null

  fun isHeld(): Boolean = held

  /** Takes the gate. Fails if it is already held. */
  @Synchronized
  fun begin() {
    check(!held) { "A restore already holds the gate" }
    held = true
  }

  /** Releases the gate (pre-swap failure path, §8.2). Safe to call more than once. */
  @Synchronized
  fun end() {
    held = false
  }

  /** The registered hooks; IllegalStateException if the attachments module isn't running. */
  fun requireHooks(): Hooks = hooks ?: throw IllegalStateException("Attachments module not running")
}
