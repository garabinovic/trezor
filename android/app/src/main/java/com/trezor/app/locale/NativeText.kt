package com.trezor.app.locale

/**
 * The few strings Android shows on Trezor's behalf: reminder notifications and their channel,
 * and the system authentication prompt. JavaScript owns every translation (src/i18n) and hands
 * these over in the chosen language; until it has, and for anything it leaves out, the English
 * default is used.
 */
enum class NativeText(val key: String, val default: String) {
  REMINDER_BODY("reminderBody", "You have a reminder."),
  CHANNEL_NAME("channelName", "Reminders"),
  CHANNEL_DESCRIPTION("channelDescription", "Reminders you set in Trezor"),
  UNLOCK_TITLE("unlockTitle", "Unlock Trezor"),
  CONFIRM_SUBTITLE("confirmSubtitle", "Confirm it’s you"),
  APP_LOCK_ON_TITLE("appLockOnTitle", "Turn on App Lock"),
  APP_LOCK_OFF_TITLE("appLockOffTitle", "Turn off App Lock");

  /** A stored translation, or the English default when there is none. */
  fun or(stored: String?): String = stored?.takeIf { it.isNotBlank() } ?: default
}
