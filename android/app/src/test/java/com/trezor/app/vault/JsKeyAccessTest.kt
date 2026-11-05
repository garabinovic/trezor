package com.trezor.app.vault

import org.junit.Assert.assertEquals
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
}
