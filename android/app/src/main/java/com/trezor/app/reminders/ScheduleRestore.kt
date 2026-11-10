package com.trezor.app.reminders

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

/**
 * Saving, clearing and restoring the native schedule around a restore (Phase 6 spec v2.4
 * §8.2 steps 10–11 and §8.11). Each operation runs as **one** critical section on the
 * `ScheduleStore` monitor (M-b), the same monitor `load`, `save` and `update` hold, so an
 * alarm (`onFire`) or a re-arm (`rearmAll`) arriving meanwhile waits and then runs on the
 * result. The monitor is reentrant, so [clear] and [rearm] may use `ScheduleStore.update`.
 * Lock order as before: this monitor, then the vault lock inside `ScheduleStore.withKey`.
 *
 * Android work (alarms, notifications, the encrypted record) is passed in, so the order and
 * the file handling are covered by JVM tests.
 */
class ScheduleRestore(
    /** `N/reminders/schedule.bin`. */
    private val schedule: File,
    /** `N/restore/schedule.saved.bin`. */
    private val saved: File,
    private val syncDirectory: (File) -> Unit,
    /** The effect of `ReminderScheduler.sync(entries = [])` plus cancelling every `reminder:` notification. */
    private val clear: () -> Unit,
    /** Whether the stored record is empty: no entry, nothing in `fired`. */
    private val isEmpty: () -> Boolean,
    /** `ReminderScheduler.rearmAll`. */
    private val rearm: () -> Unit,
    private val lock: Any = ScheduleStore,
) {

  enum class Saved {
    PENDING,
    SAVED,
    ABSENT,
  }

  /**
   * Step 10–11 (a)–(d): copies the schedule byte for byte to [saved] (durably), reports
   * [Saved.SAVED] or [Saved.ABSENT] to [record] (the journal update, which must be durable
   * when it returns), clears, and confirms the record is empty. Throws on any failure;
   * the caller then takes the pre-swap failure path, which restores the schedule.
   */
  fun saveAndClear(record: (Saved) -> Unit): Saved =
      synchronized(lock) {
        val state =
            if (schedule.isFile) {
              copyDurable(schedule, saved)
              Saved.SAVED
            } else {
              Saved.ABSENT
            }
        record(state)
        clear()
        if (!isEmpty()) throw IOException("Schedule not empty after clearing")
        state
      }

  /**
   * `restoreAndRearmSchedule` (pre-swap failure, later `rolledback`), idempotent (M-a):
   * 1. by [state]: copy [saved] back durably (or skip if a previous attempt already did and
   *    deleted it), delete the schedule if none existed, or leave it when the alarms were
   *    never cleared;
   * 2. delete [saved] (and a stray temp copy), durably;
   * 3. re-arm every entry with its saved `armedFor` (so `fired` and a pending ONCE are back).
   *
   * Steps 2 and 3 are in this order on purpose (review L-A, a clarification of spec §8.11,
   * which lists the deletion last): once the copy-back is durable, [saved] goes before
   * anything is armed. If re-arming then fails and an alarm fires before the retry, the retry
   * finds `saved` absent and only re-arms; it never copies the stale schedule back over what
   * that alarm recorded (which could notify the same occurrence twice). A failure before
   * step 2 completes leaves [saved] in place and the copy-back is simply repeated (no alarm
   * of the restored schedule is armed before step 3).
   */
  fun restoreAndRearm(state: Saved) =
      synchronized(lock) {
        val tmp = tmpOf(saved)
        when (state) {
          Saved.SAVED -> if (saved.isFile) copyDurable(saved, schedule)
          Saved.ABSENT ->
              if (schedule.exists()) {
                if (!schedule.delete()) throw IOException("Could not remove the schedule")
                syncDirectory(schedule.parentFile!!)
              }
          Saved.PENDING -> Unit
        }
        if (tmp.exists() && !tmp.delete()) throw IOException("Could not remove a stray copy")
        val deleted = saved.exists()
        if (deleted && !saved.delete()) throw IOException("Could not remove the saved schedule")
        // For `saved`, the deletion must be durable before anything is armed, also when an
        // earlier attempt deleted the copy but its directory sync failed (review Low 1).
        if (deleted || state == Saved.SAVED) syncDirectory(saved.parentFile!!)
        rearm()
      }

  /** Temp file, `fsync`, rename over [to], `fsync` of its directory. */
  private fun copyDurable(from: File, to: File) {
    val dir = to.parentFile!!
    if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Could not create ${dir.name}")
    val tmp = tmpOf(to)
    FileInputStream(from).use { input ->
      FileOutputStream(tmp).use { output ->
        input.copyTo(output)
        output.fd.sync()
      }
    }
    if (!tmp.renameTo(to)) throw IOException("Could not store ${to.name}")
    syncDirectory(dir)
  }

  private fun tmpOf(file: File) = File(file.parentFile, "${file.name}.tmp")
}
