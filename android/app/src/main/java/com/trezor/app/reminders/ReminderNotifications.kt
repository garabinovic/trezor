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
import com.trezor.app.locale.LocaleStore
import com.trezor.app.locale.NativeText

/**
 * Posts reminder notifications with framework APIs only. Content is generic unless the
 * user enabled "Show reminder details". A generic public version is always attached, so
 * Android's own lock-screen privacy settings decide what appears on the lock screen. The generic
 * text and the channel are in the app's language ([LocaleStore]).
 */
object ReminderNotifications {

  const val CHANNEL_ID = "reminders"
  const val ACTION_OPEN = "com.trezor.app.reminders.OPEN"
  private const val NOTIFICATION_ID = 1

  private fun manager(context: Context) =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  /** Notification tag: one shown notification per reminder, replaced in place. */
  private fun tag(id: String) = "reminder:$id"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel =
        NotificationChannel(
                CHANNEL_ID,
                LocaleStore.text(context, NativeText.CHANNEL_NAME),
                NotificationManager.IMPORTANCE_HIGH,
            )
            .apply {
              description = LocaleStore.text(context, NativeText.CHANNEL_DESCRIPTION)
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
    // The app's name in the chosen language, as on Home.
    val genericTitle = LocaleStore.text(context, NativeText.REMINDER_TITLE)
    val genericBody = LocaleStore.text(context, NativeText.REMINDER_BODY)
    val title = if (detailed) entry.title!! else genericTitle
    val body = if (detailed) entry.body?.takeIf { it.isNotBlank() } else genericBody

    val publicVersion =
        builder(context)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setContentTitle(genericTitle)
            .setContentText(genericBody)
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

  /** Cancels every shown notification with a `reminder:` tag (restore, spec §8.2 step 10–11). */
  fun cancelAllShown(context: Context) {
    val manager = manager(context)
    manager.activeNotifications
        .filter { it.tag?.startsWith("reminder:") == true }
        .forEach { manager.cancel(it.tag, it.id) }
  }

  fun cancelShown(context: Context, id: String) {
    manager(context).cancel(tag(id), NOTIFICATION_ID)
  }
}
