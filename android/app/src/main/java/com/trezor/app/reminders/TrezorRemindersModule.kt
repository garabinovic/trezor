package com.trezor.app.reminders

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.trezor.app.vault.NativeTrezorRemindersSpec
import org.json.JSONArray

/** JS bridge for reminder scheduling. Never logs reminder content. */
class TrezorRemindersModule(private val reactContext: ReactApplicationContext) :
    NativeTrezorRemindersSpec(reactContext) {

  init {
    ReminderNotifications.ensureChannel(reactContext)
    ReminderTaps.listener = {
      if (reactContext.hasActiveReactInstance()) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(TAP_EVENT, null)
      }
    }
  }

  override fun getName(): String = NAME

  override fun sync(entriesJson: String, showDetails: Boolean, promise: Promise) {
    try {
      val array = JSONArray(entriesJson)
      val entries =
          (0 until array.length()).mapNotNull { ScheduleStore.parseEntry(array.getJSONObject(it)) }
      if (entries.size != array.length()) {
        promise.reject("INVALID_ARGUMENT", "Invalid schedule entry")
        return
      }
      ReminderScheduler.sync(reactContext, entries, showDetails)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("SCHEDULE_FAILED", "Could not update reminder schedule", e)
    }
  }

  override fun getFiredOnceIds(promise: Promise) {
    try {
      val result = Arguments.createArray()
      ReminderScheduler.firedOnceIds(reactContext).forEach(result::pushString)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("SCHEDULE_FAILED", "Could not read reminder schedule", e)
    }
  }

  override fun consumePendingTap(): String? = ReminderTaps.consume()

  override fun areNotificationsEnabled(promise: Promise) {
    promise.resolve(ReminderNotifications.enabled(reactContext))
  }

  companion object {
    const val NAME = "TrezorReminders"
    const val TAP_EVENT = "trezorReminderTap"
  }
}
