package com.trezor.app.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.util.TimeZone

/**
 * Keeps Android alarms in line with the schedule record. Every operation is idempotent:
 * each reminder has a fixed pair of PendingIntents (data URI = reminder id, request codes
 * 0 and 1), so re-arming replaces them and duplicates are impossible.
 *
 * Timing is approximate on purpose (no exact-alarm permission). Each occurrence is armed
 * twice and whichever fires first wins; the other is ignored because it carries the same
 * occurrence time, which is no longer the one armed:
 * - setWindow(…, 10 min): within 10 minutes while the device is awake (Android's minimum
 *   window), but deferred while the device is in Doze;
 * - setAndAllowWhileIdle(): fires in Doze too, but Android may deliver it up to 75 % of the
 *   lead time late, capped at one hour.
 */
object ReminderScheduler {

  const val ACTION_FIRE = "com.trezor.app.reminders.FIRE"
  const val EXTRA_ID = "reminderId"
  const val EXTRA_OCCURRENCE = "occurrence"
  /** Android's minimum window for setWindow() (API 31+ lengthens shorter windows). */
  private const val WINDOW_MS = 10 * 60_000L
  private const val REQUEST_WINDOWED = 0
  private const val REQUEST_WHILE_IDLE = 1

  private fun alarms(context: Context) =
      context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  fun reminderUri(id: String): Uri = Uri.parse("trezor-reminder:${Uri.encode(id)}")

  private fun firePendingIntent(
      context: Context,
      id: String,
      requestCode: Int,
      occurrence: Long?,
  ): PendingIntent? {
    val intent =
        Intent(context, ReminderAlarmReceiver::class.java)
            .setAction(ACTION_FIRE)
            .setData(reminderUri(id))
            .putExtra(EXTRA_ID, id)
    if (occurrence != null) intent.putExtra(EXTRA_OCCURRENCE, occurrence)
    val flags =
        PendingIntent.FLAG_IMMUTABLE or
            (if (occurrence != null) PendingIntent.FLAG_UPDATE_CURRENT
            else PendingIntent.FLAG_NO_CREATE)
    return PendingIntent.getBroadcast(context, requestCode, intent, flags)
  }

  /** True if an alarm is currently armed for [id] (used by tests and diagnostics). */
  fun isArmed(context: Context, id: String): Boolean =
      listOf(REQUEST_WINDOWED, REQUEST_WHILE_IDLE).any {
        firePendingIntent(context, id, it, null) != null
      }

  private fun cancel(context: Context, id: String) {
    for (code in listOf(REQUEST_WINDOWED, REQUEST_WHILE_IDLE)) {
      firePendingIntent(context, id, code, null)?.let {
        alarms(context).cancel(it)
        it.cancel()
      }
    }
  }

  /**
   * Arms the occurrence to deliver and returns it, or null (nothing armed).
   *
   * [previous] is the occurrence armed before (if any). While it is due but not yet
   * delivered (Android may still be inside its delivery window when the schedule is
   * re-armed, e.g. on a clock sync or when the app opens), it stays armed: an alarm in
   * the past fires right away. Otherwise the next occurrence strictly after [after].
   */
  private fun arm(
      context: Context,
      entry: ScheduleStore.Entry,
      after: Long,
      previous: Long? = null,
  ): Long? {
    val spec = entry.spec()
    val zone = TimeZone.getDefault()
    val pending =
        previous?.takeIf {
          it <= after && spec != null && Recurrence.nextOccurrence(spec, it - 1, zone) == it
        }
    val next = pending ?: spec?.let { Recurrence.nextOccurrence(it, after, zone) }
    if (next == null) {
      cancel(context, entry.id)
      return null
    }
    val manager = alarms(context)
    manager.setWindow(
        AlarmManager.RTC_WAKEUP,
        next,
        WINDOW_MS,
        firePendingIntent(context, entry.id, REQUEST_WINDOWED, next)!!,
    )
    manager.setAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        next,
        firePendingIntent(context, entry.id, REQUEST_WHILE_IDLE, next)!!,
    )
    return next
  }

  /**
   * Replaces the whole schedule with [entries] (from the app's reconciliation): cancels
   * alarms and shown notifications of reminders that are gone, arms the rest.
   */
  fun sync(context: Context, entries: List<ScheduleStore.Entry>, showDetails: Boolean) {
    val now = System.currentTimeMillis()
    ScheduleStore.update(context) { old ->
      val keep = entries.map { it.id }.toSet()
      for (gone in old.entries.map { it.id } - keep) {
        cancel(context, gone)
        ReminderNotifications.cancelShown(context, gone)
      }
      val previous = old.entries.associate { it.id to it.armedFor }
      val armed = entries.map { it.copy(armedFor = arm(context, it, now, previous[it.id])) }
      val onceIds = entries.filter { it.mode == Recurrence.Mode.ONCE }.map { it.id }.toSet()
      ScheduleStore.Record(showDetails, armed, old.fired intersect onceIds)
    }
  }

  /** After reboot, app update, clock or time-zone change: recompute every alarm. */
  fun rearmAll(context: Context) {
    val now = System.currentTimeMillis()
    ScheduleStore.update(context) { record ->
      record.copy(
          entries = record.entries.map { it.copy(armedFor = arm(context, it, now, it.armedFor)) }
      )
    }
  }

  /**
   * An alarm fired for [occurrence]: show the notification and arm the next occurrence,
   * if any. The second alarm of the pair (or any stale alarm) no longer matches the armed
   * occurrence and is ignored, so each occurrence notifies once.
   */
  fun onFire(context: Context, id: String, occurrence: Long?) {
    val now = System.currentTimeMillis()
    ScheduleStore.update(context) { record ->
      val entry = record.entries.firstOrNull { it.id == id }
      if (entry == null) {
        // Deleted, completed or no longer scheduled: never resurrect it.
        cancel(context, id)
        return@update record
      }
      if (occurrence != null && occurrence != entry.armedFor) {
        return@update record // Already handled by the other alarm of the pair.
      }
      ReminderNotifications.show(context, entry, record.showDetails)
      if (entry.mode == Recurrence.Mode.ONCE) {
        cancel(context, id)
        record.copy(
            entries = record.entries.map { if (it.id == id) it.copy(armedFor = null) else it },
            fired = record.fired + id,
        )
      } else {
        // Strictly after the occurrence just shown, even if it fired early or late;
        // missed occurrences are skipped, never replayed.
        val after = maxOf(now, entry.armedFor ?: now)
        val next = arm(context, entry, after)
        record.copy(
            entries = record.entries.map { if (it.id == id) it.copy(armedFor = next) else it },
        )
      }
    }
  }

  /** ONCE reminders that fired since the app last reconciled. */
  fun firedOnceIds(context: Context): List<String> =
      ScheduleStore.load(context).fired.toList()

  /** Exposed for the time-zone instrumentation test. */
  internal fun nextFor(entry: ScheduleStore.Entry, after: Long, zone: TimeZone): Long? =
      entry.spec()?.let { Recurrence.nextOccurrence(it, after, zone) }
}
