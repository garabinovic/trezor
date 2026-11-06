package com.trezor.app.backup

/**
 * The native half of the backup gate (spec v2.4 §6.1). The JS half, an exclusive
 * operation on the live database queue, already makes every database write wait; this
 * object covers the one native mutation that could break a backup: deleting an attachment
 * file the exported database still refers to.
 *
 * While a backup holds the gate, deletion of an id in its exported set is deferred and runs
 * when the gate is released (on success, failure or cancellation alike). Other ids are
 * deleted at once. Imports are not affected: a new file is not in the exported set.
 */
object BackupGate {

  private var protectedIds: Set<String>? = null
  private val deferred = LinkedHashSet<String>()
  /** Deletes ids whose deletion was deferred; registered by the attachments module. */
  @Volatile var deleter: ((List<String>) -> Unit)? = null

  /** Starts protecting [ids]. Fails if a backup already holds the gate. */
  @Synchronized
  fun begin(ids: Set<String>) {
    check(protectedIds == null) { "A backup is already running" }
    protectedIds = ids.toSet()
  }

  /**
   * Of [ids] (a deletion request), returns those to delete now and keeps the protected
   * ones for [end].
   */
  @Synchronized
  fun filterDeletion(ids: List<String>): List<String> {
    val held = protectedIds ?: return ids
    val (later, now) = ids.partition { it in held }
    deferred += later
    return now
  }

  /** Releases the gate and runs the deferred deletions. Safe to call more than once. */
  fun end() {
    val pending: List<String>
    synchronized(this) {
      if (protectedIds == null) return
      protectedIds = null
      pending = deferred.toList()
      deferred.clear()
    }
    if (pending.isNotEmpty()) deleter?.invoke(pending)
  }

  @Synchronized
  fun isHeld(): Boolean = protectedIds != null
}
