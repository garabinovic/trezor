package com.trezor.app.reminders

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.trezor.app.MainActivity
import com.trezor.app.R

/**
 * Posts reminder notifications with framework APIs only. Content is generic unless the
 * user enabled "Show reminder details". A generic public version is always attached, so
 * Android's own lock-screen privacy settings decide what appears on the lock screen.
 */
object ReminderNotifications {

  const val CHANNEL_ID = "reminders"
  const val ACTION_OPEN = "com.trezor.app.reminders.OPEN"
  private const val NOTIFICATION_ID = 1
  private const val GENERIC_TITLE = "Trezor"
  private const val GENERIC_BODY = "You have a reminder."

  private fun manager(context: Context) =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  /** Notification tag: one shown notification per reminder, replaced in place. */
  private fun tag(id: String) = "reminder:$id"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel =
        NotificationChannel(CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Reminders you set in Trezor"
          lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
    manager(context).createNotificationChannel(channel)
  }

  fun enabled(context: Context): Boolean = manager(context).areNotificationsEnabled()

  private fun builder(context: Context): Notification.Builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION") Notification.Builder(context)
      }

  private fun openIntent(context: Context, id: String): PendingIntent {
    // Explicit intent to our own activity: no exported deep link.
    val intent =
        Intent(context, MainActivity::class.java)
            .setAction(ACTION_OPEN)
            .setData(ReminderScheduler.reminderUri(id))
            .putExtra(ReminderScheduler.EXTRA_ID, id)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
        context,
        0,
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  fun show(context: Context, entry: ScheduleStore.Entry, showDetails: Boolean) {
    if (!enabled(context)) return // Permission denied or notifications turned off.
    ensureChannel(context)
    val detailed = showDetails && !entry.title.isNullOrEmpty()
    val title = if (detailed) entry.title!! else GENERIC_TITLE
    val body = if (detailed) entry.body?.takeIf { it.isNotBlank() } else GENERIC_BODY

    val publicVersion =
        builder(context)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setContentTitle(GENERIC_TITLE)
            .setContentText(GENERIC_BODY)
            .build()

    val notification =
        builder(context)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setContentTitle(title)
            .apply { if (body != null) setContentText(body) }
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, entry.id))
            .build()
    try {
      manager(context).notify(tag(entry.id), NOTIFICATION_ID, notification)
    } catch (e: SecurityException) {
      // Permission revoked between the check and posting; nothing to show.
    }
  }

  fun cancelShown(context: Context, id: String) {
    manager(context).cancel(tag(id), NOTIFICATION_ID)
  }
}
