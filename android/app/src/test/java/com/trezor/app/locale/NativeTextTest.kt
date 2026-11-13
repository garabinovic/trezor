package com.trezor.app.locale

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The JS side checks that it sends exactly these keys (__tests__/i18n/strings.test.ts). */
class NativeTextTest {

  @Test
  fun keysAreUniqueAndEveryDefaultIsEnglishText() {
    val keys = NativeText.entries.map { it.key }
    assertEquals(keys.size, keys.toSet().size)
    NativeText.entries.forEach { assertTrue(it.name, it.default.isNotBlank()) }
  }

  @Test
  fun aStoredTranslationIsUsedAndAMissingOneFallsBackToEnglish() {
    assertEquals("Imate podsetnik.", NativeText.REMINDER_BODY.or("Imate podsetnik."))
    assertEquals("You have a reminder.", NativeText.REMINDER_BODY.or(null))
    assertEquals("You have a reminder.", NativeText.REMINDER_BODY.or("  "))
  }
}
