package com.trezor.app.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Alarm fired (not exported: only our own PendingIntents reach it). */
class ReminderAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ReminderScheduler.ACTION_FIRE) return
    val id = intent.getStringExtra(ReminderScheduler.EXTRA_ID) ?: return
    try {
      val occurrence =
          if (intent.hasExtra(ReminderScheduler.EXTRA_OCCURRENCE))
              intent.getLongExtra(ReminderScheduler.EXTRA_OCCURRENCE, 0L)
          else null
      ReminderScheduler.onFire(context, id, occurrence)
    } catch (e: Exception) {
      // Keystore or storage unavailable; the app re-arms on next reconciliation.
    }
  }
}

/**
 * Re-arms alarms after events that clear or shift them. Exported because the system
 * sends these; only the listed actions are honoured, and re-arming is idempotent.
 */
class ReminderRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in ACTIONS) return
    try {
      ReminderScheduler.rearmAll(context)
    } catch (e: Exception) {
      // As above: the app re-arms on next launch.
    }
  }

  companion object {
    val ACTIONS =
        setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
        )
  }
}

/** Hands notification taps to JavaScript, whether the app was running or not. */
object ReminderTaps {
  @Volatile private var pending: String? = null
  @Volatile var listener: (() -> Unit)? = null

  fun handle(intent: Intent?) {
    if (intent?.action != ReminderNotifications.ACTION_OPEN) return
    val id = intent.getStringExtra(ReminderScheduler.EXTRA_ID) ?: return
    pending = id
    listener?.invoke()
  }

  @Synchronized
  fun consume(): String? = pending.also { pending = null }
}
