package com.trezor.app.locale

import android.content.Context

/**
 * The app language (Settings → Language) and the [NativeText] strings in that language.
 *
 * Kept in private SharedPreferences, like the App Lock preference: device-local, readable before
 * the database opens (the lock and storage error screens), and readable by a notification fired
 * while the app is closed. It is not in the database, so not in backups, and Delete all data
 * keeps it.
 */
object LocaleStore {

  private const val PREFS = "trezor.locale"
  private const val LANGUAGE = "language"
  private const val TEXT = "text."
  const val DEFAULT_LANGUAGE = "en"

  private fun prefs(context: Context) =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun language(context: Context): String =
      prefs(context).getString(LANGUAGE, null) ?: DEFAULT_LANGUAGE

  /** Stores the language and its strings together; keys outside [NativeText] are ignored. */
  fun set(context: Context, language: String, texts: Map<String, String>) {
    val editor = prefs(context).edit().putString(LANGUAGE, language)
    for (text in NativeText.entries) {
      val value = texts[text.key]
      if (value.isNullOrBlank()) editor.remove(TEXT + text.key) else editor.putString(TEXT + text.key, value)
    }
    editor.commit()
  }

  fun text(context: Context, text: NativeText): String =
      text.or(prefs(context).getString(TEXT + text.key, null))
}
