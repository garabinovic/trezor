package com.trezor.app.locale

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.trezor.app.reminders.ReminderNotifications
import com.trezor.app.vault.NativeTrezorLocaleSpec
import org.json.JSONObject

/** JS bridge for [LocaleStore]. Holds no user content. */
class TrezorLocaleModule(private val reactContext: ReactApplicationContext) :
    NativeTrezorLocaleSpec(reactContext) {

  override fun getName(): String = NAME

  override fun getLanguage(): String = LocaleStore.language(reactContext)

  override fun setLanguage(language: String, textsJson: String, promise: Promise) {
    try {
      val json = JSONObject(textsJson)
      val texts = json.keys().asSequence().associateWith { json.optString(it) }
      LocaleStore.set(reactContext, language, texts)
      // The channel's name and description follow the language.
      ReminderNotifications.ensureChannel(reactContext)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("LOCALE_FAILED", "Language could not be saved")
    }
  }

  companion object {
    const val NAME = "TrezorLocale"
  }
}
