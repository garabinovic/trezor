package com.trezor.app.restore

import com.trezor.app.attachments.AttachmentStore
import com.trezor.app.reminders.ScheduleRestore
import com.trezor.app.restore.RestoreJournal.Phase
import java.io.File
import java.io.IOException

/**
 * The swap and its recovery (Phase 6 spec v2.4 §8.2 steps 13a–15 and §8.5, as amended by
 * v2.5 §1–§9), without Android types. One decision function reads the journal and the file
 * state and returns exactly one row of the §8.5 tables (or refuses); [step] performs that
 * row's actions. Startup recovery ([run]), the restoring process ([swap]) and Cancel restore
 * ([cancel]) all use them, so a rollback runs the same code wherever it starts.
 *
 * Callers hold the [RestoreLock] (a session for [swap], a recovery run for the rest), so no
 * other actor changes these paths meanwhile; that is what makes the check before each rename
 * a no-replace rename (v2.5 §3.6). JVM tests prove the order of operations and the decisions,
 * not crash atomicity on a real filesystem (assumption A6, v2.5 §11).
 */
class RestoreRecovery(
    private val layout: RestoreLayout,
    private val ops: RestoreFileOps,
    private val types: PathTypes,
    private val schedule: ScheduleRestore,
    private val lock: RestoreLock = RestoreLock.PROCESS,
) {

  private val journals = JournalStore(layout, ops)

  /** The six paths of the state tables: `A = (L_att, S_att, P_att)`, `B = (L_db, S_db, P_db)`. */
  enum class Slot(val dir: Boolean) {
    L_ATT(true),
    S_ATT(true),
    P_ATT(true),
    L_DB(false),
    S_DB(false),
    P_DB(false),
  }

  /** The swap renames a–d and the rollback renames r1–r4 (§8.5). */
  enum class Rename(val from: Slot, val to: Slot) {
    A(Slot.L_ATT, Slot.P_ATT),
    B(Slot.S_ATT, Slot.L_ATT),
    C(Slot.L_DB, Slot.P_DB),
    D(Slot.S_DB, Slot.L_DB),
    R1(Slot.L_DB, Slot.S_DB),
    R2(Slot.P_DB, Slot.L_DB),
    R3(Slot.L_ATT, Slot.S_ATT),
    R4(Slot.P_ATT, Slot.L_ATT),
  }

  sealed class Decision {
    /** No journal and no restore directory: startup continues. */
    object Clean : Decision()

    /** The "none" row: staging without a journal, past the M-c guard. */
    object Staging : Decision()

    class Prepared(val journal: RestoreJournal, val present: Set<Slot>) : Decision()

    /** `swapping`: the renames still due (none: only `verifying` is written). */
    class Forward(val journal: RestoreJournal, val renames: List<Rename>) : Decision()

    /** `verifying`: JS verifies `L_db` (v2.5 §1). */
    class Verify(val journal: RestoreJournal) : Decision()

    class Cleanup(val journal: RestoreJournal) : Decision()

    /** `rollingback`: the renames still due (none: only `rolledback` is written). */
    class Back(val journal: RestoreJournal, val renames: List<Rename>) : Decision()

    class RolledBack(val journal: RestoreJournal) : Decision()
  }

  sealed class Outcome {
    object Done : Outcome()

    /** `L_db` needs JS verification against these restored attachment ids. */
    class Verify(val attachmentIds: List<String>) : Outcome()
  }

  enum class Verification {
    PASS,
    /** A deterministic failure (v2.5 §1.3): roll back. */
    FAIL,
    /** Transient: keep everything, `RESTORE_VERIFY_RETRY`. */
    RETRY,
    /** The device key is gone: keep everything, `RESTORE_UNAVAILABLE`. */
    UNAVAILABLE,
  }

  // --- Decision (§8.5 tables, v2.5 §3) -----------------------------------------------------

  /**
   * Syncs what the decision depends on (v2.5 §4.2), then classifies. Throws
   * `RESTORE_STATE_UNKNOWN` for every state outside the tables and `RESTORE_RECOVERY_RETRY`
   * when a path can't be examined or a sync fails; neither changes anything.
   */
  fun decide(): Decision {
    val restoreDir = present(layout.restoreDir, PathType.DIR)
    val restoreDbDir = present(layout.restoreDbDir, PathType.DIR)
    io {
      if (restoreDir) {
        // A temp journal is never authoritative (§8.4).
        if (present(layout.journalTmp, PathType.FILE)) ops.deleteFileDurable(layout.journalTmp)
        if (present(layout.journal, PathType.FILE)) ops.syncFile(layout.journal)
      }
      syncSet(restoreDir, restoreDbDir)
    }
    val journal = if (restoreDir && present(layout.journal, PathType.FILE)) journals.read() else null
    if (journal == null) {
      if (!restoreDir && !restoreDbDir) return Decision.Clean
      // M-c: what only a journal's restore leaves means the journal is missing, not stale staging.
      if (restoreDbDir) requireAbsent(layout.previousDb)
      if (restoreDir) {
        requireAbsent(layout.previousAttachments)
        requireAbsent(layout.savedSchedule)
      }
      return Decision.Staging
    }

    val present =
        Slot.values()
            .filter {
              val parent = if (it == Slot.S_ATT || it == Slot.P_ATT) restoreDir else if (it == Slot.S_DB || it == Slot.P_DB) restoreDbDir else true
              parent && present(fileOf(it), if (it.dir) PathType.DIR else PathType.FILE)
            }
            .toSet()
    val h = journal.hadAttachments

    if (journal.phase != Phase.PREPARED) {
      // L5: `pending` exists only before step 10–11, which comes before the swap.
      if (journal.scheduleSaved == RestoreJournal.Schedule.PENDING) throw unknown("Schedule not saved")
      // L4: no SQLite sidecar anywhere once the swap may have begun.
      sidecars(layout.liveDb).forEach(::requireAbsent)
      if (restoreDbDir) (sidecars(layout.stagedDb) + sidecars(layout.previousDb)).forEach(::requireAbsent)
      if (restoreDir) requireAbsent(layout.incomingAttachment)
    }

    return when (journal.phase) {
      Phase.PREPARED ->
          if (beforeSwap(present, h)) Decision.Prepared(journal, present) else throw unknown("Unexpected files")
      Phase.SWAPPING ->
          Decision.Forward(journal, remaining(forward(h), start(h), present) ?: throw unknown("Unexpected files"))
      Phase.VERIFYING -> if (present == end(h)) Decision.Verify(journal) else throw unknown("Unexpected files")
      Phase.CLEANUP ->
          if (present - Slot.P_ATT - Slot.P_DB == setOf(Slot.L_ATT, Slot.L_DB) && (h || Slot.P_ATT !in present)) {
            Decision.Cleanup(journal)
          } else {
            throw unknown("Unexpected files")
          }
      Phase.ROLLINGBACK ->
          Decision.Back(journal, remaining(backward(h), end(h), present) ?: throw unknown("Unexpected files"))
      Phase.ROLLEDBACK ->
          if (beforeSwap(present, h)) Decision.RolledBack(journal) else throw unknown("Unexpected files")
    }
  }

  /** The `prepared` and `rolledback` rows: `A = (h, ·, 0)`, `B = (1, ·, 0)`. */
  private fun beforeSwap(present: Set<Slot>, h: Boolean) =
      (Slot.L_ATT in present) == h && Slot.L_DB in present && Slot.P_ATT !in present && Slot.P_DB !in present

  /** The state that passed step 13a, where the swap starts and a rollback ends. */
  private fun start(h: Boolean) = setOfNotNull(if (h) Slot.L_ATT else null, Slot.S_ATT, Slot.L_DB, Slot.S_DB)

  /** The state after the swap: `verifying`, and where a rollback starts. */
  private fun end(h: Boolean) = setOfNotNull(Slot.L_ATT, if (h) Slot.P_ATT else null, Slot.L_DB, Slot.P_DB)

  private fun forward(h: Boolean) = listOfNotNull(if (h) Rename.A else null, Rename.B, Rename.C, Rename.D)

  private fun backward(h: Boolean) = listOfNotNull(Rename.R1, Rename.R2, Rename.R3, if (h) Rename.R4 else null)

  /**
   * The rows of one phase are the states reached from [from] by single renames of [renames]:
   * the renames still due in [present], or null if it is none of them.
   */
  private fun remaining(renames: List<Rename>, from: Set<Slot>, present: Set<Slot>): List<Rename>? {
    var state = from
    for (i in 0..renames.size) {
      if (state == present) return renames.drop(i)
      if (i < renames.size) state = state - renames[i].from + renames[i].to
    }
    return null
  }

  // --- Actions -------------------------------------------------------------------------------

  /** One row's actions, in the spec's order, ending in its phase write or journal deletion. */
  fun step(decision: Decision) =
      io {
        when (decision) {
          Decision.Clean -> Unit
          Decision.Staging -> {
            ops.deleteRecursively(layout.restoreDbDir)
            ops.deleteRecursively(layout.restoreDir)
          }
          is Decision.Prepared -> undoPrepared(layout, ops, journals, schedule, decision.journal)
          is Decision.Forward -> rollForward(decision)
          is Decision.Verify -> throw IllegalStateException("Verification is done in JS")
          is Decision.Cleanup -> cleanup()
          is Decision.Back -> {
            // A failure stops here (RESTORE_RECOVERY_RETRY): never forward again (M-d).
            decision.renames.forEach(::rename)
            writePhase(decision.journal, Phase.ROLLEDBACK)
          }
          is Decision.RolledBack -> rolledBack(decision.journal)
        }
      }

  private fun rollForward(decision: Decision.Forward) {
    for (r in decision.renames) {
      try {
        rename(r)
      } catch (e: Exception) {
        // M-d: roll back instead. The rename may have happened even if its sync failed
        // (v2.5 §4.3); every outcome of one rename is a `rollingback` row. If this write
        // fails, the next attempt starts again from `swapping`.
        writePhase(decision.journal, Phase.ROLLINGBACK)
        return
      }
    }
    writePhase(decision.journal, Phase.VERIFYING)
  }

  /** Renames under the lock: the target must be absent and the source of the expected type (v2.5 §3.6). */
  private fun rename(r: Rename) {
    val from = fileOf(r.from)
    val to = fileOf(r.to)
    if (types.of(to) != PathType.ABSENT || types.of(from) != if (r.from.dir) PathType.DIR else PathType.FILE) {
      throw IOException("Rename state changed")
    }
    ops.renameNoReplaceDurable(from, to)
  }

  /** v2.5 §8. Only after `cleanup` was written, i.e. after verification passed. */
  private fun cleanup() {
    ops.deleteRecursively(layout.previousAttachments, cleanup = true)
    ops.deleteFileDurable(layout.previousDb)
    ops.deleteFileDurable(File(layout.restoreDir, "${layout.savedSchedule.name}.tmp"))
    ops.deleteFileDurable(layout.savedSchedule)
    ops.deleteRecursively(layout.restoreDbDir)
    ops.deleteRecursively(layout.stagedAttachments)
    journals.delete()
    removeEmptyRestoreDir(layout, ops)
  }

  private fun rolledBack(journal: RestoreJournal) {
    schedule.restoreAndRearm(savedOf(journal.scheduleSaved))
    ops.deleteRecursively(layout.stagedAttachments)
    ops.deleteRecursively(layout.restoreDbDir)
    ops.deleteRecursively(layout.quarantine(journal.restoreId), journal.restoreId)
    journals.delete()
    removeEmptyRestoreDir(layout, ops)
  }

  /** Every phase write is preceded by the sync set (v2.5 §4.2); the journal write syncs `N/restore`. */
  private fun writePhase(journal: RestoreJournal, phase: Phase) {
    syncSet(layout.restoreDir.isDirectory, layout.restoreDbDir.isDirectory)
    journals.write(journal.copy(phase = phase))
  }

  /** `D`, `D/restore`, `N`, `N/restore`, each if it exists (v2.5 §4.1). */
  private fun syncSet(restoreDir: Boolean, restoreDbDir: Boolean) {
    ops.syncDirectory(layout.databaseDir)
    if (restoreDbDir) ops.syncDirectory(layout.restoreDbDir)
    ops.syncDirectory(layout.noBackupDir)
    if (restoreDir) ops.syncDirectory(layout.restoreDir)
  }

  // --- Startup recovery (v2.5 §7) -------------------------------------------------------------

  /** Runs rows until startup can continue ([Outcome.Done]) or `L_db` needs verification. */
  fun run(): Outcome {
    lock.verifyRetryOf = null
    repeat(MAX_STEPS) {
      when (val d = decide()) {
        Decision.Clean -> return Outcome.Done
        is Decision.Verify -> return Outcome.Verify(restoredAttachmentIds())
        else -> step(d)
      }
    }
    throw RestoreException(RestoreException.RECOVERY_RETRY, "Recovery did not settle")
  }

  /**
   * The ids of `L_att` during `verifying` (v2.5 §1.5). It holds exactly what step 4 staged,
   * so any other entry is unexplained (decision D1: `RESTORE_STATE_UNKNOWN`, never a rollback).
   */
  private fun restoredAttachmentIds(): List<String> {
    val root = layout.liveAttachments
    val names = root.list() ?: throw RestoreException(RestoreException.VERIFY_RETRY, "Attachments can't be listed")
    return names.sorted().map { name ->
      val id = name.removeSuffix(AttachmentStore.SUFFIX)
      if (!name.endsWith(AttachmentStore.SUFFIX) || !AttachmentStore.ID_PATTERN.matches(id)) {
        throw unknown("Unexpected entry among the restored attachments")
      }
      when (types.of(File(root, name))) {
        PathType.FILE -> id
        PathType.ERROR -> throw RestoreException(RestoreException.VERIFY_RETRY, "Attachment can't be examined")
        else -> throw unknown("Unexpected entry among the restored attachments")
      }
    }
  }

  /** Records the JS verification of `L_db` (v2.5 §1.3): `cleanup`, `rollingback`, or nothing. */
  fun finishVerification(result: Verification) {
    val d = decide() as? Decision.Verify ?: throw unknown("Not verifying")
    lock.verifyRetryOf = if (result == Verification.RETRY) d.journal.restoreId else null
    when (result) {
      Verification.PASS -> io { writePhase(d.journal, Phase.CLEANUP) }
      Verification.FAIL -> io { writePhase(d.journal, Phase.ROLLINGBACK) }
      Verification.RETRY,
      Verification.UNAVAILABLE -> Unit
    }
  }

  // --- Cancel restore (v2.5 §2) -----------------------------------------------------------------

  /**
   * Whether Cancel restore may be offered, and the previous attachment ids for the JS check of
   * `P_db` (decision D4). Only in `verifying`, exactly on its row, after this process's last
   * verification ended in `RESTORE_VERIFY_RETRY`, with `P_db` a non-empty file of whole pages
   * and `P_att` a listable directory. Otherwise `RESTORE_CANCEL_UNAVAILABLE`.
   */
  fun previousData(): List<String> = cancelState().second

  /** Re-checks [previousData]'s conditions, then writes `rollingback` durably; nothing else. */
  fun cancel() {
    val (journal, _) = cancelState()
    io { writePhase(journal, Phase.ROLLINGBACK) }
    lock.verifyRetryOf = null
  }

  private fun cancelState(): Pair<RestoreJournal, List<String>> {
    val d =
        try {
          decide()
        } catch (e: RestoreException) {
          throw cancelUnavailable()
        }
    if (d !is Decision.Verify || lock.verifyRetryOf != d.journal.restoreId) throw cancelUnavailable()
    val size = layout.previousDb.length()
    if (size <= 0 || size % PAGE_BYTES != 0L) throw cancelUnavailable()
    val ids =
        if (!d.journal.hadAttachments) {
          emptyList()
        } else {
          val root = layout.previousAttachments
          (root.list() ?: throw cancelUnavailable())
              .filter { it.endsWith(AttachmentStore.SUFFIX) && types.of(File(root, it)) == PathType.FILE }
              .map { it.removeSuffix(AttachmentStore.SUFFIX) }
              .filter(AttachmentStore.ID_PATTERN::matches)
              .sorted()
        }
    return d.journal to ids
  }

  // --- The restoring process (§8.2 steps 13a–15, v2.5 §6) ---------------------------------------

  /**
   * Step 13a, then 14–15: the files must match the `prepared` row of [restoreId] exactly (no
   * sidecar beside `L_db` or `S_db`, the schedule saved, nothing in transit); then `swapping`
   * and the renames. A failed rename rolls back in this process with the recovery rows, up to
   * `rolledback`. Returns the phase reached (`VERIFYING`, or `ROLLEDBACK` once rolled back).
   * Any exception leaves the durable phase for recovery; the caller restarts either way.
   */
  fun swap(restoreId: String): Phase {
    val d = decide()
    if (d !is Decision.Prepared || d.journal.restoreId != restoreId) throw unknown("Not the prepared state")
    val journal = d.journal
    if (journal.scheduleSaved == RestoreJournal.Schedule.PENDING || Slot.S_ATT !in d.present || Slot.S_DB !in d.present) {
      throw unknown("Not ready to swap")
    }
    (sidecars(layout.liveDb) + sidecars(layout.stagedDb)).forEach(::requireAbsent)
    requireAbsent(layout.incomingAttachment)
    io { writePhase(journal, Phase.SWAPPING) }
    repeat(MAX_STEPS) {
      when (val next = decide()) {
        is Decision.Verify -> return Phase.VERIFYING
        Decision.Clean -> return Phase.ROLLEDBACK
        is Decision.Forward,
        is Decision.Back,
        is Decision.RolledBack,
        Decision.Staging -> step(next)
        else -> throw unknown("Unexpected state during the swap")
      }
    }
    throw RestoreException(RestoreException.RECOVERY_RETRY, "Swap did not settle")
  }

  // --- Helpers ----------------------------------------------------------------------------------

  private fun fileOf(slot: Slot): File =
      when (slot) {
        Slot.L_ATT -> layout.liveAttachments
        Slot.S_ATT -> layout.stagedAttachments
        Slot.P_ATT -> layout.previousAttachments
        Slot.L_DB -> layout.liveDb
        Slot.S_DB -> layout.stagedDb
        Slot.P_DB -> layout.previousDb
      }

  /** Present (of [expected] type) or absent; anything else refuses (v2.5 §3.1). */
  private fun present(file: File, expected: PathType): Boolean =
      when (types.of(file)) {
        expected -> true
        PathType.ABSENT -> false
        PathType.ERROR -> throw RestoreException(RestoreException.RECOVERY_RETRY, "File state can't be read")
        else -> throw unknown("Unexpected file type")
      }

  private fun requireAbsent(file: File) {
    when (types.of(file)) {
      PathType.ABSENT -> Unit
      PathType.ERROR -> throw RestoreException(RestoreException.RECOVERY_RETRY, "File state can't be read")
      else -> throw unknown("Unexpected file")
    }
  }

  private fun sidecars(db: File) = SIDECARS.map { File(db.parentFile, db.name + it) }

  private fun unknown(message: String) = RestoreException(RestoreException.STATE_UNKNOWN, message)

  private fun cancelUnavailable() = RestoreException(RestoreException.CANCEL_UNAVAILABLE, "Cancel restore not possible")

  /** A failing action stops at once (M-d): `RESTORE_RECOVERY_RETRY`, everything else kept. */
  private inline fun <T> io(block: () -> T): T =
      try {
        block()
      } catch (e: RestoreException) {
        throw e
      } catch (e: Exception) {
        throw RestoreException(RestoreException.RECOVERY_RETRY, "Restore recovery failed", e)
      }

  companion object {
    private val SIDECARS = listOf("-journal", "-wal", "-shm")
    private const val PAGE_BYTES = 4096L
    /** More than one pass through every phase: a loop that doesn't settle is a bug, not progress. */
    private const val MAX_STEPS = 16

    fun savedOf(schedule: RestoreJournal.Schedule) =
        when (schedule) {
          RestoreJournal.Schedule.PENDING -> ScheduleRestore.Saved.PENDING
          RestoreJournal.Schedule.SAVED -> ScheduleRestore.Saved.SAVED
          RestoreJournal.Schedule.ABSENT -> ScheduleRestore.Saved.ABSENT
        }

    /**
     * The pre-swap failure path (§8.2), for a `prepared` journal: the schedule restored
     * (§8.11), `D/restore`, `N/restore/attachments`, this restore's quarantine and a section in
     * transit deleted, then the journal, then the empty `N/restore` (v2.5 §8). Idempotent.
     */
    internal fun undoPrepared(
        layout: RestoreLayout,
        ops: RestoreFileOps,
        journals: JournalStore,
        schedule: ScheduleRestore,
        journal: RestoreJournal,
    ) {
      schedule.restoreAndRearm(savedOf(journal.scheduleSaved))
      ops.deleteRecursively(layout.restoreDbDir)
      ops.deleteRecursively(layout.stagedAttachments)
      ops.deleteRecursively(layout.quarantine(journal.restoreId), journal.restoreId)
      ops.deleteFileDurable(layout.incomingAttachment)
      journals.delete()
      removeEmptyRestoreDir(layout, ops)
    }

    /** L3: an empty `N/restore` goes after the journal, and `N` is synced. */
    internal fun removeEmptyRestoreDir(layout: RestoreLayout, ops: RestoreFileOps) {
      if (layout.restoreDir.list()?.isEmpty() == true) ops.deleteRecursively(layout.restoreDir)
    }
  }
}
