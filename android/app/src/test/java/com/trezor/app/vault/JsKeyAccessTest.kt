package com.trezor.app.vault

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The JavaScript-facing vault API only reaches the database key. */
class JsKeyAccessTest {

  private fun rejected(keyId: String) {
    try {
      JsKeyAccess.check(keyId)
      fail("'$keyId' must not be available to JavaScript")
    } catch (e: IllegalArgumentException) {
      // Becomes INVALID_ARGUMENT in TrezorVaultModule.run.
    }
  }

  @Test
  fun theDatabaseKeyIsAllowed() {
    assertEquals("database", JsKeyAccess.check("database"))
  }

  @Test
  fun nativeOnlyKeysAreRejected() {
    rejected("attachments")
    rejected("reminders")
  }

  @Test
  fun unknownAndMalformedIdsAreRejected() {
    for (id in listOf("other", "database2", "Database", " database", "database ", "", "../keys/database",
        "database\u0000", "d".repeat(40))) {
      rejected(id)
    }
  }

  // Gradle runs unit tests from the app module directory.
  private fun source(path: String) = File("src/main/java/com/trezor/app/$path").readText()

  @Test
  fun everyJsKeyOperationGoesThroughTheCheck() {
    val module = source("vault/TrezorVaultModule.kt")
    for (op in listOf("hasKey", "createKey", "getKey")) {
      val body = module.substringAfter("override fun $op(").substringBefore("override fun")
      assertTrue("$op must check the key id", body.contains("vault.$op(JsKeyAccess.check(keyId))"))
    }
    // No other vault call in the JS module takes an id from JavaScript.
    val vaultCalls = Regex("vault\\.(hasKey|createKey|getKey)\\(([^)]*)").findAll(module).toList()
    assertEquals(3, vaultCalls.size)
    vaultCalls.forEach { assertTrue(it.value, it.groupValues[2].startsWith("JsKeyAccess.check(")) }
  }

  @Test
  fun nativeCodeKeepsItsOwnKeysThroughKeyVault() {
    // KeyVault itself is unrestricted; only the JS bridge applies the allow-list.
    assertFalse(source("vault/KeyVault.kt").contains("JsKeyAccess"))
    // Attachments and reminders use their fixed ids directly, never via the JS module.
    val attachments = source("attachments/TrezorAttachmentsModule.kt")
    Regex("vault\\.(hasKey|createKey|getKey)\\(([^)]*)\\)").findAll(attachments).forEach {
      assertEquals(it.value, "AttachmentKeys.KEY_ID", it.groupValues[2])
    }
    val reminders = source("reminders/ScheduleStore.kt")
    assertTrue(reminders.contains("private const val KEY_ID = \"reminders\""))
    assertTrue(reminders.contains("vault.getKey(KEY_ID)") && reminders.contains("vault.createKey(KEY_ID)"))
  }
}
