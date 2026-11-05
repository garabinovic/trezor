package com.trezor.app.vault

import com.trezor.app.attachments.AttachmentKeys
import com.trezor.app.reminders.ScheduleStore
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Which vault keys each caller reaches, checked against a recording vault: JavaScript only
 * the database key, attachments and reminders only their own fixed ids.
 */
class JsVaultTest {

  /** Records every call; keys are fixed bytes so returned copies can be checked. */
  private class RecordingVault(existing: Set<String> = emptySet()) : VaultKeys {
    val calls = mutableListOf<String>()
    val keys = existing.toMutableSet()
    val handedOut = mutableListOf<ByteArray>()

    override fun hasKey(keyId: String): Boolean {
      calls += "has:$keyId"
      return keyId in keys
    }

    override fun createKey(keyId: String): ByteArray {
      calls += "create:$keyId"
      keys += keyId
      return ByteArray(32) { 0xAB.toByte() }.also { handedOut += it }
    }

    override fun getKey(keyId: String): ByteArray {
      calls += "get:$keyId"
      return ByteArray(32) { 0x1F }.also { handedOut += it }
    }
  }

  private fun refused(block: () -> Unit) {
    try {
      block()
      fail("must be refused")
    } catch (e: IllegalArgumentException) {
      // INVALID_ARGUMENT in JS
    }
  }

  @Test
  fun javascriptReachesTheDatabaseKeyAsHexAndTheBytesAreZeroed() {
    val vault = RecordingVault()
    val js = JsVault(vault)
    assertFalse(js.hasKey("database"))
    assertEquals("ab".repeat(32), js.createKeyHex("database"))
    assertEquals("1f".repeat(32), js.getKeyHex("database"))
    assertEquals(listOf("has:database", "create:database", "get:database"), vault.calls)
    vault.handedOut.forEach { assertArrayEquals(ByteArray(32), it) }
  }

  @Test
  fun everyOtherIdIsRefusedBeforeTheVaultIsTouched() {
    val vault = RecordingVault(existing = setOf("attachments", "reminders"))
    val js = JsVault(vault)
    for (id in listOf("attachments", "reminders", "other", "Database", " database", "", "../keys/database")) {
      refused { js.hasKey(id) }
      refused { js.createKeyHex(id) }
      refused { js.getKeyHex(id) }
    }
    assertEquals(emptyList<String>(), vault.calls)
  }

  @Test
  fun attachmentsUseOnlyTheirOwnKey() {
    val vault = RecordingVault()
    val keys = AttachmentKeys.of(vault) { false }
    keys.obtain().fill(0) // created: no key and no files yet
    keys.obtain().fill(0) // then read
    assertEquals(listOf("has:attachments", "create:attachments", "has:attachments", "get:attachments"), vault.calls)
  }

  @Test
  fun attachmentsNeverCreateAKeyOverExistingFiles() {
    val vault = RecordingVault()
    try {
      AttachmentKeys.of(vault) { true }.obtain()
      fail("files without their key must not get a new key")
    } catch (e: VaultException) {
      assertEquals(VaultException.Code.KEY_NOT_FOUND, e.code)
    }
    assertTrue(vault.calls.none { it.startsWith("create:") })
  }

  @Test
  fun remindersUseOnlyTheirOwnKey() {
    val vault = RecordingVault()
    ScheduleStore.keyFrom(vault).fill(0)
    ScheduleStore.keyFrom(vault).fill(0)
    assertEquals(listOf("has:reminders", "create:reminders", "has:reminders", "get:reminders"), vault.calls)
  }
}
