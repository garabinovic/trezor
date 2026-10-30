package com.trezor.app.vault

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.KeyStore
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Runs against the real Android Keystore with an isolated alias and directory. */
@RunWith(AndroidJUnit4::class)
class KeyVaultTest {

  private val alias = "trezor.test.master"
  private lateinit var dir: File
  private lateinit var vault: KeyVault

  @Before
  fun setUp() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    dir = File(context.noBackupFilesDir, "keys-test").apply { deleteRecursively() }
    deleteMasterKey()
    vault = KeyVault(dir, alias)
  }

  @After
  fun tearDown() {
    dir.deleteRecursively()
    deleteMasterKey()
  }

  @Test
  fun createThenGetReturnsSameKey() {
    assertFalse(vault.hasKey("database"))
    val created = vault.createKey("database")
    assertEquals(32, created.size)
    assertTrue(vault.hasKey("database"))
    assertArrayEquals(created, vault.getKey("database"))
    // A fresh instance (simulates app restart) unwraps the same key.
    assertArrayEquals(created, KeyVault(dir, alias).getKey("database"))
  }

  @Test
  fun envelopeContainsNoPlaintextKey() {
    val key = vault.createKey("database")
    val text = File(dir, "database.key.json").readText()
    val hex = key.joinToString("") { "%02x".format(it) }
    assertFalse(text.contains(hex))
    val json = JSONObject(text)
    assertEquals("trezor.key-envelope", json.getString("format"))
    assertEquals(1, json.getInt("version"))
    assertEquals("AES-256-GCM", json.getString("algorithm"))
  }

  @Test
  fun createTwiceIsRejected() {
    vault.createKey("database")
    expectCode(VaultException.Code.KEY_ALREADY_EXISTS) { vault.createKey("database") }
  }

  @Test
  fun getMissingKeyDoesNotCreateOne() {
    expectCode(VaultException.Code.KEY_NOT_FOUND) { vault.getKey("database") }
    assertFalse(vault.hasKey("database"))
  }

  @Test
  fun tamperedCiphertextFailsAuthentication() {
    vault.createKey("database")
    editEnvelope("database") {
      val ct = android.util.Base64.decode(it.getString("ciphertext"), android.util.Base64.NO_WRAP)
      ct[0] = (ct[0].toInt() xor 0x01).toByte()
      it.put("ciphertext", android.util.Base64.encodeToString(ct, android.util.Base64.NO_WRAP))
    }
    expectCode(VaultException.Code.UNWRAP_FAILED) { vault.getKey("database") }
  }

  @Test
  fun envelopeCannotBeReusedForAnotherKeyId() {
    vault.createKey("database")
    val copy = File(dir, "files.key.json")
    File(dir, "database.key.json").copyTo(copy)
    // Renamed file: keyId field mismatch.
    expectCode(VaultException.Code.UNWRAP_FAILED) { vault.getKey("files") }
    // Renamed file with keyId edited too: GCM associated data mismatch.
    editEnvelope("files") { it.put("keyId", "files") }
    expectCode(VaultException.Code.UNWRAP_FAILED) { vault.getKey("files") }
  }

  @Test
  fun newerEnvelopeVersionIsUnsupported() {
    vault.createKey("database")
    editEnvelope("database") { it.put("version", 2) }
    expectCode(VaultException.Code.ENVELOPE_UNSUPPORTED) { vault.getKey("database") }
  }

  @Test
  fun malformedEnvelopeIsReported() {
    vault.createKey("database")
    File(dir, "database.key.json").writeText("{not json")
    expectCode(VaultException.Code.UNWRAP_FAILED) { vault.getKey("database") }
  }

  @Test
  fun lostMasterKeyIsReportedAndNeverSilentlyReplaced() {
    vault.createKey("database")
    val before = File(dir, "database.key.json").readText()
    deleteMasterKey()

    expectCode(VaultException.Code.MASTER_KEY_MISSING) { vault.getKey("database") }
    // Creating another key must not mint a new master key while envelopes exist.
    expectCode(VaultException.Code.MASTER_KEY_MISSING) { vault.createKey("files") }

    assertEquals(before, File(dir, "database.key.json").readText())
    assertEquals(KeyVault.SecurityLevel.NONE, vault.masterKeySecurityLevel())
  }

  @Test
  fun masterKeyIsInsideKeystoreAndReportsSecurityLevel() {
    assertEquals(KeyVault.SecurityLevel.NONE, vault.masterKeySecurityLevel())
    vault.createKey("database")
    val level = vault.masterKeySecurityLevel()
    assertNotEquals(KeyVault.SecurityLevel.NONE, level)
    assertNotEquals(KeyVault.SecurityLevel.UNKNOWN, level)
    android.util.Log.i("KeyVaultTest", "Master key security level on this device: $level")
  }

  @Test
  fun randomBytesHaveRequestedLengthAndDiffer() {
    val a = vault.randomBytes(16)
    val b = vault.randomBytes(16)
    assertEquals(16, a.size)
    assertFalse(a.contentEquals(b))
  }

  @Test
  fun invalidKeyIdIsRejected() {
    try {
      vault.hasKey("../escape")
      fail("Expected IllegalArgumentException")
    } catch (e: IllegalArgumentException) {
      // expected
    }
  }

  private fun deleteMasterKey() {
    KeyStore.getInstance("AndroidKeyStore").apply {
      load(null)
      if (containsAlias(alias)) deleteEntry(alias)
    }
  }

  private fun editEnvelope(keyId: String, change: (JSONObject) -> Unit) {
    val file = File(dir, "$keyId.key.json")
    val json = JSONObject(file.readText())
    change(json)
    file.writeText(json.toString())
  }

  private fun expectCode(code: VaultException.Code, block: () -> Unit) {
    try {
      block()
      fail("Expected VaultException $code")
    } catch (e: VaultException) {
      assertEquals(code, e.code)
    }
  }
}
